import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createBudgetReport,
  type BudgetSource,
  type QuotaEvidence,
} from './browserstack-budget.ts';
import {
  estimateBudget,
  readAdmissionPolicy,
  readAdmissionState,
  reconcileReservation,
  reservationForRun,
  reserveCapability,
  type AdmissionState,
  type ReservationReceipt,
} from './browserstack-admission.ts';

const source: BudgetSource = {
  observedAt: '2026-11-01T17:00:00.000Z',
  sourceSha: 'a'.repeat(40),
  testedSha: 'b'.repeat(40),
  run: 'https://github.com/mxbaylee/spinel/actions/runs/555',
};
const postSource = { ...source, observedAt: '2026-11-01T17:05:00.000Z' };
const newId = 'c'.repeat(40);
function policy() {
  return readAdmissionPolicy(
    JSON.parse(
      readFileSync(
        new URL('../../docs/implementation/SPN-090-budget-assumptions.json', import.meta.url),
        'utf8',
      ),
    ),
  );
}
function evidence(): QuotaEvidence {
  return JSON.parse(
    readFileSync(
      new URL('../../docs/implementation/SPN-090-browserstack-history.json', import.meta.url),
      'utf8',
    ),
  ) as QuotaEvidence;
}
function input(current = evidence(), state: AdmissionState | null = null, stamp = source) {
  const ledger = createBudgetReport({ ...stamp, previousLedger: null, evidence: current }).ledger;
  assert.ok(ledger);
  return { policy: policy(), state, ledger, evidence: current, source: stamp };
}
function allocated(seconds = 19, id = newId, createdAt = '2026-11-01T17:01:00.000Z') {
  const current = evidence();
  current.history.sessions.push({
    sessionId: id,
    buildIds: [current.history.builds[0].buildId],
    conflict: false,
    observations: [
      {
        source: 'build-list',
        evidence: {
          outcome: 'available',
          data: {
            durationSeconds: seconds,
            providerStatus: 'failed',
            executionStatus: 'error',
            createdAt,
          },
        },
      },
    ],
  });
  current.history.builds[0].sessionIds.push(id);
  return current;
}
function receipt(sessionIds: string[] = [newId], uncertainAllocation = false): ReservationReceipt {
  return {
    runId: '555',
    attempt: '1',
    sourceSha: source.sourceSha,
    testedSha: source.testedSha,
    finishedAt: '2026-11-01T17:04:00.000Z',
    sessionIds,
    uncertainAllocation,
  };
}
function reserve() {
  return reserveCapability({ ...input(), runId: '555', attempt: '1' });
}

test('owner-authorized estimate uses the retained 241 seconds without relabeling unknown provider credit', () => {
  const current = input();
  const report = estimateBudget(current);
  assert.equal(report.measuredElapsedSeconds, 241);
  assert.equal(report.estimatedRemainingSeconds, 3359);
  assert.equal(report.estimatedRemainingMinutes, 3359 / 60);
  assert.equal(report.estimatedUsableSeconds, 3059);
  assert.equal(report.capabilityReservationSeconds, 900);
  assert.equal(report.estimatedAdditionalCapabilityReservations, 3);
  assert.equal(report.firstEstimatedUnfundableCapabilityDate, '2027-03-01T09:17:00.000Z');
  assert.equal(report.capabilitySufficient, true);
  assert.equal(report.allocationAllowed, false, 'estimation alone is not a durable reservation');
  assert.equal(report.providerVerified, false);
  assert.equal(report.completeOfflineMatrixCostMinutes, null);
  assert.equal(report.estimatedSuccessfulCompleteRuns, null);
  assert.equal(report.projectedFullMatrixExhaustion, null);
  assert.equal(
    createBudgetReport({ ...source, evidence: current.evidence, previousLedger: current.ledger })
      .report.remainingMinutes,
    null,
  );
  assert.ok(
    report.assumptions.some((value) => value.includes('not an authoritative provider balance')),
  );
});

test('one run/attempt can reserve once; source changes cannot replace its pending reservation', () => {
  const first = reserve();
  assert.equal(first.created, true);
  assert.ok(first.reservation);
  assert.equal(first.reservation.seconds, 900);
  assert.equal(first.reservation.baselineSessionIds.length, 15);
  const original = structuredClone(first.state);
  const second = reserveCapability({
    ...input(evidence(), first.state),
    runId: '555',
    attempt: '1',
  });
  assert.equal(second.created, false);
  assert.ok(second.report.blockingReasons.includes('reservation-already-exists'));
  const changed = reserveCapability({
    ...input(evidence(), first.state, { ...source, sourceSha: 'd'.repeat(40) }),
    runId: '555',
    attempt: '1',
  });
  assert.equal(changed.created, false);
  assert.ok(changed.report.blockingReasons.includes('reservation-already-exists'));
  assert.deepEqual(first.state, original);
  const identity = {
    runId: '555',
    attempt: '1',
    sourceSha: source.sourceSha,
    testedSha: source.testedSha,
  };
  assert.deepEqual(reservationForRun(first.state, identity), first.reservation);
  assert.throws(
    () => reservationForRun(first.state, { ...identity, attempt: '2' }),
    /pending-reservation-not-found/,
  );
});

test('lifetime credit does not renew; insufficient and exhausted estimates never reserve', () => {
  const current = input();
  current.policy.assumedUnobservedUsageSeconds = 2800;
  const low = reserveCapability({ ...current, runId: '555', attempt: '1' });
  assert.equal(low.created, false);
  assert.equal(low.report.estimatedUsableSeconds, 259);
  assert.ok(
    low.report.blockingReasons.includes('estimated-budget-below-complete-capability-reservation'),
  );
  current.policy.assumedUnobservedUsageSeconds = 3500;
  const exhausted = reserveCapability({ ...current, runId: '555', attempt: '1' });
  assert.equal(exhausted.created, false);
  assert.ok(exhausted.report.blockingReasons.includes('estimated-lifetime-budget-exhausted'));
  const later = estimateBudget({
    ...current,
    source: { ...source, observedAt: '2027-01-01T09:17:00.000Z' },
  });
  assert.equal(later.estimatedRemainingSeconds, 0);
  assert.equal(later.estimatedAdditionalCapabilityReservations, 0);
  assert.equal(later.firstEstimatedUnfundableCapabilityDate, '2027-02-01T09:17:00.000Z');
});

test('a complete receipt releases unused capacity only after current terminal session measurement', () => {
  const first = reserve();
  const result = reconcileReservation({
    ...input(allocated(), first.state, postSource),
    receipt: receipt(),
  });
  assert.equal(result.released, true);
  assert.equal(result.reservation.status, 'reconciled');
  assert.equal(result.report.measuredElapsedSeconds, 260);
  assert.equal(result.report.outstandingHoldSeconds, 0);
  assert.equal(result.report.estimatedRemainingSeconds, 3340);
  assert.equal(result.report.estimatedUsableSeconds, 3040);
  const again = reconcileReservation({
    ...input(allocated(), result.state, postSource),
    receipt: receipt(),
  });
  assert.equal(again.released, true);
  assert.deepEqual(again.state, result.state);
  const old = structuredClone(first.state);
  assert.equal(
    old.reservations[0].status,
    'reserved',
    'reconciliation does not mutate the caller state',
  );
  assert.throws(
    () => reservationForRun(result.state, receiptIdentity()),
    /pending-reservation-not-found/,
  );
});
function receiptIdentity() {
  return { runId: '555', attempt: '1', sourceSha: source.sourceSha, testedSha: source.testedSha };
}

test('uncertain finished allocation keeps the unused hold without double charging measured IDs or blocking all future runs', () => {
  const first = reserve();
  const result = reconcileReservation({
    ...input(allocated(), first.state, postSource),
    receipt: receipt([newId], true),
  });
  assert.equal(result.released, false);
  assert.equal(result.reservation.status, 'held');
  assert.equal(result.report.measuredElapsedSeconds, 260);
  assert.equal(result.report.outstandingHoldSeconds, 881);
  assert.equal(result.report.estimatedUsableSeconds, 2159);
  assert.equal(result.report.capabilitySufficient, true);
  const later = {
    ...postSource,
    observedAt: '2026-11-01T17:06:00.000Z',
    run: 'https://github.com/mxbaylee/spinel/actions/runs/556',
  };
  const next = reserveCapability({
    ...input(allocated(), result.state, later),
    runId: '556',
    attempt: '1',
  });
  assert.equal(next.created, true);
  assert.equal(next.state.reservations.length, 2);
  const claimedCertain = reconcileReservation({
    ...input(allocated(), result.state, postSource),
    receipt: receipt([], false),
  });
  assert.equal(claimedCertain.released, false);
  assert.equal(claimedCertain.reservation.uncertainAllocation, true);
  assert.deepEqual(
    claimedCertain.reservation.sessionIds,
    [newId],
    'later receipts cannot erase allocated IDs',
  );
  assert.equal(claimedCertain.report.outstandingHoldSeconds, 881);
});

test('pending, missing-receipt and incomplete-collection states retain their reservation', () => {
  const first = reserve();
  const later = { ...postSource, run: 'https://github.com/mxbaylee/spinel/actions/runs/556' };
  const blocked = reserveCapability({
    ...input(evidence(), first.state, later),
    runId: '556',
    attempt: '1',
  });
  assert.equal(blocked.created, false);
  assert.ok(blocked.report.blockingReasons.includes('pending-reservation'));
  assert.equal(blocked.report.outstandingHoldSeconds, 900);
  const missing = reconcileReservation({
    ...input(evidence(), first.state, postSource),
    receipt: receipt(),
  });
  assert.equal(missing.released, false);
  assert.equal(missing.reservation.status, 'held');
  assert.equal(missing.report.outstandingHoldSeconds, 900);
  const partial = allocated();
  partial.status = 'failed';
  partial.history.buildPagination = { pages: 1, outcome: 'partial', reason: 'request-timeout' };
  const incomplete = reconcileReservation({
    ...input(partial, first.state, postSource),
    receipt: receipt(),
  });
  assert.equal(incomplete.released, false);
  assert.equal(incomplete.report.estimatedRemainingSeconds, null);
  assert.ok(incomplete.report.blockingReasons.includes('current-collection-incomplete'));
});

test('a certain empty receipt can release an allocation that never started; an uncertain empty receipt cannot', () => {
  const first = reserve();
  const certain = reconcileReservation({
    ...input(evidence(), first.state, postSource),
    receipt: receipt([], false),
  });
  assert.equal(certain.released, true);
  assert.equal(certain.report.outstandingHoldSeconds, 0);
  const uncertain = reconcileReservation({
    ...input(evidence(), first.state, postSource),
    receipt: receipt([], true),
  });
  assert.equal(uncertain.released, false);
  assert.equal(uncertain.report.outstandingHoldSeconds, 900);
});

test('receipt identities, baseline/history attribution and reconciled state cannot be overwritten', () => {
  const first = reserve();
  assert.throws(
    () =>
      reconcileReservation({
        ...input(allocated(), first.state, postSource),
        receipt: { ...receipt(), attempt: '2' },
      }),
    /receipt-reservation-mismatch/,
  );
  assert.throws(
    () =>
      reconcileReservation({
        ...input(evidence(), first.state, postSource),
        receipt: receipt([evidence().history.sessions[0].sessionId]),
      }),
    /receipt-session-already-accounted/,
  );
  assert.throws(
    () =>
      reconcileReservation({
        ...input(allocated(19, newId, '2026-10-28T12:00:00.000Z'), first.state, postSource),
        receipt: receipt(),
      }),
    /receipt-session-predates-reservation/,
  );
  const done = reconcileReservation({
    ...input(allocated(), first.state, postSource),
    receipt: receipt(),
  });
  assert.throws(
    () =>
      reconcileReservation({
        ...input(allocated(), done.state, postSource),
        receipt: receipt([], false),
      }),
    /reconciled-reservation-is-immutable/,
  );
  assert.throws(
    () =>
      reconcileReservation({
        ...input(allocated(), done.state, postSource),
        receipt: receipt([newId], true),
      }),
    /reconciled-reservation-is-immutable/,
  );
});

test('invalid policy/state, conflicting measurements and active account use refuse new allocation', () => {
  const validPolicy = policy();
  for (const bad of [
    { ...validPolicy, lifetimeAllowanceSeconds: 7200 },
    { ...validPolicy, safetyReserveSeconds: 0 },
    { ...validPolicy, chargedSecondsPerElapsedSecond: NaN },
    { ...validPolicy, decisionSource: 'secret\nvalue' },
  ])
    assert.throws(() => readAdmissionPolicy(bad), /^Error: admission-invalid-policy$/);
  const state = reserve().state;
  for (const bad of [
    { ...state, extra: 'do-not-echo-me' },
    { ...state, reservations: [...state.reservations, state.reservations[0]] },
    { ...state, reservations: [{ ...state.reservations[0], status: 'reconciled' }] },
  ])
    assert.throws(() => readAdmissionState(bad), /^Error: admission-invalid-state$/);
  const conflict = evidence();
  conflict.history.sessions[0].conflict = true;
  const conflicted = reserveCapability({ ...input(conflict), runId: '555', attempt: '1' });
  assert.equal(conflicted.created, false);
  assert.equal(conflicted.report.estimatedRemainingSeconds, null);
  assert.ok(conflicted.report.blockingReasons.includes('conflicting-session-evidence'));
  const active = evidence();
  if (active.plan.outcome !== 'available') throw new Error('fixture');
  active.plan.data.runningSessions = 1;
  const busy = reserveCapability({ ...input(active), runId: '555', attempt: '1' });
  assert.equal(busy.created, false);
  assert.ok(busy.report.blockingReasons.includes('current-account-sessions-active'));
});

test('edited assumptions cannot reinterpret outstanding holds, while completed reservations preserve their historical policy', () => {
  const first = reserve();
  const held = reconcileReservation({
    ...input(allocated(), first.state, postSource),
    receipt: receipt([newId], true),
  });
  const changed = input(allocated(), held.state, postSource);
  changed.policy.chargedSecondsPerElapsedSecond = 2;
  const report = estimateBudget(changed);
  assert.equal(report.capabilitySufficient, false);
  assert.equal(report.estimatedRemainingSeconds, null);
  assert.equal(
    report.outstandingHoldSeconds,
    900,
    'an uncertain old-policy hold is not discounted under a new multiplier',
  );
  assert.ok(report.blockingReasons.includes('outstanding-reservation-policy-mismatch'));
  const done = reconcileReservation({
    ...input(allocated(), first.state, postSource),
    receipt: receipt(),
  });
  const completed = { ...changed, state: done.state };
  const after = estimateBudget(completed);
  assert.equal(after.estimatedUsedSeconds, 520);
  assert.equal(after.capabilityReservationSeconds, 1800);
  assert.equal(after.outstandingHoldSeconds, 0);
  assert.equal(after.capabilitySufficient, true);
  assert.equal(done.state.reservations[0].policySha256, first.state.reservations[0].policySha256);
});
