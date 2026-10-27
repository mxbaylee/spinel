import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY, LocaleType } from '@univerjs/core';
import { docFormulas } from '@spinel/doc-formulas';
import type { ClientCheckpoint, NativeSnapshot } from '@spinel/sync-client';
import { SyncServer } from '@spinel/sync-server';
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
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { SQLiteSyncStorage } from '../src/server/sync/store.ts';
import type { OfflineBundle } from '../src/shared/offlineBundle.ts';
import { sheetImageFixture } from './sheet-image-fixture.ts';
import { recordNativeSnapshots } from './sync-snapshot.ts';
import { syncNetwork } from './sync-network.ts';
import type { NativeWrite } from './sync-network.ts';

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

async function usableCanvas(page: Page) {
  await expect
    .poll(
      () =>
        page.locator('.univer-container canvas').evaluateAll((canvases) =>
          // Sheets also renders its short formula-bar input as a canvas. Check
          // the document surface, independent of those auxiliary canvas nodes.
          Math.max(0, ...canvases.map((canvas) => canvas.getBoundingClientRect().height)),
        ),
      {
        message: 'The restored native canvas must have a visible layout height.',
        timeout: 15_000,
      },
    )
    .toBeGreaterThan(100);
}

async function stored(page: Page, accountId: string, itemId: string) {
  return page.evaluate(
    async ({ accountId, itemId }) => {
      const name = `spinel-offline-${accountId}`;
      if (!(await indexedDB.databases()).some((database) => database.name === name)) return;
      return new Promise<Stored | undefined>((resolve, reject) => {
        const opening = indexedDB.open(`spinel-offline-${accountId}`);
        opening.onerror = () => reject(opening.error);
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error('The device database was removed during observation.'));
        };
        opening.onsuccess = () => {
          const database = opening.result;
          if (!database.objectStoreNames.contains('items')) {
            database.close();
            resolve(undefined);
            return;
          }
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
      });
    },
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
  return JSON.parse(
    canonical({
      ...snapshot,
      rev: undefined,
      styles: {},
      sheets,
      // The drawing resource is serialized JSON. Compare its complete graph,
      // including all geometry and anchor fields, independent of object key order.
      resources: snapshot.resources?.map((resource) =>
        resource.name === 'SHEET_DRAWING_PLUGIN'
          ? { ...resource, data: JSON.parse(resource.data) }
          : resource,
      ),
    }),
  );
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
    const snapshot = await sheetImageFixture();
    const resource = snapshot.resources[0];
    const drawings = JSON.parse(resource.data);
    const floating = drawings.tab.data.floating;
    const transformDefaults = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
    // The pinned native renderer derives this rectangle from the existing cell
    // anchors: 46 + 2*100, 20 + 4*24 + 80, one column, and three 24px rows.
    // Seed a consistent imported fixture so strict equality tests sync behavior.
    floating.transform = {
      ...transformDefaults,
      left: 246,
      top: 196,
      width: 100,
      height: 72,
    };
    floating.axisAlignSheetTransform = {
      ...transformDefaults,
      ...floating.axisAlignSheetTransform,
    };
    resource.data = JSON.stringify(drawings);
    const cell = snapshot.sheets.tab.cellData[1][0].p;
    // Native cell images fit the 100x80 cell's 2px inset, preserving 4:3.
    cell.drawings.cell.transform.width = 98;
    cell.drawings.cell.transform.height = 73.5;
    cell.drawings.cell.docTransform.size = { width: 98, height: 73.5 };
    // Native cell-image layout uses an unbounded document page; its exported
    // JSON represents these Infinity values as null, just as this import does.
    cell.documentStyle.pageSize = {
      width: Number.POSITIVE_INFINITY,
      height: Number.POSITIVE_INFINITY,
    };
    const response = await control.request.post('/api/items/import', {
      headers: { Origin: baseURL },
      data: {
        filename: 'Offline images.univer.json',
        parentId: null,
        snapshot,
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
  const consoleErrors: { page: string; message: string }[] = [];
  const observeErrors = (target: Page) => {
    target.on('pageerror', (error) => errors.push(error.message));
    target.on('console', (message) => {
      if (message.type() === 'error')
        consoleErrors.push({ page: target.url(), message: message.text() });
    });
  };
  context.on('page', observeErrors);
  observeErrors(page);
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
        pages.map(async (target) => ({
          ...(await target.evaluate(() => ({
            url: location.href,
            online: navigator.onLine,
            preparedAccount: localStorage.getItem('spinel.offline.account'),
            native: (window as Window & { nativeSyncEvidence?: unknown }).nativeSyncEvidence,
            status: document.querySelector('[aria-label="Save status"]')?.textContent,
            focus: document.activeElement?.outerHTML,
            layout: [
              ...document.querySelectorAll(
                '.editor-content, [aria-label="Offline copy"], .sheet-editor, .univer-container',
              ),
            ].map((node) => ({
              element: node.tagName,
              className: node.className,
              label: node.getAttribute('aria-label'),
              bounds: node.getBoundingClientRect().toJSON(),
              canvases: node.querySelectorAll('canvas').length,
            })),
          }))),
          stored: await stored(target, actor.id, item.id).catch((error) => ({
            error: String(error),
          })),
        })),
      );
      // The CI artifact glob retains this filename on both success and failure.
      // Attachments alone were absent from the archived browser diagnostics.
      await writeFile(
        info.outputPath('sync-diagnostics.json'),
        JSON.stringify(
          {
            observed,
            errors,
            consoleErrors,
            outgoing: network.outgoing,
            incoming: network.incoming,
          },
          null,
          2,
        ),
      );
      for (const context of contexts) await context.close();
      db.close();
    },
  };
}

test.describe('downloaded native editors', () => {
  test.setTimeout(180_000);

  test('last-copy removal waits for its editor to close and preserves another live editor with pending input', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet');
    try {
      await f.download();
      const before = await f.read();
      const other = f.workspace.create(f.owner.id, {
        name: 'Undownloaded live Doc',
        kind: 'doc',
        parentId: null,
      });
      const prepared = await f.control.request.post(`/api/items/${other.id}/collaboration`, {
        headers: { Origin: baseURL! },
        data: {},
      });
      expect(prepared.status(), await prepared.text()).toBe(200);
      const otherUnitId = (await prepared.json()).unitId as string;
      const readOther = async () => {
        const response = await f.control.request.get(
          `/sync-api/items/${other.id}/snapshot?unitId=${encodeURIComponent(otherUnitId)}`,
        );
        expect(response.status(), await response.text()).toBe(200);
        return (await response.json()) as { revision: number; snapshot: IDocumentData };
      };
      const otherPage = await f.context.newPage();
      await otherPage.goto(`/?item=${other.id}`);
      await expect(saveStatus(otherPage)).toHaveText('All changes saved.', { timeout: 30_000 });
      const otherBefore = await readOther();
      const otherCanvas = await otherPage
        .locator('.univer-container canvas')
        .first()
        .elementHandle();
      const held: NativeWrite[] = [];
      f.network.interceptWrites((write) => {
        held.push(write);
      });
      const text = 'Pending in another editor 628';
      await edit(otherPage, 'doc', text);
      await expect.poll(() => held.length).toBeGreaterThan(0);
      await expect(saveStatus(otherPage)).not.toHaveText('All changes saved.');

      const canvas = await f.page.locator('.univer-container canvas').first().elementHandle();
      await f.page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Remove from device', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Offline availability', exact: true });
      await expect(dialog.getByRole('alert')).toHaveText(
        'Close this document in every tab before removing its device copy.',
      );
      expect(
        await f.page
          .locator('.univer-container canvas')
          .first()
          .evaluate((node, original) => node === original, canvas!),
      ).toBe(true);
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
      await f.page
        .getByRole('button', { name: `More actions for ${f.item.name}`, exact: true })
        .click();
      await f.page.getByRole('menuitem', { name: 'Remove from device', exact: true }).click();
      await expect(
        f.page.getByRole('status').filter({ hasText: `${f.item.name} was removed` }),
      ).toHaveText(`${f.item.name} was removed from this device.`);
      expect(
        await f.page.evaluate(() => localStorage.getItem('spinel.offline.account')),
      ).toBeNull();
      expect(await stored(f.page, f.actor.id, f.item.id)).toBeUndefined();
      // Starting another same-account tab after the last removal must not
      // rotate the account cancellation token under a live pending editor.
      const thirdPage = await f.context.newPage();
      await thirdPage.goto('/');
      await expect(
        thirdPage.getByRole('button', { name: `More actions for ${other.name}`, exact: true }),
      ).toBeVisible();
      expect(
        await otherPage
          .locator('.univer-container canvas')
          .first()
          .evaluate((node, original) => node === original, otherCanvas!),
      ).toBe(true);
      expect(await copy(otherPage, 'doc')).toContain(text);
      expect(await readOther()).toEqual(otherBefore);
      await f.network.drainWrites();
      f.network.interceptWrites(undefined);
      for (const write of held) expect(write.forward()).toBe(true);
      await expect(saveStatus(otherPage)).toHaveText('All changes saved.', { timeout: 30_000 });
      const otherCommitted = await readOther();
      expect(otherCommitted.revision).toBe(otherBefore.revision + 1);
      expect(otherCommitted.snapshot.body!.dataStream.split(text)).toHaveLength(2);
      await matchesServer(otherPage, otherCommitted);
      await f.page.goto(f.href);
      await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await edit(f.page, 'sheet', '753');
      await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await expect.poll(async () => (await f.read()).revision).toBe(before.revision + 1);
      const committed = await f.read();
      const firstSheet = committed.snapshot.sheetOrder[0];
      expect(committed.snapshot.sheets[firstSheet].cellData?.[0]?.[3]?.v).toBe(753);
      await matchesServer(f.page, committed);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('editing IMAGE formulas offline makes no external image request while normal formulas still calculate', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet');
    const requests: string[] = [];
    f.context.on('request', (request) => {
      if (new URL(request.url()).hostname === 'tracker.invalid') requests.push(request.url());
    });
    try {
      await f.download();
      const baseline = await f.read();
      await f.network.setOffline(true);
      await edit(f.page, 'sheet', 'Offline before IMAGE', 'D1');
      await savedLocally(f.page);
      const formula = `=IMAGE("https://tracker.invalid/offline-${randomUUID()}.png")`;
      await edit(f.page, 'sheet', formula, 'E1');
      await savedLocally(f.page);
      // A later ordinary calculation proves the native calculation pipeline
      // ran after the image edit. Only derived external image loading is blocked.
      await edit(f.page, 'sheet', '=1+2', 'F1');
      await savedLocally(f.page);
      await expect.poll(async () => (await copy(f.page, 'sheet', 'F1')).trim()).toBe('3');
      const checkpoint = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
      expect(
        checkpoint.buffer
          .flat()
          .some(
            (mutation) =>
              mutation.id === 'sheet.mutation.set-range-values' &&
              mutation.params.cellValue?.[0]?.[4]?.f === formula,
          ),
      ).toBe(true);
      expect(requests).toEqual([]);
      await f.page.reload();
      await savedLocally(f.page);
      await expect.poll(async () => (await copy(f.page, 'sheet', 'F1')).trim()).toBe('3');
      expect(requests).toEqual([]);
      expect(await f.read()).toEqual(baseline);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('a clean downloaded editor refreshes after more than 128 durable revisions and accepts the next edit', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet');
    const store = new SQLiteSyncStorage(f.auth);
    // Another writer commits through the actual native engine and SQLite
    // retention adapter while this browser is offline, without UI debug writes.
    const writer = new SyncServer(store, { authorize() {} });
    try {
      await f.download();
      const baseline = await f.read();
      const firstSheet = baseline.snapshot.sheetOrder[0];
      await f.network.setOffline(true);
      for (let index = 1; index <= 129; index++)
        await writer.submit(
          {
            unitId: f.unitId,
            actorId: f.owner.id,
            mutationId: `offline-retention-${index}`,
            baseRevision: baseline.revision + index - 1,
            mutations: [
              {
                id: 'sheet.mutation.set-range-values',
                params: {
                  unitId: f.unitId,
                  subUnitId: firstSheet,
                  cellValue: { 0: { 0: { v: index } } },
                },
              },
            ],
          },
          undefined,
        );
      expect(store.load(f.unitId)!.retainedFrom).toBeGreaterThan(baseline.revision);
      const advanced = await f.read();
      expect(advanced.revision).toBe(baseline.revision + 129);
      expect(pending((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint)).toBe(
        false,
      );
      await f.network.setOffline(false);
      await synced(f.page);
      await matchesServer(f.page, advanced);
      const refreshed = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
      expect(refreshed.revision).toBe(advanced.revision);
      expect(pending(refreshed)).toBe(false);
      await edit(f.page, 'sheet', '624');
      await synced(f.page);
      const committed = await f.read();
      expect(committed.revision).toBe(advanced.revision + 1);
      expect(committed.snapshot.sheets[firstSheet].cellData?.[0]?.[3]?.v).toBe(624);
      await matchesServer(f.page, committed);
      expect(f.errors).toEqual([]);
    } finally {
      await writer.close();
      await f.close();
    }
  });

  for (const kind of ['sheet', 'doc'] as const)
    test(`${kind}: durable edits survive two offline reloads and reconnect exactly once`, async ({
      browser,
      baseURL,
    }, info) => {
      const f = await fixture(browser, baseURL!, info, kind, { images: kind === 'sheet' });
      try {
        await f.download();
        const baseline = await f.read();
        if (kind === 'sheet') await matchesServer(f.page, baseline);
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
          await usableCanvas(f.page);
          await savedLocally(f.page);
          expect(await copy(f.page, kind)).toContain(text);
          await f.page.screenshot({
            path: info.outputPath(`spn-053-offline-${kind}-reload-${reload + 1}.png`),
            animations: 'disabled',
          });
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

  test('Doc Formula definitions survive offline edits and reloads while reconnect rechecks source access', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc');
    try {
      const source = f.workspace.create(f.editor.id, {
        name: 'OfflineInputs',
        kind: 'sheet',
        parentId: null,
      });
      const secret = 784512309;
      new SheetStore(f.workspace).save(f.editor.id, source.id, {
        revision: 0,
        writeId: randomUUID(),
        snapshot: {
          id: source.id,
          name: source.name,
          appVersion: '1.1.0',
          locale: LocaleType.EN_US,
          styles: {},
          sheetOrder: ['summary'],
          sheets: {
            summary: {
              id: 'summary',
              name: 'Summary',
              rowCount: 100,
              columnCount: 10,
              cellData: { 0: { 0: { v: secret } } },
            },
          },
        },
      });
      f.workspace.share(f.editor.id, source.id, f.owner.id, 'viewer');
      await f.page.goto(f.href);
      await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await edit(f.page, 'doc', 'Formula context');
      await f.page.keyboard.press('Control+End');
      await f.page.keyboard.press('Enter');
      await expect
        .poll(async () => (await f.read()).snapshot.body?.dataStream)
        .toContain('Formula context\r');
      await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await f.page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Insert formula', exact: true }).click();
      const insert = f.page.getByRole('dialog', { name: 'Insert formula', exact: true });
      await insert.getByLabel('Formula', { exact: true }).fill('=OfflineInputs.Summary.A1');
      await insert.getByRole('button', { name: 'Insert formula', exact: true }).click();
      await expect(insert).not.toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => docFormulas((await f.read()).snapshot.body).length).toBe(1);
      await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await f.download();
      const baseline = await f.read();
      const definitions = docFormulas(baseline.snapshot.body).map((formula) => formula.definition);
      expect(definitions).toHaveLength(1);
      const openPanel = async () => {
        const panel = f.page.getByRole('dialog', { name: 'Formulas', exact: true });
        if (!(await panel.isVisible())) {
          const localButton = f.page.getByRole('button', { name: 'Formulas', exact: true });
          if (await localButton.count()) await localButton.click();
          else {
            await f.page.getByRole('button', { name: 'Document actions', exact: true }).click();
            await f.page.getByRole('menuitem', { name: 'Formulas', exact: true }).click();
          }
        }
        return panel;
      };
      let panel = await openPanel();
      await expect(panel.getByText(String(secret), { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await f.network.setOffline(true);
      const text = 'Offline Formula note 605 ';
      await edit(f.page, 'doc', text);
      await savedLocally(f.page);
      for (let reload = 0; reload < 2; reload++) {
        await f.page.reload();
        await usableCanvas(f.page);
        await savedLocally(f.page);
        expect(await copy(f.page, 'doc')).toContain(text);
        panel = await openPanel();
        await expect(panel.getByText('Result unavailable', { exact: true })).toBeVisible();
        await expect(panel.getByText(String(secret), { exact: true })).toHaveCount(0);
        expect(JSON.stringify(await stored(f.page, f.actor.id, f.item.id))).not.toContain(
          String(secret),
        );
        await f.page.screenshot({
          path: info.outputPath(`spn-053-offline-formulas-reload-${reload + 1}.png`),
          animations: 'disabled',
        });
        await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
      }
      f.workspace.share(f.editor.id, source.id, f.owner.id, null);
      await f.network.setOffline(false);
      await synced(f.page);
      const committed = await f.read();
      expect(committed.revision).toBe(baseline.revision + 1);
      expect(docFormulas(committed.snapshot.body).map((formula) => formula.definition)).toEqual(
        definitions,
      );
      await matchesServer(f.page, committed);
      panel = await openPanel();
      await expect(
        panel.getByText('You need access to this formula’s sources', { exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(panel.getByText(String(secret), { exact: true })).toHaveCount(0);
      f.workspace.share(f.editor.id, source.id, f.owner.id, 'viewer');
      await expect(panel.getByText(String(secret), { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      expect(JSON.stringify(await stored(f.page, f.actor.id, f.item.id))).not.toContain(
        String(secret),
      );
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

  test('a cold offline editor retains its expired cross-sheet draft through unrelated storage events', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet');
    try {
      await f.download();
      const sheet = f.page.getByRole('region', { name: 'Sheet document', exact: true });
      // A Sheet has both a cell editor and a formula-bar editor. This scenario
      // must focus the actual cell draft, including after a cross-sheet switch.
      const cellInput = f.page.locator(
        `[id="__editor_${DOCS_NORMAL_EDITOR_UNIT_ID_KEY}"][contenteditable="true"][data-u-comp="editor"]`,
      );
      await sheet.locator('[data-u-comp="sheet-bar-append-button"]').first().click();
      await expect(sheet.getByRole('tablist', { name: 'Sheet tabs' }).getByRole('tab')).toHaveCount(
        2,
      );
      await synced(f.page);
      const baseline = await f.read();
      const [first, second] = baseline.snapshot.sheetOrder.map(
        (id) => baseline.snapshot.sheets[id]!,
      );
      await sheet.getByRole('tab', { name: first.name, exact: true }).click();
      await f.network.setOffline(true);
      await f.page.reload();
      await usableCanvas(f.page);
      await savedLocally(f.page);
      await sheet.getByRole('tab', { name: first.name, exact: true }).click();
      await edit(f.page, 'sheet', '730', 'E1');
      await savedLocally(f.page);
      const retained = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
      const submitted = f.network.outgoing.filter((frame) => frame.type === 'submit').length;
      await selectCell(f.page, 'D1');
      await f.page.keyboard.insertText('=SUM(');
      await sheet.getByRole('tab', { name: second.name, exact: true }).click();
      await expect(sheet.getByRole('tab', { name: second.name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await cellInput.focus();
      await expect(cellInput).toBeFocused();
      await f.page.keyboard.insertText('A1)');
      const copyDraft = async () => {
        const sentinel = `not-copied-${randomUUID()}`;
        await f.page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
        await cellInput.focus();
        await f.page.keyboard.press('Control+a');
        await f.page.keyboard.press('Control+c');
        await expect
          .poll(() => f.page.evaluate(() => navigator.clipboard.readText()))
          .not.toBe(sentinel);
        return f.page.evaluate(() => navigator.clipboard.readText());
      };
      const draft = await copyDraft();
      expect(draft).toContain('=SUM(');
      await f.page.keyboard.press('End');
      const cookie = (await f.context.cookies()).find((entry) => entry.name === COOKIE_NAME)!;
      f.auth.revokeSession(f.auth.session(cookie.value)!.token_hash);
      await f.network.setOffline(false);
      const warning = 'Your sign-in ended. Copy the unfinished cell text before signing in again.';
      await expect(saveStatus(f.page)).toHaveText(warning);
      await expect
        .poll(() => f.page.evaluate(() => localStorage.getItem('spinel.offline.account')))
        .toBeNull();
      const other = await f.context.newPage();
      await other.goto('/sign-in');
      await expect(other.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
      await f.page.evaluate(() => {
        const changed = (event: StorageEvent) => {
          if (event.key !== 'spinel-test-benign-preference') return;
          window.removeEventListener('storage', changed);
          document.documentElement.setAttribute('data-spinel-storage-observed', 'true');
        };
        window.addEventListener('storage', changed);
      });
      await other.evaluate(() => localStorage.setItem('spinel-test-benign-preference', 'dark'));
      await expect(f.page.locator('html')).toHaveAttribute('data-spinel-storage-observed', 'true');
      await other.close();
      // Confirming while on the other sheet must not hide and then lose the
      // original draft when native sheet activation completes asynchronously.
      await cellInput.focus();
      await f.page.keyboard.press('Enter');
      await expect(saveStatus(f.page)).toHaveText(warning);
      expect(await copyDraft()).toBe(draft);
      expect((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.buffer).toEqual(
        retained.buffer,
      );
      expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toHaveLength(submitted);
      expect(await f.read()).toEqual(baseline);
      await f.page.screenshot({
        path: info.outputPath('spn-053-offline-expired-cell-input.png'),
        animations: 'disabled',
      });
      await f.network.setOffline(true);
      const blocked = await f.context.newPage();
      await blocked.goto(f.href);
      await expect(
        blocked.getByRole('heading', { name: "You're offline", exact: true }),
      ).toBeVisible();
      await expect(blocked.locator('.univer-container canvas')).toHaveCount(0);
      await blocked.close();
      await f.network.setOffline(false);
      // After copying, Escape explicitly discards only the unfinished draft.
      // The earlier durable queue remains and can finish the sign-in handoff.
      await cellInput.focus();
      await f.page.keyboard.press('Escape');
      await f.page.getByRole('button', { name: /^Save details:/ }).click();
      await f.page.getByRole('button', { name: 'Continue to sign-in', exact: true }).click();
      await expect(f.page).toHaveURL(/\/sign-in(?:\?|$)/);
      expect(pending((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint)).toBe(true);
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
      await usableCanvas(f.page);
      await savedLocally(f.page);
      expect(await copy(f.page, 'doc')).toContain('Prepared child local edit');
      await f.page.screenshot({
        path: info.outputPath('spn-053-offline-space-doc-reload.png'),
        animations: 'disabled',
      });
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
