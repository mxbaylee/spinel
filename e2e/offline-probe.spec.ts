// Temporary integration probe, not an implementation of offline downloads.
// Its fixture response store stands in for a future scoped local snapshot adapter;
// only the SDK's own pending-edit store survives the real browser restarts below.
import { chromium, devices, expect, request as apiRequest, test } from '@playwright/test';
import sharp from 'sharp';
import { ErrorCode } from '@univerjs/protocol';
import type { IDocumentData } from '@univerjs/core';
import type { BrowserContext, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { interruptibleNetwork } from './live-network.ts';

test.describe.configure({ retries: 0 });

type CachedResponse = { status: number; headers: Record<string, string>; body: Buffer };
for (const kind of ['sheet', 'doc'] as const) {
  test(`SDK cold-start probe: ${kind} retains a committed offline edit across browser restarts`, async ({
    baseURL,
  }, info) => {
    test.setTimeout(180_000);
    expect(info.project.name).toBe('mobile-https');
    expect(baseURL).toBe('https://localhost:3103');
    const itemQuerySuffix = '&offline-probe=1&host-cache=1';
    const directory = await mkdtemp(join(tmpdir(), 'spinel-offline-sdk-'));
    const db = openDatabase('test-results/mobile-https/app.sqlite');
    const auth = new AuthStore(db);
    const user = auth.createUser(`Offline probe ${kind}`);
    const item = new WorkspaceStore(auth).create(user.id, {
      name: `Offline probe ${kind}`,
      kind,
      parentId: null,
    });
    const cookie = {
      name: COOKIE_NAME,
      value: auth.createSession(user.id).token,
      url: baseURL!,
      expires: Date.now() / 1000 + 3600,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict' as const,
    };
    const server = await apiRequest.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Cookie: `${COOKIE_NAME}=${cookie.value}` },
    });
    let unitId: string | undefined;
    let imageSource: string | undefined;
    let imageBaseline: IDocumentData | undefined;
    let baselineServerContent = 'Baseline';
    const cache = new Map<string, CachedResponse>();
    const misses = new Set<string>();
    const blocked = new Set<string>();
    const diagnostics = new Set<string>();
    const safeMessage = (message: string) =>
      message
        .replaceAll(cookie.value, '[session]')
        .replace(/(?:https?|wss?):\/\/[^\s)]+/g, '[URL]')
        .replace(/[A-Za-z0-9_-]{32,}(?:\.[A-Za-z0-9_-]+)*/g, '[opaque]')
        .slice(0, 240);
    // Diagnostics contain paths/status only, never cookie values or URL queries.
    const safePath = (value: string) => {
      try {
        return new URL(value).pathname;
      } catch {
        return '[invalid URL]';
      }
    };
    let cacheCalls: string[] = [];
    const cacheFailures: string[] = [];
    let offline = false;
    let stopping = false;
    let context: BrowserContext | undefined;
    let network!: Awaited<ReturnType<typeof interruptibleNetwork>>;
    let page!: Page;
    let stage = 'initializing';
    const editorName = kind === 'sheet' ? 'Sheet document' : 'Doc document';
    const editor = () => page.getByRole('region', { name: editorName, exact: true });
    const status = () => editor().getByRole('status', { name: 'Save status' });
    async function launch() {
      cacheCalls = [];
      stopping = false;
      context = await chromium.launchPersistentContext(directory, {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1100 },
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
        args: ['--ignore-certificate-errors'],
      });
      // Fulfilled fixture HTML otherwise triggers Chromium's local-network
      // access check for the real loopback socket. Scope this test permission
      // to the fixture; HTTP/WebSocket offline blocking remains explicit below.
      await context.grantPermissions(
        ['clipboard-read', 'clipboard-write', 'local-network-access'],
        { origin: baseURL },
      );
      context.on('response', (response) => {
        if (response.status() >= 400)
          diagnostics.add(`HTTP ${response.status()} ${safePath(response.url())}`);
      });
      context.on('requestfailed', (request) => {
        if (!offline && !stopping)
          diagnostics.add(`Failed ${request.method()} ${safePath(request.url())}`);
      });
      network = await interruptibleNetwork(context);
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== new URL(baseURL!).origin) return route.continue();
        const key = `${request.method()} ${url.pathname}${url.search} ${request.postData() ?? ''}`;
        // This fixture account owns only this item. Explicit reads stand in for
        // the future local adapter; credentials, licensing and write ACKs never do.
        const publicAsset =
          url.pathname.startsWith('/assets/') ||
          [
            '/manifest.webmanifest',
            '/app-icon-180.png',
            '/app-icon-192.png',
            '/app-icon-512.png',
          ].includes(url.pathname) ||
          (url.pathname === '/' && url.search === `?item=${item.id}${itemQuerySuffix}`);
        const metadata = [
          '/api/auth/session',
          '/api/items',
          '/api/items/pins',
          '/api/items/shared',
          `/api/items/${item.id}`,
          `/api/items/${item.id}/history`,
        ].includes(url.pathname);
        const preparation =
          request.method() === 'POST' && url.pathname === `/api/items/${item.id}/collaboration`;
        const image = url.pathname.startsWith(`/api/items/${item.id}/images/`);
        const snapshot = Boolean(
          unitId &&
          url.pathname.startsWith(
            `/universer-api/snapshot/${kind === 'sheet' ? 2 : 1}/unit/${unitId}/`,
          ),
        );
        let permission = false;
        if (
          request.method() === 'POST' &&
          url.pathname === '/universer-api/authz/-/object/-/batch_allowed'
        ) {
          const body = request.postDataJSON() as { requests?: { unitID?: string }[] };
          permission = Boolean(
            unitId &&
            body.requests?.length &&
            body.requests.every((entry) => entry.unitID === unitId),
          );
        }
        const cacheable =
          (request.method() === 'GET' && (publicAsset || metadata || snapshot || image)) ||
          preparation ||
          permission;
        if (offline) {
          const hit = cacheable ? cache.get(key) : undefined;
          if (hit) return route.fulfill(hit);
          if (cacheable) misses.add(`${request.method()} ${url.pathname}`);
          else blocked.add(`${request.method()} ${url.pathname}`);
          return route.abort('internetdisconnected');
        }
        // Tickets and writes retain the browser's normal request path. Only
        // fixture reads need the API-response recorder, even while online.
        if (!cacheable) return route.fallback();
        try {
          const response = await route.fetch();
          try {
            if (cacheable && response.ok()) {
              if (preparation) {
                const prepared = await response.json();
                expect(prepared.user.id).toBe(user.id);
                expect(typeof prepared.unitId).toBe('string');
                unitId = prepared.unitId;
              }
              if (url.pathname === '/api/auth/session')
                expect((await response.json()).user.id).toBe(user.id);
              const headers = { ...response.headers() };
              for (const name of [
                'content-encoding',
                'content-length',
                'transfer-encoding',
                'set-cookie',
              ])
                delete headers[name];
              cache.set(key, { status: response.status(), headers, body: await response.body() });
            }
            await route.fulfill({ response });
          } finally {
            await response.dispose();
          }
        } catch (error) {
          if (!stopping) throw error;
        }
      });
      if (offline) await network.setOffline(true);
      page = context.pages()[0] ?? (await context.newPage());
      page.on('console', (message) => {
        if (message.type() === 'log' && message.text().startsWith('{"recoveryCacheCall":')) {
          const call = JSON.parse(message.text());
          cacheCalls.push(call.recoveryCacheCall);
          if (call.recoveryCacheCall === 'storage failure') cacheFailures.push(String(call.data));
          console.log(JSON.stringify({ probe: kind, cacheCall: call }));
        }
      });
      page.on('pageerror', (error) => {
        diagnostics.add(
          `${stage}${stopping ? ' (closing)' : ''}: ${safeMessage(error.message)}\n${(error.stack ?? '').split('\n').slice(1, 6).map(safeMessage).join('\n')}`,
        );
      });
      page.on('websocket', (socket) => {
        socket.on('socketerror', (error) => {
          if (!offline && !stopping) diagnostics.add(`WebSocket ${safeMessage(error)}`);
        });
      });
      page.setDefaultTimeout(15_000);
    }
    async function recordRecovery(label: string) {
      const record = await page.evaluate(async () => {
        const probe = window.__spinelRecoveryProbe;
        if (!probe) return { unavailable: true };
        return {
          hostCache: probe.hostCache,
          beforeLoad: probe.beforeLoad,
          current: await probe.read(),
        };
      });
      expect(record).toMatchObject({ hostCache: true });
      expect(cacheFailures).toEqual([]);
      // Two loads belong to this observer; at least one belongs to the SDK loader.
      expect(cacheCalls.filter((call) => call === 'load').length).toBeGreaterThanOrEqual(3);
      if (label.includes('edit settled')) expect(cacheCalls).toContain('update');
      // This flag is compiled only for CI and requires the loopback probe URL.
      // Contents belong to this freshly created synthetic fixture account.
      console.log(JSON.stringify({ probe: kind, recoveryStage: label, recovery: record }));
    }
    async function close() {
      stopping = true;
      await context?.close();
      context = undefined;
    }
    async function ready() {
      await page.bringToFront();
      if (kind === 'sheet') {
        // Spinel adds this label only after the async loader finishes replay.
        await expect(editor().getByLabel('Spreadsheet grid', { exact: true })).toBeVisible();
      } else {
        await expect(
          editor().getByText('Click the page to write. Type / for commands.'),
        ).toBeVisible();
      }
    }
    async function enter(value: string, cell = 'A1') {
      await ready();
      if (kind === 'sheet') {
        const address = editor().getByRole('textbox').nth(2);
        await address.fill(cell);
        await address.press('Enter');
        await page.keyboard.type(value);
        await page.keyboard.press('Enter');
      } else {
        await editor()
          .locator('.univer-container')
          .click({ position: { x: 130, y: 200 } });
        await page.keyboard.press('Control+Home');
        await page.keyboard.type(value);
      }
    }
    async function copyContent() {
      await ready();
      const sentinel = `clipboard-not-copied-${crypto.randomUUID()}`;
      await page.evaluate((value) => navigator.clipboard.writeText(value), sentinel);
      if (kind === 'sheet') {
        const address = editor().getByRole('textbox').nth(2);
        await address.fill('A1:A2');
        await address.press('Enter');
      } else {
        await editor()
          .locator('.univer-container')
          .click({ position: { x: 130, y: 200 } });
        await page.keyboard.press('Control+a');
      }
      await page.keyboard.press('Control+c');
      try {
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .not.toBe(sentinel);
      } catch (error) {
        const focus = await page.evaluate(() => ({
          documentFocused: document.hasFocus(),
          tag: document.activeElement?.tagName,
          role: document.activeElement?.getAttribute('role'),
          editable: document.activeElement?.getAttribute('contenteditable'),
        }));
        diagnostics.add(`${stage}: copy did not replace sentinel; focus=${JSON.stringify(focus)}`);
        throw error;
      }
      return (await page.evaluate(() => navigator.clipboard.readText()))
        .replace(/\r\n/g, '\n')
        .trimEnd();
    }
    const firstOffline = kind === 'sheet' ? 'Offline-retained' : 'Offline-retainedBaseline';
    const finalOffline =
      kind === 'sheet' ? 'Offline-retained\nCold-second' : 'Cold-secondOffline-retainedBaseline';
    const finalServerContent = () =>
      kind === 'sheet' ? finalOffline : `Cold-secondOffline-retained${baselineServerContent}`;
    async function nativeSnapshot() {
      const response = await server.get(`/api/items/${item.id}/${kind}`);
      expect(response.ok()).toBe(true);
      return (await response.json()).snapshot;
    }
    async function imageVisible() {
      if (!imageSource) return;
      await editor()
        .locator('.univer-container')
        .click({ position: { x: 130, y: 200 } });
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('ArrowLeft');
      // The editor renders images on canvas. Count the fixture's solid orange
      // pixels rather than accepting a successful request or an empty placeholder.
      await expect
        .poll(
          async () => {
            const { data, info } = await sharp(
              await editor().locator('.univer-container').screenshot(),
            )
              .removeAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            let orange = 0;
            for (let offset = 0; offset < data.length; offset += info.channels) {
              if (
                data[offset] > 245 &&
                data[offset + 1] > 145 &&
                data[offset + 1] < 165 &&
                data[offset + 2] < 10
              )
                orange++;
            }
            return orange;
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(1000);
    }
    async function prepareImage() {
      if (kind !== 'doc') return;
      await ready();
      await editor()
        .locator('.univer-container')
        .click({ position: { x: 130, y: 200 } });
      await page.keyboard.press('Control+End');
      await editor().getByRole('tab', { name: 'Insert', exact: true }).click();
      const chooser = page.waitForEvent('filechooser');
      await editor().getByRole('button', { name: 'Image', exact: true }).click();
      await (
        await chooser
      ).setFiles({
        name: 'offline-orange.png',
        mimeType: 'image/png',
        buffer: await sharp({
          create: { width: 80, height: 60, channels: 4, background: '#ff9900' },
        })
          .png()
          .toBuffer(),
      });
      await expect.poll(async () => (await nativeSnapshot()).drawingsOrder?.length).toBe(1);
      const snapshot = await nativeSnapshot();
      imageBaseline = snapshot;
      imageSource = snapshot.drawings[snapshot.drawingsOrder[0]].source;
      expect(imageSource).toMatch(new RegExp(`^/api/items/${item.id}/images/[a-f0-9]{64}$`));
      baselineServerContent = await serverContent();
      expect(baselineServerContent).toContain('Baseline');
      await imageVisible();
      expect(cache.has(`GET ${imageSource} `)).toBe(true);
    }
    async function serverContent() {
      const response = await server.get(`/api/items/${item.id}/${kind}`);
      expect(response.ok()).toBe(true);
      const { snapshot } = await response.json();
      if (kind === 'doc') return snapshot.body.dataStream.replace(/\r\n/g, '\n').trimEnd();
      const cells = snapshot.sheets[snapshot.sheetOrder[0]].cellData;
      return [cells?.[0]?.[0]?.v ?? '', cells?.[1]?.[0]?.v ?? ''].join('\n').trimEnd();
    }
    try {
      await launch();
      await context!.addCookies([cookie]);
      stage = 'prepare online revision and responses';
      await page.goto(`${baseURL}/?item=${item.id}${itemQuerySuffix}`);
      await expect(status()).toHaveText('All changes saved.', { timeout: 30_000 });
      await enter('Baseline');
      // Saved can still describe the state before async input was dispatched.
      // Establish actual server content before destroying this first editor.
      await expect.poll(serverContent, { timeout: 30_000 }).toBe('Baseline');
      await prepareImage();
      await expect(status()).toHaveText('All changes saved.', { timeout: 30_000 });
      await page.reload();
      await expect(status()).toHaveText('All changes saved.', { timeout: 30_000 });
      await expect.poll(copyContent).toBe('Baseline');
      await imageVisible();
      // The public loader reopens pending work at its cached revision, rather
      // than always requesting latest (rev/0). Prepare that exact baseline too.
      const baselineResponse = await server.get(`/api/items/${item.id}/${kind}`);
      expect(baselineResponse.ok()).toBe(true);
      const baseline = await baselineResponse.json();
      expect(Number.isInteger(baseline.revision)).toBe(true);
      expect(unitId).toBeTruthy();
      const preparedBaseline = await page.evaluate(
        async (path) => {
          const response = await fetch(path);
          if (!response.ok) throw new Error('Could not prepare exact offline baseline.');
          const data = await response.json();
          return { code: data.error?.code, unitId: data.snapshot?.unitID };
        },
        `/universer-api/snapshot/${kind === 'sheet' ? 2 : 1}/unit/${unitId}/rev/${baseline.revision}`,
      );
      // The public protocol represents success as ErrorCode.OK (1), not zero.
      expect(preparedBaseline.code ?? ErrorCode.OK).toBe(ErrorCode.OK);
      expect(preparedBaseline.unitId).toBe(unitId);
      stage = 'commit an edit without HTTP or WebSocket';
      offline = true;
      await network.setOffline(true);
      await enter('Offline-retained');
      await expect.poll(copyContent).toBe(firstOffline);
      // This probe observes the existing SDK's recovery behavior after a bounded
      // settling period. It does not claim the product has a local-save signal.
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await recordRecovery('first offline edit settled');
      for (let attempt = 1; attempt <= 2; attempt++) {
        stage = `cold offline browser launch ${attempt}`;
        await close();
        await launch();
        await page.goto(`${baseURL}/?item=${item.id}${itemQuerySuffix}`);
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        await ready();
        await recordRecovery(`cold launch ${attempt} before content assertion`);
        await expect
          .poll(copyContent, { timeout: 30_000 })
          .toBe(attempt === 1 ? firstOffline : finalOffline);
        await imageVisible();
        if (attempt === 1) {
          stage = 'create another edit during cold offline launch';
          await enter('Cold-second', 'A2');
          await expect.poll(copyContent).toBe(finalOffline);
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await recordRecovery('second offline edit settled');
        }
      }
      stage = 'reconnect and persist';
      offline = false;
      await network.setOffline(false);
      await expect.poll(serverContent, { timeout: 30_000 }).toBe(finalServerContent());
      await expect(status()).toHaveText('All changes saved.', { timeout: 30_000 });
      await page.reload();
      await expect(status()).toHaveText('All changes saved.', { timeout: 30_000 });
      await expect.poll(copyContent).toBe(finalOffline);
      // This independent HTTP client bypasses browser routes and local SDK data.
      await expect.poll(serverContent, { timeout: 30_000 }).toBe(finalServerContent());
      await imageVisible();
      if (imageSource && imageBaseline) {
        const final = (await nativeSnapshot()) as IDocumentData;
        const prefix = 'Cold-secondOffline-retained';
        expect(final.body?.dataStream).toBe(prefix + imageBaseline.body!.dataStream);
        expect(final.body?.customBlocks ?? []).toEqual(
          (imageBaseline.body?.customBlocks ?? []).map((block) => ({
            ...block,
            startIndex: block.startIndex + prefix.length,
          })),
        );
        expect(final.drawingsOrder).toEqual(imageBaseline.drawingsOrder);
        const drawingId = imageBaseline.drawingsOrder![0];
        expect(final.drawings![drawingId]).toMatchObject({
          drawingId,
          source: imageSource,
          docTransform: { size: imageBaseline.drawings![drawingId].docTransform.size },
        });
      }
      stage = 'completed isolated probe; full SPN-039 acceptance still outstanding';
    } finally {
      console.log(
        JSON.stringify({
          probe: kind,
          stage,
          cacheMisses: [...misses],
          blockedRequests: [...blocked],
          diagnostics: [...diagnostics],
          recordedResponses: cache.size,
        }),
      );
      if (context)
        await page!
          .screenshot({
            path: `test-results/theme-screenshots/offline-sdk-probe-${kind}-${info.project.name}.png`,
            fullPage: true,
          })
          .catch(() => {});
      await close();
      await server.dispose();
      db.close();
      await rm(directory, { recursive: true, force: true });
    }
    expect(cacheFailures).toEqual([]);
  });
}
