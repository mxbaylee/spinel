import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { ClientRequest } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { APIRequest, APIRequestContext } from '@playwright/test';
import { withFixtureCleanup } from '../../e2e/owned-process.ts';
import { patchInstalledPlaywright, preparePlaywrightPatch } from './patch-playwright.ts';

const installedDirectory = resolve(import.meta.dirname, '../../node_modules/playwright-core');
const readBuild = () => readFile(resolve(installedDirectory, 'lib/coreBundle.js'), 'utf8');

test('Playwright patch is idempotent and refuses altered upstream code', async () => {
  const { original, patched } = preparePlaywrightPatch(await readBuild());
  assert.equal(preparePlaywrightPatch(patched).patched, patched);
  for (const source of [original, patched, patched.replace('keepAlive: false', 'keepAlive: true')])
    assert.throws(() => preparePlaywrightPatch(source + '\n// drift'), /Unrecognized/);
  assert.throws(
    () => preparePlaywrightPatch(patched.replace('keepAlive: false', 'keepAlive: true')),
    /Unrecognized/,
  );
});

test('Playwright install rejects an upgrade or corrupted build before writing', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'spinel-api-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'node_modules/playwright-core');
  const file = resolve(directory, 'lib/coreBundle.js');
  const metadata = resolve(directory, 'package.json');
  await assert.rejects(patchInstalledPlaywright(root), { code: 'ENOENT' });
  await patchInstalledPlaywright(root, true);
  await mkdir(resolve(directory, 'lib'), { recursive: true });
  await assert.rejects(patchInstalledPlaywright(root, true), { code: 'ENOENT' });
  const { original, patched } = preparePlaywrightPatch(await readBuild());
  await writeFile(file, original);
  await writeFile(metadata, JSON.stringify({ version: '1.65.0' }));
  await assert.rejects(patchInstalledPlaywright(root), /Upgrading Playwright/);
  assert.equal(await readFile(file, 'utf8'), original);
  await writeFile(metadata, JSON.stringify({ version: '1.64.1' }));
  await writeFile(file, original + '\n// drift');
  await assert.rejects(patchInstalledPlaywright(root), /Unrecognized/);
  assert.equal(await readFile(file, 'utf8'), original + '\n// drift');
  await writeFile(file, original);
  await patchInstalledPlaywright(root);
  await patchInstalledPlaywright(root);
  assert.equal(await readFile(file, 'utf8'), patched);
});

type Event = { kind: string; at: number; [key: string]: unknown };
async function fixture(protocol: 'http' | 'https', directory: string) {
  const child = fork(
    new URL('./playwright-transport-fixture.ts', import.meta.url),
    [protocol, resolve(directory, 'key.pem'), resolve(directory, 'cert.pem')],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  const events: Event[] = [];
  child.on('message', (event: Event) => events.push(event));
  const exited = once(child, 'exit');
  // Consume stderr so a failing child cannot block on its output pipe.
  child.stderr!.resume();
  const deadline = AbortSignal.timeout(15_000);
  const next = async (kind: string, after = 0): Promise<Event> => {
    while (true) {
      // Several IPC messages may arrive before the await continuation runs.
      // Recheck the journal on every wake rather than losing a batched event.
      const existing = events.slice(after).find((event) => event.kind === kind);
      if (existing) return existing;
      await Promise.race([
        once(child, 'message', { signal: deadline }),
        exited.then(() => {
          throw new Error('HTTP fixture exited before ' + kind);
        }),
      ]);
    }
  };
  const flush = async () => {
    const after = events.length;
    child.send('flush');
    await next('flushed', after);
  };
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.send('stop');
    const kill = setTimeout(() => child.kill('SIGKILL'), 8_000);
    try {
      const [code, signal] = await exited;
      assert.equal(signal, null, 'fixture closes without forced termination');
      assert.equal(code, 0);
    } finally {
      clearTimeout(kill);
    }
  };
  try {
    const ready = await next('ready');
    assert.equal(ready.keepAliveTimeout, 5_000);
    assert.equal(ready.keepAliveTimeoutBuffer, 1_000);
    return { child, events, next, close, flush, origin: `${protocol}://127.0.0.1:${ready.port}` };
  } catch (error) {
    await close();
    throw error;
  }
}

test(
  'real API client reproduces the server idle-timeout race and fixes it without retrying',
  { timeout: 45_000 },
  async (t) => {
    const root = await mkdtemp(resolve(tmpdir(), 'spinel-api-transport-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const { original, patched } = preparePlaywrightPatch(await readBuild());
    for (const [name, source] of [
      ['original', original],
      ['patched', patched],
    ]) {
      const directory = resolve(root, name);
      await cp(installedDirectory, directory, { recursive: true });
      await writeFile(resolve(directory, 'lib/coreBundle.js'), source);
      const { request } = createRequire(import.meta.url)(resolve(directory, 'index.js')) as {
        request: APIRequest;
      };
      const server = await fixture('http', root);
      let context: APIRequestContext | undefined;
      const clientEvents: { reused: boolean; at: number }[] = [];
      const originalRequest = http.request;
      http.request = function (...args: unknown[]) {
        const request = Reflect.apply(originalRequest, http, args) as ClientRequest;
        request.once('socket', () =>
          clientEvents.push({ reused: request.reusedSocket, at: Date.now() }),
        );
        return request;
      } as typeof http.request;
      await withFixtureCleanup(
        async () => {
          context = await request.newContext();
          assert.equal((await context.get(server.origin)).status(), 200);
          server.child.send('stall');
          await server.next('stall-start');
          // Dispatch while the real server cannot consume queued bytes. There is no
          // arbitrary readiness sleep and no client retry (Playwright defaults to 0).
          if (name === 'original') {
            await assert.rejects(context.get(server.origin), /ECONNRESET|socket hang up/);
            assert.deepEqual(
              clientEvents.map((e) => e.reused),
              [false, true],
            );
            await server.next('idle-timeout');
            await server.flush();
            assert.equal(server.events.filter((e) => e.kind === 'request').length, 1);
          } else {
            assert.equal((await context.get(server.origin)).status(), 200);
            await server.flush();
            assert.deepEqual(
              clientEvents.map((e) => e.reused),
              [false, false],
            );
            assert.equal(server.events.filter((e) => e.kind === 'request').length, 2);
            assert.equal(
              server.events.some((e) => e.kind === 'idle-timeout'),
              false,
            );
            await preservesFailures(context, server);
          }
          const ended = await server.next('stall-end');
          assert.ok(clientEvents[1].at < ended.at, 'request really was sent during the stall');
        },
        async () => {
          http.request = originalRequest;
          t.diagnostic(JSON.stringify({ name, clientEvents, serverEvents: server.events }));
          await withFixtureCleanup(async () => {
            await context?.dispose();
          }, server.close);
        },
      );
    }
  },
);

async function preservesFailures(
  context: APIRequestContext,
  server: Awaited<ReturnType<typeof fixture>>,
) {
  const { origin, events } = server;
  const before = events.filter((e) => e.kind === 'request').length;
  await assert.rejects(
    context.post(`${origin}/reset`, { data: 'one mutation' }),
    /ECONNRESET|socket hang up/,
  );
  await server.flush();
  assert.equal(
    events.filter((e) => e.kind === 'request').length,
    before + 1,
    'failed POST is never replayed',
  );
  assert.equal(
    (await context.get(`${origin}/unavailable`)).status(),
    503,
    'server failures stay visible',
  );
}

test('HTTPS API requests also use distinct connections', { timeout: 15_000 }, async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'spinel-api-tls-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      resolve(root, 'key.pem'),
      '-out',
      resolve(root, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  const { request } = await import('@playwright/test');
  const server = await fixture('https', root);
  let context: APIRequestContext | undefined;
  await withFixtureCleanup(
    async () => {
      context = await request.newContext({ ignoreHTTPSErrors: true });
      for (let i = 0; i < 3; i++) assert.equal((await context.get(server.origin)).status(), 200);
      await server.flush();
      assert.equal(server.events.filter((e) => e.kind === 'connection').length, 3);
      assert.equal(server.events.filter((e) => e.kind === 'request').length, 3);
    },
    async () => {
      await withFixtureCleanup(async () => {
        await context?.dispose();
      }, server.close);
    },
  );
});
