import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY, getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { docFormulas } from '@spinel/doc-formulas';
import type { NativeSnapshot } from '@spinel/sync-client';
import sharp from 'sharp';
import { AdminStore } from '../src/server/auth/admin.ts';
import { InvitationService } from '../src/server/auth/invitations.ts';
import { COOKIE_NAME } from '../src/server/auth/store.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { mapNativeImageSources } from '../src/shared/nativeImageSources.ts';
import {
  attention,
  copy,
  edit,
  fixture,
  nativeInput,
  pending,
  offlineSheetImages,
  savedLocally,
  saveStatus,
  selectCell,
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
  await expect(
    page.getByRole('button', { name: 'Save details: Needs attention', exact: true }),
  ).toBeVisible({ timeout: 30_000 });
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
    // New account copies must rebase image ownership. Keep their content hash
    // and every native field in this comparison; the image test checks both
    // authorization scopes and bytes independently below.
    const comparableImages = (value: NativeSnapshot) =>
      mapNativeImageSources(
        structuredClone(value),
        (source) => {
          const data = /^data:image\/(?:png|jpeg|webp);base64,(.+)$/.exec(source);
          if (data)
            return `/api/items/image-scope/images/${createHash('sha256').update(Buffer.from(data[1], 'base64')).digest('hex')}`;
          return source.replace(/^\/api\/items\/[^/]+\/images\//, '/api/items/image-scope/images/');
        },
        { updateSourceType: true },
      ) as IWorkbookData;
    const book = comparableImages(snapshot);
    const before = comparableImages(baseline);
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
    return (await (await f.control.request.get(f.prefix)).json()).live.unitId as string;
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

async function localEdit(f: OfflineFixture, kind: Kind, reopen = true) {
  await f.network.setOffline(true);
  await edit(f.page, kind, offlineText(kind));
  await expect
    .poll(async () => pending((await stored(f.page, f.actor.id, f.item.id))?.outbox?.checkpoint))
    .toBe(true);
  await savedLocally(f.page);
  if (reopen) await f.page.reload();
  await usableCanvas(f.page);
  await savedLocally(f.page);
  expect(await copy(f.page, kind)).toContain(offlineText(kind).trim());
  expect(pending((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint)).toBe(true);
}

/** Public DOM IME events enter the mounted native editor's real input controller. */
async function composeDocText(
  page: Page,
  phase: 'start' | 'update' | 'end',
  text: string,
  lockAccount = false,
) {
  return nativeInput(page).evaluate(
    async (input, { phase, text, lockAccount }) => {
      if (phase === 'start') {
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
        return [] as string[];
      }
      const rejections: string[] = [];
      const rejected = (event: PromiseRejectionEvent) => {
        rejections.push(String(event.reason));
      };
      if (lockAccount) window.addEventListener('unhandledrejection', rejected);
      // A browser's IME updates this DOM input as well as CompositionEvent.data.
      // Never address the native model, commands, or a writable debug facade.
      input.textContent = text;
      const selection = window.getSelection();
      selection?.selectAllChildren(input);
      selection?.collapseToEnd();
      input.dispatchEvent(
        new CompositionEvent(phase === 'update' ? 'compositionupdate' : 'compositionend', {
          bubbles: true,
          data: text,
        }),
      );
      if (phase === 'update')
        input.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertCompositionText',
            data: text,
            isComposing: true,
          }),
        );
      if (lockAccount) {
        // Change the real account fence before the queued composition-end
        // microtask can run. A StorageEvent is the public cross-tab boundary;
        // no editor/controller method is invoked by this race fixture.
        const key = 'spinel.offline.cancellation';
        const oldValue = localStorage.getItem(key);
        const newValue = crypto.randomUUID();
        localStorage.removeItem('spinel.offline.account');
        localStorage.setItem(key, newValue);
        window.dispatchEvent(
          new StorageEvent('storage', {
            key,
            oldValue,
            newValue,
            storageArea: localStorage,
            url: location.href,
          }),
        );
        // Observe the queued native/host work and its rejection event without
        // exposing a mutable editor facade or swallowing an unhandled error.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        window.removeEventListener('unhandledrejection', rejected);
      }
      return rejections;
    },
    { phase, text, lockAccount },
  );
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
            if (change === 'concurrent' && !space && kind === 'doc') {
              // Keep the mounted completion links, but never advertise a new
              // offline launch after the recovered device bundle was removed.
              await f.network.setOffline(true);
              await f.page.reload();
              await expect(
                f.page
                  .getByRole('status')
                  .filter({ hasText: `${f.item.name} needs a connection.` }),
              ).toHaveText(
                `${f.item.name} needs a connection. It isn’t downloaded on this device.`,
              );
              await expect(f.page.locator('.univer-container canvas')).toHaveCount(0);
              await f.network.setOffline(false);
            }
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

  test('an unfinished native Sheet draft remains copyable before recovery freezes the queued edits', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet', { actor: 'editor' });
    try {
      await f.download();
      const baseline = await f.read();
      await localEdit(f, 'sheet');
      const retained = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
      await selectCell(f.page, 'E1');
      const draft = 'Unfinished travel notes 517';
      await f.page.keyboard.insertText(draft);
      const cellInput = f.page.locator(
        `[id="__editor_${DOCS_NORMAL_EDITOR_UNIT_ID_KEY}"][contenteditable="true"][data-u-comp="editor"]`,
      );
      await expect(cellInput).toBeFocused();
      await changeLive(f, 'sheet', 'concurrent', baseURL!);
      const original = originalState(f, f.unitId);
      await f.network.setOffline(false);
      const warning = 'Copy the unfinished cell text before recovering your offline changes.';
      await expect(saveStatus(f.page)).toHaveText(warning, { timeout: 30_000 });
      expect(receipts(f)).toEqual([]);
      const panel = await details(f.page);
      await expect(
        panel.getByRole('button', { name: 'Retry creating copy', exact: true }),
      ).toBeDisabled();
      await expect(
        panel.getByRole('button', { name: 'Export as Univer file', exact: true }),
      ).toBeDisabled();
      await panel.getByRole('button', { name: 'Close save details', exact: true }).click();
      const sentinel = `not-copied-${randomUUID()}`;
      await f.page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
      await cellInput.focus();
      await f.page.keyboard.press('Control+a');
      await f.page.keyboard.press('Control+c');
      await expect
        .poll(async () => (await f.page.evaluate(() => navigator.clipboard.readText())).trim())
        .toBe(draft);
      // Confirming a stale draft cannot commit it into the now frozen model.
      await f.page.keyboard.press('Enter');
      await expect(saveStatus(f.page)).toHaveText(warning);
      expect((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.buffer).toEqual(
        retained.buffer,
      );
      expect(receipts(f)).toEqual([]);
      expect(originalState(f, f.unitId)).toEqual(original);
      // Escape is the user's explicit dismissal of the already copied draft;
      // the previously durable D1 edit must still become one recoverable copy.
      await cellInput.focus();
      await f.page.keyboard.press('Escape');
      const ready = await details(f.page);
      const retry = ready.getByRole('button', { name: 'Retry creating copy', exact: true });
      if (await retry.isVisible()) await retry.click();
      const result = await recovered(f);
      expectOfflineContent(await copySnapshot(f, result.id, baseURL!), baseline.snapshot, 'sheet');
      expect(originalState(f, f.unitId)).toEqual(original);
      expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  for (const interruption of ['conflict', 'expired sign-in'] as const)
    test(`native Doc IME final text survives ${interruption} until explicit unfinished-text discard`, async ({
      browser,
      baseURL,
    }, info) => {
      const f = await fixture(browser, baseURL!, info, 'doc', { actor: 'editor' });
      try {
        await f.download();
        const baseline = await f.read();
        await localEdit(f, 'doc', false);
        const beforeComposition = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
        const intermediate = '旅行の下書き 517 ';
        const finalText = '家族旅行の最終予定 518 — keep every word ✈ ';
        const durableText = intermediate + offlineText('doc') + baseline.snapshot.body!.dataStream;
        let recoveryPosts = 0;
        const downloads: string[] = [];
        f.context.on('request', (request) => {
          if (
            request.method() === 'POST' &&
            new URL(request.url()).pathname === '/api/items/offline-recovery'
          )
            recoveryPosts++;
        });
        f.page.on('download', (download) => downloads.push(download.suggestedFilename()));
        await f.page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
        await nativeInput(f.page).focus();
        await f.page.keyboard.press('Control+Home');
        await composeDocText(f.page, 'start', '');
        await composeDocText(f.page, 'update', intermediate);
        await expect(saveStatus(f.page)).toHaveText('Editing text — changes not saved yet.');
        // This durable checkpoint is emitted by the real native capture. The
        // public settled-snapshot observer intentionally stays stale offline.
        await expect
          .poll(async () =>
            JSON.stringify(
              (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.buffer,
            ),
          )
          .toContain(intermediate);
        const captured = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
        expect(captured.buffer).not.toEqual(beforeComposition.buffer);
        if (interruption === 'conflict') await changeLive(f, 'doc', 'concurrent', baseURL!);
        else {
          const cookie = (await f.context.cookies()).find((entry) => entry.name === COOKIE_NAME)!;
          f.auth.revokeSession(f.auth.session(cookie.value)!.token_hash);
        }
        const original = originalState(f, f.unitId);
        await f.network.setOffline(false);
        const warning =
          interruption === 'conflict'
            ? 'Copy the unfinished text before recovering your offline changes.'
            : 'Your sign-in ended. Copy the unfinished text before signing in again.';
        await expect(saveStatus(f.page)).toHaveText(warning, { timeout: 30_000 });
        expect(recoveryPosts).toBe(0);
        expect(receipts(f)).toEqual([]);
        // The final IME value deliberately differs from the last captured
        // update. Composition ending must not release the held host draft.
        await composeDocText(f.page, 'end', finalText);
        await expect(saveStatus(f.page)).toHaveText(warning);
        // A conflict refuses further native mutations; a 401 still lets an
        // already-started composition finish in the local checkpoint. Both
        // retain the independent host text until its explicit discard.
        const retainedBody =
          interruption === 'conflict'
            ? durableText
            : finalText + offlineText('doc') + baseline.snapshot.body!.dataStream;
        if (interruption === 'expired sign-in')
          await expect
            .poll(async () =>
              JSON.stringify(
                (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.buffer,
              ),
            )
            .toContain(finalText);
        await expect(
          f.page.getByRole('button', { name: 'Save details: Not saved', exact: true }),
        ).toBeVisible();
        const panel = await details(f.page);
        const retainedText = panel.getByRole('textbox', { name: 'Unfinished text', exact: true });
        await expect(retainedText).toHaveValue(finalText);
        await expect(retainedText).toHaveAttribute('readonly', '');
        if (interruption === 'conflict') {
          // Frozen input ignores a new composition. Its later end event must
          // not overwrite the already-held final text from the tracked one.
          await composeDocText(f.page, 'start', '');
          await composeDocText(f.page, 'end', 'Ignored later composition 520');
          await expect(retainedText).toHaveValue(finalText);
        }
        for (const name of ['Export as Univer file', 'Discard offline changes…'])
          await expect(panel.getByRole('button', { name, exact: true })).toBeDisabled();
        if (interruption === 'conflict')
          await expect(
            panel.getByRole('button', { name: 'Retry creating copy', exact: true }),
          ).toBeDisabled();
        else
          await expect(
            panel.getByRole('button', { name: 'Retry creating copy', exact: true }),
          ).toHaveCount(0);
        await expect(panel.getByRole('link', { name: 'Open copy', exact: true })).toHaveCount(0);
        await expect(
          panel.getByRole('button', { name: 'Continue to sign-in', exact: true }),
        ).toHaveCount(0);
        // Even Retry saving must retain the host draft instead of quietly
        // creating a copy or navigating away after compositionend.
        await panel.getByRole('button', { name: 'Retry saving', exact: true }).click();
        await expect(saveStatus(f.page)).toHaveText(warning);
        await expect(retainedText).toHaveValue(finalText);
        const sentinel = `not-copied-${randomUUID()}`;
        await f.page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
        await retainedText.focus();
        await f.page.keyboard.press('Control+a');
        await f.page.keyboard.press('Control+c');
        await expect
          .poll(() => f.page.evaluate(() => navigator.clipboard.readText()))
          .toBe(finalText);
        const held = (await stored(f.page, f.actor.id, f.item.id))!;
        expect(held.recovery).toBeUndefined();
        if (interruption === 'conflict') {
          expect(held.outbox!.checkpoint.buffer).toEqual(captured.buffer);
          expect(JSON.stringify(held.outbox)).not.toContain(finalText);
        } else {
          expect(held.outbox!.checkpoint.buffer).not.toEqual(captured.buffer);
          expect(JSON.stringify(held.outbox)).toContain(finalText);
        }
        expect(held.outbox!.checkpoint.inflight).toEqual(captured.inflight);
        expect(recoveryPosts).toBe(0);
        expect(receipts(f)).toEqual([]);
        expect(downloads).toEqual([]);
        expect(originalState(f, f.unitId)).toEqual(original);
        if (interruption === 'conflict') await capture(f.page, info, 'unfinished-doc-ime');
        expect(recoveryPosts).toBe(0);
        await panel.getByRole('button', { name: 'Discard unfinished text', exact: true }).click();
        await expect(retainedText).toHaveCount(0);
        if (interruption === 'conflict') {
          const result = await recovered(f);
          const snapshot = (await copySnapshot(f, result.id, baseURL!)) as IDocumentData;
          expect(snapshot.body?.dataStream).toBe(durableText);
          expect(snapshot.body?.dataStream).not.toContain(finalText);
          expect(recoveryPosts).toBe(1);
        } else {
          await expect(
            panel.getByRole('button', { name: 'Continue to sign-in', exact: true }),
          ).toBeEnabled();
          const downloading = f.page.waitForEvent('download');
          await panel.getByRole('button', { name: 'Export as Univer file', exact: true }).click();
          const download = await downloading;
          expect(await download.failure()).toBeNull();
          const snapshot = JSON.parse(
            await readFile((await download.path())!, 'utf8'),
          ) as IDocumentData;
          expect(snapshot.body?.dataStream).toBe(retainedBody);
          expect(recoveryPosts).toBe(0);
          expect(receipts(f)).toEqual([]);
          await panel.getByRole('button', { name: 'Continue to sign-in', exact: true }).click();
          await expect(f.page).toHaveURL(/\/sign-in(?:\?|$)/);
          expect((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.buffer).toEqual(
            held.outbox!.checkpoint.buffer,
          );
        }
        expect(originalState(f, f.unitId)).toEqual(original);
        expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    });

  test('native Doc IME capacity refusal retains the exact final text before recovering its applied snapshot', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc', { actor: 'editor' });
    try {
      await f.download();
      const baseline = await f.read();
      await localEdit(f, 'doc', false);
      const intermediate = 'Small IME draft 519 ';
      // This real native insertion exceeds MAX_WIRE_BYTES (64 KiB), while
      // remaining within native capture and whole-snapshot recovery limits.
      const finalText = 'IME draft 519 text. '.repeat(3_500);
      expect(Buffer.byteLength(finalText, 'utf8')).toBe(70_000);
      expect(Buffer.byteLength(finalText, 'utf8')).toBeGreaterThan(64 * 1024);
      const finalBody = finalText + offlineText('doc') + baseline.snapshot.body!.dataStream;
      let recoveryPosts = 0;
      const downloads: string[] = [];
      f.context.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/api/items/offline-recovery'
        )
          recoveryPosts++;
      });
      f.page.on('download', (download) => downloads.push(download.suggestedFilename()));
      await f.page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
      await nativeInput(f.page).focus();
      await f.page.keyboard.press('Control+Home');
      await composeDocText(f.page, 'start', '');
      await composeDocText(f.page, 'update', intermediate);
      await expect
        .poll(async () =>
          JSON.stringify((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.buffer),
        )
        .toContain(intermediate);
      const captured = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
      const original = originalState(f, f.unitId);
      // There is no earlier conflict: this final event itself applies native
      // text, exceeds the wire envelope, and starts the host's retained hold.
      await composeDocText(f.page, 'end', finalText);
      const warning = 'Copy the unfinished text before recovering your offline changes.';
      await expect(saveStatus(f.page)).toHaveText(warning, { timeout: 30_000 });
      await expect
        .poll(async () => (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.failure)
        .toBe('capacity');
      await expect
        .poll(async () => {
          const checkpoint = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
          return (checkpoint.recoverySnapshot as IDocumentData | undefined)?.body?.dataStream;
        })
        .toBe(finalBody);
      const panel = await details(f.page);
      const retainedText = panel.getByRole('textbox', { name: 'Unfinished text', exact: true });
      await expect(retainedText).toHaveValue(finalText);
      await expect(retainedText).toHaveAttribute('readonly', '');
      for (const name of [
        'Retry creating copy',
        'Export as Univer file',
        'Discard offline changes…',
      ])
        await expect(panel.getByRole('button', { name, exact: true })).toBeDisabled();
      await expect(panel.getByRole('link', { name: 'Open copy', exact: true })).toHaveCount(0);
      const held = (await stored(f.page, f.actor.id, f.item.id))!;
      expect(held.recovery).toBeUndefined();
      expect(held.outbox!.checkpoint.recoveryMissing).not.toBe(true);
      expect(held.outbox!.checkpoint.buffer).toEqual(captured.buffer);
      expect(held.outbox!.checkpoint.inflight).toEqual(captured.inflight);
      expect(recoveryPosts).toBe(0);
      expect(receipts(f)).toEqual([]);
      expect(downloads).toEqual([]);
      expect(originalState(f, f.unitId)).toEqual(original);
      await f.network.setOffline(false);
      await expect.poll(() => f.page.evaluate(() => navigator.onLine)).toBe(true);
      await panel.getByRole('button', { name: 'Retry saving', exact: true }).click();
      await expect(saveStatus(f.page)).toHaveText(warning);
      await expect(retainedText).toHaveValue(finalText);
      expect((await stored(f.page, f.actor.id, f.item.id))!.outbox).toEqual(held.outbox);
      expect(recoveryPosts).toBe(0);
      expect(receipts(f)).toEqual([]);
      await panel.getByRole('button', { name: 'Discard unfinished text', exact: true }).click();
      await expect(retainedText).toHaveCount(0);
      const result = await recovered(f);
      const snapshot = (await copySnapshot(f, result.id, baseURL!)) as IDocumentData;
      expect(snapshot.body?.dataStream).toBe(finalBody);
      expect(snapshot.body?.dataStream).not.toContain(intermediate);
      expect(recoveryPosts).toBe(1);
      expect(originalState(f, f.unitId)).toEqual(original);
      expect(downloads).toEqual([]);
      expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('native Doc composition-end account lock retires queued freeze work without leaking held text or deleting edits', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc', { actor: 'editor' });
    try {
      await f.download();
      await localEdit(f, 'doc', false);
      const intermediate = 'Account-scoped IME draft 521 ';
      const finalText = 'Final private IME text 522 — do not show after locking';
      let recoveryPosts = 0;
      const downloads: string[] = [];
      f.context.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/api/items/offline-recovery'
        )
          recoveryPosts++;
      });
      f.page.on('download', (download) => downloads.push(download.suggestedFilename()));
      await f.page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
      await nativeInput(f.page).focus();
      await f.page.keyboard.press('Control+Home');
      await composeDocText(f.page, 'start', '');
      await composeDocText(f.page, 'update', intermediate);
      await expect
        .poll(async () =>
          JSON.stringify((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.buffer),
        )
        .toContain(intermediate);
      await changeLive(f, 'doc', 'concurrent', baseURL!);
      const original = originalState(f, f.unitId);
      await f.network.setOffline(false);
      await expect(saveStatus(f.page)).toHaveText(
        'Copy the unfinished text before recovering your offline changes.',
        { timeout: 30_000 },
      );
      const panel = await details(f.page);
      const retainedText = panel.getByRole('textbox', { name: 'Unfinished text', exact: true });
      await expect(retainedText).toHaveValue(intermediate);
      await expect
        .poll(async () => (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint.failure)
        .toBeDefined();
      const held = (await stored(f.page, f.actor.id, f.item.id))!;
      expect(pending(held.outbox!.checkpoint)).toBe(true);
      expect(held.recovery).toBeUndefined();
      // This is the first end event for the tracked composition. The helper
      // performs both dispatches before yielding to its queued freeze callback.
      const rejections = await composeDocText(f.page, 'end', finalText, true);
      expect(rejections).toEqual([]);
      await expect(saveStatus(f.page)).toHaveText(
        'Offline access changed on this device. Reopen the document to continue.',
      );
      await expect(retainedText).toHaveCount(0);
      await expect(
        panel.getByRole('button', { name: 'Discard unfinished text', exact: true }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole('button', { name: 'Export as Univer file', exact: true }),
      ).toHaveCount(0);
      await expect(panel.getByRole('link', { name: 'Open copy', exact: true })).toHaveCount(0);
      await expect(f.page.locator('.univer-container canvas')).toHaveCount(0);
      await expect(f.page.getByText(finalText, { exact: true })).toHaveCount(0);
      await expect
        .poll(() => f.page.evaluate(() => localStorage.getItem('spinel.offline.account')))
        .toBeNull();
      expect((await stored(f.page, f.actor.id, f.item.id))!.outbox).toEqual(held.outbox);
      expect((await stored(f.page, f.actor.id, f.item.id))!.recovery).toBeUndefined();
      expect(recoveryPosts).toBe(0);
      expect(receipts(f)).toEqual([]);
      expect(downloads).toEqual([]);
      expect(originalState(f, f.unitId)).toEqual(original);
      expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  for (const kind of ['sheet', 'doc'] as const)
    test(`${kind}: ${kind === 'sheet' ? 'permission-denied' : 'oversized'} copy exports the complete local version and requires explicit discard`, async ({
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
          return route.fulfill({
            status: kind === 'sheet' ? 403 : 413,
            json: {
              error:
                kind === 'sheet'
                  ? 'A recovery copy cannot be created.'
                  : 'The recovery file is too large.',
            },
          });
        });
        await f.network.setOffline(false);
        await expect.poll(() => attempts).toBeGreaterThan(0);
        await attention(f.page);
        let panel = await details(f.page);
        await expect(
          panel.getByRole('button', { name: 'Export as Univer file', exact: true }),
        ).toBeEnabled();
        const retained = await stored(f.page, f.actor.id, f.item.id);
        expect(pending(retained!.outbox!.checkpoint)).toBe(true);
        expect(receipts(f)).toEqual([]);
        const downloading = f.page.waitForEvent('download');
        await panel.getByRole('button', { name: 'Export as Univer file', exact: true }).click();
        const download = await downloading;
        expect(await download.failure()).toBeNull();
        expect(download.suggestedFilename()).toMatch(/\.univer\.json$/);
        const exported = JSON.parse(
          await readFile((await download.path())!, 'utf8'),
        ) as NativeSnapshot;
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

  for (const space of [false, true])
    test(`${space ? 'Space child' : 'ordinary'} revoked original: My files recovery survives a lost response and online reload`, async ({
      browser,
      baseURL,
    }, info) => {
      const f = await fixture(browser, baseURL!, info, 'doc', { space, actor: 'editor' });
      try {
        await f.download();
        const baseline = await f.read();
        await localEdit(f, 'doc', space);
        await changeLive(f, 'doc', 'revoked', baseURL!);
        const original = originalState(f, f.unitId);
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
        await expect(
          (await details(f.page)).getByRole('button', { name: 'Retry creating copy', exact: true }),
        ).toBeEnabled();
        const copyId = receipts(f)[0].item_id;
        expect([403, 404]).toContain((await f.context.request.get(f.prefix)).status());
        // The root listing must expose local work even when the original has
        // vanished from the actor's server catalog and scoped item routes.
        if (space) await f.page.goto('/');
        else {
          // Dashboard navigation retains the mounted downloads hook. Pending
          // edits must appear without relying on a browser reload to discover them.
          await f.page.keyboard.press('Escape');
          await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
          await expect(f.page).toHaveURL(new URL('/', baseURL!).href);
        }
        await expect(
          f.page.getByRole('heading', { name: 'Offline changes on this device', exact: true }),
        ).toBeVisible();
        const entry = f.page.getByRole('link', { name: `Recover ${f.item.name}`, exact: true });
        await expect(entry).toHaveAttribute('href', `/?offlineRecovery=${f.item.id}`);
        const previousAttempts = requests.length;
        await entry.click();
        await expect(f.page).toHaveURL(new URL(`/?offlineRecovery=${f.item.id}`, baseURL!).href);
        await expect.poll(() => requests.length).toBeGreaterThan(previousAttempts);
        await expect(
          (await details(f.page)).getByRole('button', { name: 'Retry creating copy', exact: true }),
        ).toBeEnabled();
        expect((await stored(f.page, f.actor.id, f.item.id))!.recovery).toEqual(requests[0]);
        loseResponse = false;
        await f.page.reload();
        const result = await recovered(f);
        expect(result.id).toBe(copyId);
        expect(requests.length).toBeGreaterThanOrEqual(3);
        for (const request of requests) expect(request).toEqual(requests[0]);
        expectOfflineContent(await copySnapshot(f, result.id, baseURL!), baseline.snapshot, 'doc');
        expect(originalState(f, f.unitId)).toEqual(original);
        expect(receipts(f)).toHaveLength(1);
        expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    });

  test('a modified stored recovery request cannot publish or clear edits and export reconstructs the honest checkpoint', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc', { actor: 'editor' });
    try {
      await f.download();
      const baseline = await f.read();
      await localEdit(f, 'doc');
      await changeLive(f, 'doc', 'concurrent', baseURL!);
      const original = originalState(f, f.unitId);
      let requests = 0;
      await f.context.route(endpoint, (route) => {
        requests++;
        return route.fulfill({
          status: 503,
          json: { error: 'Recovery is temporarily unavailable.' },
        });
      });
      await f.network.setOffline(false);
      await expect.poll(() => requests).toBeGreaterThan(0);
      await expect(
        (await details(f.page)).getByRole('button', { name: 'Retry creating copy', exact: true }),
      ).toBeEnabled();
      const retained = (await stored(f.page, f.actor.id, f.item.id))!;
      expect(retained.recovery).toBeTruthy();
      await f.page.goto('/');
      const tamperedText = 'Altered version 629 ';
      await f.page.evaluate(
        async ({ accountId, itemId, genuine, tampered }) => {
          await new Promise<void>((resolve, reject) => {
            const opening = indexedDB.open(`spinel-offline-${accountId}`);
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
              const database = opening.result;
              const transaction = database.transaction('items', 'readwrite');
              transaction.oncomplete = () => {
                database.close();
                resolve();
              };
              transaction.onerror = () => {
                database.close();
                reject(transaction.error);
              };
              transaction.onabort = () => {
                database.close();
                reject(transaction.error);
              };
              const items = transaction.objectStore('items');
              const read = items.get(itemId);
              read.onsuccess = () => {
                const value = read.result;
                value.recovery.snapshot.body.dataStream =
                  value.recovery.snapshot.body.dataStream.replace(genuine, tampered);
                items.put(value);
              };
            };
          });
        },
        {
          accountId: f.actor.id,
          itemId: f.item.id,
          genuine: offlineText('doc'),
          tampered: tamperedText,
        },
      );
      requests = 0;
      await f.page.goto(`/?offlineRecovery=${f.item.id}`);
      const panel = await details(f.page);
      const error =
        'The saved recovery request does not match your offline changes. Keep this device copy.';
      await expect(panel.getByText(error, { exact: true })).toBeVisible({ timeout: 30_000 });
      expect(requests).toBe(0);
      expect(receipts(f)).toEqual([]);
      expect((await stored(f.page, f.actor.id, f.item.id))!.outbox).toEqual(retained.outbox);
      // Explicit export remains safe because it independently rebuilds the
      // checkpoint and verified images instead of trusting the saved request.
      const downloading = f.page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Export as Univer file', exact: true }).click();
      const download = await downloading;
      expect(await download.failure()).toBeNull();
      const exportedText = await readFile((await download.path())!, 'utf8');
      expectOfflineContent(JSON.parse(exportedText) as NativeSnapshot, baseline.snapshot, 'doc');
      expect(exportedText).not.toContain(tamperedText);
      expect(requests).toBe(0);
      expect(receipts(f)).toEqual([]);
      expect((await stored(f.page, f.actor.id, f.item.id))!.outbox).toEqual(retained.outbox);
      expect(originalState(f, f.unitId)).toEqual(original);
      expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
      expect(f.errors).toEqual([]);
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
          if (
            this.name === 'items' &&
            key === id &&
            sessionStorage.getItem('spinel-test-recovery-cleanup') === 'fail'
          ) {
            this.transaction.abort();
            throw new DOMException('Simulated recovery cleanup failure', 'AbortError');
          }
          return remove.call(this, key);
        };
      }, f.item.id);
      await f.network.setOffline(false);
      await expect.poll(() => receipts(f).length).toBe(1);
      const panel = await details(f.page);
      await expect(
        panel.getByRole('button', { name: 'Retry creating copy', exact: true }),
      ).toBeEnabled();
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

  test('a lost native acknowledgement creates one conservative recovery copy and counts that possible replay crash once', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc');
    try {
      await f.download();
      const baseline = await f.read();
      await localEdit(f, 'doc');
      f.network.loseAcknowledgment();
      await f.network.setOffline(false);
      await expect.poll(() => f.network.lostMutationId()).toBeTruthy();
      // The server durably accepted this one edit, but the offline client has
      // not received its acknowledgement. Recovery conservatively keeps both.
      const live = await f.read();
      expect(live.revision).toBe(baseline.revision + 1);
      expect(live.snapshot.body!.dataStream).toBe(
        offlineText('doc') + baseline.snapshot.body!.dataStream,
      );
      const checkpoint = (await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint;
      expect(checkpoint.sent?.mutationId).toBe(f.network.lostMutationId());
      await f.page.reload();
      await savedLocally(f.page);
      const submits = f.network.outgoing.filter((frame) => frame.type === 'submit').length;
      await f.network.setOffline(false);
      const result = await recovered(f);
      const snapshot = await copySnapshot(f, result.id, baseURL!);
      expectOfflineContent(snapshot, baseline.snapshot, 'doc');
      expect(await f.read()).toEqual(live);
      expect(receipts(f)).toHaveLength(1);
      expect(receipts(f)[0].possible_replay_crash).toBe(1);
      expect(f.network.outgoing.filter((frame) => frame.type === 'submit')).toHaveLength(submits);
      await f.network.setOffline(true);
      await f.network.setOffline(false);
      expect(receipts(f)).toHaveLength(1);
      expect(receipts(f)[0].possible_replay_crash).toBe(1);
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
      await expect(
        panel.getByRole('button', { name: 'Export as Univer file', exact: true }),
      ).toBeEnabled({ timeout: 30_000 });
      await expect(f.page).toHaveURL(new URL(f.href, baseURL!).href);
      await expect(
        panel.getByRole('button', { name: 'Continue to sign-in', exact: true }),
      ).toBeVisible();
      const downloading = f.page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Export as Univer file', exact: true }).click();
      const download = await downloading;
      const exported = JSON.parse(
        await readFile((await download.path())!, 'utf8'),
      ) as NativeSnapshot;
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
        await f.context.route(endpoint, (route) =>
          route.fulfill({
            status: 413,
            json: { error: 'The recovery copy exceeds the image budget.' },
          }),
        );
        await f.network.setOffline(false);
        const panel = await details(f.page);
        await expect(
          panel.getByRole('button', { name: 'Export as Univer file', exact: true }),
        ).toBeEnabled({ timeout: 30_000 });
        const downloading = f.page.waitForEvent('download');
        await panel.getByRole('button', { name: 'Export as Univer file', exact: true }).click();
        const download = await downloading;
        const exported = JSON.parse(
          await readFile((await download.path())!, 'utf8'),
        ) as NativeSnapshot;
        expectOfflineContent(exported, before.snapshot, kind);
        const embedded = new Set<string>();
        mapNativeImageSources(exported, (source) => {
          embedded.add(source);
          return source;
        });
        expect(embedded.size).toBe(3);
        const exportedImages = [...embedded]
          .map((source) => {
            const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z\d+/]+=*)$/.exec(source);
            expect(match).not.toBeNull();
            const bytes = Buffer.from(match![2], 'base64');
            return {
              id: createHash('sha256').update(bytes).digest('hex'),
              mime: match![1],
              bytes: bytes.toString('hex').toUpperCase(),
            };
          })
          .sort((left, right) => left.id.localeCompare(right.id));
        expect(exportedImages).toEqual(imageRows);
        expect(pending((await stored(f.page, f.actor.id, f.item.id))!.outbox!.checkpoint)).toBe(
          true,
        );
        expect(receipts(f)).toEqual([]);
        await f.context.unroute(endpoint);
        await panel.getByRole('button', { name: 'Retry creating copy', exact: true }).click();
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
          expect((await f.context.request.get(source.replace(result.id, f.item.id))).status()).toBe(
            404,
          );
        }
        expect(
          f.db
            .prepare(
              'SELECT id,mime,hex(data) AS bytes FROM doc_images WHERE item_id=? ORDER BY id',
            )
            .all(result.id),
        ).toEqual(imageRows);
        expect(originalState(f, f.unitId)).toEqual(original);
        expect(
          (await f.context.request.get(`/api/items/${f.item.id}/offline-bundle`)).status(),
        ).toBe(404);
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
      await expect
        .poll(async () => (await f.read()).snapshot.body?.dataStream)
        .toContain('Formula context\r');
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
      const definitions = docFormulas((await f.read()).snapshot.body).map(
        (formula) => formula.definition,
      );
      await localEdit(f, 'doc');
      f.workspace.share(f.editor.id, source.id, f.owner.id, null);
      await changeLive(f, 'doc', 'concurrent', baseURL!);
      await f.context.route(endpoint, (route) =>
        route.fulfill({ status: 503, json: { error: 'Recovery is temporarily unavailable.' } }),
      );
      await f.network.setOffline(false);
      const panel = await details(f.page);
      await expect(
        panel.getByRole('button', { name: 'Export as Univer file', exact: true }),
      ).toBeEnabled({ timeout: 30_000 });
      const downloading = f.page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Export as Univer file', exact: true }).click();
      const download = await downloading;
      const text = await readFile((await download.path())!, 'utf8');
      const exported = JSON.parse(text) as IDocumentData;
      expect(docFormulas(exported.body).map((formula) => formula.definition)).toEqual(definitions);
      expect(text).not.toContain(String(secret));
      expect(JSON.stringify(await stored(f.page, f.actor.id, f.item.id))).not.toContain(
        String(secret),
      );
      await f.context.unroute(endpoint);
      await panel.getByRole('button', { name: 'Retry creating copy', exact: true }).click();
      const result = await recovered(f);
      const snapshot = (await copySnapshot(f, result.id, baseURL!)) as IDocumentData;
      expect(docFormulas(snapshot.body).map((formula) => formula.definition)).toEqual(definitions);
      expect(JSON.stringify(snapshot)).not.toContain(String(secret));
      await f.page.goto(result.href);
      await expect(saveStatus(f.page)).toHaveText('All changes saved.', { timeout: 30_000 });
      await f.page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Formulas', exact: true }).click();
      const formulas = f.page.getByRole('dialog', { name: 'Formulas', exact: true });
      await expect(
        formulas.getByText('You need access to this formula’s sources', { exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(formulas.getByText(String(secret), { exact: true })).toHaveCount(0);
      f.workspace.share(f.editor.id, source.id, f.owner.id, 'viewer');
      await expect(formulas.getByText(String(secret), { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
