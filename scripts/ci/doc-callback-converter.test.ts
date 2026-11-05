import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { runDocTraceProcessor } from '../../e2e/doc-responsiveness-callback-converter.ts';
import {
  docTraceProcessorAuthority,
  verifyDocTraceProcessor,
  verifyDocTraceProcessorBytes,
} from './doc-trace-processor.ts';

const fixture = fileURLToPath(new URL('./fixtures/doc-trace-child.ts', import.meta.url));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function directory(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'spinel-converter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('binds complete derived gzip and decoded bytes after the child and output settle', async (t) => {
  const dir = await directory(t),
    output = join(dir, 'derived.json.gz');
  const result = await runDocTraceProcessor(process.execPath, [fixture, 'complete'], {
    signal: new AbortController().signal,
    output,
  });
  assert.equal(result.failed, false);
  assert.equal(result.receipt.childClosed, true);
  assert.equal(result.receipt.code, 0);
  assert.equal(result.receipt.stderr, 'retained warning\n');
  const stored = await readFile(output),
    raw = gunzipSync(stored);
  assert.deepEqual(JSON.parse(raw.toString()), { traceEvents: [] });
  assert.equal(result.output!.sha256, hash(stored));
  assert.equal(result.output!.bytes, stored.length);
  assert.deepEqual(result.output!.decoded, { bytes: raw.length, sha256: hash(raw) });
});

test('nonzero conversion removes partial output and retains the failure diagnostics', async (t) => {
  const output = join(await directory(t), 'partial.gz');
  const result = await runDocTraceProcessor(process.execPath, [fixture, 'failed'], {
    signal: new AbortController().signal,
    output,
  });
  assert.equal(result.failed, true);
  assert.equal(result.receipt.code, 7);
  assert.equal(result.receipt.childClosed, true);
  assert.equal(result.receipt.stderr, 'original converter failure\n');
  assert.equal(result.receipt.outputRemoved, true);
  assert.equal(existsSync(output), false);
});

test('an observation abort kills and awaits an acquired child without accepting partial success', async (t) => {
  const dir = await directory(t),
    output = join(dir, 'partial.gz'),
    ready = join(dir, 'ready');
  const controller = new AbortController(),
    reason = new Error('original observation deadline');
  t.after(() => controller.abort(reason));
  const pending = runDocTraceProcessor(process.execPath, [fixture, 'wait', ready], {
    signal: controller.signal,
    output,
  });
  const limit = Date.now() + 5000;
  while (!existsSync(ready) && Date.now() < limit) await delay(10);
  assert.equal(existsSync(ready), true, 'fixture child must start before cancellation');
  controller.abort(reason);
  const result = await pending;
  assert.equal(result.failed, true);
  assert.equal(result.failure, reason);
  assert.equal(result.receipt.signal, 'SIGKILL');
  assert.equal(result.receipt.childClosed, true);
  assert.equal(result.receipt.outputRemoved, true);
  assert.equal(existsSync(output), false);
});

test('pre-aborted observations acquire no output, and existing files are never replaced', async (t) => {
  const output = join(await directory(t), 'owned-by-someone-else');
  await writeFile(output, 'keep');
  await assert.rejects(
    runDocTraceProcessor(process.execPath, [fixture, 'complete'], {
      signal: AbortSignal.abort(new Error('already stopped')),
      output,
    }),
    /already stopped/,
  );
  await assert.rejects(
    runDocTraceProcessor(process.execPath, [fixture, 'complete'], {
      signal: new AbortController().signal,
      output,
    }),
    /EEXIST/,
  );
  assert.equal(await readFile(output, 'utf8'), 'keep');
});

test('spawn failure closes ownership and removes its exclusively acquired output', async (t) => {
  const dir = await directory(t),
    output = join(dir, 'failed.gz');
  const result = await runDocTraceProcessor(join(dir, 'absent'), [], {
    signal: new AbortController().signal,
    output,
  });
  assert.equal(result.failed, true);
  assert.match(String(result.failure), /ENOENT/);
  assert.equal(result.receipt.childClosed, true);
  assert.equal(result.receipt.outputRemoved, true);
  assert.equal(existsSync(output), false);
});

test('query stdout and diagnostic bounds fail closed instead of truncating to a passing receipt', async () => {
  for (const mode of ['stderr-bound', 'stdout-bound']) {
    const result = await runDocTraceProcessor(process.execPath, [fixture, mode], {
      signal: new AbortController().signal,
    });
    assert.equal(result.failed, true, mode);
    assert.equal(result.receipt.childClosed, true);
    assert.match(String(result.failure), /exceed/);
    if (mode === 'stderr-bound') assert.equal(result.receipt.diagnosticsTruncated, true);
  }
  const result = await runDocTraceProcessor(process.execPath, [fixture, 'query'], {
    signal: new AbortController().signal,
  });
  assert.equal(result.failed, false);
  assert.equal(result.receipt.stdout, '"name","severity","value"\n');
});

test('unsupported platforms and absent or changed binaries cannot authorize execution', async (t) => {
  assert.throws(() => docTraceProcessorAuthority('unknown', 'x64'), /No verified/);
  assert.throws(() => verifyDocTraceProcessorBytes(Buffer.from('wrong')), /pinned official/);
  const dir = await directory(t),
    path = join(dir, 'binary');
  await assert.rejects(verifyDocTraceProcessor(path), /ENOENT/);
  await writeFile(path, 'wrong');
  await assert.rejects(verifyDocTraceProcessor(path), /pinned official/);
});
