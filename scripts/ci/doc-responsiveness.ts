import { createHash } from 'node:crypto';
import { glob, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  compositionCpu,
  distribution,
  DOC_RESPONSIVENESS_BASELINE_HISTORY_LIMIT,
  DOC_RESPONSIVENESS_BUDGETS,
  DOC_RESPONSIVENESS_CANDIDATE_HISTORY_LIMIT,
  DOC_RESPONSIVENESS_GROUP_LIMIT,
  DOC_RESPONSIVENESS_SCHEMA,
} from '../../e2e/doc-responsiveness.ts';
import type {
  CpuProfile,
  DocDrainDiagnostics,
  DocDrainWitness,
  DocResponsivenessEvidence,
  DocIntegritySnapshot,
  DocPreUndoIntegrity,
  DocReloadEvidence,
  DocReloadObserverStatus,
  DocUndoRedoEvidence,
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
  timingComplete?: boolean;
  timingCompleteAt?: number;
  preUndoIntegrity?: DocPreUndoIntegrity;
  undoRedo?: DocUndoRedoEvidence;
  reloadObservers?: DocReloadObserverStatus[];
  finalReloads?: DocReloadEvidence[];
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
  drainDiagnostics: DocDrainDiagnostics;
  drainArm?: DocDrainWitness;
  drainWitness?: DocDrainWitness;
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
const canonicalText =
  Array.from(
    { length: 16 },
    (_, index) =>
      `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
      'Keep the original page size and all of this text when navigating.',
  ).join('\r') + '\r\n';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** The strict baseline exception never converts an arbitrary failure into valid evidence. */
function validateIntegrity(value: BenchmarkMetrics) {
  const failures: string[] = [];
  const check = (condition: boolean, message: string) => {
    if (!condition) failures.push(`${value.role}/${value.sample}: ${message}`);
  };
  const initial = value.preUndoIntegrity;
  const replay = value.undoRedo;
  if (!initial || !replay) return [`${value.role}/${value.sample}: structured integrity missing.`];
  const unitId = value.native.unitId;
  check(
    value.reloadObservers?.length === 2 &&
      ['sender', 'peer'].every(
        (surface) =>
          value.reloadObservers!.filter((observer) => observer.surface === surface).length === 1,
      ) &&
      value.reloadObservers.every(
        (observer) =>
          observer.dropped === 0 &&
          observer.malformed === 0 &&
          finite(observer.installedAt) &&
          observer.installedAt <= value.input.startedAt &&
          finite(observer.sourceInstalledAt) &&
          finite(observer.sourceTimeOrigin) &&
          Math.abs(
            observer.installedAt -
              (observer.sourceInstalledAt + observer.sourceTimeOrigin - value.input.timeOrigin),
          ) <= 1,
      ),
    'complete sender/peer reload observers must precede primary timing.',
  );
  check(
    Array.isArray(value.finalReloads) && isDeepStrictEqual(value.finalReloads, replay.reloads),
    'reload observations changed after the verified outcome.',
  );
  const selection = (snapshot: DocIntegritySnapshot, position: number) =>
    snapshot.sender.selection?.start === position &&
    snapshot.sender.selection.end === position &&
    !snapshot.sender.selection.segmentId &&
    snapshot.peer.selection?.start === 0 &&
    snapshot.peer.selection.end === 0 &&
    !snapshot.peer.selection.segmentId;
  const content = (snapshot: DocIntegritySnapshot, text: string) => {
    const digest = hash(text);
    return [snapshot.sender, snapshot.peer, snapshot.saved].every(
      (part) => part.textLength === text.length && part.textSha256 === digest,
    );
  };
  const snapshots = [initial, replay.firstUndo, replay.undo, replay.final];
  if (snapshots.some((snapshot) => !snapshot?.sender || !snapshot.peer || !snapshot.saved))
    return [`${value.role}/${value.sample}: a required integrity phase is missing.`];
  for (const snapshot of snapshots) {
    check(
      finite(snapshot.observedAt) &&
        Number.isInteger(snapshot.saved.revision) &&
        snapshot.saved.revision >= 0 &&
        [snapshot.sender, snapshot.peer].every(
          (part) =>
            part.unitId === unitId &&
            finite(part.observedAt) &&
            part.observedAt <= snapshot.observedAt + 1 &&
            part.pending?.history === 0 &&
            part.pending.collaboration === 0 &&
            Number.isInteger(part.textLength) &&
            part.textLength >= 2 &&
            /^[a-f0-9]{64}$/.test(part.textSha256),
        ),
      'invalid unit, content, revision, native drain or snapshot clock.',
    );
  }
  const groups = initial.sender.history.undos;
  const historyLimit =
    value.role === 'candidate'
      ? DOC_RESPONSIVENESS_CANDIDATE_HISTORY_LIMIT
      : DOC_RESPONSIVENESS_BASELINE_HISTORY_LIMIT;
  const all = value.sample === 'plain-1';
  check(
    initial.passed === true &&
      Array.isArray(initial.reloads) &&
      initial.reloads.length === 0 &&
      content(initial, canonicalText) &&
      selection(initial, canonicalText.length - 2) &&
      initial.sender.history.redos === 0 &&
      Number.isInteger(groups) &&
      groups > 0 &&
      groups <= historyLimit &&
      isDeepStrictEqual(initial.sender.history, value.native.history),
    'initial exact integrity or native history did not pass.',
  );
  const freshSince = (snapshot: DocIntegritySnapshot, at: number) =>
    [snapshot.sender, snapshot.peer].every((part) => part.observedAt >= at - 1);
  check(
    freshSince(initial, value.timingCompleteAt!) &&
      freshSince(replay.firstUndo, replay.beforeUndoAt) &&
      freshSince(replay.undo, replay.beforeUndoAt) &&
      freshSince(replay.final, replay.beforeRedoAt),
    'native content observations must be fresh within their integrity phase.',
  );
  check(replay.requestedGroups === (all ? groups : 1), 'registered undo coverage changed.');
  const firstLength = replay.firstUndo.sender.textLength;
  check(
    firstLength < canonicalText.length &&
      content(replay.firstUndo, canonicalText.slice(0, firstLength - 2) + '\r\n') &&
      selection(replay.firstUndo, firstLength - 2) &&
      replay.firstUndo.sender.history.undos === groups - 1 &&
      replay.firstUndo.sender.history.redos === 1 &&
      replay.firstUndo.saved.revision > initial.saved.revision,
    'first Undo did not preserve the exact prefix, caret, history and saved/peer state.',
  );
  const undoText = all ? '\r\n' : canonicalText.slice(0, firstLength - 2) + '\r\n';
  check(
    content(replay.undo, undoText) &&
      selection(replay.undo, undoText.length - 2) &&
      replay.undo.sender.history.undos === groups - replay.requestedGroups &&
      replay.undo.sender.history.redos === replay.requestedGroups &&
      replay.undo.saved.revision >= replay.firstUndo.saved.revision,
    'requested Undo groups did not converge exactly.',
  );
  const phases = [
    value.input.endedAt,
    value.timingCompleteAt!,
    initial.observedAt,
    replay.beforeUndoAt,
    replay.firstUndo.observedAt,
    replay.undo.observedAt,
    replay.afterUndoAt,
    replay.beforeRedoAt,
    replay.afterRedoAt,
    replay.finalObservedAt,
  ];
  check(
    phases.every(finite) &&
      phases.every((at, index) => !index || at >= phases[index - 1]!) &&
      replay.finalObservedAt === replay.final.observedAt,
    'integrity phases are missing, unordered or overlap primary timing.',
  );
  check(Array.isArray(replay.reloads), 'complete reload observations are missing.');
  if (replay.outcome === 'passed') {
    check(
      replay.reloads?.length === 0 &&
        content(replay.final, canonicalText) &&
        selection(replay.final, canonicalText.length - 2) &&
        replay.final.sender.history.undos === groups &&
        replay.final.sender.history.redos === 0 &&
        replay.final.saved.revision > replay.undo.saved.revision,
      'successful Redo requires exact saved/peer restoration and no reload.',
    );
  } else {
    const event = replay.reloads?.[0];
    check(
      value.role === 'baseline-observation' &&
        replay.outcome === 'baseline-capacity-refusal' &&
        groups === 1 &&
        replay.requestedGroups === 1 &&
        content(replay.undo, '\r\n') &&
        selection(replay.undo, 0) &&
        replay.reloads?.length === 1 &&
        event?.surface === 'sender' &&
        event.unitId === unitId &&
        event.reason === 'capacity' &&
        event.clean === false &&
        finite(event.observedAt) &&
        finite(event.sourceObservedAt) &&
        finite(event.sourceTimeOrigin) &&
        Math.abs(
          event.observedAt -
            (event.sourceObservedAt + event.sourceTimeOrigin - value.input.timeOrigin),
        ) <= 1 &&
        event.observedAt >= replay.beforeRedoAt &&
        event.observedAt <= replay.afterRedoAt &&
        freshSince(replay.final, event.observedAt) &&
        finite(replay.recoveredAt!) &&
        replay.recoveredAt! >= replay.afterRedoAt &&
        replay.recoveredAt! <= replay.finalObservedAt &&
        content(replay.final, '\r\n') &&
        selection(replay.final, 0) &&
        replay.final.saved.revision === replay.undo.saved.revision &&
        replay.final.sender.history.undos === 0 &&
        replay.final.sender.history.redos === 0 &&
        replay.final.sender.highWater.history === 0 &&
        replay.final.sender.highWater.collaboration === 0,
      'only the specifically observed post-Undo baseline capacity refusal is admissible.',
    );
  }
  return failures;
}

/** Polls retain observation overhead separately from the browser-local witness. */
function validDrainDiagnostics(value: BenchmarkMetrics) {
  const diagnostics = value.drainDiagnostics;
  if (
    !diagnostics ||
    !finite(diagnostics.nodeTimeOrigin) ||
    !Array.isArray(diagnostics.polls) ||
    diagnostics.polls.length === 0
  )
    return false;
  let previousReturn = 0;
  let previousObservation = value.input.keydownAt.at(-1)!;
  let previousHighWater = { history: 0, collaboration: 0 };
  for (const [index, poll] of diagnostics.polls.entries()) {
    if (
      poll.index !== index ||
      !finite(poll.requestAt) ||
      !finite(poll.returnedAt) ||
      poll.requestAt < previousReturn ||
      poll.returnedAt < poll.requestAt
    )
      return false;
    previousReturn = poll.returnedAt;
    const snapshot = poll.snapshot;
    if (snapshot === null) continue;
    if (
      !snapshot ||
      snapshot.unitId !== value.native.unitId ||
      !finite(snapshot.observedAt) ||
      snapshot.observedAt < previousObservation ||
      snapshot.observedAt > value.input.endedAt + 1 ||
      ![
        snapshot.pending?.history,
        snapshot.pending?.collaboration,
        snapshot.highWater?.history,
        snapshot.highWater?.collaboration,
        snapshot.history?.undos,
        snapshot.history?.redos,
      ].every((count) => Number.isInteger(count) && count >= 0)
    )
      return false;
    for (const family of ['history', 'collaboration'] as const)
      if (
        snapshot.pending[family] > snapshot.highWater[family] ||
        snapshot.highWater[family] < previousHighWater[family] ||
        snapshot.highWater[family] > value.native.highWater[family]
      )
        return false;
    previousObservation = snapshot.observedAt;
    previousHighWater = snapshot.highWater;
  }
  const firstEmpty = diagnostics.polls.find(
    (poll) => poll.snapshot?.pending.history === 0 && poll.snapshot.pending.collaboration === 0,
  );
  if (
    !firstEmpty ||
    firstEmpty.index !== diagnostics.polls.length - 1 ||
    !isDeepStrictEqual(firstEmpty, diagnostics.firstEmpty) ||
    !isDeepStrictEqual(firstEmpty.snapshot!.history, value.native.history) ||
    !isDeepStrictEqual(firstEmpty.snapshot!.highWater, value.native.highWater)
  )
    return false;
  for (const bracket of [diagnostics.finishInputNodeBracket, diagnostics.finalNativeNodeBracket]) {
    if (
      !bracket ||
      !finite(bracket.requestAt) ||
      !finite(bracket.returnedAt) ||
      bracket.requestAt < previousReturn ||
      bracket.returnedAt < bracket.requestAt
    )
      return false;
    previousReturn = bracket.returnedAt;
  }
  return true;
}

/** Both roles must use the same read-only recorder, with a sealed observation epoch. */
function validDrainWitness(value: BenchmarkMetrics) {
  const arm = value.drainArm;
  const sealed = value.drainWitness;
  const observed = value.native.drainWitness;
  if (
    !arm ||
    !sealed ||
    !observed ||
    !sealed.firstEmpty ||
    !value.preUndoIntegrity ||
    !value.undoRedo
  )
    return false;
  const initial = arm.initial;
  const first = sealed.firstEmpty;
  const lastKey = value.input.keydownAt.at(-1)!;
  const empty = (pending: { history: number; collaboration: number }) =>
    pending?.history === 0 && pending?.collaboration === 0;
  const sameIdentity = (record: DocDrainWitness) =>
    record.epoch === arm.epoch &&
    record.generation === arm.generation &&
    record.unitId === value.native.unitId &&
    record.timeOrigin === value.input.timeOrigin &&
    record.installedAt === arm.installedAt &&
    record.armedAt === arm.armedAt &&
    record.expectedCompletedStates === 2086 &&
    isDeepStrictEqual(record.initial, initial) &&
    record.invalidated === false &&
    Array.isArray(record.invalidations) &&
    record.invalidations.length === 0;
  if (
    !initial ||
    typeof arm.epoch !== 'string' ||
    !arm.epoch ||
    arm.epoch.length > 128 ||
    typeof arm.generation !== 'string' ||
    !arm.generation ||
    ![arm, observed, sealed].every(sameIdentity) ||
    !finite(arm.timeOrigin) ||
    !finite(arm.installedAt) ||
    !finite(arm.armedAt) ||
    arm.installedAt > arm.armedAt ||
    arm.armedAt > value.input.startedAt ||
    initial.observedAt !== arm.armedAt ||
    !empty(initial.pending) ||
    initial.history?.undos !== 0 ||
    initial.history.redos !== 0 ||
    arm.completedStates !== 0 ||
    arm.lastCompletedStateAt !== null ||
    arm.firstEmpty !== null ||
    arm.sealedAt !== null ||
    observed.sealedAt !== null ||
    observed.completedStates !== 2086 ||
    sealed.completedStates !== 2086 ||
    observed.lastCompletedStateAt !== sealed.lastCompletedStateAt ||
    !isDeepStrictEqual(observed.firstEmpty, first) ||
    !finite(sealed.lastCompletedStateAt!) ||
    sealed.lastCompletedStateAt! < lastKey ||
    !finite(first.observedAt) ||
    first.observedAt < sealed.lastCompletedStateAt! ||
    first.observedAt > value.native.observedAt ||
    first.observedAt > value.input.endedAt + 1 ||
    first.observedAt > (value.drainDiagnostics?.firstEmpty?.snapshot?.observedAt ?? -1) ||
    value.native.flushes.some(
      (flush) => flush.startedAt + flush.durationMs > first.observedAt + 1,
    ) ||
    first.completedStates !== 2086 ||
    !empty(first.pending) ||
    !isDeepStrictEqual(first.history, value.native.history) ||
    !isDeepStrictEqual(first.highWater, value.native.highWater) ||
    !Array.isArray(first.wakeups) ||
    first.wakeups.length === 0 ||
    new Set(first.wakeups).size !== first.wakeups.length ||
    first.wakeups.some(
      (source) => !['terminal-state', 'history-status', 'collaboration-emission'].includes(source),
    ) ||
    !finite(sealed.sealedAt!) ||
    sealed.sealedAt! < value.preUndoIntegrity.observedAt ||
    sealed.sealedAt! > value.undoRedo.beforeUndoAt
  )
    return false;
  if (
    !Array.isArray(value.drainDiagnostics?.polls) ||
    !value.drainDiagnostics.polls.every(
      (poll) =>
        !poll.snapshot ||
        poll.snapshot.observedAt < first.observedAt ||
        (empty(poll.snapshot.pending) &&
          isDeepStrictEqual(poll.snapshot.history, first.history) &&
          isDeepStrictEqual(poll.snapshot.highWater, first.highWater)),
    )
  )
    return false;
  return (['history', 'collaboration'] as const).every(
    (family) =>
      Number.isInteger(initial.highWater?.[family]) &&
      initial.highWater[family] >= 0 &&
      initial.highWater[family] <= first.highWater[family],
  );
}

const requiredHashes = [
  'e2e/doc-responsiveness.ts',
  'e2e/doc-responsiveness.spec.ts',
  'e2e/doc-responsiveness-fixture.ts',
  'e2e/doc-responsiveness-boundaries.ts',
  'web/docResponsivenessEvidence.ts',
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
    unavailable: string[] = [],
    integrityFailures: string[] = [];
  const check = (condition: boolean, message: string) => {
    if (!condition) failures.push(message);
  };
  const selected = (artifacts: BenchmarkArtifact[], role: BenchmarkMetrics['role']) => {
    const matching = artifacts.filter((artifact) => artifact.metrics.preset === preset);
    check(matching.length === 4, `${role}: expected exactly three plain samples and one profile.`);
    for (const sample of samples)
      check(
        matching.filter((artifact) => artifact.metrics.sample === sample).length === 1,
        `${role}: missing or duplicated ${sample}.`,
      );
    for (const { metrics } of matching) check(metrics.role === role, `${role}: role mismatch.`);
    check(
      matching.every(({ metrics }) => /^[a-f0-9]{40}$/.test(metrics.source)) &&
        new Set(matching.map(({ metrics }) => metrics.source)).size === 1,
      `${role}: samples must share one valid immutable source SHA.`,
    );
    return matching;
  };
  const first = selected(baseline, 'baseline-observation'),
    second = selected(candidate, 'candidate');
  const all = [...first, ...second];
  const reference = first[0]?.metrics;
  const summaries: Array<Record<string, unknown>> = [];
  for (const { metrics: value } of all) {
    const label = `${value.role}/${value.sample}`;
    check(
      value.schema === DOC_RESPONSIVENESS_SCHEMA &&
        value.attempt === 0 &&
        value.completed === true &&
        value.timingComplete === true &&
        finite(value.timingCompleteAt!),
      `${label}: old schema, incomplete or repeated attempt.`,
    );
    check(
      Array.isArray(value.errors) && value.errors.length === 0,
      `${label}: unexpected page errors.`,
    );
    integrityFailures.push(...validateIntegrity(value));
    check(
      value.fixture.paragraphs === 16 &&
        value.fixture.typedCharacters === 2071 &&
        value.fixture.enterKeys === 15 &&
        value.fixture.nativeTextLength === 2088 &&
        value.fixture.sha256 === hash(canonicalText),
      `${label}: canonical workload changed.`,
    );
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
    check(
      browser?.configured?.isMobile === mobile &&
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
        (browser.observed.screen?.height ?? 0) > 0,
      `${label}: actual browser viewport, scale, pointer, touch or user agent is unavailable.`,
    );
    check(
      Boolean(value.browser) && Boolean(value.playwright) && Boolean(value.runtime),
      `${label}: browser, Playwright or Node version unavailable.`,
    );
    check(
      requiredHashes.every((path) => /^[a-f0-9]{64}$/.test(value.harnessSha256[path] ?? '')),
      `${label}: missing harness or lockfile hash.`,
    );
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
      check(
        value[field] !== undefined && isDeepStrictEqual(value[field], reference?.[field]),
        `${label}: ${field} differs from the paired baseline.`,
      );
    }
    check(
      isDeepStrictEqual(value.budgets, DOC_RESPONSIVENESS_BUDGETS[preset]),
      `${label}: preregistered budget changed.`,
    );
    check(
      isDeepStrictEqual(value.instrumentation, {
        profiler: value.sample === 'profile',
        cpuThrottle: preset === 'mobile' ? 4 : 1,
        longTaskObserver: true,
        perKeyRequestAnimationFrame: true,
        playwrightTrace: false,
        perMutationSnapshot: false,
        physicalDevice: false,
        nativeDrainWitness: 'browser-local-events-microtask',
      }),
      `${label}: instrumentation or CPU throttle changed.`,
    );
    check(
      value.input.keydownAt.length === 2086 &&
        value.input.keyToFrameMs.length === 2086 &&
        value.input.keydownAt.every(finite) &&
        value.input.keyToFrameMs.every(finite) &&
        value.input.keydownAt.every((at, index, list) => !index || at >= list[index - 1]!),
      `${label}: incomplete native input/frame observations.`,
    );
    // The threshold applies before endpoint coarsening and integer truncation;
    // a genuine raw long-task entry can therefore report 49 ms. Validate the
    // exposed timeline without dropping or clamping entries. Keep the separate
    // 50 ms censored-task comparison floor below unchanged.
    // https://www.w3.org/TR/2026/DISC-longtasks-1-20261020/#report-long-tasks
    // Pinned Chrome: performance.cc AddLongTaskTiming, revision
    // f842f52ef39fd97b449eb27cff414bf05a98ddce, lines 819-838.
    check(
      value.input.longTasks.every((task) => finite(task.startedAt) && finite(task.durationMs)),
      `${label}: invalid long-task timeline.`,
    );
    check(
      finite(value.input.startedAt) &&
        finite(value.input.endedAt) &&
        value.input.startedAt <= value.input.endedAt &&
        value.input.keydownAt.every(
          (at, index) =>
            at >= value.input.startedAt &&
            at + value.input.keyToFrameMs[index]! <= value.input.endedAt + 1,
        ) &&
        value.input.longTasks.every(
          (task) =>
            task.startedAt >= value.input.startedAt &&
            task.startedAt + task.durationMs <= value.input.endedAt + 1,
        ) &&
        value.input.endedAt <= value.native.observedAt &&
        value.native.observedAt <= value.timingCompleteAt!,
      `${label}: observations fall outside the completed primary timing window.`,
    );
    check(validDrainDiagnostics(value), `${label}: missing or invalid drain poll chronology.`);
    check(
      validDrainWitness(value),
      `${label}: missing or invalid sealed browser-local drain witness.`,
    );
    const frame = distribution(value.input.keyToFrameMs);
    const longestTask = Math.max(0, ...value.input.longTasks.map((task) => task.durationMs));
    const capacityFlushes = value.native.flushes.filter((entry) => entry.reason === 'capacity');
    const idleFlushes = value.native.flushes.filter((entry) => entry.reason === 'idle');
    const capacityFlush = capacityFlushes.length
      ? distribution(capacityFlushes.map((entry) => entry.durationMs))
      : null;
    const idleFlush = idleFlushes.length
      ? distribution(idleFlushes.map((entry) => entry.durationMs))
      : null;
    const flushMaximum = value.native.flushes.length
      ? Math.max(...value.native.flushes.map((entry) => entry.durationMs))
      : null;
    const drain = value.native.observedAt - value.input.keydownAt.at(-1)!;
    const localDrain = value.drainWitness?.firstEmpty
      ? value.drainWitness.firstEmpty.observedAt - value.input.keydownAt.at(-1)!
      : null;
    check(finite(drain) && finite(value.typingWallMs), `${label}: invalid phase timing.`);
    check(
      value.native.pending.history === 0 && value.native.pending.collaboration === 0,
      `${label}: native work did not drain.`,
    );
    if (value.role === 'candidate') {
      check(
        value.native.highWater.history <= DOC_RESPONSIVENESS_GROUP_LIMIT &&
          value.native.highWater.collaboration <= DOC_RESPONSIVENESS_GROUP_LIMIT,
        `${label}: native cache exceeded the capacity limit.`,
      );
      check(
        Boolean(capacityFlush) &&
          value.native.flushes.every(
            (entry) =>
              finite(entry.startedAt) &&
              finite(entry.durationMs) &&
              entry.startedAt >= value.input.startedAt &&
              entry.startedAt + entry.durationMs <= value.native.observedAt + 1 &&
              Number.isInteger(entry.history) &&
              Number.isInteger(entry.collaboration) &&
              entry.history >= 0 &&
              entry.collaboration >= 0 &&
              Math.max(entry.history, entry.collaboration) <= DOC_RESPONSIVENESS_GROUP_LIMIT &&
              (entry.reason === 'capacity'
                ? Math.max(entry.history, entry.collaboration) === DOC_RESPONSIVENESS_GROUP_LIMIT
                : entry.reason === 'idle' &&
                  Math.max(entry.history, entry.collaboration) > 0 &&
                  finite(entry.quietForMs!) &&
                  entry.quietForMs! >= 300),
          ),
        `${label}: capacity evidence missing or invalid paired flush reason, count or quiet time.`,
      );
      if (value.sample !== 'profile') {
        const limits = DOC_RESPONSIVENESS_BUDGETS[preset];
        check(
          value.budgetEnforced &&
            frame.p95 <= limits.inputP95Ms &&
            longestTask <= limits.longTaskMaxMs &&
            Boolean(capacityFlush) &&
            capacityFlush!.p95 <= limits.flushP95Ms &&
            capacityFlush!.max <= limits.flushMaxMs &&
            (!idleFlush ||
              (idleFlush.p95 <= limits.flushP95Ms && idleFlush.max <= limits.flushMaxMs)) &&
            flushMaximum !== null &&
            flushMaximum <= limits.flushMaxMs &&
            localDrain !== null &&
            finite(localDrain) &&
            localDrain <= 1000,
          `${label}: an absolute responsiveness budget failed.`,
        );
      }
    } else {
      check(!value.budgetEnforced, `${label}: baseline must be observational.`);
      check(
        value.native.flushes.length === 0,
        `${label}: uncapped baseline reported policy flushes.`,
      );
      if (
        value.native.highWater.history <= DOC_RESPONSIVENESS_GROUP_LIMIT ||
        value.native.highWater.collaboration <= DOC_RESPONSIVENESS_GROUP_LIMIT
      )
        unavailable.push(`${label}: the sustained native queues did not exceed the candidate cap.`);
    }
    summaries.push({
      role: value.role,
      sample: value.sample,
      source: value.source,
      inputP95Ms: frame.p95,
      longestTaskMs: longestTask,
      capacityPairedFlushMs: capacityFlush,
      idlePairedFlushMs: idleFlush,
      pairedFlushMaximumMs: flushMaximum,
      nativeDrainUpperBoundMs: drain,
      firstVerifiedBrowserLocalDrainMs: localDrain,
      lateReadMinusLocalWitnessMs: localDrain === null ? null : drain - localDrain,
      drainPollCount: value.drainDiagnostics?.polls?.length ?? 0,
      firstEmptyAfterFinalKeyMs: value.drainDiagnostics?.firstEmpty?.snapshot
        ? value.drainDiagnostics.firstEmpty.snapshot.observedAt - value.input.keydownAt.at(-1)!
        : null,
      typingWallMs: value.typingWallMs,
      initialIntegrity: value.preUndoIntegrity?.passed === true,
      redoOutcome: value.undoRedo?.outcome ?? 'missing',
      undoRedoGroups: value.undoRedo?.requestedGroups ?? null,
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
    check(
      artifact.metrics.profileSha256 === artifact.profileBytesSha256 &&
        artifact.profileClock.sha256 === artifact.profileBytesSha256 &&
        isDeepStrictEqual(artifact.profileClock.bracket, artifact.metrics.profilerStartBracket) &&
        artifact.profileClock.profileStartTimeUs === artifact.profile.startTime &&
        artifact.profileClock.profileEndTimeUs === artifact.profile.endTime,
      `${role}: raw CPU profile/clock integrity check failed.`,
    );
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
        check(
          reductionPercent! >= 90,
          `${metrics.sample}: unprofiled whole-browser longest-task reduction is below 90%.`,
        );
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
        check(
          reductionPercent! >= 90,
          `${family}: maximum containing-task reduction is below 90%.`,
        );
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
  // A timing window is usable only with its phase/content prerequisites; report
  // conservatively when any structured integrity observation is invalid.
  const timingValid =
    failures.length === 0 && unavailable.length === 0 && integrityFailures.length === 0;
  const candidateIntegrity =
    second.length === 4 &&
    second.every(
      ({ metrics }) =>
        metrics.undoRedo?.outcome === 'passed' && validateIntegrity(metrics).length === 0,
    );
  failures.push(...integrityFailures);
  return {
    schema: 2,
    candidateGroupLimit: DOC_RESPONSIVENESS_GROUP_LIMIT,
    candidateHistoryLimit: DOC_RESPONSIVENESS_CANDIDATE_HISTORY_LIMIT,
    baselineHistoryLimit: DOC_RESPONSIVENESS_BASELINE_HISTORY_LIMIT,
    protocolRevision: DOC_RESPONSIVENESS_SCHEMA,
    drainAcceptance: {
      metric: 'first-verified-browser-local-empty',
      maximumMs: 1000,
      lateReadUpperBound: 'descriptive-only',
    },
    preset,
    physicalDevice: false,
    status: failures.length ? 'failed' : unavailable.length ? 'needs-evidence' : 'passed',
    passed: failures.length === 0 && unavailable.length === 0,
    timingValid,
    baselineRedoOutcome: first.map(({ metrics }) => ({
      sample: metrics.sample,
      outcome: metrics.undoRedo?.outcome ?? 'missing',
      integrityEvidenceValid: validateIntegrity(metrics).length === 0,
    })),
    candidateIntegrity,
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
