import { sessionMeasurementConflict, type collectQuotaEvidence } from './browserstack-quota.ts';

export type QuotaEvidence = Awaited<ReturnType<typeof collectQuotaEvidence>>;
export type BudgetSource = {
  observedAt: string;
  sourceSha: string;
  testedSha: string;
  run: string;
};
type Measurement = {
  durationSeconds: number | null;
  providerStatus: string;
  executionStatus: string;
  createdAt: string | null;
  firstObserved: BudgetSource;
  lastObserved: BudgetSource;
};
type ReadFailure = {
  reason: string;
  firstObserved: BudgetSource;
  lastObserved: BudgetSource;
};
type LedgerSession = {
  sessionId: string;
  buildIds: string[];
  measurements: Measurement[];
  readFailures: ReadFailure[];
  collectorConflict: boolean;
};
export type BudgetLedger = {
  version: 1;
  allowanceSeconds: 3600;
  startingUsageSeconds: null;
  chargedDurationMapping: 'unverified';
  coverage: 'credential-visible-retained-records-only-not-lifetime-history';
  firstObserved: BudgetSource;
  lastObserved: BudgetSource;
  sessions: LedgerSession[];
};
export type BudgetReport = {
  status: 'blocked';
  allocationAllowed: false;
  allowanceSeconds: 3600;
  observedAt: string;
  sourceSha: string;
  testedSha: string;
  run: string;
  ledgerStatus: 'available' | 'invalid';
  measuredTerminalSessionSeconds: number | null;
  measuredTerminalSessions: number;
  retainedSessions: number;
  unresolvedSessions: number;
  conflictingSessions: number;
  sessionsWithReadFailures: number;
  remainingMinutes: null;
  completeOfflineMatrixCostMinutes: null;
  estimatedSuccessfulCompleteRuns: null;
  projectedExhaustion: null;
  firstUnfundableDate: null;
  nextMonthlyDates: string[];
  blockingReasons: string[];
  assumptions: string[];
};

// The allowance is the owner's lifetime limit, not a new monthly grant.
const allowanceSeconds = 3600;
const ledgerLimits = { sessions: 10_000, measurements: 64, failures: 32, builds: 100 };
const providerStates = new Set([
  'done',
  'passed',
  'failed',
  'error',
  'timeout',
  'running',
  'queued',
  'unmarked',
  'unknown',
]);
const executionStates = new Set(['done', 'error', 'timeout', 'running', 'queued', 'unknown']);
const failureCode =
  /^(http-\d{3}|invalid-response|response-too-large|request-timeout|deadline-exceeded|request-limit|session-identity-mismatch|request-failed|missing-credentials)$/;

function invalid(): never {
  // Never include values from persisted or provider data in an error.
  throw new Error('invalid-budget-ledger');
}
function row(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    return invalid();
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return invalid();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return invalid();
  return value;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) return invalid();
  return value;
}
function source(value: unknown): BudgetSource {
  const data = row(value, ['observedAt', 'sourceSha', 'testedSha', 'run']);
  if (
    typeof data.run !== 'string' ||
    data.run.length > 250 ||
    !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/[1-9]\d*$/.test(data.run)
  )
    return invalid();
  return {
    observedAt: timestamp(data.observedAt),
    sourceSha: identifier(data.sourceSha),
    testedSha: identifier(data.testedSha),
    run: data.run,
  };
}
function array<T>(value: unknown, limit: number, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > limit) return invalid();
  return value.map(parse);
}
function unique<T>(values: T[], key: (entry: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) return invalid();
  return values;
}
function data(value: unknown) {
  const parsed = row(value, ['durationSeconds', 'providerStatus', 'executionStatus', 'createdAt']);
  if (
    parsed.durationSeconds !== null &&
    (typeof parsed.durationSeconds !== 'number' ||
      !Number.isFinite(parsed.durationSeconds) ||
      parsed.durationSeconds < 0 ||
      parsed.durationSeconds > Number.MAX_SAFE_INTEGER)
  )
    return invalid();
  if (
    typeof parsed.providerStatus !== 'string' ||
    !providerStates.has(parsed.providerStatus) ||
    typeof parsed.executionStatus !== 'string' ||
    !executionStates.has(parsed.executionStatus)
  )
    return invalid();
  return {
    durationSeconds: parsed.durationSeconds as number | null,
    providerStatus: parsed.providerStatus,
    executionStatus: parsed.executionStatus,
    createdAt: parsed.createdAt === null ? null : timestamp(parsed.createdAt),
  };
}
const measurementKey = (value: ReturnType<typeof data>) =>
  JSON.stringify([
    value.durationSeconds,
    value.providerStatus,
    value.executionStatus,
    value.createdAt,
  ]);
function observedPair(value: Record<string, unknown>) {
  const firstObserved = source(value.firstObserved);
  const lastObserved = source(value.lastObserved);
  if (firstObserved.observedAt > lastObserved.observedAt) return invalid();
  return { firstObserved, lastObserved };
}
function measurement(value: unknown): Measurement {
  const entry = row(value, [
    'durationSeconds',
    'providerStatus',
    'executionStatus',
    'createdAt',
    'firstObserved',
    'lastObserved',
  ]);
  return {
    ...data({
      durationSeconds: entry.durationSeconds,
      providerStatus: entry.providerStatus,
      executionStatus: entry.executionStatus,
      createdAt: entry.createdAt,
    }),
    ...observedPair(entry),
  };
}
function readFailure(value: unknown): ReadFailure {
  const entry = row(value, ['reason', 'firstObserved', 'lastObserved']);
  if (typeof entry.reason !== 'string' || !failureCode.test(entry.reason)) return invalid();
  return { reason: entry.reason, ...observedPair(entry) };
}

/** Strictly validate a stored ledger; a malformed prior ledger must never be replaced by an empty one. */
export function readBudgetLedger(value: unknown): BudgetLedger {
  const entry = row(value, [
    'version',
    'allowanceSeconds',
    'startingUsageSeconds',
    'chargedDurationMapping',
    'coverage',
    'firstObserved',
    'lastObserved',
    'sessions',
  ]);
  if (
    entry.version !== 1 ||
    entry.allowanceSeconds !== allowanceSeconds ||
    entry.startingUsageSeconds !== null ||
    entry.chargedDurationMapping !== 'unverified' ||
    entry.coverage !== 'credential-visible-retained-records-only-not-lifetime-history'
  )
    return invalid();
  const observed = observedPair(entry);
  const sessions = unique(
    array(entry.sessions, ledgerLimits.sessions, (value): LedgerSession => {
      const session = row(value, [
        'sessionId',
        'buildIds',
        'measurements',
        'readFailures',
        'collectorConflict',
      ]);
      if (typeof session.collectorConflict !== 'boolean') return invalid();
      const measurements = unique(
        array(session.measurements, ledgerLimits.measurements, measurement),
        measurementKey,
      );
      const readFailures = unique(
        array(session.readFailures, ledgerLimits.failures, readFailure),
        (entry) => entry.reason,
      );
      if (!measurements.length && !readFailures.length) return invalid();
      for (const record of [...measurements, ...readFailures])
        if (
          record.firstObserved.observedAt < observed.firstObserved.observedAt ||
          record.lastObserved.observedAt > observed.lastObserved.observedAt
        )
          return invalid();
      return {
        sessionId: identifier(session.sessionId),
        buildIds: unique(array(session.buildIds, ledgerLimits.builds, identifier), (id) => id),
        measurements,
        readFailures,
        collectorConflict: session.collectorConflict,
      };
    }),
    (entry) => entry.sessionId,
  );
  return {
    version: 1,
    allowanceSeconds,
    startingUsageSeconds: null,
    chargedDurationMapping: 'unverified',
    coverage: 'credential-visible-retained-records-only-not-lifetime-history',
    ...observed,
    sessions,
  };
}

// The monthly phone scopes, one day apart so no scheduled run displaces another
// pending run in the account lock. The workflow's crons are `17 9 <day> * *`.
export const monthlyScopes = [
  { day: 1, scope: 'safari-acceptance' },
  { day: 2, scope: 'chrome-acceptance' },
  { day: 3, scope: 'firefox-tab-acceptance' },
] as const;

/** The scheduled run `offset` runs after `observedAt` (0 is the next one). */
export function scheduledRunDate(observedAt: string, offset: number): string {
  const now = Date.parse(timestamp(observedAt));
  if (!Number.isSafeInteger(offset) || offset < 0) return invalid();
  const start = new Date(now);
  for (let month = 0, seen = 0; ; month++)
    for (const { day } of monthlyScopes) {
      const date = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, day, 9, 17);
      if (date > now && seen++ === offset) return new Date(date).toISOString();
    }
}

/** One month's scheduled runs; the scope of each follows from its day. */
export function nextMonthlyDates(observedAt: string): string[] {
  return monthlyScopes.map((_, offset) => scheduledRunDate(observedAt, offset));
}

export function monthlyScope(date: string): string {
  const day = new Date(timestamp(date)).getUTCDate();
  return monthlyScopes.find((entry) => entry.day === day)?.scope ?? invalid();
}

/** First-of-month dates for the hypothetical one-complete-plan-per-month scenario. */
export function monthlyPlanDate(observedAt: string, offset: number): string {
  const now = new Date(timestamp(observedAt));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 9, 17));
  if (next.getTime() <= now.getTime()) next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCMonth(next.getUTCMonth() + offset);
  return next.toISOString();
}

function sessionUsage(entry: LedgerSession) {
  const terminal = entry.measurements.filter(
    (value) =>
      value.durationSeconds !== null &&
      value.createdAt !== null &&
      !['running', 'queued', 'unknown'].includes(value.providerStatus) &&
      ['done', 'error', 'timeout'].includes(value.executionStatus),
  );
  const conflict =
    entry.collectorConflict ||
    entry.measurements.some((value, index) =>
      entry.measurements.slice(index + 1).some((other) => sessionMeasurementConflict(value, other)),
    );
  const latestMeasurement = entry.measurements.reduce(
    (latest, value) =>
      value.lastObserved.observedAt > latest ? value.lastObserved.observedAt : latest,
    '',
  );
  const latestTerminal = terminal.some(
    (value) => value.lastObserved.observedAt === latestMeasurement,
  );
  return { conflict, seconds: !conflict && latestTerminal ? terminal[0].durationSeconds : null };
}

/** Reports known elapsed time; it deliberately cannot turn retained history into spending authority. */
export function createBudgetReport(
  options: BudgetSource & {
    evidence: QuotaEvidence;
    previousLedger: unknown | null;
  },
): { ledger: BudgetLedger | null; report: BudgetReport } {
  const stamp = source({
    observedAt: options.observedAt,
    sourceSha: options.sourceSha,
    testedSha: options.testedSha,
    run: options.run,
  });
  const blockingReasons = [
    'authoritative-remaining-balance-unavailable',
    'account-wide-starting-usage-unverified',
    'charged-duration-mapping-unverified',
    'complete-offline-matrix-cost-unmeasured',
  ];
  let ledger: BudgetLedger | null = null;
  try {
    ledger =
      options.previousLedger === null
        ? {
            version: 1,
            allowanceSeconds,
            startingUsageSeconds: null,
            chargedDurationMapping: 'unverified',
            coverage: 'credential-visible-retained-records-only-not-lifetime-history',
            firstObserved: stamp,
            lastObserved: stamp,
            sessions: [],
          }
        : readBudgetLedger(options.previousLedger);
    if (stamp.observedAt < ledger.lastObserved.observedAt)
      throw new Error('stale-budget-observation');
    const sessions = new Map(ledger.sessions.map((entry) => [entry.sessionId, entry]));
    for (const observed of options.evidence.history.sessions) {
      const id = identifier(observed.sessionId);
      let entry = sessions.get(id);
      if (!entry) {
        entry = {
          sessionId: id,
          buildIds: [],
          measurements: [],
          readFailures: [],
          collectorConflict: false,
        };
        sessions.set(id, entry);
      }
      if (typeof observed.conflict !== 'boolean') return invalid();
      entry.collectorConflict ||= observed.conflict;
      for (const buildId of observed.buildIds)
        if (!entry.buildIds.includes(identifier(buildId))) entry.buildIds.push(buildId);
      for (const observation of observed.observations) {
        if (observation.evidence.outcome === 'available') {
          const current = data(observation.evidence.data);
          const previous = entry.measurements.find(
            (value) => measurementKey(value) === measurementKey(current),
          );
          if (previous) previous.lastObserved = stamp;
          else entry.measurements.push({ ...current, firstObserved: stamp, lastObserved: stamp });
        } else if (observation.evidence.outcome === 'unavailable') {
          const reason = observation.evidence.reason;
          if (!failureCode.test(reason)) return invalid();
          const previous = entry.readFailures.find((value) => value.reason === reason);
          if (previous) previous.lastObserved = stamp;
          else entry.readFailures.push({ reason, firstObserved: stamp, lastObserved: stamp });
        } else return invalid();
      }
    }
    ledger.lastObserved = stamp;
    ledger.sessions = [...sessions.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    for (const entry of ledger.sessions) entry.buildIds.sort();
    ledger = readBudgetLedger(ledger);
  } catch (error) {
    ledger = null;
    blockingReasons.push(
      error instanceof Error && error.message === 'stale-budget-observation'
        ? 'stale-budget-observation'
        : 'invalid-durable-ledger',
    );
  }
  if (options.evidence.status !== 'passed') blockingReasons.push('current-collection-incomplete');
  const plan = options.evidence.plan;
  if (
    plan.outcome !== 'available' ||
    plan.data.runningSessions === null ||
    plan.data.queuedSessions === null
  )
    blockingReasons.push('current-account-activity-unverified');
  else if (plan.data.runningSessions > 0 || plan.data.queuedSessions > 0)
    blockingReasons.push('current-account-sessions-active');
  const usages = ledger?.sessions.map(sessionUsage) ?? [];
  const measured = usages.filter(
    (entry): entry is { conflict: boolean; seconds: number } => entry.seconds !== null,
  );
  let measuredTerminalSessionSeconds: number | null = measured.length
    ? measured.reduce((sum, entry) => sum + entry.seconds, 0)
    : null;
  if (
    measuredTerminalSessionSeconds !== null &&
    !Number.isSafeInteger(Math.ceil(measuredTerminalSessionSeconds))
  ) {
    measuredTerminalSessionSeconds = null;
    blockingReasons.push('measured-duration-overflow');
  }
  const conflictingSessions = usages.filter((entry) => entry.conflict).length;
  const unresolvedSessions = usages.length - measured.length;
  if (conflictingSessions) blockingReasons.push('conflicting-session-evidence');
  if (unresolvedSessions) blockingReasons.push('session-measurements-incomplete');
  return {
    ledger,
    report: {
      status: 'blocked',
      allocationAllowed: false,
      allowanceSeconds,
      ...stamp,
      ledgerStatus: ledger ? 'available' : 'invalid',
      measuredTerminalSessionSeconds,
      measuredTerminalSessions: measured.length,
      retainedSessions: ledger?.sessions.length ?? 0,
      unresolvedSessions,
      conflictingSessions,
      sessionsWithReadFailures:
        ledger?.sessions.filter((entry) => entry.readFailures.length > 0).length ?? 0,
      remainingMinutes: null,
      completeOfflineMatrixCostMinutes: null,
      estimatedSuccessfulCompleteRuns: null,
      projectedExhaustion: null,
      firstUnfundableDate: null,
      nextMonthlyDates: nextMonthlyDates(stamp.observedAt),
      blockingReasons,
      assumptions: [
        'The 60-minute allowance is lifetime and never renews.',
        'Measured terminal session seconds are deduplicated elapsed time, not verified charged minutes.',
        'Retained history cannot establish deleted, expired or other-account-user usage.',
        'The known subtotal excludes unresolved or conflicting sessions; missing measurements are not zero.',
        'An infrastructure smoke does not measure the complete installed-phone offline matrix.',
        'Monthly runs are Safari acceptance on the 1st, Android Chrome acceptance on the 2nd and Android Firefox tab acceptance on the 3rd, each at 09:17 UTC; GitHub scheduling can be delayed.',
        'Unknown sufficient quota blocks devices while the scheduled report remains enabled.',
      ],
    },
  };
}
