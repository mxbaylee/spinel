import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
import type { IDocumentData } from '@univerjs/core';
import { interruptibleNetwork } from './live-network.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import {
  content,
  placeCaret,
  readEditingSelection,
  registerDocEditingTests,
  reopen,
  withEditingDoc,
} from './doc-editing.ts';
import { withFixtureCleanup } from './owned-process.ts';

test.describe('desktop native Doc editing', () => registerDocEditingTests(false));

const clipboardTest = test.extend({ trace: 'retain-on-failure' });
type ImagePasteWindow = Window & {
  imagePasteEvents?: {
    trusted: boolean;
    types: string[];
    files: { mime: string; bytes: number }[];
  }[];
};
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

clipboardTest.describe('native Doc image clipboard', () => {
  clipboardTest.describe.configure({ retries: 0 });

  clipboardTest(
    'native PNG paste keeps the editor, exact content and stored image through undo and reopen',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(90_000);
      expect(info.retry).toBe(0);
      const png = await sharp({
        create: { width: 80, height: 60, channels: 3, background: { r: 23, g: 201, b: 151 } },
      })
        .png()
        .toBuffer();
      const pixels = await sharp(png).removeAlpha().raw().toBuffer();
      const posts: { mime: string; bytes: number; sha256: string; status?: number }[] = [];
      const postRequests = new Map<Request, (typeof posts)[number]>();
      const sync: Record<string, unknown>[] = [];
      const stages: Record<string, unknown>[] = [];
      const evidence: Record<string, unknown> = {
        source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        project: info.project.name,
        attempt: info.retry,
        browser: browser.version(),
        viewport: { width: 1440, height: 1100 },
        fixture: {
          mime: 'image/png',
          width: 80,
          height: 60,
          bytes: png.length,
          sha256: sha256(png),
        },
        posts,
        sync,
        stages,
      };
      let topLevelNavigations = 0;
      let totalImagePosts = 0;
      let droppedSyncFrames = 0;
      let observationFailures = 0;
      const observeSync = (direction: 'sent' | 'received', payload: string | Buffer) => {
        try {
          const serialized = payload.toString();
          const frame = JSON.parse(serialized) as Record<string, unknown>;
          if (
            !['submit', 'ack', 'resync', 'edit', 'snapshot', 'resume', 'verified'].includes(
              String(frame.type),
            )
          )
            return;
          if (sync.length === 64) {
            droppedSyncFrames++;
            return;
          }
          sync.push({
            direction,
            type: frame.type,
            reason: [
              'unsupported',
              'refused',
              'stale',
              'divergence',
              'unavailable',
              'malformed',
              'capacity',
              'retry-conflict',
              'invariant',
            ].includes(String(frame.reason))
              ? frame.reason
              : undefined,
            revision: typeof frame.revision === 'number' ? frame.revision : undefined,
            mutations: Array.isArray(frame.mutations) ? frame.mutations.length : undefined,
            inlineImageReferences: (serialized.match(/data:image\//g) ?? []).length,
            storedImageReferences: (serialized.match(/\/images\/[a-f0-9]{64}/g) ?? []).length,
          });
        } catch {
          observationFailures++;
        }
      };
      const beforeOpen = async (page: Page) => {
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) topLevelNavigations++;
        });
        page.on('request', (request) => {
          if (
            request.method() !== 'POST' ||
            !/^\/api\/items\/[^/]+\/images$/.test(new URL(request.url()).pathname)
          )
            return;
          totalImagePosts++;
          if (posts.length === 8) return;
          const body = request.postDataBuffer() ?? Buffer.alloc(0);
          const post = {
            mime: request.headers()['content-type'] ?? '',
            bytes: body.length,
            sha256: sha256(body),
          };
          posts.push(post);
          postRequests.set(request, post);
        });
        page.on('response', (response) => {
          const post = postRequests.get(response.request());
          if (post) post.status = response.status();
        });
        page.on('websocket', (socket) => {
          if (!new URL(socket.url()).pathname.startsWith('/sync-api/')) return;
          socket.on('framesent', ({ payload }) => observeSync('sent', payload));
          socket.on('framereceived', ({ payload }) => observeSync('received', payload));
        });
        await page.addInitScript(() => {
          const events: NonNullable<ImagePasteWindow['imagePasteEvents']> = [];
          (window as ImagePasteWindow).imagePasteEvents = events;
          document.addEventListener(
            'paste',
            (event) => {
              if (events.length === 8) return;
              events.push({
                trusted: event.isTrusted,
                types: Array.from(event.clipboardData?.types ?? []),
                files: Array.from(event.clipboardData?.files ?? []).map((file) => ({
                  mime: file.type,
                  bytes: file.size,
                })),
              });
            },
            true,
          );
        });
      };
      await withFixtureCleanup(
        () =>
          withEditingDoc(
            browser,
            baseURL!,
            info,
            false,
            async (f) => {
              const { page } = f;
              const canvas = page
                .getByRole('region', { name: 'Doc document', exact: true })
                .getByLabel('Document canvas', { exact: true });
              await f.context.grantPermissions(['clipboard-read', 'clipboard-write']);
              await f.focus();
              await placeCaret(f, 0);
              const initialText = 'Phone journal\rSecond line\r\n';
              const before = await content(f, initialText, 0);
              const originalCanvas = await canvas.elementHandle();
              expect(originalCanvas).not.toBeNull();
              const origin = await page.evaluate(() => performance.timeOrigin);
              const navigationCount = topLevelNavigations;
              const mounted = () =>
                originalCanvas!.evaluate((node) => node.isConnected).catch(() => false);
              const capture = async (stage: string) => {
                stages.push({
                  stage,
                  native: await readEditingSelection(page).catch(() => undefined),
                  saved: await f.read().catch(() => undefined),
                  originalCanvasMounted: await mounted(),
                  topLevelNavigations,
                  environment: await page
                    .evaluate(() => ({
                      timeOrigin: performance.timeOrigin,
                      online: navigator.onLine,
                      userAgent: navigator.userAgent,
                      pasteEvents: (window as ImagePasteWindow).imagePasteEvents,
                    }))
                    .catch(() => undefined),
                });
              };
              const renderedPixels = async () => {
                const { data, info: raster } = await sharp(await canvas.screenshot())
                  .removeAlpha()
                  .raw()
                  .toBuffer({ resolveWithObject: true });
                let matching = 0;
                for (let i = 0; i < data.length; i += raster.channels)
                  if (
                    Math.abs(data[i] - 23) <= 8 &&
                    Math.abs(data[i + 1] - 201) <= 8 &&
                    Math.abs(data[i + 2] - 151) <= 8
                  )
                    matching++;
                return matching;
              };
              const storedImage = async (snapshot: IDocumentData) => {
                expect(snapshot.drawingsOrder).toHaveLength(1);
                const drawing = snapshot.drawings?.[snapshot.drawingsOrder![0]];
                expect(drawing).toBeDefined();
                // The core drawing type omits the image plugin fields; narrow the
                // actual stored source without treating the entire snapshot as an image.
                if (!drawing || !('source' in drawing) || typeof drawing.source !== 'string')
                  throw new Error('The persisted drawing must contain an image source.');
                expect(drawing.source).toMatch(
                  new RegExp(`^/api/items/${f.id}/images/[a-f0-9]{64}$`),
                );
                const response = await f.context.request.get(drawing.source);
                expect(response.status()).toBe(200);
                expect(response.headers()['content-type']).toContain('image/png');
                const stored = await response.body();
                expect(drawing.source.endsWith(sha256(stored))).toBe(true);
                const metadata = await sharp(stored).metadata();
                expect([metadata.width, metadata.height]).toEqual([80, 60]);
                expect(await sharp(stored).removeAlpha().raw().toBuffer()).toEqual(pixels);
                return {
                  source: drawing.source,
                  bytes: stored.length,
                  sha256: sha256(stored),
                  width: metadata.width,
                  height: metadata.height,
                };
              };
              await withFixtureCleanup(
                async () => {
                  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
                  expect(await renderedPixels()).toBeLessThan(100);
                  await capture('before-paste');
                  await page.evaluate(async (bytes) => {
                    await navigator.clipboard.write([
                      new ClipboardItem({
                        'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
                      }),
                    ]);
                  }, Array.from(png));
                  const clipboard = await page.evaluate(async () => {
                    const item = (await navigator.clipboard.read()).find((item) =>
                      item.types.includes('image/png'),
                    );
                    if (!item) throw new Error('The native clipboard has no PNG item.');
                    const image = await item.getType('image/png');
                    return {
                      mime: image.type,
                      bytes: Array.from(new Uint8Array(await image.arrayBuffer())),
                    };
                  });
                  const clipboardBytes = Buffer.from(clipboard.bytes);
                  evidence.clipboard = {
                    mime: clipboard.mime,
                    bytes: clipboardBytes.length,
                    sha256: sha256(clipboardBytes),
                  };
                  expect(clipboard.mime).toBe('image/png');
                  expect(await sharp(clipboardBytes).removeAlpha().raw().toBuffer()).toEqual(
                    pixels,
                  );
                  // This is the sole paste action. The listener only observes the real
                  // event; fixture seeding is confined to unrelated initial content.
                  const syncBeforePaste = sync.length;
                  await page.keyboard.press('ControlOrMeta+v');
                  await expect
                    .poll(() => page.evaluate(() => (window as ImagePasteWindow).imagePasteEvents))
                    .toEqual([
                      {
                        trusted: true,
                        types: expect.arrayContaining(['Files']),
                        files: [{ mime: 'image/png', bytes: expect.any(Number) }],
                      },
                    ]);
                  await capture('after-native-paste-delivery');
                  await expect.poll(() => posts.map((post) => post.status)).toEqual([201]);
                  expect(totalImagePosts).toBe(1);
                  expect(posts[0].mime).toBe('image/png');
                  // The pinned SDK converts a clipboard file through an HTML image
                  // paragraph. Its exact stream/caret expectation remains an assertion
                  // for the first native run, not a claimed source-only reproduction.
                  const pastedText = '\b\r' + initialText;
                  const pasted = await content(f, pastedText, 2);
                  evidence.storedImage = await storedImage(pasted);
                  await expect.poll(renderedPixels).toBeGreaterThan(1000);
                  expect(await mounted()).toBe(true);
                  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
                  expect(topLevelNavigations).toBe(navigationCount);
                  const pasteFrames = sync.slice(syncBeforePaste);
                  expect(pasteFrames.some((frame) => frame.type === 'ack')).toBe(true);
                  expect(
                    pasteFrames.some(
                      (frame) => frame.type === 'submit' && Number(frame.storedImageReferences) > 0,
                    ),
                  ).toBe(true);
                  expect(
                    pasteFrames.filter(
                      (frame) => frame.type === 'resync' || Number(frame.inlineImageReferences) > 0,
                    ),
                  ).toEqual([]);
                  await capture('after-paste');
                  await page.getByRole('button', { name: 'Undo', exact: true }).click();
                  const undone = await content(f, initialText);
                  expect(undone.body).toEqual(before.body);
                  expect(undone.drawingsOrder ?? []).toHaveLength(0);
                  await page.getByRole('button', { name: 'Redo', exact: true }).click();
                  const redone = await content(f, pastedText);
                  for (const key of ['body', 'drawings', 'drawingsOrder', 'resources'] as const)
                    expect(redone[key]).toEqual(pasted[key]);
                  expect(posts).toHaveLength(1);
                  expect(totalImagePosts).toBe(1);
                  expect(await mounted()).toBe(true);
                  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
                  expect(topLevelNavigations).toBe(navigationCount);
                  await capture('after-undo-redo');
                  await reopen(f, pasted);
                  const reopened = await f.read();
                  for (const key of ['body', 'drawings', 'drawingsOrder', 'resources'] as const)
                    expect(reopened[key]).toEqual(pasted[key]);
                  expect(await storedImage(reopened)).toEqual(evidence.storedImage);
                  await expect.poll(renderedPixels).toBeGreaterThan(1000);
                  await capture('after-intentional-reopen');
                },
                () => capture('final-before-cleanup'),
              );
            },
            { beforeOpen },
          ),
        async () => {
          evidence.observationFailures = observationFailures;
          evidence.droppedSyncFrames = droppedSyncFrames;
          evidence.topLevelNavigations = topLevelNavigations;
          evidence.totalImagePosts = totalImagePosts;
          await info.attach('doc-image-paste-evidence', {
            body: JSON.stringify(evidence, null, 2),
            contentType: 'application/json',
          });
        },
      );
    },
  );
});

test('document UI preserves rich text and embedded images through reload and offline recovery', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  const network = await interruptibleNetwork(context);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const db = openDatabase(
    testInfo.project.name === 'development'
      ? 'test-results/development/app.sqlite'
      : 'test-results/production/app.sqlite',
  );
  const auth = new AuthStore(db);
  const user = auth.createUser('Docs ' + testInfo.testId);
  const item = new WorkspaceStore(auth).create(user.id, {
    name: 'Journal',
    kind: 'doc',
    parentId: null,
  });
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(user.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const errors: string[] = [];
  let releaseImage = () => {};
  page.on('pageerror', (error) => errors.push(error.message));
  const read = async () =>
    (await (await context.request.get(`/api/items/${item.id}/doc`)).json()).snapshot;
  try {
    await page.goto(`/?item=${item.id}`);
    const editor = page.getByRole('region', { name: 'Doc document', exact: true });
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    await editor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await page.keyboard.type('/');
    await expect(page.getByText('Insert Image', { exact: true })).toBeVisible();
    await expect(page.getByText('Insert Shape', { exact: true })).not.toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('My journal');
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/items/${item.id}/doc`)).json()).snapshot.body
            .dataStream,
      )
      .toContain('My journal');
    await editor
      .getByRole('toolbar', { name: 'Start' })
      .getByText('Normal', { exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Heading 1', exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('First item');
    await page.keyboard.press('Control+Shift+8');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second item');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Reference link');
    // Finish the text edit before selecting a different toolbar. A pending editor
    // update can otherwise restore Start after the test has already clicked Insert.
    await expect.poll(async () => (await read()).body.dataStream).toContain('Reference link');
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
    );
    await page.keyboard.press('Shift+Home');
    const insertTab = editor.getByRole('tab', { name: 'Insert', exact: true });
    await insertTab.click();
    await expect(insertTab).toHaveAttribute('aria-selected', 'true');
    await editor.getByRole('button', { name: 'Add link', exact: true }).click();
    const linkInput = page.getByRole('textbox', { name: '', exact: true });
    await linkInput.fill('https://example.com/journal');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).not.toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(editor.getByRole('button', { name: 'Image', exact: true })).toBeEnabled();
    let imageRequested = false;
    const delayedImage = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    await page.route(`**/api/items/${item.id}/images/*`, async (route) => {
      imageRequested = true;
      await delayedImage;
      await route.continue();
    });
    const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
    await editor.getByRole('button', { name: 'Image', exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'orange.png',
      mimeType: 'image/png',
      buffer: await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff9900' } })
        .png()
        .toBuffer(),
    });
    await expect.poll(() => imageRequested).toBe(true);
    await expect(editor.getByRole('status', { name: 'Save status' })).toContainText(
      'Inserting image',
    );
    const navigationWarning = page.waitForEvent('dialog');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Back to files', exact: true }).click();
    await navigationWarning;
    await expect(page).toHaveURL(new RegExp(item.id));
    releaseImage();
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/items/${item.id}/doc`)).json()).snapshot
            .drawingsOrder.length,
      )
      .toBe(1);
    await page.unroute(`**/api/items/${item.id}/images/*`);

    const surface = editor.locator('.univer-container');
    // The document is canvas-rendered; click the visible heading to restore text focus.
    await surface.click({ position: { x: 130, y: 200 } });
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await editor.getByRole('button', { name: 'Table', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Insert Table', exact: true }).click();
    const tableDialog = page.getByRole('dialog', { name: 'Insert Table' });
    await tableDialog.getByRole('textbox').nth(0).fill('2');
    await tableDialog.getByRole('textbox').nth(1).fill('2');
    await tableDialog.getByRole('button', { name: 'ok', exact: true }).click();
    await expect(tableDialog).not.toBeVisible();
    await surface.click({ position: { x: 115, y: 350 } });
    await page.keyboard.type('Table cell');
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
    );
    await page.keyboard.press('Control+End');
    await page.keyboard.press('ArrowDown');

    await expect.poll(async () => (await read()).body.dataStream).toContain('Table cell');
    const before = await read();
    expect(before.body.paragraphs[0].paragraphStyle.namedStyleType).toBe(4);
    expect(
      before.body.paragraphs.filter((paragraph: { bullet?: unknown }) => paragraph.bullet),
    ).toHaveLength(2);
    expect(before.body.customRanges[0].properties.url).toBe('https://example.com/journal');
    expect(before.body.tables).toHaveLength(1);
    expect(Object.keys(before.tableSource)).toHaveLength(1);
    expect(before.drawingsOrder).toHaveLength(1);
    const imageUrl = before.drawings[before.drawingsOrder[0]].source;
    const imageResponse = await context.request.get(imageUrl);
    expect(imageResponse.ok()).toBe(true);
    expect((await sharp(await imageResponse.body()).metadata()).width).toBe(20);
    await page.reload();
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await expect(editor.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
    await editor.getByRole('tab', { name: 'Insert', exact: true }).click();
    const after = await read();
    for (const key of ['body', 'tableSource', 'drawings', 'drawingsOrder', 'resources'])
      expect(after[key]).toEqual(before[key]);
    await page.screenshot({ path: testInfo.outputPath('document-reloaded.png') });
    await surface.click({ position: { x: 130, y: 200 } });
    await page.keyboard.press('Home');
    await network.setOffline(true);
    await page.keyboard.type('Offline ');
    await expect(editor.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    // Theatre resizes the existing editor; unsaved work must survive both toggles.
    const mountedCanvas = await surface.elementHandle();
    await expect(page.getByRole('searchbox', { name: 'Search files' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Enter theatre mode', exact: true }).click();
    await expect(editor).toBeVisible();
    expect(await mountedCanvas!.evaluate((node) => node.isConnected)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('unsaved-editor-theatre.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Exit theatre mode', exact: true }).click();
    await expect(editor.getByRole('status', { name: 'Save status' })).toContainText('not saved');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(item.id));
    expect(await mountedCanvas!.evaluate((node) => node.isConnected)).toBe(true);
    await network.setOffline(false);
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 20000 },
    );
    await expect.poll(async () => (await read()).body.dataStream).toContain('Offline ');
    await page.reload();
    await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 20000 },
    );
    expect((await read()).body.dataStream).toContain('Offline ');
    expect(errors).toEqual([]);
  } finally {
    releaseImage();
    await network.setOffline(false);
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});
