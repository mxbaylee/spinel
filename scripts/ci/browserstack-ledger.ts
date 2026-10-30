// Durable observations are evidence, not a credit balance. No provider calls here.
import { createHash } from 'node:crypto';
export const ledgerLimits = Object.freeze({
  bytes: 1_048_576,
  reports: 1024,
  sessions: 4096,
  observations: 8192,
  reservations: 1024,
});
export const lifetimeSeconds = 3600;
export const ownerBaselineReportId =
  'bd3c8f497d6fe818b5759aeeccb4d4204d0aeaf137d3b63735171776b80fee35';
export const monthlyCron = '15 17 1 * *';
const statuses = [
  'done',
  'passed',
  'failed',
  'error',
  'timeout',
  'running',
  'queued',
  'unmarked',
  'unknown',
];
type Measurement = {
  durationSeconds: number | null;
  providerStatus: string;
  executionStatus: string;
  createdAt: string | null;
};
type Observation =
  { outcome: 'available'; data: Measurement } | { outcome: 'unavailable'; reason: string };
export type SmokeExecution = {
  run: string;
  sourceSha: string;
  testedSha: string;
  outcome: 'passed' | 'failed';
  sessionIds: string[];
};
export type OwnerBaseline = {
  kind: 'owner-attested';
  source: 'owner-chat-2026-10-29';
  statement: 'Only these Spinel sessions';
  unobservedPriorSeconds: 0;
  questionKnownSessions: 6;
  subsequentlyObservedSessions: 15;
  reportId: string;
  sessionIds: string[];
};
export type LifetimeLedger = {
  version: 1;
  revision: number;
  allowanceSeconds: 3600;
  baseline: OwnerBaseline | null;
  chargingRule: 'unverified';
  fullMatrixCostSeconds: null;
  reports: {
    id: string;
    run: string;
    sourceSha: string;
    testedSha: string;
    observedAt: string;
    collectionStatus: 'passed' | 'failed';
    partialHistory: boolean;
  }[];
  sessions: {
    sessionId: string;
    buildIds: string[];
    observations: { evidence: Observation; reportIds: string[] }[];
  }[];
  smokeExecutions: SmokeExecution[];
  // Never expire or release an uncertain reservation merely because a runner
  // died or a later retained-history page cannot find its sessions.
  reservations: {
    run: string;
    attempt: number;
    reservedSeconds: number;
    createdAt: string;
    state: 'reserved' | 'uncertain';
    sessionIds: string[];
  }[];
};
const refused = () => new Error('ledger-evidence-invalid');
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw refused();
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, expected: string[]) => {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw refused();
};
const text = (value: unknown, pattern: RegExp) => {
  if (typeof value !== 'string' || !pattern.test(value)) throw refused();
  return value;
};
const id = (value: unknown) => text(value, /^[a-f0-9]{40}$/);
const digest = (value: unknown) => text(value, /^[a-f0-9]{64}$/);
const run = (value: unknown) =>
  text(value, /^https:\/\/github\.com\/mxbaylee\/spinel\/actions\/runs\/[1-9][0-9]{0,19}$/);
const date = (value: unknown) => {
  const result = text(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result)
    throw refused();
  return result;
};
const integer = (value: unknown, min = 0) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw refused();
  return value;
};
const list = (value: unknown, maximum: number) => {
  if (!Array.isArray(value) || value.length > maximum) throw refused();
  return value as unknown[];
};
const unique = <T>(values: T[]) => {
  if (new Set(values).size !== values.length) throw refused();
  return values;
};
function observation(value: unknown): Observation {
  const input = object(value);
  if (input.outcome === 'unavailable') {
    keys(input, ['outcome', 'reason']);
    return {
      outcome: 'unavailable',
      reason: text(
        input.reason,
        /^(missing-credentials|http-\d{3}|invalid-response|response-too-large|request-timeout|deadline-exceeded|request-limit|request-failed|session-identity-mismatch)$/,
      ),
    };
  }
  keys(input, ['outcome', 'data']);
  if (input.outcome !== 'available') throw refused();
  const data = object(input.data);
  keys(data, ['durationSeconds', 'providerStatus', 'executionStatus', 'createdAt']);
  if (
    data.durationSeconds !== null &&
    (typeof data.durationSeconds !== 'number' ||
      !Number.isFinite(data.durationSeconds) ||
      data.durationSeconds < 0 ||
      data.durationSeconds > Number.MAX_SAFE_INTEGER)
  )
    throw refused();
  if (
    typeof data.providerStatus !== 'string' ||
    !statuses.includes(data.providerStatus) ||
    typeof data.executionStatus !== 'string' ||
    !['done', 'error', 'timeout', 'running', 'queued', 'unknown'].includes(data.executionStatus)
  )
    throw refused();
  return {
    outcome: 'available',
    data: {
      durationSeconds: data.durationSeconds as number | null,
      providerStatus: data.providerStatus,
      executionStatus: data.executionStatus,
      createdAt: data.createdAt === null ? null : date(data.createdAt),
    },
  };
}
function smoke(value: unknown): SmokeExecution {
  const input = object(value);
  keys(input, ['run', 'sourceSha', 'testedSha', 'outcome', 'sessionIds']);
  if (input.outcome !== 'passed' && input.outcome !== 'failed') throw refused();
  const sessionIds = unique(list(input.sessionIds, 3).map(id));
  if (sessionIds.length !== 3) throw refused();
  return {
    run: run(input.run),
    sourceSha: id(input.sourceSha),
    testedSha: id(input.testedSha),
    outcome: input.outcome,
    sessionIds,
  };
}
export function emptyLedger(executions: SmokeExecution[]): LifetimeLedger {
  return {
    version: 1,
    revision: 0,
    allowanceSeconds: 3600,
    baseline: null,
    chargingRule: 'unverified',
    fullMatrixCostSeconds: null,
    reports: [],
    sessions: [],
    smokeExecutions: executions.map(smoke),
    reservations: [],
  };
}
export function readLedger(bytes: Uint8Array): LifetimeLedger {
  if (bytes.byteLength > ledgerLimits.bytes) throw new Error('ledger-size-limit');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw refused();
  }
  const input = object(value);
  keys(input, [
    'version',
    'revision',
    'allowanceSeconds',
    'baseline',
    'chargingRule',
    'fullMatrixCostSeconds',
    'reports',
    'sessions',
    'smokeExecutions',
    'reservations',
  ]);
  if (
    input.version !== 1 ||
    input.allowanceSeconds !== 3600 ||
    input.chargingRule !== 'unverified' ||
    input.fullMatrixCostSeconds !== null
  )
    throw refused();
  const reports = list(input.reports, ledgerLimits.reports).map((value) => {
    const row = object(value);
    keys(row, [
      'id',
      'run',
      'sourceSha',
      'testedSha',
      'observedAt',
      'collectionStatus',
      'partialHistory',
    ]);
    if (
      (row.collectionStatus !== 'passed' && row.collectionStatus !== 'failed') ||
      typeof row.partialHistory !== 'boolean'
    )
      throw refused();
    return {
      id: digest(row.id),
      run: run(row.run),
      sourceSha: id(row.sourceSha),
      testedSha: id(row.testedSha),
      observedAt: date(row.observedAt),
      collectionStatus: row.collectionStatus as 'passed' | 'failed',
      partialHistory: row.partialHistory,
    };
  });
  const reportIds = new Set(unique(reports.map(({ id }) => id)));
  let observations = 0;
  const sessions = list(input.sessions, ledgerLimits.sessions).map((value) => {
    const row = object(value);
    keys(row, ['sessionId', 'buildIds', 'observations']);
    const entries = list(row.observations, ledgerLimits.observations).map((value) => {
      if (++observations > ledgerLimits.observations) throw refused();
      const entry = object(value);
      keys(entry, ['evidence', 'reportIds']);
      const references = unique(list(entry.reportIds, ledgerLimits.reports).map(digest));
      if (!references.length || references.some((id) => !reportIds.has(id))) throw refused();
      return { evidence: observation(entry.evidence), reportIds: references };
    });
    if (!entries.length) throw refused();
    unique(entries.map(({ evidence }) => JSON.stringify(evidence)));
    return {
      sessionId: id(row.sessionId),
      buildIds: unique(list(row.buildIds, ledgerLimits.sessions).map(id)),
      observations: entries,
    };
  });
  unique(sessions.map(({ sessionId }) => sessionId));
  const executions = list(input.smokeExecutions, ledgerLimits.reports).map(smoke);
  unique(executions.map(({ run }) => run));
  unique(executions.flatMap(({ sessionIds }) => sessionIds));
  const reservations: LifetimeLedger['reservations'] = list(
    input.reservations,
    ledgerLimits.reservations,
  ).map((value) => {
    const row = object(value);
    keys(row, ['run', 'attempt', 'reservedSeconds', 'createdAt', 'state', 'sessionIds']);
    if (row.state !== 'reserved' && row.state !== 'uncertain') throw refused();
    return {
      run: run(row.run),
      attempt: integer(row.attempt, 1),
      reservedSeconds: integer(row.reservedSeconds, 1),
      createdAt: date(row.createdAt),
      state: row.state,
      sessionIds: unique(list(row.sessionIds, ledgerLimits.sessions).map(id)),
    };
  });
  unique(reservations.map(({ run, attempt }) => `${run}:${attempt}`));
  let baseline: OwnerBaseline | null = null;
  if (input.baseline !== null) {
    const row = object(input.baseline);
    keys(row, [
      'kind',
      'source',
      'statement',
      'unobservedPriorSeconds',
      'questionKnownSessions',
      'subsequentlyObservedSessions',
      'reportId',
      'sessionIds',
    ]);
    if (
      row.kind !== 'owner-attested' ||
      row.source !== 'owner-chat-2026-10-29' ||
      row.statement !== 'Only these Spinel sessions' ||
      row.unobservedPriorSeconds !== 0 ||
      row.questionKnownSessions !== 6 ||
      row.subsequentlyObservedSessions !== 15
    )
      throw refused();
    const reportId = digest(row.reportId),
      sessionIds = unique(list(row.sessionIds, 15).map(id));
    const observed = sessions
      .filter((session) => session.observations.some((entry) => entry.reportIds.includes(reportId)))
      .map(({ sessionId }) => sessionId);
    if (
      reportId !== ownerBaselineReportId ||
      !reportIds.has(reportId) ||
      sessionIds.length !== 15 ||
      observed.length !== 15 ||
      sessionIds.some((id) => !observed.includes(id))
    )
      throw refused();
    baseline = {
      kind: 'owner-attested',
      source: 'owner-chat-2026-10-29',
      statement: 'Only these Spinel sessions',
      unobservedPriorSeconds: 0,
      questionKnownSessions: 6,
      subsequentlyObservedSessions: 15,
      reportId,
      sessionIds,
    };
  }
  return {
    version: 1,
    revision: integer(input.revision),
    allowanceSeconds: 3600,
    baseline,
    chargingRule: 'unverified',
    fullMatrixCostSeconds: null,
    reports,
    sessions,
    smokeExecutions: executions,
    reservations,
  };
}
export const ledgerBytes = (ledger: LifetimeLedger) =>
  Buffer.from(JSON.stringify(ledger, null, 2) + '\n');
export function ingestQuota(ledger: LifetimeLedger, bytes: Uint8Array): LifetimeLedger {
  // Validate the old durable record before deriving a replacement. Never mutate
  // it in place, discard an old measurement, or reset an incomplete ledger.
  const next = readLedger(ledgerBytes(ledger));
  if (bytes.byteLength > ledgerLimits.bytes) throw new Error('ledger-size-limit');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw refused();
  }
  const report = object(parsed);
  if (
    report.mode !== 'quota' ||
    report.allocationAllowed !== false ||
    (report.status !== 'passed' && report.status !== 'failed')
  )
    throw refused();
  const reportId = createHash('sha256').update(bytes).digest('hex');
  if (next.reports.some(({ id }) => id === reportId)) return next;
  const history = object(report.history);
  if (
    history.scope !== 'credential-visible-retained-builds-and-sessions' ||
    history.snapshot !== 'non-atomic'
  )
    throw refused();
  const buildPagination = object(history.buildPagination);
  const builds = list(history.builds, 50).map(object);
  const partial =
    buildPagination.outcome !== 'exhausted' ||
    history.deadlineExceeded !== false ||
    builds.some((build) => object(build.pagination).outcome !== 'exhausted');
  next.reports.push({
    id: reportId,
    run: run(report.run),
    sourceSha: id(report.sourceSha),
    testedSha: id(report.testedSha),
    observedAt: date(report.date),
    collectionStatus: report.status as 'passed' | 'failed',
    partialHistory: partial,
  });
  const entries = list(history.sessions, 200).map(object);
  unique(entries.map((entry) => id(entry.sessionId)));
  for (const entry of entries) {
    const sessionId = id(entry.sessionId);
    let stored = next.sessions.find((value) => value.sessionId === sessionId);
    if (!stored) {
      stored = { sessionId, buildIds: [], observations: [] };
      next.sessions.push(stored);
    }
    for (const buildId of unique(list(entry.buildIds, 50).map(id)))
      if (!stored.buildIds.includes(buildId)) stored.buildIds.push(buildId);
    for (const observed of list(entry.observations, 640).map(object)) {
      const evidence = observation(observed.evidence);
      const previous = stored.observations.find(
        (value) => JSON.stringify(value.evidence) === JSON.stringify(evidence),
      );
      if (previous) {
        if (!previous.reportIds.includes(reportId)) previous.reportIds.push(reportId);
      } else stored.observations.push({ evidence, reportIds: [reportId] });
    }
  }
  next.revision++;
  return readLedger(ledgerBytes(next));
}
// This records the owner's explicit statement, never infers it from provider
// history. The caller must select the preserved fifteen-session observation.
export function attestOwnerBaseline(ledger: LifetimeLedger, reportId: string): LifetimeLedger {
  const next = readLedger(ledgerBytes(ledger));
  if (next.baseline) {
    if (next.baseline.reportId !== reportId) throw refused();
    return next;
  }
  next.baseline = {
    kind: 'owner-attested',
    source: 'owner-chat-2026-10-29',
    statement: 'Only these Spinel sessions',
    unobservedPriorSeconds: 0,
    questionKnownSessions: 6,
    subsequentlyObservedSessions: 15,
    reportId,
    sessionIds: next.sessions
      .filter((session) => session.observations.some((entry) => entry.reportIds.includes(reportId)))
      .map(({ sessionId }) => sessionId),
  };
  next.revision++;
  return readLedger(ledgerBytes(next));
}
function measurement(session: LifetimeLedger['sessions'][number]) {
  const terminal = session.observations.flatMap(({ evidence }) =>
    evidence.outcome === 'available' &&
    evidence.data.durationSeconds !== null &&
    evidence.data.createdAt !== null &&
    !['running', 'queued', 'unknown'].includes(evidence.data.providerStatus) &&
    ['done', 'error', 'timeout'].includes(evidence.data.executionStatus)
      ? [evidence.data]
      : [],
  );
  const distinct = new Map(
    terminal.map((value) => [`${value.createdAt}:${value.durationSeconds}`, value]),
  );
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}
export function monthlyDates(now: Date, count = 6): string[] {
  if (
    !Number.isFinite(now.getTime()) ||
    now.getUTCFullYear() < 2000 ||
    now.getUTCFullYear() > 9000 ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > 10_000
  )
    throw refused();
  let month = now.getUTCMonth(),
    year = now.getUTCFullYear();
  if (Date.UTC(year, month, 1, 17, 15) <= now.getTime()) month++;
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(year, month + index, 1, 17, 15)).toISOString(),
  );
}
export function budgetReport(ledger: LifetimeLedger, now: Date) {
  const checked = readLedger(ledgerBytes(ledger));
  const measured = new Map(
    checked.sessions.map((session) => [session.sessionId, measurement(session)]),
  );
  const known = [...measured.values()].filter((value) => value !== null);
  const reportedSeconds = known.reduce((sum, value) => sum + value.durationSeconds!, 0);
  if (!Number.isFinite(reportedSeconds) || reportedSeconds > Number.MAX_SAFE_INTEGER)
    throw refused();
  // Imported older evidence must not hide a newer failed/partial observation.
  // At an equal timestamp retain the less certain interpretation.
  const latest = checked.reports.reduce<LifetimeLedger['reports'][number] | undefined>(
    (latest, report) =>
      !latest ||
      report.observedAt > latest.observedAt ||
      (report.observedAt === latest.observedAt &&
        (report.partialHistory || report.collectionStatus === 'failed'))
        ? report
        : latest,
    undefined,
  );
  const incomplete = !known.length || known.length !== checked.sessions.length;
  const partial = !latest || latest.partialHistory || latest.collectionStatus !== 'passed';
  const unresolved = checked.reservations.length > 0;
  const rounded = (seconds: number, quantum: number) => {
    const result = Math.ceil(seconds / quantum) * quantum;
    if (!Number.isSafeInteger(result)) throw refused();
    return result;
  };
  const sum = (values: number[]) => {
    let total = 0;
    for (const value of values) {
      total += value;
      if (!Number.isSafeInteger(total)) throw refused();
    }
    return total;
  };
  const scenarios = [];
  for (const earlierSeconds of checked.baseline ? [0] : [0, 900])
    for (const quantumSeconds of [1, 60]) {
      const smokeCosts = checked.smokeExecutions.map(({ sessionIds }) =>
        sessionIds.every((id) => measured.get(id))
          ? sum(sessionIds.map((id) => rounded(measured.get(id)!.durationSeconds!, quantumSeconds)))
          : null,
      );
      const rate =
        smokeCosts.length && smokeCosts.every((value) => value !== null)
          ? sum(smokeCosts.map((value) => value!)) / smokeCosts.length
          : null;
      const assumedConsumed =
        incomplete || partial || unresolved
          ? null
          : sum([
              earlierSeconds,
              ...known.map((value) => rounded(value.durationSeconds!, quantumSeconds)),
            ]);
      const remaining =
        assumedConsumed === null ? null : Math.max(0, lifetimeSeconds - assumedConsumed);
      const attempts =
        remaining === null || rate === null || rate <= 0 ? null : Math.floor(remaining / rate);
      scenarios.push({
        illustrationOnly: true,
        assumedEarlierChargedSeconds: earlierSeconds,
        assumedPerSessionCeilingSeconds: quantumSeconds,
        assumptions: [
          'No unrecorded use beyond the explicit earlier offset',
          'Reported elapsed duration maps to this assumed charge rule',
          'Future attempts cost the observed smoke mean and succeed without additional retries',
          'One attempt per monthly date; extra runs advance exhaustion',
        ],
        scope: 'infrastructure-smoke-only-not-offline-matrix',
        measuredCompleteSmokeAttempts: smokeCosts.filter((value) => value !== null).length,
        measuredFailedSmokeAttempts: checked.smokeExecutions.filter(
          (execution, index) => execution.outcome === 'failed' && smokeCosts[index] !== null,
        ).length,
        assumedMeanSmokeChargedSeconds: rate,
        assumedRemainingSeconds: remaining,
        estimatedSuccessfulSmokeRuns: attempts,
        firstUnaffordableMonthlySmoke:
          attempts === null || attempts >= 10_000 ? null : monthlyDates(now, attempts + 1).at(-1),
        estimatedFullMatrixRuns: null,
      });
    }
  return {
    status: 'failed',
    allocationAllowed: false,
    authoritative: {
      allowanceSeconds: lifetimeSeconds,
      remainingSeconds: null,
      remainingBoundsSeconds: { minimum: 0, maximum: lifetimeSeconds },
      fullMatrixCostSeconds: null,
      estimatedSuccessfulRuns: null,
      projectedExhaustion: null,
      baseline: checked.baseline,
      reasons: [
        ...(checked.baseline ? [] : ['older-account-usage-unknown']),
        'charge-mapping-unverified',
        'complete-matrix-cost-unknown',
        ...(checked.reservations.length ? ['unsettled-reservations'] : []),
        ...(incomplete ? ['missing-or-conflicting-session-measurements'] : []),
        ...(partial ? ['latest-history-incomplete'] : []),
      ],
    },
    observed: {
      sessions: checked.sessions.length,
      terminalMeasuredSessions: known.length,
      reportedDurationSeconds: reportedSeconds,
      unmappedExecutionSessions: checked.sessions.filter(
        ({ sessionId }) =>
          !checked.smokeExecutions.some(({ sessionIds }) => sessionIds.includes(sessionId)),
      ).length,
      latestCollection: latest ?? null,
    },
    schedule: {
      configured: false,
      cron: monthlyCron,
      timeZone: 'UTC',
      nextMonthlyDates: monthlyDates(now),
      delivery: 'Scheduled targets, not guaranteed execution times',
    },
    conditionalScenarios: scenarios,
  };
}
