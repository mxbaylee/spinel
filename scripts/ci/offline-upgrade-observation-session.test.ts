import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { Browser, BrowserContext, TestInfo } from '@playwright/test';
import { startOfflineUpgradeObservation } from '../../e2e/offline-upgrade-observation.ts';

const worker = { cat: 'ServiceWorker', name: 'ServiceWorkerVersion::Request', ph: 'b', ts: 1 };

async function session(t: TestContext, events: unknown[], startFailure?: Error) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-worker-observation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls: { method: string; params?: unknown }[] = [];
  let detached = 0;
  const cdp = Object.assign(new EventEmitter(), {
    async send(method: string, params?: unknown) {
      calls.push({ method, params });
      if (method === 'Tracing.getCategories') return { categories: ['__metadata'] };
      if (method === 'Tracing.start' && startFailure) throw startFailure;
      if (method === 'Tracing.end') {
        cdp.emit('Tracing.dataCollected', { value: events });
        cdp.emit('Tracing.tracingComplete', { dataLossOccurred: false });
      }
      return {};
    },
    async detach() {
      detached++;
    },
  });
  const context = new EventEmitter();
  const browser = {
    version: () => 'deterministic-CDP-adapter',
    newBrowserCDPSession: async () => cdp,
  } as unknown as Browser;
  const info = {
    outputPath: () => join(directory, 'receipt.json'),
    project: { name: 'offline-upgrade' },
    testId: 'collector-session-control',
    retry: 0,
  } as Pick<TestInfo, 'outputPath' | 'project' | 'testId' | 'retry'>;
  return {
    calls,
    start: () =>
      startOfflineUpgradeObservation(browser, context as unknown as BrowserContext, info, {
        tested: 'controlled-protocol-boundary',
      }),
    receipt: async () => JSON.parse(await readFile(info.outputPath('receipt.json'), 'utf8')),
    cleaned() {
      assert.equal(detached, 1);
      assert.deepEqual(cdp.eventNames(), []);
      assert.deepEqual(context.eventNames(), []);
    },
  };
}

test('actual worker capture does not require prior category enumeration', async (t) => {
  // Enumeration reflects code paths already reached; the requested category can
  // emit later. This controls the CDP boundary, not a browser or service worker.
  const fixture = await session(t, [worker]);
  const observation = await fixture.start();
  observation.mark('legacy-download');
  await observation.finish();
  await observation.finish();
  assert.deepEqual(
    fixture.calls.filter((call) => call.method === 'Tracing.start'),
    [
      {
        method: 'Tracing.start',
        params: {
          transferMode: 'ReportEvents',
          bufferUsageReportingInterval: 1000,
          traceConfig: {
            recordMode: 'recordUntilFull',
            traceBufferSizeInKb: 4096,
            includedCategories: ['ServiceWorker'],
          },
        },
      },
    ],
  );
  assert.equal(fixture.calls.filter((call) => call.method === 'Tracing.end').length, 1);
  const receipt = await fixture.receipt();
  assert.equal(receipt.complete, true);
  assert.equal(receipt.trace.workerEvents, 1);
  assert.deepEqual(receipt.trace.events, [worker]);
  assert.equal(receipt.firstFailure, null);
  assert.deepEqual(receipt.collectionFailures, []);
  fixture.cleaned();
});

test('successful trace startup with no actual worker events still fails', async (t) => {
  const fixture = await session(t, [{ name: 'thread_name', ph: 'M' }]);
  const observation = await fixture.start();
  await assert.rejects(observation.finish(), /Offline-upgrade worker diagnostics are incomplete/);
  const receipt = await fixture.receipt();
  assert.equal(receipt.complete, false);
  assert.equal(receipt.trace.workerEvents, 0);
  assert.equal(receipt.trace.terminal.dataLossOccurred, false);
  assert.equal(receipt.collectionFailures.length, 1);
  fixture.cleaned();
});

test('trace startup failure stays first while incomplete collection and cleanup are retained', async (t) => {
  const first = new Error('Trace startup rejected.');
  const fixture = await session(t, [], first);
  await assert.rejects(fixture.start(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0], first);
    assert.match(String(error.errors[1]), /Offline-upgrade worker diagnostics are incomplete/);
    return true;
  });
  const receipt = await fixture.receipt();
  assert.equal(receipt.complete, false);
  assert.equal(receipt.firstFailure, String(first));
  assert.equal(receipt.collectionFailures.length, 1);
  fixture.cleaned();
});
