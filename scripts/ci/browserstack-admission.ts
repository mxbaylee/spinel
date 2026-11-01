import { createHash } from 'node:crypto';
import {
  createBudgetReport,
  nextMonthlyDates,
  readBudgetLedger,
  type BudgetLedger,
  type BudgetSource,
  type QuotaEvidence,
} from './browserstack-budget.ts';
import { sessionMeasurementConflict } from './browserstack-quota.ts';

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
  ledger: unknown;
  evidence: QuotaEvidence;
  source: BudgetSource;
};
export type EstimatedBudgetReport = {
  basis: 'owner-authorized-estimate';
  providerVerified: false;
  allocationAllowed: false;
  capabilitySufficient: boolean;
  policySha256: string;
  measuredElapsedSeconds: number | null;
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
  completeOfflineMatrixCostMinutes: null;
  estimatedSuccessfulCompleteRuns: null;
  projectedFullMatrixExhaustion: null;
  blockingReasons: string[];
  assumptions: string[];
};
const identityKeys = ['runId', 'attempt', 'sourceSha', 'testedSha'];
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
    const data = row(value, reservationKeys, 'invalid-state');
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
  const policySha256 = createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  return { policy, state, ledger: current.ledger, raw: current.report, policySha256 };
}
function estimate(input: AdmissionInput, prepared = prepare(input)): EstimatedBudgetReport {
  const { policy, state, ledger, raw, policySha256 } = prepared;
  const blockingReasons = raw.blockingReasons.filter(
    (reason) =>
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
    input.evidence.status === 'passed' &&
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
  const forecast = (offset: number) => {
    const date = new Date(nextDates[0]);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString();
  };
  return {
    basis: 'owner-authorized-estimate',
    providerVerified: false,
    allocationAllowed: false,
    capabilitySufficient: blockingReasons.length === 0,
    policySha256,
    measuredElapsedSeconds,
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
    completeOfflineMatrixCostMinutes: null,
    estimatedSuccessfulCompleteRuns: null,
    projectedFullMatrixExhaustion: null,
    blockingReasons,
    assumptions: [
      policy.method,
      'The lifetime allowance never renews at a month boundary.',
      'The owner authorized directional estimation; this is not an authoritative provider balance.',
      'Safety reserve and outstanding reservation holds reduce spendable estimated credit.',
      'A completed uncertain allocation retains its unused hold; a missing receipt leaves a pending reservation.',
      'Capability count/calendar assume one full reservation per future monthly date and no other use; they do not predict successful offline-matrix runs.',
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

export function reconcileReservation(input: AdmissionInput & { receipt: ReservationReceipt }) {
  const prepared = prepare(input);
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
    if (
      receipt.uncertainAllocation ||
      allocated.length !== reservation.sessionIds.length ||
      allocated.some((id) => !reservation.sessionIds.includes(id))
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
  let allMeasuredNow =
    input.evidence.status === 'passed' &&
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
