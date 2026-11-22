import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page, Request, TestInfo } from '@playwright/test';
import { CustomRangeType, getDocsEmptySnapshot, validateDocumentStructure } from '@univerjs/core';
import type { IDocumentBody, IDocumentData } from '@univerjs/core';
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
import type { EditingFixture } from './doc-editing.ts';
import { textPoint } from './doc-touch.ts';
import { nativeTheme } from './native-theme.ts';
import { withFixtureCleanup } from './owned-process.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import {
  permissionNotices,
  protectionMessage,
  recordPermissionNotices,
} from './permission-notices.ts';

function storedDateField(id: string): IDocumentBody {
  const cached = '2000-01-01';
  const dataStream = `\x1f${cached}\x1e\r\n`;
  return {
    dataStream,
    paragraphs: [{ startIndex: dataStream.length - 2, paragraphId: `${id}-paragraph` }],
    customRanges: [
      {
        rangeId: id,
        rangeType: CustomRangeType.FIELD,
        startIndex: 0,
        endIndex: cached.length + 1,
        wholeEntity: false,
        properties: {
          fieldType: 'DATE',
          instruction: 'DATE \\@ "yyyy-MM-dd"',
          cachedResult: cached,
        },
      },
    ],
  };
}

for (const phone of [false, true])
  for (const role of ['account', 'guest'] as const)
    test(`${phone ? 'phone' : 'desktop'} ${role} Doc viewer opens plain and dated documents without a protection warning`, async ({
      browser,
      baseURL,
    }, info) => {
      test.setTimeout(150_000);
      const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
      const auth = new AuthStore(db),
        workspace = new WorkspaceStore(auth);
      const owner = auth.createUser(`Startup owner ${info.testId}`);
      const viewer = auth.createUser(`Startup viewer ${info.testId}`);
      const contexts: BrowserContext[] = [];
      const failures: string[] = [];
      const cookie = (userId: string) => ({
        name: COOKIE_NAME,
        value: auth.createSession(userId).token,
        url: baseURL!.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict' as const,
      });
      try {
        const ownerContext = await browser.newContext({
          baseURL,
          viewport: { width: 1280, height: 960 },
        });
        contexts.push(ownerContext);
        await ownerContext.addCookies([cookie(owner.id)]);
        for (const fields of [true, false]) {
          const item = workspace.create(owner.id, {
            name: fields ? 'Saved date fields' : 'Plain reading',
            kind: 'doc',
            parentId: null,
          });
          const snapshot = getDocsEmptySnapshot(item.id);
          snapshot.body = {
            dataStream: 'Phone journal\r\n',
            paragraphs: [{ startIndex: 13, paragraphId: 'body-paragraph' }],
            sectionBreaks: [{ startIndex: 14, sectionId: 'body-section' }],
          };
          if (fields) {
            snapshot.headers = { top: { headerId: 'top', body: storedDateField('header-date') } };
            snapshot.footers = {
              bottom: { footerId: 'bottom', body: storedDateField('footer-date') },
            };
            snapshot.documentStyle.defaultHeaderId = 'top';
            snapshot.documentStyle.defaultFooterId = 'bottom';
          }
          expect(validateDocumentStructure(snapshot)).toEqual([]);
          new DocumentStore(workspace).save(owner.id, item.id, {
            snapshot,
            revision: 0,
            writeId: crypto.randomUUID(),
          });
          workspace.share(owner.id, item.id, viewer.id, 'viewer');
          const context = await browser.newContext({
            baseURL,
            viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 960 },
            isMobile: phone,
            hasTouch: phone,
            deviceScaleFactor: 1,
            colorScheme: 'light',
            reducedMotion: 'reduce',
          });
          contexts.push(context);
          await recordPermissionNotices(context);
          let path = `/?item=${item.id}`;
          if (role === 'account') await context.addCookies([cookie(viewer.id)]);
          else {
            const link = workspace.links.begin(item.id, 'viewer');
            workspace.links.finish(item.id, link.epoch, true);
            path = `/share/${item.id}#${link.token}`;
          }
          const legacy = () =>
            db.prepare('SELECT * FROM doc_snapshots WHERE item_id=?').get(item.id);
          const grants = () => ({
            account: db
              .prepare('SELECT * FROM workspace_grants WHERE item_id=? ORDER BY user_id')
              .all(item.id),
            link: db.prepare('SELECT * FROM workspace_links WHERE item_id=?').get(item.id),
          });
          const originalLegacy = legacy();
          const originalGrants = grants();
          // Prepare as the owner before the viewer can navigate. The service
          // controls separately prove first-viewer preparation; this baseline
          // must include native resources/revision without normalizing them away.
          const prepared = await ownerContext.request.post(`/api/items/${item.id}/collaboration`, {
            headers: { Origin: baseURL! },
            data: {},
          });
          const preparation = await prepared.json().catch(() => null);
          const safeErrors = [
            'Open Spinel at its configured address and try again.',
            'Sign in to continue.',
            'Collaboration is not available.',
          ];
          expect(
            prepared.ok(),
            JSON.stringify({
              status: prepared.status(),
              error: safeErrors.includes(preparation?.error)
                ? preparation.error
                : 'No allowlisted preparation error',
            }),
          ).toBe(true);
          const { unitId } = preparation;
          expect(unitId).toBe(item.id);
          const head = () =>
            db.prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?').get(unitId);
          const receipts = () =>
            db.prepare('SELECT * FROM spinel_sync_revisions WHERE unit_id=?').all(unitId);
          const read = async () => {
            const response = await ownerContext.request.get(`/api/items/${item.id}/doc`);
            expect(response.ok()).toBe(true);
            return (await response.json()).snapshot as IDocumentData;
          };
          const original = await read();
          const originalHead = head();
          expect(originalHead?.revision).toBe(1);
          expect(original.rev).toBe(1);
          expect(JSON.parse(String(originalHead?.snapshot))).toEqual(original);
          expect(original.body).toEqual(snapshot.body);
          expect(original.headers).toEqual(snapshot.headers);
          expect(original.footers).toEqual(snapshot.footers);
          expect(original.documentStyle).toEqual(snapshot.documentStyle);
          const unchanged = async () => {
            expect(await read()).toEqual(original);
            expect(head()).toEqual(originalHead);
            expect(head()?.revision).toBe(1);
            expect(receipts()).toEqual([]);
            expect(legacy()).toEqual(originalLegacy);
            expect(grants()).toEqual(originalGrants);
          };
          await unchanged();
          const page = await context.newPage();
          page.on('pageerror', (error) => failures.push(error.message));
          const status = page.getByRole('status', { name: 'Save status' });
          await page.goto(path);
          for (const reload of [false, true]) {
            if (reload) await page.reload();
            await expect(status).toContainText('View only', { timeout: 30_000 });
            await expect(page.getByLabel('Document canvas', { exact: true })).toBeVisible();
            expect(await permissionNotices(page)).toEqual([]);
            await expect(page.getByText(protectionMessage, { exact: true })).toHaveCount(0);
            await unchanged();
          }
          if (fields && ((role === 'account' && !phone) || (role === 'guest' && phone))) {
            for (const theme of ['light', 'dark'] as const) {
              await page.emulateMedia({ colorScheme: theme });
              await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
              await page.screenshot({
                path: info.outputPath(
                  `spn-106-${role}-${phone ? '390px' : 'desktop'}-${theme}.png`,
                ),
                fullPage: true,
              });
            }
          }
          // This journey owns startup/persistence and the actual HTTP fence.
          // Native mutation refusal and its visible warning are exercised by
          // the ViewerDeniedEdit story through the mounted public Doc API.
          if (role === 'account') {
            const denied = await context.request.put(`/api/items/${item.id}/doc`, {
              headers: { Origin: baseURL! },
              data: { snapshot: original, revision: 1, writeId: crypto.randomUUID() },
            });
            expect(denied.status()).toBe(403);
          } else expect((await context.request.get('/api/items')).status()).toBe(401);
          await unchanged();

          if (!fields) {
            // Keep an authorized native editor alongside the reader; its real
            // edit must persist while the viewer grant remains unchanged.
            const editor = await ownerContext.newPage();
            editor.on('pageerror', (error) => failures.push(error.message));
            await editor.goto(`/?item=${item.id}`);
            await expect(editor.getByRole('status', { name: 'Save status' })).toHaveText(
              'All changes saved.',
              { timeout: 30_000 },
            );
            const point = await textPoint(editor);
            await editor.mouse.click(point.x, point.y);
            await editor.keyboard.type('Authorized ');
            await expect.poll(async () => (await read()).body?.dataStream).toContain('Authorized ');
            await expect(status).toContainText('View only');
            if (role === 'guest') {
              const revoke = await ownerContext.request.put(`/api/items/${item.id}/link`, {
                headers: { Origin: baseURL! },
                data: { role: null },
              });
              expect(revoke.ok()).toBe(true);
              await expect(
                page.getByText('This link no longer works.', { exact: true }),
              ).toBeVisible({ timeout: 30_000 });
              await expect(page.getByLabel('Document canvas', { exact: true })).toHaveCount(0);
            }
            await editor.close();
          }
          await page.close();
          await context.close();
        }
        expect(failures).toEqual([]);
      } finally {
        for (const context of contexts) await context.close();
        db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
        for (const user of [owner, viewer])
          db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
        db.close();
      }
    });
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

/** Replay replaces the inserted paragraph/drawing; the pre-existing body stays exact. */
function expectOriginalBodyAfterImage(saved: IDocumentData, original: IDocumentData) {
  const body = structuredClone(saved.body!);
  expect(body.dataStream.slice(0, 2)).toBe('\b\r');
  expect(body.customBlocks).toEqual([{ startIndex: 0, blockId: saved.drawingsOrder![0] }]);
  body.dataStream = body.dataStream.slice(2);
  body.textRuns = body
    .textRuns!.filter((run) => run.ed > 2)
    .map((run) => ({ ...run, st: Math.max(run.st, 2) - 2, ed: run.ed - 2 }));
  body.paragraphs = body
    .paragraphs!.filter((paragraph) => paragraph.startIndex >= 2)
    .map((paragraph) => ({ ...paragraph, startIndex: paragraph.startIndex - 2 }));
  body.sectionBreaks = body.sectionBreaks!.map((section) => ({
    ...section,
    startIndex: section.startIndex - 2,
  }));
  body.customBlocks = [];
  expect(body).toEqual(original.body);
}

type ImagePostEvidence = {
  mime: string;
  // True means Playwright returned a Buffer, including an exposed empty Buffer.
  bodyExposed: boolean;
  bytes: number | null;
  sha256: string | null;
  status?: number;
};

type ClipboardDoc = EditingFixture & {
  png: Buffer;
  posts: ImagePostEvidence[];
  paste(
    format: 'png' | 'html' | 'text',
    text?: string,
    imageSource?: string,
    entry?: 'source-menu' | 'text-menu',
  ): Promise<void>;
  capture(stage: string): Promise<void>;
  assertMounted(): Promise<void>;
};

/** The negative cases use the same real native Doc fixture and clipboard boundary. */
async function withClipboardDoc(
  browser: Browser,
  baseURL: string,
  info: TestInfo,
  work: (f: ClipboardDoc) => Promise<void>,
  options: { viewer?: boolean; collaborator?: boolean; mobile?: boolean } = {},
) {
  const { viewer = false, collaborator = false, mobile = false } = options;
  expect(info.retry).toBe(0);
  const png = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: 23, g: 201, b: 151 } },
  })
    .png()
    .toBuffer();
  const posts: ClipboardDoc['posts'] = [];
  const requests = new Map<Request, (typeof posts)[number]>();
  const stages: Record<string, unknown>[] = [];
  const clipboard: Record<string, unknown>[] = [];
  let navigations = 0;
  let imagePostCount = 0;
  const evidence = {
    source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    project: info.project.name,
    attempt: info.retry,
    browser: browser.version(),
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
    fixture: { mime: 'image/png', width: 80, height: 60, bytes: png.length, sha256: sha256(png) },
    viewer,
    posts,
    clipboard,
    stages,
  };
  const beforeOpen = async (page: Page) => {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    page.on('request', (request) => {
      if (
        request.method() !== 'POST' ||
        !/^\/api\/items\/[^/]+\/images$/.test(new URL(request.url()).pathname)
      )
        return;
      imagePostCount++;
      if (posts.length === 8) return;
      // Playwright can omit Blob request bodies. Absence is not an empty upload.
      const body = request.postDataBuffer();
      const post = {
        mime: request.headers()['content-type'] ?? '',
        bodyExposed: body !== null,
        bytes: body?.length ?? null,
        sha256: body === null ? null : sha256(body),
      };
      posts.push(post);
      requests.set(request, post);
    });
    page.on('response', (response) => {
      const post = requests.get(response.request());
      if (post) post.status = response.status();
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
        baseURL,
        info,
        mobile,
        async (f) => {
          const { page } = f;
          await f.context.grantPermissions(['clipboard-read', 'clipboard-write']);
          const canvas = page
            .getByRole('region', { name: 'Doc document', exact: true })
            .getByLabel('Document canvas', { exact: true });
          const originalCanvas = await canvas.elementHandle();
          expect(originalCanvas).not.toBeNull();
          const origin = await page.evaluate(() => performance.timeOrigin);
          const initialNavigations = navigations;
          const mounted = () =>
            originalCanvas!.evaluate((node) => node.isConnected).catch(() => false);
          const capture = async (stage: string) => {
            stages.push({
              stage,
              native: await readEditingSelection(page).catch(() => undefined),
              saved: await f.read().catch(() => undefined),
              originalCanvasMounted: await mounted(),
              navigations,
              imagePostCount,
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
          const paste: ClipboardDoc['paste'] = async (format, text = '', imageSource, entry) => {
            const mime =
              format === 'png' ? 'image/png' : format === 'html' ? 'text/html' : 'text/plain';
            const source = imageSource ?? `data:image/png;base64,${png.toString('base64')}`;
            const html = `<p><img src="${source}" width="80" height="60"></p>`;
            const value = format === 'png' ? Array.from(png) : format === 'html' ? html : text;
            const before = await page.evaluate(
              () => (window as ImagePasteWindow).imagePasteEvents!.length,
            );
            const readback = await page.evaluate(
              async ({ mime, value, text }) => {
                const blob = new Blob([Array.isArray(value) ? new Uint8Array(value) : value], {
                  type: mime,
                });
                await navigator.clipboard.write([
                  new ClipboardItem({
                    [mime]: blob,
                    ...(mime === 'text/html' && text
                      ? { 'text/plain': new Blob([text], { type: 'text/plain' }) }
                      : {}),
                  }),
                ]);
                const item = (await navigator.clipboard.read()).find((item) =>
                  item.types.includes(mime),
                );
                if (!item) throw new Error('The native clipboard is missing its expected format.');
                return Array.from(new Uint8Array(await (await item.getType(mime)).arrayBuffer()));
              },
              { mime, value, text },
            );
            const bytes = Buffer.from(readback);
            clipboard.push({ format, mime, bytes: bytes.length, sha256: sha256(bytes) });
            if (format === 'png') {
              expect(await sharp(bytes).removeAlpha().raw().toBuffer()).toEqual(
                await sharp(png).removeAlpha().raw().toBuffer(),
              );
            } else if (format === 'html') {
              // Browser sanitization can wrap HTML; it must retain this exact image.
              expect(bytes.toString()).toContain(`src="${source}"`);
            } else expect(bytes.toString()).toBe(text);
            if (entry) {
              await page
                .getByRole('region', { name: 'Doc document', exact: true })
                .getByRole('button', { name: 'Paste special', exact: true })
                .click();
              await page
                .getByText(entry === 'text-menu' ? 'Keep text only' : 'Keep source formatting', {
                  exact: true,
                })
                .click();
              // Native menu reads ClipboardItems directly; no ClipboardEvent is expected.
              return;
            }
            await page.keyboard.press('ControlOrMeta+v');
            await expect
              .poll(() =>
                page.evaluate(() => (window as ImagePasteWindow).imagePasteEvents!.length),
              )
              .toBe(before + 1);
            const observed = await page.evaluate(() =>
              (window as ImagePasteWindow).imagePasteEvents!.at(-1),
            );
            expect(observed?.trusted).toBe(true);
            expect(observed?.types).toContain(format === 'png' ? 'Files' : mime);
            expect(observed?.files).toEqual(
              format === 'png' ? [{ mime: 'image/png', bytes: expect.any(Number) }] : [],
            );
          };
          await withFixtureCleanup(
            async () => {
              expect(await page.evaluate(() => navigator.onLine)).toBe(true);
              if (!viewer) {
                await f.focus();
                await placeCaret(f, 0);
                await content(f, f.initial.body!.dataStream, 0);
              }
              await capture('before-paste');
              await work({
                ...f,
                png,
                posts,
                paste,
                capture,
                async assertMounted() {
                  expect(await mounted()).toBe(true);
                  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
                  expect(navigations).toBe(initialNavigations);
                  expect(imagePostCount).toBe(posts.length);
                },
              });
            },
            () => capture('final-before-cleanup'),
          );
        },
        { viewer, collaborator, beforeOpen },
      ),
    () =>
      info.attach('doc-image-paste-negative-evidence', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      }),
  );
}

function expectNoImages(snapshot: IDocumentData) {
  expect(snapshot.drawingsOrder ?? []).toEqual([]);
  expect(Object.keys(snapshot.drawings ?? {})).toEqual([]);
  expect(JSON.stringify(snapshot)).not.toContain('data:image/');
}

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
      const posts: ImagePostEvidence[] = [];
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
          // Preserve whether Playwright exposed a body; never invent wire bytes.
          const body = request.postDataBuffer();
          const post = {
            mime: request.headers()['content-type'] ?? '',
            bodyExposed: body !== null,
            bytes: body?.length ?? null,
            sha256: body === null ? null : sha256(body),
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
                  expect(droppedSyncFrames, 'Native sync observations must be complete').toBe(0);
                  expect(observationFailures, 'Native sync observations must be readable').toBe(0);
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
  clipboardTest(
    'HTML image upload failure keeps the edit and allows a later native paste',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(90_000);
      await withClipboardDoc(browser, baseURL!, info, async (f) => {
        const { page } = f;
        const before = await f.read();
        const initialText = before.body!.dataStream;
        const status = page.getByRole('status', { name: 'Save status' });
        const editor = page.getByRole('region', { name: 'Doc document', exact: true });
        for (const navigate of [false, true]) {
          await f.focus();
          await placeCaret(f, 0);
          let release!: () => void;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          let intercepted = false;
          await page.route(`**/api/items/${f.id}/images`, async (route) => {
            intercepted = true;
            await held;
            await route.fulfill({
              status: 503,
              contentType: 'text/html',
              body: '<p>private upstream parser detail</p>',
            });
          });
          await withFixtureCleanup(
            async () => {
              await f.paste('html');
              await expect.poll(() => intercepted).toBe(true);
              await expect(status).toHaveText('Inserting image — keep this tab open.');
              expect((await readEditingSelection(page))?.text).toBe(initialText);
              // First prove HTML failure with the selection untouched: navigation
              // could itself cancel native paste and hide a null-hook/base64 fallback.
              if (navigate) {
                const warning = page.waitForEvent('dialog');
                page.once('dialog', (dialog) => dialog.dismiss());
                await page.getByRole('button', { name: 'Back to files', exact: true }).click();
                expect((await warning).type()).toBe('confirm');
              }
              await f.assertMounted();
              await expect(status).toHaveText('Inserting image — keep this tab open.');
              await f.capture(navigate ? 'held-html-upload-navigation-guard' : 'held-html-upload');
              release();
              await expect
                .poll(() => f.posts.map((post) => post.status))
                .toEqual(navigate ? [503, 503] : [503]);
              await expect(editor.getByRole('alert')).toHaveText(
                'Image upload failed. Check your connection and retry.',
              );
              const unchanged = await content(f, initialText, navigate ? undefined : 0);
              expect(unchanged.body).toEqual(before.body);
              expectNoImages(unchanged);
              await f.assertMounted();
              await f.capture(
                navigate ? 'failed-html-upload-after-navigation-guard' : 'failed-html-upload',
              );
            },
            async () => {
              release();
              await page.unrouteAll({ behavior: 'wait' });
            },
          );
          if (!navigate) {
            // This separate native action follows a previous upload error. Its
            // own source refusal must replace that stale feedback without upload.
            const otherDocumentId = crypto.randomUUID();
            expect(otherDocumentId).not.toBe(f.id);
            const foreignSource = new URL(
              `/api/items/${otherDocumentId}/images/${sha256(f.png)}`,
              page.url(),
            ).href;
            await f.paste('html', undefined, foreignSource);
            await expect(editor.getByRole('alert')).toHaveText(
              'This image cannot be pasted. Insert it from a file instead.',
            );
            const refused = await content(f, initialText, 0);
            expect(refused.body).toEqual(before.body);
            expectNoImages(refused);
            expect(f.posts.map((post) => post.status)).toEqual([503]);
            await f.assertMounted();
            await f.capture('foreign-document-html-source-refused');
          }
        }
        // These are actual application feedback views, not a second clipboard run.
        const canvas = editor.getByLabel('Document canvas', { exact: true });
        for (const theme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await nativeTheme(page, canvas, theme);
          await info.attach(`spn154-html-upload-failure-${theme}`, {
            body: await page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
        }
        await page.emulateMedia({ colorScheme: 'light' });
        await nativeTheme(page, canvas, 'light');
        await f.focus();
        await placeCaret(f, 0);
        // A distinct successful action after the injected failure was removed.
        // Never retry the failed user action without retaining its first outcome.
        await f.paste('html');
        await expect.poll(() => f.posts.map((post) => post.status)).toEqual([503, 503, 201]);
        expect(f.posts.map((post) => post.mime)).toEqual(['image/png', 'image/png', 'image/png']);
        const pasted = await content(f, '\b\r' + initialText, 2);
        expect(pasted.drawingsOrder).toHaveLength(1);
        const drawing = pasted.drawings?.[pasted.drawingsOrder![0]];
        if (!drawing || !('source' in drawing) || typeof drawing.source !== 'string')
          throw new Error('The pasted HTML image has no stored source.');
        expect(drawing.source).toMatch(new RegExp(`^/api/items/${f.id}/images/[a-f0-9]{64}$`));
        const response = await f.context.request.get(drawing.source);
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('image/png');
        const stored = await response.body();
        expect(drawing.source.endsWith(sha256(stored))).toBe(true);
        expect(await sharp(stored).removeAlpha().raw().toBuffer()).toEqual(
          await sharp(f.png).removeAlpha().raw().toBuffer(),
        );
        await expect
          .poll(async () => {
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
          })
          .toBeGreaterThan(1000);
        await expect(editor.getByRole('alert')).toHaveCount(0);
        await f.assertMounted();
        await f.capture('successful-html-paste');
        await info.attach('spn154-html-paste-success-light', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        await reopen(f, pasted);
        const reopened = await f.read();
        for (const key of ['body', 'drawings', 'drawingsOrder', 'resources'] as const)
          expect(reopened[key]).toEqual(pasted[key]);
        expect(await (await f.context.request.get(drawing.source)).body()).toEqual(stored);
        await f.capture('reopened-html-paste');
      });
    },
  );

  for (const change of ['selection', 'content'] as const) {
    clipboardTest(
      `native PNG preparation cancels after a ${change} change`,
      async ({ browser, baseURL }, info) => {
        clipboardTest.setTimeout(60_000);
        await withClipboardDoc(browser, baseURL!, info, async (f) => {
          const { page } = f;
          const before = await f.read();
          let release!: () => void;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          let uploadedStatus: number | undefined;
          await page.route(`**/api/items/${f.id}/images`, async (route) => {
            // Use the real authenticated upload; hold only its response while the
            // native selection/mutation generation changes underneath preparation.
            const response = await route.fetch();
            uploadedStatus = response.status();
            await held;
            await route.fulfill({ response });
          });
          await withFixtureCleanup(
            async () => {
              await f.paste('png');
              await expect.poll(() => uploadedStatus).toBe(201);
              await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
                'Inserting image — keep this tab open.',
              );
              if (change === 'selection') await page.keyboard.press('ArrowRight');
              // Delete changes content while retaining caret 0, separately proving
              // mutation cancellation instead of repeating selection cancellation.
              else await page.keyboard.press('Delete');
              const text =
                change === 'content' ? before.body!.dataStream.slice(1) : before.body!.dataStream;
              const caret = change === 'selection' ? 1 : 0;
              await expect
                .poll(async () => {
                  const current = await readEditingSelection(page);
                  return { text: current?.text, start: current?.start, end: current?.end };
                })
                .toEqual({ text, start: caret, end: caret });
              await f.capture(`held-upload-after-${change}`);
              release();
              await expect.poll(() => f.posts.map((post) => post.status)).toEqual([201]);
              const retained = await content(f, text, caret);
              expectNoImages(retained);
              if (change === 'selection') expect(retained.body).toEqual(before.body);
              await expect(
                page.getByRole('region', { name: 'Doc document', exact: true }).getByRole('alert'),
              ).toHaveCount(0);
              await f.assertMounted();
              await f.capture('preparation-cancelled');
              await reopen(f, retained);
              expectNoImages(await f.read());
              await f.capture('after-intentional-reopen');
            },
            async () => {
              release();
              await page.unrouteAll({ behavior: 'wait' });
            },
          );
        });
      },
    );
  }

  clipboardTest(
    'native image menu and cached formatting replay retain content and history',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(60_000);
      await withClipboardDoc(browser, baseURL!, info, async (f) => {
        const before = await f.read();
        await f.paste('png', undefined, undefined, 'source-menu');
        const pasted = await content(f, '\b\r' + before.body!.dataStream, 2);
        expect(pasted.drawingsOrder).toHaveLength(1);
        expectOriginalBodyAfterImage(pasted, before);
        expect(f.posts.map((post) => post.status)).toEqual([201]);
        await f.assertMounted();
        await f.capture('native-menu-paste');
        for (const mode of ['Match destination formatting', 'Keep source formatting']) {
          const previousRevision = await f.revision();
          await f.page.getByRole('button', { name: 'Paste options', exact: true }).click();
          await f.page.getByRole('menuitemcheckbox', { name: mode, exact: true }).click();
          await expect.poll(() => f.revision()).toBeGreaterThan(previousRevision);
          await f.page.getByRole('button', { name: 'Paste options', exact: true }).click();
          await expect(
            f.page.getByRole('menuitemcheckbox', { name: mode, exact: true }),
          ).toHaveAttribute('aria-checked', 'true');
          // Escape intentionally dismisses the native replay session, not just its menu.
          await f.page.getByRole('button', { name: 'Paste options', exact: true }).click();
          await expect(
            f.page.getByRole('menuitemcheckbox', { name: mode, exact: true }),
          ).toHaveCount(0);
          await expect(
            f.page.getByRole('button', { name: 'Paste options', exact: true }),
          ).toBeVisible();
          await expect(f.page.getByRole('status', { name: 'Save status' })).toHaveText(
            'All changes saved.',
          );
          const replayed = await content(f, pasted.body!.dataStream);
          expectOriginalBodyAfterImage(replayed, before);
          expect(replayed.drawingsOrder).toHaveLength(1);
          const drawingId = replayed.drawingsOrder![0];
          expect(replayed.drawings).toEqual({
            [drawingId]: { ...pasted.drawings![pasted.drawingsOrder![0]], drawingId },
          });
          expect(
            replayed.resources?.filter((resource) => resource.name !== 'DOC_DRAWING_PLUGIN'),
          ).toEqual(pasted.resources?.filter((resource) => resource.name !== 'DOC_DRAWING_PLUGIN'));
          const drawingResource = replayed.resources?.find(
            (resource) => resource.name === 'DOC_DRAWING_PLUGIN',
          );
          expect(JSON.parse(drawingResource!.data)).toEqual({
            data: replayed.drawings,
            order: replayed.drawingsOrder,
          });
          expect(f.posts.map((post) => post.status)).toEqual([201]);
          await f.assertMounted();
          await f.capture(mode);
        }
        const finalReplay = await f.read();
        await f.page.getByRole('button', { name: 'Undo', exact: true }).click();
        expect((await content(f, before.body!.dataStream)).body).toEqual(before.body);
        await f.page.getByRole('button', { name: 'Redo', exact: true }).click();
        const redone = await content(f, pasted.body!.dataStream);
        expect(redone.body).toEqual(finalReplay.body);
        expect(redone.drawings).toEqual(finalReplay.drawings);
        await f.assertMounted();
        await reopen(f, redone);
        expect((await f.read()).drawings).toEqual(redone.drawings);
        expect(f.posts.map((post) => post.status)).toEqual([201]);
        await f.capture('menu-replay-history-reopened');
      });
    },
  );

  clipboardTest(
    'text-first native paste uploads only when switching to image formatting',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(60_000);
      await withClipboardDoc(browser, baseURL!, info, async (f) => {
        const before = await f.read();
        const caption = 'Clipboard ';
        await f.paste('html', caption, undefined, 'text-menu');
        const textOnly = await content(f, caption + before.body!.dataStream);
        expectNoImages(textOnly);
        expect(f.posts).toEqual([]);
        await f.assertMounted();
        await f.capture('text-first-no-upload');
        let imageSource: unknown;
        for (const mode of [
          'Keep source formatting',
          'Match destination formatting',
          'Keep text only',
          'Keep source formatting',
        ]) {
          const previousRevision = await f.revision();
          await f.page.getByRole('button', { name: 'Paste options', exact: true }).click();
          await f.page.getByRole('menuitemcheckbox', { name: mode, exact: true }).click();
          await expect.poll(() => f.revision()).toBeGreaterThan(previousRevision);
          await f.page.getByRole('button', { name: 'Paste options', exact: true }).click();
          await expect(
            f.page.getByRole('menuitemcheckbox', { name: mode, exact: true }),
          ).toHaveAttribute('aria-checked', 'true');
          await f.page.getByRole('button', { name: 'Paste options', exact: true }).click();
          await expect(
            f.page.getByRole('menuitemcheckbox', { name: mode, exact: true }),
          ).toHaveCount(0);
          await expect(
            f.page.getByRole('button', { name: 'Paste options', exact: true }),
          ).toBeVisible();
          const text =
            mode === 'Keep text only'
              ? caption + before.body!.dataStream
              : '\b\r' + before.body!.dataStream;
          const saved = await content(f, text);
          if (mode === 'Keep text only') expectNoImages(saved);
          else {
            expect(saved.drawingsOrder).toHaveLength(1);
            const drawing = saved.drawings?.[saved.drawingsOrder![0]];
            expect(drawing).toBeDefined();
            const source = drawing && 'source' in drawing ? drawing.source : undefined;
            expect(source).toMatch(new RegExp(`^/api/items/${f.id}/images/[a-f0-9]{64}$`));
            imageSource ??= source;
            expect(source).toBe(imageSource);
          }
          expect(f.posts.map((post) => post.status)).toEqual([201]);
          await f.assertMounted();
          await f.capture(mode);
        }
        const saved = await f.read();
        await reopen(f, saved);
        expect((await f.read()).drawings).toEqual(saved.drawings);
        await f.capture('text-first-source-reopened');
      });
    },
  );

  clipboardTest(
    'a completed image upload cannot publish after live edit authority is removed',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(60_000);
      await withClipboardDoc(
        browser,
        baseURL!,
        info,
        async (f) => {
          const before = await f.read();
          const beforeRevision = await f.revision();
          const nativeBefore = (await readEditingSelection(f.page))?.body;
          let release!: () => void;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          let uploaded: number | undefined;
          let storedSource: string | undefined;
          let delivered = false;
          let deliveryFailed = false;
          let clientOutcome: 'finished' | 'failed' | undefined;
          const imageRequest = (request: Request) =>
            request.method() === 'POST' &&
            new URL(request.url()).pathname === `/api/items/${f.id}/images`;
          f.page.on('requestfinished', (request) => {
            if (imageRequest(request)) clientOutcome = 'finished';
          });
          f.page.on('requestfailed', (request) => {
            if (imageRequest(request)) clientOutcome = 'failed';
          });
          let finished = false;
          await f.page.route(`**/api/items/${f.id}/images`, async (route) => {
            const response = await route.fetch();
            uploaded = response.status();
            storedSource = (await response.json()).url;
            await held;
            try {
              await route.fulfill({ response });
              delivered = true;
            } catch {
              deliveryFailed = true;
            } finally {
              finished = true;
              await response.dispose();
            }
          });
          await withFixtureCleanup(
            async () => {
              await f.paste('png');
              await expect.poll(() => uploaded).toBe(201);
              expect(storedSource).toMatch(new RegExp(`^/api/items/${f.id}/images/[a-f0-9]{64}$`));
              const stored = await f.image(storedSource!);
              expect(storedSource!.endsWith(sha256(stored))).toBe(true);
              expect(await sharp(stored).removeAlpha().raw().toBuffer()).toEqual(
                await sharp(f.png).removeAlpha().raw().toBuffer(),
              );
              await f.downgrade!();
              await expect(
                f.page.getByRole('button', { name: 'Bold', exact: true }),
              ).toBeDisabled();
              await f.capture('live-edit-fence-before-upload-release');
              release();
              await expect.poll(() => finished).toBe(true);
              await expect.poll(() => clientOutcome).toBeDefined();
              if (clientOutcome === 'finished') {
                expect(delivered).toBe(true);
                expect(f.posts.map((post) => post.status)).toEqual([201]);
              }
              await info.attach('late-upload-authority-outcome', {
                body: JSON.stringify({
                  serverStatus: uploaded,
                  delivered,
                  deliveryFailed,
                  clientOutcome,
                  storedSource,
                  storedSha256: sha256(stored),
                }),
                contentType: 'application/json',
              });
              expect(await f.image(storedSource!)).toEqual(stored);
              await expect(f.page.getByRole('status', { name: 'Save status' })).toHaveText(
                /Access changed|View only/,
              );
              expect(await f.read()).toEqual(before);
              expect(await f.revision()).toBe(beforeRevision);
              expect((await readEditingSelection(f.page))?.body).toEqual(nativeBefore);
              expectNoImages(await f.read());
              await f.assertMounted();
              await f.capture('late-success-refused');
              await reopen(f, before, 'View only.');
              expect((await readEditingSelection(f.page))?.body).toEqual(nativeBefore);
              expect(await f.read()).toEqual(before);
              expect(await f.revision()).toBe(beforeRevision);
              expectNoImages(await f.read());
              await f.capture('revoked-edit-reopened');
            },
            async () => {
              release();
              await f.page.unrouteAll({ behavior: 'wait' });
            },
          );
        },
        { collaborator: true },
      );
    },
  );

  clipboardTest(
    'phone-width native image failure retains the edit and complete feedback in both themes',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(60_000);
      await withClipboardDoc(
        browser,
        baseURL!,
        info,
        async (f) => {
          const before = await f.read();
          await f.page.route(`**/api/items/${f.id}/images`, (route) =>
            route.fulfill({ status: 503, body: 'private failure' }),
          );
          await f.paste('png');
          await expect.poll(() => f.posts.map((post) => post.status)).toEqual([503]);
          const editor = f.page.getByRole('region', { name: 'Doc document', exact: true });
          const alert = editor.getByRole('alert');
          await expect(alert).toHaveText('Image upload failed. Check your connection and retry.');
          expect((await content(f, before.body!.dataStream)).body).toEqual(before.body);
          expectNoImages(await f.read());
          await f.assertMounted();
          for (const theme of ['light', 'dark'] as const) {
            await f.page.emulateMedia({ colorScheme: theme });
            await nativeTheme(f.page, editor.getByLabel('Document canvas', { exact: true }), theme);
            expect(
              await alert.evaluate(
                (node) =>
                  node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
              ),
            ).toBe(true);
            await info.attach(`spn154-phone-upload-failure-${theme}`, {
              body: await f.page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
          }
          await f.capture('phone-emulation-failure');
        },
        { mobile: true },
      );
    },
  );

  clipboardTest(
    'native image denial and malformed HTML explain failure without changing content',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(60_000);
      await withClipboardDoc(browser, baseURL!, info, async (f) => {
        const before = await f.read();
        const editor = f.page.getByRole('region', { name: 'Doc document', exact: true });
        for (const [status, message] of [
          [401, 'Your sign-in ended. Sign in again to add an image.'],
          [403, 'Image not added. Check your edit access.'],
        ] as const) {
          // These are controlled HTTP denial responses. Live authority loss has
          // a separate real server grant-change case above.
          await f.page.route(`**/api/items/${f.id}/images`, (route) =>
            route.fulfill({ status, body: 'private proxy detail' }),
          );
          await f.paste('png');
          await expect(editor.getByRole('alert')).toHaveText(message);
          expect((await content(f, before.body!.dataStream, 0)).body).toEqual(before.body);
          expectNoImages(await f.read());
          await f.assertMounted();
          await f.capture(`http-${status}-refused`);
          await f.page.unrouteAll({ behavior: 'wait' });
        }
        expect(f.posts.map((post) => post.status)).toEqual([401, 403]);
        await f.paste('html', undefined, 'data:image/png;base64,!');
        await expect(editor.getByRole('alert')).toHaveText(
          'Could not paste. Copy the content and try again.',
        );
        expect((await content(f, before.body!.dataStream, 0)).body).toEqual(before.body);
        expectNoImages(await f.read());
        expect(f.posts.map((post) => post.status)).toEqual([401, 403]);
        await f.assertMounted();
        await f.capture('malformed-image-refused-before-upload');
      });
    },
  );

  clipboardTest(
    'denied native clipboard read keeps the edit and offers the system paste action',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(60_000);
      await withClipboardDoc(browser, baseURL!, info, async (f) => {
        const before = await f.read();
        const revision = await f.revision();
        await f.page.evaluate(async (bytes) => {
          await navigator.clipboard.write([
            new ClipboardItem({
              'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
            }),
          ]);
        }, Array.from(f.png));
        const cdp = await f.context.newCDPSession(f.page);
        try {
          const { targetInfo } = await cdp.send('Target.getTargetInfo');
          expect(targetInfo.browserContextId).toBeTruthy();
          await cdp.send('Browser.setPermission', {
            permission: { name: 'clipboard-read' },
            setting: 'denied',
            origin: new URL(baseURL!).origin,
            browserContextId: targetInfo.browserContextId,
          });
          expect(
            await f.page.evaluate(
              async () =>
                (await navigator.permissions.query({ name: 'clipboard-read' as PermissionName }))
                  .state,
            ),
          ).toBe('denied');
          await f.page.getByRole('button', { name: 'Paste special', exact: true }).click();
          await f.page.getByText('Keep source formatting', { exact: true }).click();
          await expect(f.page.getByText(/Clipboard access is unavailable\. Press/)).toBeVisible();
          expect((await content(f, before.body!.dataStream)).body).toEqual(before.body);
          expect(await f.revision()).toBe(revision);
          expectNoImages(await f.read());
          expect(f.posts).toEqual([]);
          await f.assertMounted();
          await f.capture('native-clipboard-permission-denied');
        } finally {
          await cdp.detach();
        }
      });
    },
  );

  clipboardTest(
    'a viewer cannot paste a native clipboard image',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(60_000);
      await withClipboardDoc(
        browser,
        baseURL!,
        info,
        async (f) => {
          const before = await f.read();
          const nativeBefore = (await readEditingSelection(f.page))!.body;
          const point = await textPoint(f.page);
          await f.page.mouse.click(point.x, point.y);
          await f.paste('png');
          await expect(f.page.getByRole('status', { name: 'Save status' })).toHaveText(
            'View only.',
          );
          expect((await readEditingSelection(f.page))?.body).toEqual(nativeBefore);
          expect((await f.read()).body).toEqual(before.body);
          expectNoImages(await f.read());
          expect(f.posts).toEqual([]);
          await f.assertMounted();
          await f.capture('viewer-paste-denied');
          await reopen(f, before, 'View only.');
          expect((await readEditingSelection(f.page))?.body).toEqual(nativeBefore);
          expectNoImages(await f.read());
          expect(f.posts).toEqual([]);
          await f.capture('after-intentional-reopen');
        },
        { viewer: true },
      );
    },
  );

  clipboardTest(
    'ordinary native text paste keeps formatting and undo history',
    async ({ browser, baseURL }, info) => {
      clipboardTest.setTimeout(60_000);
      await withClipboardDoc(browser, baseURL!, info, async (f) => {
        const before = await f.read();
        const text = 'Clipboard ';
        await f.paste('text', text);
        const pasted = await content(f, text + before.body!.dataStream, text.length);
        expectNoImages(pasted);
        expect(f.posts).toEqual([]);
        await f.assertMounted();
        await f.page.getByRole('button', { name: 'Undo', exact: true }).click();
        const undone = await content(f, before.body!.dataStream);
        expect(undone.body).toEqual(before.body);
        await f.page.getByRole('button', { name: 'Redo', exact: true }).click();
        expect((await content(f, text + before.body!.dataStream)).body).toEqual(pasted.body);
        await f.assertMounted();
        await f.capture('after-text-paste-undo-redo');
        await reopen(f, pasted);
        expect(f.posts).toEqual([]);
        await f.capture('after-intentional-reopen');
      });
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
