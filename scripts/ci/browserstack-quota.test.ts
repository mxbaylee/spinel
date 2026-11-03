import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { collectQuotaEvidence, quotaLimits, retainedSessionIds } from './browserstack-quota.ts';
import { createBudgetReport } from './browserstack-budget.ts';
import type { CapabilityScope } from './browserstack-scope.ts';

const credentials = { username: 'secret-user', accessKey: 'secret-key' };
function success(url: string | URL | Request) {
  if (String(url).includes('?limit=')) return Response.json([]);
  const id = String(url).match(/sessions\/([a-f0-9]+)\.json$/)?.[1];
  return Response.json(
    id
      ? {
          automation_session: {
            hashed_id: id,
            duration: 12.5,
            status: 'done',
            browserstack_status: 'done',
            created_at: '2026-10-28 03:28:27 UTC',
            public_url: 'https://example.test/?auth_token=secret',
            reason: 'secret-user secret-key',
          },
        }
      : {
          parallel_sessions_max_allowed: 5,
          parallel_sessions_running: 0,
          queued_sessions: 0,
          automate_plan: 'secret-user',
          remaining_minutes: 999,
        },
  );
}
// Exercise a bounded timestamp with an explicit UTC offset as well as ISO dates.
function valid(url: string | URL | Request) {
  const id = String(url).match(/sessions\/([a-f0-9]+)\.json$/)?.[1];
  return id
    ? Response.json({
        automation_session: {
          hashed_id: id,
          duration: 12.5,
          status: 'done',
          browserstack_status: 'done',
          created_at: '2026-10-28 03:28:27 +0000',
          public_url: 'secret-key',
        },
      })
    : success(url);
}
const dedicatedDevice = (extra: Record<string, unknown> = {}) => ({
  os: 'android',
  os_version: 'secret-os-version',
  device: 'secret-device-name',
  realMobile: true,
  state: 'available',
  udid: 'secret-udid',
  sim_details: [{ phone_number: 'secret-phone-number', carrier: 'secret-carrier' }],
  in_use_by: 'secret-email@example.test',
  ...extra,
});

test('optional dedicated-device inventory keeps only counts without changing quota completeness', async () => {
  const urls: string[] = [];
  const report = await collectQuotaEvidence({
    ...credentials,
    includeDedicatedDevices: true,
    fetcher: async (url, init) => {
      urls.push(String(url));
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      assert.equal(init?.redirect, 'error');
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        `Basic ${Buffer.from('secret-user:secret-key').toString('base64')}`,
      );
      if (String(url) === 'https://api-cloud.browserstack.com/automate/dedicated_devices')
        return Response.json([
          dedicatedDevice(),
          dedicatedDevice({ os: 'ios' }),
          dedicatedDevice({ state: 'in use' }),
          dedicatedDevice({ realMobile: false }),
        ]);
      assert.equal(new URL(String(url)).host, 'api.browserstack.com');
      return valid(url);
    },
  });
  assert.deepEqual(report.dedicatedDevices, {
    outcome: 'available',
    data: {
      returnedEntries: 4,
      availableRealAndroidEntries: 1,
      availableRealIosEntries: 1,
      otherEntries: 2,
    },
  });
  assert.equal(urls.at(-1), 'https://api-cloud.browserstack.com/automate/dedicated_devices');
  assert.equal(urls.length, 9);
  assert.equal(report.requests, 9);
  assert.equal(report.status, 'passed');
  assert.equal(report.allocationAllowed, false);
  assert.equal(report.remainingMinutes, null);
  assert.doesNotMatch(
    JSON.stringify(report),
    /secret|udid|sim_details|in_use_by|phone_number|device-name/,
  );
});

test('dedicated-device inventory accepts a documented singleton or list and rejects unknown shapes as unknown', async () => {
  const cases = [
    { value: dedicatedDevice(), count: 1 },
    { value: [], count: 0 },
    ...[
      null,
      {},
      { devices: [dedicatedDevice()] },
      'secret-body',
      [null],
      dedicatedDevice({ realMobile: 'true' }),
      dedicatedDevice({ os: 'linux' }),
      dedicatedDevice({ state: 'secret-state' }),
    ].map((value) => ({ value, count: null })),
  ];
  for (const { value, count } of cases) {
    let inventoryCalls = 0;
    const report = await collectQuotaEvidence({
      ...credentials,
      includeDedicatedDevices: true,
      fetcher: async (url) => {
        if (String(url) !== 'https://api-cloud.browserstack.com/automate/dedicated_devices')
          return valid(url);
        inventoryCalls++;
        return Response.json(value);
      },
    });
    assert.equal(inventoryCalls, 1);
    assert.deepEqual(
      report.dedicatedDevices,
      count === null
        ? { outcome: 'unavailable', reason: 'invalid-response' }
        : {
            outcome: 'available',
            data: {
              returnedEntries: count,
              availableRealAndroidEntries: count,
              availableRealIosEntries: 0,
              otherEntries: 0,
            },
          },
    );
    assert.equal(report.status, 'passed');
    assert.equal(report.allocationAllowed, false);
    assert.doesNotMatch(JSON.stringify(report), /secret/);
  }
});

test('dedicated-device denial, redirects, malformed bodies and byte limits remain independent sanitized observations', async () => {
  const cases: [string, () => Response][] = [
    ...[401, 403, 404, 500].map((status): [string, () => Response] => [
      `http-${status}`,
      () => new Response('secret-remote-error', { status }),
    ]),
    [
      'http-302',
      () =>
        new Response('secret-redirect', {
          status: 302,
          headers: { location: 'https://secret-destination.test/' },
        }),
    ],
    ['invalid-response', () => new Response('secret-invalid-json')],
    [
      'response-too-large',
      () =>
        new Response('secret-body', {
          headers: { 'content-length': String(quotaLimits.bytes + 1) },
        }),
    ],
    ['response-too-large', () => new Response('s'.repeat(quotaLimits.bytes + 1))],
  ];
  for (const [reason, response] of cases) {
    const urls: string[] = [];
    const report = await collectQuotaEvidence({
      ...credentials,
      includeDedicatedDevices: true,
      fetcher: async (url, init) => {
        urls.push(String(url));
        assert.equal(init?.redirect, 'error');
        if (String(url) === 'https://api-cloud.browserstack.com/automate/dedicated_devices')
          return response();
        assert.equal(new URL(String(url)).host, 'api.browserstack.com');
        return valid(url);
      },
    });
    assert.equal(urls.length, 9, reason);
    assert.deepEqual(report.dedicatedDevices, { outcome: 'unavailable', reason });
    assert.equal(report.status, 'passed');
    assert.equal(report.history.deadlineExceeded, false);
    assert.equal(report.allocationAllowed, false);
    assert.doesNotMatch(JSON.stringify(report), /secret/);
  }
});

test('dedicated-device work cannot exceed shared deadlines or change already-complete accounting', async () => {
  for (const advance of [quotaLimits.requestMs, quotaLimits.totalMs]) {
    let clock = 0;
    let calls = 0;
    const report = await collectQuotaEvidence({
      ...credentials,
      includeDedicatedDevices: true,
      now: () => clock,
      fetcher: async (url) => {
        calls++;
        if (String(url) === 'https://api-cloud.browserstack.com/automate/dedicated_devices') {
          clock = advance;
          return Response.json(dedicatedDevice());
        }
        return valid(url);
      },
    });
    assert.equal(calls, 9);
    assert.deepEqual(report.dedicatedDevices, {
      outcome: 'unavailable',
      reason: advance === quotaLimits.totalMs ? 'deadline-exceeded' : 'request-timeout',
    });
    assert.equal(report.status, 'passed');
    assert.equal(report.history.deadlineExceeded, false);
  }
});

test('fixed provenance GETs plus an empty retained build list; IDs match immutable smoke reports', async () => {
  const ids: string[] = [];
  for (const name of ['first', 'verified']) {
    const evidence = JSON.parse(
      await readFile(
        new URL(`../../docs/implementation/SPN-090-browserstack-${name}.json`, import.meta.url),
        'utf8',
      ),
    );
    ids.push(...evidence.smoke.sessions.map((session: { sessionId: string }) => session.sessionId));
  }
  assert.deepEqual([...retainedSessionIds], ids);
  const urls: string[] = [];
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url, init) => {
      urls.push(String(url));
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      assert.equal(init?.redirect, 'error');
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        `Basic ${Buffer.from('secret-user:secret-key').toString('base64')}`,
      );
      return valid(url);
    },
  });
  assert.deepEqual(
    urls,
    ['plan.json', ...ids.map((id) => `sessions/${id}.json`), 'builds.json?limit=10&offset=0'].map(
      (path) => `https://api.browserstack.com/automate/${path}`,
    ),
  );
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.dedicatedDevices, { outcome: 'not-requested' });
  assert.equal(result.remainingMinutes, null);
  assert.equal(result.allocationAllowed, false);
  assert.equal(result.accountWideHistory, 'unknown');
  assert.doesNotMatch(JSON.stringify(result), /secret|auth_token|remaining_minutes|999/);
});

test('every failure is retained without retries, including expired/denied records and remote exceptions', async () => {
  let calls = 0;
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async () => {
      const index = calls++;
      if (index === 0) throw new Error('secret-key');
      if (index === 1) return new Response('secret-key', { status: 404 });
      if (index === 2) return new Response('secret-user', { status: 403 });
      if (index === 3) return Response.json({ automation_session: { hashed_id: 'wrong' } });
      return new Response('secret-key invalid JSON');
    },
  });
  assert.equal(calls, 8);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.plan, { outcome: 'unavailable', reason: 'request-failed' });
  assert.deepEqual(
    result.sessions.map((entry) => entry.evidence),
    [
      { outcome: 'unavailable', reason: 'http-404' },
      { outcome: 'unavailable', reason: 'http-403' },
      { outcome: 'unavailable', reason: 'session-identity-mismatch' },
      ...Array.from({ length: 3 }, () => ({ outcome: 'unavailable', reason: 'invalid-response' })),
    ],
  );
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('missing, negative, nonnumeric and unfinished durations never become zero or spending authority', async () => {
  const durations = [undefined, -1, '20', null, 0, 20];
  let index = 0;
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      if (String(url).endsWith('plan.json') || String(url).includes('?limit=')) return valid(url);
      const i = index++;
      return Response.json({
        automation_session: {
          hashed_id: retainedSessionIds[i],
          duration: durations[i],
          status: i === 5 ? 'running' : 'done',
          created_at: '2026-10-28T03:28:27Z',
        },
      });
    },
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(
    result.sessions.map((entry) =>
      entry.evidence.outcome === 'available' ? entry.evidence.data.durationSeconds : undefined,
    ),
    [null, null, null, null, 0, 20],
  );
  assert.equal(result.allocationAllowed, false);
});

test('declared and streamed response sizes are bounded and cancelled without reading raw errors', async () => {
  let cancelled = 0;
  let calls = 0;
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      calls++;
      if (calls > 2) return valid(url);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(40_000));
            controller.enqueue(new Uint8Array(40_000));
          },
          cancel() {
            cancelled++;
          },
        }),
        calls === 1 ? { headers: { 'content-length': String(quotaLimits.bytes + 1) } } : undefined,
      );
    },
  });
  assert.deepEqual(result.plan, { outcome: 'unavailable', reason: 'response-too-large' });
  assert.deepEqual(result.sessions[0].evidence, {
    outcome: 'unavailable',
    reason: 'response-too-large',
  });
  assert.equal(cancelled, 2);
  assert.equal(calls, 8);
});

test('fragmented and empty chunks cannot expand retained buffering beyond the byte limit', async () => {
  let calls = 0;
  const report = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      if (++calls > 1) return valid(url);
      const bytes = new TextEncoder().encode(
        JSON.stringify({ parallel_sessions_max_allowed: 5, padding: 'x'.repeat(60_000) }),
      );
      let offset = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (offset >= bytes.length) {
              controller.close();
              return;
            }
            controller.enqueue(new Uint8Array(0));
            controller.enqueue(bytes.subarray(offset, ++offset));
          },
        }),
      );
    },
  });
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.plan, {
    outcome: 'available',
    data: { parallelSessionsAllowed: 5, runningSessions: null, queuedSessions: null },
  });
});

test('a stalled fetch is aborted at the per-request deadline and is never retried', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  let calls = 0;
  const pending = collectQuotaEvidence({
    ...credentials,
    fetcher: async (url, init) => {
      calls++;
      if (calls !== 1) return valid(url);
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    },
  });
  context.mock.timers.tick(quotaLimits.requestMs);
  const result = await pending;
  assert.equal(signal?.aborted, true);
  assert.deepEqual(result.plan, { outcome: 'unavailable', reason: 'request-timeout' });
  assert.equal(calls, 8);
});

test('overall deadline cancels a stalled body and records all unstarted observations', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let bodyStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    bodyStarted = resolve;
  });
  let cancelled = false;
  let calls = 0;
  const pending = collectQuotaEvidence({
    ...credentials,
    fetcher: async () => {
      calls++;
      return new Response(
        new ReadableStream(
          {
            pull() {
              bodyStarted();
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
      );
    },
  });
  await started;
  context.mock.timers.tick(quotaLimits.totalMs);
  const result = await pending;
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
  assert.equal(result.sessions.length, 6);
  for (const entry of result.sessions)
    assert.deepEqual(entry.evidence, { outcome: 'unavailable', reason: 'deadline-exceeded' });
});

test('synchronous work crossing either deadline is refused even before timer delivery', async () => {
  for (const advance of [quotaLimits.requestMs, quotaLimits.totalMs]) {
    let clock = 0;
    let calls = 0;
    const result = await collectQuotaEvidence({
      ...credentials,
      now: () => clock,
      fetcher: async (url) => {
        calls++;
        if (calls === 1) clock = advance;
        return valid(url);
      },
    });
    assert.deepEqual(result.plan, {
      outcome: 'unavailable',
      reason: advance === quotaLimits.totalMs ? 'deadline-exceeded' : 'request-timeout',
    });
    assert.equal(calls, advance === quotaLimits.totalMs ? 1 : 8);
  }
});

test('a response received at an expired boundary is cancelled before its body reader exists', async () => {
  let clock = 0;
  let cancelled = false;
  const report = await collectQuotaEvidence({
    ...credentials,
    now: () => clock,
    fetcher: async () => {
      clock = quotaLimits.totalMs;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      );
    },
  });
  assert.equal(cancelled, true);
  assert.deepEqual(report.plan, { outcome: 'unavailable', reason: 'deadline-exceeded' });
});

test('quota CLI with missing credentials retains a failing report without opening a listener or provider connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-quota-'));
  try {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./browserstack.ts', import.meta.url)), 'quota'],
      {
        cwd: directory,
        env: { ...process.env, BS_USERNAME: '', BS_ACCESS_KEY: '' },
        timeout: 5000,
        encoding: 'utf8',
      },
    );
    assert.equal(child.status, 1, child.stderr);
    const report = JSON.parse(
      await readFile(join(directory, 'artifacts/browserstack-quota.json'), 'utf8'),
    );
    assert.equal(report.mode, 'quota');
    assert.equal(report.sessions.length, 6);
    assert.deepEqual(report.plan, { outcome: 'unavailable', reason: 'missing-credentials' });
    assert.equal(report.allocationAllowed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('monthly Safari acceptance, quota reports, every phone scope, and read-only diagnostics preserve their boundaries', async () => {
  const source = await readFile(
    new URL('../../.github/workflows/browserstack.yml', import.meta.url),
    'utf8',
  );
  assert.match(source, /default: quota/);
  const modes = source.match(/options:\s*\[([^\]]+)\]/)?.[1];
  assert.ok(modes, 'manual choices remain explicit');
  assert.deepEqual(
    modes
      .trim()
      .replace(/,$/, '')
      .split(',')
      .map((value) => value.trim()),
    [
      'quota',
      'capability',
      'chrome-diagnostic',
      'safari-acceptance',
      'chrome-acceptance',
      'chrome-tab-acceptance',
      'firefox-tab-acceptance',
      'safari-tab-acceptance',
      'diagnostics',
    ],
  );
  assert.match(
    source,
    /session_id:\n        description:.*\n        type: string\n        required: false/,
  );
  assert.match(source, /cron: '17 9 1 \* \*'/);
  assert.match(source, /pull_request:\n    branches: \[main\]\n    types: \[labeled\]/);
  // The group is a folded scalar: its lines join with single spaces.
  const folded = /^  group: >-\n((?:    .+\n)+)/m.exec(source)?.[1] ?? '';
  const group =
    /^\$\{\{ (.+) \}\}$/.exec(
      folded
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' '),
    )?.[1] ?? '';
  assert.match(group, /'browserstack-lifetime-account'$/);
  const runNameFolded = /^run-name: >-\n((?:  .+\n)+)/m.exec(source)?.[1] ?? '';
  const runName =
    /^\$\{\{ (.+) \}\}$/.exec(
      runNameFolded
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' '),
    )?.[1] ?? '';
  assert.notEqual(runName, '', 'the run title is one folded expression');
  // The lock's label list is exactly the set of labels any job routes on, so a new
  // account label cannot be added to a job without also taking the lock.
  const lockLabels: string[] = JSON.parse(/fromJSON\('(\[[^']+\])'\)/.exec(group)?.[1] ?? '[]');
  // Read from the jobs only, so the group's own clauses cannot satisfy the check.
  const jobsSource = source.slice(source.indexOf('\njobs:\n'));
  const routedLabels = [
    ...[...jobsSource.matchAll(/github\.event\.label\.name == '([^']+)'/g)].map(
      (match) => match[1],
    ),
    ...[...jobsSource.matchAll(/fromJSON\('(\[[^']+\])'\), github\.event\.label\.name\)/g)].flatMap(
      (match) => JSON.parse(match[1]) as string[],
    ),
  ];
  assert.deepEqual([...new Set(lockLabels)].sort(), [...new Set(routedLabels)].sort());
  assert.match(source, /cancel-in-progress: false/);
  const diagnostics = source.split('  diagnostics:\n')[1].split('  accounting:\n')[0];
  assert.match(
    diagnostics,
    /github.event_name == 'workflow_dispatch' && inputs.mode == 'diagnostics'/,
  );
  assert.match(diagnostics, /github.event.action == 'labeled'/);
  assert.match(diagnostics, /github.event.label.name == 'ci-browserstack-logs'/);
  assert.match(diagnostics, /github.event.pull_request.head.repo.full_name == github.repository/);
  assert.match(diagnostics, /permissions:\n      contents: read/);
  assert.match(diagnostics, /persist-credentials: false/);
  assert.match(diagnostics, /package-manager-cache: false/);
  assert.match(
    diagnostics,
    /SOURCE_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/,
  );
  assert.match(
    diagnostics,
    /BS_DIAGNOSTIC_SESSION: \$\{\{ inputs.session_id \|\| 'dc1a30f87ce096c3e7ae42bae0fd3349bc24d9ad' \}\}/,
  );
  assert.deepEqual(
    [...diagnostics.matchAll(/\buses: ([^@\s]+)@/g)].map((match) => match[1]),
    ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact'],
  );
  assert.deepEqual(
    [...diagnostics.matchAll(/^\s+run: (.+)$/gm)].map((match) => match[1]),
    ['node scripts/ci/browserstack-session-diagnostics.ts'],
  );
  assert.match(diagnostics, /if: always\(\)/);
  assert.match(diagnostics, /path: artifacts\/browserstack-session-diagnostics.json\n/);
  assert.match(diagnostics, /if-no-files-found: error/);
  assert.doesNotMatch(
    diagnostics,
    /contents: write|GITHUB_TOKEN|needs:|continue-on-error:|setup-local|setup-env|npm ci|npm run build|browserstack-(?:accounting|capability)\.ts|ledger\.json/,
  );
  const quota = source.split('  accounting:\n')[1].split('  capability:\n')[0];
  // Accounting may list runs read-only; no job may write Actions state.
  assert.match(quota, /permissions:\n      # [^\n]+\n      actions: read\n      contents: write\n/);
  assert.doesNotMatch(source, /actions: write/);
  assert.match(quota, /github.event_name == 'schedule'/);
  assert.match(quota, /github.event_name == 'workflow_dispatch' && inputs.mode != 'diagnostics'/);
  // Admission routes on every account label, i.e. the lock's list without diagnostics.
  assert.deepEqual(
    JSON.parse(
      /contains\(fromJSON\('(\[[^']+\])'\), github\.event\.label\.name\)/.exec(quota)?.[1] ?? '[]',
    ),
    lockLabels.filter((label) => label !== 'ci-browserstack-logs'),
  );
  assert.match(quota, /github.event.pull_request.head.repo.full_name == github.repository/);
  assert.match(quota, /run: node scripts\/ci\/browserstack-accounting.ts "\$BS_OPERATION"/);
  assert.match(quota, /inputs.mode == 'capability'/);
  assert.match(quota, /inputs.mode == 'chrome-diagnostic'/);
  assert.match(quota, /contains\(fromJSON\(env.BS_AUTHORED_SCOPES\), inputs.mode\)/);
  assert.match(quota, /run: test "\$ACCOUNTING_OUTCOME" = success/);
  assert.match(quota, /if: always\(\)/);
  assert.doesNotMatch(quota, /setup-local|setup-env|browserstack.ts (smoke|credentials)|needs:/);
  const capability = source.split('  capability:\n')[1].split('  reconciliation:\n')[0];
  assert.match(capability, /needs: accounting/);
  assert.match(capability, /needs.accounting.result == 'success'/);
  assert.match(capability, /needs.accounting.outputs.allocation_allowed == 'true'/);
  const gates = [
    'browserstack-capability.ts prepare',
    'run: npm ci',
    'run: npm run typecheck',
    'run: npm run build',
    'browserstack/github-actions/setup-env@',
    'browserstack/github-actions/setup-local@',
    'browserstack-capability.ts run',
  ].map((command) => capability.indexOf(command));
  assert.ok(
    gates.every((position) => position >= 0),
    'every preallocation gate is present',
  );
  assert.ok(
    gates.every((position, index) => index === 0 || position > gates[index - 1]),
    'a verified receipt, dependencies, typecheck and build precede Local/device execution',
  );
  assert.doesNotMatch(capability, /continue-on-error:/);
  assert.equal([...source.matchAll(/BS_CAPABILITY_SCOPE:/g)].length, 1);
  const scope = capability.match(/^      BS_CAPABILITY_SCOPE: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(scope, 'one job-level scope applies to both prepare and run');
  assert.deepEqual(
    [...capability.matchAll(/^\s+run: (.*browserstack-capability\.ts.*)$/gm)].map(
      (match) => match[1],
    ),
    [
      'node scripts/ci/browserstack-capability.ts prepare',
      'node scripts/ci/browserstack-capability.ts run',
    ],
    'prepare and run inherit the same scope without a command-level override',
  );
  assert.equal([...source.matchAll(/VITE_SYNC_EVIDENCE:/g)].length, 1);
  const build = capability.match(
    /^      - name: Build the production application\n([\s\S]*?)(?=^      - )/m,
  )?.[1];
  assert.ok(build, 'the observation flag belongs only to the application build');
  const evidence = build.match(/^          VITE_SYNC_EVIDENCE: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(evidence, 'the evidence build flag is conditional on the admitted scope');
  const observation = capability.match(
    /^      - name: Observe the selected bounded physical-phone scope\n([\s\S]*?)(?=^      - )/m,
  )?.[1];
  assert.ok(observation, 'the selected scope has one bounded observation step');
  const observationTimeout = observation.match(/^        timeout-minutes: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(
    observationTimeout,
    'the observation wrapper must fit the selected authored bound and cleanup',
  );
  const stopLocal = capability.match(
    /^      - name: Stop Local tunnel\n([\s\S]*?)(?=^      - )/m,
  )?.[1];
  assert.ok(stopLocal);
  assert.match(stopLocal, /uses: browserstack\/github-actions\/setup-local@/);
  assert.match(stopLocal, /local-testing: stop/);
  const cleanup = stopLocal.match(/^        if: (.+)$/m)?.[1];
  assert.ok(cleanup, 'every admitted scope retains Local cleanup after an attempted start');
  const reconciliation = source.split('  reconciliation:\n')[1];
  assert.match(reconciliation, /needs: \[accounting, capability\]/);
  assert.match(
    reconciliation,
    /if: always\(\) && needs.accounting.outputs.allocation_allowed == 'true'/,
  );
  assert.match(reconciliation, /run: node scripts\/ci\/browserstack-accounting.ts reconcile/);

  // These predicates use lowercase string equality and boolean operators shared with JS.
  // Read-only diagnostics cannot reach admission; all phone scopes share every gate.
  // The shared reserve command's 900-second contract is owned by the accounting tests.
  const condition = (block: string) => {
    const match = block.match(/^    if: (?:>-\n)?([\s\S]*?)\n    runs-on:/m);
    assert.ok(match);
    return match[1];
  };
  const conditions = Object.fromEntries(
    Object.entries({ diagnostics, accounting: quota, capability, reconciliation }).map(
      ([name, block]) => [name, condition(block)],
    ),
  );
  const operation = quota.match(/BS_OPERATION: \$\{\{ (.+) \}\}/)?.[1];
  assert.ok(operation);
  const routes: {
    event: string;
    mode?: string;
    action?: string;
    label?: string;
    fork?: boolean;
    allocationAllowed?: boolean;
    operation?: 'quota' | 'reserve';
    jobs: string[];
    scope?: CapabilityScope;
  }[] = [
    {
      event: 'schedule',
      operation: 'reserve',
      jobs: ['accounting', 'capability', 'reconciliation'],
      scope: 'safari-acceptance',
    },
    {
      event: 'schedule',
      allocationAllowed: false,
      operation: 'reserve',
      jobs: ['accounting'],
    },
    { event: 'workflow_dispatch', operation: 'quota', jobs: ['accounting'] },
    { event: 'workflow_dispatch', mode: 'quota', operation: 'quota', jobs: ['accounting'] },
    { event: 'workflow_dispatch', mode: 'diagnostics', jobs: ['diagnostics'] },
    {
      event: 'workflow_dispatch',
      mode: 'capability',
      jobs: ['accounting', 'capability', 'reconciliation'],
      scope: 'all',
    },
    {
      event: 'workflow_dispatch',
      mode: 'chrome-diagnostic',
      jobs: ['accounting', 'capability', 'reconciliation'],
      scope: 'chrome-navigation-diagnostic',
    },
    {
      event: 'workflow_dispatch',
      mode: 'safari-acceptance',
      jobs: ['accounting', 'capability', 'reconciliation'],
      scope: 'safari-acceptance',
    },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-real-devices',
      jobs: ['accounting', 'capability', 'reconciliation'],
      scope: 'all',
    },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-real-devices-chrome',
      jobs: ['accounting', 'capability', 'reconciliation'],
      scope: 'chrome-navigation-diagnostic',
    },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-real-devices-safari',
      jobs: ['accounting', 'capability', 'reconciliation'],
      scope: 'safari-acceptance',
    },
    // Label names compare case-insensitively on GitHub, in == chains and contains() alike.
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'CI-Real-Devices-Safari',
      jobs: ['accounting', 'capability', 'reconciliation'],
      scope: 'safari-acceptance',
    },
    {
      event: 'workflow_dispatch',
      mode: 'safari-acceptance',
      allocationAllowed: false,
      jobs: ['accounting'],
    },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-real-devices-safari',
      allocationAllowed: false,
      jobs: ['accounting'],
    },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-browserstack-logs',
      jobs: ['diagnostics'],
    },
    { event: 'pull_request', action: 'labeled', label: 'ci-browserstack-logs-extra', jobs: [] },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-browserstack-logs',
      fork: true,
      jobs: [],
    },
    { event: 'pull_request', action: 'labeled', label: 'ci-real-devices', fork: true, jobs: [] },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-real-devices-chrome',
      fork: true,
      jobs: [],
    },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-real-devices-safari',
      fork: true,
      jobs: [],
    },
    { event: 'pull_request', action: 'labeled', label: 'ci-real-devices-chrome-extra', jobs: [] },
    { event: 'pull_request', action: 'labeled', label: 'ci-real-devices-chrom', jobs: [] },
    { event: 'pull_request', action: 'labeled', label: 'ci-real-devices-safari-extra', jobs: [] },
    { event: 'pull_request', action: 'labeled', label: 'ci-real-devices-safar', jobs: [] },
    { event: 'pull_request', action: 'unlabeled', label: 'ci-browserstack-logs', jobs: [] },
    { event: 'pull_request', action: 'unlabeled', label: 'ci-real-devices-chrome', jobs: [] },
    { event: 'pull_request', action: 'unlabeled', label: 'ci-real-devices-safari', jobs: [] },
    { event: 'pull_request', action: 'synchronize', label: 'ci-real-devices', jobs: [] },
    { event: 'pull_request', action: 'synchronize', label: 'ci-real-devices-chrome', jobs: [] },
    { event: 'pull_request', action: 'synchronize', label: 'ci-real-devices-safari', jobs: [] },
    { event: 'push', jobs: [] },
  ];
  // Each authored route selects one device; exact event/label boundaries prevent
  // an added mode from expanding a reservation into a multi-device acceptance run.
  for (const [mode, label] of [
    ['chrome-acceptance', 'ci-real-devices-chrome-acceptance'],
    ['chrome-tab-acceptance', 'ci-real-devices-chrome-tab'],
    ['firefox-tab-acceptance', 'ci-real-devices-firefox-tab'],
    ['safari-tab-acceptance', 'ci-real-devices-safari-tab'],
  ] as const) {
    routes.push(
      {
        event: 'workflow_dispatch',
        mode,
        operation: 'reserve',
        jobs: ['accounting', 'capability', 'reconciliation'],
        scope: mode,
      },
      {
        event: 'workflow_dispatch',
        mode,
        allocationAllowed: false,
        operation: 'reserve',
        jobs: ['accounting'],
      },
      {
        event: 'pull_request',
        action: 'labeled',
        label,
        operation: 'reserve',
        jobs: ['accounting', 'capability', 'reconciliation'],
        scope: mode,
      },
      {
        event: 'pull_request',
        action: 'labeled',
        label,
        allocationAllowed: false,
        operation: 'reserve',
        jobs: ['accounting'],
      },
      { event: 'pull_request', action: 'labeled', label, fork: true, jobs: [] },
      { event: 'pull_request', action: 'labeled', label: `${label}-extra`, jobs: [] },
      { event: 'pull_request', action: 'unlabeled', label, jobs: [] },
      { event: 'pull_request', action: 'synchronize', label, jobs: [] },
    );
  }
  const authoredScopes: string = source.match(/^  BS_AUTHORED_SCOPES: '(.+)'$/m)?.[1] ?? '';
  assert.notEqual(authoredScopes, '', 'one workflow-level list owns the authored scopes');
  for (const route of routes) {
    const context = {
      github: {
        event_name: route.event,
        repository: 'mxbaylee/spinel',
        run_id: 77,
        event: {
          action: route.action ?? '',
          label: { name: route.label ?? '' },
          pull_request: {
            title: 'Some PR',
            head: { repo: { full_name: route.fork ? 'someone/fork' : 'mxbaylee/spinel' } },
          },
        },
      },
      inputs: { mode: route.mode ?? '' },
      env: { BS_AUTHORED_SCOPES: authoredScopes, BS_CAPABILITY_SCOPE: '' },
      needs: { accounting: { result: 'skipped', outputs: { allocation_allowed: '' } } },
      always: () => true,
      // GitHub's array contains() compares strings case-insensitively.
      fromJSON: (value: string) => JSON.parse(value) as unknown,
      contains: (list: string[], item: string) =>
        list.some((entry) => entry.toLowerCase() === item.toLowerCase()),
      equal: (left: unknown, right: string, operator: '==' | '!=') =>
        (typeof left === 'string' ? left.toLowerCase() === right.toLowerCase() : left === right) ===
        (operator === '=='),
      format: (template: string, ...values: unknown[]) =>
        template.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)])),
    };
    // GitHub's == and != also ignore case for strings, so literal comparisons go
    // through a helper instead of JS equality.
    const evaluate = (expression: string) =>
      runInNewContext(
        expression.replace(/([\w.]+) (==|!=) ('[^']*')/g, "equal($1, $3, '$2')"),
        context,
        { timeout: 1000 },
      );
    // The title tells the dispatch check which mode or label a pending run has.
    assert.equal(
      evaluate(runName),
      route.event === 'workflow_dispatch'
        ? `BrowserStack ${route.mode ?? ''}`
        : route.event === 'schedule'
          ? 'BrowserStack monthly safari-acceptance'
          : `BrowserStack ${route.label ?? ''}: Some PR`,
      `run title: ${JSON.stringify(route)}`,
    );
    // Any route that runs a job holds the account lock; only no-op labels leave it.
    const lockGroup = evaluate(group);
    const selected = ['diagnostics', 'accounting'].filter((name) => evaluate(conditions[name]));
    if (selected.includes('accounting')) {
      const selectedOperation = evaluate(operation);
      if (route.operation)
        assert.equal(
          selectedOperation,
          route.operation,
          `accounting operation: ${JSON.stringify(route)}`,
        );
      context.needs.accounting.result = 'success';
      context.needs.accounting.outputs.allocation_allowed =
        selectedOperation === 'reserve' && route.allocationAllowed !== false ? 'true' : 'false';
    }
    selected.push(...['capability', 'reconciliation'].filter((name) => evaluate(conditions[name])));
    assert.deepEqual(selected, route.jobs, JSON.stringify(route));
    // A fork PR or a label no job routes on is a no-op (contains() ignores case).
    const noopLabel =
      route.event === 'pull_request' &&
      (!!route.fork ||
        !routedLabels.some((label) => label.toLowerCase() === (route.label ?? '').toLowerCase()));
    if (noopLabel)
      assert.deepEqual(selected, [], `no-op label ran a job: ${JSON.stringify(route)}`);
    // Diagnostics only read a completed session; they never share a run with account jobs.
    const diagnosticsOnly =
      !noopLabel && (route.mode === 'diagnostics' || route.label === 'ci-browserstack-logs');
    if (diagnosticsOnly)
      assert.ok(
        selected.every((name) => name === 'diagnostics'),
        `diagnostics group ran an account job: ${JSON.stringify(route)}`,
      );
    assert.equal(
      lockGroup,
      noopLabel
        ? 'browserstack-noop-77'
        : diagnosticsOnly
          ? 'browserstack-diagnostics'
          : 'browserstack-lifetime-account',
      `concurrency group: ${JSON.stringify(route)}`,
    );
    const selectedScope: string | null = selected.includes('capability') ? evaluate(scope) : null;
    assert.equal(selectedScope, route.scope ?? null, `capability scope: ${JSON.stringify(route)}`);
    context.env.BS_CAPABILITY_SCOPE = selectedScope ?? '';
    const authored =
      route.scope !== undefined &&
      [
        'safari-acceptance',
        'chrome-acceptance',
        'chrome-tab-acceptance',
        'firefox-tab-acceptance',
        'safari-tab-acceptance',
      ].includes(route.scope);
    assert.equal(
      selectedScope ? evaluate(evidence) : null,
      route.scope ? (authored ? '1' : '0') : null,
      `build observation flag: ${JSON.stringify(route)}`,
    );
    assert.equal(
      selectedScope ? evaluate(observationTimeout) : null,
      route.scope ? (authored ? 18 : 14) : null,
      `observation wrapper preserves scope and cleanup budget: ${JSON.stringify(route)}`,
    );
  }
  for (const outcome of ['success', 'failure', 'cancelled', 'skipped', '']) {
    assert.equal(
      runInNewContext(
        cleanup,
        { always: () => true, steps: { tunnel: { outcome } } },
        { timeout: 1000 },
      ),
      ['success', 'failure', 'cancelled'].includes(outcome),
      `shared tunnel cleanup: ${outcome}`,
    );
  }
  for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
    for (const allowed of ['true', 'false', '']) {
      const context = {
        needs: { accounting: { result, outputs: { allocation_allowed: allowed } } },
        always: () => true,
      };
      assert.equal(
        runInNewContext(conditions.capability, context, { timeout: 1000 }),
        result === 'success' && allowed === 'true',
        `allocation requires successful admission: ${result}/${allowed}`,
      );
      assert.equal(
        runInNewContext(conditions.reconciliation, context, { timeout: 1000 }),
        allowed === 'true',
        `every retained reservation reconciles: ${result}/${allowed}`,
      );
    }
  }
});

test('direct legacy smoke CLI refuses unreserved allocation before any provider call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-smoke-guard-'));
  try {
    const guard = join(directory, 'network-guard.ts');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      guard,
      "globalThis.fetch = async () => { console.log('NETWORK_ATTEMPT'); throw new Error('mock-network'); };\n",
    );
    const child = spawnSync(
      process.execPath,
      ['--import', guard, fileURLToPath(new URL('./browserstack.ts', import.meta.url)), 'smoke'],
      {
        cwd: directory,
        timeout: 5000,
        encoding: 'utf8',
        env: { ...process.env, BS_USERNAME: 'unit-user', BS_ACCESS_KEY: 'unit-key' },
      },
    );
    assert.equal(child.status, 1, child.stderr);
    assert.doesNotMatch(child.stdout, /NETWORK_ATTEMPT|unit-user|unit-key/);
    const report = JSON.parse(
      await readFile(join(directory, 'artifacts/browserstack-smoke.json'), 'utf8'),
    );
    assert.equal(report.failure, 'quota-admission-unavailable');
    assert.equal(report.status, 'failed');
    assert.equal(report.authentication, 'not-verified');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const observedId = (value: number) => value.toString(16).padStart(40, '0');
const buildRow = (id: string) => ({
  automation_build: {
    hashed_id: id,
    status: 'done',
    name: 'secret-name',
    public_url: 'secret-url',
  },
});
const sessionRow = (id: string, extra: Record<string, unknown> = {}) => ({
  automation_session: {
    hashed_id: id,
    duration: 12.5,
    status: 'done',
    browserstack_status: 'done',
    created_at: '2026-10-28T03:28:27Z',
    name: 'secret-name',
    logs: 'secret-url',
    ...extra,
  },
});

test('pages retained builds and sessions, reuses known details and never infers lifetime completeness', async () => {
  const urls: string[] = [];
  const builds = Array.from({ length: 11 }, (_, index) => observedId(index + 1));
  const ids = [
    ...retainedSessionIds,
    ...Array.from({ length: 5 }, (_, index) => observedId(index + 100)),
  ];
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      const location = new URL(String(url));
      urls.push(location.pathname + location.search);
      const offset = Number(location.searchParams.get('offset'));
      if (location.pathname === '/automate/builds.json')
        return Response.json(builds.slice(offset, offset + 10).map(buildRow));
      if (location.pathname === `/automate/builds/${builds[0]}/sessions.json`)
        return Response.json(ids.slice(offset, offset + 10).map((id) => sessionRow(id)));
      if (location.search) return Response.json([]);
      return valid(url);
    },
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.history.buildPagination.pages, 2);
  assert.equal(result.history.builds.length, 11);
  assert.equal(result.history.builds[0].pagination.pages, 2);
  assert.deepEqual(result.history.builds[0].sessionIds, ids);
  assert.equal(result.history.sessions.length, 11);
  for (const id of retainedSessionIds)
    assert.equal(urls.filter((url) => url === `/automate/sessions/${id}.json`).length, 1);
  assert.equal(urls.filter((url) => url.startsWith('/automate/sessions/')).length, 6);
  assert.equal(result.history.snapshot, 'non-atomic');
  assert.equal(result.accountWideHistory, 'unknown');
  assert.equal(result.expiredOrDeletedHistory, 'unknown');
  assert.equal(result.remainingMinutes, null);
  assert.equal(result.allocationAllowed, false);
  assert.doesNotMatch(JSON.stringify(result), /secret|public_url|logs|name/);
});

test('a repeated full page is partial without looping or duplicating observations', async () => {
  const ids = [
    ...retainedSessionIds,
    ...Array.from({ length: 4 }, (_, index) => observedId(index + 100)),
  ];
  let listCalls = 0;
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      const path = String(url);
      if (path.includes('/builds.json?')) return Response.json([buildRow(observedId(1))]);
      if (path.includes('/sessions.json?')) {
        listCalls++;
        return Response.json(ids.map((id) => sessionRow(id)));
      }
      return valid(url);
    },
  });
  assert.equal(listCalls, 2);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.history.builds[0].pagination, {
    pages: 2,
    outcome: 'partial',
    reason: 'pagination-no-progress',
  });
  assert.equal(result.history.sessions.length, 10);
  assert.equal(result.history.sessions[0].observations.length, 2);
  assert.equal(result.history.sessions[9].observations.length, 1);
});

test('the same session in multiple builds is deduplicated and conflicting measurements are retained', async () => {
  const id = observedId(100),
    builds = [observedId(1), observedId(2)];
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      const path = String(url);
      if (path.includes('/builds.json?')) return Response.json(builds.map(buildRow));
      if (path.includes('/sessions.json?'))
        return Response.json([
          sessionRow(id, {
            duration: path.includes(builds[0]) ? 10 : 20,
          }),
        ]);
      return valid(url);
    },
  });
  const entry = result.history.sessions.find((entry) => entry.sessionId === id)!;
  assert.equal(result.status, 'failed');
  assert.equal(result.history.sessions.length, 7);
  assert.deepEqual(entry.buildIds, builds);
  assert.equal(entry.conflict, true);
  assert.deepEqual(
    entry.observations.map(({ evidence }) =>
      evidence.outcome === 'available' ? evidence.data.durationSeconds : null,
    ),
    [10, 20],
  );
});

test('completion between list and detail reads remains measurable in the durable ledger after a clean collection', async () => {
  const id = observedId(100);
  let calls = 0;
  const collect = (inFlight: boolean) =>
    collectQuotaEvidence({
      ...credentials,
      fetcher: async (url, init) => {
        calls++;
        assert.equal(init?.method, 'GET');
        const path = String(url);
        if (path.includes('/builds.json?')) return Response.json([buildRow(observedId(1))]);
        if (path.includes('/sessions.json?'))
          return Response.json([
            sessionRow(id, {
              duration: inFlight ? 3 : 19,
              status: inFlight ? 'running' : 'done',
              browserstack_status: inFlight ? 'running' : 'done',
            }),
          ]);
        if (path.endsWith(`sessions/${id}.json`))
          return Response.json(sessionRow(id, { duration: 19 }));
        return valid(url);
      },
    });
  const first = await collect(true);
  assert.equal(first.history.sessions.at(-1)?.conflict, false);
  assert.equal(first.history.sessions.at(-1)?.observations.length, 2);
  const source = {
    sourceSha: 'a'.repeat(40),
    testedSha: 'b'.repeat(40),
    run: 'https://github.com/mxbaylee/spinel/actions/runs/1',
  };
  const initial = createBudgetReport({
    ...source,
    evidence: first,
    previousLedger: null,
    observedAt: '2026-11-01T00:00:00.000Z',
  });
  const second = await collect(false);
  assert.equal(second.status, 'passed');
  const result = createBudgetReport({
    ...source,
    evidence: second,
    previousLedger: initial.ledger,
    observedAt: '2026-11-01T01:00:00.000Z',
  });
  assert.equal(calls, 19);
  assert.equal(result.report.measuredTerminalSessions, 7);
  assert.equal(result.report.measuredTerminalSessionSeconds, 94);
  assert.equal(result.report.conflictingSessions, 0);
  assert.equal(result.report.unresolvedSessions, 0);
  assert.equal(result.report.allocationAllowed, false);
  const saved = result.ledger?.sessions.find((entry) => entry.sessionId === id);
  assert.equal(saved?.collectorConflict, false);
  assert.deepEqual(
    saved?.measurements.map((value) => value.durationSeconds),
    [3, 19],
  );
});

test('mutable test status is compatible, but creation identity and regressing final durations conflict', async () => {
  for (const change of [
    { status: 'passed' },
    { created_at: '2026-10-28T03:28:28Z' },
    { duration: 13, status: 'running', browserstack_status: 'running' },
  ]) {
    const result = await collectQuotaEvidence({
      ...credentials,
      fetcher: async (url) => {
        const path = String(url);
        if (path.includes('/builds.json?')) return Response.json([buildRow(observedId(1))]);
        if (path.includes('/sessions.json?'))
          return Response.json([sessionRow(retainedSessionIds[0], change)]);
        return valid(url);
      },
    });
    const expectedConflict = change.status !== 'passed';
    assert.equal(result.history.sessions[0].conflict, expectedConflict);
    assert.equal(result.status, expectedConflict ? 'failed' : 'passed');
    assert.equal(result.history.sessions[0].observations.length, 2);
  }
});

test('sparse lists get one bounded detail lookup while known failed details are not retried', async () => {
  const fresh = observedId(100),
    missing = retainedSessionIds[0];
  const urls: string[] = [];
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      const path = String(url);
      urls.push(path);
      if (path.includes('/builds.json?')) return Response.json([buildRow(observedId(1))]);
      if (path.includes('/sessions.json?'))
        return Response.json([
          sessionRow(fresh, { created_at: undefined, browserstack_status: undefined }),
          sessionRow(missing),
        ]);
      if (path.endsWith(`sessions/${missing}.json`))
        return new Response('secret-error', { status: 404 });
      return valid(url);
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(urls.filter((url) => url.endsWith(`sessions/${missing}.json`)).length, 1);
  assert.equal(urls.filter((url) => url.endsWith(`sessions/${fresh}.json`)).length, 1);
  const entry = result.history.sessions.find((entry) => entry.sessionId === fresh)!;
  assert.deepEqual(
    entry.observations.map(({ source }) => source),
    ['build-list', 'detail'],
  );
  assert.equal(entry.conflict, false);
  assert.deepEqual(result.history.sessions[0].observations[0].evidence, {
    outcome: 'unavailable',
    reason: 'http-404',
  });
});

test('active sessions and missing detail evidence remain explicit and cannot authorize allocation', async () => {
  const id = observedId(100);
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      const path = String(url);
      if (path.includes('/builds.json?')) return Response.json([buildRow(observedId(1))]);
      if (path.includes('/sessions.json?'))
        return Response.json([
          sessionRow(id, { status: 'running', browserstack_status: 'running' }),
        ]);
      if (path.endsWith(`sessions/${id}.json`))
        return new Response('secret-error', { status: 403 });
      return valid(url);
    },
  });
  const entry = result.history.sessions.at(-1)!;
  assert.equal(result.status, 'failed');
  assert.deepEqual(entry.observations[1], {
    source: 'detail',
    evidence: { outcome: 'unavailable', reason: 'http-403' },
  });
  assert.equal(
    entry.observations[0].evidence.outcome === 'available' &&
      entry.observations[0].evidence.data.executionStatus,
    'running',
  );
  assert.equal(result.allocationAllowed, false);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('the global request cap includes provenance, pages and details, retaining every unstarted lookup', async () => {
  const builds = Array.from({ length: 10 }, (_, index) => observedId(index + 1));
  const urls: string[] = [];
  const result = await collectQuotaEvidence({
    ...credentials,
    includeDedicatedDevices: true,
    fetcher: async (url) => {
      const location = new URL(String(url));
      urls.push(String(url));
      const offset = Number(location.searchParams.get('offset'));
      if (location.pathname === '/automate/builds.json')
        return Response.json(offset ? [] : builds.map(buildRow));
      if (location.search) {
        const index = builds.findIndex((id) => location.pathname.includes(id));
        return Response.json(
          offset
            ? []
            : Array.from({ length: 10 }, (_, n) =>
                sessionRow(observedId(100 + index * 10 + n), { created_at: undefined }),
              ),
        );
      }
      return valid(url);
    },
  });
  assert.equal(urls.length, 64);
  assert.equal(result.requests, quotaLimits.requests);
  assert.equal(new Set(urls).size, 64);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.dedicatedDevices, { outcome: 'unavailable', reason: 'request-limit' });
  assert.ok(urls.every((url) => new URL(url).host === 'api.browserstack.com'));
  assert.equal(result.history.sessions.length, 106);
  const unavailable = result.history.sessions
    .flatMap(({ observations }) => observations)
    .filter(({ evidence }) => evidence.outcome === 'unavailable');
  assert.equal(unavailable.length, 65);
  assert.ok(
    unavailable.every(
      ({ evidence }) => evidence.outcome === 'unavailable' && evidence.reason === 'request-limit',
    ),
  );
});

test('build and session count caps retain explicit partial coverage within the request bound', async () => {
  for (const limit of ['builds', 'sessions'] as const) {
    let calls = 0;
    const result = await collectQuotaEvidence({
      ...credentials,
      fetcher: async (url) => {
        calls++;
        const location = new URL(String(url)),
          offset = Number(location.searchParams.get('offset'));
        if (location.pathname === '/automate/builds.json')
          return Response.json(
            limit === 'builds'
              ? Array.from({ length: 10 }, (_, n) => buildRow(observedId(offset + n + 1)))
              : [buildRow(observedId(1))],
          );
        if (location.search)
          return Response.json(
            limit === 'sessions'
              ? Array.from({ length: 10 }, (_, n) => sessionRow(observedId(offset + n + 100)))
              : [],
          );
        return valid(url);
      },
    });
    assert.ok(calls <= quotaLimits.requests);
    assert.equal(result.status, 'failed');
    if (limit === 'builds') {
      assert.equal(result.history.builds.length, quotaLimits.builds);
      assert.equal(result.history.buildPagination.reason, 'build-limit');
    } else {
      assert.equal(result.history.sessions.length, quotaLimits.sessions);
      assert.equal(result.history.builds[0].pagination.reason, 'session-limit');
    }
  }
});

test('enumeration crossing the shared deadline keeps partial coverage and starts no detail lookup', async () => {
  let clock = 0,
    calls = 0;
  const result = await collectQuotaEvidence({
    ...credentials,
    now: () => clock,
    fetcher: async (url) => {
      calls++;
      if (String(url).includes('/builds.json?')) return Response.json([buildRow(observedId(1))]);
      if (String(url).includes('/sessions.json?')) {
        clock = quotaLimits.totalMs;
        return Response.json([sessionRow(observedId(100))]);
      }
      return valid(url);
    },
  });
  assert.equal(calls, 9);
  assert.equal(result.history.deadlineExceeded, true);
  assert.equal(result.history.builds[0].pagination.reason, 'deadline-exceeded');
  assert.equal(result.history.sessions.length, 6);
  assert.equal(result.status, 'failed');
});

test('malformed IDs and oversized pages never become paths or leak provider fields', async () => {
  for (const payload of [
    [buildRow('../secret-key')],
    Array.from({ length: 11 }, (_, n) => buildRow(observedId(n))),
  ]) {
    const urls: string[] = [];
    const result = await collectQuotaEvidence({
      ...credentials,
      fetcher: async (url) => {
        urls.push(String(url));
        return String(url).includes('/builds.json?') ? Response.json(payload) : valid(url);
      },
    });
    assert.equal(result.history.buildPagination.reason, 'invalid-response');
    assert.equal(result.history.builds.length, 0);
    assert.equal(urls.length, 8);
    assert.equal(result.status, 'failed');
    assert.doesNotMatch(JSON.stringify(result), /secret|public_url/);
    assert.ok(urls.every((url) => !url.includes('secret')));
  }
});

test('active and conflicting duplicate build states are retained without names or duration substitution', async () => {
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      if (String(url).includes('/builds.json?'))
        return Response.json([
          buildRow(observedId(1)),
          {
            automation_build: {
              hashed_id: observedId(1),
              status: 'running',
              duration: 999,
              name: 'secret-name',
            },
          },
        ]);
      if (String(url).includes('/sessions.json?')) return Response.json([]);
      return valid(url);
    },
  });
  assert.equal(result.history.builds.length, 1);
  assert.deepEqual(result.history.builds[0].providerStatuses, ['done', 'running']);
  assert.equal(result.history.builds[0].conflict, true);
  assert.equal(result.status, 'failed');
  assert.doesNotMatch(JSON.stringify(result), /secret|999/);
});

test('a full first page containing only known smoke IDs still advances to new retained sessions', async () => {
  const offsets: number[] = [];
  const result = await collectQuotaEvidence({
    ...credentials,
    fetcher: async (url) => {
      const location = new URL(String(url));
      if (location.pathname === '/automate/builds.json')
        return Response.json([buildRow(observedId(1))]);
      if (location.search) {
        const offset = Number(location.searchParams.get('offset'));
        offsets.push(offset);
        return Response.json(
          (offset === 0
            ? [...retainedSessionIds, ...retainedSessionIds.slice(0, 4)]
            : [observedId(100)]
          ).map((id) => sessionRow(id)),
        );
      }
      return valid(url);
    },
  });
  assert.deepEqual(offsets, [0, 10]);
  assert.equal(result.status, 'passed');
  assert.equal(result.history.builds[0].pagination.outcome, 'exhausted');
  assert.equal(result.history.sessions.length, 7);
});
