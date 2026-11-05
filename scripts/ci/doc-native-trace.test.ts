import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CDPSession } from '@playwright/test';
import { startNativeDiagnosticTrace } from '../../e2e/doc-responsiveness-native-trace.ts';

function session(
  options: { lost?: boolean; readError?: boolean; hang?: boolean; oversized?: boolean } = {},
) {
  const emitter = new EventEmitter();
  const calls: string[] = [];
  let read = 0;
  return Object.assign(emitter, {
    calls,
    async detach() {
      calls.push('detach');
    },
    async send(command: string) {
      calls.push(command);
      if (command === 'Tracing.getCategories') return { categories: ['v8'] };
      if (command === 'Tracing.end') {
        if (options.hang) return new Promise(() => {});
        queueMicrotask(() =>
          emitter.emit('Tracing.tracingComplete', {
            stream: 'owned',
            dataLossOccurred: options.lost ?? false,
            traceFormat: 'json',
            streamCompression: 'none',
          }),
        );
      }
      if (command === 'IO.read') {
        if (options.oversized) return { data: ' '.repeat(64 * 1024 * 1024 + 1), eof: true };
        if (read++ === 0) return { data: '{"traceEvents":', eof: false };
        if (options.readError) throw new Error('transport failure');
        return { data: '[]}', eof: true };
      }
      return {};
    },
  });
}

for (const mode of ['complete', 'lost', 'readError', 'oversized', 'existing-file'] as const)
  test(`native trace retains first ${mode} outcome and closes owned resources`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'spn146-trace-')),
      path = join(root, 'trace.json');
    const cdp = session({ [mode]: true });
    try {
      if (mode === 'existing-file') await writeFile(path, 'preserve');
      const trace = await startNativeDiagnosticTrace(cdp as unknown as CDPSession, path);
      if (mode === 'complete') {
        const result = await trace.finish();
        assert.equal(result.complete, true);
        assert.deepEqual(await trace.finish(), result);
        assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { traceEvents: [] });
      } else await assert.rejects(trace.finish());
      const receipt = JSON.parse(await readFile(path + '.receipt.json', 'utf8'));
      assert.equal(receipt.complete, mode === 'complete');
      assert.equal(receipt.streamClosed, true);
      assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0);
      assert.equal(cdp.calls.filter((value) => value === 'Tracing.end').length, 1);
      assert.equal(cdp.calls.filter((value) => value === 'IO.close').length, 1);
      if (mode === 'existing-file') assert.equal(await readFile(path, 'utf8'), 'preserve');
      if (mode === 'readError') assert.ok(receipt.bytes > 0);
      if (mode === 'oversized') assert.equal(receipt.bytes, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test('native trace deadline interrupts the owned session and retains failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'spn146-trace-')),
    path = join(root, 'trace.json');
  const cdp = session({ hang: true });
  try {
    const trace = await startNativeDiagnosticTrace(cdp as unknown as CDPSession, path);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const rejected = assert.rejects(trace.finish(), /30 seconds/);
    t.mock.timers.tick(30_001);
    await rejected;
    const receipt = JSON.parse(await readFile(path + '.receipt.json', 'utf8'));
    assert.equal(receipt.complete, false);
    assert.ok(cdp.calls.includes('detach'));
    assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0);
  } finally {
    t.mock.timers.reset();
    await rm(root, { recursive: true, force: true });
  }
});
