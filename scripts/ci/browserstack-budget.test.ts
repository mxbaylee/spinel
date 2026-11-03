import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createBudgetReport,
  monthlyPlanDate,
  monthlyScope,
  nextMonthlyDates,
  readBudgetLedger,
  scheduledRunDate,
  type BudgetLedger,
  type QuotaEvidence,
} from './browserstack-budget.ts';

const firstObserved = '2026-11-01T00:00:00.000Z';
const nextObserved = '2026-12-01T09:17:00.000Z';
function evidence(): QuotaEvidence {
  return JSON.parse(
    readFileSync(
      new URL('../../docs/implementation/SPN-090-browserstack-history.json', import.meta.url),
      'utf8',
    ),
  ) as QuotaEvidence;
}
function oneSession(): QuotaEvidence {
  const result = evidence();
  result.history.sessions = [result.history.sessions[0]];
  result.history.sessions[0].observations = [result.history.sessions[0].observations[0]];
  return result;
}
function assess(
  current: QuotaEvidence = evidence(),
  previousLedger: unknown | null = null,
  observedAt = firstObserved,
) {
  return createBudgetReport({
    evidence: current,
    previousLedger,
    observedAt,
    sourceSha: 'a'.repeat(40),
    testedSha: 'b'.repeat(40),
    run: 'https://github.com/mxbaylee/spinel/actions/runs/40993658109',
  });
}
function sessionData(current: QuotaEvidence) {
  const entry = current.history.sessions[0].observations[0].evidence;
  assert.equal(entry.outcome, 'available');
  if (entry.outcome !== 'available') throw new Error('fixture');
  return entry.data;
}

test('retained authenticated history measures all 15 sessions without inventing remaining credit', () => {
  const { ledger, report } = assess();
  assert.ok(ledger);
  assert.equal(ledger.sessions.length, 15);
  assert.equal(report.measuredTerminalSessions, 15);
  assert.equal(report.measuredTerminalSessionSeconds, 241);
  assert.equal(report.unresolvedSessions, 0);
  assert.equal(report.status, 'blocked');
  assert.equal(report.allocationAllowed, false);
  assert.equal(report.allowanceSeconds, 3600);
  assert.equal(report.remainingMinutes, null);
  assert.equal(report.completeOfflineMatrixCostMinutes, null);
  assert.equal(report.estimatedSuccessfulCompleteRuns, null);
  assert.equal(report.projectedExhaustion, null);
  assert.equal(report.firstUnfundableDate, null);
  assert.ok(report.blockingReasons.includes('account-wide-starting-usage-unverified'));
  assert.ok(report.blockingReasons.includes('charged-duration-mapping-unverified'));
  assert.ok(report.blockingReasons.includes('complete-offline-matrix-cost-unmeasured'));
});

test('repeated snapshots and observations from multiple builds never double count a session', () => {
  const current = evidence();
  const original = structuredClone(current);
  const first = assess(current);
  const prior = structuredClone(first.ledger);
  const next = evidence();
  next.history.sessions[0].buildIds.push('c'.repeat(40));
  next.history.sessions[0].observations.push(
    structuredClone(next.history.sessions[0].observations[0]),
  );
  const second = assess(next, first.ledger, nextObserved);
  assert.equal(second.report.measuredTerminalSessionSeconds, 241);
  assert.equal(second.ledger?.sessions.length, 15);
  assert.deepEqual(first.ledger, prior, 'the caller-owned prior ledger is immutable');
  assert.deepEqual(current, original, 'the caller-owned provider evidence is immutable');
  const saved = second.ledger?.sessions.find(
    (entry) => entry.sessionId === next.history.sessions[0].sessionId,
  );
  assert.ok(saved);
  assert.equal(new Set(saved.buildIds).size, saved.buildIds.length);
  assert.ok(saved.buildIds.includes('c'.repeat(40)));
  assert.equal(saved.measurements[0].firstObserved.observedAt, firstObserved);
  assert.equal(saved.measurements[0].lastObserved.observedAt, nextObserved);
  assert.deepEqual(readBudgetLedger(JSON.parse(JSON.stringify(second.ledger))), second.ledger);
});

test('expired provider records preserve earlier terminal measurements and retain every read failure', () => {
  const first = assess();
  const current = evidence();
  current.status = 'failed';
  current.history.sessions = current.history.sessions.map((entry) => ({
    ...entry,
    observations: [{ source: 'detail', evidence: { outcome: 'unavailable', reason: 'http-404' } }],
  }));
  const second = assess(current, first.ledger, nextObserved);
  assert.equal(second.report.measuredTerminalSessionSeconds, 241);
  assert.equal(second.report.sessionsWithReadFailures, 15);
  assert.ok(second.report.blockingReasons.includes('current-collection-incomplete'));
  assert.equal(second.report.remainingMinutes, null);
  assert.equal(second.ledger?.sessions[0].readFailures[0].reason, 'http-404');
  const third = assess(current, second.ledger, '2027-01-01T09:17:00.000Z');
  assert.equal(third.ledger?.sessions[0].readFailures.length, 1);
  assert.equal(third.report.measuredTerminalSessionSeconds, 241);
});

test('missing and active durations stay unmeasured, while an observed terminal zero is a real measurement', () => {
  for (const duration of [null, 3]) {
    const current = oneSession();
    Object.assign(sessionData(current), {
      durationSeconds: duration,
      providerStatus: 'running',
      executionStatus: 'running',
    });
    const { report } = assess(current);
    assert.equal(report.measuredTerminalSessionSeconds, null);
    assert.equal(report.measuredTerminalSessions, 0);
    assert.equal(report.unresolvedSessions, 1);
    assert.ok(report.blockingReasons.includes('session-measurements-incomplete'));
  }
  const current = oneSession();
  sessionData(current).durationSeconds = 0;
  const { report } = assess(current);
  assert.equal(report.measuredTerminalSessions, 1);
  assert.equal(report.measuredTerminalSessionSeconds, 0);
  assert.equal(report.allocationAllowed, false);
});

test('normal active-to-terminal progress preserves both observations and measures only the terminal duration', () => {
  const current = oneSession();
  Object.assign(sessionData(current), {
    durationSeconds: 3,
    providerStatus: 'running',
    executionStatus: 'running',
  });
  const first = assess(current);
  Object.assign(sessionData(current), {
    durationSeconds: 19,
    providerStatus: 'failed',
    executionStatus: 'error',
  });
  const second = assess(current, first.ledger, nextObserved);
  assert.equal(second.ledger?.sessions[0].measurements.length, 2);
  assert.equal(second.report.measuredTerminalSessionSeconds, 19);
  assert.equal(second.report.conflictingSessions, 0);
  assert.equal(second.report.unresolvedSessions, 0);
});

test('different terminal durations and collector conflicts stay visible without selecting a convenient value', () => {
  const current = oneSession();
  sessionData(current).durationSeconds = 19;
  const first = assess(current);
  sessionData(current).durationSeconds = 20;
  const second = assess(current, first.ledger, nextObserved);
  assert.equal(second.ledger?.sessions[0].measurements.length, 2);
  assert.equal(second.report.measuredTerminalSessionSeconds, null);
  assert.equal(second.report.conflictingSessions, 1);
  assert.ok(second.report.blockingReasons.includes('conflicting-session-evidence'));
  const flagged = oneSession();
  flagged.history.sessions[0].conflict = true;
  const flaggedFirst = assess(flagged);
  flagged.history.sessions[0].conflict = false;
  const flaggedSecond = assess(flagged, flaggedFirst.ledger, nextObserved);
  assert.equal(flaggedSecond.ledger?.sessions[0].collectorConflict, true);
  assert.equal(flaggedSecond.report.measuredTerminalSessionSeconds, null);
});

test('cross-snapshot identity contradictions and regressing final durations cannot be erased by later clean reads', () => {
  for (const change of [{ createdAt: '2026-10-28T03:28:28.000Z' }, { durationSeconds: 2 }]) {
    const current = oneSession();
    Object.assign(sessionData(current), {
      durationSeconds: 3,
      providerStatus: 'running',
      executionStatus: 'running',
    });
    const first = assess(current);
    Object.assign(sessionData(current), {
      durationSeconds: 19,
      providerStatus: 'done',
      executionStatus: 'done',
      ...change,
    });
    const second = assess(current, first.ledger, nextObserved);
    const third = assess(current, second.ledger, '2027-01-01T09:17:00.000Z');
    assert.equal(third.report.conflictingSessions, 1);
    assert.equal(third.report.measuredTerminalSessionSeconds, null);
    assert.equal(third.ledger?.sessions[0].measurements.length, 2);
  }
});

test('malformed, duplicated or authority-bearing ledgers fail closed and cannot replace durable evidence', () => {
  const valid = assess().ledger as BudgetLedger;
  const malformed: unknown[] = [
    { ...valid, secret: 'do-not-echo-me' },
    { ...valid, allowanceSeconds: 7200 },
    { ...valid, startingUsageSeconds: 0 },
    { ...valid, chargedDurationMapping: 'verified' },
    { ...valid, sessions: [...valid.sessions, valid.sessions[0]] },
    {
      ...valid,
      sessions: [{ ...valid.sessions[0], readFailures: [{ reason: 'do-not-echo-me' }] }],
    },
  ];
  for (const previous of malformed) {
    const { ledger, report } = assess(evidence(), previous, nextObserved);
    assert.equal(ledger, null);
    assert.equal(report.ledgerStatus, 'invalid');
    assert.equal(report.measuredTerminalSessionSeconds, null);
    assert.ok(report.blockingReasons.includes('invalid-durable-ledger'));
    assert.equal(report.allocationAllowed, false);
    assert.doesNotMatch(JSON.stringify(report), /do-not-echo-me/);
  }
});

test('a stale run cannot overwrite a ledger from a later observation', () => {
  const latest = assess(evidence(), null, nextObserved);
  const stale = assess(evidence(), latest.ledger, firstObserved);
  assert.equal(stale.ledger, null);
  assert.ok(stale.report.blockingReasons.includes('stale-budget-observation'));
});

test('account activity, incomplete collection and duration overflow remain explicit blockers', () => {
  const current = evidence();
  current.status = 'failed';
  if (current.plan.outcome !== 'available') throw new Error('fixture');
  current.plan.data.runningSessions = 1;
  let result = assess(current);
  assert.ok(result.report.blockingReasons.includes('current-account-sessions-active'));
  assert.ok(result.report.blockingReasons.includes('current-collection-incomplete'));
  current.plan.data.runningSessions = null;
  result = assess(current);
  assert.ok(result.report.blockingReasons.includes('current-account-activity-unverified'));
  const overflow = oneSession();
  sessionData(overflow).durationSeconds = Number.MAX_SAFE_INTEGER;
  const other = structuredClone(overflow.history.sessions[0]);
  other.sessionId = 'f'.repeat(40);
  overflow.history.sessions.push(other);
  const report = assess(overflow).report;
  assert.equal(report.measuredTerminalSessionSeconds, null);
  assert.ok(report.blockingReasons.includes('measured-duration-overflow'));
});

test('scheduled run dates step through each monthly scope, cross years and never renew the allowance', () => {
  assert.deepEqual(nextMonthlyDates('2026-11-01T09:16:59.999Z'), [
    '2026-11-01T09:17:00.000Z',
    '2026-11-02T09:17:00.000Z',
    '2026-11-03T09:17:00.000Z',
  ]);
  assert.deepEqual(nextMonthlyDates('2026-11-01T09:17:00.000Z'), [
    '2026-11-02T09:17:00.000Z',
    '2026-11-03T09:17:00.000Z',
    '2026-12-01T09:17:00.000Z',
  ]);
  assert.deepEqual(nextMonthlyDates('2026-12-31T23:59:59.999Z'), [
    '2027-01-01T09:17:00.000Z',
    '2027-01-02T09:17:00.000Z',
    '2027-01-03T09:17:00.000Z',
  ]);
  assert.equal(scheduledRunDate('2028-02-29T23:59:59.999Z', 4), '2028-04-02T09:17:00.000Z');
  assert.deepEqual(nextMonthlyDates('2026-11-01T09:16:59.999Z').map(monthlyScope), [
    'safari-acceptance',
    'chrome-acceptance',
    'firefox-tab-acceptance',
  ]);
  assert.throws(() => monthlyScope('2026-11-04T09:17:00.000Z'), /invalid-budget-ledger/);
  assert.throws(() => scheduledRunDate('2026-11-01T09:17:00.000Z', -1), /invalid-budget-ledger/);
  // The complete-plan scenario stays one plan per month.
  assert.equal(monthlyPlanDate('2026-11-01T09:17:00.000Z', 0), '2026-12-01T09:17:00.000Z');
  assert.equal(monthlyPlanDate('2028-02-29T23:59:59.999Z', 2), '2028-05-01T09:17:00.000Z');
  assert.throws(() => nextMonthlyDates('2026-02-30T00:00:00.000Z'), /invalid-budget-ledger/);
  assert.equal(assess(evidence(), null, '2027-01-01T09:17:00.000Z').report.allowanceSeconds, 3600);
});

test('source provenance rejects token-bearing URLs and never echoes unexpected provider strings', () => {
  assert.throws(
    () =>
      createBudgetReport({
        evidence: evidence(),
        previousLedger: null,
        observedAt: firstObserved,
        sourceSha: 'a'.repeat(40),
        testedSha: 'b'.repeat(40),
        run: 'https://github.com/mxbaylee/spinel/actions/runs/1?token=do-not-echo-me',
      }),
    /^Error: invalid-budget-ledger$/,
  );
  const current = oneSession();
  sessionData(current).providerStatus = 'do-not-echo-me';
  const result = assess(current);
  assert.equal(result.ledger, null);
  assert.doesNotMatch(JSON.stringify(result), /do-not-echo-me/);
});
