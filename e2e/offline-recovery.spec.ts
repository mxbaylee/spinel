import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { docFormulas } from '@spinel/doc-formulas';
import type { NativeSnapshot } from '@spinel/sync-client';
import sharp from 'sharp';
import { AdminStore } from '../src/server/auth/admin.ts';
import { InvitationService } from '../src/server/auth/invitations.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { mapNativeImageSources } from '../src/shared/nativeImageSources.ts';
import {
  attention,
  copy,
  edit,
  fixture,
  pending,
  offlineSheetImages,
  savedLocally,
  saveStatus,
  stored,
  usableCanvas,
} from './offline-fixture.ts';
import type { Kind, OfflineFixture } from './offline-fixture.ts';

type Change = 'concurrent' | 'restored' | 'trashed' | 'revoked' | 'viewer';
const endpoint = '**/api/items/offline-recovery';
const offlineText = (kind: Kind) => (kind === 'sheet' ? '731' : 'Offline version 731 ');

async function details(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Save details', exact: true });
  if (!(await dialog.isVisible()))
    await page.getByRole('button', { name: /^Save details:/ }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

function receipts(f: OfflineFixture) {
  return f.db
    .prepare('SELECT * FROM workspace_offline_recoveries WHERE user_id=? ORDER BY recovery_id')
    .all(f.actor.id);
}

/** Inspect all original durable state, including scope, instead of just its visible text. */
function originalState(f: OfflineFixture, unitId: string) {
  return {
    item: f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(f.item.id),
    unit: f.db
      .prepare('SELECT unit_id,revision,snapshot FROM spinel_sync_units WHERE unit_id=?')
      .get(unitId),
    images: f.db
      .prepare('SELECT id,mime,hex(data) AS bytes FROM doc_images WHERE item_id=? ORDER BY id')
      .all(f.item.id),
  };
}

async function recovered(f: OfflineFixture, page = f.page) {
  await expect(page.getByRole('button', { name: 'Save details: Needs attention', exact: true })).toBeVisible({ timeout: 30_000 });
  const dialog = await details(page);
  const link = dialog.getByRole('link', { name: 'Open copy', exact: true });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const href = (await link.getAttribute('href'))!;
  const id = new URL(href, 'https://spinel.test').searchParams.get('item')!;
  expect(id).toMatch(/^[a-f\d-]{36}$/);
  expect(id).not.toBe(f.item.id);
  expect(href).toBe(`/?item=${id}`);
  await expect(dialog.getByRole('link', { name: 'Open original', exact: true })).toHaveAttribute(
    'href',
    f.href,
  );
  const item = f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(id)!;
  expect(item).toMatchObject({ owner_id: f.actor.id, parent_id: null, space_id: null });
  expect(String(item.name)).toMatch(new RegExp(`^${f.item.name} \\(offline copy, .+\\)$`));
  await expect.poll(async () => stored(page, f.actor.id, f.item.id)).toBeUndefined();
  expect(receipts(f)).toHaveLength(1);
  expect(receipts(f)[0].item_id).toBe(id);
  return { id, href, name: String(item.name) };
}

async function copySnapshot(f: OfflineFixture, id: string, baseURL: string) {
  const prepared = await f.context.request.post(`/api/items/${id}/collaboration`, {
    headers: { Origin: baseURL },
    data: {},
  });
  expect(prepared.status(), await prepared.text()).toBe(200);
  const unitId = (await prepared.json()).unitId as string;
  const response = await f.context.request.get(
    `/sync-api/items/${id}/snapshot?unitId=${encodeURIComponent(unitId)}`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).snapshot as NativeSnapshot;
}

function expectOfflineContent(snapshot: NativeSnapshot, baseline: NativeSnapshot, kind: Kind) {
  if (kind === 'sheet') {
    const book = snapshot as IWorkbookData;
    const before = baseline as IWorkbookData;
    expect(book.sheetOrder).toEqual(before.sheetOrder);
    const sheet = book.sheets[book.sheetOrder[0]];
    expect(sheet.cellData?.[0]?.[3]?.v).toBe(731);
    expect(sheet.cellData?.[0]?.[3]?.v).not.toBe(824);
    // The only authored change was D1: other cell content must survive exactly.
    const unchanged = structuredClone(sheet.cellData ?? {});
    delete unchanged[0]?.[3];
    if (unchanged[0] && !Object.keys(unchanged[0]).length) delete unchanged[0];
    expect(unchanged).toEqual(before.sheets[before.sheetOrder[0]].cellData ?? {});
  } else {
    expect((snapshot as IDocumentData).body?.dataStream).toBe(
      offlineText(kind) + (baseline as IDocumentData).body!.dataStream,
    );
  }
}

async function version(f: OfflineFixture, baseURL: string) {
  const named = await f.control.request.post(`${f.prefix}/history`, {
    headers: { Origin: baseURL },
    data: { name: 'Before offline recovery' },
  });
  expect(named.status(), await named.text()).toBe(201);
  return (await named.json()).version.id as string;
}

async function changeLive(
  f: OfflineFixture,
  kind: Kind,
  change: Change,
  baseURL: string,
  versionId?: string,
) {
  if (change === 'revoked' || change === 'viewer') {
    const role = change === 'revoked' ? null : 'viewer';
    if (f.root) f.spaces.share(f.owner.id, f.root.id, f.editor.id, role);
    else f.workspace.share(f.owner.id, f.item.id, f.editor.id, role);
  } else if (change === 'trashed') {
    const response = await f.control.request.delete(f.prefix, {
      headers: { Origin: baseURL },
      data: {},
    });
    expect(response.status(), await response.text()).toBe(200);
  } else if (change === 'restored') {
    const response = await f.control.request.post(`${f.prefix}/history/${versionId}/restore`, {
      headers: { Origin: baseURL },
      data: { unitId: f.unitId, requestId: randomUUID() },
    });
    expect(response.status(), await response.text()).toBe(200);
    return ((await (await f.control.request.get(f.prefix)).json()).live.unitId) as string;
  } else {
    // Use a second genuine native editor for the divergent live edit. This
    // exercises both the user input and the server's normal mutation path.
    const live = await f.control.newPage();
    try {
      const before = await f.read();
      await live.goto(f.href);
      await expect(saveStatus(live)).toHaveText('All changes saved.', { timeout: 30_000 });
      await edit(live, kind, kind === 'sheet' ? '824' : 'Live version 824 ');
      await expect.poll(async () => (await f.read()).revision).toBeGreaterThan(before.revision);
      await expect(saveStatus(live)).toHaveText('All changes saved.', { timeout: 30_000 });
    } finally {
      await live.close();
    }
  }
  return f.unitId;
}

async function localEdit(f: OfflineFixture, kind: Kind) {
  await f.network.setOffline(true);
  await edit(f.page, kind, offlineText(kind));
  await expect.poll(async () => pending((await stored(f.page, f.actor.id, f.item.id))?.outbox?.checkpoint)).toBe(true);
  await savedLocally(f.page);
  await f.page.reload();
  await usableCanvas(f.page);
  await savedLocally(f.page);
  expect(await copy(f.page, kind)).toContain(offlineText(kind).trim());
  expect(pending((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint)).toBe(true);
}

async function capture(page: Page, info: TestInfo, state: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width] of [
    ['light', 1440],
    ['dark', 1440],
    ['light', 390],
  ] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await details(page);
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-054-${state}-${theme}-${width}-${info.project.name}.png`,
      animations: 'disabled',
    });
  }
}

async function docImageSnapshot() {
  const id = 'offline-image-doc';
  const drawing = async (color: string, subUnitId = id) => ({
    unitId: id,
    subUnitId,
    drawingId: 'picture',
    drawingType: 0,
    imageSourceType: 'BASE64',
    source: `data:image/png;base64,${(
      await sharp({ create: { width: 80, height: 60, channels: 3, background: color } })
        .png()
        .toBuffer()
    ).toString('base64')}`,
    layoutType: 0,
    transform: { left: 0, top: 0, width: 80, height: 60, angle: 0, flipX: false, flipY: false },
    docTransform: {
      size: { width: 80, height: 60 },
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 0, posOffset: 0 },
      angle: 0,
    },
  });
  const body = await drawing('#7700cc');
  const header = await drawing('#00aacc', 'header');
  const footer = await drawing('#cc0077', 'footer');
  return {
    ...getDocsEmptySnapshot(id),
    title: 'Recovery images',
    body: {
      dataStream: '\bRecovery base notes\r\n',
      paragraphs: [{ startIndex: 20 }],
      customBlocks: [{ startIndex: 0, blockId: 'picture' }],
    },
    drawingsOrder: ['picture'],
    drawings: { picture: body },
    headers: {
      header: {
        headerId: 'header',
        body: { dataStream: '\r\n', paragraphs: [{ startIndex: 0 }] },
        drawings: { picture: header },
      },
    },
    footers: {
      footer: {
        footerId: 'footer',
        body: { dataStream: '\r\n', paragraphs: [{ startIndex: 0 }] },
        drawings: { picture: footer },
      },
    },
    resources: [
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({ data: { picture: body }, order: ['picture'] }),
      },
    ],
  } as unknown as IDocumentData;
}

test.describe('offline recovery copies', () => {
  test.setTimeout(180_000);

  for (const space of [false, true])
    for (const kind of ['sheet', 'doc'] as const)
      for (const change of ['concurrent', 'restored', 'trashed', 'revoked', 'viewer'] as const)
        test(`${space ? 'Space child' : 'ordinary'} ${kind}: ${change} live document yields one owned copy and leaves original untouched`, async ({
          browser,
          baseURL,
        }, info) => {
          const f = await fixture(browser, baseURL!, info, kind, { space, actor: 'editor' });
          try {
            await f.download();
            const baseline = await f.read();
            const checkpointId = change === 'restored' ? await version(f, baseURL!) : undefined;
            await localEdit(f, kind);
            const activeUnit = await changeLive(f, kind, change, baseURL!, checkpointId);
            const before = originalState(f, activeUnit);
            await f.network.setOffline(false);
            const result = await recovered(f);
            const snapshot = await copySnapshot(f, result.id, baseURL!);
            expectOfflineContent(snapshot, baseline.snapshot, kind);
            expect(originalState(f, activeUnit)).toEqual(before);
            expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
            // The two links are destinations, not a request to merge versions.
            if (change === 'concurrent' && !space && kind === 'doc')
              await capture(f.page, info, 'copy-created');
            await f.network.setOffline(true);
            await f.network.setOffline(false);
            await expect(
              (await details(f.page)).getByRole('link', { name: 'Open copy', exact: true }),
            ).toHaveAttribute('href', result.href);
            expect(receipts(f)).toHaveLength(1);
            expect(originalState(f, activeUnit)).toEqual(before);
            // Open the actual new account file and compare its native visible
            // content too; its original Space route must not leak into the copy.
            await f.page.goto(result.href);
            await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
            expect(await copy(f.page, kind)).toContain(offlineText(kind).trim());
            expect(receipts(f)).toHaveLength(1);
            expect(f.errors).toEqual([]);
          } finally {
            await f.close();
          }
        });

  for (const kind of ['sheet', 'doc'] as const)
    test(`${kind}: blocked copy exports the complete local version and requires explicit discard`, async ({
      browser,
      baseURL,
    }, info) => {
      const f = await fixture(browser, baseURL!, info, kind, { actor: 'editor' });
      try {
        await f.download();
        const baseline = await f.read();
        await localEdit(f, kind);
        await changeLive(f, kind, 'revoked', baseURL!);
        const before = originalState(f, f.unitId);
        let attempts = 0;
        await f.context.route(endpoint, (route) => {
          attempts++;
          return route.fulfill({ status: 403, json: { error: 'A recovery copy cannot be created.' } });
        });
        await f.network.setOffline(false);
        await expect.poll(() => attempts).toBeGreaterThan(0);
        await attention(f.page);
        let panel = await details(f.page);
        await expect(panel.getByRole('button', { name: 'Export as Univer file', exact: true })).toBeEnabled();
        const retained = await stored(f.page, f.actor.id, f.item.id);
        expect(pending(retained!.outbox!.checkpoint)).toBe(true);
        expect(receipts(f)).toEqual([]);
        const downloading = f.page.waitForEvent('download');
        await panel.getByRole('button', { name: 'Export as Univer file', exact: true }).click();
        const download = await downloading;
        expect(await download.failure()).toBeNull();
        expect(download.suggestedFilename()).toMatch(/\.univer\.json$/);
        const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as NativeSnapshot;
        expectOfflineContent(exported, baseline.snapshot, kind);
        expect((await stored(f.page, f.actor.id, f.item.id))!.outbox).toEqual(retained!.outbox);
        if (kind === 'sheet') await capture(f.page, info, 'export-fallback');
        panel = await details(f.page);
        await panel.getByRole('button', { name: 'Discard offline changes…', exact: true }).click();
        await panel.getByRole('button', { name: 'Keep changes', exact: true }).click();
        expect((await stored(f.page, f.actor.id, f.item.id))!.outbox).toEqual(retained!.outbox);
        await panel.getByRole('button', { name: 'Discard offline changes…', exact: true }).click();
        await panel.getByRole('button', { name: 'Discard offline changes', exact: true }).click();
        await expect.poll(() => stored(f.page, f.actor.id, f.item.id)).toBeUndefined();
        expect(receipts(f)).toEqual([]);
        expect(originalState(f, f.unitId)).toEqual(before);
        expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
      } finally {
        await f.close();
      }
    });

  test('lost recovery response and reload reuse the same stored request and one durable copy', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc', { actor: 'editor' });
    try {
      await f.download();
      await localEdit(f, 'doc');
      await changeLive(f, 'doc', 'concurrent', baseURL!);
      const before = originalState(f, f.unitId);
      const requests: unknown[] = [];
      let loseResponse = true;
      await f.context.route(endpoint, async (route) => {
        requests.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(201);
        if (loseResponse) await route.abort('failed');
        else await route.fulfill({ response });
      });
      await f.network.setOffline(false);
      await expect.poll(() => receipts(f).length).toBe(1);
      await expect.poll(() => requests.length).toBeGreaterThan(0);
      await expect(
        (await details(f.page)).getByRole('button', { name: 'Retry creating copy', exact: true }),
      ).toBeEnabled();
      const retained = (await stored(f.page, f.actor.id, f.item.id))!;
      expect(retained.recovery).toEqual(requests[0]);
      expect(pending(retained.outbox!.checkpoint)).toBe(true);
      const copyId = receipts(f)[0].item_id;
      loseResponse = false;
      await f.page.reload();
      const result = await recovered(f);
      expect(result.id).toBe(copyId);
      expect(requests.length).toBeGreaterThanOrEqual(2);
      for (const request of requests) expect(request).toEqual(requests[0]);
      expect(originalState(f, f.unitId)).toEqual(before);
      expect(receipts(f)).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  test('failed local recovery cleanup keeps the outbox and retry finishes the same copy', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet', { actor: 'editor' });
    try {
      await f.download();
      await localEdit(f, 'sheet');
      await changeLive(f, 'sheet', 'concurrent', baseURL!);
      const before = originalState(f, f.unitId);
      await f.page.evaluate((id) => {
        const remove = IDBObjectStore.prototype.delete;
        sessionStorage.setItem('spinel-test-recovery-cleanup', 'fail');
        IDBObjectStore.prototype.delete = function (key: IDBValidKey | IDBKeyRange) {
          if (this.name === 'items' && key === id && sessionStorage.getItem('spinel-test-recovery-cleanup') === 'fail') {
            this.transaction.abort();
            throw new DOMException('Simulated recovery cleanup failure', 'AbortError');
          }
          return remove.call(this, key);
        };
      }, f.item.id);
      await f.network.setOffline(false);
      await expect.poll(() => receipts(f).length).toBe(1);
      const panel = await details(f.page);
      await expect(panel.getByRole('button', { name: 'Retry creating copy', exact: true })).toBeEnabled();
      expect(pending((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint)).toBe(true);
      const copyId = receipts(f)[0].item_id;
      await f.page.evaluate(() => sessionStorage.removeItem('spinel-test-recovery-cleanup'));
      await panel.getByRole('button', { name: 'Retry creating copy', exact: true }).click();
      expect((await recovered(f)).id).toBe(copyId);
      expect(receipts(f)).toHaveLength(1);
      expect(originalState(f, f.unitId)).toEqual(before);
    } finally {
      await f.close();
    }
  });

  test('a disabled account retains local export while remote recovery is unavailable', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc', { actor: 'editor' });
    try {
      await f.download();
      const baseline = await f.read();
      await localEdit(f, 'doc');
      const admin = f.auth.createUser(`Recovery operator ${info.testId}`, true);
      new AdminStore(f.auth, new InvitationService(f.auth, baseURL!)).disable(admin.id, f.actor.id);
      await f.network.setOffline(false);
      const panel = await details(f.page);
      await expect(panel.getByRole('button', { name: 'Export as Univer file', exact: true })).toBeEnabled({ timeout: 30_000 });
      await expect(f.page).toHaveURL(new URL(f.href, baseURL!).href);
      await expect(panel.getByRole('button', { name: 'Continue to sign-in', exact: true })).toBeVisible();
      const downloading = f.page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Export as Univer file', exact: true }).click();
      const download = await downloading;
      const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as NativeSnapshot;
      expectOfflineContent(exported, baseline.snapshot, 'doc');
      expect(pending((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint)).toBe(true);
      expect(receipts(f)).toEqual([]);
      expect(await f.read()).toEqual(baseline);
    } finally {
      await f.close();
    }
  });

  for (const kind of ['sheet', 'doc'] as const)
    test(`Space ${kind}: recovery keeps every local image in the new account-owned scope after root revocation`, async ({
      browser,
      baseURL,
    }, info) => {
      const seed = JSON.parse(
        JSON.stringify(kind === 'sheet' ? await offlineSheetImages() : await docImageSnapshot()),
      ) as NativeSnapshot;
      const f = await fixture(browser, baseURL!, info, kind, {
        space: true,
        actor: 'editor',
        seed,
      });
      try {
        await f.download();
        const before = await f.read();
        const imageRows = f.db
          .prepare('SELECT id,mime,hex(data) AS bytes FROM doc_images WHERE item_id=? ORDER BY id')
          .all(f.item.id);
        expect(imageRows).toHaveLength(3);
        await localEdit(f, kind);
        f.spaces.share(f.owner.id, f.root!.id, f.editor.id, null);
        const original = originalState(f, f.unitId);
        await f.network.setOffline(false);
        const result = await recovered(f);
        const snapshot = await copySnapshot(f, result.id, baseURL!);
        expectOfflineContent(snapshot, before.snapshot, kind);
        const sources = new Set<string>();
        mapNativeImageSources(snapshot, (source) => {
          sources.add(source);
          return source;
        });
        expect(sources.size).toBe(3);
        for (const source of sources) {
          expect(source).toMatch(new RegExp(`^/api/items/${result.id}/images/[a-f\\d]{64}$`));
          expect((await f.context.request.get(source)).status()).toBe(200);
          expect((await f.context.request.get(source.replace(result.id, f.item.id))).status()).toBe(404);
        }
        expect(
          f.db
            .prepare('SELECT id,mime,hex(data) AS bytes FROM doc_images WHERE item_id=? ORDER BY id')
            .all(result.id),
        ).toEqual(imageRows);
        expect(originalState(f, f.unitId)).toEqual(original);
        expect((await f.context.request.get(`/api/items/${f.item.id}/offline-bundle`)).status()).toBe(404);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    });

  test('Doc recovery and export preserve Formula definitions and recheck source access without cached results', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc');
    try {
      const source = f.workspace.create(f.editor.id, {
        name: 'RecoveryInputs',
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
      await expect.poll(async () => (await f.read()).snapshot.body?.dataStream).toContain('Formula context\r');
      await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await f.page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Insert formula', exact: true }).click();
      const insert = f.page.getByRole('dialog', { name: 'Insert formula', exact: true });
      await insert.getByLabel('Formula', { exact: true }).fill('=RecoveryInputs.Summary.A1');
      await insert.getByRole('button', { name: 'Insert formula', exact: true }).click();
      await expect(insert).not.toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => docFormulas((await f.read()).snapshot.body).length).toBe(1);
      await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await f.download();
      const definitions = docFormulas((await f.read()).snapshot.body).map((formula) => formula.definition);
      await localEdit(f, 'doc');
      f.workspace.share(f.editor.id, source.id, f.owner.id, null);
      await changeLive(f, 'doc', 'concurrent', baseURL!);
      await f.context.route(endpoint, (route) =>
        route.fulfill({ status: 503, json: { error: 'Recovery is temporarily unavailable.' } }),
      );
      await f.network.setOffline(false);
      const panel = await details(f.page);
      await expect(panel.getByRole('button', { name: 'Export as Univer file', exact: true })).toBeEnabled({ timeout: 30_000 });
      const downloading = f.page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Export as Univer file', exact: true }).click();
      const download = await downloading;
      const text = await readFile((await download.path())!, 'utf8');
      const exported = JSON.parse(text) as IDocumentData;
      expect(docFormulas(exported.body).map((formula) => formula.definition)).toEqual(definitions);
      expect(text).not.toContain(String(secret));
      expect(JSON.stringify(await stored(f.page, f.actor.id, f.item.id))).not.toContain(String(secret));
      await f.context.unroute(endpoint);
      await panel.getByRole('button', { name: 'Retry creating copy', exact: true }).click();
      const result = await recovered(f);
      const snapshot = await copySnapshot(f, result.id, baseURL!) as IDocumentData;
      expect(docFormulas(snapshot.body).map((formula) => formula.definition)).toEqual(definitions);
      expect(JSON.stringify(snapshot)).not.toContain(String(secret));
      await f.page.goto(result.href);
      await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await f.page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Formulas', exact: true }).click();
      const formulas = f.page.getByRole('dialog', { name: 'Formulas', exact: true });
      await expect(formulas.getByText('You need access to this formula’s sources', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(formulas.getByText(String(secret), { exact: true })).toHaveCount(0);
      f.workspace.share(f.editor.id, source.id, f.owner.id, 'viewer');
      await expect(formulas.getByText(String(secret), { exact: true })).toBeVisible({ timeout: 20_000 });
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
