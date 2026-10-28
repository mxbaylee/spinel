import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { attributeDocCallbackSources } from '../../e2e/doc-responsiveness-callback-sources.ts';
import { prepareDocsUiPatch } from '../dependencies/patch-univer-docs-ui.ts';

const origin = 'https://spinel.test';
const runtimeUrl = `${origin}/assets/exact-build.js`;
const sourceUrl = '../../node_modules/@univerjs/docs-ui/lib/es/index.js';
const otherSource = 'export const tick = () => 0;';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Mapping = { source: number; line: number; column?: number; generatedColumn?: number };

// Independently encode small standard VLQ maps. Each row maps one generated
// line, permitting checks on Chrome's one-based coordinate conversion.
function vlq(value: number) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = value < 0 ? -value * 2 + 1 : value * 2;
  let result = '';
  do {
    const digit = encoded % 32;
    encoded = Math.floor(encoded / 32);
    result += alphabet[digit + (encoded > 0 ? 32 : 0)];
  } while (encoded > 0);
  return result;
}

function mappings(rows: Mapping[]) {
  let source = 0;
  let line = 0;
  let column = 0;
  return rows
    .map((row) => {
      const segment = [
        row.generatedColumn ?? 5,
        row.source - source,
        row.line - line,
        (row.column ?? 0) - column,
      ]
        .map(vlq)
        .join('');
      source = row.source;
      line = row.line;
      column = row.column ?? 0;
      return segment;
    })
    .join(';');
}

const point = (lineNumber = 1, columnNumber = 6, url = runtimeUrl) => ({
  url,
  lineNumber,
  columnNumber,
});
const event = (
  name: 'TimerInstall' | 'TimerRemove' | 'FunctionCall',
  location: ReturnType<typeof point>,
) => ({
  name,
  args: { data: name === 'FunctionCall' ? location : { stackTrace: [location] } },
});

async function fixture(
  t: TestContext,
  contents: Array<string | null> = [otherSource],
  rows: Mapping[] = [{ source: 0, line: 0 }],
  sources = contents.map((_, index) => `../../src/module-${index}.ts`),
) {
  const root = await mkdtemp(join(tmpdir(), 'spn113-callback-sources-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distDirectory = join(root, 'dist');
  await mkdir(join(distDirectory, 'assets'), { recursive: true });
  const runtimePath = join(distDirectory, 'assets/exact-build.js');
  const mapPath = `${runtimePath}.map`;
  const map = {
    version: 3,
    file: 'exact-build.js',
    sourceRoot: '',
    sources,
    sourcesContent: contents,
    names: [],
    mappings: mappings(rows),
  };
  const runtime = `${rows.map(() => 'const tick = run();').join('\n')}\n`;
  await writeFile(runtimePath, runtime);
  await writeFile(mapPath, JSON.stringify(map));
  return {
    root,
    distDirectory,
    runtimePath,
    mapPath,
    runtime,
    map,
    run: (traceEvents: unknown[]) =>
      attributeDocCallbackSources({ traceEvents, origin, distDirectory }),
    writeMap: (payload: unknown) => writeFile(mapPath, JSON.stringify(payload)),
  };
}

function sourceLine(source: string, needle: string, from = 0) {
  const index = source.indexOf(needle, from);
  assert.ok(index >= 0, `Fixture source contains ${needle}`);
  return source.slice(0, index).split('\n').length - 1;
}

for (const format of ['es', 'cjs'] as const) {
  for (const variant of ['original', 'patched'] as const) {
    test(`${format} ${variant}: attributes the actual pinned package and retains exact build/source bytes`, async (t) => {
      const installed = await readFile(
        new URL(`../../node_modules/@univerjs/docs-ui/lib/${format}/index.js`, import.meta.url),
        'utf8',
      );
      const source = prepareDocsUiPatch(installed, format)[variant];
      const cursor = source.indexOf('//#region src/services/selection/text-range.ts');
      const blink = source.indexOf('\n\t_anchorBlink() {', cursor);
      const interval = source.indexOf('this._anchorBlinkTimer = setInterval(', blink);
      const zoom = source.indexOf(
        '//#region src/controllers/render-controllers/zoom.render-controller.ts',
      );
      const rows: Mapping[] = [
        { source: 0, line: sourceLine(source, 'setTimeout(() => {', blink) },
        { source: 0, line: sourceLine(source, 'setInterval(() => {', interval) },
        { source: 0, line: sourceLine(source, 'setTimeout(() => {', interval) },
        { source: 0, line: sourceLine(source, 'this._initTimer = window.setTimeout(', zoom) },
        { source: 0, line: sourceLine(source, 'this._updateTimer = window.setTimeout(', zoom) },
        { source: 0, line: sourceLine(source, '\n\t_initCommandExecutedListener() {', zoom) + 1 },
        { source: 1, line: 0 },
      ];
      const mappedSourceUrl = sourceUrl.replace('/es/', `/${format}/`);
      const f = await fixture(t, [source, otherSource], rows, [
        mappedSourceUrl,
        '../../src/other.ts',
      ]);
      const trace = rows.map((_, index) =>
        event(index % 2 === 0 ? 'TimerInstall' : 'FunctionCall', point(index + 1)),
      );
      trace.push(event('TimerRemove', point(1)), event('TimerInstall', point(1)));
      const unchanged = JSON.stringify(trace);
      const result = await f.run(trace);
      assert.deepEqual(result.unmapped, []);
      assert.equal(JSON.stringify(trace), unchanged);
      assert.deepEqual(
        result.callsites.map((site) => site.family),
        ['cursor', 'cursor', 'cursor', 'zoom-init', 'zoom-update', 'other', 'other'],
      );
      assert.deepEqual(result.callsites[4], {
        ...point(5),
        family: 'zoom-update',
        sourceUrl: mappedSourceUrl,
        sourceLine: rows[4]!.line + 1,
        sourceColumn: 1,
      });
      assert.equal(result.artifacts.length, 3);
      for (const artifact of result.artifacts) {
        const bytes =
          artifact.kind === 'docs-ui-source'
            ? Buffer.from(artifact.content)
            : await readFile(artifact.path);
        assert.equal(artifact.bytes, bytes.byteLength);
        assert.equal(artifact.sha256, digest(bytes));
        if (artifact.kind === 'docs-ui-source') {
          assert.equal(artifact.content, source);
          assert.equal(artifact.sourceMapPath, f.mapPath);
          assert.equal(artifact.sourceUrl, mappedSourceUrl);
          assert.equal(artifact.sourceIndex, 0);
        }
      }
    });
  }
}

test('converts one-based Chrome columns once and does not carry mappings across empty lines', async (t) => {
  const f = await fixture(
    t,
    [otherSource],
    [
      { source: 0, line: 0, column: 7 },
      { source: 0, line: 0 },
    ],
  );
  await f.writeMap({ ...f.map, mappings: f.map.mappings.split(';')[0] });
  const result = await f.run([
    event('TimerInstall', point(1, 5)),
    event('TimerInstall', point(1, 6)),
    event('TimerInstall', point(2, 6)),
  ]);
  assert.deepEqual(result.callsites, [
    {
      ...point(1, 6),
      family: 'other',
      sourceUrl: '../../src/module-0.ts',
      sourceLine: 1,
      sourceColumn: 8,
    },
  ]);
  assert.equal(result.unmapped.length, 2);
  assert.ok(result.unmapped.every((entry) => entry.reason.includes('no source mapping')));
});

test('collects only timer top frames and FunctionCall points and deduplicates repeated failures', async (t) => {
  const f = await fixture(t);
  const foreign = point(1, 6, 'https://another-origin.test/assets/exact-build.js');
  const install = event('TimerInstall', point());
  assert.ok('stackTrace' in install.args.data);
  install.args.data.stackTrace.push(point(1, 6, `${origin}/ignored-lower-frame.js`));
  const result = await f.run([
    install,
    event('FunctionCall', point()),
    event('TimerRemove', point()),
    event('TimerInstall', foreign),
    event('TimerRemove', foreign),
    { name: 'TimerFire', args: { data: foreign } },
  ]);
  assert.equal(result.callsites.length, 1);
  assert.equal(result.unmapped.length, 1);
  assert.deepEqual(result.unmapped[0]!.point, foreign);
  assert.equal(result.unmapped[0]!.firstEventIndex, 3);
  assert.equal(result.unmapped[0]!.occurrences, 2);
  assert.deepEqual(result.unmapped[0]!.eventNames, ['TimerInstall', 'TimerRemove']);
  assert.match(result.unmapped[0]!.reason, /origin/);
});

test('rejects malformed raw points, missing maps and generated positions outside the captured file', async (t) => {
  const f = await fixture(t);
  const malformed = [
    { ...point(), lineNumber: '1' },
    { ...point(), lineNumber: 0 },
    { ...point(), columnNumber: 0 },
    { ...point(), columnNumber: 1.5 },
    { ...point(), lineNumber: Number.NaN },
    { ...point(), lineNumber: Number.MAX_SAFE_INTEGER + 1 },
    { ...point(), url: 12 },
  ];
  const result = await f.run([
    ...malformed.map((location) => ({ name: 'FunctionCall', args: { data: location } })),
    { name: 'TimerInstall', args: { data: { stackTrace: point() } } },
    event('FunctionCall', point(1, 1000)),
    event('FunctionCall', point(99)),
    event('FunctionCall', point(1, 6, 'eval-at-playwright')),
  ]);
  assert.equal(result.callsites.length, 0);
  assert.equal(result.unmapped.length, malformed.length + 4);
  await rm(f.mapPath);
  const missingMap = await f.run([event('TimerInstall', point())]);
  assert.equal(missingMap.callsites.length, 0);
  assert.equal(missingMap.unmapped.length, 1);
  assert.match(missingMap.unmapped[0]!.reason, /ENOENT/);
});

test('a missing or altered package source stays unclassified instead of becoming other', async (t) => {
  const f = await fixture(t, [null], undefined, [sourceUrl]);
  const missing = await f.run([event('TimerInstall', point())]);
  assert.equal(missing.callsites.length, 0);
  assert.match(missing.unmapped[0]!.reason, /content is missing/);
  const fake =
    '//#region src/services/selection/text-range.ts\nsetTimeout(() => {}, 500);\n//#endregion';
  await f.writeMap({ ...f.map, sourcesContent: [fake] });
  const altered = await f.run([event('TimerInstall', point())]);
  assert.equal(altered.callsites.length, 0);
  assert.match(altered.unmapped[0]!.reason, /does not match the baseline or reviewed repair/);
  const sourceArtifact = altered.artifacts.find((artifact) => artifact.kind === 'docs-ui-source');
  assert.equal(sourceArtifact?.sha256, digest(fake));
  await f.writeMap({ ...f.map, sourcesContent: [fake], sources: ['../../src/independent.ts'] });
  const unrelated = await f.run([event('TimerInstall', point())]);
  assert.equal(unrelated.callsites[0]!.family, 'other');
});

test('rejects ambiguous, invalid or out-of-range source maps', async (t) => {
  const f = await fixture(t);
  const invalid = [
    { ...f.map, version: 2 },
    { ...f.map, file: 'a-different-build.js' },
    { ...f.map, mappings: null },
    { ...f.map, sources: [false] },
    { ...f.map, sources: ['same.ts', 'same.ts'], sourcesContent: [otherSource, otherSource] },
    { ...f.map, sourcesContent: [] },
    { ...f.map, sourcesContent: [24] },
    { ...f.map, mappings: mappings([{ source: 0, line: 30 }]) },
    { ...f.map, mappings: mappings([{ source: 0, line: 0, column: 1000 }]) },
  ];
  for (const payload of invalid) {
    await f.writeMap(payload);
    const result = await f.run([event('TimerInstall', point())]);
    assert.equal(result.callsites.length, 0);
    assert.equal(result.unmapped.length, 1);
  }
});

test('reads only same-origin JavaScript and confines runtime/map real paths to dist', async (t) => {
  const f = await fixture(t);
  const urls = [
    'https://elsewhere.test/assets/exact-build.js',
    'http://spinel.test/assets/exact-build.js',
    'https://user:secret@spinel.test/assets/exact-build.js',
    `${origin}/assets/exact-build.ts`,
    `${origin}/assets/%2e%2e%2foutside.js`,
    `${origin}/assets/%00.js`,
    `${origin}/assets/%5coutside.js`,
    `${origin}/assets/%E0%A4%A.js`,
  ];
  const rejected = await f.run(urls.map((url) => event('TimerInstall', point(1, 6, url))));
  assert.equal(rejected.callsites.length, 0);
  assert.equal(rejected.unmapped.length, urls.length);
  assert.equal(rejected.artifacts.length, 0);

  const external = join(f.root, 'outside.js');
  await writeFile(external, f.runtime);
  await rm(f.runtimePath);
  await symlink(external, f.runtimePath);
  const outsideRuntime = await f.run([event('TimerInstall', point())]);
  assert.equal(outsideRuntime.callsites.length, 0);
  assert.match(outsideRuntime.unmapped[0]!.reason, /runtime resolves outside dist/);
  await rm(f.runtimePath);
  await writeFile(f.runtimePath, f.runtime);
  const externalMap = join(f.root, 'outside.js.map');
  await writeFile(externalMap, JSON.stringify(f.map));
  await rm(f.mapPath);
  await symlink(externalMap, f.mapPath);
  const outsideMap = await f.run([event('TimerInstall', point())]);
  assert.equal(outsideMap.callsites.length, 0);
  assert.match(outsideMap.unmapped[0]!.reason, /source-map resolves outside dist/);
});

test('retains raw query URLs as distinct callsites while hashing each physical file once', async (t) => {
  const f = await fixture(t);
  const locations = [point(), point(1, 6, `${runtimeUrl}?v=2`)];
  const result = await f.run(locations.map((location) => event('FunctionCall', location)));
  assert.deepEqual(result.unmapped, []);
  assert.deepEqual(
    result.callsites.map((site) => site.url),
    locations.map((location) => location.url),
  );
  assert.equal(result.artifacts.length, 2);
  await assert.rejects(
    attributeDocCallbackSources({
      traceEvents: [],
      origin: 'file:///tmp',
      distDirectory: f.distDirectory,
    }),
    /HTTP\(S\) build origin/,
  );
});
