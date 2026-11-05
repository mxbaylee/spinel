import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import {
  checkSession,
  clientFor,
  targetsFromInventory,
  webdriverErrorCode,
} from './browserstack.ts';
import type { CapabilityScope } from './browserstack-scope.ts';

// The monthly phone scopes, one day apart so no scheduled run displaces another
// pending run in the account lock. The workflow's crons are `17 9 <day> * *`.
const scheduledScopes = [
  { day: 1, scope: 'safari-acceptance' },
  { day: 2, scope: 'chrome-acceptance' },
  { day: 3, scope: 'firefox-tab-acceptance' },
] as const;

test('selects physical phones, excludes beta/tablet/emulator entries, and supports unlisted Firefox', () => {
  assert.deepEqual(
    targetsFromInventory([
      { os: 'android', os_version: '16', device: 'Google Pixel 10', real_mobile: true },
      { os: 'android', os_version: '17 beta', device: 'Google Pixel 11', real_mobile: true },
      { os: 'android', os_version: '99', device: 'Google Pixel 99', real_mobile: false },
      { os: 'ios', os_version: '26', device: 'iPad Pro 13', real_mobile: true },
      { os: 'ios', os_version: '26', device: 'iPhone 17', browser: 'iphone', real_mobile: 'true' },
      { os: 'ios', os_version: '18', device: 'iPhone 16', browser: 'iphone', real_mobile: true },
    ]),
    [
      { browser: 'chrome', device: 'Google Pixel 10', osVersion: '16' },
      { browser: 'firefox', device: 'Google Pixel 10', osVersion: '16' },
      { browser: 'safari', device: 'iPhone 17', osVersion: '26' },
    ],
  );
  assert.throws(() => targetsFromInventory([]), /missing-mobile-targets/);
});

test('credentials stay in the HTTPS authorization header and remote error text is discarded', async () => {
  const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
    assert.equal(url, 'https://api.browserstack.com/automate/plan.json');
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      'Basic Zml4dHVyZS11c2VyOmZpeHR1cmUta2V5',
    );
    assert.equal(init?.redirect, 'error');
    return new Response('fixture-user fixture-key sensitive server error', { status: 401 });
  });
  await assert.rejects(client.api('plan.json'), { message: 'http-401' });
  assert.equal(
    client.redact('fixture-user fixture-key Zml4dHVyZS11c2VyOmZpeHR1cmUta2V5'),
    '[redacted] [redacted] [redacted]',
  );
  assert.throws(() => clientFor('', 'fixture-key'), /missing-credentials/);
});

test('WebDriver failures preserve HTTP class and only allowlisted protocol codes without replay or remote details', async () => {
  for (const [status, code, expected] of [
    [500, 'javascript error', 'javascript error'],
    [404, 'no such window', 'no such window'],
    [500, 'private arbitrary provider value', undefined],
    [200, 'javascript error', 'javascript error'],
  ] as const) {
    let calls = 0;
    const client = clientFor('fixture-user', 'fixture-key', async () => {
      calls++;
      return Response.json(
        {
          value: {
            error: code,
            message: 'private message fixture-key',
            stacktrace: 'private stack',
            data: { url: 'https://private.example/?token=secret' },
          },
        },
        { status },
      );
    });
    await assert.rejects(
      client.command('session/test-session/execute/sync', 'POST', { script: 'private script' }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, status === 200 ? 'webdriver-error' : `http-${status}`);
        assert.equal(webdriverErrorCode(error), expected);
        assert.doesNotMatch(JSON.stringify(error), /private|fixture-key|secret|stack|url|message/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('WebDriver error diagnostics bound body bytes and discard malformed or oversized payloads', async () => {
  const payload = JSON.stringify({ value: { error: 'javascript error', message: 'private' } });
  for (const [body, expected] of [
    [payload.padEnd(8192, ' '), 'javascript error'],
    [payload.padEnd(8193, ' '), undefined],
    ['not JSON private details', undefined],
    ['{"value":null}', undefined],
    [null, undefined],
  ] as const) {
    const client = clientFor(
      'fixture-user',
      'fixture-key',
      async () => new Response(body, { status: 500 }),
    );
    await assert.rejects(
      client.command('session/test-session/execute/sync', 'POST'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'http-500');
        assert.equal(webdriverErrorCode(error), expected);
        assert.doesNotMatch(JSON.stringify(error), /private/);
        return true;
      },
    );
  }
});

test(
  'a stalled error body is cancelled without replacing the original HTTP failure',
  { timeout: 2000 },
  async () => {
    let cancelled = false;
    const client = clientFor(
      'fixture-user',
      'fixture-key',
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 500 },
        ),
    );
    await assert.rejects(
      client.command('session/test-session/execute/sync', 'POST'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'http-500');
        assert.equal(webdriverErrorCode(error), undefined);
        return true;
      },
    );
    assert.equal(cancelled, true);
  },
);

test(
  'diagnostic stream acquisition, failures and empty chunks cannot replace or indefinitely postpone the HTTP failure',
  { timeout: 2000 },
  async () => {
    for (const mode of ['locked', 'errored', 'empty-chunks', 'cancel-failure']) {
      let cancelled = false;
      let pulls = 0;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            if (mode === 'errored') controller.error(new Error('private stream failure'));
            if (mode === 'cancel-failure') controller.enqueue(new Uint8Array(8193));
          },
          pull(controller) {
            if (mode === 'empty-chunks') {
              pulls++;
              controller.enqueue(new Uint8Array());
            }
          },
          cancel() {
            cancelled = true;
            if (mode === 'cancel-failure') throw new Error('private cancellation failure');
          },
        }),
        { status: 500 },
      );
      const heldReader = mode === 'locked' ? response.body!.getReader() : undefined;
      try {
        const client = clientFor('fixture-user', 'fixture-key', async () => response);
        await assert.rejects(
          client.command('session/test-session/execute/sync', 'POST'),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, 'http-500');
            assert.equal(webdriverErrorCode(error), undefined);
            assert.doesNotMatch(JSON.stringify(error), /private/);
            return true;
          },
        );
        if (mode === 'empty-chunks') assert.ok(pulls > 0);
        if (mode === 'empty-chunks' || mode === 'cancel-failure') assert.equal(cancelled, true);
      } finally {
        heldReader?.releaseLock();
      }
    }
  },
);

test('a wrong runner challenge fails and still deletes the allocated session', async () => {
  const calls: string[] = [];
  const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
    calls.push(`${init?.method} ${String(url).split('/wd/hub/')[1]}`);
    const value = String(url).endsWith('/session')
      ? {
          sessionId: 'test-session',
          capabilities: { browserName: 'chrome', browserVersion: '145.0' },
        }
      : String(url).endsWith('/title')
        ? 'a different runner'
        : null;
    return Response.json({ value });
  });
  const result = await checkSession(
    client,
    { browser: 'chrome', device: 'Google Pixel 10', osVersion: '16' },
    'expected',
    'local-id',
    'fixture-build',
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.failure, 'tunnel-challenge-mismatch');
  assert.equal(result.tunnelReached, false);
  assert.equal(result.teardown, 'passed');
  assert.equal(calls.at(-1), 'DELETE session/test-session');
});

test('real-browser evidence is required and a teardown failure cannot produce a pass', async () => {
  for (const teardownFails of [false, true]) {
    const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
      if (init?.method === 'DELETE' && teardownFails)
        return new Response('sensitive', { status: 500 });
      const path = String(url).split('/wd/hub/')[1];
      if (path === 'session') {
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.capabilities.alwaysMatch['bstack:options'].realMobile, true);
        assert.equal(
          payload.capabilities.alwaysMatch['bstack:options'].localIdentifier,
          'local-id',
        );
        return Response.json({
          value: {
            sessionId: 'test-session',
            capabilities: { browserName: 'android', browserVersion: '145' },
          },
        });
      }
      const value = path.endsWith('/title')
        ? 'expected'
        : path.endsWith('/execute/sync')
          ? 'Mozilla/5.0 (Android 16) Gecko/145.0 Firefox/145.0'
          : null;
      return Response.json({ value });
    });
    const result = await checkSession(
      client,
      { browser: 'firefox', device: 'Google Pixel 10', osVersion: '16' },
      'expected',
      'local-id',
      'fixture-build',
    );
    assert.equal(result.tunnelReached, true);
    assert.equal(result.returnedBrowserName, 'android');
    assert.equal(result.status, teardownFails ? 'failed' : 'passed');
    assert.equal(result.teardown, teardownFails ? 'failed' : 'passed');
  }
});

test('session creation failures never echo the remote exception or claim cleanup', async () => {
  const client = clientFor('fixture-user', 'fixture-key', async () => {
    throw new Error('fixture-key in a remote exception');
  });
  const result = await checkSession(
    client,
    { browser: 'safari', device: 'iPhone 17', osVersion: '26' },
    'expected',
    'local-id',
    'fixture-build',
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.failure, 'request-failed');
  assert.equal(result.teardown, 'session-id-unavailable');
  assert.doesNotMatch(JSON.stringify(result), /fixture-key/);
});

test('malformed success responses and a different Android browser do not pass', async () => {
  const malformed = clientFor('fixture-user', 'fixture-key', async () => Response.json({}));
  await assert.rejects(malformed.command('session/test-session', 'DELETE'), {
    message: 'invalid-response-shape',
  });
  const client = clientFor('fixture-user', 'fixture-key', async (url) => {
    const path = String(url).split('/wd/hub/')[1];
    const value =
      path === 'session'
        ? { sessionId: 'test-session', capabilities: { browserName: 'chrome' } }
        : path.endsWith('/title')
          ? 'expected'
          : path.endsWith('/execute/sync')
            ? 'Mozilla/5.0 (Android 16) Chrome/145.0 SamsungBrowser/28.0'
            : null;
    return Response.json({ value });
  });
  const result = await checkSession(
    client,
    { browser: 'chrome', device: 'Google Pixel 10', osVersion: '16' },
    'expected',
    'local-id',
    'fixture-build',
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.failure, 'unexpected-browser');
  assert.equal(result.teardown, 'passed');
});

test('monthly Safari, Chrome and Firefox acceptance, every phone scope, and read-only diagnostics preserve their boundaries', async () => {
  const source = await readFile(
    new URL('../../.github/workflows/browserstack.yml', import.meta.url),
    'utf8',
  );
  // The default reads a completed session and allocates no device.
  assert.match(source, /default: diagnostics/);
  const modes = source.match(/options:\s*\[([^\]]+)\]/)?.[1];
  assert.ok(modes, 'manual choices remain explicit');
  assert.deepEqual(
    modes
      .trim()
      .replace(/,$/, '')
      .split(',')
      .map((value) => value.trim()),
    [
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
  // One cron per monthly scope, a day apart.
  assert.deepEqual(
    [...source.matchAll(/^    - cron: '(.+)'$/gm)].map((match) => match[1]),
    scheduledScopes.map((entry) => `17 9 ${entry.day} * *`),
  );
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
  const diagnostics = source.split('  diagnostics:\n')[1].split('  capability:\n')[0];
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
    /contents: write|GITHUB_TOKEN|needs:|continue-on-error:|setup-local|setup-env|npm ci|npm run build|browserstack-capability\.ts/,
  );
  const capability = source.split('  capability:\n')[1];
  assert.match(diagnostics, /BS_DIAGNOSTIC_KIND: \$\{\{ inputs.diagnostic_kind \|\| 'driver' \}\}/);
  assert.doesNotMatch(capability, /diagnostic_kind|BS_DIAGNOSTIC_KIND/);
  // Without a budget job nothing needs to write repository or Actions state.
  assert.doesNotMatch(source, /actions: write|contents: write|GITHUB_TOKEN|needs:/);
  assert.match(capability, /github.event_name == 'schedule'/);
  assert.match(
    capability,
    /github.event_name == 'workflow_dispatch' && inputs.mode != 'diagnostics'/,
  );
  // Device runs route on every account label, i.e. the lock's list without diagnostics.
  assert.deepEqual(
    JSON.parse(
      /contains\(fromJSON\('(\[[^']+\])'\), github\.event\.label\.name\)/.exec(capability)?.[1] ??
        '[]',
    ),
    lockLabels.filter((label) => label !== 'ci-browserstack-logs'),
  );
  assert.match(capability, /github.event.pull_request.head.repo.full_name == github.repository/);
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
    'a one-use journal, dependencies, typecheck and build precede Local/device execution',
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
  assert.ok(cleanup, 'every device scope retains Local cleanup after an attempted start');

  // These predicates use lowercase string equality and boolean operators shared with JS.
  // Read-only diagnostics cannot reach a device; all phone scopes share every gate.
  const condition = (block: string) => {
    const match = block.match(/^    if: (?:>-\n)?([\s\S]*?)\n    runs-on:/m);
    assert.ok(match);
    return match[1];
  };
  const conditions = Object.fromEntries(
    Object.entries({ diagnostics, capability }).map(([name, block]) => [name, condition(block)]),
  );
  const routes: {
    event: string;
    schedule?: string;
    mode?: string;
    action?: string;
    label?: string;
    fork?: boolean;
    jobs: string[];
    scope?: CapabilityScope;
  }[] = [
    ...scheduledScopes.flatMap(({ day, scope }) => [
      {
        event: 'schedule',
        schedule: `17 9 ${day} * *`,
        jobs: ['capability'],
        scope,
      },
    ]),
    { event: 'workflow_dispatch', mode: 'diagnostics', jobs: ['diagnostics'] },
    {
      event: 'workflow_dispatch',
      mode: 'capability',
      jobs: ['capability'],
      scope: 'all',
    },
    {
      event: 'workflow_dispatch',
      mode: 'chrome-diagnostic',
      jobs: ['capability'],
      scope: 'chrome-navigation-diagnostic',
    },
    {
      event: 'workflow_dispatch',
      mode: 'safari-acceptance',
      jobs: ['capability'],
      scope: 'safari-acceptance',
    },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-real-devices',
      jobs: ['capability'],
      scope: 'all',
    },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-real-devices-chrome',
      jobs: ['capability'],
      scope: 'chrome-navigation-diagnostic',
    },
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'ci-real-devices-safari',
      jobs: ['capability'],
      scope: 'safari-acceptance',
    },
    // Label names compare case-insensitively on GitHub, in == chains and contains() alike.
    {
      event: 'pull_request',
      action: 'labeled',
      label: 'CI-Real-Devices-Safari',
      jobs: ['capability'],
      scope: 'safari-acceptance',
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
  // an added mode from expanding one selected scope into a multi-device acceptance run.
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
        jobs: ['capability'],
        scope: mode,
      },
      {
        event: 'pull_request',
        action: 'labeled',
        label,
        jobs: ['capability'],
        scope: mode,
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
          schedule: route.schedule ?? '',
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
          ? `BrowserStack monthly ${scheduledScopes.find((entry) => `17 9 ${entry.day} * *` === route.schedule)?.scope}`
          : `BrowserStack ${route.label ?? ''}: Some PR`,
      `run title: ${JSON.stringify(route)}`,
    );
    // Any route that runs a job holds the account lock; only no-op labels leave it.
    const lockGroup = evaluate(group);
    const selected = ['diagnostics', 'capability'].filter((name) => evaluate(conditions[name]));
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
});

test('direct legacy smoke CLI stays closed before any provider call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-smoke-guard-'));
  try {
    const guard = join(directory, 'network-guard.ts');
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
    assert.equal(report.failure, 'legacy-smoke-closed');
    assert.equal(report.status, 'failed');
    assert.equal(report.authentication, 'not-verified');
    // The removed quota report is no longer a mode and reaches no provider.
    const quota = spawnSync(
      process.execPath,
      ['--import', guard, fileURLToPath(new URL('./browserstack.ts', import.meta.url)), 'quota'],
      {
        cwd: directory,
        timeout: 5000,
        encoding: 'utf8',
        env: { ...process.env, BS_USERNAME: 'unit-user', BS_ACCESS_KEY: 'unit-key' },
      },
    );
    assert.equal(quota.status, 1, quota.stderr);
    assert.doesNotMatch(quota.stdout + quota.stderr, /NETWORK_ATTEMPT|unit-user|unit-key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
