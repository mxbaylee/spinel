import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { CDPSession } from '@playwright/test';
import { startDiagnosticTrace } from './spn133-trace.ts';

for (const scenario of ['complete', 'data-loss', 'missing-stream'] as const) {
  test(`trace retention: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'spn133-trace-'));
    const destination = join(root, 'trace.json');
    let listener: ((value: unknown) => void) | undefined;
    let reads = 0;
    let ends = 0;
    let closes = 0;
    const cdp = {
      on(_event: string, callback: typeof listener) {
        listener = callback;
      },
      off() {
        listener = undefined;
      },
      async send(command: string) {
        if (command === 'Tracing.start') return {};
        if (command === 'Tracing.end') {
          ends++;
          listener?.({
            dataLossOccurred: scenario === 'data-loss',
            ...(scenario === 'missing-stream' ? {} : { stream: 'owned-trace' }),
          });
          return {};
        }
        if (command === 'IO.read') {
          reads++;
          return reads === 1
            ? {
                data: Buffer.from('{"traceEvents":').toString('base64'),
                base64Encoded: true,
                eof: false,
              }
            : { data: '[]}', base64Encoded: false, eof: true };
        }
        if (command === 'IO.close') {
          closes++;
          return {};
        }
        throw new Error('Unexpected command ' + command);
      },
    } as unknown as CDPSession;
    try {
      const stop = await startDiagnosticTrace(cdp, destination);
      const first = await stop();
      assert.equal(await stop(), first);
      assert.equal(ends, 1);
      assert.equal(listener, undefined);
      assert.equal(first.complete, scenario === 'complete');
      if (scenario !== 'missing-stream') {
        assert.equal(await readFile(destination, 'utf8'), '{"traceEvents":[]}');
        assert.equal(closes, 1);
      } else assert.equal(reads, 0);
      if (scenario === 'data-loss') assert.match(String(first.error), /data loss/);
      if (scenario === 'missing-stream')
        assert.match(String(first.error), /did not supply a stream/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
