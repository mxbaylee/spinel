import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  BuildTextUtils,
  CustomRangeType,
  TextX,
  UpdateDocsAttributeType,
  composeBody,
} from '@univerjs/core';
import type { IDocumentBody, IParagraph } from '@univerjs/core';
import { patchCore, pooledMacroTask } from './patch-univer-core.ts';

// Retain updates on the wire may omit identity; the snapshot interface requires it.
// These deliberate legacy/update fixtures exercise the documented runtime fallback.
const update = (value: Omit<IParagraph, 'paragraphId'> & { paragraphId?: string }) =>
  value as IParagraph;

const paragraph: IParagraph = {
  startIndex: 0,
  paragraphId: 'stable-paragraph',
  bullet: { listId: 'list', listType: 'BULLET_LIST', nestingLevel: 0 },
  paragraphStyle: { namedStyleType: 4, outlineLevel: 0, headingId: 'heading' },
  // 1.3.1 preserves these attributes in apply/transform. The composition repair
  // must still agree with sequential REPLACE, including explicit falsy values.
  styleId: 'old-style',
  headingCollapsed: true,
};

test('composed paragraph replacement matches sequential application and preserves identity', () => {
  const base: IDocumentBody = {
    dataStream: '\r\n',
    paragraphs: [{ startIndex: 0, paragraphId: 'stable-paragraph' }],
  };
  const replacements = [
    { startIndex: 0 },
    { startIndex: 0, paragraphStyle: {} },
    { startIndex: 0, paragraphStyle: { outlineLevel: 1 } },
    { startIndex: 0, paragraphId: 'replacement-id' },
    { startIndex: 0, styleId: 'replacement-style', headingCollapsed: false },
  ].map(update);
  for (const replacement of replacements) {
    const first = new TextX()
      .retain(
        1,
        { dataStream: '', paragraphs: [structuredClone(paragraph)] },
        UpdateDocsAttributeType.REPLACE,
      )
      .serialize();
    const second = new TextX()
      .retain(1, { dataStream: '', paragraphs: [replacement] }, UpdateDocsAttributeType.REPLACE)
      .serialize();
    const sequential = TextX.apply(
      TextX.apply(structuredClone(base), structuredClone(first)),
      structuredClone(second),
    );
    const combined = TextX.apply(
      structuredClone(base),
      TextX.compose(structuredClone(first), structuredClone(second)),
    );
    assert.deepEqual(combined, sequential);
    assert.equal(combined.paragraphs![0].bullet, undefined);
    assert.equal(combined.paragraphs![0].paragraphStyle?.headingId, undefined);
    assert.equal(
      combined.paragraphs![0].paragraphId,
      replacement.paragraphId ?? 'stable-paragraph',
    );
  }
});

test('COVER preserves attributes, and both runtime formats use the same REPLACE repair', () => {
  const first: IDocumentBody = { dataStream: '', paragraphs: [paragraph] };
  const second: IDocumentBody = {
    dataStream: '',
    paragraphs: [update({ startIndex: 0, paragraphStyle: { outlineLevel: 1 } })],
  };
  assert.equal(
    composeBody(structuredClone(first), second, UpdateDocsAttributeType.COVER).paragraphs![0].bullet
      ?.listId,
    'list',
  );
  const require = createRequire(import.meta.url);
  const cjs = require('@univerjs/core') as typeof import('@univerjs/core');
  for (const core of [{ composeBody }, cjs]) {
    const result = core.composeBody(
      structuredClone(first),
      structuredClone(second),
      UpdateDocsAttributeType.REPLACE,
    );
    assert.equal(result.paragraphs![0].bullet, undefined);
    assert.equal(result.paragraphs![0].paragraphStyle?.headingId, undefined);
    assert.equal(result.paragraphs![0].paragraphId, 'stable-paragraph');
  }
});

test('install patch is idempotent and rejects changed upstream bytes', async () => {
  for (const format of ['es', 'cjs'] as const) {
    const source = await readFile(
      new URL(`../../node_modules/@univerjs/core/lib/${format}/index.js`, import.meta.url),
      'utf8',
    );
    const patched = patchCore(source, format);
    assert.equal(patchCore(patched, format), patched);
    assert.throws(() => patchCore(source + '\n// unexpected change', format), /Unrecognized/);
  }
});

test("both builds let a REPLACE style's falsy keys win in transformTextRuns", async () => {
  for (const format of ['es', 'cjs'] as const) {
    const source = await readFile(
      new URL(`../../node_modules/@univerjs/core/lib/${format}/index.js`, import.meta.url),
      'utf8',
    );
    const start = source.indexOf('function transformTextRuns(');
    const body = source.slice(start, source.indexOf('function transformCustomRanges(', start));
    assert.ok(
      body.includes('for (const key of keys) if (originStyle[key] !== void 0) delete newTs[key];'),
      format,
    );
  }
});

test('explicit replacement arrays clear omitted paragraphs while absent arrays preserve them', () => {
  const base: IDocumentBody = {
    dataStream: '\r\r\n',
    paragraphs: [{ ...paragraph }, { ...paragraph, startIndex: 1, paragraphId: 'second' }],
  };
  for (const updates of [undefined, [], [update({ startIndex: 1 })]]) {
    const first = new TextX()
      .retain(
        2,
        { dataStream: '', paragraphs: structuredClone(base.paragraphs) },
        UpdateDocsAttributeType.REPLACE,
      )
      .serialize();
    const second = new TextX()
      .retain(
        2,
        { dataStream: '', ...(updates ? { paragraphs: updates } : {}) },
        UpdateDocsAttributeType.REPLACE,
      )
      .serialize();
    const sequential = TextX.apply(
      TextX.apply(structuredClone(base), structuredClone(first)),
      structuredClone(second),
    );
    const composed = TextX.apply(
      structuredClone(base),
      TextX.compose(structuredClone(first), structuredClone(second)),
    );
    assert.deepEqual(composed, sequential);
  }
});

const require = createRequire(import.meta.url);
const builds = [
  { name: 'es', core: { BuildTextUtils, TextX } },
  { name: 'cjs', core: require('@univerjs/core') as typeof import('@univerjs/core') },
];
const linked = (ranges: [string, number, number][]): IDocumentBody => ({
  dataStream: 'abcdef\rghij\r\n',
  paragraphs: [
    { startIndex: 6, paragraphId: 'p1' },
    { startIndex: 11, paragraphId: 'p2' },
  ],
  sectionBreaks: [{ startIndex: 12, sectionId: 's1' }],
  customRanges: ranges.map(([rangeId, startIndex, endIndex]) => ({
    rangeId,
    rangeType: CustomRangeType.HYPERLINK,
    startIndex,
    endIndex,
    properties: { url: 'https://example.test' },
  })),
});
const rangesOf = (body: IDocumentBody) =>
  body.customRanges?.map(({ rangeId, startIndex, endIndex }) => [rangeId, startIndex, endIndex]);

test('a style inside a link leaves it whole, so apply order cannot split it', () => {
  for (const { name, core } of builds) {
    const bold = new core.TextX()
      .retain(4)
      .retain(2, { dataStream: '', textRuns: [{ st: 0, ed: 2, ts: { bl: 1 } }] })
      .serialize();
    const styled = core.TextX.apply(linked([['L', 3, 8]]), bold);
    assert.deepEqual(rangesOf(styled), [['L', 3, 8]], name);
    // A paragraph edit's retain splits the same way.
    const indent = new core.TextX()
      .retain(6)
      .retain(1, {
        dataStream: '',
        paragraphs: [update({ startIndex: 0, paragraphStyle: { indentStart: { v: 10 } } })],
      })
      .serialize();
    assert.deepEqual(
      rangesOf(core.TextX.apply(linked([['L', 3, 8]]), indent)),
      [['L', 3, 8]],
      name,
    );
  }
});

test('a lone piece of a split range takes its root id back', () => {
  for (const { name, core } of builds) {
    const bold = new core.TextX()
      .retain(1, { dataStream: '', textRuns: [{ st: 0, ed: 1, ts: { bl: 1 } }] })
      .serialize();
    assert.deepEqual(
      rangesOf(core.TextX.apply(linked([['L$1', 3, 8]]), bold)),
      [['L', 3, 8]],
      name,
    );
  }
});

test('adding a link across a paragraph that an existing link spans emits no negative retain', () => {
  for (const { name, core } of builds) {
    for (const [startOffset, endOffset, expected] of [
      [0, 10, [['N', 0, 9]]],
      [4, 10, [['N', 3, 9]]],
      [7, 8, [['N', 3, 8]]],
    ] as const) {
      const body = linked([['L', 3, 8]]);
      const textX = core.BuildTextUtils.customRange.add({
        ranges: [{ startOffset, endOffset, collapsed: false }],
        rangeId: 'N',
        rangeType: CustomRangeType.HYPERLINK,
        properties: { url: 'https://new.test' },
        body,
      });
      assert.ok(textX, name);
      const actions = textX.serialize();
      assert.ok(
        actions.every((action) => action.t !== 'r' || action.len >= 0),
        `${name} ${startOffset}..${endOffset}: ${JSON.stringify(actions)}`,
      );
      assert.deepEqual(rangesOf(core.TextX.apply(body, actions)), expected, name);
    }
  }
});

type Request = (callback: () => void) => () => void;

/**
 * Behaviour every copy of the helper must show: call order, cancellation (before the run, after the run and
 * for an entry another task already shifted), and that the callback is a macrotask. Run against the pooled
 * source text and against the shipped, patched module alike.
 */
async function exerciseScheduler(request: Request) {
  const order: string[] = [];
  const done = new Promise<void>((resolve) => {
    request(() => order.push('a'));
    const cancelB = request(() => order.push('b'));
    request(() => order.push('c'));
    cancelB();
    request(() => {
      order.push('d');
      // A task scheduled from a task still runs after it, in a later macrotask.
      request(() => {
        order.push('e');
        resolve();
      });
      order.push('d-after');
    });
  });
  await done;
  assert.deepEqual(order, ['a', 'c', 'd', 'd-after', 'e']);

  // Cancelling after the run, even repeatedly, is a no-op that neither throws nor suppresses a later task.
  const later: string[] = [];
  let cancelRan = () => {};
  await new Promise<void>((resolve) => {
    cancelRan = request(() => {
      later.push('ran');
      resolve();
    });
  });
  cancelRan();
  cancelRan();
  // A task whose entry was already shifted (it is running) cancels itself harmlessly from inside.
  await new Promise<void>((resolve) => {
    const cancelSelf: () => void = request(() => {
      cancelSelf();
      later.push('self');
      resolve();
    });
  });
  await new Promise<void>((resolve) => request(() => (later.push('after'), resolve())));
  assert.deepEqual(later, ['ran', 'self', 'after']);

  // The callback is a macrotask: not synchronous, and after microtasks queued beside it.
  const sequence: string[] = [];
  const ran = new Promise<void>((resolve) => {
    request(() => {
      sequence.push('task');
      resolve();
    });
  });
  queueMicrotask(() => sequence.push('microtask'));
  sequence.push('sync');
  await ran;
  assert.deepEqual(sequence, ['sync', 'microtask', 'task']);
}

const flat = (text: string) => text.trim().split('\n');
function runChild(prelude: string, module: boolean, body: string) {
  const child = spawnSync(
    process.execPath,
    [...(module ? ['--input-type=module'] : []), '-e', `${prelude}\n${body}`],
    { encoding: 'utf8', timeout: 5000 },
  );
  // A hung process is killed by the timeout: status null and a signal, which fails every assertion below.
  assert.equal(child.signal, null, `child hung or crashed: ${child.stderr}`);
  assert.equal(child.status, 0, child.stderr);
  return flat(child.stdout);
}

const pooledPrelude = `${pooledMacroTask}\nconst request = requestImmediateMacroTask;`;

test('the pooled macrotask scheduler keeps order, cancellation and one channel (SPN-146)', async () => {
  for (const format of ['es', 'cjs'] as const) {
    const source = await readFile(
      new URL(`../../node_modules/@univerjs/core/lib/${format}/index.js`, import.meta.url),
      'utf8',
    );
    // The installed build uses the pooled function, and the A/B's previous build the upstream one.
    assert.ok(patchCore(source, format).includes(pooledMacroTask));
    const upstream = patchCore(source, format, { pooledChannel: false });
    assert.ok(!upstream.includes('pendingMacroTasks'));
    assert.match(upstream, /const channel = new MessageChannel\(\);/);
    // The two builds differ only by the macrotask function: pooling the upstream build gives the shipped one.
    assert.notEqual(upstream, patchCore(source, format));
    assert.equal(patchCore(upstream, format), patchCore(source, format));
  }
  let channels = 0;
  class Counting extends MessageChannel {
    constructor() {
      super();
      channels++;
    }
  }
  // The text under test is evaluated with a counting MessageChannel; the shipped bytes are tested below.
  const request = new Function(
    'MessageChannel',
    `${pooledMacroTask}\nreturn requestImmediateMacroTask;`,
  )(Counting) as Request;
  await exerciseScheduler(request);
  assert.equal(channels, 1);
});

test('a throwing macrotask callback is reported, and later tasks and shared state still work', () => {
  // The throw surfaces as an uncaught exception from the port's message event; the child handles it.
  const lines = runChild(
    pooledPrelude,
    false,
    `process.on('uncaughtException', (error) => console.log('caught ' + error.message));
request(() => { throw new Error('boom'); });
request(() => console.log('after'));
setTimeout(() => request(() => console.log('third')), 30);`,
  );
  assert.deepEqual(lines, ['caught boom', 'after', 'third']);
});

test('only a pending macrotask keeps a Node process alive (port ref/unref)', () => {
  // An idle channel does not hold the process open: it exits after the task ran.
  assert.deepEqual(runChild(pooledPrelude, false, `request(() => console.log('ran'));`), ['ran']);
  // After going idle the next pending task re-references the port and still runs before exit, even though
  // nothing else (timer, socket) is alive when it is posted.
  assert.deepEqual(
    runChild(
      pooledPrelude,
      false,
      `request(() => { console.log('ran1'); setTimeout(() => request(() => console.log('ran2')), 30); });`,
    ),
    ['ran1', 'ran2'],
  );
  // A cancelled entry is only marked: its closure and message stay until the message is delivered, so it
  // still holds the loop open for that one delivery, never runs, and the process then exits.
  assert.deepEqual(
    runChild(
      pooledPrelude,
      false,
      `request(() => console.log('bad'))(); request(() => console.log('later'));
const cancelled = request(() => console.log('bad2')); cancelled();`,
    ),
    ['later'],
  );
});

test('the shipped, patched @univerjs/core has one pooled helper and shows the same behaviour', async () => {
  // Work on a temp copy of the installed package, inside the repository so its own dependencies resolve.
  const root = await mkdtemp(resolve('.spinel-core-module-'));
  try {
    const copy = resolve(root, 'core');
    await cp(resolve('node_modules/@univerjs/core'), copy, { recursive: true });
    for (const format of ['es', 'cjs'] as const) {
      const source = await readFile(resolve(copy, 'lib', format, 'index.js'), 'utf8');
      // The installed bytes are exactly the pooled build, with a single definition.
      assert.equal(patchCore(source, format), source, format);
      assert.equal(source.split('function requestImmediateMacroTask(').length, 2, format);
      assert.equal(source.split(pooledMacroTask).length, 2, format);
      assert.ok(!source.includes('const channel = new MessageChannel();'), format);
      assert.equal(source.split('new MessageChannel(').length, 2, format);
      // The only references are the definition and the public export (cjs names it on both sides).
      const exported =
        format === 'es'
          ? /export \{[^}]*\brequestImmediateMacroTask\b[^}]*\}/
          : /^exports\.requestImmediateMacroTask = requestImmediateMacroTask;$/m;
      assert.match(source, exported, format);
      assert.equal(
        source.split(/\brequestImmediateMacroTask\b/).length - 1,
        format === 'es' ? 2 : 3,
        format,
      );
    }
    const url = pathToFileURL(resolve(copy, 'lib/es/index.js')).href;
    const es = (await import(url)) as { requestImmediateMacroTask: Request };
    const cjs = createRequire(resolve(copy, 'package.json'))('./lib/cjs/index.js') as {
      requestImmediateMacroTask: Request;
    };
    for (const core of [es, cjs]) await exerciseScheduler(core.requestImmediateMacroTask);
    // Both formats' shipped bytes keep a throwing callback from breaking later tasks.
    const throwing = `process.on('uncaughtException', (error) => console.log('caught ' + error.message));
request(() => { throw new Error('boom'); });
request(() => console.log('after'));`;
    assert.deepEqual(
      runChild(
        `import { requestImmediateMacroTask as request } from ${JSON.stringify(url)};`,
        true,
        throwing,
      ),
      ['caught boom', 'after'],
    );
    assert.deepEqual(
      runChild(
        `const { requestImmediateMacroTask: request } = require(${JSON.stringify(resolve(copy, 'lib/cjs/index.js'))});`,
        false,
        throwing,
      ),
      ['caught boom', 'after'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
