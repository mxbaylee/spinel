import { createHash } from 'node:crypto';
import {
  createBudgetReport,
  monthlyPlanDate,
  monthlyScopes,
  nextMonthlyDates,
  readBudgetLedger,
  scheduledRunDate,
  type BudgetLedger,
  type BudgetSource,
  type QuotaEvidence,
} from './browserstack-budget.ts';
import { retainedSessionIds, sessionMeasurementConflict } from './browserstack-quota.ts';
import {
  capabilityScopeDefinition,
  readCapabilityScope,
  type CapabilityScope,
} from './browserstack-scope.ts';

export type AdmissionPolicy = {
  schemaVersion: 1;
  basis: 'owner-authorized-estimate';
  decisionDate: string;
  decisionSource: string;
  method: string;
  lifetimeAllowanceSeconds: 3600;
  assumedUnobservedUsageSeconds: number;
  chargedSecondsPerElapsedSecond: number;
  safetyReserveSeconds: number;
  capabilityReservationSeconds: 900;
  capabilityLaneOperationalSeconds: 180;
  capabilityLaneCleanupSeconds: 15;
  capabilityLaneIdleSeconds: 60;
  capabilityLaneCount: 3;
};
export type ReservationIdentity = {
  runId: string;
  attempt: string;
  sourceSha: string;
  testedSha: string;
};
export type Reservation = ReservationIdentity & {
  id: string;
  policySha256: string;
  seconds: number;
  reservedAt: string;
  baselineSessionIds: string[];
  sessionIds: string[];
  status: 'reserved' | 'held' | 'reconciled';
  uncertainAllocation: boolean;
  finishedAt: string | null;
  reconciledAt: string | null;
  // Absent on historical/failed/unknown scopes; never inferred from provider status.
  successfulScope?: CapabilityScope;
};
export type AdmissionState = { schemaVersion: 1; reservations: Reservation[] };
export type ReservationReceipt = ReservationIdentity & {
  finishedAt: string;
  sessionIds: string[];
  uncertainAllocation: boolean;
};
type AdmissionInput = {
  policy: unknown;
  state: unknown | null;
  // The validated snapshot loaded before collection, never the current merged ledger.
  ledger: unknown;
  evidence: QuotaEvidence;
  source: BudgetSource;
};
export type SuccessfulScopeCost = ReservationIdentity & {
  scope: CapabilityScope;
  reservationId: string;
  sessionIds: string[];
  finishedAt: string;
  reconciledAt: string;
  measuredElapsedSeconds: number;
  estimatedChargedSeconds: number;
};
type CompletePaidCoverage = {
  kind: 'sum-of-successful-component-samples';
  sourceSha: string;
  testedSha: string;
  matchesReportIdentity: boolean;
  latestComponentFinishedAt: string;
  components: SuccessfulScopeCost[];
  measuredElapsedSeconds: number;
  forecast: {
    scenario: 'one-complete-paid-plan-per-month-no-other-use';
    actualMonthlyScopes: (typeof monthlyScopes)[number]['scope'][];
    roundedEstimatedComponentCharges: number[];
    roundedEstimatedBatchChargeSeconds: number;
    reservationThresholdSeconds: number;
    requiredStartingUsableSeconds: number;
    startingUsableSeconds: number;
    estimatedSuccessfulRuns: number;
    lastFundableDate: string | null;
    firstUnfundableDate: string;
  } | null;
};
export type EstimatedBudgetReport = {
  basis: 'owner-authorized-estimate';
  providerVerified: false;
  allocationAllowed: false;
  capabilitySufficient: boolean;
  policySha256: string;
  measuredElapsedSeconds: number | null;
  reusedFinalizedHistory: {
    sessionId: string;
    durationSeconds: number;
    unavailableReason: 'http-404' | 'http-410';
    lastMeasured: BudgetSource;
  }[];
  assumedUnobservedUsageSeconds: number;
  chargedSecondsPerElapsedSecond: number;
  estimatedUsedSeconds: number | null;
  estimatedRemainingSeconds: number | null;
  estimatedRemainingMinutes: number | null;
  outstandingHoldSeconds: number;
  safetyReserveSeconds: number;
  estimatedUsableSeconds: number | null;
  capabilityReservationSeconds: number;
  estimatedAdditionalCapabilityReservations: number | null;
  lastEstimatedFundableCapabilityDate: string | null;
  firstEstimatedUnfundableCapabilityDate: string | null;
  nextMonthlyDates: string[];
  // Sum of approved paid-scope samples, not a single observed full-plan execution.
  completeOfflineMatrixCostMinutes: number | null;
  estimatedSuccessfulCompleteRuns: number | null;
  // First unfundable date in the hypothetical complete-plan monthly scenario.
  // It is neither a zero-balance date nor the actual Safari-only schedule.
  projectedFullMatrixExhaustion: string | null;
  completePaidCoverage: CompletePaidCoverage | null;
  successfulScopeCosts: SuccessfulScopeCost[];
  blockingReasons: string[];
  assumptions: string[];
};
const identityKeys = ['runId', 'attempt', 'sourceSha', 'testedSha'];
const approvedPaidScopeOrder = [
  'safari-acceptance',
  'chrome-acceptance',
  'chrome-tab-acceptance',
  'firefox-tab-acceptance',
  'safari-tab-acceptance',
] as const satisfies readonly CapabilityScope[];
const reservationKeys = [
  ...identityKeys,
  'id',
  'policySha256',
  'seconds',
  'reservedAt',
  'baselineSessionIds',
  'sessionIds',
  'status',
  'uncertainAllocation',
  'finishedAt',
  'reconciledAt',
];

function fail(kind: string): never {
  throw new Error(`admission-${kind}`);
}
function row(value: unknown, keys: string[], kind: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    return fail(kind);
  return value as Record<string, unknown>;
}
function record(value: unknown, kind: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(kind);
  return value as Record<string, unknown>;
}
function knownScope(value: unknown): CapabilityScope | undefined {
  // The runner's omitted scope defaults to all; absent historical evidence cannot.
  if (typeof value !== 'string') return undefined;
  try {
    return readCapabilityScope(value);
  } catch {
    return undefined;
  }
}
function bounded(value: unknown, minimum: number, maximum: number, kind: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
    return fail(kind);
  return value;
}
function timestamp(value: unknown, kind: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return fail(kind);
  const date = Date.parse(value);
  if (!Number.isFinite(date) || new Date(date).toISOString() !== value) return fail(kind);
  return value;
}
function hash(value: unknown, length: 40 | 64, kind: string): string {
  if (typeof value !== 'string' || value.length !== length || !/^[a-f0-9]+$/.test(value))
    return fail(kind);
  return value;
}
function ids(value: unknown, maximum: number, kind: string): string[] {
  if (!Array.isArray(value) || value.length > maximum) return fail(kind);
  const parsed = value.map((entry) => hash(entry, 40, kind));
  if (new Set(parsed).size !== parsed.length) return fail(kind);
  return parsed;
}
function identity(value: Record<string, unknown>, kind: string): ReservationIdentity {
  if (
    typeof value.runId !== 'string' ||
    !/^[1-9]\d{0,19}$/.test(value.runId) ||
    typeof value.attempt !== 'string' ||
    !/^[1-9]\d{0,5}$/.test(value.attempt)
  )
    return fail(kind);
  return {
    runId: value.runId,
    attempt: value.attempt,
    sourceSha: hash(value.sourceSha, 40, kind),
    testedSha: hash(value.testedSha, 40, kind),
  };
}
const idFor = (value: ReservationIdentity) => `${value.runId}-${value.attempt}-${value.sourceSha}`;
const sameIdentity = (a: ReservationIdentity, b: ReservationIdentity) =>
  identityKeys.every(
    (key) => a[key as keyof ReservationIdentity] === b[key as keyof ReservationIdentity],
  );

/** These are explicit owner-authorized estimates, never measured account/billing facts. */
export function readAdmissionPolicy(value: unknown): AdmissionPolicy {
  const entry = row(
    value,
    [
      'schemaVersion',
      'basis',
      'decisionDate',
      'decisionSource',
      'method',
      'lifetimeAllowanceSeconds',
      'assumedUnobservedUsageSeconds',
      'chargedSecondsPerElapsedSecond',
      'safetyReserveSeconds',
      'capabilityReservationSeconds',
      'capabilityLaneOperationalSeconds',
      'capabilityLaneCleanupSeconds',
      'capabilityLaneIdleSeconds',
      'capabilityLaneCount',
    ],
    'invalid-policy',
  );
  if (
    entry.schemaVersion !== 1 ||
    entry.basis !== 'owner-authorized-estimate' ||
    entry.lifetimeAllowanceSeconds !== 3600 ||
    entry.capabilityReservationSeconds !== 900 ||
    entry.capabilityLaneOperationalSeconds !== 180 ||
    entry.capabilityLaneCleanupSeconds !== 15 ||
    entry.capabilityLaneIdleSeconds !== 60 ||
    entry.capabilityLaneCount !== 3 ||
    typeof entry.decisionDate !== 'string' ||
    !/^\d{4}-\d\d-\d\d$/.test(entry.decisionDate)
  )
    return fail('invalid-policy');
  timestamp(`${entry.decisionDate}T00:00:00.000Z`, 'invalid-policy');
  for (const key of ['decisionSource', 'method'])
    if (
      typeof entry[key] !== 'string' ||
      entry[key].length < 10 ||
      entry[key].length > 1000 ||
      Array.from(entry[key]).some((character) => character.charCodeAt(0) < 32)
    )
      return fail('invalid-policy');
  return {
    schemaVersion: 1,
    basis: 'owner-authorized-estimate',
    decisionDate: entry.decisionDate,
    decisionSource: entry.decisionSource as string,
    method: entry.method as string,
    lifetimeAllowanceSeconds: 3600,
    assumedUnobservedUsageSeconds: bounded(
      entry.assumedUnobservedUsageSeconds,
      0,
      Number.MAX_SAFE_INTEGER,
      'invalid-policy',
    ),
    chargedSecondsPerElapsedSecond: bounded(
      entry.chargedSecondsPerElapsedSecond,
      1,
      100,
      'invalid-policy',
    ),
    safetyReserveSeconds: bounded(entry.safetyReserveSeconds, 300, 3600, 'invalid-policy'),
    capabilityReservationSeconds: 900,
    capabilityLaneOperationalSeconds: 180,
    capabilityLaneCleanupSeconds: 15,
    capabilityLaneIdleSeconds: 60,
    capabilityLaneCount: 3,
  };
}
export function readAdmissionState(value: unknown): AdmissionState {
  const entry = row(value, ['schemaVersion', 'reservations'], 'invalid-state');
  if (
    entry.schemaVersion !== 1 ||
    !Array.isArray(entry.reservations) ||
    entry.reservations.length > 256
  )
    return fail('invalid-state');
  const runAttempts = new Set<string>(),
    sessionIds = new Set<string>();
  const reservations = entry.reservations.map((value): Reservation => {
    const data = row(
      value,
      Object.hasOwn(record(value, 'invalid-state'), 'successfulScope')
        ? [...reservationKeys, 'successfulScope']
        : reservationKeys,
      'invalid-state',
    );
    const identified = identity(data, 'invalid-state');
    const runAttempt = `${identified.runId}-${identified.attempt}`;
    if (runAttempts.has(runAttempt) || data.id !== idFor(identified)) return fail('invalid-state');
    runAttempts.add(runAttempt);
    const reservedAt = timestamp(data.reservedAt, 'invalid-state');
    const finishedAt =
      data.finishedAt === null ? null : timestamp(data.finishedAt, 'invalid-state');
    const reconciledAt =
      data.reconciledAt === null ? null : timestamp(data.reconciledAt, 'invalid-state');
    const baselineSessionIds = ids(data.baselineSessionIds, 10_000, 'invalid-state');
    const allocated = ids(data.sessionIds, 3, 'invalid-state');
    const hasSuccessfulScope = Object.hasOwn(data, 'successfulScope');
    const successfulScope = hasSuccessfulScope ? data.successfulScope : undefined;
    if (
      hasSuccessfulScope &&
      (knownScope(successfulScope) === undefined ||
        data.status === 'reserved' ||
        data.uncertainAllocation !== false ||
        allocated.length !== (successfulScope === 'all' ? 3 : 1))
    )
      return fail('invalid-state');
    if (
      typeof data.uncertainAllocation !== 'boolean' ||
      !['reserved', 'held', 'reconciled'].includes(data.status as string) ||
      (finishedAt !== null && finishedAt < reservedAt) ||
      (reconciledAt !== null && (finishedAt === null || reconciledAt < finishedAt)) ||
      (data.status === 'reserved' &&
        (finishedAt !== null ||
          reconciledAt !== null ||
          data.uncertainAllocation ||
          allocated.length)) ||
      (data.status === 'held' && (finishedAt === null || reconciledAt !== null)) ||
      (data.status === 'reconciled' &&
        (finishedAt === null || reconciledAt === null || data.uncertainAllocation))
    )
      return fail('invalid-state');
    for (const id of allocated) {
      if (baselineSessionIds.includes(id) || sessionIds.has(id)) return fail('invalid-state');
      sessionIds.add(id);
    }
    return {
      ...identified,
      id: data.id as string,
      policySha256: hash(data.policySha256, 64, 'invalid-state'),
      seconds: bounded(data.seconds, 900, 90_000, 'invalid-state'),
      reservedAt,
      baselineSessionIds,
      sessionIds: allocated,
      status: data.status as Reservation['status'],
      uncertainAllocation: data.uncertainAllocation,
      finishedAt,
      reconciledAt,
      ...(hasSuccessfulScope ? { successfulScope: successfulScope as CapabilityScope } : {}),
    };
  });
  return { schemaVersion: 1, reservations };
}
export function reservationForRun(value: unknown, requested: ReservationIdentity): Reservation {
  const expected = identity(row(requested, identityKeys, 'invalid-identity'), 'invalid-identity');
  const reservation = readAdmissionState(value).reservations.find((entry) =>
    sameIdentity(entry, expected),
  );
  if (!reservation || reservation.status !== 'reserved')
    return fail('pending-reservation-not-found');
  return reservation;
}

type SessionMeasurement = BudgetLedger['sessions'][number]['measurements'][number];
function terminal(
  value: Pick<
    SessionMeasurement,
    'durationSeconds' | 'createdAt' | 'providerStatus' | 'executionStatus'
  >,
) {
  return (
    value.durationSeconds !== null &&
    value.createdAt !== null &&
    !['running', 'queued', 'unknown'].includes(value.providerStatus) &&
    ['done', 'error', 'timeout'].includes(value.executionStatus)
  );
}
function ledgerSessionSeconds(entry: BudgetLedger['sessions'][number]): number | null {
  if (
    entry.collectorConflict ||
    entry.measurements.some((value, index) =>
      entry.measurements.slice(index + 1).some((other) => sessionMeasurementConflict(value, other)),
    )
  )
    return null;
  const latest = entry.measurements.reduce(
    (time, value) => (value.lastObserved.observedAt > time ? value.lastObserved.observedAt : time),
    '',
  );
  return (
    entry.measurements.find((value) => terminal(value) && value.lastObserved.observedAt === latest)
      ?.durationSeconds ?? null
  );
}
function measuredScopeCosts(
  state: AdmissionState,
  ledger: BudgetLedger,
  policy: AdmissionPolicy,
): SuccessfulScopeCost[] {
  const samples: SuccessfulScopeCost[] = [];
  for (const reservation of state.reservations) {
    if (!reservation.successfulScope || reservation.status !== 'reconciled') continue;
    const durations = reservation.sessionIds.map((id) => {
      const session = ledger.sessions.find((entry) => entry.sessionId === id);
      if (
        !session ||
        session.measurements.some(
          (value) =>
            value.createdAt !== null &&
            Date.parse(value.createdAt) + 1000 < Date.parse(reservation.reservedAt),
        )
      )
        return null;
      return ledgerSessionSeconds(session);
    });
    if (durations.some((value) => value === null)) continue;
    const measuredElapsedSeconds = durations.reduce<number>((sum, value) => sum + value!, 0);
    const estimatedChargedSeconds = measuredElapsedSeconds * policy.chargedSecondsPerElapsedSecond;
    if (!Number.isSafeInteger(Math.ceil(estimatedChargedSeconds))) continue;
    samples.push({
      scope: reservation.successfulScope,
      reservationId: reservation.id,
      runId: reservation.runId,
      attempt: reservation.attempt,
      sourceSha: reservation.sourceSha,
      testedSha: reservation.testedSha,
      sessionIds: [...reservation.sessionIds],
      finishedAt: reservation.finishedAt!,
      reconciledAt: reservation.reconciledAt!,
      measuredElapsedSeconds,
      estimatedChargedSeconds,
    });
  }
  return samples.sort(
    (a, b) =>
      a.finishedAt.localeCompare(b.finishedAt) || a.reservationId.localeCompare(b.reservationId),
  );
}
/** Cost evidence for the fixed paid plan; it grants no acceptance or spending authority. */
function completePaidCoverage(
  samples: SuccessfulScopeCost[],
  source: BudgetSource,
  usableSeconds: number | null,
  reservationSeconds: number,
  monthlyDate: (offset: number) => string,
): CompletePaidCoverage | null {
  const groups = new Map<string, Map<CapabilityScope, SuccessfulScopeCost>>();
  for (const sample of samples) {
    if (!(approvedPaidScopeOrder as readonly CapabilityScope[]).includes(sample.scope)) continue;
    const key = `${sample.sourceSha}:${sample.testedSha}`;
    const group = groups.get(key) ?? new Map<CapabilityScope, SuccessfulScopeCost>();
    const previous = group.get(sample.scope);
    if (
      !previous ||
      sample.finishedAt > previous.finishedAt ||
      (sample.finishedAt === previous.finishedAt && sample.reservationId > previous.reservationId)
    )
      group.set(sample.scope, sample);
    groups.set(key, group);
  }
  let selected: CompletePaidCoverage | null = null;
  for (const group of groups.values()) {
    if (approvedPaidScopeOrder.some((scope) => !group.has(scope))) continue;
    const components = approvedPaidScopeOrder.map((scope) => group.get(scope)!);
    const measuredElapsedSeconds = components.reduce(
      (sum, sample) => sum + sample.measuredElapsedSeconds,
      0,
    );
    if (!Number.isSafeInteger(Math.ceil(measuredElapsedSeconds))) continue;
    const latestComponentFinishedAt = components.reduce(
      (latest, sample) => (sample.finishedAt > latest ? sample.finishedAt : latest),
      '',
    );
    const candidate: CompletePaidCoverage = {
      kind: 'sum-of-successful-component-samples',
      sourceSha: components[0].sourceSha,
      testedSha: components[0].testedSha,
      matchesReportIdentity:
        components[0].sourceSha === source.sourceSha &&
        components[0].testedSha === source.testedSha,
      latestComponentFinishedAt,
      components,
      measuredElapsedSeconds,
      forecast: null,
    };
    if (
      !selected ||
      latestComponentFinishedAt > selected.latestComponentFinishedAt ||
      (latestComponentFinishedAt === selected.latestComponentFinishedAt &&
        `${candidate.sourceSha}:${candidate.testedSha}` >
          `${selected.sourceSha}:${selected.testedSha}`)
    )
      selected = candidate;
  }
  if (!selected) return null;
  const charges = selected.components.map((sample) => Math.ceil(sample.estimatedChargedSeconds));
  const reservationThresholdSeconds = Math.ceil(reservationSeconds);
  if (
    usableSeconds === null ||
    !Number.isFinite(usableSeconds) ||
    usableSeconds < 0 ||
    !Number.isSafeInteger(reservationThresholdSeconds) ||
    reservationThresholdSeconds <= 0 ||
    charges.some((charge) => !Number.isSafeInteger(charge) || charge <= 0)
  )
    return selected;
  let batchCharges = 0;
  let requiredStartingUsableSeconds = 0;
  for (const charge of charges) {
    requiredStartingUsableSeconds = Math.max(
      requiredStartingUsableSeconds,
      batchCharges + reservationThresholdSeconds,
    );
    batchCharges += charge;
  }
  requiredStartingUsableSeconds = Math.max(requiredStartingUsableSeconds, batchCharges);
  const startingUsableSeconds = Math.floor(usableSeconds);
  if (
    !Number.isSafeInteger(batchCharges) ||
    !Number.isSafeInteger(requiredStartingUsableSeconds) ||
    !Number.isSafeInteger(startingUsableSeconds)
  )
    return selected;
  const count =
    startingUsableSeconds < requiredStartingUsableSeconds
      ? 0
      : 1 + Math.floor((startingUsableSeconds - requiredStartingUsableSeconds) / batchCharges);
  selected.forecast = {
    scenario: 'one-complete-paid-plan-per-month-no-other-use',
    actualMonthlyScopes: monthlyScopes.map((entry) => entry.scope),
    roundedEstimatedComponentCharges: charges,
    roundedEstimatedBatchChargeSeconds: batchCharges,
    reservationThresholdSeconds,
    requiredStartingUsableSeconds,
    startingUsableSeconds,
    estimatedSuccessfulRuns: count,
    lastFundableDate: count > 0 ? monthlyDate(count - 1) : null,
    firstUnfundableDate: monthlyDate(count),
  };
  return selected;
}
function reusableFinalizedHistory(
  input: AdmissionInput,
  previous: BudgetLedger,
): EstimatedBudgetReport['reusedFinalizedHistory'] | null {
  const { evidence } = input;
  if (
    evidence.status !== 'failed' ||
    previous.lastObserved.observedAt >= input.source.observedAt ||
    evidence.plan.outcome !== 'available' ||
    evidence.plan.data.runningSessions !== 0 ||
    evidence.plan.data.queuedSessions !== 0 ||
    evidence.history.deadlineExceeded ||
    evidence.history.buildPagination.outcome !== 'exhausted' ||
    evidence.history.builds.some(
      (build) =>
        build.pagination.outcome !== 'exhausted' ||
        build.conflict ||
        build.providerStatuses.some((status) => ['running', 'queued', 'unknown'].includes(status)),
    ) ||
    evidence.sessions.length !== retainedSessionIds.length ||
    new Set(evidence.sessions.map((entry) => entry.sessionId)).size !== retainedSessionIds.length
  )
    return null;
  const reused: EstimatedBudgetReport['reusedFinalizedHistory'] = [];
  for (const entry of evidence.sessions) {
    if (!(retainedSessionIds as readonly string[]).includes(entry.sessionId)) return null;
    if (entry.evidence.outcome === 'available') {
      if (!terminal(entry.evidence.data)) return null;
      continue;
    }
    const reason = entry.evidence.reason;
    if (reason !== 'http-404' && reason !== 'http-410') return null;
    const recorded = previous.sessions.find((value) => value.sessionId === entry.sessionId);
    const seconds = recorded ? ledgerSessionSeconds(recorded) : null;
    if (!recorded || seconds === null) return null;
    const lastMeasured = recorded.measurements
      .filter(terminal)
      .sort((a, b) =>
        b.lastObserved.observedAt.localeCompare(a.lastObserved.observedAt),
      )[0].lastObserved;
    if (lastMeasured.observedAt >= input.source.observedAt) return null;
    reused.push({
      sessionId: entry.sessionId,
      durationSeconds: seconds,
      unavailableReason: reason,
      lastMeasured,
    });
  }
  if (!reused.length) return null;
  for (const entry of evidence.history.sessions) {
    const historical = reused.find((value) => value.sessionId === entry.sessionId);
    if (
      entry.conflict ||
      !entry.observations.length ||
      entry.observations.some(
        (value) =>
          value.evidence.outcome !== 'available' &&
          (value.source !== 'retained-smoke' ||
            !historical ||
            value.evidence.reason !== historical.unavailableReason),
      )
    )
      return null;
    const measuredNow = entry.observations.some(
      (value) => value.evidence.outcome === 'available' && terminal(value.evidence.data),
    );
    // A fresh listing that is active or missing a duration cannot be replaced
    // with an older measurement, even for a previously finalized smoke ID.
    if (
      !measuredNow &&
      (!historical ||
        entry.buildIds.length ||
        entry.observations.some((value) => value.evidence.outcome === 'available') ||
        evidence.history.builds.some((build) => build.sessionIds.includes(entry.sessionId)))
    )
      return null;
  }
  if (
    reused.some(
      (entry) =>
        !evidence.history.sessions.some(
          (value) =>
            value.sessionId === entry.sessionId &&
            value.observations.some(
              (observation) =>
                observation.source === 'retained-smoke' &&
                observation.evidence.outcome === 'unavailable' &&
                observation.evidence.reason === entry.unavailableReason,
            ),
        ),
    )
  )
    return null;
  return reused;
}
function prepare(input: AdmissionInput) {
  const policy = readAdmissionPolicy(input.policy);
  const state =
    input.state === null
      ? { schemaVersion: 1 as const, reservations: [] }
      : readAdmissionState(input.state);
  const previous = readBudgetLedger(input.ledger);
  const current = createBudgetReport({
    ...input.source,
    evidence: input.evidence,
    previousLedger: previous,
  });
  if (!current.ledger) return fail('invalid-current-ledger');
  const reusedFinalizedHistory = reusableFinalizedHistory(input, previous);
  const collectionSufficient =
    input.evidence.status === 'passed' || reusedFinalizedHistory !== null;
  const policySha256 = createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  return {
    policy,
    state,
    ledger: current.ledger,
    raw: current.report,
    policySha256,
    collectionSufficient,
    reusedFinalizedHistory: reusedFinalizedHistory ?? [],
  };
}
function estimate(input: AdmissionInput, prepared = prepare(input)): EstimatedBudgetReport {
  const { policy, state, ledger, raw, policySha256 } = prepared;
  const blockingReasons = raw.blockingReasons.filter(
    (reason) =>
      !(reason === 'current-collection-incomplete' && prepared.collectionSufficient) &&
      ![
        'authoritative-remaining-balance-unavailable',
        'account-wide-starting-usage-unverified',
        'charged-duration-mapping-unverified',
        'complete-offline-matrix-cost-unmeasured',
      ].includes(reason),
  );
  if (state.reservations.some((entry) => entry.status === 'reserved'))
    blockingReasons.push('pending-reservation');
  const policyMismatch = state.reservations.some(
    (entry) => entry.status !== 'reconciled' && entry.policySha256 !== policySha256,
  );
  if (policyMismatch) blockingReasons.push('outstanding-reservation-policy-mismatch');
  if (
    input.evidence.plan.outcome === 'available' &&
    input.evidence.plan.data.parallelSessionsAllowed < 1
  )
    blockingReasons.push('no-parallel-session-capacity');
  const measured = new Map(
    ledger.sessions.map((entry) => [entry.sessionId, ledgerSessionSeconds(entry)]),
  );
  const outstandingHoldSeconds = state.reservations.reduce((sum, reservation) => {
    if (reservation.status === 'reconciled') return sum;
    if (reservation.policySha256 !== policySha256) return sum + reservation.seconds;
    const counted =
      reservation.sessionIds.reduce((total, id) => total + (measured.get(id) ?? 0), 0) *
      policy.chargedSecondsPerElapsedSecond;
    // The ledger already charges measured associated sessions. Hold only the
    // remainder; an unknown allocation keeps that remainder instead of refunding it.
    return sum + Math.max(0, reservation.seconds - counted);
  }, 0);
  const measuredElapsedSeconds = raw.measuredTerminalSessionSeconds;
  const complete =
    !policyMismatch &&
    prepared.collectionSufficient &&
    raw.unresolvedSessions === 0 &&
    raw.conflictingSessions === 0;
  const used =
    measuredElapsedSeconds === null || !complete
      ? null
      : policy.assumedUnobservedUsageSeconds +
        measuredElapsedSeconds * policy.chargedSecondsPerElapsedSecond;
  const estimatedUsedSeconds = used !== null && Number.isSafeInteger(Math.ceil(used)) ? used : null;
  if (estimatedUsedSeconds === null) blockingReasons.push('estimated-usage-unavailable');
  const estimatedRemainingSeconds =
    estimatedUsedSeconds === null
      ? null
      : Math.max(0, policy.lifetimeAllowanceSeconds - estimatedUsedSeconds);
  const estimatedUsableSeconds =
    estimatedRemainingSeconds === null
      ? null
      : Math.max(
          0,
          estimatedRemainingSeconds - outstandingHoldSeconds - policy.safetyReserveSeconds,
        );
  const capabilityReservationSeconds =
    policy.capabilityReservationSeconds * policy.chargedSecondsPerElapsedSecond;
  if (estimatedRemainingSeconds === 0) blockingReasons.push('estimated-lifetime-budget-exhausted');
  else if (estimatedUsableSeconds !== null && estimatedUsableSeconds < capabilityReservationSeconds)
    blockingReasons.push('estimated-budget-below-complete-capability-reservation');
  const count =
    estimatedUsableSeconds === null
      ? null
      : Math.floor(estimatedUsableSeconds / capabilityReservationSeconds);
  const nextDates = nextMonthlyDates(input.source.observedAt);
  // Capability reservations follow the scheduled runs; complete plans are monthly.
  const forecast = (offset: number) => scheduledRunDate(input.source.observedAt, offset);
  const planDate = (offset: number) => monthlyPlanDate(input.source.observedAt, offset);
  const successfulScopeCosts = measuredScopeCosts(state, ledger, policy);
  const completeCoverage = completePaidCoverage(
    successfulScopeCosts,
    input.source,
    estimatedUsableSeconds,
    capabilityReservationSeconds,
    planDate,
  );
  return {
    basis: 'owner-authorized-estimate',
    providerVerified: false,
    allocationAllowed: false,
    capabilitySufficient: blockingReasons.length === 0,
    policySha256,
    measuredElapsedSeconds,
    reusedFinalizedHistory: prepared.reusedFinalizedHistory,
    assumedUnobservedUsageSeconds: policy.assumedUnobservedUsageSeconds,
    chargedSecondsPerElapsedSecond: policy.chargedSecondsPerElapsedSecond,
    estimatedUsedSeconds,
    estimatedRemainingSeconds,
    estimatedRemainingMinutes:
      estimatedRemainingSeconds === null ? null : estimatedRemainingSeconds / 60,
    outstandingHoldSeconds,
    safetyReserveSeconds: policy.safetyReserveSeconds,
    estimatedUsableSeconds,
    capabilityReservationSeconds,
    estimatedAdditionalCapabilityReservations: count,
    lastEstimatedFundableCapabilityDate: count !== null && count > 0 ? forecast(count - 1) : null,
    firstEstimatedUnfundableCapabilityDate: count === null ? null : forecast(count),
    nextMonthlyDates: nextDates,
    completeOfflineMatrixCostMinutes: completeCoverage
      ? completeCoverage.measuredElapsedSeconds / 60
      : null,
    estimatedSuccessfulCompleteRuns: completeCoverage?.forecast?.estimatedSuccessfulRuns ?? null,
    projectedFullMatrixExhaustion: completeCoverage?.forecast?.firstUnfundableDate ?? null,
    completePaidCoverage: completeCoverage,
    successfulScopeCosts,
    blockingReasons,
    assumptions: [
      policy.method,
      'The lifetime allowance never renews at a month boundary.',
      'The owner authorized directional estimation; this is not an authoritative provider balance.',
      ...(prepared.reusedFinalizedHistory.length
        ? [
            'Only 404/410 retained-smoke details reuse terminal measurements recorded before collection; raw failed reads remain in the evidence and ledger.',
          ]
        : []),
      'Safety reserve and outstanding reservation holds reduce spendable estimated credit.',
      'A completed uncertain allocation retains its unused hold; a missing receipt leaves a pending reservation.',
      'Capability count/calendar assume one full reservation per future scheduled run (three a month) and no other use; they do not predict successful offline-matrix runs.',
      'Successful-scope cost uses only a completed passing scope linked to reconciled terminal session measurements; missing historical scope evidence stays unknown.',
      'Successful-scope elapsed seconds are measured, while their charged seconds use the current unverified charging assumption. Scope success does not establish the complete approved coverage matrix.',
      'Complete paid-plan cost sums the latest eligible successful sample for each of five fixed scopes at one source/tested revision; it is not a single observed full-plan execution or a current acceptance pass.',
      'The hypothetical complete-plan calendar assumes the fixed scope order, one entire paid plan per month, and no other use. The actual monthly workflow selects Safari acceptance, Android Chrome acceptance and Android Firefox tab acceptance on consecutive days.',
      'Complete-plan forecasts round each estimated charge up and usable credit down, retain outstanding holds and the safety reserve, and require a full per-scope reservation before each component. Zero or unavailable cost basis leaves the forecast unknown.',
      'Projected full-plan exhaustion means the first hypothetical monthly plan that cannot be funded; it does not mean the remaining balance is zero or authorize allocation.',
      'Only a newly created reservation durably committed by the caller can authorize a capability allocation.',
    ],
  };
}
export function estimateBudget(input: AdmissionInput): EstimatedBudgetReport {
  return estimate(input);
}

export function reserveCapability(input: AdmissionInput & { runId: string; attempt: string }) {
  const prepared = prepare(input);
  const requested = identity(
    {
      runId: input.runId,
      attempt: input.attempt,
      sourceSha: input.source.sourceSha,
      testedSha: input.source.testedSha,
    },
    'invalid-identity',
  );
  if (!input.source.run.endsWith(`/actions/runs/${requested.runId}`))
    return fail('source-run-mismatch');
  const report = estimate(input, prepared);
  if (
    prepared.state.reservations.some(
      (entry) => entry.runId === requested.runId && entry.attempt === requested.attempt,
    )
  )
    report.blockingReasons.push('reservation-already-exists');
  if (prepared.state.reservations.length >= 256)
    report.blockingReasons.push('reservation-history-full');
  if (report.blockingReasons.length) {
    report.capabilitySufficient = false;
    return { state: prepared.state, report, reservation: null, created: false };
  }
  const reservation: Reservation = {
    ...requested,
    id: idFor(requested),
    policySha256: prepared.policySha256,
    seconds: report.capabilityReservationSeconds,
    reservedAt: input.source.observedAt,
    baselineSessionIds: prepared.ledger.sessions.map((entry) => entry.sessionId),
    sessionIds: [],
    status: 'reserved',
    uncertainAllocation: false,
    finishedAt: null,
    reconciledAt: null,
  };
  const state = readAdmissionState({
    schemaVersion: 1,
    reservations: [...prepared.state.reservations, reservation],
  });
  return { state, report, reservation, created: true };
}

type ReconciliationInput = AdmissionInput & { receipt: ReservationReceipt; journal?: unknown };

/** Read the final journal without importing the device runner or its application dependencies. */
function successfulScopeFromJournal(
  input: ReconciliationInput,
  reservation: Reservation,
): CapabilityScope | undefined {
  if (input.journal === undefined) return undefined;
  const journal = record(input.journal, 'invalid-scope-journal');
  // Older receipts and failed, partial or unknown scopes still reconcile usage.
  // None can supply a successful-cost sample.
  if (
    journal.schemaVersion !== 1 ||
    knownScope(journal.capabilityScope) === undefined ||
    journal.status !== 'passed' ||
    journal.stage !== 'finished'
  )
    return undefined;
  const scope = journal.capabilityScope as CapabilityScope;
  const definition = capabilityScopeDefinition(scope);
  const receipt = input.receipt;
  const reportedReceipt = row(
    journal.receipt,
    [...identityKeys, 'finishedAt', 'sessionIds', 'uncertainAllocation'],
    'invalid-scope-journal',
  );
  const reportedIds = ids(reportedReceipt.sessionIds, 3, 'invalid-scope-journal');
  const sameIds = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));
  if (
    !sameIdentity(identity(journal, 'invalid-scope-journal'), reservation) ||
    !sameIdentity(identity(reportedReceipt, 'invalid-scope-journal'), reservation) ||
    journal.reservationId !== reservation.id ||
    journal.allocationPlan !== (scope === 'all' ? 'two-lane-chrome-safari-remediation' : scope) ||
    input.source.sourceSha !== reservation.sourceSha ||
    input.source.testedSha !== reservation.testedSha ||
    !input.source.run.endsWith(`/actions/runs/${reservation.runId}`) ||
    journal.failure !== undefined ||
    reportedReceipt.finishedAt !== receipt.finishedAt ||
    reportedReceipt.uncertainAllocation !== false ||
    receipt.uncertainAllocation !== false ||
    !sameIds(reportedIds, receipt.sessionIds) ||
    !sameIds(reportedIds, reservation.sessionIds) ||
    journal.fullMatrixStatus !== (scope === 'all' ? 'passed' : 'incomplete') ||
    !Array.isArray(journal.lanes) ||
    journal.lanes.length !== 3
  )
    return fail('scope-journal-mismatch');
  const lanes = journal.lanes.map((value) => record(value, 'invalid-scope-journal'));
  const browsers = lanes.map((lane) => record(lane.target, 'invalid-scope-journal').browser);
  if (!['chrome', 'firefox', 'safari'].every((browser) => browsers.includes(browser)))
    return fail('scope-journal-mismatch');
  const selected = scope === 'all' ? browsers : [definition.browser];
  const selectedIds: string[] = [];
  for (const [index, lane] of lanes.entries()) {
    if (!selected.includes(browsers[index])) {
      if (
        !['not-run', 'blocked'].includes(lane.status as string) ||
        lane.sessionId !== undefined ||
        lane.allocation !== 'not-started' ||
        lane.uncertainAllocation !== false
      )
        return fail('scope-journal-mismatch');
      continue;
    }
    const startedAt = timestamp(lane.startedAt, 'invalid-scope-journal');
    const finishedAt = timestamp(lane.finishedAt, 'invalid-scope-journal');
    const cleanup = record(lane.cleanup, 'invalid-scope-journal');
    if (
      lane.status !== 'passed' ||
      lane.stage !== definition.completionStage ||
      lane.failure !== undefined ||
      lane.allocation !== 'known' ||
      lane.uncertainAllocation !== false ||
      startedAt < reservation.reservedAt ||
      finishedAt < startedAt ||
      finishedAt > receipt.finishedAt ||
      cleanup.network !== 'restored-4g-lte-good' ||
      cleanup.session !== 'deleted' ||
      cleanup.fixture !== 'closed'
    )
      return fail('scope-journal-mismatch');
    selectedIds.push(hash(lane.sessionId, 40, 'invalid-scope-journal'));
  }
  if (new Set(selectedIds).size !== selectedIds.length || !sameIds(selectedIds, reportedIds))
    return fail('scope-journal-mismatch');
  return scope;
}

function reconcile(input: ReconciliationInput, prepared: ReturnType<typeof prepare>) {
  const receipt = row(
    input.receipt,
    [...identityKeys, 'finishedAt', 'sessionIds', 'uncertainAllocation'],
    'invalid-receipt',
  );
  const requested = identity(receipt, 'invalid-receipt');
  const finishedAt = timestamp(receipt.finishedAt, 'invalid-receipt');
  const allocated = ids(receipt.sessionIds, 3, 'invalid-receipt');
  if (typeof receipt.uncertainAllocation !== 'boolean') return fail('invalid-receipt');
  const reservation = prepared.state.reservations.find((entry) => sameIdentity(entry, requested));
  if (
    !reservation ||
    finishedAt < reservation.reservedAt ||
    finishedAt > input.source.observedAt ||
    (reservation.finishedAt !== null && reservation.finishedAt !== finishedAt)
  )
    return fail('receipt-reservation-mismatch');
  if (reservation.status === 'reconciled') {
    const successfulScope = successfulScopeFromJournal(input, reservation);
    if (
      receipt.uncertainAllocation ||
      allocated.length !== reservation.sessionIds.length ||
      allocated.some((id) => !reservation.sessionIds.includes(id)) ||
      (successfulScope !== undefined && successfulScope !== reservation.successfulScope) ||
      (input.journal !== undefined &&
        reservation.successfulScope !== undefined &&
        successfulScope !== reservation.successfulScope)
    )
      return fail('reconciled-reservation-is-immutable');
    return {
      state: prepared.state,
      report: estimate(input, prepared),
      reservation,
      released: true,
    };
  }
  for (const id of allocated) {
    if (
      reservation.baselineSessionIds.includes(id) ||
      prepared.state.reservations.some(
        (entry) => entry.id !== reservation.id && entry.sessionIds.includes(id),
      )
    )
      return fail('receipt-session-already-accounted');
    if (!reservation.sessionIds.includes(id)) reservation.sessionIds.push(id);
  }
  reservation.uncertainAllocation ||= receipt.uncertainAllocation;
  reservation.finishedAt = finishedAt;
  if (input.journal !== undefined) {
    const successfulScope = successfulScopeFromJournal(input, reservation);
    if (reservation.successfulScope && successfulScope !== reservation.successfulScope)
      return fail('scope-journal-mismatch');
    if (successfulScope !== undefined) reservation.successfulScope = successfulScope;
  }
  let allMeasuredNow =
    prepared.collectionSufficient &&
    prepared.raw.conflictingSessions === 0 &&
    prepared.raw.unresolvedSessions === 0;
  for (const id of reservation.sessionIds) {
    const entry = input.evidence.history.sessions.find((value) => value.sessionId === id);
    const observations =
      entry?.observations.flatMap((value) =>
        value.evidence.outcome === 'available' ? [value.evidence.data] : [],
      ) ?? [];
    if (
      observations.some(
        (value) =>
          value.createdAt !== null &&
          Date.parse(value.createdAt) + 1000 < Date.parse(reservation.reservedAt),
      )
    )
      return fail('receipt-session-predates-reservation');
    if (
      !entry ||
      entry.conflict ||
      entry.observations.some((value) => value.evidence.outcome !== 'available') ||
      !observations.some(terminal) ||
      observations.some((value, index) =>
        observations.slice(index + 1).some((other) => sessionMeasurementConflict(value, other)),
      )
    )
      allMeasuredNow = false;
    if (
      prepared.ledger.sessions.find((value) => value.sessionId === id) &&
      ledgerSessionSeconds(prepared.ledger.sessions.find((value) => value.sessionId === id)!) ===
        null
    )
      allMeasuredNow = false;
  }
  const released = !reservation.uncertainAllocation && allMeasuredNow;
  reservation.status = released ? 'reconciled' : 'held';
  reservation.reconciledAt = released ? input.source.observedAt : null;
  const state = readAdmissionState(prepared.state);
  const report = estimate({ ...input, state }, { ...prepared, state });
  return {
    state,
    report,
    reservation: state.reservations.find((entry) => entry.id === reservation.id)!,
    released,
  };
}

export function reconcileReservation(input: ReconciliationInput) {
  return reconcile(input, prepare(input));
}

/** Retry only receipts already durably retained as complete and certain. */
export function reconcileHeldReservations(input: AdmissionInput) {
  const prepared = prepare(input);
  let state = prepared.state;
  const releasedReservationIds: string[] = [];
  for (const reservation of prepared.state.reservations) {
    if (
      reservation.status !== 'held' ||
      reservation.uncertainAllocation ||
      reservation.policySha256 !== prepared.policySha256
    )
      continue;
    const result = reconcile(
      {
        ...input,
        state,
        receipt: {
          runId: reservation.runId,
          attempt: reservation.attempt,
          sourceSha: reservation.sourceSha,
          testedSha: reservation.testedSha,
          finishedAt: reservation.finishedAt!,
          sessionIds: reservation.sessionIds,
          uncertainAllocation: false,
        },
      },
      { ...prepared, state },
    );
    state = result.state;
    if (result.released) releasedReservationIds.push(reservation.id);
  }
  return { state, releasedReservationIds };
}
