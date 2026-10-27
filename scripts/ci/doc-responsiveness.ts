import { createHash } from 'node:crypto';
import { glob, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  compositionCpu,
  distribution,
  DOC_RESPONSIVENESS_BUDGETS,
} from '../../e2e/doc-responsiveness.ts';
import type {
  CpuProfile,
  DocResponsivenessEvidence,
  InputObservation,
  ProfilerClockBracket,
} from '../../e2e/doc-responsiveness.ts';

type Preset = keyof typeof DOC_RESPONSIVENESS_BUDGETS;
const samples = ['plain-1', 'plain-2', 'plain-3', 'profile'] as const;

// Rebaseline dependency changes by preserving the old evidence, publishing a new
// immutable pre-policy checkout with the candidate's dependencies/runtime and
// supported compatibility fixes, and updating the workflow's baseline SHA in a
// reviewed PR. Keep the unbounded native behavior and identical harness/lockfile
// checks; never transplant the capacity policy or waive a mismatch. Rerun all
// first-attempt samples. If an upstream release no longer reproduces the stall,
// retain the needs-evidence result for an explicit reviewed protocol decision;
// do not invent a new percentage or silently accept missing attribution.

export interface BenchmarkMetrics {
  schema: number;
  role: 'baseline-observation' | 'candidate';
  preset: Preset;
  sample: (typeof samples)[number];
  attempt: number;
  source: string;
  completed?: boolean;
  correctness?: string;
  errors: unknown[];
  budgetEnforced: boolean;
  fixture: Record<string, unknown>;
  harnessSha256: Record<string, string>;
  browser: string;
  playwright: string;
  runtime: string;
  system: Record<string, unknown>;
  runner: Record<string, unknown>;
  browserEnvironment: Record<string, unknown>;
  instrumentation: Record<string, unknown>;
  budgets: Record<string, number>;
  typingWallMs: number;
  input: InputObservation;
  native: DocResponsivenessEvidence;
  profilerStartBracket?: ProfilerClockBracket;
  profileSha256?: string;
}

export interface BenchmarkArtifact {
  metrics: BenchmarkMetrics;
  profile?: CpuProfile;
  profileBytesSha256?: string;
  profileClock?: {
    bracket: ProfilerClockBracket;
    profileStartTimeUs: number;
    profileEndTimeUs: number;
    sha256: string;
  };
}

const finite = (value: number) => Number.isFinite(value) && value >= 0;
const requiredHashes = [
  'e2e/doc-responsiveness.ts',
  'e2e/doc-responsiveness.spec.ts',
  'e2e/doc-responsiveness-fixture.ts',
  'e2e/doc-responsiveness-boundaries.ts',
  'playwright.config.ts',
  'package-lock.json',
];

/** Recompute gates from raw observations; a cached summary is not proof. */
export function compareDocResponsiveness(
  baseline: BenchmarkArtifact[],
  candidate: BenchmarkArtifact[],
  preset: Preset,
) {
  const failures: string[] = [],
    unavailable: string[] = [];
  const require = (condition: boolean, message: string) => {
    if (!condition) failures.push(message);
  };
  const selected = (artifacts: BenchmarkArtifact[], role: BenchmarkMetrics['role']) => {
    const matching = artifacts.filter((artifact) => artifact.metrics.preset === preset);
    require(matching.length ===
      4, `${role}: expected exactly three plain samples and one profile.`);
    for (const sample of samples)
      require(matching.filter((artifact) => artifact.metrics.sample === sample).length ===
        1, `${role}: missing or duplicated ${sample}.`);
    for (const { metrics } of matching) require(metrics.role === role, `${role}: role mismatch.`);
    require(matching.every(({ metrics }) => /^[a-f0-9]{40}$/.test(metrics.source)) &&
      new Set(matching.map(({ metrics }) => metrics.source)).size ===
        1, `${role}: samples must share one valid immutable source SHA.`);
    return matching;
  };
  const first = selected(baseline, 'baseline-observation'),
    second = selected(candidate, 'candidate');
  const all = [...first, ...second];
  const reference = first[0]?.metrics;
  const summaries: Array<Record<string, unknown>> = [];
  for (const { metrics: value } of all) {
    const label = `${value.role}/${value.sample}`;
    require(value.schema === 2 &&
      value.attempt === 0 &&
      value.completed === true, `${label}: incomplete or repeated attempt.`);
    require(Boolean(value.correctness) &&
      Array.isArray(value.errors) &&
      value.errors.length === 0, `${label}: correctness did not finish successfully.`);
    require(value.fixture.paragraphs === 16 &&
      value.fixture.typedCharacters === 2071 &&
      value.fixture.enterKeys === 15 &&
      value.fixture.nativeTextLength === 2088 &&
      typeof value.fixture.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(value.fixture.sha256), `${label}: canonical workload changed.`);
    const browser = value.browserEnvironment as {
      configured?: {
        viewport?: { width: number; height: number };
        isMobile?: boolean;
        hasTouch?: boolean;
        deviceScaleFactor?: number;
      };
      observed?: {
        viewport?: { width: number; height: number };
        screen?: { width: number; height: number };
        devicePixelRatio?: number;
        coarsePointer?: boolean;
        touchEvent?: boolean;
        maxTouchPoints?: number;
        userAgent?: string;
      };
    };
    const mobile = preset === 'mobile';
    require(browser?.configured?.isMobile === mobile &&
      browser.configured.hasTouch === mobile &&
      browser.configured.deviceScaleFactor === 1 &&
      isDeepStrictEqual(
        browser.configured.viewport,
        mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      ) &&
      browser.observed?.devicePixelRatio === 1 &&
      browser.observed.coarsePointer === mobile &&
      typeof browser.observed.touchEvent === 'boolean' &&
      typeof browser.observed.maxTouchPoints === 'number' &&
      (mobile ? browser.observed.maxTouchPoints > 0 : browser.observed.maxTouchPoints === 0) &&
      Boolean(browser.observed.userAgent) &&
      (browser.observed.viewport?.width ?? 0) > 0 &&
      (browser.observed.viewport?.height ?? 0) > 0 &&
      (browser.observed.screen?.width ?? 0) > 0 &&
      (browser.observed.screen?.height ?? 0) >
        0, `${label}: actual browser viewport, scale, pointer, touch or user agent is unavailable.`);
    require(Boolean(value.browser) &&
      Boolean(value.playwright) &&
      Boolean(value.runtime), `${label}: browser, Playwright or Node version unavailable.`);
    require(requiredHashes.every((path) =>
      /^[a-f0-9]{64}$/.test(value.harnessSha256[path] ?? ''),
    ), `${label}: missing harness or lockfile hash.`);
    for (const field of [
      'fixture',
      'harnessSha256',
      'browser',
      'playwright',
      'runtime',
      'system',
      'runner',
      'browserEnvironment',
      'budgets',
    ] as const) {
      require(value[field] !== undefined &&
        isDeepStrictEqual(
          value[field],
          reference?.[field],
        ), `${label}: ${field} differs from the paired baseline.`);
    }
    require(isDeepStrictEqual(
      value.budgets,
      DOC_RESPONSIVENESS_BUDGETS[preset],
    ), `${label}: preregistered budget changed.`);
    require(isDeepStrictEqual(value.instrumentation, {
      profiler: value.sample === 'profile',
      cpuThrottle: preset === 'mobile' ? 4 : 1,
      longTaskObserver: true,
      perKeyRequestAnimationFrame: true,
      playwrightTrace: false,
      perMutationSnapshot: false,
      physicalDevice: false,
    }), `${label}: instrumentation or CPU throttle changed.`);
    require(value.input.keydownAt.length === 2086 &&
      value.input.keyToFrameMs.length === 2086 &&
      value.input.keydownAt.every(finite) &&
      value.input.keyToFrameMs.every(finite) &&
      value.input.keydownAt.every(
        (at, index, list) => !index || at >= list[index - 1]!,
      ), `${label}: incomplete native input/frame observations.`);
    require(value.input.longTasks.every(
      (task) => finite(task.startedAt) && task.durationMs >= 50 && Number.isFinite(task.durationMs),
    ), `${label}: invalid long-task timeline.`);
    const frame = distribution(value.input.keyToFrameMs);
    const longestTask = Math.max(0, ...value.input.longTasks.map((task) => task.durationMs));
    const flush = value.native.flushes.length
      ? distribution(value.native.flushes.map((entry) => entry.durationMs))
      : null;
    const drain = value.native.observedAt - value.input.keydownAt.at(-1)!;
    require(finite(drain) && finite(value.typingWallMs), `${label}: invalid phase timing.`);
    require(value.native.pending.history === 0 &&
      value.native.pending.collaboration === 0, `${label}: native work did not drain.`);
    if (value.role === 'candidate') {
      require(value.native.highWater.history <= 64 &&
        value.native.highWater.collaboration <=
          64, `${label}: native cache exceeded the capacity limit.`);
      require(Boolean(flush) &&
        value.native.flushes.every(
          (entry) =>
            finite(entry.durationMs) &&
            entry.history >= 0 &&
            entry.collaboration >= 0 &&
            Math.max(entry.history, entry.collaboration) === 64,
        ), `${label}: paired flush evidence missing or unbounded.`);
      if (value.sample !== 'profile') {
        const limits = DOC_RESPONSIVENESS_BUDGETS[preset];
        require(value.budgetEnforced &&
          frame.p95 <= limits.inputP95Ms &&
          longestTask <= limits.longTaskMaxMs &&
          Boolean(flush) &&
          flush!.p95 <= limits.flushP95Ms &&
          flush!.max <= limits.flushMaxMs &&
          drain <= 1000, `${label}: an absolute responsiveness budget failed.`);
      }
    } else {
      require(!value.budgetEnforced, `${label}: baseline must be observational.`);
      if (value.native.highWater.history <= 64 || value.native.highWater.collaboration <= 64)
        unavailable.push(`${label}: the sustained native queues did not exceed the candidate cap.`);
    }
    summaries.push({
      role: value.role,
      sample: value.sample,
      source: value.source,
      inputP95Ms: frame.p95,
      longestTaskMs: longestTask,
      pairedFlushMs: flush,
      nativeDrainUpperBoundMs: drain,
      typingWallMs: value.typingWallMs,
    });
  }

  const profileEvidence = (artifacts: BenchmarkArtifact[], role: string) => {
    const artifact = artifacts.find((entry) => entry.metrics.sample === 'profile');
    if (
      !artifact?.profile ||
      !artifact.metrics.profilerStartBracket ||
      !artifact.profileClock ||
      !artifact.metrics.profileSha256
    ) {
      unavailable.push(`${role}: raw CPU profile or clock bracket unavailable.`);
      return null;
    }
    require(artifact.metrics.profileSha256 === artifact.profileBytesSha256 &&
      artifact.profileClock.sha256 === artifact.profileBytesSha256 &&
      isDeepStrictEqual(artifact.profileClock.bracket, artifact.metrics.profilerStartBracket) &&
      artifact.profileClock.profileStartTimeUs === artifact.profile.startTime &&
      artifact.profileClock.profileEndTimeUs ===
        artifact.profile.endTime, `${role}: raw CPU profile/clock integrity check failed.`);
    try {
      return compositionCpu(
        artifact.profile,
        artifact.metrics.profilerStartBracket,
        artifact.metrics.input.longTasks,
      );
    } catch (error) {
      unavailable.push(`${role}: ${String(error)}`);
      return null;
    }
  };
  const beforeProfile = profileEvidence(first, 'baseline'),
    afterProfile = profileEvidence(second, 'candidate');
  // Long-task observations censor tasks below 50 ms. A floor of 50 is a
  // conservative upper bound when none are reported, never a claim of zero work.
  const candidateTaskUpperBoundMs = Math.max(
    50,
    ...second.flatMap(({ metrics }) => metrics.input.longTasks.map((task) => task.durationMs)),
  );
  // An attributed pause under profiling is insufficient by itself: all three
  // unprofiled baselines must independently reproduce a large browser task.
  // These are whole-browser task reductions, with no native causal attribution.
  const plainBaselineComparisons = first
    .filter(({ metrics }) => metrics.sample !== 'profile')
    .map(({ metrics }) => {
      const baselineLongestTaskMs = Math.max(
        0,
        ...metrics.input.longTasks.map((task) => task.durationMs),
      );
      const large = baselineLongestTaskMs > 1000;
      const reductionPercent = large
        ? 100 * (1 - candidateTaskUpperBoundMs / baselineLongestTaskMs)
        : null;
      if (!large)
        unavailable.push(
          `baseline ${metrics.sample}: no >1,000 ms unprofiled whole-browser task reproduced.`,
        );
      else
        require(reductionPercent! >=
          90, `${metrics.sample}: unprofiled whole-browser longest-task reduction is below 90%.`);
      return {
        sample: metrics.sample,
        baselineLongestTaskMs,
        candidateEntireTaskUpperBoundMs: candidateTaskUpperBoundMs,
        reductionPercent,
      };
    });
  const unprofiledImprovement = {
    metric: 'whole-browser-longest-task-reduction',
    samples: plainBaselineComparisons,
    conservativeAggregateReductionPercent:
      plainBaselineComparisons.length === 3 &&
      plainBaselineComparisons.every((sample) => sample.baselineLongestTaskMs > 1000)
        ? 100 *
          (1 -
            candidateTaskUpperBoundMs /
              Math.min(...plainBaselineComparisons.map((sample) => sample.baselineLongestTaskMs)))
        : null,
    qualification:
      'All three plain baseline samples must corroborate a >1,000 ms browser task. Reductions use the worst candidate task across plain and profiled samples; native reducer attribution is a separate profile gate.',
  };
  let largeStallWitnesses = 0;
  const improvement = Object.fromEntries(
    (['history', 'collaboration'] as const).map((family) => {
      const before = beforeProfile?.[family],
        after = afterProfile?.[family];
      const baselineContainingTaskMs = before?.maxContainingTaskMs ?? null;
      if (before?.status !== 'sampled' || baselineContainingTaskMs === null)
        unavailable.push(`baseline ${family}: no certain composition-containing task witness.`);
      if (!afterProfile) unavailable.push(`candidate ${family}: raw profile unavailable.`);
      const large = baselineContainingTaskMs !== null && baselineContainingTaskMs > 1000;
      const reductionPercent = large
        ? 100 * (1 - candidateTaskUpperBoundMs / baselineContainingTaskMs)
        : null;
      if (large) {
        largeStallWitnesses++;
        require(reductionPercent! >=
          90, `${family}: maximum containing-task reduction is below 90%.`);
      }
      return [
        family,
        {
          baselineContainingTaskMs,
          candidateEntireTaskUpperBoundMs: candidateTaskUpperBoundMs,
          reductionPercent,
          status: large ? 'registered-relative-gate-applied' : 'large-stall-not-reproduced',
          candidateAttribution:
            after?.status === 'sampled'
              ? 'sampled-native-reducer'
              : 'public-paired-flush-bound-and-entire-task-upper-bound',
          qualification:
            'The baseline duration is the whole task containing a certain reducer sample, not time attributed entirely to that reducer.',
        },
      ] as const;
    }),
  );
  if (!largeStallWitnesses)
    unavailable.push(
      'No >1,000 ms composition-containing baseline stall reproduced; independent evidence is still required.',
    );

  const profilingVariation = [first, second].map((artifacts) => {
    const plain = artifacts
      .filter(({ metrics }) => metrics.sample !== 'profile')
      .map(({ metrics }) => metrics.typingWallMs);
    const profiled =
      artifacts.find(({ metrics }) => metrics.sample === 'profile')?.metrics.typingWallMs ?? null;
    return {
      role: artifacts[0]?.metrics.role,
      plainTypingMs: distribution(plain),
      profileTypingMs: profiled,
      profileMinusPlainMedianMs:
        profiled === null || !plain.length ? null : profiled - distribution(plain).p50,
      qualification:
        'Observed sample difference includes run-to-run variation; it does not isolate profiler overhead.',
    };
  });
  return {
    schema: 1,
    preset,
    physicalDevice: false,
    status: failures.length ? 'failed' : unavailable.length ? 'needs-evidence' : 'passed',
    passed: failures.length === 0 && unavailable.length === 0,
    failures,
    unavailable,
    summaries,
    improvement,
    unprofiledImprovement,
    profilingVariation,
    composition: { baseline: beforeProfile, candidate: afterProfile },
  };
}

async function loadArtifacts(directory: string): Promise<BenchmarkArtifact[]> {
  const files: string[] = [];
  for await (const file of glob('**/spn108-metrics.json', { cwd: directory })) files.push(file);
  return Promise.all(
    files.map(async (file) => {
      const path = join(directory, file);
      const metrics = JSON.parse(await readFile(path, 'utf8')) as BenchmarkMetrics;
      if (metrics.sample !== 'profile') return { metrics };
      const [raw, clock] = await Promise.all([
        readFile(join(dirname(path), 'spn108-profile.cpuprofile'), 'utf8'),
        readFile(join(dirname(path), 'spn108-profile-clock.json'), 'utf8'),
      ]);
      return {
        metrics,
        profile: JSON.parse(raw) as CpuProfile,
        profileBytesSha256: createHash('sha256').update(raw).digest('hex'),
        profileClock: JSON.parse(clock) as BenchmarkArtifact['profileClock'],
      };
    }),
  );
}

if (import.meta.main) {
  const [preset, baseline, candidate, output] = process.argv.slice(2);
  if (!['desktop', 'mobile'].includes(preset ?? '') || !baseline || !candidate || !output)
    throw new Error(
      'Usage: node scripts/ci/doc-responsiveness.ts <desktop|mobile> <baseline-directory> <candidate-directory> <output.json>',
    );
  let report:
    ReturnType<typeof compareDocResponsiveness> | { passed: false; status: string; error: string };
  try {
    const [before, after] = await Promise.all([loadArtifacts(baseline), loadArtifacts(candidate)]);
    report = compareDocResponsiveness(before, after, preset as Preset);
  } catch (error) {
    report = { passed: false, status: 'failed', error: String(error) };
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}
