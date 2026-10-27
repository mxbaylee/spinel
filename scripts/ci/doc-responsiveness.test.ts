import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  compositionCpu,
  DOC_RESPONSIVENESS_BUDGETS,
  DOC_RESPONSIVENESS_GROUP_LIMIT,
} from '../../e2e/doc-responsiveness.ts';
import type { CpuProfile, DocIntegritySnapshot } from '../../e2e/doc-responsiveness.ts';
import { compareDocResponsiveness } from './doc-responsiveness.ts';
import type { BenchmarkArtifact, BenchmarkMetrics } from './doc-responsiveness.ts';

function profile(): CpuProfile {
  return {
    startTime: 1_000_000,
    endTime: 13_000_000,
    nodes: [
      { id: 1, callFrame: { functionName: '(root)' }, children: [2, 3] },
      { id: 2, callFrame: { functionName: '_pushHistory' } },
      { id: 3, callFrame: { functionName: '_emitChangeState' } },
    ],
    samples: [1, 2, 1, 3],
    timeDeltas: [2_000_000, 1_000_000, 7_000_000, 1_000_000],
  };
}

const clock = { beforeMs: 100, afterMs: 101 };
const longTasks = [
  { startedAt: 2000, durationMs: 7000 },
  { startedAt: 10_000, durationMs: 8000 },
];
const text =
  Array.from(
    { length: 16 },
    (_, index) =>
      `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
      'Keep the original page size and all of this text when navigating.',
  ).join('\r') + '\r\n';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function integrity(
  value: BenchmarkMetrics,
  content: string,
  observedAt: number,
  undos: number,
  redos: number,
  revision: number,
): DocIntegritySnapshot {
  const body = { textLength: content.length, textSha256: hash(content) };
  const native = {
    ...body,
    unitId: value.native.unitId,
    observedAt: observedAt - 1,
    pending: { history: 0, collaboration: 0 },
    highWater: { ...value.native.highWater },
  };
  return {
    observedAt,
    sender: {
      ...native,
      selection: { start: content.length - 2, end: content.length - 2 },
      history: { undos, redos },
    },
    peer: { ...native, selection: { start: 0, end: 0 }, history: { undos: 0, redos: 0 } },
    saved: { ...body, revision },
  };
}

function capacityRefusal(value: BenchmarkMetrics) {
  value.undoRedo!.outcome = 'baseline-capacity-refusal';
  value.undoRedo!.reloads = [
    {
      surface: 'sender',
      unitId: value.native.unitId,
      reason: 'capacity',
      clean: false,
      observedAt: 22_150,
      sourceObservedAt: 22_150,
      sourceTimeOrigin: value.input.timeOrigin,
    },
  ];
  value.undoRedo!.recoveredAt = 22_250;
  value.undoRedo!.final = integrity(value, '\r\n', 22_300, 0, 0, 3);
  value.undoRedo!.final.sender.highWater = { history: 0, collaboration: 0 };
  value.finalReloads = structuredClone(value.undoRedo!.reloads);
}

test('a reducer witness requires its complete uncertain sample interval inside a whole task', () => {
  const certain = compositionCpu(profile(), clock, longTasks);
  assert.equal(certain.history.sampleCount, 1);
  assert.equal(certain.history.sampledCpuMs, 1000);
  assert.equal(certain.history.maxContainingTaskMs, 7000);
  assert.equal(certain.collaboration.maxContainingTaskMs, 8000);
  const uncertain = compositionCpu(profile(), { beforeMs: 100, afterMs: 20_000 }, longTasks);
  assert.equal(uncertain.history.status, 'sampled');
  assert.equal(uncertain.history.maxContainingTaskMs, null);
  assert.equal(uncertain.collaboration.maxContainingTaskMs, null);
  assert.throws(
    () => compositionCpu(profile(), { beforeMs: 2, afterMs: 1 }, longTasks),
    /clock bracket/,
  );
});

test('signed CPU deltas keep sample IDs paired with cumulative timestamps without changing raw data', () => {
  const raw = profile();
  raw.endTime = raw.startTime + 10_000;
  raw.samples = [1, 1, 2, 3, 1];
  // The history sample is at +7 ms and collaboration at +4 ms. Sorting only
  // timestamps would incorrectly put the history ID at +6 ms instead.
  raw.timeDeltas = [2000, 4000, 1000, -3000, 5000];
  const original = JSON.stringify(raw);
  const tasks = [
    { startedAt: 102, durationMs: 3 },
    { startedAt: 106, durationMs: 2 },
  ];
  const result = compositionCpu(raw, { beforeMs: 100, afterMs: 100.1 }, tasks);
  assert.equal(result.negativeDeltaCount, 1);
  assert.equal(result.reorderedSampleCount, 3);
  assert.equal(result.history.sampleCount, 1);
  assert.equal(result.history.sampledCpuMs, 1);
  assert.deepEqual(result.history.certainContainingTasks, [
    { index: 1, ...tasks[1], sampleCount: 1 },
  ]);
  assert.equal(result.collaboration.sampleCount, 1);
  assert.equal(result.collaboration.sampledCpuMs, 2);
  assert.deepEqual(result.collaboration.certainContainingTasks, [
    { index: 0, ...tasks[0], sampleCount: 1 },
  ]);
  assert.equal(JSON.stringify(raw), original);

  // Reordering does not waive full interval containment or clock uncertainty.
  const uncertain = compositionCpu(raw, { beforeMs: 100, afterMs: 110 }, tasks);
  assert.equal(uncertain.history.maxContainingTaskMs, null);
  assert.equal(uncertain.collaboration.maxContainingTaskMs, null);
  const pointOnly = compositionCpu(raw, { beforeMs: 100, afterMs: 100.1 }, [
    { startedAt: 106.5, durationMs: 1 },
  ]);
  assert.equal(pointOnly.history.maxContainingTaskMs, null);
  assert.equal(JSON.stringify(raw), original);
});

test('equal CPU timestamps keep their original sample order after a signed-delta inversion', () => {
  const raw = profile();
  raw.endTime = raw.startTime + 4000;
  raw.samples = [1, 2, 3, 1];
  raw.timeDeltas = [1000, 2000, 0, -1000];
  const result = compositionCpu(raw, clock, []);
  assert.equal(result.negativeDeltaCount, 1);
  assert.equal(result.reorderedSampleCount, 3);
  assert.equal(result.history.sampledCpuMs, 1);
  assert.equal(result.collaboration.sampledCpuMs, 0);
  assert.equal(result.collaboration.status, 'sampled');
});

test('every cumulative CPU timestamp must stay inside the profile, even if its final sum is valid', () => {
  for (const deltas of [
    [2000, -3000, 3000, 2000],
    [2000, 9000, -3000, 1000],
  ]) {
    const raw = profile();
    raw.endTime = raw.startTime + 10_000;
    raw.timeDeltas = deltas;
    const original = JSON.stringify(raw);
    assert.throws(() => compositionCpu(raw, clock, []), /timestamp outside the profile time range/);
    assert.equal(JSON.stringify(raw), original);
  }
});

test('nonfinite CPU deltas and malformed sample associations remain unavailable', () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const raw = profile();
    raw.timeDeltas![2] = invalid;
    assert.throws(() => compositionCpu(raw, clock, []), /invalid samples or clock bracket/);
  }
  const mismatched = profile();
  mismatched.timeDeltas!.pop();
  assert.throws(() => compositionCpu(mismatched, clock, []), /invalid samples or clock bracket/);
  const unknownSample = profile();
  unknownSample.samples![1] = 999;
  assert.throws(() => compositionCpu(unknownSample, clock, []), /invalid profile call tree/);
});

test('missing reducer names are unavailable, never zero-time improvements', () => {
  const raw = profile();
  raw.nodes[1]!.callFrame.functionName = 'unknown';
  const value = compositionCpu(raw, clock, longTasks);
  assert.equal(value.history.status, 'unavailable');
  assert.equal(value.history.reason, 'function-not-found');
  assert.equal(value.history.sampledCpuMs, null);
  assert.equal(value.history.maxContainingTaskMs, null);
});

function attachProfile(artifact: BenchmarkArtifact, raw = profile()) {
  const hash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  artifact.profile = raw;
  artifact.metrics.profilerStartBracket = { ...clock };
  artifact.metrics.profileSha256 = hash;
  artifact.profileBytesSha256 = hash;
  artifact.profileClock = {
    bracket: { ...clock },
    profileStartTimeUs: raw.startTime,
    profileEndTimeUs: raw.endTime,
    sha256: hash,
  };
}

function fixture() {
  const create = (role: BenchmarkMetrics['role']) =>
    (['plain-1', 'plain-2', 'plain-3', 'profile'] as const).map((sample): BenchmarkArtifact => {
      const before = role === 'baseline-observation';
      const keys = Array.from({ length: 2086 }, (_, index) => 100 + index * 10);
      const metrics: BenchmarkMetrics = {
        schema: 3,
        role,
        preset: 'desktop',
        sample,
        attempt: 0,
        source: before ? 'a'.repeat(40) : 'b'.repeat(40),
        completed: true,
        timingComplete: true,
        timingCompleteAt: 21_500,
        reloadObservers: ['sender', 'peer'].map((surface) => ({
          surface: surface as 'sender' | 'peer',
          installedAt: 0,
          sourceInstalledAt: 0,
          sourceTimeOrigin: 1_000_000,
          dropped: 0,
          malformed: 0,
        })),
        finalReloads: [],
        errors: [],
        budgetEnforced: !before && sample !== 'profile',
        fixture: {
          paragraphs: 16,
          typedCharacters: 2071,
          enterKeys: 15,
          nativeTextLength: 2088,
          sha256: hash(text),
        },
        harnessSha256: Object.fromEntries(
          [
            'e2e/doc-responsiveness.ts',
            'e2e/doc-responsiveness.spec.ts',
            'e2e/doc-responsiveness-fixture.ts',
            'e2e/doc-responsiveness-boundaries.ts',
            'playwright.config.ts',
            'package-lock.json',
          ].map((path) => [path, 'd'.repeat(64)]),
        ),
        browser: '156.0.0',
        playwright: '1.64.1',
        runtime: 'v26.12.1',
        system: { cpu: 'paired-test-cpu' },
        runner: { name: 'same-runner' },
        browserEnvironment: {
          configured: {
            viewport: { width: 1440, height: 1000 },
            isMobile: false,
            hasTouch: false,
            deviceScaleFactor: 1,
          },
          observed: {
            viewport: { width: 1440, height: 1000 },
            screen: { width: 1440, height: 1000 },
            devicePixelRatio: 1,
            coarsePointer: false,
            touchEvent: false,
            maxTouchPoints: 0,
            userAgent: 'test',
          },
        },
        instrumentation: {
          profiler: sample === 'profile',
          cpuThrottle: 1,
          longTaskObserver: true,
          perKeyRequestAnimationFrame: true,
          playwrightTrace: false,
          perMutationSnapshot: false,
          physicalDevice: false,
        },
        budgets: { ...DOC_RESPONSIVENESS_BUDGETS.desktop },
        typingWallMs: (before ? 20_000 : 10_000) + (sample === 'profile' ? 500 : 0),
        input: {
          timeOrigin: 1_000_000,
          startedAt: 0,
          endedAt: keys.at(-1)! + 450,
          keydownAt: keys,
          keyToFrameMs: keys.map(() => (before ? 24 : 16)),
          longTasks: structuredClone(before ? longTasks : [{ startedAt: 2000, durationMs: 80 }]),
        },
        native: {
          unitId: 'fixture',
          mobile: false,
          observedAt: keys.at(-1)! + 500,
          pending: { history: 0, collaboration: 0 },
          highWater: {
            history: before ? 2086 : DOC_RESPONSIVENESS_GROUP_LIMIT,
            collaboration: before ? 2086 : DOC_RESPONSIVENESS_GROUP_LIMIT,
          },
          flushes: before
            ? []
            : [
                {
                  reason: 'capacity',
                  startedAt: 2000,
                  durationMs: 4,
                  history: DOC_RESPONSIVENESS_GROUP_LIMIT,
                  collaboration: DOC_RESPONSIVENESS_GROUP_LIMIT,
                },
              ],
          history: { undos: before ? 1 : 48, redos: 0 },
          selection: { start: 2086, end: 2086 },
        },
      };
      const groups = metrics.native.history.undos;
      const count = sample === 'plain-1' ? groups : 1;
      const firstText = before
        ? '\r\n'
        : text.slice(0, (groups - 1) * DOC_RESPONSIVENESS_GROUP_LIMIT) + '\r\n';
      metrics.preUndoIntegrity = {
        ...integrity(metrics, text, 21_600, groups, 0, 1),
        passed: true,
        reloads: [],
      };
      metrics.undoRedo = {
        outcome: 'passed',
        requestedGroups: count,
        beforeUndoAt: 21_700,
        afterUndoAt: 22_000,
        beforeRedoAt: 22_100,
        afterRedoAt: 22_200,
        finalObservedAt: 22_300,
        firstUndo: integrity(metrics, firstText, 21_800, groups - 1, 1, 2),
        undo: integrity(
          metrics,
          sample === 'plain-1' ? '\r\n' : firstText,
          21_900,
          groups - count,
          count,
          3,
        ),
        final: integrity(metrics, text, 22_300, groups, 0, 4),
        reloads: [],
      };
      const artifact: BenchmarkArtifact = { metrics };
      if (sample === 'profile') attachProfile(artifact);
      return artifact;
    });
  return { baseline: create('baseline-observation'), candidate: create('candidate') };
}

test('paired proof uses the worst entire candidate task and each certain baseline family witness', () => {
  const f = fixture();
  const result = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.improvement.history!.baselineContainingTaskMs, 7000);
  assert.equal(result.improvement.collaboration!.baselineContainingTaskMs, 8000);
  assert.equal(result.improvement.history!.candidateEntireTaskUpperBoundMs, 80);
  assert.equal(result.improvement.history!.reductionPercent, 100 * (1 - 80 / 7000));
  assert.equal(result.candidateGroupLimit, 44);
});

test('a superseded candidate capacity cannot pass on fast timing alone', () => {
  const f = fixture();
  for (const { metrics } of f.candidate) {
    metrics.native.highWater = { history: 64, collaboration: 64 };
    metrics.native.flushes[0]!.history = 64;
    metrics.native.flushes[0]!.collaboration = 64;
  }
  assert.equal(compareDocResponsiveness(f.baseline, f.candidate, 'desktop').passed, false);
});

test('schema 3 labels the specifically observed baseline redo defect without weakening candidate integrity', () => {
  const f = fixture();
  for (const { metrics } of f.baseline) capacityRefusal(metrics);
  const result = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.timingValid, true);
  assert.equal(result.candidateIntegrity, true);
  assert.ok(
    result.baselineRedoOutcome.every(
      (entry) => entry.outcome === 'baseline-capacity-refusal' && entry.integrityEvidenceValid,
    ),
  );
  capacityRefusal(f.candidate[0]!.metrics);
  const rejected = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
  assert.equal(rejected.passed, false);
  assert.equal(rejected.candidateIntegrity, false);
});

test('baseline exceptions require the exact reason, unit, phase, recovery and complete reload record', () => {
  for (const mutate of [
    (m: BenchmarkMetrics) => {
      m.undoRedo!.reloads[0]!.reason = 'malformed';
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.reloads[0]!.unitId = 'other';
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.reloads[0]!.surface = 'peer';
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.reloads[0]!.clean = true;
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.reloads[0]!.observedAt = 20_000;
      m.undoRedo!.reloads[0]!.sourceObservedAt = 20_000;
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.reloads = [];
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.reloads.push({ ...m.undoRedo!.reloads[0]! });
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.final.saved.textSha256 = hash(text);
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.final.saved.revision++;
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.undo.sender.history.redos = 0;
    },
    (m: BenchmarkMetrics) => {
      m.timingCompleteAt = 22_150;
    },
  ]) {
    const f = fixture();
    const value = f.baseline[0]!.metrics;
    capacityRefusal(value);
    mutate(value);
    assert.equal(compareDocResponsiveness(f.baseline, f.candidate, 'desktop').passed, false);
  }
});

test('legacy success strings, failed schema-2 records and incomplete full-group replay cannot be accepted', () => {
  for (const mutate of [
    (m: BenchmarkMetrics) => {
      m.schema = 2;
    },
    (m: BenchmarkMetrics) => {
      delete m.preUndoIntegrity;
    },
    (m: BenchmarkMetrics) => {
      delete m.undoRedo;
    },
    (m: BenchmarkMetrics) => {
      m.timingComplete = false;
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.requestedGroups = 1;
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.final.peer.textSha256 = hash('\r\n');
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.firstUndo.sender.selection!.start--;
    },
    (m: BenchmarkMetrics) => {
      m.reloadObservers![0]!.dropped = 1;
    },
    (m: BenchmarkMetrics) => {
      m.reloadObservers![1]!.malformed = 1;
    },
    (m: BenchmarkMetrics) => {
      m.reloadObservers![0]!.installedAt = 22_000;
    },
    (m: BenchmarkMetrics) => {
      delete m.finalReloads;
    },
  ]) {
    const f = fixture();
    mutate(f.candidate[0]!.metrics);
    assert.equal(compareDocResponsiveness(f.baseline, f.candidate, 'desktop').passed, false);
  }
});

test('stale native snapshots and post-measurement tasks cannot supply an accepted timing window', () => {
  for (const mutate of [
    (m: BenchmarkMetrics) => {
      m.preUndoIntegrity!.sender.textSha256 = hash('wrong');
    },
    (m: BenchmarkMetrics) => {
      m.preUndoIntegrity!.sender.observedAt = 20_000;
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.firstUndo.peer.observedAt = 20_000;
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.undo.sender.observedAt = 20_000;
    },
    (m: BenchmarkMetrics) => {
      m.undoRedo!.final.peer.observedAt = 20_000;
    },
    (m: BenchmarkMetrics) => {
      m.input.longTasks.push({ startedAt: 30_000, durationMs: 8000 });
    },
    (m: BenchmarkMetrics) => {
      m.input.keyToFrameMs[2085] = 10_000;
    },
    (m: BenchmarkMetrics) => {
      m.input.startedAt = m.input.endedAt + 1;
    },
  ]) {
    const f = fixture();
    mutate(f.baseline[0]!.metrics);
    const result = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
    assert.equal(result.passed, false);
    assert.equal(result.timingValid, false);
  }
});

test('an expensive profiled candidate cannot hide behind three fast plain samples', () => {
  const f = fixture();
  f.candidate[3]!.metrics.input.longTasks.push({ startedAt: 10_000, durationMs: 3000 });
  const result = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((reason) => reason.includes('below 90%')));
});

test('a profile-only stall or one short plain baseline cannot prove unprofiled improvement', () => {
  for (const durations of [
    [0, 0, 0],
    [7000, 800, 8000],
  ]) {
    const f = fixture();
    for (const [index, durationMs] of durations.entries())
      f.baseline[index]!.metrics.input.longTasks = durationMs
        ? [{ startedAt: 2000, durationMs }]
        : [];
    const result = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
    assert.equal(result.status, 'needs-evidence');
    assert.equal(result.passed, false);
    assert.equal(result.improvement.history!.baselineContainingTaskMs, 7000);
    assert.equal(result.unprofiledImprovement.conservativeAggregateReductionPercent, null);
    assert.ok(
      result.unavailable.some((reason) => reason.includes('unprofiled whole-browser task')),
    );
  }
});

test('each plain baseline must improve by 90%, and the aggregate uses its smallest maximum', () => {
  const f = fixture();
  for (const [index, durationMs] of [1100, 7000, 8000].entries())
    f.baseline[index]!.metrics.input.longTasks = [{ startedAt: 2000, durationMs }];
  f.candidate[3]!.metrics.input.longTasks = [{ startedAt: 2000, durationMs: 150 }];
  const result = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
  assert.equal(result.status, 'failed');
  assert.equal(result.passed, false);
  assert.ok(
    result.failures.some((reason) =>
      reason.includes('plain-1: unprofiled whole-browser longest-task reduction is below 90%'),
    ),
  );
  assert.equal(
    result.unprofiledImprovement.conservativeAggregateReductionPercent,
    100 * (1 - 150 / 1100),
  );
  assert.deepEqual(
    result.unprofiledImprovement.samples.map((sample) => sample.reductionPercent),
    [1100, 7000, 8000].map((durationMs) => 100 * (1 - 150 / durationMs)),
  );
  assert.ok(result.improvement.history!.reductionPercent! >= 90);
});

test('missing baseline attribution blocks proof while candidate absence uses an explicit conservative bound', () => {
  const f = fixture();
  const renamed = profile();
  renamed.nodes[1]!.callFrame.functionName = 'unknown-history';
  renamed.nodes[2]!.callFrame.functionName = 'unknown-collaboration';
  attachProfile(f.candidate[3]!, renamed);
  const candidateMissing = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
  assert.equal(candidateMissing.passed, true, JSON.stringify(candidateMissing));
  assert.equal(
    candidateMissing.improvement.history!.candidateAttribution,
    'public-paired-flush-bound-and-entire-task-upper-bound',
  );
  assert.equal(candidateMissing.composition.candidate?.history.sampledCpuMs, null);
  attachProfile(f.baseline[3]!, renamed);
  const baselineMissing = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
  assert.equal(baselineMissing.passed, false);
  assert.equal(baselineMissing.status, 'needs-evidence');
  assert.equal(baselineMissing.improvement.history!.reductionPercent, null);
});

test('a small baseline is reported without inventing a percentage or a reproduced stall', () => {
  const f = fixture();
  const raw = profile();
  raw.timeDeltas = [2_000_000, 100_000, 7_900_000, 100_000];
  attachProfile(f.baseline[3]!, raw);
  f.baseline[3]!.metrics.input.longTasks = [
    { startedAt: 2050, durationMs: 700 },
    { startedAt: 10_050, durationMs: 800 },
  ];
  const result = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
  assert.equal(result.passed, false);
  assert.equal(result.status, 'needs-evidence');
  assert.equal(result.improvement.history!.reductionPercent, null);
  assert.ok(result.unavailable.some((reason) => reason.includes('No >1,000 ms')));
});

test('the 50 ms long-task reporting floor is not misreported as zero candidate work', () => {
  const f = fixture();
  for (const artifact of f.candidate) artifact.metrics.input.longTasks = [];
  const result = compareDocResponsiveness(f.baseline, f.candidate, 'desktop');
  assert.equal(result.passed, true);
  assert.equal(result.improvement.history!.candidateEntireTaskUpperBoundMs, 50);
  assert.ok(result.improvement.history!.reductionPercent! < 100);
});

test('mismatched lockfiles, incomplete samples and raw profile tampering each block acceptance', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.candidate[0]!.metrics.harnessSha256['package-lock.json'] = 'f'.repeat(64);
    },
    (f: ReturnType<typeof fixture>) => {
      f.candidate.pop();
    },
    (f: ReturnType<typeof fixture>) => {
      f.baseline[3]!.profileBytesSha256 = 'f'.repeat(64);
    },
    (f: ReturnType<typeof fixture>) => {
      f.candidate[1]!.metrics.source = 'c'.repeat(40);
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(compareDocResponsiveness(f.baseline, f.candidate, 'desktop').passed, false);
  }
});
