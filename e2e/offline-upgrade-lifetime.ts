import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import { PREPARE_SHELL } from '../src/shared/offlineShell.ts';
import { originalUpgradeRequest } from './offline-upgrade-original-proxy.ts';
import { forwardUpgradeRequest } from './offline-upgrade-proxy.ts';
import {
  captureWaitingReplacement,
  hasActivatedReplacement,
  upgradeWorkerState,
} from './offline-upgrade-worker-state.ts';
import type { UpgradeWorkerControl } from './offline-upgrade-worker-state.ts';

function within<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Same emitted workers/body interruption; only the real proxy owner differs. */
export async function verifyUpgradeResponseLifetime(
  browser: Browser,
  legacyDirectory: string,
  replacementDirectory: string,
  mode: 'original' | 'repaired',
  record: (entry: Record<string, unknown>) => void,
) {
  const started = performance.now();
  const emit = (event: string, fields: Record<string, unknown> = {}) =>
    record({ mode, event, elapsedMs: Math.round(performance.now() - started), ...fields });
  const sockets = new Set<Socket>();
  const servers: Server[] = [];
  async function listen(server: Server) {
    servers.push(server);
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return address.port;
  }
  let directory = legacyDirectory;
  const lazy = (await readdir(join(legacyDirectory, 'assets'))).find((path) =>
    /^HistoryBrowser-.*\.js$/.test(path),
  );
  assert.ok(lazy, 'Use a real lazy asset consumed by the emitted legacy preparation.');
  const target = `/assets/${lazy}`;
  const partial = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  let body: ServerResponse | undefined;
  let downstream: ServerResponse | undefined;
  let failure: unknown;
  const cleanupFailures: unknown[] = [];
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const backend = await listen(
      createServer((incoming, outgoing) => {
        void (async () => {
          const path = new URL(incoming.url!, 'http://localhost').pathname;
          outgoing.setHeader('Cache-Control', 'no-store');
          if (path === '/lifetime-control') {
            outgoing.setHeader('Content-Type', 'text/html');
            outgoing.end('<!doctype html><title>Emitted worker lifetime control</title>');
            return;
          }
          const file = path === '/sign-in' ? '/index.html' : path;
          const bytes = await readFile(join(directory, file));
          outgoing.setHeader(
            'Content-Type',
            file.endsWith('.js')
              ? 'text/javascript'
              : file.endsWith('.css')
                ? 'text/css'
                : file.endsWith('.html')
                  ? 'text/html'
                  : 'application/octet-stream',
          );
          outgoing.setHeader('Content-Length', bytes.length);
          if (directory === legacyDirectory && path === target) {
            assert.ok(bytes.length > 128);
            body = outgoing;
            outgoing.write(bytes.subarray(0, 128));
            emit('upstream-body-started', { path, bytes: bytes.length, sent: 128 });
            return;
          }
          outgoing.end(bytes);
        })().catch((error: unknown) => outgoing.destroy(error as Error));
      }),
    );
    const forward = mode === 'original' ? originalUpgradeRequest : forwardUpgradeRequest;
    const proxy = await listen(
      createServer((incoming, outgoing) => {
        const request = forward(incoming, outgoing, backend);
        if (incoming.url === target) {
          downstream = outgoing;
          request.once('response', (response) => {
            response.once('data', () => partial.resolve());
            response.once('aborted', () => {
              emit('upstream-body-aborted');
              aborted.resolve();
            });
          });
          outgoing.once('close', () => emit('downstream-closed'));
        }
      }),
    );
    for (const [label, source] of [
      ['legacy', legacyDirectory],
      ['replacement', replacementDirectory],
    ] as const)
      emit('emitted-worker', {
        label,
        sha256: createHash('sha256')
          .update(await readFile(join(source, 'service-worker.js')))
          .digest('hex'),
      });
    emit('browser', { version: browser.version() });
    await page.goto(`http://127.0.0.1:${proxy}/lifetime-control`);
    await page.evaluate(() =>
      navigator.serviceWorker.register('/service-worker.js', { type: 'module' }),
    );
    await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
    const control = await page.evaluateHandle(async (type) => {
      const original = navigator.serviceWorker.controller;
      if (!original) throw new Error('The actual legacy worker must control this page.');
      const observation: UpgradeWorkerControl = {
        registration: await navigator.serviceWorker.ready,
        original,
        replacement: null,
        result: null,
      };
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        observation.result = event.data;
        channel.port1.close();
      };
      original.postMessage({ type }, [channel.port2]);
      return observation;
    }, PREPARE_SHELL);
    await within(partial.promise, 5000, 'The actual legacy preparation did not request its asset.');
    directory = replacementDirectory;
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await page.waitForFunction(captureWaitingReplacement, control);
    const state = () => page.evaluate(upgradeWorkerState, control);
    const waiting = await state();
    assert.equal(waiting.waiting, 'installed');
    assert.equal(waiting.waitingIsReplacement, true);
    assert.equal(waiting.active, 'activated');
    assert.equal(waiting.activeIsOriginal, true);
    assert.equal(waiting.original, 'activated');
    assert.equal(waiting.preparation, null);
    emit('replacement-waiting', waiting);
    assert.ok(body && downstream);
    assert.equal((await state()).preparation, null);
    const closed = new Promise<void>((resolve) => downstream!.once('close', () => resolve()));
    body.destroy();
    emit('interrupt-upstream-body');
    await within(aborted.promise, 1000, 'The upstream response did not report its interruption.');
    if (mode === 'original') {
      const message = 'Original proxy retained its downstream response after upstream abort.';
      await assert.rejects(within(closed, 1000, message), { message });
      const blocked = await state();
      assert.equal(downstream.destroyed, false);
      assert.equal(blocked.preparation, null);
      assert.equal(blocked.waiting, 'installed');
      assert.equal(blocked.waitingIsReplacement, true);
      assert.equal(blocked.activeIsOriginal, true);
      emit('original-obstruction-confirmed', blocked);
      // Release this exact leaked HTTP owner, keeping the old page/worker alive.
      // No injected waitUntil, unregister, navigation, cache deletion or retry.
      downstream.destroy();
      emit('release-original-response');
    }
    await within(closed, 1000, 'Interrupted response remained open.');
    await page.waitForFunction((observation) => observation.result !== null, control);
    const settled = await state();
    assert.equal((settled.preparation as { ok: boolean }).ok, false);
    await page.waitForFunction(hasActivatedReplacement, control);
    const activated = await state();
    assert.equal(activated.active, 'activated');
    assert.equal(activated.activeIsReplacement, true);
    assert.equal(activated.activeIsOriginal, false);
    assert.equal(activated.original, 'redundant');
    assert.equal(activated.waiting, null);
    assert.equal(activated.preparation?.ok, false);
    emit('replacement-activated', activated);
  } catch (error) {
    failure = error;
    emit('first-failure', { error: String(error), downstreamClosed: downstream?.destroyed });
  } finally {
    try {
      await within(context.close(), 5000, 'Owned browser context did not close.');
    } catch (error) {
      cleanupFailures.push(error);
    }
    for (const socket of sockets) socket.destroy();
    for (const server of servers.filter((server) => server.listening))
      try {
        await within(
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
          5000,
          'Owned HTTP server did not close.',
        );
      } catch (error) {
        cleanupFailures.push(error);
      }
    emit('cleanup-complete', { failures: cleanupFailures.map(String) });
  }
  if (failure || cleanupFailures.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanupFailures],
      'Emitted worker lifetime control failed.',
    );
}
