import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { ClientCheckpoint, NativeSnapshot } from '@spinel/sync-client';
import {
  canonical,
  inlineSnapshotCell,
  normalizedCell,
  normalizedDocBody,
} from '@spinel/sync-transform';
import sharp from 'sharp';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import type { OfflineBundle } from '../src/shared/offlineBundle.ts';
import { sheetImageFixture } from './sheet-image-fixture.ts';
import { recordNativeSnapshots } from './sync-snapshot.ts';
import { syncNetwork } from './sync-network.ts';

type Kind = 'sheet' | 'doc';
type Stored = {
  bundle: OfflineBundle;
  outbox?: {
    account: string;
    item: string;
    spaceId?: string;
    unitId: string;
    checkpoint: ClientCheckpoint;
  };
};
const saveStatus = (page: Page) => page.getByRole('status', { name: 'Save status', exact: true });
const nativeInput = (page: Page) => page.locator('[contenteditable="true"][data-u-comp="editor"]');
const savedLocally = (page: Page) =>
  expect(saveStatus(page)).toHaveText('Saved on this device — waiting to sync.', {
    timeout: 30_000,
  });
const synced = (page: Page) =>
  expect(saveStatus(page)).toHaveText(
    'Synced. All changes are saved on the server and this device.',
    { timeout: 30_000 },
  );
const attention = (page: Page) =>
  expect(saveStatus(page)).toContainText('Needs attention.', { timeout: 30_000 });
const pending = (checkpoint?: ClientCheckpoint) =>
  Boolean(checkpoint?.sent || checkpoint?.buffer.length || checkpoint?.failure);

async function stored(page: Page, accountId: string, itemId: string) {
  return page.evaluate(
    ({ accountId, itemId }) =>
      new Promise<Stored | undefined>((resolve, reject) => {
        const opening = indexedDB.open(`spinel-offline-${accountId}`);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const read = database.transaction('items').objectStore('items').get(itemId);
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            database.close();
            resolve(read.result);
          };
        };
      }),
    { accountId, itemId },
  );
}

async function selectCell(page: Page, address: string) {
  const name = page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .locator('[data-u-comp="defined-name"] input');
  await name.fill(address);
  await name.press('Enter');
}

async function edit(page: Page, kind: Kind, text: string, address = 'D1') {
  if (kind === 'sheet') await selectCell(page, address);
  else {
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await nativeInput(page).focus();
    await page.keyboard.press('Control+Home');
  }
  // insertText goes through the real native input/composition path and commits
  // one user insertion; tests never invoke a writable editor/debug global.
  await page.keyboard.insertText(text);
  if (kind === 'sheet') await page.keyboard.press('Enter');
}

async function copy(page: Page, kind: Kind, address = 'D1') {
  if (kind === 'sheet') await selectCell(page, address);
  else {
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await nativeInput(page).focus();
    await page.keyboard.press('Control+a');
  }
  const sentinel = `not-copied-${randomUUID()}`;
  await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe(sentinel);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Same documented defaults as existing native acceptance; every field remains compared. */
function comparable(snapshot: NativeSnapshot) {
  if (!('sheets' in snapshot))
    return JSON.parse(
      canonical({ ...snapshot, rev: undefined, body: normalizedDocBody(snapshot.body) }),
    );
  const sheets = Object.fromEntries(
    Object.entries(snapshot.sheets).map(([sheetId, sheet]) => [
      sheetId,
      {
        ...sheet,
        cellData: Object.fromEntries(
          Object.entries(sheet.cellData ?? {})
            .map(([row, columns]) => [
              row,
              Object.fromEntries(
                Object.keys(columns ?? {}).flatMap((column) => {
                  const value = normalizedCell(
                    inlineSnapshotCell(snapshot, {
                      sheetId,
                      row: Number(row),
                      column: Number(column),
                    }),
                  );
                  return value ? [[column, value]] : [];
                }),
              ),
            ])
            .filter(([, row]) => Object.keys(row as object).length),
        ),
      },
    ]),
  );
  return JSON.parse(canonical({ ...snapshot, rev: undefined, styles: {}, sheets }));
}

async function matchesServer(page: Page, expected: { revision: number; snapshot: NativeSnapshot }) {
  const read = () =>
    page.evaluate(
      (id) =>
        (
          window as Window & {
            nativeSyncEvidence?: Record<string, { revision: number; snapshot: NativeSnapshot }>;
          }
        ).nativeSyncEvidence?.[id],
      expected.snapshot.id,
    );
  await expect.poll(async () => (await read())?.revision).toBe(expected.revision);
  expect(comparable((await read())!.snapshot)).toEqual(comparable(expected.snapshot));
}

async function fixture(
  browser: Browser,
  baseURL: string,
  info: TestInfo,
  kind: Kind,
  options: { space?: boolean; actor?: 'owner' | 'editor' | 'viewer'; images?: boolean } = {},
) {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser(`Offline owner ${info.testId}`);
  const editor = auth.createUser(`Offline editor ${info.testId}`);
  const viewer = auth.createUser(`Offline viewer ${info.testId}`);
  const users = { owner, editor, viewer };
  const actor = users[options.actor ?? 'owner'];
  const root = options.space
    ? spaces.createRoot(owner.id, { name: 'Offline project', parentId: null }).space
    : undefined;
  const contexts: BrowserContext[] = [];
  const cookie = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: baseURL.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  const account = async (id: string) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1100 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    contexts.push(context);
    await context.addCookies([cookie(id)]);
    return context;
  };
  const control = await account(owner.id);
  let item: { id: string; name: string };
  if (options.images) {
    const response = await control.request.post('/api/items/import', {
      headers: { Origin: baseURL },
      data: {
        filename: 'Offline images.univer.json',
        parentId: null,
        snapshot: await sheetImageFixture(),
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    item = (await response.json()).item;
  } else
    item = root
      ? spaces.createChild(owner.id, root.id, { name: `Offline ${kind}`, kind, parentId: root.id })
          .item
      : workspace.create(owner.id, { name: `Offline ${kind}`, kind, parentId: null });
  for (const [user, role] of [
    [editor, 'editor'],
    [viewer, 'viewer'],
  ] as const)
    if (root) spaces.share(owner.id, root.id, user.id, role);
    else workspace.share(owner.id, item.id, user.id, role);
  const prefix = root ? `/api/spaces/${root.id}/items/${item.id}` : `/api/items/${item.id}`;
  const syncPrefix = root
    ? `/sync-api/spaces/${root.id}/items/${item.id}`
    : `/sync-api/items/${item.id}`;
  const href = root ? `/spaces/${root.id}?item=${item.id}` : `/?item=${item.id}`;
  const prepared = await control.request.post(`${prefix}/collaboration`, {
    headers: { Origin: baseURL },
    data: {},
  });
  expect(prepared.status(), await prepared.text()).toBe(200);
  const unitId = (await prepared.json()).unitId as string;
  const context = await account(actor.id);
  await recordNativeSnapshots(context);
  const network = await syncNetwork(context);
  const page = await context.newPage();
  const errors: string[] = [];
  context.on('page', (target) => target.on('pageerror', (error) => errors.push(error.message)));
  page.on('pageerror', (error) => errors.push(error.message));
  const read = async (id = unitId) => {
    const response = await control.request.get(
      `${syncPrefix}/snapshot?unitId=${encodeURIComponent(id)}`,
    );
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as { revision: number; snapshot: IWorkbookData & IDocumentData };
  };
  const download = async () => {
    await page.goto(href);
    await expect(saveStatus(page)).toHaveText(
      options.actor === 'viewer'
        ? 'View only — reload after your access changes.'
        : 'All changes saved.',
      { timeout: 30_000 },
    );
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const canvas = await page.locator('.univer-container canvas').first().elementHandle();
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    if (root) {
      await page.getByRole('menuitem', { name: 'Offline copies', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Offline copies', exact: true });
      await dialog
        .getByRole('button', { name: `Make ${item.name} available offline on this device` })
        .click();
      await expect(dialog.getByRole('status')).toHaveText(
        `${item.name} is available offline on this device.`,
        { timeout: 120_000 },
      );
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    } else {
      await page
        .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Offline availability', exact: true });
      await expect(dialog.getByRole('status')).toHaveText(
        `${item.name} is available offline on this device.`,
        { timeout: 120_000 },
      );
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    }
    expect(
      await page
        .locator('.univer-container canvas')
        .first()
        .evaluate((node, original) => node === original, canvas!),
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('spinel.offline.account')))
      .toBe(actor.id);
    if (options.actor !== 'viewer') await synced(page);
  };
  return {
    db,
    auth,
    workspace,
    spaces,
    owner,
    editor,
    viewer,
    actor,
    root,
    item,
    unitId,
    context,
    control,
    page,
    network,
    href,
    prefix,
    syncPrefix,
    errors,
    read,
    download,
    cookie,
    async close() {
      const pages = context.pages();
      const observed = await Promise.allSettled(
        pages.map((target) =>
          target.evaluate(() => ({
            native: (window as Window & { nativeSyncEvidence?: unknown }).nativeSyncEvidence,
            status: document.querySelector('[aria-label="Save status"]')?.textContent,
          })),
        ),
      );
      await info.attach('offline-editing-evidence', {
        body: Buffer.from(
          JSON.stringify(
            { observed, errors, outgoing: network.outgoing, incoming: network.incoming },
            null,
            2,
          ),
        ),
        contentType: 'application/json',
      });
      for (const context of contexts) await context.close();
      db.close();
    },
  };
}

test.describe('downloaded native editors', () => {
  test.setTimeout(180_000);

  for (const kind of ['sheet', 'doc'] as const)
    test(`${kind}: durable edits survive two offline reloads and reconnect exactly once`, async ({
      browser,
      baseURL,
    }, info) => {
      const f = await fixture(browser, baseURL!, info, kind, { images: kind === 'sheet' });
      try {
        await f.download();
        const baseline = await f.read();
        const captured = f.network.outgoing.filter((frame) => frame.type === 'submit').length;
        await f.network.setOffline(true);
        // The first edit uses the same mounted editor that was just downloaded.
        const text = kind === 'doc' ? 'Offline text once 731' : '731';
        await edit(f.page, kind, text);
        await savedLocally(f.page);
        const beforeReload = (await stored(f.page, f.actor.id, f.item.id))!.outbox!;
        expect(pending(beforeReload.checkpoint)).toBe(true);
        expect(beforeReload).toMatchObject({
          account: f.actor.id,
          item: f.item.id,
          unitId: f.unitId,
        });
        for (let reload = 0; reload < 2; reload++) {
          await f.page.reload();
          await savedLocally(f.page);
          expect(await copy(f.page, kind)).toContain(text);
          expect((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.buffer).toEqual(
            beforeReload.checkpoint.buffer,
          );
        }
        if (kind === 'sheet') {
          const pixels = async () => {
            const { data, info: image } = await sharp(
              await f.page.locator('.univer-container').screenshot(),
            )
              .removeAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            const colors = [
              [255, 153, 0],
              [34, 85, 238],
              [34, 187, 102],
            ];
            const counts = [0, 0, 0];
            for (let offset = 0; offset < data.length; offset += image.channels)
              colors.forEach((color, index) => {
                if (color.every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
                  counts[index]++;
              });
            return counts.every((count) => count > 1000);
          };
          await expect.poll(pixels, { timeout: 25_000 }).toBe(true);
        }
        await f.network.setOffline(false);
        await synced(f.page);
        const committed = await f.read();
        expect(committed.revision).toBe(baseline.revision + 1);
        expect(pending((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint)).toBe(
          false,
        );
        expect((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.revision).toBe(
          committed.revision,
        );
        if (kind === 'sheet') expect(committed.snapshot.sheets.tab.cellData?.[0]?.[3]?.v).toBe(731);
        else expect(committed.snapshot.body!.dataStream.split(text)).toHaveLength(2);
        await matchesServer(f.page, committed);
        const writes = f.network.outgoing
          .filter((frame) => frame.type === 'submit')
          .slice(captured);
        expect(new Set(writes.map((frame) => frame.mutationId)).size).toBe(1);
        expect(
          f.db
            .prepare('SELECT count(*) AS n FROM spinel_sync_revisions WHERE unit_id=?')
            .get(f.unitId)!.n,
        ).toBe(1);
        await f.network.setOffline(true);
        await f.network.setOffline(false);
        await synced(f.page);
        expect(await f.read()).toEqual(committed);
        await f.page.reload();
        await synced(f.page);
        await matchesServer(f.page, committed);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    });

  test('a crash after durable acknowledgement but before local cleanup retains attention without duplicate replay', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc');
    try {
      await f.download();
      const baseline = await f.read();
      await f.network.setOffline(true);
      await edit(f.page, 'doc', 'Crash survives once 942');
      await savedLocally(f.page);
      await f.page.evaluate(
        ({ itemId, revision }) => {
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
            if (
              this.name === 'items' &&
              value.itemId === itemId &&
              value.outbox?.checkpoint?.revision > revision &&
              !value.outbox.checkpoint.sent &&
              !value.outbox.checkpoint.buffer.length
            ) {
              sessionStorage.setItem('spinel-test-cleanup-aborted', '1');
              this.transaction.abort();
              throw new DOMException(
                'Simulated termination before cleanup committed',
                'AbortError',
              );
            }
            return key === undefined ? put.call(this, value) : put.call(this, value, key);
          };
        },
        { itemId: f.item.id, revision: baseline.revision },
      );
      await f.network.setOffline(false);
      await expect.poll(() => f.network.incoming.some((frame) => frame.type === 'ack')).toBe(true);
      await expect
        .poll(() => f.page.evaluate(() => sessionStorage.getItem('spinel-test-cleanup-aborted')))
        .toBe('1');
      const disk = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
      expect(disk.revision).toBe(baseline.revision);
      expect(disk.sent).not.toBeNull();
      const committed = await f.read();
      expect(committed.revision).toBe(baseline.revision + 1);
      // End the renderer after proving the server accepted the edit and its
      // cleanup transaction did not commit. The next renderer has no fault hook.
      await f.page.close();
      const reopened = await f.context.newPage();
      await reopened.goto(f.href);
      await attention(reopened);
      expect(await copy(reopened, 'doc')).toContain('Crash survives once 942');
      const retained = (await stored(reopened, f.actor.id, f.item.id))!.outbox!.checkpoint;
      expect(retained.sent).toEqual(disk.sent);
      expect(retained.failure).toBe('stale');
      await reopened.reload();
      await attention(reopened);
      expect(await f.read()).toEqual(committed);
      expect(committed.snapshot.body!.dataStream.split('Crash survives once 942')).toHaveLength(2);
      expect(
        f.db
          .prepare('SELECT count(*) AS n FROM spinel_sync_revisions WHERE unit_id=?')
          .get(f.unitId)!.n,
      ).toBe(1);
    } finally {
      await f.close();
    }
  });

  test('a failed local write never claims saved and retry commits it while still offline', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet');
    try {
      await f.download();
      await f.network.setOffline(true);
      await f.page.evaluate((itemId) => {
        const put = IDBObjectStore.prototype.put;
        sessionStorage.setItem('spinel-test-quota', '1');
        IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
          if (
            this.name === 'items' &&
            value.itemId === itemId &&
            value.outbox &&
            sessionStorage.getItem('spinel-test-quota')
          )
            throw new DOMException('Simulated storage quota failure', 'QuotaExceededError');
          return key === undefined ? put.call(this, value) : put.call(this, value, key);
        };
      }, f.item.id);
      await edit(f.page, 'sheet', '593');
      await expect(saveStatus(f.page)).toHaveText(
        'Changes could not be saved on this device. Keep this tab open and retry saving.',
      );
      expect(pending((await stored(f.page, f.actor.id, f.item.id))?.outbox?.checkpoint)).toBe(
        false,
      );
      expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
      await f.page.evaluate(() => sessionStorage.removeItem('spinel-test-quota'));
      await f.page.getByRole('button', { name: 'Save details: Not saved', exact: true }).click();
      await f.page.getByRole('button', { name: 'Retry saving', exact: true }).click();
      await savedLocally(f.page);
      await f.page.keyboard.press('Escape');
      await f.page.reload();
      await savedLocally(f.page);
      expect(await copy(f.page, 'sheet')).toContain('593');
      await f.network.setOffline(false);
      await synced(f.page);
      expect((await f.read()).snapshot.sheets.first.cellData?.[0]?.[3]?.v).toBe(593);
    } finally {
      await f.close();
    }
  });

  test('a viewer download stays read-only without an outbox', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet', { actor: 'viewer' });
    try {
      await f.download();
      const baseline = await f.read();
      await f.network.setOffline(true);
      await f.page.reload();
      await expect(saveStatus(f.page)).toHaveText('View only on this device.', { timeout: 30_000 });
      await expect(f.page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      await selectCell(f.page, 'D1');
      await f.page.keyboard.insertText('Forbidden');
      await f.page.keyboard.press('Enter');
      expect(pending((await stored(f.page, f.actor.id, f.item.id))?.outbox?.checkpoint)).toBe(
        false,
      );
      await f.network.setOffline(false);
      await expect(saveStatus(f.page)).toHaveText('View only on this device.');
      expect(await f.read()).toEqual(baseline);
      expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('another account cookie cannot replay the downloading account outbox or expose it in a new tab', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc');
    try {
      await f.download();
      const baseline = await f.read();
      await f.network.setOffline(true);
      await edit(f.page, 'doc', 'Owner private offline sentence');
      await savedLocally(f.page);
      const original = (await stored(f.page, f.owner.id, f.item.id))!.outbox!;
      // This account also has edit access, so authorization alone cannot stop
      // the wrong account from sending the first account's private queue.
      await f.context.addCookies([f.cookie(f.editor.id)]);
      await f.network.setOffline(false);
      await attention(f.page);
      expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
      expect(await f.read()).toEqual(baseline);
      const other = await f.context.newPage();
      await other.goto(f.href);
      await expect(saveStatus(other)).toHaveText('All changes saved.', { timeout: 30_000 });
      await expect(f.page.locator('.univer-container canvas')).toHaveCount(0);
      const retained = (await stored(other, f.owner.id, f.item.id))!.outbox!;
      expect(retained.account).toBe(f.owner.id);
      expect(retained.checkpoint.buffer).toEqual(original.checkpoint.buffer);
      expect((await f.read()).snapshot.body!.dataStream).not.toContain(
        'Owner private offline sentence',
      );
      expect(await other.evaluate(() => localStorage.getItem('spinel.offline.account'))).not.toBe(
        f.owner.id,
      );
    } finally {
      await f.close();
    }
  });

  test('a native Space child retains exact scope through replay and an explicit unavailable sibling', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc', { space: true, actor: 'editor' });
    try {
      const sibling = f.spaces.createChild(f.owner.id, f.root!.id, {
        name: 'Not downloaded',
        kind: 'doc',
        parentId: f.root!.id,
      }).item;
      await f.download();
      const baseline = await f.read();
      await f.network.setOffline(true);
      await edit(f.page, 'doc', 'Prepared child local edit');
      await savedLocally(f.page);
      await f.page.reload();
      await savedLocally(f.page);
      expect(await copy(f.page, 'doc')).toContain('Prepared child local edit');
      const record = (await stored(f.page, f.actor.id, f.item.id))!.outbox!;
      expect(record).toMatchObject({
        account: f.editor.id,
        spaceId: f.root!.id,
        item: f.item.id,
        unitId: f.unitId,
      });
      await f.page.goto(`/spaces/${f.root!.id}?item=${sibling.id}`);
      await expect(
        f.page.getByRole('status').filter({ hasText: 'This page needs a connection.' }),
      ).toContainText('It has not been prepared in this Space');
      await expect(f.page.locator('.univer-container')).toHaveCount(0);
      await f.page.goto(f.href);
      await savedLocally(f.page);
      await f.network.setOffline(false);
      await synced(f.page);
      const committed = await f.read();
      expect(committed.revision).toBe(baseline.revision + 1);
      expect(committed.snapshot.body!.dataStream.split('Prepared child local edit')).toHaveLength(
        2,
      );
      await matchesServer(f.page, committed);
      expect((await f.control.request.get(`/api/items/${f.item.id}/offline-bundle`)).status()).toBe(
        404,
      );
    } finally {
      await f.close();
    }
  });

  for (const change of ['revoked', 'viewer', 'trashed', 'restored'] as const)
    test(`a prepared Space child with ${change} live access/generation preserves its outbox without replay`, async ({
      browser,
      baseURL,
    }, info) => {
      const f = await fixture(browser, baseURL!, info, 'doc', { space: true, actor: 'editor' });
      try {
        await f.download();
        const baseline = await f.read();
        let checkpointId = '';
        if (change === 'restored') {
          const named = await f.control.request.post(`${f.prefix}/history`, {
            headers: { Origin: baseURL! },
            data: { name: 'Before offline' },
          });
          expect(named.status(), await named.text()).toBe(201);
          checkpointId = (await named.json()).version.id;
        }
        await f.network.setOffline(true);
        await edit(f.page, 'doc', `Keep ${change} offline edit`);
        await savedLocally(f.page);
        const original = (await stored(f.page, f.actor.id, f.item.id))!.outbox!;
        if (change === 'revoked' || change === 'viewer')
          f.spaces.share(
            f.owner.id,
            f.root!.id,
            f.editor.id,
            change === 'revoked' ? null : 'viewer',
          );
        else if (change === 'trashed') {
          const removed = await f.control.request.delete(f.prefix, {
            headers: { Origin: baseURL! },
            data: {},
          });
          expect(removed.status(), await removed.text()).toBe(200);
        } else {
          const restored = await f.control.request.post(
            `${f.prefix}/history/${checkpointId}/restore`,
            { headers: { Origin: baseURL! }, data: { unitId: f.unitId, requestId: randomUUID() } },
          );
          expect(restored.status(), await restored.text()).toBe(200);
        }
        // Restoring deliberately purges the previous server generation. Verify
        // the replacement's durable state, not that an obsolete row survives.
        const activeUnit =
          change === 'restored'
            ? ((await (await f.control.request.get(f.prefix)).json()).live.unitId as string)
            : f.unitId;
        const durableBefore = f.db
          .prepare('SELECT unit_id,revision,snapshot FROM spinel_sync_units WHERE unit_id=?')
          .get(activeUnit);
        await f.network.setOffline(false);
        await attention(f.page);
        expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
        const retained = (await stored(f.page, f.actor.id, f.item.id))!.outbox!;
        expect(retained).toMatchObject({
          account: f.actor.id,
          spaceId: f.root!.id,
          item: f.item.id,
          unitId: f.unitId,
        });
        expect(retained.checkpoint.buffer).toEqual(original.checkpoint.buffer);
        expect(retained.checkpoint.revision).toBe(baseline.revision);
        expect(
          f.db
            .prepare('SELECT unit_id,revision,snapshot FROM spinel_sync_units WHERE unit_id=?')
            .get(activeUnit),
        ).toEqual(durableBefore);
        if (change === 'restored') {
          const metadata = await (await f.control.request.get(f.prefix)).json();
          expect(metadata.live.unitId).not.toBe(f.unitId);
          expect((await f.read(metadata.live.unitId)).snapshot.body!.dataStream).not.toContain(
            `Keep ${change} offline edit`,
          );
        }
      } finally {
        await f.close();
      }
    });
});
