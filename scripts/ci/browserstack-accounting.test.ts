import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createBudgetReport, type QuotaEvidence } from './browserstack-budget.ts';
import { reconcileReservation, reserveCapability } from './browserstack-admission.ts';
import { quotaLimits, retainedSessionIds } from './browserstack-quota.ts';

test('quota CLI records the owner estimate and immutable persistence without allocating', async () => {
  await exercise('new', 'quota');
});
test('capability admission migrates observed v1 history and grants only a verified durable reservation', async () => {
  await exercise('valid', 'reserve');
  await exercise('write-denied', 'reserve');
});
test('a prepared zero-allocation receipt releases the reservation after an early build failure', async () => {
  await exercise('reconcile', 'reconcile');
});
test('malformed v1/v2 ledgers and literal null cannot reset history or reservation holds', async () => {
  for (const scenario of ['invalid', 'literal-null', 'primitive', 'invalid-state'] as const)
    await exercise(scenario, 'reserve');
});
test('quota reuses only prior durable expired history and preserves failed detail reads', async () => {
  for (const scenario of ['expired', 'expired-seed', 'expired-first-seen', 'expired-auth'] as const)
    await exercise(scenario, 'quota');
});
test('quota and reserve recover retained certain receipts without a new-attempt receipt artifact', async () => {
  await exercise('held-certain', 'quota');
  await exercise('held-certain', 'reserve');
  for (const scenario of ['held-uncertain', 'held-pending', 'held-stale'] as const)
    await exercise(scenario, 'quota');
});
test('dedicated inventory observations persist without changing quota or reservation decisions', async () => {
  for (const inventory of ['denied', 'malformed', 'empty', 'available', 'oversized'] as const)
    await exercise('valid', 'quota', inventory);
  await exercise('valid', 'reserve', 'available');
});
test('scope costs require durable successful reconciliation and remain available to later quota reports', async () => {
  await exercise('reconcile', 'reconcile', 'denied', 'passed');
  await exercise('write-denied', 'reconcile', 'denied', 'passed');
  for (const scope of ['failed', 'unknown', 'mismatch'] as const)
    await exercise('reconcile', 'reconcile', 'denied', scope);
  await exercise('valid', 'quota', 'denied', 'stored');
});
test('complete paid-plan cost and hypothetical forecast appear only after verified durable persistence', async () => {
  await exercise('valid', 'quota', 'denied', 'complete');
  await exercise('write-denied', 'quota', 'denied', 'complete');
});

type Scenario =
  | 'new'
  | 'valid'
  | 'write-denied'
  | 'reconcile'
  | 'invalid'
  | 'literal-null'
  | 'primitive'
  | 'invalid-state'
  | 'expired'
  | 'expired-seed'
  | 'expired-first-seen'
  | 'expired-auth'
  | 'held-certain'
  | 'held-uncertain'
  | 'held-pending'
  | 'held-stale';
type Inventory = 'denied' | 'malformed' | 'empty' | 'available' | 'oversized';
type ScopeResult = 'passed' | 'failed' | 'unknown' | 'mismatch' | 'stored' | 'complete';
async function exercise(
  scenario: Scenario,
  operation: 'quota' | 'reserve' | 'reconcile',
  inventory: Inventory = 'denied',
  scope?: ScopeResult,
) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-accounting-'));
  try {
    const fixturePath = fileURLToPath(
      new URL('../../docs/implementation/SPN-090-browserstack-history.json', import.meta.url),
    );
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as QuotaEvidence;
    const isExpired = scenario.startsWith('expired');
    const isHeld = scenario.startsWith('held');
    const canPersist = ![
      'write-denied',
      'invalid',
      'literal-null',
      'primitive',
      'invalid-state',
    ].includes(scenario);
    const successful =
      canPersist &&
      !['expired-first-seen', 'expired-auth', 'held-pending'].includes(scenario) &&
      scope !== 'mismatch';
    const policy = JSON.parse(
      await readFile(
        new URL('../../docs/implementation/SPN-090-budget-assumptions.json', import.meta.url),
        'utf8',
      ),
    );
    const source = {
      observedAt: new Date(Date.now() - 60_000).toISOString(),
      sourceSha: 'b'.repeat(40),
      testedSha: 'c'.repeat(40),
      run: 'https://github.com/mxbaylee/spinel/actions/runs/123456',
    };
    const observed = createBudgetReport({ ...source, evidence: fixture, previousLedger: null });
    assert.ok(observed.ledger);
    const reserved = reserveCapability({
      source,
      evidence: fixture,
      ledger: observed.ledger,
      policy,
      state: null,
      runId: '123456',
      attempt: '1',
    });
    assert.equal(reserved.created, true);
    let ledger = observed.ledger;
    let state = reserved.state;
    const current = structuredClone(fixture);
    const newId = 'd'.repeat(40);
    const allocated = structuredClone(fixture);
    allocated.history.sessions.push({
      sessionId: newId,
      buildIds: [allocated.history.builds[0].buildId],
      conflict: false,
      observations: [
        {
          source: 'build-list',
          evidence: {
            outcome: 'available',
            data: {
              durationSeconds: 19,
              providerStatus: 'failed',
              executionStatus: 'error',
              createdAt: new Date(Date.now() - 55_000).toISOString(),
            },
          },
        },
      ],
    });
    allocated.history.builds[0].sessionIds.push(newId);
    const completedReceipt = {
      runId: '123456',
      attempt: '1',
      sourceSha: source.sourceSha,
      testedSha: source.testedSha,
      finishedAt: new Date(Date.now() - 1000).toISOString(),
      sessionIds: [newId],
      uncertainAllocation: false,
    };
    const scopeJournal = {
      schemaVersion: 1,
      runId: scope === 'mismatch' ? '654321' : completedReceipt.runId,
      attempt: completedReceipt.attempt,
      sourceSha: source.sourceSha,
      testedSha: source.testedSha,
      reservationId: reserved.reservation!.id,
      capabilityScope: scope === 'unknown' ? 'unknown' : 'safari-acceptance',
      allocationPlan: 'safari-acceptance',
      status: scope === 'failed' ? 'failed' : 'passed',
      stage: 'finished',
      fullMatrixStatus: 'incomplete',
      receipt: completedReceipt,
      lanes: ['chrome', 'firefox', 'safari'].map((browser) =>
        browser === 'safari'
          ? {
              target: { browser },
              status: 'passed',
              stage: 'safari-acceptance-complete',
              sessionId: newId,
              allocation: 'known',
              uncertainAllocation: false,
              startedAt: new Date(Date.now() - 54_000).toISOString(),
              finishedAt: new Date(Date.now() - 2000).toISOString(),
              cleanup: { network: 'restored-4g-lte-good', session: 'deleted', fixture: 'closed' },
            }
          : {
              target: { browser },
              status: browser === 'firefox' ? 'blocked' : 'not-run',
              allocation: 'not-started',
              uncertainAllocation: false,
            },
      ),
    };
    if (scope) {
      current.history = allocated.history;
      if (scope === 'stored' || scope === 'complete') {
        const storedSource = { ...source, observedAt: new Date().toISOString() };
        state = reconcileReservation({
          source: storedSource,
          ledger,
          evidence: allocated,
          policy,
          state,
          receipt: completedReceipt,
          journal: scopeJournal,
        }).state;
        if (scope === 'complete') {
          const template = state.reservations[0];
          const scopes = [
            'chrome-acceptance',
            'chrome-tab-acceptance',
            'firefox-tab-acceptance',
            'safari-tab-acceptance',
          ] as const;
          for (const [index, successfulScope] of scopes.entries()) {
            const sessionId = (100 + index).toString(16).padStart(40, '0');
            const runId = String(123457 + index);
            const session = structuredClone(allocated.history.sessions.at(-1)!);
            session.sessionId = sessionId;
            allocated.history.sessions.push(session);
            allocated.history.builds[0].sessionIds.push(sessionId);
            state.reservations.push({
              ...template,
              id: `${runId}-1-${source.sourceSha}`,
              runId,
              sessionIds: [sessionId],
              successfulScope,
            });
          }
        }
        ledger = createBudgetReport({
          ...storedSource,
          evidence: allocated,
          previousLedger: ledger,
        }).ledger!;
      }
    }
    if (isExpired) {
      if (scenario === 'expired-first-seen')
        ledger.sessions = ledger.sessions.filter(
          (entry) => entry.sessionId !== retainedSessionIds[0],
        );
      for (const build of current.history.builds)
        build.sessionIds = build.sessionIds.filter(
          (id) =>
            !(retainedSessionIds as readonly string[]).includes(id) ||
            (scenario === 'expired-first-seen' && id === retainedSessionIds[0]),
        );
    }
    if (isHeld) {
      if (scenario === 'held-stale') {
        const earlier = createBudgetReport({
          ...source,
          observedAt: new Date(Date.now() - 40_000).toISOString(),
          evidence: allocated,
          previousLedger: ledger,
        });
        assert.ok(earlier.ledger);
        ledger = earlier.ledger;
      } else current.history = allocated.history;
      if (scenario !== 'held-pending') {
        state = reconcileReservation({
          source: { ...source, observedAt: new Date(Date.now() - 20_000).toISOString() },
          ledger,
          evidence: fixture,
          policy,
          state,
          receipt: {
            runId: '123456',
            attempt: '1',
            sourceSha: source.sourceSha,
            testedSha: source.testedSha,
            finishedAt: new Date(Date.now() - 30_000).toISOString(),
            sessionIds: [newId],
            uncertainAllocation: scenario === 'held-uncertain',
          },
        }).state;
        assert.equal(state.reservations[0].status, 'held');
      }
    }
    const currentFixturePath = join(directory, 'current.json');
    await writeFile(currentFixturePath, JSON.stringify(current));
    const initial =
      scenario === 'new' || scenario === 'expired-seed'
        ? ''
        : scenario === 'literal-null'
          ? 'null'
          : scenario === 'primitive'
            ? '42'
            : JSON.stringify(
                scenario === 'invalid'
                  ? { schemaVersion: 1, ledger: null, latest: {} }
                  : scenario === 'invalid-state'
                    ? {
                        schemaVersion: 2,
                        ledger: observed.ledger,
                        admissionState: null,
                        latest: {},
                      }
                    : scenario === 'reconcile' || isHeld || scope
                      ? {
                          schemaVersion: 2,
                          ledger,
                          admissionState: state,
                          latest: {},
                        }
                      : { schemaVersion: 1, ledger, latest: {} },
              );
    if (operation === 'reconcile') {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(directory, 'artifacts'));
      await writeFile(
        join(directory, 'artifacts/browserstack-capability.json'),
        JSON.stringify(
          scope
            ? scopeJournal
            : {
                receipt: {
                  runId: '123456',
                  attempt: '1',
                  sourceSha: source.sourceSha,
                  testedSha: source.testedSha,
                  finishedAt: new Date(Date.now() - 1000).toISOString(),
                  sessionIds: [],
                  uncertainAllocation: false,
                },
              },
        ),
      );
    }
    const hook = join(directory, 'provider-fixture.ts');
    await writeFile(
      hook,
      String.raw`
import { readFileSync, writeFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(${JSON.stringify(currentFixturePath)}, 'utf8'));
const calls = [];
const hash = 'a'.repeat(40);
let stored = ${JSON.stringify(initial)};
function raw(id) {
  const entry = fixture.history.sessions.find(s => s.sessionId === id);
  const data = entry.observations.find(o => o.evidence.outcome === 'available').evidence.data;
  return { automation_session: { hashed_id: id, duration: data.durationSeconds,
    status: data.providerStatus, browserstack_status: data.executionStatus, created_at: data.createdAt } };
}
globalThis.fetch = async (url, init) => {
  const parsed = new URL(String(url));
  const method = init.method;
  calls.push({ host: parsed.host, path: parsed.pathname, method });
  writeFileSync(${JSON.stringify(join(directory, 'calls.json'))}, JSON.stringify(calls));
  if (parsed.host === 'api-cloud.browserstack.com') {
    if (parsed.href !== 'https://api-cloud.browserstack.com/automate/dedicated_devices' ||
        method !== 'GET' || init.body !== undefined || init.redirect !== 'error')
      throw new Error('unexpected dedicated inventory request');
    if (new Headers(init.headers).get('Authorization') !== 'Basic ' + Buffer.from('unit-provider-user:unit-provider-key').toString('base64'))
      throw new Error('missing inventory authentication');
    if (${JSON.stringify(operation)} === 'reconcile') throw new Error('reconciliation must not request inventory');
    if (${JSON.stringify(inventory)} === 'denied') return new Response('inventory-private-error', { status: 403 });
    if (${JSON.stringify(inventory)} === 'malformed') return Response.json({ devices: [], detail: 'inventory-private-error' });
    if (${JSON.stringify(inventory)} === 'empty') return Response.json([]);
    if (${JSON.stringify(inventory)} === 'oversized') return new Response('inventory-private-error', { headers: { 'content-length': '${quotaLimits.bytes + 1}' } });
    return Response.json({ os: 'android', realMobile: true, state: 'available',
      device: 'inventory-private-name', udid: 'inventory-private-udid',
      sim_details: [{ phone_number: 'inventory-private-phone' }], in_use_by: 'inventory-private-email' });
  }
  if (parsed.host === 'api.browserstack.com') {
    if (method !== 'GET') throw new Error('provider mutation forbidden');
    const path = parsed.pathname;
    if (path.endsWith('/plan.json')) return Response.json({ parallel_sessions_max_allowed: 5, parallel_sessions_running: 0, queued_sessions: 0 });
    if (path.endsWith('/builds.json')) return Response.json(fixture.history.builds.map(b => ({ automation_build: { hashed_id: b.buildId, status: 'done' } })));
    const build = path.match(/builds\/([a-f0-9]{40})\/sessions.json$/);
    if (build) return Response.json(fixture.history.builds.find(b => b.buildId === build[1]).sessionIds.map(raw));
    const detail = path.match(/sessions\/([a-f0-9]{40}).json$/);
    if (detail) {
      if (${isExpired} && ${JSON.stringify(retainedSessionIds)}.includes(detail[1]))
        return new Response('', { status: ${scenario === 'expired-auth' ? 403 : scenario === 'expired-seed' ? 410 : 404} });
      return Response.json(raw(detail[1]));
    }
    throw new Error('unknown provider endpoint');
  }
  if (parsed.host !== 'api.github.com' || !parsed.pathname.startsWith('/repos/mxbaylee/spinel/')) throw new Error('unexpected host');
  const path = parsed.pathname.slice('/repos/mxbaylee/spinel/'.length);
  // One malformed-inventory case also loses the read-only run listing.
  if (path.startsWith('actions/') && ${JSON.stringify(inventory)} === 'malformed') return new Response('actions-private-error', { status: 500 });
  if (path.startsWith('actions/') && method === 'GET') return path.endsWith('/jobs') ? Response.json({ total_count: 0, jobs: [] }) : Response.json({ total_count: 0, workflow_runs: [] });
  if (path === 'git/ref/heads/ci/browserstack-accounting') return stored ? Response.json({ object: { sha: hash } }) : new Response('', { status: 404 });
  if (path === 'contents/ledger.json' && method === 'GET') return Response.json({ type: 'file', path: 'ledger.json', encoding: 'base64', sha: hash, size: Buffer.byteLength(stored), content: Buffer.from(stored).toString('base64') });
  if (${JSON.stringify(scenario)} === 'write-denied') return new Response('unit-github-token', {status: 403});
  if (!${canPersist}) throw new Error('invalid ledger must not be overwritten');
  const body = JSON.parse(init.body);
  if (path === 'contents/ledger.json' && method === 'PUT') {
    if (body.sha !== hash || body.branch !== 'ci/browserstack-accounting') throw new Error('missing conflict check');
    stored = Buffer.from(body.content, 'base64').toString('utf8');
    writeFileSync(${JSON.stringify(join(directory, 'stored.json'))}, stored);
    return Response.json({ commit: {sha: hash} });
  }
  if (path === 'git/trees') {
    if (body.tree.length !== 1 || body.tree[0].path !== 'ledger.json') throw new Error('unexpected path');
    stored = body.tree[0].content;
    writeFileSync(${JSON.stringify(join(directory, 'stored.json'))}, stored);
    return Response.json({ sha: hash });
  }
  if (path === 'git/commits') {
    if (body.parents.length !== 0) throw new Error('source branch mutation');
    return Response.json({ sha: hash });
  }
  if (path === 'git/refs' && body.ref === 'refs/heads/ci/browserstack-accounting') return Response.json({ object: { sha: hash } });
  throw new Error('unexpected GitHub mutation');
};
`,
    );
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        hook,
        fileURLToPath(new URL('./browserstack-accounting.ts', import.meta.url)),
        operation,
      ],
      {
        cwd: directory,
        // Generous: the suite may share the machine with other serial workloads.
        timeout: 30_000,
        encoding: 'utf8',
        env: {
          ...process.env,
          BS_USERNAME: 'unit-provider-user',
          BS_ACCESS_KEY: 'unit-provider-key',
          GITHUB_TOKEN: 'unit-github-token',
          SOURCE_SHA: source.sourceSha,
          GITHUB_SHA: source.testedSha,
          GITHUB_REPOSITORY: 'mxbaylee/spinel',
          GITHUB_RUN_ID: '123456',
          GITHUB_RUN_ATTEMPT: isHeld ? '2' : '1',
          GITHUB_OUTPUT: join(directory, 'output'),
          GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
        },
      },
    );
    assert.equal(child.status, successful ? 0 : 1, child.stderr + child.stdout);
    assert.equal(child.stderr, '', child.stdout);
    const basename =
      operation === 'reconcile' ? 'browserstack-reconciliation' : 'browserstack-admission';
    const report = JSON.parse(
      await readFile(join(directory, `artifacts/${basename}.json`), 'utf8'),
    );
    const calls = JSON.parse(await readFile(join(directory, 'calls.json'), 'utf8')) as {
      host: string;
      path: string;
      method: string;
    }[];
    const allocationAllowed = successful && operation === 'reserve';
    assert.equal(report.allocationAllowed, allocationAllowed);
    assert.equal(report.remainingMinutes, null);
    assert.equal(report.providerVerified, false);
    assert.equal(
      await readFile(join(directory, 'output'), 'utf8'),
      `allocation_allowed=${allocationAllowed}\n`,
    );
    const summary = await readFile(join(directory, 'summary.md'), 'utf8');
    assert.match(summary, /60 lifetime minutes/);
    // The displaced-run report is appended after admission and never changes it;
    // reconciliation runs after devices and skips it.
    if (operation === 'reconcile') assert.doesNotMatch(summary, /Runs cancelled before/);
    else if (inventory === 'malformed') {
      // A failed listing still leaves allocation_allowed and the exit as asserted above.
      assert.match(summary, /- Unavailable \(http-500\); check the group by hand\./);
      assert.doesNotMatch(summary, /actions-private-error/);
    } else
      assert.match(
        summary,
        /## Runs cancelled before any job started\n\n- None since \d{4}-\d{2}-\d{2}\./,
      );
    assert.match(
      await readFile(join(directory, 'summary.md'), 'utf8'),
      /Device Tunnel, native Firefox and charging unverified/,
    );
    assert.match(summary, /budget scenario, not a forecast of measured successful runs/);
    for (const date of [
      report.estimate?.lastEstimatedFundableCapabilityDate,
      report.estimate?.firstEstimatedUnfundableCapabilityDate,
    ])
      if (date)
        assert.ok(
          summary.includes(date),
          'the conditional reservation dates reach the human report',
        );
    const hasScopeCost =
      canPersist && (scope === 'passed' || scope === 'stored' || scope === 'complete');
    const hasCompleteCost = hasScopeCost && scope === 'complete';
    assert.equal(
      report.estimate?.successfulScopeCosts.length ?? 0,
      hasCompleteCost ? 5 : hasScopeCost ? 1 : 0,
    );
    if (hasScopeCost) {
      const sample = report.estimate.successfulScopeCosts[0];
      assert.equal(sample.scope, 'safari-acceptance');
      assert.equal(sample.measuredElapsedSeconds, 19);
      assert.equal(sample.estimatedChargedSeconds, 19);
      assert.equal(sample.reservationId, reserved.reservation!.id);
      assert.equal(sample.sourceSha, source.sourceSha);
      assert.equal(sample.testedSha, source.testedSha);
      assert.deepEqual(sample.sessionIds, [newId]);
      assert.match(summary, /Latest successful safari-acceptance cost/);
      assert.match(summary, /19 measured elapsed seconds/);
    } else assert.match(summary, /Successful selected-scope cost \| Unknown/);
    if (hasCompleteCost) {
      assert.equal(report.estimate.completeOfflineMatrixCostMinutes, 95 / 60);
      assert.equal(report.estimate.estimatedSuccessfulCompleteRuns, 21);
      assert.equal(report.estimate.completePaidCoverage.components.length, 5);
      assert.equal(report.estimate.completePaidCoverage.sourceSha, source.sourceSha);
      assert.equal(report.estimate.completePaidCoverage.testedSha, source.testedSha);
      assert.equal(report.estimate.completePaidCoverage.matchesReportIdentity, true);
      assert.equal(
        report.estimate.completePaidCoverage.forecast.actualMonthlyScope,
        'safari-acceptance',
      );
      assert.match(summary, /1\.58 measured summed minutes \/ 21/);
      assert.ok(summary.includes(report.estimate.projectedFullMatrixExhaustion));
      assert.match(summary, /Sum of five successful component samples/);
      assert.match(
        summary,
        /976 required starting usable seconds; 2964 usable after holds and reserve/,
      );
    } else {
      assert.equal(report.estimate?.completePaidCoverage ?? null, null);
      assert.equal(report.estimate?.completeOfflineMatrixCostMinutes ?? null, null);
      assert.equal(report.estimate?.estimatedSuccessfulCompleteRuns ?? null, null);
      assert.equal(report.estimate?.projectedFullMatrixExhaustion ?? null, null);
      assert.match(
        summary,
        /Approved paid-plan cost \/ hypothetical complete runs \/ first unfundable date \| Unmeasured \/ Unknown \/ Unknown/,
      );
    }
    assert.match(summary, /The actual monthly workflow runs Safari acceptance only/);
    const inventoryCalls = calls.filter((call) => call.host === 'api-cloud.browserstack.com');
    assert.deepEqual(
      inventoryCalls,
      operation === 'reconcile'
        ? []
        : [
            {
              host: 'api-cloud.browserstack.com',
              path: '/automate/dedicated_devices',
              method: 'GET',
            },
          ],
    );
    const expectedInventory =
      operation === 'reconcile'
        ? { outcome: 'not-requested' }
        : inventory === 'empty' || inventory === 'available'
          ? {
              outcome: 'available',
              data: {
                returnedEntries: inventory === 'available' ? 1 : 0,
                availableRealAndroidEntries: inventory === 'available' ? 1 : 0,
                availableRealIosEntries: 0,
                otherEntries: 0,
              },
            }
          : {
              outcome: 'unavailable',
              reason:
                inventory === 'denied'
                  ? 'http-403'
                  : inventory === 'oversized'
                    ? 'response-too-large'
                    : 'invalid-response',
            };
    assert.deepEqual(report.evidence.dedicatedDevices, expectedInventory);
    assert.ok(calls.every((call) => call.host === 'api.github.com' || call.method === 'GET'));
    assert.equal(
      calls[0].host,
      'api.github.com',
      'durable history is loaded before current collection',
    );
    assert.ok(
      calls.every((call) =>
        ['api.browserstack.com', 'api-cloud.browserstack.com', 'api.github.com'].includes(
          call.host,
        ),
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(report) + child.stdout + child.stderr,
      /unit-provider-user|unit-provider-key|unit-github-token|inventory-private|udid|sim_details|in_use_by/,
    );
    if (canPersist) {
      assert.equal(
        report.measuredTerminalSessionSeconds,
        scope === 'complete' ? 336 : isHeld || scope ? 260 : 241,
      );
      assert.equal(
        report.measuredTerminalSessions,
        scope === 'complete' ? 20 : isHeld || scope ? 16 : 15,
      );
      assert.equal(
        report.estimate.estimatedRemainingSeconds,
        ['expired-first-seen', 'expired-auth'].includes(scenario)
          ? null
          : scope === 'complete'
            ? 3264
            : isHeld || scope
              ? 3340
              : 3359,
      );
      assert.equal(report.persistence.status, 'verified');
      const stored = JSON.parse(await readFile(join(directory, 'stored.json'), 'utf8'));
      assert.deepEqual(stored.latest.evidence.dedicatedDevices, expectedInventory);
      assert.doesNotMatch(JSON.stringify(stored), /inventory-private|udid|sim_details|in_use_by/);
      assert.equal(stored.schemaVersion, 2);
      assert.equal(
        stored.ledger.sessions.length,
        scope === 'complete' ? 20 : isHeld || scope ? 16 : 15,
      );
      assert.equal(stored.latest.evidence.history.builds.length, 5);
      assert.equal(stored.latest.report.allocationAllowed, false);
      assert.deepEqual(
        stored.latest.estimate?.successfulScopeCosts ?? [],
        report.estimate?.successfulScopeCosts ?? [],
      );
      assert.deepEqual(
        stored.latest.estimate?.completePaidCoverage ?? null,
        report.estimate?.completePaidCoverage ?? null,
      );
      if (!successful) assert.equal(report.status, 'blocked');
      else if (operation === 'reserve') {
        assert.equal(report.status, 'reserved');
        assert.equal(report.reservation.seconds, 900);
        assert.deepEqual(report.admissionState, stored.admissionState);
        assert.equal(report.estimate.outstandingHoldSeconds, 900);
      } else if (operation === 'reconcile') {
        assert.equal(report.status, 'reconciled');
        assert.equal(stored.admissionState.reservations[0].status, 'reconciled');
        assert.equal(report.estimate.outstandingHoldSeconds, 0);
      } else assert.equal(report.status, 'estimated');
      if (isExpired) {
        assert.equal(stored.latest.evidence.status, 'failed');
        assert.ok(stored.latest.report.blockingReasons.includes('current-collection-incomplete'));
        assert.equal(
          stored.ledger.sessions.filter(
            (entry: { readFailures: unknown[] }) => entry.readFailures.length,
          ).length,
          6,
        );
        assert.equal(stored.latest.estimate.reusedFinalizedHistory.length, successful ? 6 : 0);
        if (scenario === 'expired-first-seen')
          assert.ok(
            stored.latest.evidence.history.sessions
              .find((entry: { sessionId: string }) => entry.sessionId === retainedSessionIds[0])
              .observations.some((entry: { source: string }) => entry.source === 'build-list'),
          );
      }
      if (isHeld) {
        const original = stored.admissionState.reservations[0];
        assert.equal(original.attempt, '1');
        assert.equal(original.id, reserved.reservation!.id);
        if (scenario === 'held-certain') {
          assert.equal(original.status, 'reconciled');
          assert.equal(original.finishedAt, state.reservations[0].finishedAt);
          assert.deepEqual(original.sessionIds, [newId]);
          assert.deepEqual(report.recoveredReservationIds, [original.id]);
          assert.equal(report.estimate.outstandingHoldSeconds, operation === 'reserve' ? 900 : 0);
          if (operation === 'reserve') assert.equal(report.reservation.attempt, '2');
        } else {
          assert.equal(original.status, scenario === 'held-pending' ? 'reserved' : 'held');
          assert.equal(
            report.estimate.outstandingHoldSeconds,
            scenario === 'held-pending' ? 900 : 881,
          );
          assert.deepEqual(report.recoveredReservationIds, []);
        }
      }
    } else {
      assert.equal(report.status, 'blocked');
      assert.equal(report.persistence.status, 'failed');
      if (scenario === 'write-denied')
        assert.ok(report.blockingReasons.includes('ledger-http-403'));
      else assert.ok(calls.every((call) => call.method === 'GET'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
