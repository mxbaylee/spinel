import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { collectQuotaEvidence, quotaLimits, retainedSessionIds } from './browserstack-quota.ts';

const credentials = { username: 'secret-user', accessKey: 'secret-key' };
function success(url: string | URL | Request) {
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

test('only seven exact authenticated GETs; retained IDs match both immutable smoke reports', async () => {
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
    ['plan.json', ...ids.map((id) => `sessions/${id}.json`)].map(
      (path) => `https://api.browserstack.com/automate/${path}`,
    ),
  );
  assert.equal(result.status, 'passed');
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
  assert.equal(calls, 7);
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
      if (String(url).endsWith('plan.json')) return valid(url);
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
  assert.equal(calls, 7);
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
  assert.equal(calls, 7);
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
    assert.equal(calls, advance === quotaLimits.totalMs ? 1 : 7);
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

test('manual quota workflow defaults to read-only and has no device or tunnel action', async () => {
  const source = await readFile(
    new URL('../../.github/workflows/browserstack.yml', import.meta.url),
    'utf8',
  );
  assert.match(source, /default: quota/);
  const quota = source.split('  quota:\n')[1].split('  smoke:\n')[0];
  assert.match(quota, /if: github.event_name == 'workflow_dispatch' && inputs.mode == 'quota'/);
  assert.match(quota, /run: node scripts\/ci\/browserstack.ts quota/);
  assert.doesNotMatch(quota, /setup-local|setup-env|browserstack.ts (smoke|credentials)|needs:/);
  const smoke = source.split('  smoke:\n')[1];
  assert.match(smoke, /github.event_name == 'workflow_dispatch' && inputs.mode == 'smoke'/);
  assert.match(smoke, /github.event.label.name == 'ci-real-devices'/);
  assert.match(smoke, /github.event.pull_request.head.repo.full_name == github.repository/);
});
