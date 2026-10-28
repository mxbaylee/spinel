import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeDocCallbackLifetimes, DOC_CALLBACK_MARKERS } from './doc-callback-lifetimes.ts';
import type { DocCallbackTraceInput } from './doc-callback-lifetimes.ts';

const point = (columnNumber: number) => ({
  url: 'https://spinel.test/assets/exact-build.js',
  lineNumber: 12,
  columnNumber,
});
const marker = (phase: keyof typeof DOC_CALLBACK_MARKERS, ts: number) => ({
  name: DOC_CALLBACK_MARKERS[phase],
  cat: 'blink.user_timing',
  ph: 'I',
  pid: 2,
  tid: 3,
  ts,
});
const install = (
  timerId: number,
  ts: number,
  column: number,
  singleShot = true,
  timeout = 500,
) => ({
  name: 'TimerInstall',
  ph: 'I',
  pid: 2,
  tid: 3,
  ts,
  args: { data: { timerId, frame: 'doc-frame', singleShot, timeout, stackTrace: [point(column)] } },
});
const fire = (timerId: number, ts: number, dur = 10) => ({
  name: 'TimerFire',
  ph: 'X',
  pid: 2,
  tid: 3,
  ts,
  dur,
  args: { data: { timerId, frame: 'doc-frame' } },
});
const remove = (timerId: number, ts: number, column = 10) => ({
  name: 'TimerRemove',
  ph: 'I',
  pid: 2,
  tid: 3,
  ts,
  args: { data: { timerId, frame: 'doc-frame', stackTrace: [point(column)] } },
});
const fn = (column: number, ts: number, dur: number) => ({
  name: 'FunctionCall',
  ph: 'X',
  pid: 2,
  tid: 3,
  ts,
  dur,
  args: { data: { ...point(column), frame: 'doc-frame' } },
});
const task = (ts: number, dur: number) => ({
  name: 'ThreadControllerImpl::RunTask',
  ph: 'X',
  pid: 2,
  tid: 3,
  ts,
  dur,
});

function fixture(): DocCallbackTraceInput {
  return {
    frameId: 'doc-frame',
    role: 'candidate',
    completion: { dataLossOccurred: false },
    callsites: [
      { ...point(10), family: 'cursor' },
      { ...point(20), family: 'cursor' },
      { ...point(30), family: 'cursor' },
      { ...point(40), family: 'zoom-init' },
      { ...point(50), family: 'zoom-update' },
      { ...point(60), family: 'other' },
    ],
    traceEvents: [
      marker('beforeMount', 1000),
      marker('inputStart', 10_000),
      marker('finalKey', 300_000),
      marker('disposed', 2_000_000),
      marker('end', 3_001_000),
      install(1, 2000, 10),
      install(2, 2001, 20, false, 1000),
      install(3, 2100, 40, true, 20),
      install(4, 2200, 50, true, 0),
      fire(4, 2300),
      fire(3, 22_000),
      fire(1, 502_000),
      fire(2, 1_002_001, 50),
      install(5, 1_002_010, 30),
      fire(5, 1_502_010),
      remove(2, 1_900_000),
      task(900, 1000),
      task(300_000, 20_000),
      task(310_000, 20_000),
      task(1_999_900, 200),
    ],
  };
}

test('accounts for initial/nested hides, retained intervals, source attribution and complete cleanup', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.complete, true, result.evidenceFailures.join('\n'));
  assert.equal(result.accepted, true, result.candidateViolations.join('\n'));
  assert.equal(result.bounded, true);
  assert.equal(result.ledger.length, 5);
  assert.equal(result.families.cursor.installations, 3);
  assert.equal(result.families.cursor.firings, 3);
  assert.equal(result.families.cursor.oneShotFirings, 2);
  assert.equal(result.families.cursor.intervalFirings, 1);
  assert.equal(result.families.cursor.removals, 1);
  assert.equal(result.families.cursor.pendingHighWater, 2);
  assert.equal(result.families.cursor.pendingAt.finalKey, 2);
  assert.equal(result.families.cursor.pendingAt.disposed, 0);
  assert.equal(result.ledger.find((entry) => entry.timerId === 2)?.retiredBy, 'remove');
  assert.equal(result.families.cursor.callbacksAfterDisposal, 0);
  assert.equal(
    JSON.stringify(input),
    before,
    'Analysis must not rewrite raw trace or supplied attribution.',
  );
});

test('a repeating timer remains pending across every fire until it is removed', () => {
  const input = fixture();
  input.traceEvents.push(fire(2, 1_800_000));
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.accepted, true);
  const interval = result.ledger.find((entry) => entry.timerId === 2)!;
  assert.equal(interval.fires.length, 2);
  assert.equal(interval.retiredAtUs, 1_900_000);
  assert.equal(result.families.cursor.intervalFirings, 2);
});

test('reuse after retirement creates a new generation without confusing another frame or thread', () => {
  const input = fixture();
  input.traceEvents.push(install(1, 700_000, 10), remove(1, 700_100));
  const otherFrame = install(1, 710_000, 10);
  otherFrame.args.data.frame = 'peer-frame';
  input.traceEvents.push(otherFrame, { ...install(2, 720_000, 20, false), pid: 4, tid: 5 });
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.accepted, true);
  assert.deepEqual(
    result.ledger.filter((entry) => entry.timerId === 1).map((entry) => entry.generation),
    [1, 2],
  );
  assert.equal(result.ignoredOtherFrames, 1);
});

test('a duplicate installation never erases evidence of an unretired generation', () => {
  const input = fixture();
  input.traceEvents.push(install(2, 700_000, 20, false, 1000));
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.complete, false);
  assert.equal(result.accepted, false);
  assert.match(result.evidenceFailures.join('\n'), /preceding generation was pending/);
  assert.equal(result.ledger.filter((entry) => entry.timerId === 2).length, 2);
  assert.equal(result.families.cursor.pendingAtTraceEnd, 1);
});

test('repeated removals and clearing an already fired one-shot do not make pending counts negative', () => {
  const input = fixture();
  input.traceEvents.push(remove(1, 700_000), remove(2, 1_910_000), remove(2, 1_920_000));
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.accepted, true);
  assert.equal(result.families.cursor.duplicateRemovals, 3);
  assert.equal(result.families.cursor.pendingAtTraceEnd, 0);
});

test('retains nonpositive no-op clears without creating or retiring timer lifetimes', () => {
  const input = fixture();
  const original = analyzeDocCallbackLifetimes(input);
  // Chrome records native zoom's unset handle (0) and renderer sentinels (-1).
  // Neither is a possible live timer ID under the HTML timer contract.
  input.traceEvents.push(remove(0, 1800, 50), remove(-1, 2500, 60), remove(0, 2_500_000, 10));
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.accepted, true, result.evidenceFailures.join('\n'));
  assert.deepEqual(result.ledger, original.ledger);
  assert.deepEqual(result.families, original.families);
  assert.deepEqual(result.orphans, []);
  assert.deepEqual(
    result.noOpRemovals.map(({ timerId, family, frame, pid, tid }) => ({
      timerId,
      family,
      frame,
      pid,
      tid,
    })),
    [
      { timerId: 0, family: 'zoom-update', frame: 'doc-frame', pid: 2, tid: 3 },
      { timerId: -1, family: 'other', frame: 'doc-frame', pid: 2, tid: 3 },
      { timerId: 0, family: 'cursor', frame: 'doc-frame', pid: 2, tid: 3 },
    ],
  );
});

test('no-op clear accounting does not excuse invalid identities, unknown sources or positive orphans', () => {
  const invalid = [
    install(0, 2500, 10),
    install(-1, 2500, 10),
    fire(0, 2500),
    fire(-1, 2500),
    remove(-0.5, 2500, 60),
    remove(Number.NEGATIVE_INFINITY, 2500, 60),
    { ...remove(0, 2500, 50), ph: 'X' },
    { ...remove(-1, 2500, 60), args: { data: { timerId: -1, stackTrace: [point(60)] } } },
    { ...remove(0, 2500, 50), pid: undefined },
    remove(0, 2500, 777),
    remove(-1, 2500, 777),
    remove(90, 2500, 50),
  ];
  for (const event of invalid) {
    const input = fixture();
    input.traceEvents.push(event);
    const result = analyzeDocCallbackLifetimes(input);
    assert.equal(result.complete, false, JSON.stringify(event));
    assert.equal(result.accepted, false, JSON.stringify(event));
  }
});

test('callback attribution uses the install top callsite, not delay or any ancestor function', () => {
  const input = fixture();
  const unrelated = install(9, 500, 60, false, 1000);
  unrelated.args.data.stackTrace.push(point(10));
  input.traceEvents.push(unrelated, remove(9, 800));
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.accepted, true);
  assert.equal(result.unrelatedTimers, 1);
  assert.equal(result.families.cursor.installations, 3);
});

test('pre-mount target work and unknown install source block complete attribution', () => {
  for (const event of [install(9, 500, 10), install(9, 2500, 777)]) {
    const input = fixture();
    input.traceEvents.push(event, remove(9, 700_000));
    const result = analyzeDocCallbackLifetimes(input);
    assert.equal(result.complete, false);
    assert.match(
      result.evidenceFailures.join('\n'),
      /before the declared|unknown source attribution/,
    );
  }
});

test('unpaired target and unknown callback fires remain incomplete, including retired target reuse', () => {
  for (const [timerId, column] of [
    [90, 10],
    [91, 777],
    [1, 60],
  ]) {
    const input = fixture();
    input.traceEvents.push(fire(timerId!, 800_000, 100), fn(column!, 800_001, 98));
    const result = analyzeDocCallbackLifetimes(input);
    assert.equal(result.complete, false);
    assert.equal(result.orphans.length, 1);
    assert.match(result.evidenceFailures.join('\n'), /no pending installation/);
  }
});

test('proven unrelated orphan shell timers remain visible without masking target ownership', () => {
  const input = fixture();
  input.traceEvents.push(fire(90, 800_000, 100), fn(60, 800_001, 98), remove(91, 800_200, 60));
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.accepted, true);
  assert.equal(result.orphans.length, 2);
  assert.deepEqual(
    result.orphans.map((entry) => entry.family),
    ['other', 'other'],
  );
  const unknown = fixture();
  unknown.traceEvents.push(remove(92, 800_200, 777));
  assert.equal(analyzeDocCallbackLifetimes(unknown).complete, false);
});

test('does not classify an orphan by a nested unrelated call when the outer callback is unknown', () => {
  const input = fixture();
  input.traceEvents.push(fire(90, 800_000, 100), fn(777, 800_001, 98), fn(60, 800_005, 20));
  assert.equal(analyzeDocCallbackLifetimes(input).complete, false);
});

test('baseline observations expose the same structural violations without claiming bounded success', () => {
  const input = fixture();
  for (let index = 0; index < 5; index++)
    input.traceEvents.push(
      install(100 + index, 20_000 + index, 10),
      remove(100 + index, 800_000 + index),
    );
  const candidate = analyzeDocCallbackLifetimes(input);
  assert.equal(candidate.complete, true);
  assert.equal(candidate.accepted, false);
  assert.match(candidate.candidateViolations.join('\n'), /cursor pending high-water 7 exceeds 4/);
  input.role = 'baselineObservation';
  const baseline = analyzeDocCallbackLifetimes(input);
  assert.equal(baseline.accepted, true);
  assert.equal(baseline.bounded, false);
  assert.deepEqual(baseline.candidateViolations, candidate.candidateViolations);
});

test('cleanup fails for residual, firing, and newly installed callbacks after disposal even when later cleared', () => {
  const input = fixture();
  input.traceEvents.push(install(100, 1_950_000, 10), fire(100, 2_100_000));
  input.traceEvents.push(install(101, 2_200_000, 50, true, 0), remove(101, 2_200_100));
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.complete, true);
  assert.equal(result.accepted, false);
  assert.equal(result.families.cursor.pendingAt.disposed, 1);
  assert.equal(result.families.cursor.callbacksAfterDisposal, 1);
  assert.equal(result.families['zoom-update'].installationsAfterDisposal, 1);
  assert.match(result.candidateViolations.join('\n'), /retains callbacks|after editor disposal/);
});

test('separate zoom family caps catch queued updates while preserving owned initialization', () => {
  const input = fixture();
  input.traceEvents.push(install(90, 2250, 50, true, 0), remove(90, 2400));
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.complete, true);
  assert.equal(result.accepted, false);
  assert.equal(result.families['zoom-init'].pendingHighWater, 1);
  assert.equal(result.families['zoom-update'].pendingHighWater, 2);
});

test('missing family or interval coverage cannot turn a disabled feature into a pass', () => {
  const input = fixture();
  input.callsites.find((site) => site.columnNumber === 40)!.family = 'other';
  input.callsites.find((site) => site.columnNumber === 20)!.family = 'other';
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.complete, false);
  assert.match(result.evidenceFailures.join('\n'), /zoom-init installations/);
  assert.match(result.evidenceFailures.join('\n'), /repeating blink/);
});

test('trace completion, unique ordered markers, identity and observation duration fail closed', () => {
  const changes: Array<(input: DocCallbackTraceInput) => void> = [
    (input) => {
      input.completion = null;
    },
    (input) => {
      input.completion = { dataLossOccurred: true };
    },
    (input) => {
      input.traceEvents.push(marker('finalKey', 301_000));
    },
    (input) => {
      input.traceEvents = input.traceEvents.filter(
        (event) => (event as { name: string }).name !== DOC_CALLBACK_MARKERS.finalKey,
      );
    },
    (input) => {
      (input.traceEvents[2] as { ts: number }).ts = 1000;
    },
    (input) => {
      (input.traceEvents[3] as { pid: number }).pid = 20;
    },
    (input) => {
      (input.traceEvents[4] as { ts: number }).ts = 2_999_999;
    },
    (input) => {
      (input.traceEvents[2] as { cat: string }).cat = 'unrelated';
    },
    (input) => {
      input.frameId = '';
    },
    (input) => {
      input.callsites.push({ ...point(10), family: 'other' });
    },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.equal(analyzeDocCallbackLifetimes(input).complete, false);
  }
});

test('missing phase boundaries leave derived callback measurements unavailable, never zero', () => {
  const input = fixture();
  const missing = new Set<string>([
    DOC_CALLBACK_MARKERS.finalKey,
    DOC_CALLBACK_MARKERS.disposed,
    DOC_CALLBACK_MARKERS.end,
  ]);
  input.traceEvents = input.traceEvents.filter(
    (event) => !missing.has((event as { name: string }).name),
  );
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.complete, false);
  assert.equal(result.accepted, false);
  for (const family of Object.values(result.families)) {
    assert.equal(family.pendingAt.finalKey, null);
    assert.equal(family.pendingAt.disposed, null);
    assert.equal(family.callbacksAfterFinalKey, null);
    assert.equal(family.callbacksAfterDisposal, null);
    assert.equal(family.installationsAfterDisposal, null);
    assert.equal(family.postInputCallbackWall, null);
    assert.equal(family.postDisposalCallbackWall, null);
  }
  assert.deepEqual(result.candidateViolations, []);
});

test('malformed timer identities, incomplete fires and missing stack frames cannot pass', () => {
  const cases = [
    { ...fire(2, 800_000), dur: undefined },
    { ...fire(2, 800_000), ts: NaN },
    { ...fire(2, 800_000), args: { data: { timerId: 2 } } },
    {
      ...install(90, 800_000, 10),
      args: { data: { timerId: 90, frame: 'doc-frame', singleShot: true, timeout: 500 } },
    },
    { ...install(90, 800_000, 10), ph: 'X' },
  ];
  for (const event of cases) {
    const input = fixture();
    input.traceEvents.push(event);
    assert.equal(analyzeDocCallbackLifetimes(input).complete, false);
  }
});

test('task wall union and clipped tails do not sum overlapping spans or attribute all wall time to callbacks', () => {
  const result = analyzeDocCallbackLifetimes(fixture());
  assert.equal(result.mainThreadTasks.sumMs, 41.2);
  assert.equal(result.mainThreadTasks.unionMs, 31.2);
  assert.equal(result.mainThreadTasks.postInput?.unionMs, 30.1);
  assert.equal(result.mainThreadTasks.postDisposal?.unionMs, 0.1);
  assert.equal(result.families.cursor.directCallbackWall.sumMs, 0.07);
  assert.equal(result.families.cursor.postInputCallbackWall?.sumMs, 0.07);
});

test('retains instantaneous tasks and trace-cutoff tasks without inventing complete measured spans', () => {
  const input = fixture();
  input.traceEvents.push({ ...task(500_000, 0), ph: 'I', dur: undefined });
  input.traceEvents.push({ ...task(3_002_000, 0), ph: 'B', dur: undefined });
  const result = analyzeDocCallbackLifetimes(input);
  assert.equal(result.accepted, true);
  assert.equal(result.mainThreadTasks.instantaneousEvents, 1);
  assert.deepEqual(result.mainThreadTasks.boundaryEvents, [
    { phase: 'unclosed-start', atUs: 3_002_000 },
  ]);
  input.traceEvents.push({ ...task(2_500_000, 0), ph: 'B', dur: undefined });
  assert.equal(analyzeDocCallbackLifetimes(input).complete, false);
  const missing = fixture();
  missing.traceEvents = missing.traceEvents.filter(
    (event) => (event as { name: string }).name !== 'ThreadControllerImpl::RunTask',
  );
  assert.equal(analyzeDocCallbackLifetimes(missing).complete, false);
});
