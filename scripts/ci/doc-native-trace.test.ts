import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import type { CDPSession } from '@playwright/test';
import { startNativeDiagnosticTrace } from '../../e2e/doc-responsiveness-native-trace.ts';
import { callbackProgress } from '../../e2e/doc-responsiveness-callback-progress.ts';

function session(
  options: {
    lost?: boolean;
    readError?: boolean;
    hang?: boolean;
    oversized?: boolean;
    endError?: boolean;
    completion?: Record<string, unknown>;
    closeError?: boolean;
  } = {},
) {
  const emitter = new EventEmitter(),
    calls: string[] = [];
  const failure = new Error('original transport failure');
  let rejectEnd: ((error: Error) => void) | undefined,
    pendingEndSettled = false;
  const completed = (stream: string) =>
    options.completion ?? {
      stream,
      dataLossOccurred: options.lost ?? false,
      traceFormat: 'proto',
      streamCompression: 'none',
    };
  return Object.assign(emitter, {
    calls,
    failure,
    pendingEndSettled: () => pendingEndSettled,
    async detach() {
      calls.push('detach');
      if (options.hang || options.endError)
        emitter.emit('Tracing.tracingComplete', completed('late-owned'));
      rejectEnd?.(new Error('owned session closed'));
      emitter.emit('close');
    },
    async send(command: string) {
      calls.push(command);
      if (command === 'Tracing.getCategories') return { categories: ['v8'] };
      if (command === 'Tracing.end') {
        if (options.endError) throw failure;
        if (options.hang) {
          try {
            await new Promise((_, reject) => {
              rejectEnd = reject;
            });
          } finally {
            pendingEndSettled = true;
          }
        }
        emitter.emit('Tracing.tracingComplete', completed('owned'));
      }
      if (command === 'IO.read') {
        if (options.readError) throw failure;
        return {
          data: options.oversized
            ? ' '.repeat(64 * 1024 * 1024 + 1)
            : 'complete raw protobuf test bytes',
          eof: true,
        };
      }
      if (command === 'IO.close' && options.closeError) throw new Error('secondary close failure');
      return {};
    },
  });
}

for (const mode of [
  'complete',
  'lost',
  'readError',
  'oversized',
  'existing-file',
  'endError',
  'receipt-failure',
] as const)
  test(`native trace ${mode} preserves first failure and owns transport settlement`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'spn146-trace-')),
      path = join(root, 'trace.pftrace.gz');
    const cdp = session({
      [mode]: true,
      readError: mode === 'readError' || mode === 'receipt-failure',
    });
    const progress = callbackProgress(join(root, 'progress.json'));
    try {
      if (mode === 'existing-file') await writeFile(path, 'preserve');
      if (mode === 'receipt-failure') await mkdir(path + '.receipt.json.tmp');
      const trace = await startNativeDiagnosticTrace(cdp as unknown as CDPSession, path, progress, {
        signal: new AbortController().signal,
        interrupt: () => cdp.detach(),
      });
      if (mode === 'complete') {
        const result = await trace.finish();
        assert.equal(result.complete, true);
        assert.deepEqual(await trace.finish(), result);
        assert.equal(
          gunzipSync(await readFile(path)).toString(),
          'complete raw protobuf test bytes',
        );
      } else if (['readError', 'endError', 'receipt-failure'].includes(mode))
        await assert.rejects(trace.finish(), (error) => error === cdp.failure);
      else await assert.rejects(trace.finish());
      if (mode !== 'receipt-failure') {
        const receipt = JSON.parse(await readFile(path + '.receipt.json', 'utf8'));
        assert.equal(receipt.complete, mode === 'complete');
      }
      assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0);
      assert.equal(cdp.calls.filter((value) => value === 'Tracing.end').length, 1);
      assert.equal(cdp.calls.filter((value) => value === 'IO.close').length, 1);
      if (mode === 'existing-file') assert.equal(await readFile(path, 'utf8'), 'preserve');
      else if (mode !== 'complete') await assert.rejects(readFile(path), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test('native trace deadline settles pending end and closes a late handle before returning', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'spn146-trace-')),
    path = join(root, 'trace.pftrace.gz');
  const cdp = session({ hang: true });
  try {
    const trace = await startNativeDiagnosticTrace(
      cdp as unknown as CDPSession,
      path,
      callbackProgress(join(root, 'progress.json')),
      { signal: new AbortController().signal, interrupt: () => cdp.detach() },
    );
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const rejected = assert.rejects(trace.finish(), /30 seconds/);
    t.mock.timers.tick(30_001);
    await rejected;
    assert.equal(cdp.pendingEndSettled(), true);
    assert.equal(cdp.calls.filter((value) => value === 'detach').length, 1);
    assert.equal(cdp.calls.filter((value) => value === 'IO.close').length, 1);
    const receipt = JSON.parse(await readFile(path + '.receipt.json', 'utf8'));
    assert.equal(receipt.complete, false);
    assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0);
  } finally {
    t.mock.timers.reset();
    await rm(root, { recursive: true, force: true });
  }
});

for (const invalid of [
  { traceFormat: 'json', streamCompression: 'none', dataLossOccurred: false },
  { traceFormat: 'proto', streamCompression: 'gzip', dataLossOccurred: false },
  { traceFormat: 'proto', streamCompression: 'none', dataLossOccurred: true },
  { traceFormat: 'proto', streamCompression: 'none' },
  { traceFormat: undefined, streamCompression: 'none', dataLossOccurred: false },
])
  for (const closeError of [false, true])
    test(`native receipt retains rejected completion ${JSON.stringify(invalid)}, close failure=${closeError}`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'spn146-completion-'));
      const path = join(root, 'trace.pftrace.gz');
      const cdp = session({ completion: { stream: 'owned', ...invalid }, closeError });
      try {
        const trace = await startNativeDiagnosticTrace(
          cdp as unknown as CDPSession,
          path,
          callbackProgress(join(root, 'progress.json')),
          { signal: new AbortController().signal, interrupt: () => cdp.detach() },
        );
        await assert.rejects(trace.finish(), /did not confirm/);
        const receipt = JSON.parse(await readFile(path + '.receipt.json', 'utf8'));
        assert.equal(receipt.complete, false);
        assert.equal(receipt.completionFailure.streamPresent, true);
        assert.deepEqual(receipt.completionFailure.streamClose, {
          attempted: true,
          settled: true,
          error: closeError ? 'Error: secondary close failure' : null,
        });
        for (const key of ['traceFormat', 'streamCompression', 'dataLossOccurred'] as const) {
          assert.deepEqual(receipt.completionFailure.fields[key], {
            present: Object.hasOwn(invalid, key),
            type: typeof invalid[key],
            value: invalid[key] ?? null,
          });
        }
        assert.equal(cdp.calls.includes('IO.read'), false);
        assert.equal(cdp.calls.filter((value) => value === 'IO.close').length, 1);
        assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0);
        await assert.rejects(readFile(path), { code: 'ENOENT' });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
