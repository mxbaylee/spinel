import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { verifyDocTraceProcessor } from '../scripts/ci/doc-trace-processor.ts';
import { materializeDocCallbackProto } from './doc-responsiveness-callback-proto.ts';
import type { DocCallbackProtoIdentity } from './doc-responsiveness-callback-proto.ts';
import { DOC_CALLBACK_TRACE_STORAGE } from './doc-responsiveness-callback-trace.ts';

export const DOC_CALLBACK_STATS_SQL =
  "SELECT name, severity, value FROM stats WHERE value != 0 AND severity IN ('error', 'data_loss') ORDER BY name";
export const DOC_CALLBACK_CLEAN_STATS = '"name","severity","value"\n';

/** Bounded child ownership shared by conversion and its independent parser-statistics query. */
export async function runDocTraceProcessor(
  binary: string,
  args: string[],
  options: { signal: AbortSignal; output?: string },
) {
  options.signal.throwIfAborted();
  const started = performance.now();
  const receipt = {
    args,
    code: null as number | null,
    signal: null as string | null,
    stderr: '',
    stdout: '',
    diagnosticsTruncated: false,
    elapsedMs: 0,
    childClosed: false,
    outputRemoved: false,
    outputCloseFailure: null as string | null,
  };
  let failure: unknown;
  let failed = false;
  const remember = (error: unknown) => {
    if (!failed) failure = error;
    failed = true;
  };
  const output = options.output ? await open(options.output, 'wx') : undefined;
  const rawHash = createHash('sha256');
  const storedHash = createHash('sha256');
  let rawBytes = 0;
  let storedBytes = 0;
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise<void>((resolve) => {
    child.once('error', remember);
    child.once('close', (code, signal) => {
      receipt.code = code;
      receipt.signal = signal;
      receipt.childClosed = true;
      if (code !== 0 || signal !== null)
        remember(new Error(`Trace converter exit ${code}, signal ${signal}.`));
      resolve();
    });
  });
  const interrupt = () => {
    remember(options.signal.reason);
    child.kill('SIGKILL');
  };
  options.signal.addEventListener('abort', interrupt, { once: true });
  if (options.signal.aborted) interrupt();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (value: string) => {
    if (Buffer.byteLength(receipt.stderr) + Buffer.byteLength(value) > 256 * 1024) {
      receipt.diagnosticsTruncated = true;
      remember(new Error('Trace converter diagnostics exceed 256 KiB.'));
      child.kill('SIGKILL');
    } else receipt.stderr += value;
  });
  child.stderr.once('error', (error) => {
    remember(error);
    child.kill('SIGKILL');
  });
  try {
    if (output) {
      const hash = (stored: boolean) =>
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            if (stored) {
              storedBytes += chunk.length;
              storedHash.update(chunk);
            } else {
              rawBytes += chunk.length;
              rawHash.update(chunk);
            }
            if (Math.max(rawBytes, storedBytes) > 2 * 1024 ** 3)
              callback(new Error('Converted trace exceeds the 2 GiB output bound.'));
            else callback(null, chunk);
          },
        });
      await pipeline(
        child.stdout,
        hash(false),
        createGzip({ level: DOC_CALLBACK_TRACE_STORAGE.level, chunkSize: 64 * 1024 }),
        hash(true),
        output.createWriteStream({ highWaterMark: 64 * 1024 }),
        { signal: options.signal },
      );
    } else {
      for await (const chunk of child.stdout) {
        if (Buffer.byteLength(receipt.stdout) + chunk.length > 64 * 1024)
          throw new Error('Trace converter query output exceeds 64 KiB.');
        receipt.stdout += chunk.toString('utf8');
      }
    }
  } catch (error) {
    remember(error);
    child.kill('SIGKILL');
  } finally {
    await closed;
    options.signal.removeEventListener('abort', interrupt);
    try {
      await output?.close();
    } catch (error) {
      receipt.outputCloseFailure = String(error);
      remember(error);
    }
    receipt.elapsedMs = performance.now() - started;
  }
  if (options.signal.aborted) remember(options.signal.reason);
  if (failed && output && options.output) {
    try {
      await rm(options.output);
      receipt.outputRemoved = true;
    } catch (error) {
      remember(error);
    }
  }
  return {
    receipt,
    failed,
    failure,
    output: options.output
      ? {
          file: basename(options.output),
          bytes: storedBytes,
          sha256: storedHash.digest('hex'),
          storage: DOC_CALLBACK_TRACE_STORAGE,
          decoded: { bytes: rawBytes, sha256: rawHash.digest('hex') },
        }
      : null,
  };
}

/** Original protobuf stays retained; only the exclusively owned working copy is removed. */
export async function convertDocCallbackTrace(options: {
  binary: string;
  input: string;
  identity: DocCallbackProtoIdentity;
  output: string;
  receipt: string;
  signal: AbortSignal;
  phase: (name: string) => void;
}) {
  const authority = await verifyDocTraceProcessor(options.binary);
  options.signal.throwIfAborted();
  const directory = await mkdtemp(join(dirname(options.output), '.spn144-converter-'));
  const inputPath = join(directory, 'input.pftrace');
  const record: Record<string, unknown> = {
    authority,
    input: options.identity,
    passed: false,
    temporaryRemoved: false,
  };
  let result: Awaited<ReturnType<typeof runDocTraceProcessor>>['output'];
  let failure: unknown;
  let failed = false;
  try {
    options.phase('trace-proto-validate');
    const raw = await open(inputPath, 'wx');
    const materialized = await materializeDocCallbackProto(
      options.input,
      raw,
      options.identity,
      options.signal,
    );
    record.framing = materialized.framing;
    if (materialized.closeFailure !== undefined)
      record.inputCloseFailure = String(materialized.closeFailure);
    if (materialized.failed) throw materialized.failure;
    options.phase('trace-convert');
    const converted = await runDocTraceProcessor(options.binary, ['convert', 'json', inputPath], {
      signal: options.signal,
      output: options.output,
    });
    record.conversion = converted.receipt;
    if (converted.failed) throw converted.failure;
    result = converted.output;
    record.output = result;
    options.phase('trace-converter-statistics');
    const statistics = await runDocTraceProcessor(
      options.binary,
      ['query', '--format', 'csv', inputPath, DOC_CALLBACK_STATS_SQL],
      { signal: options.signal },
    );
    record.statistics = statistics.receipt;
    if (statistics.failed) throw statistics.failure;
    if (statistics.receipt.stdout !== DOC_CALLBACK_CLEAN_STATS)
      throw new Error('Trace converter statistics are malformed or report errors/data loss.');
    options.signal.throwIfAborted();
    record.passed = true;
  } catch (error) {
    failure = error;
    failed = true;
    record.failure = String(error);
  } finally {
    try {
      await rm(directory, { recursive: true });
      record.temporaryRemoved = true;
    } catch (error) {
      if (!failed) failure = error;
      failed = true;
      record.cleanupFailure = String(error);
    }
    if (failed) record.passed = false;
    // Keep successful conversion output after a statistics failure as failed evidence.
    // Partial conversion output is deleted by its owning runner, never promoted here.
    try {
      await writeFile(options.receipt, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    } catch (error) {
      if (!failed) failure = error;
      failed = true;
    }
  }
  if (failed) throw failure;
  options.signal.throwIfAborted();
  return { output: result!, record };
}
