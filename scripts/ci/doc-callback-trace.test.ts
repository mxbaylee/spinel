import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { FileHandle } from 'node:fs/promises';
import type { WriteStream } from 'node:fs';
import type { CDPSession } from '@playwright/test';
import {
  DOC_CALLBACK_TRACE_SETTINGS,
  readDocCallbackTrace,
  retainDocCallbackTrace,
} from '../../e2e/doc-responsiveness-callback-trace.ts';
import { callbackProgress } from '../../e2e/doc-responsiveness-callback-progress.ts';
import { analyzeDocCallbackLifetimes, DOC_CALLBACK_MARKERS } from './doc-callback-lifetimes.ts';
import type { DocCallbackCallsite } from './doc-callback-lifetimes.ts';

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

for (const scenario of [
  'complete',
  'read-and-close-fail',
  'close-fails',
  'progress-write-fails',
  'output-open-fails',
] as const)
  test(`trace stream ${scenario} retains bytes or the first error through owned close`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'spn134-stream-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const progressPath = join(directory, 'progress.json');
    const progress = callbackProgress(progressPath);
    if (scenario === 'progress-write-fails') mkdirSync(`${progressPath}.tmp`);
    const rawBytes = Buffer.from('{"traceEvents":[]}');
    const bytes = gzipSync(rawBytes, { level: 1 });
    const readError = new Error('original stream read failed');
    const closeError = new Error('later close failed');
    const emitter = new EventEmitter();
    const calls: string[] = [];
    const cdp = Object.assign(emitter, {
      async send(command: string) {
        calls.push(command);
        if (command === 'Tracing.end') {
          emitter.emit('Tracing.tracingComplete', {
            stream: 'owned-stream',
            dataLossOccurred: false,
            traceFormat: 'json',
            streamCompression: 'none',
          });
          return {};
        }
        if (command === 'IO.read') {
          if (scenario === 'read-and-close-fail' || scenario === 'progress-write-fails')
            throw readError;
          return { data: rawBytes.toString('base64'), base64Encoded: true, eof: true };
        }
        if (command === 'IO.close' && scenario !== 'complete') throw closeError;
        return {};
      },
    }) as unknown as CDPSession;
    const path = join(
      directory,
      ...(scenario === 'output-open-fails' ? ['missing', 'trace.json.gz'] : ['trace.json.gz']),
    );
    if (scenario === 'complete') {
      const result = await retainDocCallbackTrace(cdp, path, progress, {
        signal: new AbortController().signal,
        interrupt: async () => {},
      });
      assert.equal(result.sha256, hash(bytes));
      assert.equal(result.bytes, bytes.length);
      assert.deepEqual(await readFile(path), bytes);
      assert.equal(progress.firstFailure, null);
    } else {
      await assert.rejects(
        retainDocCallbackTrace(cdp, path, progress, {
          signal: new AbortController().signal,
          interrupt: async () => {},
        }),
        (error) =>
          scenario === 'output-open-fails'
            ? (error as NodeJS.ErrnoException).code === 'ENOENT'
            : error === (scenario === 'close-fails' ? closeError : readError),
      );
      assert.equal(
        progress.firstFailure?.phase,
        scenario === 'output-open-fails'
          ? 'trace-stream-open'
          : scenario === 'close-fails'
            ? 'trace-stream-close'
            : 'trace-stream-read',
      );
    }
    assert.equal(calls[0], 'Tracing.end');
    assert.equal(calls.at(-1), 'IO.close');
    assert.equal(calls.filter((call) => call === 'IO.close').length, 1);
    assert.equal(progress.persistenceFailure !== null, scenario === 'progress-write-fails');
    assert.equal(emitter.listenerCount('Tracing.tracingComplete'), 0);
  });
const point = (columnNumber: number) => ({
  url: 'https://spinel.test/assets/exact-build.js',
  lineNumber: 12,
  columnNumber,
  scriptId: '19',
  functionName: '',
});
const callsites: DocCallbackCallsite[] = [
  { ...point(10), family: 'cursor' },
  { ...point(20), family: 'zoom-init' },
  { ...point(30), family: 'zoom-update' },
];

function events() {
  const marker = (phase: keyof typeof DOC_CALLBACK_MARKERS, ts: number) => ({
    name: DOC_CALLBACK_MARKERS[phase],
    cat: 'blink.user_timing',
    ph: 'I',
    pid: 2,
    tid: 3,
    ts,
  });
  const timer = (name: string, timerId: number, ts: number, column = 10, singleShot = true) => ({
    name,
    cat: 'devtools.timeline',
    ph: name === 'TimerFire' ? 'X' : 'I',
    pid: 2,
    tid: 3,
    ts,
    ...(name === 'TimerFire' ? { dur: 30 } : {}),
    args: {
      data: {
        timerId,
        frame: 'doc-frame',
        timeout: singleShot ? 500 : 1000,
        singleShot,
        stackTrace: [
          point(column),
          { ...point(99), ignoredAncestor: 'retained only in the raw stream' },
        ],
      },
    },
  });
  return [
    marker('beforeMount', 1000),
    timer('TimerInstall', 1, 2000, 10, false),
    timer('TimerInstall', 2, 2001),
    timer('TimerInstall', 3, 2002, 20),
    timer('TimerInstall', 4, 2003, 30),
    {
      name: 'Layout',
      cat: 'devtools.timeline',
      ph: 'X',
      pid: 2,
      tid: 3,
      ts: 2004,
      dur: 5,
      args: { nested: { ignored: '"quotes" [braces] }\\\n'.repeat(100) } },
    },
    timer('TimerFire', 4, 2100, 30),
    marker('inputStart', 10_000),
    timer('TimerFire', 3, 22_000, 20),
    timer('TimerFire', 2, 502_001),
    {
      name: 'FunctionCall',
      cat: 'devtools.timeline',
      ph: 'X',
      pid: 2,
      tid: 3,
      ts: 502_002,
      dur: 10,
      args: { data: { ...point(10), frame: 'doc-frame', isolate: 'unused' } },
    },
    timer('TimerRemove', 0, 600_000, 30),
    timer('TimerRemove', -1, 600_001, 30),
    marker('finalKey', 700_000),
    timer('TimerRemove', 1, 1_900_000),
    marker('disposed', 2_000_000),
    marker('end', 3_100_000),
    { name: 'ThreadControllerImpl::RunTask', cat: 'toplevel', ph: 'B', pid: 2, tid: 3, ts: 900 },
    { name: 'ThreadControllerImpl::RunTask', cat: 'toplevel', ph: 'E', pid: 2, tid: 3, ts: 3000 },
    // Preserve the last observed timestamp even when the event is unrelated.
    {
      name: 'Ignored',
      cat: 'v8',
      ph: 'X',
      pid: 55,
      tid: 66,
      ts: 3_200_000,
      dur: 100,
      args: { unused: 'large arguments stay solely in the raw artifact' },
    },
  ];
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'spn113-trace-reader-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let index = 0;
  return async (content: string | Buffer, gzip = false) => {
    const path = join(directory, `${index++}.json${gzip ? '.gz' : ''}`);
    const bytes = gzip ? gzipSync(content) : Buffer.from(content);
    await writeFile(path, bytes);
    return { path, bytes };
  };
}

test('retains every event index, all analyzer inputs and exact top frames without rewriting raw files', async (t) => {
  const file = await fixture(t);
  const original = events();
  const source = JSON.stringify({ traceEvents: original, metadata: { source: 'native Chrome' } });
  const { path, bytes } = await file(source, true);
  const result = await readDocCallbackTrace(path, { compression: 'gzip' });
  assert.equal(hash(await readFile(path)), hash(bytes));
  assert.equal(result.summary.sourceEvents, original.length);
  assert.equal(result.summary.retainedEvents, original.length);
  assert.equal(result.summary.callbackEvents, 11);
  assert.equal(result.summary.uncompressedBytes, Buffer.byteLength(source));
  assert.equal(
    result.summary.maxEventBytes,
    Math.max(...original.map((event) => Buffer.byteLength(JSON.stringify(event)))),
  );
  const compact = result.traceEvents as Array<Record<string, unknown>>;
  assert.deepEqual(
    compact.map((event) => event.name),
    original.map((event) => event.name),
  );
  assert.deepEqual(compact[5], {
    name: 'Layout',
    cat: 'devtools.timeline',
    ph: 'X',
    pid: 2,
    tid: 3,
    ts: 2004,
    dur: 5,
  });
  assert.deepEqual(compact[1], {
    name: 'TimerInstall',
    cat: 'devtools.timeline',
    ph: 'I',
    pid: 2,
    tid: 3,
    ts: 2000,
    args: {
      data: {
        timerId: 1,
        frame: 'doc-frame',
        timeout: 1000,
        singleShot: false,
        stackTrace: [point(10)],
      },
    },
  });
  const input = {
    completion: { dataLossOccurred: false },
    frameId: 'doc-frame',
    role: 'candidate' as const,
    callsites,
  };
  const full = analyzeDocCallbackLifetimes({ ...input, traceEvents: original });
  assert.equal(full.accepted, true, full.evidenceFailures.join('\n'));
  assert.deepEqual(
    analyzeDocCallbackLifetimes({ ...input, traceEvents: result.traceEvents }),
    full,
  );
});

test('plain and gzip reads handle UTF-8, escaped delimiters and every small chunk boundary', async (t) => {
  const file = await fixture(t);
  const original = [
    {
      name: 'TimerRemove',
      ts: 1,
      args: {
        data: {
          frame: 'frame',
          timerId: -1,
          stackTrace: [{ ...point(1), functionName: '🦋 " } ],"metadata": \\ \u0000 \n' }],
        },
      },
    },
    {
      name: 'FunctionCall',
      ts: 2,
      args: { data: { ...point(2), frame: 'frame', functionName: '𝄞' } },
    },
  ];
  const source = JSON.stringify(
    {
      traceEvents: original,
      metadata: {
        nested: [
          { value: 'escaped "quotes" and \\ slash; ],"metadata": is not an envelope boundary' },
        ],
      },
    },
    null,
    2,
  );
  const baselineFile = await file(source);
  const expected = await readDocCallbackTrace(baselineFile.path);
  for (const gzip of [false, true]) {
    const { path } = await file(source, gzip);
    for (const highWaterMark of [1, 2, 3, 7, 31, 127]) {
      const result = await readDocCallbackTrace(path, {
        compression: gzip ? 'gzip' : 'none',
        highWaterMark,
      });
      assert.deepEqual(result, expected);
    }
  }
  const empty = await file(' { "traceEvents" : [ ] } \n');
  assert.deepEqual((await readDocCallbackTrace(empty.path)).traceEvents, []);
});

test('malformed callback fields remain visible to attribution and lifetime validation', async (t) => {
  const file = await fixture(t);
  const original = [
    {
      name: 'TimerInstall',
      pid: 2,
      tid: 3,
      ts: 'bad',
      args: {
        data: {
          frame: 4,
          timerId: '1',
          singleShot: 'yes',
          timeout: -1,
          stackTrace: 'not an array',
        },
      },
    },
    { name: 'TimerRemove', args: { data: null } },
    { name: 'TimerFire', args: false },
    { name: 'FunctionCall', args: { data: { url: 5, lineNumber: '1', columnNumber: null } } },
  ];
  const { path } = await file(JSON.stringify({ traceEvents: original }));
  const result = await readDocCallbackTrace(path);
  assert.deepEqual(result.traceEvents, original);
});

test('rejects corrupt events, duplicate arrays, missing separators and every truncated envelope state', async (t) => {
  const file = await fixture(t);
  const invalid = [
    '',
    '{}',
    '[]',
    'null',
    '{"metadata":{},"traceEvents":[]}',
    '{"traceEvents":',
    '{"traceEvents":[',
    '{"traceEvents":[{',
    '{"traceEvents":[{"name":"open\\',
    '{"traceEvents":[{}]',
    '{"traceEvents":[{}],"metadata":{"x":1}',
    '{"traceEvents":[null]}',
    '{"traceEvents":[1]}',
    '{"traceEvents":[[]]}',
    '{"traceEvents":[{} {}]}',
    '{"traceEvents":[{},]}',
    '{"traceEvents":[{}],}',
    '{"traceEvents":[],   }',
    '{"traceEvents":[{"args":{"a":[}]}}]}',
    '{"traceEvents":[{"name":"bad\nstring"}]}',
    '{"traceEvents":[{}],"metadata":}',
    '{"traceEvents":[{}],"traceEvents":[]}',
    '{"traceEvents":[{}],"trace\\u0045vents":[]}',
    '{"traceEvents":[{}]}junk',
    '{"traceEvents":[]}{}',
    '\u00a0{"traceEvents":[]}',
    '{\u000b"traceEvents":[]}',
    '{"traceEvents":[]\u00a0}',
    '{"traceEvents":[]\u000c,"metadata":{}}',
  ];
  for (const content of invalid) {
    const { path } = await file(content);
    await assert.rejects(
      readDocCallbackTrace(path, { highWaterMark: 7 }),
      (error: unknown) => error instanceof Error,
      content,
    );
  }
  const { path } = await file(
    Buffer.concat([
      Buffer.from('{"traceEvents":[{"name":"'),
      Buffer.from([0xff]),
      Buffer.from('"}]}'),
    ]),
  );
  await assert.rejects(readDocCallbackTrace(path), /encoded data/);
});

test('gzip truncation, checksum errors, trailing garbage and corrupt decompressed JSON all fail closed', async (t) => {
  const file = await fixture(t);
  const compressed = gzipSync('{"traceEvents":[{}],"metadata":{}}');
  const corruptChecksum = Buffer.from(compressed);
  corruptChecksum[corruptChecksum.length - 8]! ^= 1;
  for (const bytes of [
    compressed.subarray(0, -5),
    corruptChecksum,
    Buffer.concat([compressed, Buffer.from('garbage')]),
  ]) {
    const { path } = await file(bytes);
    await assert.rejects(readDocCallbackTrace(path, { compression: 'gzip', highWaterMark: 3 }));
  }
  const truncatedEnvelope = await file('{"traceEvents":[{}]', true);
  await assert.rejects(
    readDocCallbackTrace(truncatedEnvelope.path, { compression: 'gzip' }),
    /trailer/,
  );
  const plain = await file('{"traceEvents":[]}');
  await assert.rejects(readDocCallbackTrace(plain.path, { compression: 'gzip' }));
});

test('bounds individual records and metadata while permitting an arbitrarily chunked larger document', async (t) => {
  const file = await fixture(t);
  for (const [source, error] of [
    [' '.repeat(1025) + '{"traceEvents":[]}', /header/],
    [
      JSON.stringify({
        traceEvents: [{ name: 'Large', args: { value: 'x'.repeat(8 * 1024 * 1024) } }],
      }),
      /event exceeds/,
    ],
    [
      JSON.stringify({ traceEvents: [], metadata: { value: 'x'.repeat(2 * 1024 * 1024) } }),
      /metadata exceeds/,
    ],
  ] as const) {
    const { path } = await file(source, true);
    await assert.rejects(readDocCallbackTrace(path, { compression: 'gzip' }), error);
  }
  const { path } = await file(JSON.stringify({ traceEvents: events() }));
  for (const highWaterMark of [0, -1, 0.5, 1024 * 1024 + 1])
    await assert.rejects(readDocCallbackTrace(path, { highWaterMark }), /chunk size/);
  await assert.rejects(readDocCallbackTrace(`${path}-missing`, { compression: 'gzip' }), /ENOENT/);
});

test('capture keeps all six categories and explicitly reserves a non-overwriting 1 GiB buffer', () => {
  assert.deepEqual(DOC_CALLBACK_TRACE_SETTINGS, {
    traceConfig: {
      recordMode: 'recordUntilFull',
      traceBufferSizeInKb: 1048576,
      includedCategories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline.stack',
        'toplevel',
        'v8',
        'blink.user_timing',
        'disabled-by-default-renderer.scheduler',
      ],
    },
    transferMode: 'ReturnAsStream',
    streamFormat: 'json',
    streamCompression: 'none',
    bufferUsageReportingInterval: 1000,
  });
});

for (const boundary of ['completion', 'end', 'read', 'late-handle'] as const)
  test(`interruption at ${boundary} settles collection and owned resources without accepting late success`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'spn143-abort-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const progressPath = join(directory, 'progress.json');
    const progress = callbackProgress(progressPath);
    const controller = new AbortController();
    const primary = new Error('original observation deadline');
    const emitter = new EventEmitter();
    const calls: string[] = [];
    let pendingReject: ((error: Error) => void) | undefined;
    let reached!: () => void;
    const pending = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const completion = {
      stream: 'owned',
      dataLossOccurred: false,
      traceFormat: 'json',
      streamCompression: 'none',
    };
    const cdp = Object.assign(emitter, {
      async send(command: string) {
        calls.push(command);
        if (command === 'Tracing.end') {
          if (boundary === 'read') emitter.emit('Tracing.tracingComplete', completion);
          else reached();
          if (boundary === 'end')
            return new Promise((_resolve, reject) => {
              pendingReject = reject;
            });
          return {};
        }
        if (command === 'IO.read') {
          reached();
          return new Promise((_resolve, reject) => {
            pendingReject = reject;
          });
        }
        return {};
      },
    }) as unknown as CDPSession;
    let interruptions = 0;
    const path = join(directory, 'trace.json.gz');
    const running = retainDocCallbackTrace(cdp, path, progress, {
      signal: controller.signal,
      async interrupt() {
        interruptions++;
        if (boundary === 'late-handle') emitter.emit('Tracing.tracingComplete', completion);
        pendingReject?.(new Error('session detached'));
        emitter.emit('close');
      },
    });
    await pending;
    // This checkpoint must survive even if cleanup itself later cannot settle.
    progress.terminal('timedOut');
    controller.abort(primary);
    await assert.rejects(running, (error) => error === primary);
    assert.equal(interruptions, 1);
    assert.equal(emitter.listenerCount('Tracing.tracingComplete'), 0);
    assert.equal(emitter.listenerCount('close'), 0);
    assert.equal(
      calls.filter((command) => command === 'IO.close').length,
      boundary === 'read' || boundary === 'late-handle' ? 1 : 0,
    );
    await assert.rejects(readFile(path), { code: 'ENOENT' });
    const journal = JSON.parse(await readFile(progressPath, 'utf8'));
    assert.equal(journal.terminal, 'timedOut');
    assert.equal(journal.firstFailure.kind, 'timedOut');
    emitter.emit('Tracing.tracingComplete', completion);
    assert.equal(
      calls.filter((command) => command === 'IO.close').length,
      boundary === 'read' || boundary === 'late-handle' ? 1 : 0,
    );
  });

test('session loss before completion rejects and removes listeners without waiting for an event', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'spn143-session-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const emitter = new EventEmitter();
  const cdp = Object.assign(emitter, {
    async send() {
      emitter.emit('close');
      return {};
    },
  }) as unknown as CDPSession;
  await assert.rejects(
    retainDocCallbackTrace(
      cdp,
      join(directory, 'trace.gz'),
      callbackProgress(join(directory, 'progress.json')),
      {
        signal: new AbortController().signal,
        interrupt: async () => {},
      },
    ),
    /session closed/,
  );
  assert.equal(emitter.listenerCount('Tracing.tracingComplete'), 0);
});

test('raw Unicode bytes survive arbitrary protocol chunks with distinct stored provenance and bounded progress', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'spn143-lossless-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const emitter = new EventEmitter();
  const raw = Buffer.from(
    '{"traceEvents":[],"metadata":{"label":"📡 café 日本語"}}' + ' '.repeat(4096 * 600),
  );
  let offset = 0;
  let closed = 0;
  const cdp = Object.assign(emitter, {
    async send(command: string) {
      if (command === 'Tracing.end') {
        emitter.emit('Tracing.tracingComplete', {
          stream: 'raw',
          dataLossOccurred: false,
          traceFormat: 'json',
          streamCompression: 'none',
        });
        return {};
      }
      if (command === 'IO.read') {
        const end = Math.min(offset + (offset < 80 ? 3 : 4096), raw.length);
        const data = raw.subarray(offset, end).toString('base64');
        offset = end;
        return { data, base64Encoded: true, eof: offset === raw.length };
      }
      if (command === 'IO.close') closed++;
      return {};
    },
  }) as unknown as CDPSession;
  const path = join(directory, 'trace.gz');
  const progressPath = join(directory, 'progress.json');
  const progress = callbackProgress(progressPath);
  progress.phase('behavior-complete');
  const trace = await retainDocCallbackTrace(cdp, path, progress, {
    signal: new AbortController().signal,
    interrupt: async () => {},
  });
  const stored = await readFile(path);
  assert.deepEqual(gunzipSync(stored), raw);
  assert.deepEqual(trace.transport, { bytes: raw.length, sha256: hash(raw) });
  assert.equal(trace.sha256, hash(stored));
  assert.equal(trace.bytes, stored.length);
  assert.deepEqual(trace.storage, { compression: 'gzip', producer: 'node:zlib', level: 1 });
  assert.equal(closed, 1);
  const journal = JSON.parse(await readFile(progressPath, 'utf8'));
  assert.equal(journal.droppedEvents, 0);
  assert.equal(
    journal.events.some((event: { phase: string }) => event.phase === 'behavior-complete'),
    true,
  );
  assert.ok(
    journal.events.filter((event: { phase: string }) => event.phase === 'trace-stream-read')
      .length < 10,
  );
});

for (const scenario of [
  'existing-output',
  'gzip-transport',
  'lost-data',
  'no-stream',
  'wrong-format',
] as const)
  test(`${scenario} cannot become accepted storage or delete preexisting bytes`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'spn143-provenance-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'trace.gz');
    if (scenario === 'existing-output') await writeFile(path, 'preexisting');
    const emitter = new EventEmitter();
    let closed = 0;
    const cdp = Object.assign(emitter, {
      async send(command: string) {
        if (command === 'Tracing.end')
          emitter.emit('Tracing.tracingComplete', {
            stream: scenario === 'no-stream' ? undefined : 'owned',
            dataLossOccurred: scenario === 'lost-data',
            traceFormat: scenario === 'wrong-format' ? 'proto' : 'json',
            streamCompression: scenario === 'gzip-transport' ? 'gzip' : 'none',
          });
        if (command === 'IO.close') closed++;
        return {};
      },
    }) as unknown as CDPSession;
    await assert.rejects(
      retainDocCallbackTrace(cdp, path, callbackProgress(join(directory, 'progress.json')), {
        signal: new AbortController().signal,
        interrupt: async () => {},
      }),
    );
    assert.equal(closed, scenario === 'no-stream' ? 0 : 1);
    if (scenario === 'existing-output') assert.equal(await readFile(path, 'utf8'), 'preexisting');
    else await assert.rejects(readFile(path), { code: 'ENOENT' });
  });

test('a rejected trace-end still owns a late stream until interruption settles', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'spn143-end-rejected-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const emitter = new EventEmitter();
  const primary = new Error('Tracing.end rejected');
  const calls: string[] = [];
  const cdp = Object.assign(emitter, {
    async send(command: string) {
      calls.push(command);
      if (command === 'Tracing.end') throw primary;
      return {};
    },
  }) as unknown as CDPSession;
  await assert.rejects(
    retainDocCallbackTrace(
      cdp,
      join(directory, 'trace.gz'),
      callbackProgress(join(directory, 'progress.json')),
      {
        signal: new AbortController().signal,
        async interrupt() {
          emitter.emit('Tracing.tracingComplete', {
            stream: 'late',
            dataLossOccurred: false,
            traceFormat: 'json',
            streamCompression: 'none',
          });
          emitter.emit('close');
        },
      },
    ),
    (error) => error === primary,
  );
  assert.deepEqual(calls, ['Tracing.end', 'IO.close']);
  assert.equal(emitter.listenerCount('Tracing.tracingComplete'), 0);
});

test('native text transport retains complete Unicode characters and exact decoded identity', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'spn143-text-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Pinned Chromium's non-binary stream trims requested blocks to a complete
  // UTF-8 character boundary; it never sends artificial split surrogate halves.
  const pieces = ['{"traceEvents":[],"metadata":{"label":"', '📡 café 日本語', '"}}'];
  const raw = Buffer.from(pieces.join(''));
  const emitter = new EventEmitter();
  let index = 0;
  const cdp = Object.assign(emitter, {
    async send(command: string) {
      if (command === 'Tracing.end')
        emitter.emit('Tracing.tracingComplete', {
          stream: 'text',
          dataLossOccurred: false,
          traceFormat: 'json',
          streamCompression: 'none',
        });
      if (command === 'IO.read')
        return { data: pieces[index++], base64Encoded: false, eof: index === pieces.length };
      return {};
    },
  }) as unknown as CDPSession;
  const path = join(directory, 'trace.gz');
  const trace = await retainDocCallbackTrace(
    cdp,
    path,
    callbackProgress(join(directory, 'progress.json')),
    {
      signal: new AbortController().signal,
      interrupt: async () => {},
    },
  );
  assert.deepEqual(gunzipSync(await readFile(path)), raw);
  const parsed = await readDocCallbackTrace(path, { compression: 'gzip' });
  assert.equal(parsed.summary.uncompressedSha256, trace.transport.sha256);
  assert.equal(parsed.summary.uncompressedBytes, trace.transport.bytes);
});

test('destination failure releases a pending read and close without replacing the original write error', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'spn143-write-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const handle = await open(join(directory, 'prototype'), 'wx');
  const prototype = Object.getPrototypeOf(handle);
  const original: FileHandle['createWriteStream'] = prototype.createWriteStream;
  await handle.close();
  let destination: WriteStream | undefined;
  t.mock.method(
    prototype,
    'createWriteStream',
    function (this: FileHandle, ...args: Parameters<FileHandle['createWriteStream']>) {
      destination = original.apply(this, args);
      return destination;
    },
  );
  const primary = new Error('destination write failed');
  const emitter = new EventEmitter();
  let rejectRead: ((error: Error) => void) | undefined;
  let rejectClose: ((error: Error) => void) | undefined;
  const calls: string[] = [];
  let reads = 0;
  const cdp = Object.assign(emitter, {
    async send(command: string) {
      calls.push(command);
      if (command === 'Tracing.end')
        emitter.emit('Tracing.tracingComplete', {
          stream: 'owned',
          dataLossOccurred: false,
          traceFormat: 'json',
          streamCompression: 'none',
        });
      if (command === 'IO.read') {
        if (++reads === 1) return { data: '{"traceEvents":[]}', base64Encoded: false, eof: false };
        return new Promise((_resolve, reject) => {
          rejectRead = reject;
          destination!.destroy(primary);
        });
      }
      if (command === 'IO.close')
        return new Promise((_resolve, reject) => {
          rejectClose = reject;
        });
      return {};
    },
  }) as unknown as CDPSession;
  const path = join(directory, 'trace.gz');
  await assert.rejects(
    retainDocCallbackTrace(cdp, path, callbackProgress(join(directory, 'progress.json')), {
      signal: new AbortController().signal,
      async interrupt() {
        calls.push('detach');
        rejectRead?.(new Error('read released by detach'));
        rejectClose?.(new Error('close released by detach'));
        emitter.emit('close');
      },
    }),
    (error) => error === primary,
  );
  assert.equal(calls.filter((command) => command === 'IO.close').length, 1);
  assert.ok(calls.indexOf('IO.close') < calls.indexOf('detach'));
  assert.equal(destination?.closed, true);
  assert.equal(emitter.listenerCount('Tracing.tracingComplete'), 0);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});
