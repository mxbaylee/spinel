import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createBudgetReport, type QuotaEvidence } from './browserstack-budget.ts';
import {
  estimateBudget,
  readAdmissionPolicy,
  readAdmissionState,
  reconcileHeldReservations,
  reconcileReservation,
  reserveCapability,
  type AdmissionState,
  type EstimatedBudgetReport,
  type Reservation,
  type ReservationReceipt,
} from './browserstack-admission.ts';
import { ledgerClient, ledgerFailure } from './browserstack-ledger.ts';
import { collectQuotaEvidence } from './browserstack-quota.ts';

function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^admission-[a-z-]+$/.test(message) ? message : ledgerFailure(error);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function main() {
  const operation = process.argv[2] ?? 'quota';
  if (!['quota', 'reserve', 'reconcile'].includes(operation)) throw new Error('invalid-operation');
  const policy = readAdmissionPolicy(
    JSON.parse(
      await readFile(
        new URL('../../docs/implementation/SPN-090-budget-assumptions.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const runId = process.env.GITHUB_RUN_ID ?? '';
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '';
  const seed = JSON.parse(
    await readFile(
      new URL('../../docs/implementation/SPN-090-browserstack-history.json', import.meta.url),
      'utf8',
    ),
  ) as QuotaEvidence & { date: string; sourceSha: string; testedSha: string; run: string };
  const seeded = createBudgetReport({
    evidence: seed,
    previousLedger: null,
    observedAt: seed.date,
    sourceSha: seed.sourceSha,
    testedSha: seed.testedSha,
    run: seed.run,
  });
  let previousLedger: unknown = {};
  let admissionState: AdmissionState | undefined;
  let store: ReturnType<typeof ledgerClient> | undefined;
  let snapshot: Awaited<ReturnType<ReturnType<typeof ledgerClient>['read']>> | undefined;
  let persistence: {
    status: 'failed' | 'verified';
    reason?: string;
    commit?: string;
    url?: string;
  } = { status: 'failed', reason: 'ledger-not-written' };
  const blockers: string[] = [];
  try {
    store = ledgerClient({
      repository: process.env.GITHUB_REPOSITORY ?? '',
      token: process.env.GITHUB_TOKEN ?? '',
    });
    snapshot = await store.read();
    if (snapshot.value === null && snapshot.blobSha === null) {
      previousLedger = seeded.ledger ?? {};
      admissionState = { schemaVersion: 1, reservations: [] };
    } else if (object(snapshot.value)) {
      const envelope = snapshot.value;
      if (
        envelope.schemaVersion === 1 &&
        Object.keys(envelope).length === 3 &&
        ['schemaVersion', 'ledger', 'latest'].every((key) => Object.hasOwn(envelope, key))
      ) {
        // Only a recognized v1 envelope may migrate to the first reservation state.
        previousLedger = envelope.ledger ?? {};
        admissionState = { schemaVersion: 1, reservations: [] };
      } else if (
        envelope.schemaVersion === 2 &&
        Object.keys(envelope).length === 4 &&
        ['schemaVersion', 'ledger', 'admissionState', 'latest'].every((key) =>
          Object.hasOwn(envelope, key),
        )
      ) {
        previousLedger = envelope.ledger ?? {};
        admissionState = readAdmissionState(envelope.admissionState);
      } else throw new Error('admission-invalid-envelope');
    } else throw new Error('admission-invalid-envelope');
  } catch (error) {
    persistence.reason = failure(error);
    blockers.push(persistence.reason);
  }
  // Load the durable snapshot before collection. Admission must distinguish
  // previously finalized history from observations first seen in this run.
  const evidence = await collectQuotaEvidence({
    username: process.env.BS_USERNAME ?? '',
    accessKey: process.env.BS_ACCESS_KEY ?? '',
    includeDedicatedDevices: operation !== 'reconcile',
  });
  const source = {
    observedAt: new Date().toISOString(),
    sourceSha: process.env.SOURCE_SHA ?? '',
    testedSha: process.env.GITHUB_SHA ?? '',
    run: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`,
  };
  const { ledger, report: observedBudget } = createBudgetReport({
    evidence,
    previousLedger,
    ...source,
  });
  if (!ledger) blockers.push('invalid-durable-ledger');
  if (!admissionState) blockers.push('admission-state-unavailable');
  let estimate: EstimatedBudgetReport | null = null;
  let reservation: Reservation | null = null;
  let created = false;
  let released = false;
  const recoveredReservationIds: string[] = [];
  if (ledger && admissionState) {
    try {
      const input = { policy, state: admissionState, ledger: previousLedger, evidence, source };
      if (operation !== 'reconcile') {
        const recovered = reconcileHeldReservations(input);
        admissionState = recovered.state;
        input.state = admissionState;
        recoveredReservationIds.push(...recovered.releasedReservationIds);
      }
      if (operation === 'reserve') {
        const result = reserveCapability({ ...input, runId, attempt });
        admissionState = result.state;
        reservation = result.reservation;
        created = result.created;
        if (!created) blockers.push(...result.report.blockingReasons);
      } else if (operation === 'reconcile') {
        let receipt: ReservationReceipt;
        try {
          const result = JSON.parse(
            await readFile('artifacts/browserstack-capability.json', 'utf8'),
          ) as unknown;
          if (!object(result) || !object(result.receipt)) throw new Error('missing receipt');
          receipt = result.receipt as ReservationReceipt;
        } catch {
          throw new Error('admission-capability-receipt-unavailable');
        }
        if (
          receipt.runId !== runId ||
          receipt.attempt !== attempt ||
          receipt.sourceSha !== source.sourceSha ||
          receipt.testedSha !== source.testedSha
        )
          throw new Error('admission-receipt-identity-mismatch');
        const result = reconcileReservation({ ...input, receipt });
        admissionState = result.state;
        reservation = result.reservation;
        released = result.released;
        if (!released) blockers.push('admission-reservation-reconciliation-incomplete');
      }
      // This evaluates another reservation after this operation. A pending hold
      // correctly blocks another allocation, not the newly reserved current run.
      estimate = estimateBudget({ ...input, state: admissionState });
      if (operation === 'quota') blockers.push(...estimate.blockingReasons);
    } catch (error) {
      blockers.push(failure(error));
      // Keep the pre-operation state if parsing/reconciliation rejected a receipt.
      // Pure model functions never mutate caller-owned state on failure.
      try {
        estimate = estimateBudget({
          policy,
          state: admissionState,
          ledger: previousLedger,
          evidence,
          source,
        });
      } catch {}
    }
  }
  if (store && snapshot && ledger && admissionState) {
    try {
      persistence = {
        status: 'verified',
        ...(await store.write(
          snapshot,
          {
            schemaVersion: 2,
            ledger,
            admissionState,
            latest: {
              evidence,
              report: observedBudget,
              policy,
              estimate,
              operation,
              recoveredReservationIds,
              blockers,
            },
          },
          runId,
          attempt,
        )),
      };
    } catch (error) {
      persistence.reason = failure(error);
    }
  }
  if (persistence.status !== 'verified') blockers.push(persistence.reason ?? 'ledger-not-written');
  const allocationAllowed =
    operation === 'reserve' && created && persistence.status === 'verified' && !blockers.length;
  const successful =
    persistence.status === 'verified' &&
    !blockers.length &&
    (operation === 'reserve'
      ? created
      : operation === 'reconcile'
        ? released
        : estimate?.capabilitySufficient === true);
  const status = !successful
    ? 'blocked'
    : operation === 'reserve'
      ? 'reserved'
      : operation === 'reconcile'
        ? 'reconciled'
        : 'estimated';
  const result = {
    schemaVersion: 2,
    operation,
    status,
    allocationAllowed,
    ...source,
    runId,
    attempt,
    measuredTerminalSessionSeconds: observedBudget.measuredTerminalSessionSeconds,
    measuredTerminalSessions: observedBudget.measuredTerminalSessions,
    remainingMinutes: null,
    providerVerified: false,
    estimateSnapshot: 'after-operation-for-next-additional-reservation',
    estimate,
    policy,
    admissionState: admissionState ?? null,
    reservation,
    recoveredReservationIds,
    persistence,
    blockingReasons: [...new Set(blockers)],
    observedBudget,
    evidence,
  };
  await mkdir('artifacts', { recursive: true });
  const basename =
    operation === 'reconcile' ? 'browserstack-reconciliation' : 'browserstack-admission';
  await writeFile(`artifacts/${basename}.json`, `${JSON.stringify(result, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `allocation_allowed=${allocationAllowed}\n`);
  const inventory = evidence.dedicatedDevices;
  const inventorySummary =
    inventory.outcome === 'available'
      ? `${inventory.data.availableRealAndroidEntries} available real Android entries / ${inventory.data.returnedEntries} total entries`
      : inventory.outcome === 'unavailable'
        ? `Unknown (${inventory.reason})`
        : 'Not requested for reconciliation';
  const summary = [
    '# BrowserStack lifetime quota — owner-authorized estimate',
    '',
    'The allowance is **60 lifetime minutes and never renews**. This accounting step allocates no device or Local tunnel.',
    '',
    '| Observation | Result |',
    '| --- | --- |',
    `| Accounting operation | ${operation}: ${status} |`,
    `| Dedicated-device inventory | ${inventorySummary}; Device Tunnel, native Firefox and charging unverified |`,
    `| Measured terminal sessions/time | ${observedBudget.measuredTerminalSessions} / ${observedBudget.measuredTerminalSessionSeconds ?? 'Unknown'} elapsed seconds |`,
    `| Estimated remaining credit | ${estimate?.estimatedRemainingMinutes === null || estimate?.estimatedRemainingMinutes === undefined ? 'Unknown' : estimate.estimatedRemainingMinutes.toFixed(2) + ' minutes'}; provider balance unverified |`,
    `| Safety reserve / outstanding holds | ${estimate?.safetyReserveSeconds ?? 'Unknown'} / ${estimate?.outstandingHoldSeconds ?? 'Unknown'} seconds |`,
    `| Current reservation | ${reservation ? reservation.id + ': ' + reservation.seconds + ' seconds, ' + reservation.status : 'None'} |`,
    `| Retained certain holds reconciled | ${recoveredReservationIds.length} |`,
    `| Finalized historical measurements reused after 404/410 | ${estimate?.reusedFinalizedHistory.length ?? 0}; raw failures retained |`,
    `| Additional 15-minute capability reservations | ${estimate?.estimatedAdditionalCapabilityReservations ?? 'Unknown'}; conditional estimate |`,
    '| Full installed-phone matrix cost/successful runs/exhaustion | Unmeasured / Unknown / Unknown |',
    `| Durable accounting | ${persistence.url ? '[Verified commit](' + persistence.url + ')' : persistence.reason} |`,
    '',
    '## Next monthly checks',
    '',
    ...observedBudget.nextMonthlyDates.map((date) => '- ' + date),
    '',
    '## Current operation blockers',
    '',
    ...(result.blockingReasons.length
      ? result.blockingReasons.map((reason) => '- ' + reason)
      : ['- None for this accounting operation.']),
    '',
    '## Assumptions',
    '',
    ...(estimate?.assumptions ?? []).map((value) => '- ' + value),
    '',
    `Source: ${source.sourceSha}; tested: ${source.testedSha}.`,
    'Actual installed-phone acceptance remains a separate observed contract.',
    '',
  ].join('\n');
  await writeFile(`artifacts/${basename}.md`, summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(
    JSON.stringify({
      status,
      allocationAllowed,
      estimatedRemainingMinutes: estimate?.estimatedRemainingMinutes ?? null,
      reservation: reservation
        ? { id: reservation.id, status: reservation.status, seconds: reservation.seconds }
        : null,
      persistence,
      blockingReasons: result.blockingReasons,
    }),
  );
  if (!successful) process.exitCode = 1;
}

main().catch(() => {
  console.error(
    'BrowserStack accounting failed; allocation refused and no raw error or credentials logged.',
  );
  process.exitCode = 1;
});
