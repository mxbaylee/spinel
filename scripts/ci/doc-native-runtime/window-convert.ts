import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { glob, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { convertDocCallbackTrace } from '../../../e2e/doc-responsiveness-callback-converter.ts';
import { persistCallbackManifest } from '../../../e2e/doc-responsiveness-callback-progress.ts';
import { resourceFailure } from './watchdog.ts';
import { analyzeNativeWindow } from './window-analysis.ts';
import { validateRetainedNativeSources } from '../../../e2e/doc-responsiveness-native-sources.ts';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const controller = new AbortController();
const deadline = setTimeout(
  () => controller.abort(new Error('Window analysis50second deadline')),
  50_000,
);
const record: any = { complete: false };
let failure: unknown;
try {
  const paths: string[] = [];
  for await (const path of glob('test-results/doc-responsiveness/**/spn108-metrics.json'))
    paths.push(path);
  assert.equal(paths.length, 1, 'Exactly one observation required');
  const directory = dirname(paths[0]!);
  const load = async (path: string) => {
    const bytes = await readFile(path);
    (record.inputs ??= {})[path] = hash(bytes);
    return JSON.parse(bytes.toString());
  };
  const metrics = await load(paths[0]!);
  const preparation = await load('spn146-diagnostic-build.json');
  const sourcePreparation = await load('spn146-source-preparation.json');
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(source, process.env.SPN146_REVIEWED_HEAD);
  assert.equal(metrics.source, source);
  assert.equal(preparation.source, source);
  assert.equal(preparation.reviewedHead, source);
  assert.equal(
    preparation.tree,
    execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  );
  assert.equal(preparation.nativeReference, '2f442317dd2e1c188ae4a810ac094fd1162a4a2a');
  assert.equal(preparation.eventBefore, 'df76fb78fa0258f8c28c068767970e8e869a5838');
  assert.deepEqual(metrics.nativeDiagnosticBuild, preparation);
  assert.deepEqual(metrics.nativeSourcePreparation, sourcePreparation);
  assert.equal(sourcePreparation.source, source);
  assert.equal(sourcePreparation.tree, preparation.tree);
  assert.equal(sourcePreparation.eventBefore, preparation.eventBefore);
  const preparationGuard = await load('spn146-source-preparation-watchdog.json');
  assert.equal(preparationGuard.outcome, 'passed');
  assert.equal(preparationGuard.mode, 'component');
  assert.equal(preparationGuard.failure, null);
  assert.equal(preparationGuard.firstViolation, null);
  assert.equal(resourceFailure(preparationGuard), null);
  for (const [path, expected] of Object.entries(preparation.sources))
    assert.equal(hash(await readFile(path)), expected, `Prepared source changed: ${path}`);
  const docs = preparation.builds.find((entry: any) => entry.format === 'es');
  assert.equal(
    docs.priorSha256,
    '57ec2ee153792c73e466a753d2e5c9ed1cd19615bb45a04fbe72c9336a6ad2b8',
  );
  assert.equal(hash(await readFile(docs.path)), docs.priorSha256);
  const identities = {
    'node_modules/@univerjs/docs/lib/es/index.js': docs.priorSha256,
    'node_modules/@univerjs/core/lib/es/index.js':
      preparation.sources['node_modules/@univerjs/core/lib/es/index.js'],
  };
  record.loadedSources = await validateRetainedNativeSources(
    directory + '/spn146-loaded-sources',
    metrics.nativeLoadedSources,
    identities,
  );
  const journal = await load(directory + '/spn146-progress.json');
  assert.equal(journal.terminal, 'passed');
  assert.equal(journal.firstFailure, null);
  assert.equal(journal.persistenceFailure, null);
  assert.equal(journal.droppedEvents, 0);
  const watchdog = await load('test-results/spn146-window-watchdog.json');
  assert.equal(watchdog.outcome, 'passed');
  assert.equal(watchdog.mode, 'application-window');
  assert.equal(watchdog.failure, null);
  assert.equal(resourceFailure(watchdog, 'application-window'), null);
  const transport = metrics.nativeDiagnosticTrace.transport;
  const stored = await readFile(directory + '/spn146-runtime-trace.pftrace.gz');
  assert.equal(stored.length, transport.bytes);
  assert.equal(hash(stored), transport.sha256);
  const binary = process.env.DOC_TRACE_PROCESSOR_PATH;
  assert.ok(binary);
  const converted = await convertDocCallbackTrace({
    binary,
    input: directory + '/spn146-runtime-trace.pftrace.gz',
    identity: transport.transport,
    output: directory + '/spn146-window.trace.json.gz',
    receipt: directory + '/spn146-conversion.json',
    signal: controller.signal,
    phase: (phase) => {
      record.phase = phase;
    },
  });
  assert.ok(converted.output.decoded.bytes <= 128 * 1024 ** 2);
  const compressed = await readFile(directory + '/spn146-window.trace.json.gz');
  assert.equal(hash(compressed), converted.output.sha256);
  const decoded = gunzipSync(compressed, { maxOutputLength: 128 * 1024 ** 2 });
  assert.equal(decoded.length, converted.output.decoded.bytes);
  assert.equal(hash(decoded), converted.output.decoded.sha256);
  const trace = JSON.parse(decoded.toString());
  assert.ok(Array.isArray(trace.traceEvents));
  const capture = await load(directory + '/spn146-native-caches.json');
  record.analysis = analyzeNativeWindow(metrics, capture, trace.traceEvents);
  const profileBytes = await readFile(directory + '/spn108-profile.cpuprofile');
  assert.equal(hash(profileBytes), metrics.profileSha256);
  const profile = JSON.parse(profileBytes.toString());
  assert.equal(profile.samples.length, profile.timeDeltas.length);
  const nodeIds = new Set(profile.nodes.map((node: any) => node.id));
  assert.ok(profile.samples.every((id: number) => nodeIds.has(id)));
  assert.ok(profile.timeDeltas.every((delta: number) => Number.isFinite(delta)));
  record.profile = {
    sha256: hash(profileBytes),
    samples: profile.samples.length,
    negativeDeltas: profile.timeDeltas.filter((value: number) => value < 0).length,
    startBracket: metrics.nativeWindow.profilerStartBracket,
    stopBracket: metrics.nativeWindow.profilerStopBracket,
    attribution:
      'Raw sampled stacks and exact loaded sources retained. No automatic fine CPU cause attribution; invalid clocks/unmapped script IDs remain unknown.',
  };
  record.trace = { raw: transport, converted: converted.output };
  controller.signal.throwIfAborted();
  record.complete = true;
} catch (error) {
  failure = error;
  record.failure = String(error);
} finally {
  clearTimeout(deadline);
  failure = await persistCallbackManifest(
    'test-results/spn146-window-analysis.json',
    record,
    failure,
  );
}
if (failure) throw failure;
console.log(
  JSON.stringify({ complete: record.complete, disposition: record.analysis.disposition }),
);
