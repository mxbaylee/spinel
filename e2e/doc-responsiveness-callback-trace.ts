import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename } from 'node:path';
import type { CDPSession } from '@playwright/test';
import type { callbackProgress } from './doc-responsiveness-callback-progress.ts';
import { createReadStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

/** Identical, explicitly bounded capture for both sources; no category is removed. */
export const DOC_CALLBACK_TRACE_SETTINGS = {
  traceConfig: {
    recordMode: 'recordUntilFull' as const,
    traceBufferSizeInKb: 1024 * 1024,
    includedCategories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline.stack',
      'toplevel',
      'v8',
      'blink.user_timing',
      'disabled-by-default-renderer.scheduler',
    ],
  },
  transferMode: 'ReturnAsStream' as const,
  streamFormat: 'json' as const,
  streamCompression: 'none' as const,
  bufferUsageReportingInterval: 1000,
};

export interface DocCallbackTraceSummary {
  sourceEvents: number;
  retainedEvents: number;
  callbackEvents: number;
  uncompressedBytes: number;
  uncompressedSha256: string;
  maxEventBytes: number;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const callbacks = new Set(['TimerInstall', 'TimerRemove', 'TimerFire', 'FunctionCall']);
const commonFields = ['name', 'cat', 'ph', 'pid', 'tid', 'ts', 'dur'];
const callbackFields = [
  'frame',
  'timerId',
  'timeout',
  'singleShot',
  'url',
  'lineNumber',
  'columnNumber',
  'scriptId',
  'functionName',
];
const maxEventBytes = 8 * 1024 * 1024;
const maxMetadataBytes = 2 * 1024 * 1024;
const whitespace = (character: string) => /[\t\n\r ]/.test(character);

function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
  );
}

/**
 * Keep every event's index, identity and clock, including unrecognized events.
 * The analyzer never reads other arguments. Callback records retain all its
 * inputs and the exact top stack frame; the untouched raw stream keeps ancestors.
 * Invalid field values remain invalid instead of being coerced or repaired.
 */
function project(event: Record<string, unknown>) {
  const result = pick(event, commonFields);
  if (!callbacks.has(event.name as string) || !Object.hasOwn(event, 'args')) return result;
  if (!object(event.args)) return { ...result, args: event.args };
  if (!object(event.args.data)) return { ...result, args: { data: event.args.data } };
  const data = pick(event.args.data, callbackFields);
  if (Object.hasOwn(event.args.data, 'stackTrace')) {
    const stack = event.args.data.stackTrace;
    data.stackTrace = Array.isArray(stack) ? stack.slice(0, 1) : stack;
  }
  return { ...result, args: { data } };
}

/**
 * Incrementally parse Chrome's traceEvents-first JSON envelope. Each complete
 * event and the complete metadata/trailer are JSON-validated. Parsing stops with
 * an error on corruption, truncation, unexpected envelopes or resource bounds;
 * no partial result can satisfy acceptance. The file itself is never rewritten.
 */
export async function readDocCallbackTrace(
  path: string,
  options: { compression?: 'none' | 'gzip'; highWaterMark?: number; signal?: AbortSignal } = {},
) {
  const compression = options.compression ?? 'none';
  if (compression !== 'none' && compression !== 'gzip')
    throw new Error('Unknown trace compression.');
  const highWaterMark = options.highWaterMark ?? 64 * 1024;
  if (!Number.isSafeInteger(highWaterMark) || highWaterMark <= 0 || highWaterMark > 1024 * 1024)
    throw new Error('Invalid trace read chunk size.');
  const source = createReadStream(path, { highWaterMark, signal: options.signal });
  const rawHash = createHash('sha256');
  const input = compression === 'gzip' ? source.pipe(createGunzip()) : source;
  if (input !== source) source.once('error', (error) => input.destroy(error));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const traceEvents: unknown[] = [];
  const summary: DocCallbackTraceSummary = {
    sourceEvents: 0,
    retainedEvents: 0,
    callbackEvents: 0,
    uncompressedBytes: 0,
    uncompressedSha256: '',
    maxEventBytes: 0,
  };
  let state: 'header' | 'before-event' | 'event' | 'after-event' | 'tail' = 'header';
  let header = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let allowEmpty = true;
  let eventParts: string[] = [];
  let eventBytes = 0;
  const tail: string[] = [];
  let tailBytes = 0;

  function appendEvent(part: string) {
    eventBytes += Buffer.byteLength(part);
    if (eventBytes > maxEventBytes) throw new Error('Trace event exceeds the 8 MiB read bound.');
    eventParts.push(part);
  }
  function appendTail(part: string) {
    tailBytes += Buffer.byteLength(part);
    if (tailBytes > maxMetadataBytes)
      throw new Error('Trace metadata exceeds the 2 MiB read bound.');
    tail.push(part);
  }
  function acceptEvent() {
    const event: unknown = JSON.parse(eventParts.join(''));
    if (!object(event)) throw new Error('Trace event is not an object.');
    summary.sourceEvents++;
    summary.maxEventBytes = Math.max(summary.maxEventBytes, eventBytes);
    if (callbacks.has(event.name as string)) summary.callbackEvents++;
    traceEvents.push(project(event));
    summary.retainedEvents++;
    eventParts = [];
    eventBytes = 0;
  }
  function consume(chunk: string) {
    if (state === 'tail') {
      appendTail(chunk);
      return;
    }
    let eventStart = 0;
    for (let index = 0; index < chunk.length; index++) {
      const character = chunk[index]!;
      if (state === 'header') {
        header += character;
        if (header.length > 1024) throw new Error('Trace header exceeds the 1 KiB read bound.');
        if (character === '[') {
          if (!/^[\t\n\r ]*\{[\t\n\r ]*"traceEvents"[\t\n\r ]*:[\t\n\r ]*\[$/.test(header))
            throw new Error('Expected a traceEvents-first Chrome JSON envelope.');
          state = 'before-event';
        }
      } else if (state === 'before-event') {
        if (whitespace(character)) continue;
        if (character === ']' && allowEmpty) {
          state = 'tail';
          appendTail(chunk.slice(index + 1));
          return;
        }
        if (character !== '{') throw new Error('Expected a trace event object.');
        state = 'event';
        depth = 1;
        inString = false;
        escaped = false;
        eventStart = index;
      } else if (state === 'event') {
        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
        } else if (character === '"') inString = true;
        else if (character === '{' || character === '[') depth++;
        else if (character === '}' || character === ']') depth--;
        if (depth === 0) {
          appendEvent(chunk.slice(eventStart, index + 1));
          acceptEvent();
          state = 'after-event';
        }
      } else if (state === 'after-event') {
        if (whitespace(character)) continue;
        if (character === ',') {
          allowEmpty = false;
          state = 'before-event';
        } else if (character === ']') {
          state = 'tail';
          appendTail(chunk.slice(index + 1));
          return;
        } else throw new Error('Expected a comma or the end of traceEvents.');
      }
    }
    if (state === 'event') appendEvent(chunk.slice(eventStart));
  }

  function finish() {
    if (state !== 'tail') throw new Error('Truncated traceEvents JSON envelope.');
    const remaining = tail.join('').replace(/^[\t\n\r ]*/, '');
    if (!remaining.startsWith('}') && !remaining.startsWith(','))
      throw new Error('Trace JSON envelope has no complete trailer.');
    // Validate all trailing fields and the final root delimiter. Build just the
    // small remaining object, so duplicate traceEvents keys cannot hide content.
    const hasFields = remaining.startsWith(',');
    const metadata: unknown = JSON.parse(`{${hasFields ? remaining.slice(1) : remaining}`);
    if (!object(metadata) || Object.hasOwn(metadata, 'traceEvents'))
      throw new Error('Trace JSON envelope repeats traceEvents.');
    if (hasFields && Object.keys(metadata).length === 0)
      throw new Error('Trace JSON envelope has a trailing comma.');
    return { traceEvents, summary };
  }

  try {
    for await (const chunk of input) {
      options.signal?.throwIfAborted();
      rawHash.update(chunk);
      summary.uncompressedBytes += chunk.length;
      consume(decoder.decode(chunk, { stream: true }));
    }
    consume(decoder.decode());
    summary.uncompressedSha256 = rawHash.digest('hex');
    return finish();
  } finally {
    input.destroy();
    source.destroy();
  }
}

export const DOC_CALLBACK_TRACE_STORAGE = {
  compression: 'gzip' as const,
  producer: 'node:zlib' as const,
  level: 1,
};

/** The caller owns session interruption, including pending protocol requests. */
export async function retainDocCallbackTrace(
  cdp: CDPSession,
  path: string,
  progress: ReturnType<typeof callbackProgress>,
  ownership: { signal: AbortSignal; interrupt: () => Promise<void> },
) {
  type Completion = {
    stream?: string;
    dataLossOccurred?: boolean;
    traceFormat?: string;
    streamCompression?: string;
  };
  const { signal } = ownership;
  let completion: Completion | undefined;
  let failure: unknown;
  let failed = false;
  let interruption: Promise<void> | undefined;
  let close: Promise<void> | undefined;
  let ownsOutput = false;
  let outputHandle: FileHandle | undefined;
  let rawBytes = 0;
  let storedBytes = 0;
  const rawHash = createHash('sha256');
  const storedHash = createHash('sha256');
  let resolveCompletion!: (event: Completion) => void;
  let rejectCompletion!: (error: unknown) => void;
  const completed = new Promise<Completion>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // An abort/close can arrive while Tracing.end is still outstanding.
  void completed.catch(() => {});
  const remember = (error: unknown) => {
    if (!failed) failure = error;
    failed = true;
    progress.failed('trace');
  };
  const closeStream = () => {
    if (!completion?.stream) return;
    if (!close) {
      progress.phase('trace-stream-close', rawBytes);
      close = cdp.send('IO.close', { handle: completion.stream }).then(() => {}, remember);
    }
    return close;
  };
  const onComplete = (event: Completion) => {
    completion = event;
    if (signal.aborted || failed) void closeStream();
    else resolveCompletion(event);
  };
  const onClose = () => rejectCompletion(new Error('CDP session closed before trace completion.'));
  const interruptCollection = (error: unknown) => {
    remember(error);
    // Request known-handle close first, never await it ahead of detachment.
    void closeStream();
    interruption ??= Promise.resolve().then(ownership.interrupt).catch(remember);
  };
  const onAbort = () => {
    rejectCompletion(signal.reason);
    interruptCollection(signal.reason);
  };
  cdp.once('Tracing.tracingComplete', onComplete);
  cdp.once('close', onClose);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    signal.throwIfAborted();
    progress.phase('trace-end-request');
    await cdp.send('Tracing.end');
    progress.phase('trace-completion');
    const event = await completed;
    signal.throwIfAborted();
    if (!event.stream) throw new Error('Tracing completed without its raw stream.');
    if (
      event.traceFormat !== 'json' ||
      event.streamCompression !== 'none' ||
      event.dataLossOccurred !== false
    )
      throw new Error('Tracing did not confirm complete uncompressed JSON transport.');
    progress.phase('trace-stream-open');
    outputHandle = await open(path, 'wx');
    ownsOutput = true;
    const destination = outputHandle.createWriteStream({ highWaterMark: 64 * 1024 });
    let nextProgress = 1024 * 1024;
    async function* chunks() {
      progress.phase('trace-stream-read', 0);
      for (;;) {
        signal.throwIfAborted();
        const chunk = await cdp.send('IO.read', { handle: event.stream!, size: 1024 * 1024 });
        signal.throwIfAborted();
        const value = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
        rawHash.update(value);
        rawBytes += value.length;
        yield value;
        // Logarithmic milestones keep the early phases in the 128-entry journal.
        // Final exact bytes are always retained by stream-close and the manifest.
        if (rawBytes >= nextProgress) {
          progress.phase('trace-stream-read', rawBytes);
          while (nextProgress <= rawBytes) nextProgress *= 2;
        }
        if (chunk.eof) break;
      }
    }
    const retained = new Transform({
      transform(chunk, _encoding, callback) {
        storedHash.update(chunk);
        storedBytes += chunk.length;
        callback(null, chunk);
      },
    });
    const compressor = createGzip({
      level: DOC_CALLBACK_TRACE_STORAGE.level,
      chunkSize: 64 * 1024,
    });
    const onPipelineError = (error: Error) => interruptCollection(error);
    destination.once('error', onPipelineError);
    compressor.once('error', onPipelineError);
    retained.once('error', onPipelineError);
    await pipeline(chunks(), compressor, retained, destination, { signal });
  } catch (error) {
    interruptCollection(error);
  } finally {
    // On interruption, keep the completion listener until the owned session has
    // settled so a late acquired handle receives its one close attempt.
    if (interruption) await interruption;
    await closeStream();
    if (failed && !interruption) interruptCollection(failure);
    if (interruption) await interruption;
    cdp.off('Tracing.tracingComplete', onComplete);
    cdp.off('close', onClose);
    signal.removeEventListener('abort', onAbort);
    try {
      await outputHandle?.close();
    } catch (error) {
      remember(error);
    }
  }
  if (failed) {
    if (ownsOutput) {
      try {
        await rm(path);
      } catch {
        progress.failed('trace-output-cleanup');
      }
    }
    throw failure;
  }
  signal.throwIfAborted();
  return {
    file: basename(path),
    completion: completion!,
    bytes: storedBytes,
    sha256: storedHash.digest('hex'),
    storage: DOC_CALLBACK_TRACE_STORAGE,
    transport: { bytes: rawBytes, sha256: rawHash.digest('hex') },
  };
}
