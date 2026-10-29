import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { runtimeDescriptor, shellFiles } from '../src/shared/offlineShell.ts';
import type { ShellManifest } from '../src/shared/offlineShell.ts';
import type { RuntimeState } from '../web/offline/runtimeStore.ts';
import { projectRoot, startApp } from './app-process.ts';
import { linkLegacyOfflineDependencies } from './offline-upgrade-dependencies.ts';
import { syncNetwork } from './sync-network.ts';

// This project owns its sequential builds and its real server. No ordinary
// smoke project should pay for another native editor or an extra app process.
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ browserName }, info) =>
  test.skip(info.project.name !== 'offline-upgrade' || browserName !== 'chromium'),
);
const origin = 'http://localhost:3110';
const legacyCommit = 'c2e8cac0fcdec36d992d6ebf3f377c9b579a8002';
const legacySource = resolve(process.env.SPINEL_LEGACY_OFFLINE_SOURCE || projectRoot);
type EmittedBuild = { directory: string; html: string; manifest: ShellManifest };
type LegacyBuild = { directory: string; html: string; files: string[] };
let buildDirectory: string;
let legacy: LegacyBuild;
let a: EmittedBuild;
let b: EmittedBuild;

async function emit(directory: string, source: string, format?: 1 | 2) {
  await new Promise<void>((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=1024',
        join(source, 'node_modules/vite/bin/vite.js'),
        'build',
        ...(format ? ['--mode', 'offline-upgrade'] : []),
        '--outDir',
        directory,
      ],
      {
        cwd: source,
        env: {
          ...process.env,
          ...(format ? { SPINEL_TEST_OFFLINE_FORMAT: String(format) } : {}),
          VITE_SYNC_EVIDENCE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16_384);
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    const stop = () => {
      child.kill('SIGKILL');
    };
    process.once('exit', stop);
    const timer = setTimeout(stop, 120_000);
    child.once('error', reject);
    child.once('close', (code) => {
      process.off('exit', stop);
      clearTimeout(timer);
      if (code === 0) done();
      else
        reject(
          new Error(
            `Upgrade ${format ? `format-${format}` : 'legacy054'} build failed (${code}).\n${output}`,
          ),
        );
    });
  });
}

async function buildLegacy(): Promise<LegacyBuild> {
  const source = join(buildDirectory, 'legacy054-source');
  const directory = join(buildDirectory, 'legacy054-build');
  await mkdir(source);
  // CI provides an immutable checkout when its normal checkout is shallow.
  // A local checkout may already contain this commit. Neither path fetches or
  // modifies Git history, the supplied source checkout, or the active worktree.
  await new Promise<void>((done, reject) => {
    const archive = spawn(
      'git',
      [
        '-C',
        legacySource,
        'archive',
        '--format=tar',
        legacyCommit,
        'web',
        'src',
        'lib',
        'server',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'vite.config.ts',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const extract = spawn('tar', ['-x', '-C', source], { stdio: ['pipe', 'ignore', 'pipe'] });
    let output = '';
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4096);
    };
    archive.stderr.on('data', read);
    extract.stderr.on('data', read);
    archive.stdout.pipe(extract.stdin);
    extract.stdin.on('error', () => {});
    const stop = () => {
      archive.kill('SIGKILL');
      extract.kill('SIGKILL');
    };
    process.once('exit', stop);
    const timer = setTimeout(stop, 30_000);
    const completion = (child: ChildProcess) =>
      new Promise<void>((resolve, fail) => {
        child.once('error', fail);
        child.once('close', (code) =>
          code === 0
            ? resolve()
            : fail(new Error(`Could not materialize legacy054 (${code}). ${output}`)),
        );
      });
    void Promise.all([completion(archive), completion(extract)])
      .then(
        () => done(),
        (error) => {
          stop();
          reject(error);
        },
      )
      .finally(() => {
        clearTimeout(timer);
        process.off('exit', stop);
      });
  });
  // Use the immutable checkout's installed external packages and its own
  // postinstall patches. Every workspace import still targets the archive;
  // the upgrade server below continues to use the current application.
  await linkLegacyOfflineDependencies(source, legacySource);
  await emit(directory, source);
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  expect(runtimeDescriptor(html)).toBeNull();
  return {
    directory,
    html,
    files: shellFiles((await readdir(join(directory, 'assets'))).map((file) => `assets/${file}`)),
  };
}

async function build(format: 1 | 2): Promise<EmittedBuild> {
  const directory = join(buildDirectory, `format-${format}`);
  await emit(directory, projectRoot, format);
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  const manifest = runtimeDescriptor(html);
  if (!manifest) throw new Error('The actual emitted build has no runtime descriptor.');
  expect(manifest.compatibility).toEqual({ format, sdkVersion: '1.1.0' });
  const worker = await readFile(join(directory, 'service-worker.js'), 'utf8');
  expect(worker).toContain(manifest.version);
  for (const file of manifest.files)
    expect((await readFile(join(directory, file))).length).toBeGreaterThan(0);
  // The inert HTML may preload only the tiny loader's public dependencies.
  // Loading React/native application code belongs after compatibility selection.
  const preload = [...html.matchAll(/rel="modulepreload"[^>]*href="([^"]+)"/g)].map(
    (match) => match[1],
  );
  const main = html.match(/type="module"[^>]*src="([^"]+)"/)?.[1];
  expect(main).toBeDefined();
  let bootstrapBytes = 0;
  for (const file of [...preload, main!]) {
    expect(file).not.toMatch(/application|univer|Editor|native|react/i);
    bootstrapBytes += (await readFile(join(directory, file))).length;
  }
  expect(bootstrapBytes).toBeLessThan(32_768);
  return { directory, html, manifest };
}

test.beforeAll(async ({ browserName }, info) => {
  if (info.project.name !== 'offline-upgrade' || browserName !== 'chromium') return;
  test.setTimeout(180_000);
  buildDirectory = await mkdtemp(join(tmpdir(), 'spinel-upgrade-builds-'));
  // Load the native fixture helpers only after these child builds have exited.
  legacy = await buildLegacy();
  a = await build(1);
  b = await build(2);
  expect(b.manifest.version).not.toBe(a.manifest.version);
  expect(b.manifest.files.some((path) => a.manifest.files.includes(path))).toBe(false);
});

test('the actual SPN-054 eager client keeps its pending Doc and lazy files during new-host adoption', async ({
  browserName,
}, info) => {
  test.setTimeout(180_000);
  expect(browserName).toBe('chromium');
  const { copy, edit, fixture, savedLocally, stored, usableCanvas } =
    await import('./offline-fixture.ts');
  const directory = await mkdtemp(join(tmpdir(), 'spinel-legacy054-adoption-'));
  const databasePath = join(directory, 'app.sqlite');
  const missing = a.manifest.files.find((path) => /\/HistoryBrowser-.*\.js$/.test(path))!;
  const lazy = legacy.files.find((path) => /\/HistoryBrowser-.*\.js$/.test(path))!;
  expect(missing).toBeDefined();
  expect(lazy).toBeDefined();
  const server = await upgradeServer(databasePath, missing, legacy);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const f = await fixture(browser, origin, info, 'doc', { databasePath });
    try {
      await f.download();
      expect(await f.page.evaluate(() => window.__spinelRuntimeHost)).toBeUndefined();
      const oldCaches = await f.page.evaluate(async () =>
        (await caches.keys()).filter((name) => name.startsWith('spinel-shell-')),
      );
      expect(oldCaches).toHaveLength(1);
      const old = { version: oldCaches[0].slice('spinel-shell-'.length), files: legacy.files };
      expect(await cachedFiles(f.page, old)).toEqual([...legacy.files, '/']);
      expect(
        await f.page.evaluate(async () => (await indexedDB.databases()).map((entry) => entry.name)),
      ).not.toContain('spinel-offline-runtime');
      const original = await f.read();
      await f.network.setOffline(true);
      const draft = 'Legacy native Doc kept through host adoption 5521 ';
      await edit(f.page, 'doc', draft);
      await savedLocally(f.page);
      const retained = await stored(f.page, f.actor.id, f.item.id);
      expect(retained?.outbox?.checkpoint.buffer.length).toBeGreaterThan(0);
      const canvas = await f.page.locator('.univer-container canvas').first().elementHandle();
      const oldClient = await actualClientId(f.context, f.page);

      server.fail('missing-lazy');
      await server.replace(a);
      f.network.holdResume();
      await f.network.setOffline(false);
      expect(await updateWorker(f.page)).toBe('redundant');
      const interrupted = await publicState(f.page);
      expect(interrupted.builds).toEqual([]);
      expect(interrupted.candidate?.version).toBe(a.manifest.version);
      expect(interrupted.legacyCompatibility).toEqual(a.manifest.compatibility);
      expect(await cachedFiles(f.page, old)).toEqual([...legacy.files, '/']);
      expect(await cachedFiles(f.page, a.manifest)).not.toContain('/');
      expect(await stored(f.page, f.actor.id, f.item.id)).toEqual(retained);
      expect(await f.page.evaluate(() => window.__spinelRuntimeHost)).toBeUndefined();

      server.fail();
      expect(await updateWorker(f.page)).toBe('activated');
      const adopted = await publicState(f.page);
      expect(adopted.builds.map((build) => build.version)).toEqual([a.manifest.version]);
      expect(adopted.legacyCompatibility).toEqual(a.manifest.compatibility);
      // The eager base client never speaks the new host protocol. Its actual
      // still-live, unknown Client.id therefore protects the legacy cache.
      expect(await actualClientId(f.context, f.page)).toBe(oldClient);
      expect(Object.hasOwn(adopted.clients, oldClient)).toBe(false);
      expect(await cachedFiles(f.page, old)).toEqual([...legacy.files, '/']);
      expect(
        await f.page
          .locator('.univer-container canvas')
          .first()
          .evaluate((node, original) => node === original, canvas!),
      ).toBe(true);
      expect(await f.page.evaluate(() => window.__spinelRuntimeHost)).toBeUndefined();
      expect(await stored(f.page, f.actor.id, f.item.id)).toEqual(retained);
      const removedPath = await f.control.request.get(lazy);
      expect(removedPath.status()).toBe(404);
      await f.network.setOffline(true);
      expect(
        await f.page.evaluate(
          (path) => performance.getEntriesByName(location.origin + path).length,
          lazy,
        ),
      ).toBe(0);
      expect(
        await f.page.evaluate(async (path) => Object.keys(await import(path)), lazy),
      ).toContain('HistoryBrowser');

      // Only a user navigation starts the complete new host. It reads the
      // retained real format-1 Doc without rewriting the legacy checkpoint.
      await f.page.reload();
      await usableCanvas(f.page);
      await savedLocally(f.page);
      expect(await f.page.evaluate(() => window.__spinelRuntimeHost?.manifest?.version)).toBe(
        a.manifest.version,
      );
      expect(await copy(f.page, 'doc')).toContain(draft);
      expect(await stored(f.page, f.actor.id, f.item.id)).toEqual(retained);
      expect((await publicState(f.page)).accounts[f.actor.id]).toEqual(a.manifest.compatibility);
      expect(await f.read()).toEqual(original);
      expect(f.errors).toEqual([]);
      await info.attach('spn-055-legacy-runtime-adoption', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify(
            {
              source: legacyCommit,
              legacyCache: oldCaches[0],
              legacyFiles: legacy.files,
              adopted: a.manifest.version,
              interruptedCandidatePreserved: true,
            },
            null,
            2,
          ),
        ),
      });
    } finally {
      await f.close();
    }
  } finally {
    await browser?.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test.afterAll(async () => {
  if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true });
});

type Fault = 'missing-lazy' | 'html-asset' | 'wrong-html' | 'redirect' | 'interrupted-html';

/** Real HTTP faults reach service-worker fetches, unlike a page routing mock. */
async function upgradeServer(
  databasePath: string,
  missing: string,
  initial: { directory: string } = a,
) {
  let fault: Fault | undefined;
  const hits: { fault: Fault; path: string; credentialed: boolean }[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((incoming, outgoing) => {
    const path = new URL(incoming.url!, origin).pathname;
    const matches =
      fault &&
      (fault === 'missing-lazy' || fault === 'html-asset' ? path === missing : path === '/sign-in');
    if (matches) {
      hits.push({ fault: fault!, path, credentialed: Boolean(incoming.headers.cookie) });
      outgoing.setHeader('Cache-Control', 'no-store');
      if (fault === 'missing-lazy') {
        outgoing.writeHead(404).end('Missing emitted lazy asset');
        return;
      }
      if (fault === 'redirect') {
        outgoing.writeHead(302, { Location: '/sign-in?redirected=1' }).end();
        return;
      }
      outgoing.setHeader('Content-Type', fault === 'html-asset' ? 'text/javascript' : 'text/html');
      if (fault === 'interrupted-html') {
        outgoing.setHeader('Content-Length', Buffer.byteLength(b.html));
        outgoing.writeHead(200);
        outgoing.write(b.html.slice(0, 128));
        // The connection ends before its advertised body, not a fabricated
        // application error or a manually injected cache-completion outcome.
        setImmediate(() => outgoing.destroy());
      } else outgoing.end(a.html);
      return;
    }
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: 3111,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on('aborted', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (incoming, socket, head) => {
    const upstream = connect(3111, '127.0.0.1', () => {
      const headers = incoming.rawHeaders.reduce<string[]>((lines, value, index, values) => {
        if (index % 2 === 0) lines.push(`${value}: ${values[index + 1]}`);
        return lines;
      }, []);
      upstream.write(
        `${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`,
      );
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    sockets.add(upstream);
    upstream.on('close', () => {
      sockets.delete(upstream);
      socket.destroy();
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(3110, '127.0.0.1', done);
  });
  let app: Awaited<ReturnType<typeof startApp>> | undefined;
  const replace = async (next: { directory: string }) => {
    await app?.close();
    app = await startApp({
      databasePath,
      origin,
      listenPort: 3111,
      development: false,
      staticDirectory: next.directory,
    });
  };
  try {
    await replace(initial);
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => server.close(() => done()));
    throw error;
  }
  return {
    hits,
    replace,
    fail(next?: Fault) {
      fault = next;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
      await app?.close();
    },
  };
}

async function publicState(page: Page) {
  return page.evaluate(
    () =>
      new Promise<RuntimeState>((done, reject) => {
        const opening = indexedDB.open('spinel-offline-runtime');
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error('Runtime state is missing.'));
        };
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction('runtime');
          const read = transaction.objectStore('runtime').get('state');
          transaction.oncomplete = () => {
            database.close();
            done(read.result);
          };
          transaction.onabort = transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
  );
}

async function cachedFiles(page: Page, manifest: Pick<ShellManifest, 'version' | 'files'>) {
  return page.evaluate(async (manifest) => {
    const cacheName = `spinel-shell-${manifest.version}`;
    const present: string[] = [];
    for (const path of [...manifest.files, '/'])
      if (await caches.match(path, { cacheName })) present.push(path);
    return present;
  }, manifest);
}

async function updateWorker(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise<'activated' | 'redundant'>((done, reject) => {
      const timer = setTimeout(
        () => finish(new Error('The emitted worker did not finish installing.')),
        120_000,
      );
      let observed: ServiceWorker | null = null;
      const finish = (value: Error | 'activated' | 'redundant') => {
        clearTimeout(timer);
        registration.removeEventListener('updatefound', found);
        observed?.removeEventListener('statechange', changed);
        if (value instanceof Error) reject(value);
        else done(value);
      };
      const changed = () => {
        if (observed?.state === 'activated' || observed?.state === 'redundant')
          finish(observed.state);
      };
      const found = () => {
        observed = registration.installing;
        observed?.addEventListener('statechange', changed);
        changed();
      };
      registration.addEventListener('updatefound', found);
      void registration.update().then(
        () => {
          if (!observed && registration.installing) found();
        },
        (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
      );
    });
  });
}

async function actualClientId(context: BrowserContext, page: Page) {
  const worker = context.serviceWorkers().at(-1);
  if (!worker) throw new Error('The real app worker is not running.');
  const clients = await worker.evaluate(async () =>
    (
      await (self as unknown as ServiceWorkerGlobalScope).clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
    ).map(({ id, url }) => ({ id, url })),
  );
  const current = clients.find((client) => client.url === page.url());
  if (!current) throw new Error('The current page has no actual worker Client.id.');
  return current.id;
}

test('interrupted emitted updates preserve exact native work, a live old client and cold offline startup', async ({
  browserName,
}, info) => {
  test.setTimeout(420_000);
  expect(browserName).toBe('chromium');
  const { copy, edit, savedLocally, selectCell, stored, usableCanvas } =
    await import('./offline-fixture.ts');
  const { DOCS_NORMAL_EDITOR_UNIT_ID_KEY } = await import('@univerjs/core');
  const directory = await mkdtemp(join(tmpdir(), 'spinel-upgrade-profile-'));
  const databasePath = join(directory, 'app.sqlite');
  const db = openDatabase(databasePath);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const account = auth.createUser('Upgrade account');
  const sheet = workspace.create(account.id, {
    name: 'Upgrade Sheet',
    kind: 'sheet',
    parentId: null,
  });
  const doc = workspace.create(account.id, { name: 'Upgrade Doc', kind: 'doc', parentId: null });
  let token = auth.createSession(account.id).token;
  const missing = b.manifest.files.find((path) => /\/HistoryBrowser-.*\.js$/.test(path))!;
  const lazy = a.manifest.files.find((path) => /\/HistoryBrowser-.*\.js$/.test(path))!;
  expect(missing).toBeDefined();
  expect(lazy).toBeDefined();
  const server = await upgradeServer(databasePath, missing);
  let context: BrowserContext | undefined;
  const failures: string[] = [];
  const startBrowser = async (offline = false) => {
    // Closing a persistent context closes its browser process; the next launch
    // reads the same on-disk profile. No storageState fixture restores private data.
    context = await chromium.launchPersistentContext(join(directory, 'profile'), {
      headless: true,
      baseURL: origin,
      viewport: { width: 1440, height: 1100 },
      permissions: ['clipboard-read', 'clipboard-write'],
      offline,
    });
    const network = await syncNetwork(context);
    await network.setOffline(offline);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (error) => failures.push(error.message));
    return { page, network };
  };
  try {
    let { page, network } = await startBrowser();
    await context!.addCookies([
      {
        name: COOKIE_NAME,
        value: token,
        url: origin.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
        expires: Math.floor(Date.now() / 1000) + 3600,
      },
    ]);
    const originals = new Map<string, unknown>();
    const units = new Map<string, string>();
    for (const item of [sheet, doc]) {
      const preparation = await context!.request.post(`/api/items/${item.id}/collaboration`, {
        headers: { Origin: origin },
        data: {},
      });
      expect(preparation.status(), await preparation.text()).toBe(200);
      const unitId = (await preparation.json()).unitId as string;
      units.set(item.id, unitId);
      const response = await context!.request.get(
        `/sync-api/items/${item.id}/snapshot?unitId=${unitId}`,
      );
      expect(response.status()).toBe(200);
      originals.set(item.id, await response.json());
    }
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    for (const item of [sheet, doc]) {
      await page
        .getByRole('button', { name: `More actions for ${item.name}`, exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
        .click();
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: `${item.name} is available offline on this device.` }),
      ).toHaveText(`${item.name} is available offline on this device.`, { timeout: 120_000 });
      if (item.id === sheet.id)
        expect((await publicState(page)).legacyCompatibility).toBeUndefined();
    }
    expect((await publicState(page)).accounts[account.id]).toEqual(a.manifest.compatibility);
    expect(await cachedFiles(page, a.manifest)).toEqual([...a.manifest.files, '/']);
    await network.setOffline(true);
    const text = 'Native draft retained across emitted builds 5519 ';
    for (const [item, value] of [
      [sheet, '731'],
      [doc, text],
    ] as const) {
      await page.goto(`/?item=${item.id}`);
      await usableCanvas(page);
      await edit(page, item.kind as 'sheet' | 'doc', value);
      await savedLocally(page);
    }
    const retainedSheet = await stored(page, account.id, sheet.id);
    const retainedDoc = await stored(page, account.id, doc.id);
    expect(retainedSheet?.outbox?.checkpoint.buffer.length).toBeGreaterThan(0);
    expect(retainedDoc?.outbox?.checkpoint.buffer.length).toBeGreaterThan(0);
    await page.goto('/');

    // An actual aborted versionchange transaction must leave the current schema
    // and every retained queue usable. The application adds no invented migration.
    const schema = await page.evaluate(async (accountId) => {
      const name = `spinel-offline-${accountId}`;
      const result = await new Promise<string>((done, reject) => {
        const opening = indexedDB.open(name, 2);
        opening.onupgradeneeded = () => {
          opening.result.createObjectStore('interrupted-upgrade-fixture');
          opening.transaction!.abort();
        };
        opening.onerror = () => done(opening.error?.name ?? 'error');
        opening.onsuccess = () => {
          opening.result.close();
          reject(new Error('The interrupted schema unexpectedly committed.'));
        };
      });
      return new Promise<{ result: string; version: number; stores: string[] }>((done, reject) => {
        const opening = indexedDB.open(name);
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error('Observation created a database.'));
        };
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const observed = {
            result,
            version: database.version,
            stores: [...database.objectStoreNames],
          };
          database.close();
          done(observed);
        };
      });
    }, account.id);
    expect(schema.result).toBe('AbortError');
    expect(schema.version).toBe(1);
    expect(schema.stores).not.toContain('interrupted-upgrade-fixture');
    expect(await stored(page, account.id, sheet.id)).toEqual(retainedSheet);
    expect(await stored(page, account.id, doc.id)).toEqual(retainedDoc);

    server.fail('missing-lazy');
    await server.replace(b);
    network.holdResume();
    await network.setOffline(false);
    expect(await updateWorker(page)).toBe('redundant');
    const interrupted = await publicState(page);
    expect(interrupted.builds.map((build) => build.version)).toEqual([a.manifest.version]);
    expect(interrupted.candidate?.version).toBe(b.manifest.version);
    const partial = await cachedFiles(page, b.manifest);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial).not.toContain(missing);
    expect(partial).not.toContain('/');
    expect(await cachedFiles(page, a.manifest)).toEqual([...a.manifest.files, '/']);
    await context!.close();
    context = undefined;

    // A process restart during a failed candidate still opens the complete A
    // editor from the persisted profile, while the static server contains B only.
    ({ page, network } = await startBrowser(true));
    await page.goto(`/?item=${sheet.id}`);
    await usableCanvas(page);
    await savedLocally(page);
    expect(await page.evaluate(() => window.__spinelRuntimeHost?.manifest?.version)).toBe(
      a.manifest.version,
    );
    expect(await copy(page, 'sheet')).toBe('731');
    expect(await stored(page, account.id, sheet.id)).toEqual(retainedSheet);
    expect(await stored(page, account.id, doc.id)).toEqual(retainedDoc);
    network.holdResume();
    await network.setOffline(false);
    for (const fault of ['html-asset', 'wrong-html', 'redirect', 'interrupted-html'] as const) {
      server.fail(fault);
      expect(await updateWorker(page), fault).toBe('redundant');
      expect(
        (await publicState(page)).builds.map((build) => build.version),
        fault,
      ).toEqual([a.manifest.version]);
      expect(await cachedFiles(page, b.manifest), fault).not.toContain('/');
      expect(await cachedFiles(page, a.manifest), fault).toEqual([...a.manifest.files, '/']);
      expect(await stored(page, account.id, sheet.id), fault).toEqual(retainedSheet);
      expect(await stored(page, account.id, doc.id), fault).toEqual(retainedDoc);
    }
    for (const fault of [
      'missing-lazy',
      'html-asset',
      'wrong-html',
      'redirect',
      'interrupted-html',
    ] as const)
      expect(
        server.hits.some((hit) => hit.fault === fault),
        fault,
      ).toBe(true);
    expect(server.hits.every((hit) => !hit.credentialed)).toBe(true);

    // Keep a real old document Client.id and its uncommitted native input alive
    // while the worker prepares B. The window never accepts an update remount.
    await selectCell(page, 'E1');
    const draft = 'Unfinished cell while B installs 5520';
    await page.keyboard.insertText(draft);
    const cellInput = page.locator(
      `[id="__editor_${DOCS_NORMAL_EDITOR_UNIT_ID_KEY}"][contenteditable="true"][data-u-comp="editor"]`,
    );
    await expect(cellInput).toBeFocused();
    const canvas = await page.locator('.univer-container canvas').first().elementHandle();
    const clientId = await actualClientId(context!, page);
    await expect
      .poll(async () => (await publicState(page)).clients[clientId])
      .toEqual([a.manifest.version]);
    server.fail();
    expect(await updateWorker(page)).toBe('activated');
    const complete = await publicState(page);
    expect(complete.builds.map((build) => build.version)).toEqual([
      a.manifest.version,
      b.manifest.version,
    ]);
    expect(complete.candidate).toBeUndefined();
    expect(complete.clients[clientId]).toEqual([a.manifest.version]);
    expect(complete.accounts[account.id]).toEqual(a.manifest.compatibility);
    expect(await cachedFiles(page, a.manifest)).toEqual([...a.manifest.files, '/']);
    expect(await cachedFiles(page, b.manifest)).toEqual([...b.manifest.files, '/']);
    expect(
      await page
        .locator('.univer-container canvas')
        .first()
        .evaluate((node, original) => node === original, canvas!),
    ).toBe(true);
    expect(await page.evaluate(() => window.__spinelRuntimeHost?.manifest?.version)).toBe(
      a.manifest.version,
    );
    await cellInput.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await expect
      .poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).trim())
      .toBe(draft);
    expect(await stored(page, account.id, sheet.id)).toEqual(retainedSheet);
    // B's real server cannot answer A's URL. Only the old full cached runtime can.
    const missingOnServer = await context!.request.get(lazy);
    expect(missingOnServer.status()).toBe(404);
    await network.setOffline(true);
    expect(
      await page.evaluate(
        (path) => performance.getEntriesByName(location.origin + path).length,
        lazy,
      ),
    ).toBe(0);
    expect(await page.evaluate(async (path) => Object.keys(await import(path)), lazy)).toContain(
      'HistoryBrowser',
    );
    await cellInput.focus();
    await page.keyboard.press('Escape');
    await context!.close();
    context = undefined;

    ({ page, network } = await startBrowser(true));
    for (const [item, value] of [
      [sheet, '731'],
      [doc, text],
    ] as const) {
      await page.goto(`/?item=${item.id}`);
      await usableCanvas(page);
      await savedLocally(page);
      expect(await page.evaluate(() => window.__spinelRuntimeHost?.manifest?.version)).toBe(
        a.manifest.version,
      );
      const native = await copy(page, item.kind as 'sheet' | 'doc');
      if (item.kind === 'sheet') expect(native).toBe(value);
      else expect(native).toContain(value);
    }
    expect(await stored(page, account.id, sheet.id)).toEqual(retainedSheet);
    expect(await stored(page, account.id, doc.id)).toEqual(retainedDoc);
    expect(
      await page.evaluate(
        async () => (await caches.keys()).filter((name) => name.startsWith('spinel-shell-')).length,
      ),
    ).toBeLessThanOrEqual(3);

    // Exercise admission through an already mounted B application as well as
    // bootstrap selection. A real sign-out keeps the private copies but removes
    // the prepared pointer, so this signed-out navigation must start B itself.
    network.holdResume();
    await network.setOffline(false);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Local access is locked.', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/2 documents have pending or unchecked changes/)).toBeVisible();
    await page.getByRole('button', { name: 'Keep changes', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Sign in with a passkey', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('spinel.offline.account'))).toBeNull();
    expect(await stored(page, account.id, sheet.id)).toEqual(retainedSheet);
    expect(await stored(page, account.id, doc.id)).toEqual(retainedDoc);
    await context!.addInitScript(
      ({ names }) => {
        // This test-owned observer reads the rendered DOM and public host identity;
        // it never invokes admission, changes host state, or writes editor data.
        const observations = { started: [] as string[], private: [] as string[] };
        (window as Window & { spinelUpgradeExposure?: typeof observations }).spinelUpgradeExposure =
          observations;
        new MutationObserver(() => {
          const build = window.__spinelRuntimeHost?.manifest?.version;
          if (!build || !document.querySelector('#root')?.hasChildNodes()) return;
          if (!observations.started.includes(build)) observations.started.push(build);
          const visible = document.body?.textContent ?? '';
          if (
            (names.some((name) => visible.includes(name)) ||
              document.querySelector('.univer-container')) &&
            !observations.private.includes(build)
          )
            observations.private.push(build);
        }).observe(document, { childList: true, subtree: true, characterData: true });
      },
      { names: [sheet.name, doc.name] },
    );
    await page.goto('/sign-in');
    await expect(
      page.getByRole('button', { name: 'Sign in with a passkey', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.__spinelRuntimeHost?.manifest?.version)).toBe(
      b.manifest.version,
    );
    await expect(page.locator('.univer-container')).toHaveCount(0);
    await expect(page.getByText(sheet.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(doc.name, { exact: true })).toHaveCount(0);
    // The server creates a genuine new session; the auth suite separately
    // exercises the complete WebAuthn ceremony. Reload still has no account
    // pointer, so B must authenticate and call host.switchTo before exposure.
    token = auth.createSession(account.id).token;
    await context!.addCookies([
      {
        name: COOKIE_NAME,
        value: token,
        url: origin.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
        expires: Math.floor(Date.now() / 1000) + 3600,
      },
    ]);
    expect(await page.evaluate(() => localStorage.getItem('spinel.offline.account'))).toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__spinelRuntimeHost?.manifest?.version)).toBe(
      a.manifest.version,
    );
    expect(
      await page.evaluate(
        () =>
          (window as Window & { spinelUpgradeExposure?: { started: string[]; private: string[] } })
            .spinelUpgradeExposure,
      ),
    ).toEqual({ started: [b.manifest.version, a.manifest.version], private: [a.manifest.version] });
    expect(await stored(page, account.id, sheet.id)).toEqual(retainedSheet);
    expect(await stored(page, account.id, doc.id)).toEqual(retainedDoc);

    // An unsupported retained record is never mistaken for an empty account or
    // parsed by a different editor. Ordinary online account management survives.
    await page.goto('/');
    const unknown = await page.evaluate(
      async ({ accountId, itemId }) =>
        new Promise<unknown>((done, reject) => {
          const opening = indexedDB.open(`spinel-offline-${accountId}`);
          opening.onupgradeneeded = () => {
            opening.transaction?.abort();
            reject(new Error('The retained store is missing.'));
          };
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const database = opening.result;
            const transaction = database.transaction('items', 'readwrite');
            const items = transaction.objectStore('items');
            const read = items.get(itemId);
            let value: unknown;
            read.onsuccess = () => {
              read.result.bundle.version = 99;
              value = structuredClone(read.result);
              items.put(read.result);
            };
            transaction.oncomplete = () => {
              database.close();
              done(value);
            };
            transaction.onabort = transaction.onerror = () => {
              database.close();
              reject(transaction.error);
            };
          };
        }),
      { accountId: account.id, itemId: sheet.id },
    );
    await context!.addCookies([
      {
        name: COOKIE_NAME,
        value: token,
        url: origin.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    network.holdResume();
    await network.setOffline(false);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Offline copies need attention.' }),
    ).toHaveText(
      'Offline copies need attention. Saved changes were kept. Review This device in your profile.',
    );
    await expect(page.locator('.univer-container')).toHaveCount(0);
    expect(await stored(page, account.id, sheet.id)).toEqual(unknown);
    expect(await stored(page, account.id, doc.id)).toEqual(retainedDoc);
    for (const item of [sheet, doc]) {
      const response = await context!.request.get(
        `/sync-api/items/${item.id}/snapshot?unitId=${units.get(item.id)}`,
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual(originals.get(item.id));
    }
    await network.setOffline(true);
    await page.goto(`/?item=${sheet.id}`);
    await expect(page.getByRole('heading', { name: "You're offline", exact: true })).toBeVisible();
    await expect(page.locator('.univer-container')).toHaveCount(0);
    expect(await stored(page, account.id, sheet.id)).toEqual(unknown);
    expect(failures).toEqual([]);
    await info.attach('spn-055-emitted-runtime-builds', {
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify(
          { a: a.manifest, b: b.manifest, abortedSchema: schema, refusedRequests: server.hits },
          null,
          2,
        ),
      ),
    });
  } finally {
    await context?.close();
    await server.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
