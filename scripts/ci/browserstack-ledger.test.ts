import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  attestOwnerBaseline,
  budgetReport,
  emptyLedger,
  ingestQuota,
  ledgerBytes,
  ledgerLimits,
  monthlyDates,
  ownerBaselineReportId,
  readLedger,
  type SmokeExecution,
} from './browserstack-ledger.ts';

const reportBytes = readFileSync(
  new URL('../../docs/implementation/SPN-090-browserstack-history.json', import.meta.url),
);
const report = JSON.parse(reportBytes.toString());
const now = new Date('2026-10-30T03:00:00.000Z');
const executions: SmokeExecution[] = ['first', 'verified'].map((name) => {
  const { smoke } = JSON.parse(
    readFileSync(
      new URL(`../../docs/implementation/SPN-090-browserstack-${name}.json`, import.meta.url),
      'utf8',
    ),
  );
  return {
    run: smoke.run,
    sourceSha: smoke.sourceSha,
    testedSha: smoke.testedSha,
    outcome: smoke.status,
    sessionIds: smoke.sessions.map((session: { sessionId: string }) => session.sessionId),
  };
});
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const observed = () => ingestQuota(emptyLedger(executions), reportBytes);
const attested = () => attestOwnerBaseline(observed(), ownerBaselineReportId);

test('preserves the actual fifteen-session observation, failed smoke and exact owner baseline', () => {
  const ledger = attested();
  assert.equal(ledger.sessions.length, 15);
  assert.equal(ledger.smokeExecutions[0].outcome, 'failed');
  assert.equal(ledger.baseline?.statement, 'Only these Spinel sessions');
  assert.equal(ledger.baseline?.questionKnownSessions, 6);
  assert.equal(ledger.baseline?.subsequentlyObservedSessions, 15);
  assert.equal(ledger.baseline?.sessionIds.length, 15);
  assert.equal(ledger.baseline?.reportId, ownerBaselineReportId);
  const summary = budgetReport(ledger, now);
  assert.equal(summary.observed.reportedDurationSeconds, 241);
  assert.equal(summary.observed.unmappedExecutionSessions, 9);
  assert.equal(summary.authoritative.remainingSeconds, null);
  assert.equal(summary.authoritative.fullMatrixCostSeconds, null);
  assert.equal(summary.allocationAllowed, false);
  assert.equal(summary.status, 'failed');
  assert(!summary.authoritative.reasons.includes('older-account-usage-unknown'));
  assert(summary.authoritative.reasons.includes('charge-mapping-unverified'));
  assert(summary.authoritative.reasons.includes('complete-matrix-cost-unknown'));
  const [seconds, minutes] = summary.conditionalScenarios;
  assert.equal(seconds.assumedMeanSmokeChargedSeconds, 48);
  assert.equal(seconds.measuredFailedSmokeAttempts, 1);
  assert.equal(seconds.assumedRemainingSeconds, 3359);
  assert.equal(seconds.estimatedSuccessfulSmokeRuns, 69);
  assert.equal(minutes.assumedMeanSmokeChargedSeconds, 180);
  assert.equal(minutes.assumedRemainingSeconds, 2700);
  assert.equal(minutes.estimatedSuccessfulSmokeRuns, 15);
  assert.equal(minutes.firstUnaffordableMonthlySmoke, '2028-02-01T17:15:00.000Z');
  for (const scenario of summary.conditionalScenarios) {
    assert.equal(scenario.illustrationOnly, true);
    assert.equal(scenario.estimatedFullMatrixRuns, null);
    assert.equal(scenario.scope, 'infrastructure-smoke-only-not-offline-matrix');
  }
});

test('replaying exact evidence is idempotent and later reordered observations do not double count', () => {
  const original = attested();
  const unchanged = ledgerBytes(original);
  assert.deepEqual(ingestQuota(original, reportBytes), original);
  assert.deepEqual(attestOwnerBaseline(original, ownerBaselineReportId), original);
  const nextReport = structuredClone(report);
  nextReport.date = '2026-10-30T03:00:00.000Z';
  nextReport.history.sessions.reverse();
  const next = ingestQuota(original, bytes(nextReport));
  assert.equal(next.reports.length, 2);
  assert.equal(next.sessions.length, 15);
  assert.equal(budgetReport(next, now).observed.reportedDurationSeconds, 241);
  assert(
    next.sessions.every(
      ({ observations }) => observations.length === 1 && observations[0].reportIds.length === 2,
    ),
  );
  assert.deepEqual(ledgerBytes(original), unchanged);
  assert.deepEqual(next.baseline, original.baseline);
});

test('unknown baseline is explicit and cannot be attested against a different report', () => {
  const ledger = observed();
  assert(budgetReport(ledger, now).authoritative.reasons.includes('older-account-usage-unknown'));
  assert.equal(budgetReport(ledger, now).conditionalScenarios.length, 4);
  assert.throws(() => attestOwnerBaseline(ledger, 'f'.repeat(64)), /ledger-evidence-invalid/);
  const tampered = attested();
  tampered.baseline!.sessionIds.pop();
  assert.throws(() => readLedger(ledgerBytes(tampered)), /ledger-evidence-invalid/);
});

test('missing, conflicting and active evidence never becomes zero usage or available runs', () => {
  for (const change of ['missing', 'conflicting', 'active']) {
    const nextReport = structuredClone(report);
    nextReport.date = '2026-10-30T03:00:00.000Z';
    const observations = nextReport.history.sessions[0].observations;
    for (const entry of observations) {
      if (change === 'missing') entry.evidence.data.durationSeconds = null;
      if (change === 'conflicting') entry.evidence.data.durationSeconds += 1;
      if (change === 'active') entry.evidence.data.executionStatus = 'running';
    }
    nextReport.status = 'failed';
    const ledger =
      change === 'conflicting'
        ? ingestQuota(observed(), bytes(nextReport))
        : ingestQuota(emptyLedger(executions), bytes(nextReport));
    const summary = budgetReport(ledger, now);
    assert(summary.authoritative.reasons.includes('missing-or-conflicting-session-measurements'));
    assert(
      summary.conditionalScenarios.every(
        ({ assumedRemainingSeconds, estimatedSuccessfulSmokeRuns }) =>
          assumedRemainingSeconds === null && estimatedSuccessfulSmokeRuns === null,
      ),
    );
    if (change === 'conflicting') assert.equal(ledger.sessions[0].observations.length, 2);
  }
});

test('partial history and uncertain reservations remain visible even with all known measurements', () => {
  const nextReport = structuredClone(report);
  nextReport.history.buildPagination.outcome = 'request-limit';
  const partial = budgetReport(ingestQuota(emptyLedger(executions), bytes(nextReport)), now);
  assert(partial.authoritative.reasons.includes('latest-history-incomplete'));
  assert(
    partial.conditionalScenarios.every(
      ({ assumedRemainingSeconds }) => assumedRemainingSeconds === null,
    ),
  );
  const ledger = attested();
  ledger.reservations.push({
    run: executions[0].run,
    attempt: 2,
    reservedSeconds: 120,
    createdAt: '2026-10-29T00:00:00.000Z',
    state: 'uncertain',
    sessionIds: [],
  });
  const next = ingestQuota(ledger, reportBytes);
  assert.deepEqual(next.reservations, ledger.reservations);
  const summary = budgetReport(next, now);
  assert(summary.authoritative.reasons.includes('unsettled-reservations'));
  assert(
    summary.conditionalScenarios.every(
      ({ assumedRemainingSeconds }) => assumedRemainingSeconds === null,
    ),
  );
});

test('empty evidence cannot produce an assumed remaining allowance', () => {
  const summary = budgetReport(emptyLedger(executions), now);
  assert(summary.authoritative.reasons.includes('latest-history-incomplete'));
  assert(
    summary.conditionalScenarios.every(
      ({ assumedRemainingSeconds }) => assumedRemainingSeconds === null,
    ),
  );
});

test('safe projection excludes provider names, URLs and raw errors', () => {
  const dirty = structuredClone(report);
  dirty.rawError = 'SECRET';
  dirty.history.sessions[0].publicUrl = 'https://example.test/?token=SECRET';
  dirty.history.sessions[0].observations[0].source = 'SECRET';
  const ledger = ingestQuota(emptyLedger(executions), bytes(dirty));
  assert(!ledgerBytes(ledger).toString().includes('SECRET'));
  assert(!JSON.stringify(budgetReport(ledger, now)).includes('SECRET'));
  dirty.history.sessions[0].observations[0].evidence.reason = 'SECRET';
  assert.throws(
    () => ingestQuota(emptyLedger(executions), bytes(dirty)),
    /^Error: ledger-evidence-invalid$/,
  );
});

test('malformed durable state, scalar coercion, duplicate identities and oversized bytes refuse', () => {
  const ledger = attested();
  const invalid = JSON.parse(ledgerBytes(ledger).toString());
  invalid.reports[0].collectionStatus = ['passed'];
  assert.throws(() => readLedger(bytes(invalid)), /ledger-evidence-invalid/);
  const input = structuredClone(report);
  input.status = ['passed'];
  assert.throws(
    () => ingestQuota(emptyLedger(executions), bytes(input)),
    /ledger-evidence-invalid/,
  );
  invalid.reports[0].collectionStatus = 'passed';
  invalid.sessions.push(invalid.sessions[0]);
  assert.throws(() => readLedger(bytes(invalid)), /ledger-evidence-invalid/);
  assert.throws(() => readLedger(Buffer.alloc(ledgerLimits.bytes + 1)), /ledger-size-limit/);
  assert.throws(() => readLedger(Buffer.from([0xff])), /ledger-evidence-invalid/);
  assert.throws(
    () => ingestQuota(ledger, Buffer.from('{"SECRET')),
    /^Error: ledger-evidence-invalid$/,
  );
  assert.throws(() => ingestQuota(ledger, Buffer.from([0xff])), /^Error: ledger-evidence-invalid$/);
  const reused = structuredClone(executions);
  reused[1].sessionIds[0] = reused[0].sessionIds[0];
  assert.throws(() => readLedger(ledgerBytes(emptyLedger(reused))), /ledger-evidence-invalid/);
});

test('older retained reports cannot conceal a newer partial collection', () => {
  const newer = structuredClone(report);
  newer.date = '2026-10-30T03:00:00.000Z';
  newer.status = 'failed';
  newer.history.buildPagination.outcome = 'request-limit';
  const original = ingestQuota(emptyLedger(executions), bytes(newer));
  const ledger = ingestQuota(original, reportBytes);
  assert.equal(ledger.reports.length, 2);
  const summary = budgetReport(ledger, now);
  assert.equal(summary.observed.latestCollection?.observedAt, newer.date);
  assert(summary.authoritative.reasons.includes('latest-history-incomplete'));
  assert(
    summary.conditionalScenarios.every(
      ({ assumedRemainingSeconds }) => assumedRemainingSeconds === null,
    ),
  );
});

test('rounded charges and sums refuse unsafe numeric ranges', () => {
  const input = structuredClone(report);
  for (const session of input.history.sessions)
    for (const entry of session.observations) entry.evidence.data.durationSeconds = 0;
  for (const entry of input.history.sessions[0].observations)
    entry.evidence.data.durationSeconds = Number.MAX_SAFE_INTEGER;
  const ledger = ingestQuota(emptyLedger(executions), bytes(input));
  assert.throws(() => budgetReport(ledger, now), /ledger-evidence-invalid/);
});

test('monthly targets skip an elapsed boundary, cross the year and remain bounded', () => {
  assert.deepEqual(monthlyDates(new Date('2026-12-01T17:15:00.000Z'), 2), [
    '2027-01-01T17:15:00.000Z',
    '2027-02-01T17:15:00.000Z',
  ]);
  assert.deepEqual(monthlyDates(new Date('2026-12-01T17:14:59.999Z'), 1), [
    '2026-12-01T17:15:00.000Z',
  ]);
  assert.throws(() => monthlyDates(new Date('invalid')), /ledger-evidence-invalid/);
  assert.throws(() => monthlyDates(now, 10_001), /ledger-evidence-invalid/);
  assert.throws(
    () => monthlyDates(new Date('0099-01-01T00:00:00.000Z')),
    /ledger-evidence-invalid/,
  );
});
