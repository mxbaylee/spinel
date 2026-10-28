import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  DOC_CALLBACK_TRACE_SETTINGS,
  readDocCallbackTrace,
} from '../../e2e/doc-responsiveness-callback-trace.ts';
import { analyzeDocCallbackLifetimes, DOC_CALLBACK_MARKERS } from './doc-callback-lifetimes.ts';
import type { DocCallbackCallsite } from './doc-callback-lifetimes.ts';

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
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
    streamCompression: 'gzip',
    bufferUsageReportingInterval: 1000,
  });
});
