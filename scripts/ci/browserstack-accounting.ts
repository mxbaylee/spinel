import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createBudgetReport, type QuotaEvidence } from './browserstack-budget.ts';
import { ledgerClient, ledgerFailure } from './browserstack-ledger.ts';
import { collectQuotaEvidence } from './browserstack-quota.ts';

async function main() {
  const evidence = await collectQuotaEvidence({
    username: process.env.BS_USERNAME ?? '',
    accessKey: process.env.BS_ACCESS_KEY ?? '',
  });
  const stamp = {
    observedAt: new Date().toISOString(),
    sourceSha: process.env.SOURCE_SHA ?? '',
    testedSha: process.env.GITHUB_SHA ?? '',
    run: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  };
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
  let store: ReturnType<typeof ledgerClient> | undefined;
  let snapshot: Awaited<ReturnType<ReturnType<typeof ledgerClient>['read']>> | undefined;
  let persistence: {
    status: 'failed' | 'verified';
    reason?: string;
    commit?: string;
    url?: string;
  } = {
    status: 'failed',
    reason: 'ledger-not-written',
  };
  try {
    store = ledgerClient({
      repository: process.env.GITHUB_REPOSITORY ?? '',
      token: process.env.GITHUB_TOKEN ?? '',
    });
    snapshot = await store.read();
    if (snapshot.value === null && snapshot.blobSha === null) previousLedger = seeded.ledger ?? {};
    else if (
      snapshot.value !== null &&
      typeof snapshot.value === 'object' &&
      !Array.isArray(snapshot.value) &&
      'schemaVersion' in snapshot.value &&
      snapshot.value.schemaVersion === 1 &&
      'ledger' in snapshot.value &&
      snapshot.value.ledger !== null &&
      typeof snapshot.value.ledger === 'object'
    )
      previousLedger = snapshot.value.ledger;
  } catch (error) {
    persistence.reason = ledgerFailure(error);
  }
  const { ledger, report } = createBudgetReport({ evidence, previousLedger, ...stamp });
  if (store && snapshot && ledger) {
    try {
      const stored = await store.write(
        snapshot,
        {
          schemaVersion: 1,
          ledger,
          latest: { evidence, report },
        },
        process.env.GITHUB_RUN_ID ?? '',
        process.env.GITHUB_RUN_ATTEMPT ?? '',
      );
      persistence = { status: 'verified', ...stored };
    } catch (error) {
      persistence.reason = ledgerFailure(error);
    }
  }
  if (persistence.status !== 'verified')
    report.blockingReasons.push(persistence.reason ?? 'ledger-not-written');
  const result = { ...report, persistence, evidence };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/browserstack-admission.json', `${JSON.stringify(result, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, 'allocation_allowed=false\n');
  const summary = [
    '# BrowserStack lifetime quota — devices blocked',
    '',
    'The allowance is **60 lifetime minutes and never renews**. No device or Local tunnel was started.',
    '',
    '| Observation | Result |',
    '| --- | --- |',
    `| Measured terminal sessions | ${report.measuredTerminalSessions} of ${report.retainedSessions} retained unique IDs |`,
    `| Measured terminal session time | ${report.measuredTerminalSessionSeconds ?? 'Unknown'} seconds; elapsed time, not verified charged credit |`,
    '| Remaining minutes | Unknown |',
    '| Complete installed-phone matrix cost | Unmeasured |',
    '| Estimated successful complete runs | Unknown |',
    '| Projected exhaustion / first unfundable date | Unknown |',
    `| Durable accounting | ${persistence.url ? `[Verified commit](${persistence.url})` : persistence.reason} |`,
    '',
    '## Next monthly checks',
    '',
    ...report.nextMonthlyDates.map((date) => `- ${date} (09:17 UTC; GitHub may delay execution)`),
    '',
    '## Admission blockers',
    '',
    ...report.blockingReasons.map((reason) => `- ${reason}`),
    '',
    '## Interpretation',
    '',
    ...report.assumptions.map((assumption) => `- ${assumption}`),
    '',
    `Source: \`${stamp.sourceSha}\`; tested: \`${stamp.testedSha}\`.`,
    'The full physical offline contract remains open. An accounting report is not installed-device acceptance.',
    '',
  ].join('\n');
  await writeFile('artifacts/browserstack-admission.md', summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(
    JSON.stringify({
      status: report.status,
      allocationAllowed: false,
      measuredTerminalSessionSeconds: report.measuredTerminalSessionSeconds,
      remainingMinutes: null,
      persistence,
      blockingReasons: report.blockingReasons,
    }),
  );
  // Unknown sufficiency must be a visible failure, including on the monthly schedule.
  process.exitCode = 1;
}

main().catch(() => {
  console.error(
    'BrowserStack accounting failed; allocation refused and no raw error or credentials logged.',
  );
  process.exitCode = 1;
});
