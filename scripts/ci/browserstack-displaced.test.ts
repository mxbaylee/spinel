import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displacedRuns, displacedSummary, displacedWarnings } from './browserstack-displaced.ts';

const now = new Date('2026-11-02T23:40:00Z');
const run = (id: number, event = 'workflow_dispatch', display_title?: unknown) => ({
  id,
  event,
  display_title,
  created_at: '2026-11-02T22:25:40Z',
});

function github(
  runs: unknown[],
  jobs: Record<number, unknown[]>,
  overrides: Record<string, Response> = {},
  totalCount = runs.length,
) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const path = String(url).replace('https://api.github.com/repos/mxbaylee/spinel/actions/', '');
    if (overrides[path]) return overrides[path];
    if (path.startsWith('workflows/browserstack.yml/runs?'))
      return Response.json({ total_count: totalCount, workflow_runs: runs });
    const id = Number(/^runs\/(\d+)\/jobs/.exec(path)?.[1]);
    return Response.json({ total_count: (jobs[id] ?? []).length, jobs: jobs[id] ?? [] });
  }) as typeof fetch;
  return { fetcher, requests };
}

test('only cancelled runs whose jobs never reached a runner are reported', async () => {
  const { fetcher, requests } = github(
    [
      run(1, 'workflow_dispatch', 'BrowserStack `safari` [x](y)\n<b>|'),
      run(2, 'schedule'),
      run(3),
      run(4),
      run(5, 'push'),
    ],
    {
      // Admission waited for a runner, then the group cancelled it.
      1: [
        { name: 'admission', runner_name: null },
        { name: 'diagnostics', runner_name: '' },
      ],
      2: [],
      // Admission ran; provider work may have started.
      3: [
        { name: 'admission', runner_name: 'GitHub Actions 7' },
        { name: 'phone', runner_name: null },
      ],
    },
  );
  const report = await displacedRuns({
    repository: 'mxbaylee/spinel',
    token: 'token',
    currentRunId: '4',
    fetcher,
    now,
  });
  assert.deepEqual(report, {
    status: 'available',
    since: '2026-10-02',
    runs: [
      {
        id: 1,
        event: 'workflow_dispatch',
        title: 'BrowserStack safari x y b',
        createdAt: '2026-11-02T22:25:40Z',
      },
      { id: 2, event: 'schedule', title: '', createdAt: '2026-11-02T22:25:40Z' },
    ],
    unread: 0,
  });
  assert.match(
    requests[0].url,
    /\/actions\/workflows\/browserstack\.yml\/runs\?status=cancelled&created=%3E%3D2026-10-02&per_page=10$/,
  );
  // The current run and unknown events are never queried.
  assert.deepEqual(
    requests.slice(1).map((request) => /runs\/(\d+)\/jobs/.exec(request.url)?.[1]),
    ['1', '2', '3'],
  );
  // Jobs from every attempt are read, so an earlier attempt's runner counts.
  for (const request of requests.slice(1))
    assert.match(request.url, /\/jobs\?filter=all&per_page=50$/);
  for (const request of requests) {
    assert.equal(request.init?.method, 'GET');
    assert.equal(request.init?.redirect, 'error');
    assert.equal(new Headers(request.init?.headers).get('Authorization'), 'Bearer token');
  }
  const summary = displacedSummary(report, 'mxbaylee/spinel').join('\n');
  assert.match(summary, /\[1\]\(https:\/\/github\.com\/mxbaylee\/spinel\/actions\/runs\/1\)/);
  assert.match(summary, /workflow_dispatch \(`BrowserStack safari x y b`\), created/);
  // The one recurring obligation stands out from label and dispatch runs.
  assert.match(
    summary,
    /: schedule, created [^.]+\. No device time; \*\*the monthly acceptance run was lost; dispatch `safari-acceptance` unless already re-dispatched\*\*\./,
  );
  assert.equal(summary.match(/monthly acceptance run was lost/g)?.length, 1);
  assert.match(summary, /does not affect admission/);
  // Only the lost scheduled run is annotated, by id alone.
  assert.deepEqual(displacedWarnings(report), [
    '::warning title=Monthly BrowserStack run lost::Scheduled run 2 was cancelled before any job started; dispatch safari-acceptance unless already re-dispatched.',
  ]);
  assert.deepEqual(displacedWarnings({ status: 'unavailable', reason: 'http-403' }), []);
});

test('a listing that never answers is abandoned within the request bound', async () => {
  const started = Date.now();
  const report = await displacedRuns({
    repository: 'mxbaylee/spinel',
    token: 'token',
    currentRunId: '',
    // Resolves only when aborted, like a stalled connection.
    fetcher: ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      )) as typeof fetch,
    now,
    requestTimeoutMs: 50,
  });
  assert.deepEqual(report, { status: 'unavailable', reason: 'request-failed' });
  assert.ok(Date.now() - started < 1_000, 'aborted by the request bound');
});

test('failures are reported as unavailable with a fixed reason and never throw', async () => {
  const cases: [Parameters<typeof displacedRuns>[0], string][] = [
    [{ repository: 'bad repo', token: 'token', currentRunId: '' }, 'missing-credentials'],
    [{ repository: 'mxbaylee/spinel', token: '', currentRunId: '' }, 'missing-credentials'],
    [
      {
        repository: 'mxbaylee/spinel',
        token: 'token',
        currentRunId: '',
        fetcher: github(
          [],
          {},
          {
            'workflows/browserstack.yml/runs?status=cancelled&created=%3E%3D2026-10-02&per_page=10':
              new Response('private body', { status: 403 }),
          },
        ).fetcher,
        now,
      },
      'http-403',
    ],
    [
      {
        repository: 'mxbaylee/spinel',
        token: 'token',
        currentRunId: '',
        fetcher: (async () => {
          throw new Error('private network detail');
        }) as typeof fetch,
        now,
      },
      'request-failed',
    ],
    [
      {
        repository: 'mxbaylee/spinel',
        token: 'token',
        currentRunId: '',
        fetcher: github([{ id: 'not-a-number', event: 'schedule', created_at: 'x' }], {}).fetcher,
        now,
      },
      'invalid-response',
    ],
    [
      {
        repository: 'mxbaylee/spinel',
        token: 'token',
        currentRunId: '',
        fetcher: github([run(1)], { 1: ['not-an-object'] }).fetcher,
        now,
      },
      'invalid-response',
    ],
    [
      {
        repository: 'mxbaylee/spinel',
        token: 'token',
        currentRunId: '',
        // More jobs than one page: an unread job could have had a runner.
        fetcher: github(
          [run(1)],
          {},
          {
            'runs/1/jobs?filter=all&per_page=50': Response.json({ total_count: 51, jobs: [] }),
          },
        ).fetcher,
        now,
      },
      'invalid-response',
    ],
    [
      {
        repository: 'mxbaylee/spinel',
        token: 'token',
        currentRunId: '',
        fetcher: github([run(1), run(2)], {}, {}, 1).fetcher,
        now,
      },
      'invalid-response',
    ],
    [
      {
        repository: 'mxbaylee/spinel',
        token: 'token',
        currentRunId: '',
        fetcher: (async () => new Response('x'.repeat(600 * 1024))) as typeof fetch,
        now,
      },
      'response-too-large',
    ],
    [
      {
        repository: 'mxbaylee/spinel',
        token: 'token',
        currentRunId: '',
        // An undeclared endless body stops at the cap instead of being buffered.
        fetcher: (async () => {
          let sent = 0;
          return new Response(
            new ReadableStream({
              pull(controller) {
                sent += 64 * 1024;
                if (sent > 2 * 1024 * 1024) throw new Error('read past the cap');
                controller.enqueue(new Uint8Array(64 * 1024).fill(32));
              },
            }),
          );
        }) as typeof fetch,
        now,
      },
      'response-too-large',
    ],
    [
      {
        repository: 'mxbaylee/spinel',
        token: 'token',
        currentRunId: '',
        // A declared oversize body is refused before it is read.
        fetcher: (async () =>
          new Response('{}', {
            headers: { 'content-length': String(600 * 1024) },
          })) as typeof fetch,
        now,
      },
      'response-too-large',
    ],
  ];
  for (const [options, reason] of cases) {
    const report = await displacedRuns(options);
    assert.deepEqual(report, { status: 'unavailable', reason });
    const summary = displacedSummary(report, 'mxbaylee/spinel').join('\n');
    assert.match(summary, new RegExp(`Unavailable \\(${reason}\\)`));
    assert.doesNotMatch(summary, /private/);
  }
  // More cancelled runs than the newest ten are flagged, never reported as none.
  const truncated = await displacedRuns({
    repository: 'mxbaylee/spinel',
    token: 'token',
    currentRunId: '',
    fetcher: github([run(3)], { 3: [{ runner_name: 'GitHub Actions 7' }] }, {}, 14).fetcher,
    now,
  });
  assert.deepEqual(truncated, { status: 'available', since: '2026-10-02', runs: [], unread: 4 });
  const flagged = displacedSummary(truncated, 'mxbaylee/spinel').join('\n');
  assert.match(flagged, /- None since 2026-10-02 among the newest 10\./);
  assert.match(flagged, /- 4 older cancelled runs were not read; check them by hand\./);
  assert.match(
    displacedSummary(
      { status: 'available', since: '2026-10-02', runs: [], unread: 0 },
      'mxbaylee/spinel',
    ).join('\n'),
    /- None since 2026-10-02\./,
  );
});
