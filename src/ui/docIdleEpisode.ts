import type { DocFlushObservation } from './boundedDocHistory.ts';
import type { DocCacheCounts, NativeDocFlushObservation } from './nativeDocFlush.ts';

export interface DocTerminalState {
  epoch: string;
  generation: string;
  unitId: string;
  timeOrigin: number;
  completedStates: number;
  observedAt: number;
  pending: DocCacheCounts;
}
export interface EpochDocFlush extends NativeDocFlushObservation {
  epoch: string;
  generation: string;
  completedStates: number;
}
export interface DocIdleEpisode {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  history: number;
  collaboration: number;
  origin: 'native-timers' | 'policy-idle' | 'mixed';
  nativeSequences: number[];
}

/** Reconcile one terminal drain, preserving the entire elapsed paired interval. */
export function terminalIdleEpisode(
  terminal: DocTerminalState,
  firstEmptyAt: number,
  observations: readonly EpochDocFlush[],
  policy: readonly (Omit<DocFlushObservation, 'reason' | 'outcome'> & {
    reason: string;
    outcome?: DocFlushObservation['outcome'];
  })[],
): DocIdleEpisode {
  const fail = (reason: string): never => {
    throw new Error(`idle-evidence:${reason}`);
  };
  const validTime = (value: number) => Number.isFinite(value) && value >= 0;
  const validCounts = (counts: DocCacheCounts) =>
    [counts.history, counts.collaboration].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    );
  if (
    !validTime(terminal.observedAt) ||
    !validTime(firstEmptyAt) ||
    firstEmptyAt < terminal.observedAt ||
    !validCounts(terminal.pending) ||
    Math.max(terminal.pending.history, terminal.pending.collaboration) === 0
  )
    fail('invalid-terminal');
  if (!Array.isArray(observations) || observations.length > 4096) fail('invalid-record-buffer');
  const sequences = new Set<number>();
  for (const value of observations) {
    if (
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 1 ||
      sequences.has(value.sequence) ||
      !['pair', 'history', 'collaboration'].includes(value.phase) ||
      value.unitId !== terminal.unitId ||
      value.epoch !== terminal.epoch ||
      value.generation !== terminal.generation ||
      !Number.isSafeInteger(value.completedStates) ||
      value.completedStates < 0 ||
      value.completedStates > terminal.completedStates ||
      (value.startedAt >= terminal.observedAt &&
        value.completedStates !== terminal.completedStates) ||
      !validTime(value.startedAt) ||
      !validTime(value.endedAt) ||
      value.endedAt < value.startedAt ||
      !validCounts(value.before) ||
      !validCounts(value.after) ||
      value.outcome !== 'returned'
    )
      fail('invalid-member');
    sequences.add(value.sequence);
    const substantive =
      value.phase === 'pair'
        ? Math.max(value.before.history, value.before.collaboration) > 0
        : value.before[value.phase] > 0;
    if (substantive && value.origin.endsWith('-timer') && value.startedAt < terminal.observedAt)
      fail('unclassified-earlier-timer');
    if (substantive && value.endedAt > firstEmptyAt) fail('work-after-empty');
  }
  const entries = observations.filter(
    (value) => value.startedAt >= terminal.observedAt && value.startedAt <= firstEmptyAt,
  );
  if (
    entries.some(
      (value) => value.completedStates !== terminal.completedStates || value.endedAt > firstEmptyAt,
    )
  )
    fail('invalid-terminal-member');
  const phases = entries
    .filter((value) => value.phase !== 'pair' && value.before[value.phase] > 0)
    .sort((a, b) => a.startedAt - b.startedAt || a.sequence - b.sequence);
  let pending = terminal.pending;
  const seen = new Set<string>();
  for (const value of phases) {
    if (value.phase === 'pair') fail('invalid-phase');
    const phase = value.phase as 'history' | 'collaboration';
    if (
      seen.has(phase) ||
      value.before.history !== pending.history ||
      value.before.collaboration !== pending.collaboration ||
      value.after[phase] !== 0 ||
      value.after[phase === 'history' ? 'collaboration' : 'history'] !==
        pending[phase === 'history' ? 'collaboration' : 'history'] ||
      ![`${phase}-timer`, 'policy-idle'].includes(value.origin)
    )
      fail('incomplete-or-conflicting-phases');
    seen.add(phase);
    pending = value.after;
  }
  if (!phases.length || pending.history || pending.collaboration) fail('missing-phase');
  for (let index = 1; index < phases.length; index++)
    if (phases[index].startedAt < phases[index - 1].endedAt) fail('overlapping-phases');
  const pairs = entries.filter(
    (value) =>
      value.phase === 'pair' && Math.max(value.before.history, value.before.collaboration) > 0,
  );
  const outer = policy.filter(
    (value) => value.startedAt >= terminal.observedAt && value.startedAt <= firstEmptyAt,
  );
  if (
    outer.some(
      (value) =>
        value.reason !== 'idle' ||
        // Historical policy rows predate diagnostic outcomes; their matching
        // native phases above still prove success. Explicit failures cannot pass.
        (value.outcome !== undefined && value.outcome !== 'success') ||
        !validTime(value.durationMs) ||
        value.startedAt + value.durationMs > firstEmptyAt ||
        !Number.isFinite(value.quietForMs) ||
        value.quietForMs! < 300,
    )
  )
    fail('invalid-policy-pair');
  if (pairs.length !== outer.length) fail('missing-policy-pair');
  const matched = new Set<number>();
  for (const pair of pairs) {
    const candidates = outer
      .map((value, index) => ({ value, index }))
      .filter(
        ({ value }) =>
          value.startedAt <= pair.startedAt &&
          value.startedAt + value.durationMs >= pair.endedAt &&
          value.history === pair.before.history &&
          value.collaboration === pair.before.collaboration,
      );
    const enclosed = phases.filter(
      (value) =>
        value.sequence > pair.sequence &&
        value.startedAt >= pair.startedAt &&
        value.endedAt <= pair.endedAt,
    );
    if (
      pair.origin !== 'policy-idle' ||
      pair.after.history !== 0 ||
      pair.after.collaboration !== 0 ||
      candidates.length !== 1 ||
      matched.has(candidates[0].index) ||
      !enclosed.length ||
      enclosed.some((value) => value.origin !== 'policy-idle') ||
      pair.before.history !== enclosed[0].before.history ||
      pair.before.collaboration !== enclosed[0].before.collaboration
    )
      fail('invalid-policy-pair');
    matched.add(candidates[0].index);
  }
  if (
    phases.some(
      (value) =>
        value.origin === 'policy-idle' &&
        pairs.filter(
          (pair) =>
            pair.sequence < value.sequence &&
            pair.startedAt <= value.startedAt &&
            pair.endedAt >= value.endedAt,
        ).length !== 1,
    )
  )
    fail('missing-policy-pair');
  const startedAt = Math.min(
    ...phases.map((value) => value.startedAt),
    ...outer.map((value) => value.startedAt),
  );
  const endedAt = Math.max(
    ...phases.map((value) => value.endedAt),
    ...outer.map((value) => value.startedAt + value.durationMs),
  );
  const timers = phases.some((value) => value.origin.endsWith('-timer'));
  return {
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    ...terminal.pending,
    origin: outer.length ? (timers ? 'mixed' : 'policy-idle') : 'native-timers',
    nativeSequences: phases.map((value) => value.sequence),
  };
}
