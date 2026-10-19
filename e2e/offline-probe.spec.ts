// Temporary integration probe, not an implementation of offline downloads.
// Its fixture response store stands in for a future scoped local snapshot adapter;
// only the SDK's own pending-edit store survives the real browser restarts below.
import { chromium, devices, expect, request as apiRequest, test } from '@playwright/test';
import sharp from 'sharp';
import { ErrorCode } from '@univerjs/protocol';
import type { IChangeset, ICollaMsg } from '@univerjs/protocol';
import type { IUnitCacheData } from '@univerjs-pro/collaboration-client';
import { parseChangesetToProtocol } from '@univerjs-pro/collaboration';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { BrowserContext, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { interruptibleNetwork } from './live-network.ts';
import { sheetImageFixture } from './sheet-image-fixture.ts';

test.describe.configure({ retries: 0 });

type CachedResponse = { status: number; headers: Record<string, string>; body: Buffer };
for (const kind of ['sheet', 'doc'] as const) {
  test(`SDK cold-start probe: ${kind} retains a committed offline edit across browser restarts`, async ({
    baseURL,
  }, info) => {
    test.setTimeout(180_000);
    expect(info.project.name).toBe('mobile-https');
    expect(baseURL).toBe('https://localhost:3103');
    const itemQuerySuffix = '&offline-probe=1&host-cache=1&replay-identity=1&recovery-ledger=1';
    const directory = await mkdtemp(join(tmpdir(), 'spinel-offline-sdk-'));
    const db = openDatabase('test-results/mobile-https/app.sqlite');
    const auth = new AuthStore(db);
    const user = auth.createUser(`Offline probe ${kind}`);
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
    const item =
      kind === 'doc'
        ? new WorkspaceStore(auth).create(user.id, {
            name: 'Offline probe doc',
            kind,
            parentId: null,
          })
        : await (async () => {
            const response = await server.post('/api/items/import', {
              headers: { Origin: baseURL! },
              data: {
                filename: 'Offline probe sheet.univer.json',
                parentId: null,
                snapshot: await sheetImageFixture(3),
              },
            });
            expect(response.status(), await response.text()).toBe(201);
            return (await response.json()).item as ReturnType<WorkspaceStore['create']>;
          })();
    let unitId: string | undefined;
    let imageSource: string | undefined;
    let imageBaseline: IDocumentData | undefined;
    let sheetImageBaseline: IWorkbookData | undefined;
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
    let uncertainProof: IChangeset | undefined;
    let confirmation: IChangeset | undefined;
    let checkUncertainClears = false;
    const resumedRequests: IChangeset[] = [];
    const prematureClears: string[] = [];
    const docCommands: { stage: string; recovered: boolean }[] = [];
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
      context.on('request', (request) => {
        if (uncertainProof && request.url().endsWith('/new_changes'))
          resumedRequests.push(request.postDataJSON().changeset as IChangeset);
      });
      network = await interruptibleNetwork(
        context,
        () => {
          offline = true;
        },
        async (message) => {
          if (!uncertainProof) return;
          const frame = JSON.parse(String(message)) as { collaMsg?: ICollaMsg };
          const cs = frame.collaMsg?.csAckEvent?.cs ?? frame.collaMsg?.newCsEvent?.cs;
          if (
            cs?.unitID === uncertainProof.unitID &&
            cs.sid === uncertainProof.sid &&
            cs.reqId === uncertainProof.reqId
          ) {
            // Stamp in the browser before forwarding this real server frame;
            // console delivery order cannot establish cache-call ordering.
            await page.evaluate(
              ({ sid, reqId }) => {
                if (!window.__spinelRecoveryProbe) throw new Error('Recovery probe unavailable.');
                window.__spinelRecoveryProbe.serverConfirmation = { sid, reqId };
              },
              { sid: uncertainProof.sid!, reqId: uncertainProof.reqId! },
            );
            confirmation = cs;
          }
        },
      );
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
          (url.pathname.startsWith(
            `/universer-api/snapshot/${kind === 'sheet' ? 2 : 1}/unit/${unitId}/`,
          ) ||
            (kind === 'sheet' &&
              url.pathname.startsWith(`/universer-api/snapshot/block/2/unit/${unitId}/block/`))),
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
        if (message.type() === 'log' && message.text().startsWith('{"recoveryBoundary":'))
          console.log(JSON.stringify({ probe: kind, stage, boundary: JSON.parse(message.text()) }));
        if (message.type() === 'log' && message.text().startsWith('{"recoveryDocEvent":')) {
          const docEvent = JSON.parse(message.text());
          if (docEvent.recoveryDocEvent === 'before text mutation')
            docCommands.push({
              stage,
              recovered:
                docEvent.value.options?.fromChangeset === true ||
                docEvent.value.options?.fromCollab === true,
            });
          if (docEvent.recoveryDocEvent === 'trace failure')
            cacheFailures.push(String(docEvent.value));
          console.log(JSON.stringify({ probe: kind, stage, docEvent }));
        }
        if (message.type() === 'log' && message.text().startsWith('{"recoveryCacheCall":')) {
          const call = JSON.parse(message.text());
          cacheCalls.push(call.recoveryCacheCall);
          if (call.recoveryCacheCall === 'storage failure') cacheFailures.push(String(call.data));
          if (
            uncertainProof &&
            checkUncertainClears &&
            !call.staged &&
            (call.serverConfirmation?.sid !== uncertainProof.sid ||
              call.serverConfirmation?.reqId !== uncertainProof.reqId) &&
            (call.recoveryCacheCall === 'clear' ||
              (['update', 'save'].includes(call.recoveryCacheCall) &&
                !call.data.record.awaitingChangeset &&
                call.data.record.mutations.length === 0))
          )
            prematureClears.push(call.recoveryCacheCall);
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
          ledger: probe.ledger(),
          beforeLoad: probe.beforeLoad,
          current: await probe.read(),
        };
      });
      expect(record).toMatchObject({ hostCache: true });
      expect(record.ledger).toBeDefined();
      expect(record.ledger!.diagnostics).toEqual({
        failed: false,
        truncated: false,
        unmatchedInputs: 0,
        unmatchedOutputs: 0,
      });
      expect(record.ledger!.status).not.toBe('failed');
      expect(cacheFailures).toEqual([]);
      // Diagnostic reads bypass SDK cache loading; these loads belong to the SDK.
      expect(cacheCalls.filter((call) => call === 'load').length).toBeGreaterThanOrEqual(1);
      if (label.includes('edit settled')) expect(cacheCalls).toContain('update');
      if (label.startsWith('cold launch')) {
        const before = record.beforeLoad;
        const expected =
          (before?.mutations.length ?? 0) + (before?.awaitingChangeset?.mutations.length ?? 0);
        expect(expected).toBeGreaterThan(0);
        expect(record.ledger).toMatchObject({
          status: 'verified',
          accounting: { expected, applied: expected, phase: 'complete' },
        });
        expect(record.ledger!.reads).toBeGreaterThan(0);
        expect(record.ledger!.writes).toBeGreaterThan(0);
      }
      if (kind === 'doc' && label.includes('edit settled')) {
        const edits = docCommands.filter((event) => event.stage === stage);
        expect(edits.length).toBeGreaterThan(0);
        expect(edits.every((event) => !event.recovered)).toBe(true);
      }
      // This flag is compiled only for CI and requires the loopback probe URL.
      // Contents belong to this freshly created synthetic fixture account.
      console.log(JSON.stringify({ probe: kind, recoveryStage: label, recovery: record }));
      return record;
    }
    const operations = (record: IUnitCacheData | null | undefined) =>
      record && {
        rev: record.rev,
        awaitingChangeset: record.awaitingChangeset,
        mutations: record.mutations,
      };
    async function close() {
      if (context && page && !page.isClosed()) {
        try {
          const evidence = await page.evaluate(() => window.__spinelRecoveryProbe?.ledger());
          if (!evidence || evidence.status === 'failed')
            cacheFailures.push('Ledger failed before browser close.');
        } catch {
          cacheFailures.push('Could not inspect final ledger evidence before browser close.');
        }
      }
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
    async function enter(value: string, cell = 'A1', singleInput = false) {
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
        if (singleInput) await page.keyboard.insertText(value);
        else await page.keyboard.type(value);
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
      if (kind === 'doc' && !imageSource) return;
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
            const counts = [0, 0, 0];
            const colors = [
              [255, 153, 0],
              [34, 85, 238],
              [34, 187, 102],
            ];
            for (let offset = 0; offset < data.length; offset += info.channels) {
              colors.forEach((color, index) => {
                if (color.every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
                  counts[index]++;
              });
            }
            return (kind === 'doc' ? counts.slice(0, 1) : counts).every((count) => count > 1000);
          },
          { timeout: 15_000 },
        )
        .toBe(true);
    }
    async function prepareImage() {
      if (kind === 'sheet') {
        sheetImageBaseline = (await nativeSnapshot()) as IWorkbookData;
        await imageVisible();
        return;
      }
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
    async function prepareExactBaseline() {
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
      return baseline.revision as number;
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
      await prepareExactBaseline();
      stage = 'commit an edit without HTTP or WebSocket';
      offline = true;
      await network.setOffline(true);
      await enter('Offline-retained');
      await expect.poll(copyContent).toBe(firstOffline);
      // This probe observes the existing SDK's recovery behavior after a bounded
      // settling period. It does not claim the product has a local-save signal.
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await recordRecovery('first offline edit settled');
      let unchangedQueue: ReturnType<typeof operations>;
      for (let attempt = 1; attempt <= 3; attempt++) {
        stage = `cold offline browser launch ${attempt}`;
        const hold = attempt === 1 ? 'read' : attempt === 2 ? 'write' : undefined;
        if (hold)
          await page.evaluate(
            (mode) => localStorage.setItem('spinel-synthetic-recovery-hold', mode),
            hold,
          );
        await close();
        await launch();
        await page.goto(`${baseURL}/?item=${item.id}${itemQuerySuffix}`);
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        if (hold) {
          await expect
            .poll(() => page.evaluate(() => window.__spinelRecoveryProbe?.ledger()?.held))
            .toBe(hold);
          const evidence = await page.evaluate(() => window.__spinelRecoveryProbe!.ledger()!);
          expect(evidence.status).toBe('recovering');
          if (hold === 'read') expect(evidence.facadeLoaded).toBe(false);
          await expect(editor().locator('.univer-container')).toHaveJSProperty('inert', true);
          const retained = await page.evaluate(async () => {
            const original = window.__spinelRecoveryProbe!.beforeLoad!;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open('spinel-synthetic-recovery-probe-v1', 1);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              const record = await new Promise((resolve, reject) => {
                const tx = db.transaction('pending', 'readonly');
                const request = tx
                  .objectStore('pending')
                  .get(JSON.stringify([original.unitID, original.userId]));
                tx.oncomplete = () => resolve(request.result);
                tx.onabort = () => reject(tx.error);
              });
              return { original, record };
            } finally {
              db.close();
            }
          });
          expect(retained.record).toEqual(retained.original);
          console.log(JSON.stringify({ probe: kind, heldRecoveryOperation: hold, evidence }));
          await page.evaluate(() => window.__spinelRecoveryProbe!.release());
        }
        await ready();
        const recovered = await recordRecovery(`cold launch ${attempt} before content assertion`);
        if (attempt === 3) expect(operations(recovered.beforeLoad)).toEqual(unchangedQueue);
        await expect
          .poll(copyContent, { timeout: 30_000 })
          .toBe(attempt === 1 ? firstOffline : finalOffline);
        await imageVisible();
        if (attempt === 1) {
          stage = 'create another edit during cold offline launch';
          await enter('Cold-second', 'A2');
          await expect.poll(copyContent).toBe(finalOffline);
          if (kind === 'doc') {
            // Check local history for new input after recovered commands were
            // marked as replay. Net-zero undo/redo alone does not prove sync.
            await page.keyboard.press('Control+z');
            await expect.poll(copyContent).toBe(firstOffline);
            // Desktop Chrome uses the SDK's Windows/Linux Ctrl+Y binding;
            // Ctrl+Shift+Z is the separate macOS binding.
            await page.keyboard.press('Control+y');
            await expect.poll(copyContent).toBe(finalOffline);
          }
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await recordRecovery('second offline edit settled');
        }
        if (attempt >= 2) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const settled = operations(
            await page.evaluate(() => window.__spinelRecoveryProbe?.read()),
          );
          expect(settled).toBeTruthy();
          if (attempt === 2) unchangedQueue = settled;
          else expect(settled).toEqual(unchangedQueue);
        }
      }
      // The third launch has no intervening edit: replay must not grow the queue.
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
      if (sheetImageBaseline) {
        const final = (await nativeSnapshot()) as IWorkbookData;
        expect(final.sheets.tab.backgroundImage).toEqual(
          sheetImageBaseline.sheets.tab.backgroundImage,
        );
        expect(final.sheets.tab.cellData?.[3]?.[0]?.p).toEqual(
          sheetImageBaseline.sheets.tab.cellData?.[3]?.[0]?.p,
        );
        const drawings = (snapshot: IWorkbookData) =>
          JSON.parse(
            snapshot.resources!.find((resource) => resource.name === 'SHEET_DRAWING_PLUGIN')!.data,
          );
        expect(drawings(final)).toEqual(drawings(sheetImageBaseline));
      }
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
      if (kind === 'doc') {
        stage = 'lose acknowledgement after the server commits';
        const baseRevision = await prepareExactBaseline();
        network.loseAcknowledgement();
        await enter('Lost-ack', 'A1', true);
        await expect.poll(() => network.acknowledgementLost()).toBe(true);
        expect(offline).toBe(true);
        const expectedCopy = `Lost-ack${finalOffline}`;
        const expectedServer = `Lost-ack${finalServerContent()}`;
        await expect.poll(serverContent).toBe(expectedServer);
        const committedResponse = await server.get(`/api/items/${item.id}/${kind}`);
        expect(committedResponse.ok()).toBe(true);
        const committedRevision = (await committedResponse.json()).revision;
        expect(committedRevision).toBeGreaterThan(baseRevision);
        const pending = () => page.evaluate(async () => window.__spinelRecoveryProbe?.read());
        await expect.poll(async () => (await pending())?.awaitingChangeset != null).toBe(true);
        const uncertain = (await pending())!;
        expect(uncertain.rev).toBe(baseRevision);
        expect(uncertain.awaitingChangeset?.sid).toBeTruthy();
        expect(Number.isSafeInteger(uncertain.awaitingChangeset?.reqId)).toBe(true);
        expect(uncertain.mutations).toEqual([]);
        uncertainProof = parseChangesetToProtocol(uncertain.awaitingChangeset!);
        checkUncertainClears = true;
        await recordRecovery('lost acknowledgement persisted');
        stage = 'cold restart with an uncertain committed edit';
        await close();
        await launch();
        await page.goto(`${baseURL}/?item=${item.id}${itemQuerySuffix}`);
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        await ready();
        const before = await page.evaluate(() => window.__spinelRecoveryProbe?.beforeLoad);
        expect(before?.awaitingChangeset).toEqual(uncertain.awaitingChangeset);
        await expect.poll(copyContent).toBe(expectedCopy);
        await imageVisible();
        stage = 'reconnect the original uncertain operation';
        expect((await pending())?.awaitingChangeset).toEqual(uncertain.awaitingChangeset);
        offline = false;
        await network.setOffline(false);
        // A matching real server frame must arrive before pending state clears.
        // Correct server content alone would also pass if the client lost its retry.
        await expect.poll(() => confirmation, { timeout: 30_000 }).toBeTruthy();
        expect(confirmation).toMatchObject({
          unitID: uncertainProof.unitID,
          sid: uncertainProof.sid,
          reqId: uncertainProof.reqId,
          baseRev: uncertainProof.baseRev,
          revision: committedRevision,
        });
        const verifyResumedRequests = () => {
          const original = uncertainProof!;
          for (const request of resumedRequests) {
            expect(request).toMatchObject({
              unitID: original.unitID,
              sid: original.sid,
              reqId: original.reqId,
              baseRev: original.baseRev,
            });
            expect(request.mutations).toEqual(original.mutations);
          }
        };
        verifyResumedRequests();
        await expect
          .poll(async () => {
            const record = await pending();
            return record == null || (!record.awaitingChangeset && record.mutations.length === 0);
          })
          .toBe(true);
        expect(prematureClears).toEqual([]);
        checkUncertainClears = false;
        await expect(status()).toHaveText('All changes saved.', { timeout: 30_000 });
        await expect.poll(serverContent).toBe(expectedServer);
        const confirmedResponse = await server.get(`/api/items/${item.id}/${kind}`);
        expect(confirmedResponse.ok()).toBe(true);
        expect((await confirmedResponse.json()).revision).toBe(committedRevision);
        await page.reload();
        await expect(status()).toHaveText('All changes saved.', { timeout: 30_000 });
        await expect.poll(copyContent).toBe(expectedCopy);
        await imageVisible();
        expect(await serverContent()).toBe(expectedServer);
        const reloadedResponse = await server.get(`/api/items/${item.id}/${kind}`);
        expect(reloadedResponse.ok()).toBe(true);
        expect((await reloadedResponse.json()).revision).toBe(committedRevision);
        verifyResumedRequests();
        expect(prematureClears).toEqual([]);
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
