import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

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
  streamCompression: 'gzip' as const,
  bufferUsageReportingInterval: 1000,
};

export interface DocCallbackTraceSummary {
  sourceEvents: number;
  retainedEvents: number;
  callbackEvents: number;
  uncompressedBytes: number;
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
  options: { compression?: 'none' | 'gzip'; highWaterMark?: number } = {},
) {
  const compression = options.compression ?? 'none';
  if (compression !== 'none' && compression !== 'gzip')
    throw new Error('Unknown trace compression.');
  const highWaterMark = options.highWaterMark ?? 64 * 1024;
  if (!Number.isSafeInteger(highWaterMark) || highWaterMark <= 0 || highWaterMark > 1024 * 1024)
    throw new Error('Invalid trace read chunk size.');
  const source = createReadStream(path, { highWaterMark });
  const input = compression === 'gzip' ? source.pipe(createGunzip()) : source;
  if (input !== source) source.once('error', (error) => input.destroy(error));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const traceEvents: unknown[] = [];
  const summary: DocCallbackTraceSummary = {
    sourceEvents: 0,
    retainedEvents: 0,
    callbackEvents: 0,
    uncompressedBytes: 0,
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
      summary.uncompressedBytes += chunk.length;
      consume(decoder.decode(chunk, { stream: true }));
    }
    consume(decoder.decode());
    return finish();
  } finally {
    input.destroy();
    source.destroy();
  }
}
