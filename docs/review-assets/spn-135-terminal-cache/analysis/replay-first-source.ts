// Offline replay of the retained native cache, never browser latency acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { serialize } from 'node:v8';
import { patchCore } from '/Users/mxbaylee/projects/spinel/scripts/dependencies/patch-univer-core.ts';
import { prepareDocsPatch } from '/Users/mxbaylee/projects/spinel/scripts/dependencies/patch-univer-docs.ts';

const artifact = process.argv[2];
const output = process.argv[3];
assert.ok(artifact && output);
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const metricsFiles = fs.readdirSync(artifact, { recursive: true }).map(String).filter(x => x.endsWith('spn108-metrics.json'));
assert.equal(metricsFiles.length, 1);
const metricsPath = path.join(artifact, metricsFiles[0]!);
const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
assert.equal(metrics.completed, true);
assert.deepEqual(metrics.errors, []);
assert.equal(metrics.source, 'dbbe5ccaf085ce20b79068d3596a35dcf2142223');
const raw = fs.readFileSync(path.join(path.dirname(metricsPath), 'spn135-native-caches.json'));
assert.equal(hash(raw), metrics.nativeDiagnostic.sha256);
const capture = JSON.parse(raw.toString());
const identityPath = path.join(artifact, 'runtime-source/spn135-diagnostic-identity.json');
const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
assert.equal(identity.source, metrics.source);
const corePatchPath = '/Users/mxbaylee/projects/spinel/scripts/dependencies/patch-univer-core.ts';
assert.equal(hash(fs.readFileSync(corePatchPath)), identity.files['scripts/dependencies/patch-univer-core.ts']);
assert.equal(capture.captureError, null);
assert.equal(capture.phaseError, null);
const terminal = capture.native.filter((entry: any) => entry.unitId === metrics.native.unitId &&
  entry.phaseStartedAt >= metrics.input.keydownAt.at(-1) && entry.phaseEndedAt <= metrics.traceClockEnd);
assert.deepEqual(terminal.map((entry: any) => entry.phase), ['history', 'collaboration']);
assert.equal(terminal[0].count, terminal[1].count);
assert.ok(terminal[0].count > 0 && terminal[0].count < 32);
let visits = 0;
function decode(value: any): any {
  assert.ok(++visits <= 100000);
  if (value.kind === 'undefined') return undefined;
  if (value.kind === 'value') return value.value;
  assert.ok(value.kind === 'array' || value.kind === 'object');
  const result: any = value.kind === 'array' ? [] : {};
  for (const [key, child] of value.entries)
    Object.defineProperty(result, key, { value: decode(child), writable: true,
      enumerable: value.kind !== 'array' || key !== 'length', configurable: value.kind !== 'array' || key !== 'length' });
  return result;
}
visits = 0;
const history = decode(terminal[0].cache);
visits = 0;
const collaboration = decode(terminal[1].cache);
assert.equal(history.length, terminal[0].count);
assert.equal(collaboration.length, terminal[1].count);
const before = structuredClone({ history, collaboration });
const runtime = '/Users/mxbaylee/projects/spinel-spn-098';
const require = createRequire(runtime + '/package.json');
const core = require('@univerjs/core');
const { BehaviorSubject, Subject, takeUntil } = require('rxjs');
const fixturePath = '/Users/mxbaylee/projects/spinel/scripts/dependencies/patch-univer-docs.test.ts';
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
function between(start: string, end: string) {
  const a = fixtureSource.indexOf(start), b = fixtureSource.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return fixtureSource.slice(a, b);
}
// Reuse the established native manager/publication/primitive-work fixture.
const reused = between('function clock()', 'function apply(') +
  between('function flush(', 'function appliedSnapshots(') +
  between('function measuredFlush(', "test('sequential style oracle");
const context = { assert, core, BehaviorSubject, Subject, takeUntil, runInNewContext,
  structuredClone, unitId: metrics.native.unitId };
const measured = runInNewContext(stripTypeScriptTypes(reused, { mode: 'strip' }) + '\nmeasuredFlush;', context);
const results: any[] = [];
const identities: any = { fixtureSha256: hash(fixtureSource), reusedFixtureSha256: hash(reused),
  patchSha256: hash(fs.readFileSync('/Users/mxbaylee/projects/spinel/scripts/dependencies/patch-univer-docs.ts')),
  installedCore: {} };
for (const format of ['es', 'cjs'] as const) {
  const installedCore = fs.readFileSync(runtime + '/node_modules/@univerjs/core/lib/' + format + '/index.js', 'utf8');
  assert.equal(patchCore(installedCore, format), installedCore);
  identities.installedCore[format] = hash(installedCore);
  const installed = fs.readFileSync(runtime + '/node_modules/@univerjs/docs/lib/' + format + '/index.js', 'utf8');
  const observedBuild = identity.nativeInstrumentation.find((entry: any) => entry.file === 'node_modules/@univerjs/docs/lib/' + format + '/index.js');
  assert.ok(observedBuild);
  assert.equal(hash(installed), observedBuild.beforeSha256);
  const prepared = prepareDocsPatch(installed, format);
  assert.equal(installed, prepared.markerPatched, 'Read-only historical install must be exact SPN-132 marker bytes');
  const builds = { original: prepared.original, historical: prepared.markerPatched, current: prepared.patched };
  const cases: any = {};
  for (const [name, source] of Object.entries(builds)) {
    const result = measured(source, history, collaboration);
    assert.deepEqual({ history, collaboration }, before);
    const bytes = serialize(result.output);
    fs.writeFileSync(path.join(output, format + '-' + name + '-publication.v8'), bytes);
    cases[name] = { sourceSha256: hash(source), publicationSha256: hash(bytes), counts: result.counts, output: result.output };
  }
  assert.deepEqual(cases.historical.output, cases.original.output, 'Historical complete publication differs from original');
  assert.deepEqual(cases.current.output, cases.original.output, 'Current complete publication differs from original');
  assert.deepEqual(cases.current.counts, cases.historical.counts, 'Current six-tail work differs from historical');
  const qualification: any[] = [];
  for (const [name, source] of Object.entries({ historical: builds.historical, current: builds.current })) {
    const a = source.indexOf('function hasOnlyDocInsertKeys(');
    const b = source.indexOf('const IDocStateChangeInterceptorService =', a);
    assert.ok(a > 0 && b > a);
    const method = name === 'historical' ? 'canBalanceDocInserts' : 'docInsertPrefixLength';
    const qualify = runInNewContext(source.slice(a, b) + '\n' + method + ';', { ...core, _univerjs_core: core });
    for (const [scope, states] of Object.entries({ history, collaboration }))
      for (const key of ['redoState', 'undoState']) {
        const sequence = key === 'undoState' ? [...states as any[]].reverse() : [...states as any[]];
        qualification.push({ name, scope, key, result: qualify(sequence, key) });
      }
  }
  results.push({ format, qualification, cases: Object.fromEntries(Object.entries(cases).map(([name, entry]: any) =>
    [name, { sourceSha256: entry.sourceSha256, publicationSha256: entry.publicationSha256, counts: entry.counts }])) });
}
const report = { diagnosticOnly: true, browserLatencyAcceptance: false, historicalFailureAttribution: false,
  source: metrics.source, captureSha256: hash(raw), terminalCount: history.length,
  terminalCacheHashes: terminal.map((x: any) => hash(JSON.stringify(x.cache))),
  completePublicationsEqual: true, historicalCurrentPrimitiveWorkEqual: true,
  primitiveCountMeaning: 'Instrumented calls and allocation branches, not actual heap allocations or latency',
  inputUnchanged: true, identities, results,
  limits: 'Newly captured cache, not the missing original failing cache. ES/CJS manager regions share one imported core. No full initial snapshot is retained here; native browser content/Undo/Redo remain separate evidence.' };
fs.writeFileSync(path.join(output, 'terminal-replay.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
