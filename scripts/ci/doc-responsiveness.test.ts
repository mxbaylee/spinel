import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { compositionCpu, DOC_RESPONSIVENESS_BUDGETS } from '../../e2e/doc-responsiveness.ts';
import type { CpuProfile } from '../../e2e/doc-responsiveness.ts';
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
        schema: 2,
        role,
        preset: 'desktop',
        sample,
        attempt: 0,
        source: before ? 'a'.repeat(40) : 'b'.repeat(40),
        completed: true,
        correctness: 'exact content and selections passed',
        errors: [],
        budgetEnforced: !before && sample !== 'profile',
        fixture: {
          paragraphs: 16,
          typedCharacters: 2071,
          enterKeys: 15,
          nativeTextLength: 2088,
          sha256: 'c'.repeat(64),
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
          endedAt: keys.at(-1)! + 350,
          keydownAt: keys,
          keyToFrameMs: keys.map(() => (before ? 24 : 16)),
          longTasks: structuredClone(before ? longTasks : [{ startedAt: 2000, durationMs: 80 }]),
        },
        native: {
          unitId: 'fixture',
          mobile: false,
          observedAt: keys.at(-1)! + 400,
          pending: { history: 0, collaboration: 0 },
          highWater: { history: before ? 2086 : 64, collaboration: before ? 2086 : 64 },
          flushes: before
            ? []
            : [
                {
                  reason: 'capacity',
                  startedAt: 2000,
                  durationMs: 4,
                  history: 64,
                  collaboration: 64,
                },
              ],
          history: { undos: before ? 1 : 33, redos: 0 },
          selection: { start: 2086, end: 2086 },
        },
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
