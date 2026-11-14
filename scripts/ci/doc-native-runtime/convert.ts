import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { convertDocCallbackTrace } from '../../../e2e/doc-responsiveness-callback-converter.ts';
import { persistCallbackManifest } from '../../../e2e/doc-responsiveness-callback-progress.ts';
import { resourceFailure } from './watchdog.ts';
import { analyzeRuntime, validateRuntimeJournal } from './analysis.ts';
const out = process.env.SPN146_RUNTIME_OUTPUT ?? 'test-results/spn146-native-runtime';
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const controller = new AbortController(),
  deadline = setTimeout(
    () => controller.abort(new Error('Conversion/analysis50second work deadline')),
    50_000,
  );
const record: any = { complete: false, started: performance.now() };
let failure: unknown;
try {
  const observationBytes = await readFile(out + '/observation.json'),
    observation = JSON.parse(observationBytes.toString());
  const progressBytes = await readFile(out + '/progress.json'),
    watchdogBytes = await readFile(out + '/observation-watchdog.json');
  validateRuntimeJournal(observation, JSON.parse(progressBytes.toString()));
  const watchdog = JSON.parse(watchdogBytes.toString());
  assert.equal(watchdog.outcome, 'passed');
  assert.equal(watchdog.failure, null);
  assert.equal(resourceFailure(watchdog), null);
  record.progressSha256 = hash(progressBytes);
  record.observationWatchdogSha256 = hash(watchdogBytes);
  record.observationSha256 = hash(observationBytes);
  assert.equal(observation.complete, true);
  assert.equal(observation.trace.complete, true);
  const stored = await readFile(out + '/runtime.pftrace.gz');
  assert.equal(stored.length, observation.trace.transport.bytes);
  assert.equal(hash(stored), observation.trace.transport.sha256);
  const binary = process.env.DOC_TRACE_PROCESSOR_PATH;
  assert.ok(binary);
  const converted = await convertDocCallbackTrace({
    binary,
    input: out + '/runtime.pftrace.gz',
    identity: observation.trace.transport.transport,
    output: out + '/runtime.trace.json.gz',
    receipt: out + '/conversion.json',
    signal: controller.signal,
    phase: (phase) => {
      record.phase = phase;
    },
  });
  assert.ok(
    converted.output.decoded.bytes <= 128 * 1024 ** 2,
    'Component JSON exceeds128MiB analysis bound',
  );
  const compressed = await readFile(out + '/runtime.trace.json.gz');
  assert.equal(hash(compressed), converted.output.sha256);
  const decoded = gunzipSync(compressed, { maxOutputLength: 128 * 1024 ** 2 });
  assert.equal(decoded.length, converted.output.decoded.bytes);
  assert.equal(hash(decoded), converted.output.decoded.sha256);
  const trace = JSON.parse(decoded.toString());
  assert.ok(Array.isArray(trace.traceEvents));
  record.analysis = analyzeRuntime(observation, trace.traceEvents);
  const profileBytes = await readFile(out + '/runtime.cpuprofile');
  assert.equal(hash(profileBytes), observation.profileSha256);
  const profile = JSON.parse(profileBytes.toString());
  assert.ok(
    Array.isArray(profile.nodes) &&
      Array.isArray(profile.samples) &&
      Array.isArray(profile.timeDeltas),
  );
  assert.equal(profile.samples.length, profile.timeDeltas.length);
  const nodeIds = new Set(profile.nodes.map((node: any) => node.id));
  assert.ok(profile.samples.every((id: number) => nodeIds.has(id)));
  assert.ok(profile.timeDeltas.every((delta: number) => Number.isFinite(delta)));
  record.profile = {
    sha256: hash(profileBytes),
    samples: profile.samples.length,
    negativeDeltas: profile.timeDeltas.filter((delta: number) => delta < 0).length,
    startTime: profile.startTime,
    endTime: profile.endTime,
    startBracket: observation.profilerBracket,
    startBracketWidthMs: observation.profilerBracket.after - observation.profilerBracket.before,
    attribution:
      'No exact CPU-sample cause attribution; trace markers and complete GC intervals own temporal assessment.',
  };
  record.trace = { raw: observation.trace.transport, converted: converted.output };
  controller.signal.throwIfAborted();
  record.complete = true;
  if (record.analysis.disposition !== 'positive-component-result')
    throw new Error('Component result does not satisfy preregistered positive criterion');
} catch (error) {
  failure = error;
  record.failure = String(error);
} finally {
  clearTimeout(deadline);
  record.elapsedMs = performance.now() - record.started;
  record.passed = !failure;
  failure = await persistCallbackManifest(out + '/analysis.json', record, failure);
  if (record.manifestPersistenceError)
    console.error(JSON.stringify({ failure: String(failure), manifestPersistenceError: true }));
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    complete: record.complete,
    disposition: record.analysis.disposition,
    comparisons: record.analysis.comparisons,
    elapsedMs: record.elapsedMs,
  }),
);
