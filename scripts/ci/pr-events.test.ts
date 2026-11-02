import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeCheckNames, formatCodeRunName } from './pr-identity.ts';
import type { PullRequestIdentity } from './pr-identity.ts';
import { validatePrPolicy } from './pr-policy.ts';
import { routePrEdit } from './pr-revalidate.ts';
import { PrGitHub } from './pr-github.ts';

function scenario() {
  const repository = 'owner/repo';
  const createdAt = '2026-11-01T12:00:00Z';
  const base = 'a'.repeat(40),
    head = 'b'.repeat(40),
    tested = 'c'.repeat(40);
  const pr = {
    number: 129,
    title: 'Valid ticket title',
    body: null as string | null,
    state: 'open',
    base: { sha: base, ref: 'main', repo: { full_name: repository } },
    head: { sha: head, ref: 'feature', repo: { full_name: repository } },
    merge_commit_sha: tested,
    labels: [] as { name: string }[],
    created_at: createdAt,
  };
  const event = {
    number: 129,
    repository: { full_name: repository },
    action: 'edited',
    changes: { title: { from: 'Earlier title' } } as unknown,
    pull_request: structuredClone(pr),
  };
  const run = {
    id: 100,
    workflow_id: 42,
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
    head_sha: head,
    repository: { full_name: repository },
    pull_requests: [{ number: 129 }],
    display_title: formatCodeRunName({ number: 129, base, head, tested, full: false }),
    check_suite_id: 200,
    run_attempt: 1,
    created_at: '2026-11-01T12:01:00Z',
    run_started_at: '2026-11-01T12:01:00Z',
    updated_at: '2026-11-01T12:01:00Z',
    status: 'in_progress',
    conclusion: null as string | null,
  };
  const jobs = codeCheckNames.map((name: string, index) => ({
    id: 300 + index,
    name,
    run_id: 100,
    run_attempt: 1,
    head_sha: head,
    check_run_url: `https://api.github.com/repos/owner/repo/check-runs/${400 + index}`,
    status: 'in_progress',
    conclusion: null as string | null,
    steps: [] as { name: string; status: string; conclusion: string | null }[],
  }));
  const coverage = {
    id: 390,
    name: 'Classify changes (100)',
    run_id: 100,
    run_attempt: 1,
    head_sha: head,
    check_run_url: 'https://api.github.com/repos/owner/repo/check-runs/490',
    status: 'completed',
    conclusion: 'success' as string | null,
    steps: [
      {
        name: 'Coverage selected: targeted',
        status: 'completed',
        conclusion: 'success' as string | null,
      },
    ],
  };
  jobs.unshift(coverage);
  const checks = codeCheckNames.map((name, index) => ({
    id: 400 + index,
    name,
    check_suite: { id: 200 },
    app: { id: 15368 },
    head_sha: head,
    status: 'in_progress',
    conclusion: null as string | null,
  }));
  const mutations: string[] = [];
  const timeline: unknown[] = [];
  const policyRun = {
    id: 500,
    workflow_id: 43,
    path: '.github/workflows/pr-policy.yml',
    event: 'pull_request',
    head_sha: head,
    repository: { full_name: repository },
    pull_requests: [{ number: 129 }],
    display_title: 'PR policy v1 pr=129 action=edited',
    run_attempt: 1,
    created_at: createdAt,
    status: 'completed',
    conclusion: 'success' as string | null,
  };
  const policyClassifier = {
    id: 501,
    name: 'Classify PR edit (500)',
    run_id: 500,
    run_attempt: 1,
    head_sha: head,
    status: 'completed',
    conclusion: 'success' as string | null,
    steps: [
      {
        name: 'Edit classification: text',
        status: 'completed',
        conclusion: 'success' as string | null,
      },
    ],
  };
  let reads = 0;
  const client = {
    repository,
    async get(path: string) {
      if (path === 'pulls/129') {
        reads++;
        return structuredClone(pr);
      }
      if (path === 'actions/workflows/ci.yml') return { id: 42, path: '.github/workflows/ci.yml' };
      if (path === 'actions/workflows/pr-policy.yml')
        return { id: 43, path: '.github/workflows/pr-policy.yml' };
      throw new Error(`Unexpected read ${path}`);
    },
    async list(path: string, key: string) {
      if (
        path === `actions/workflows/42/runs?event=pull_request&head_sha=${pr.head.sha}` &&
        key === 'workflow_runs'
      )
        return [structuredClone(run)];
      if (path === 'issues/129/timeline' && key === '') return structuredClone(timeline);
      if (
        path ===
          `actions/workflows/43/runs?event=pull_request&created=${encodeURIComponent(`>=${createdAt}`)}` &&
        key === 'workflow_runs'
      )
        return [structuredClone(policyRun)];
      if (path === 'actions/runs/500/jobs?filter=all' && key === 'jobs')
        return [structuredClone(policyClassifier)];
      if (path === 'actions/runs/100/jobs?filter=all' && key === 'jobs')
        return structuredClone(jobs);
      if (path === 'check-suites/200/check-runs?filter=latest' && key === 'check_runs')
        return structuredClone(checks);
      throw new Error(`Unexpected collection ${path}`);
    },
    async removeLabel(number: number, label: string) {
      assert.equal(number, 129);
      mutations.push(`ordinary:remove:${label}`);
      pr.labels = [];
    },
  };
  const writer = {
    async addLabel(number: number, label: string) {
      assert.equal(number, 129);
      mutations.push(`app:add:${label}`);
      pr.labels.push({ name: label });
    },
  };
  const options = {
    client,
    event,
    tested,
    validateTitle: (_identity: PullRequestIdentity) => {},
    now: () => Date.parse(pr.created_at) + 60_000,
    timeoutMs: 0,
  };
  const alignCodeWithCurrent = () => {
    event.pull_request = structuredClone(pr);
    options.tested = pr.merge_commit_sha;
    run.head_sha = pr.head.sha;
    run.display_title = formatCodeRunName({
      number: pr.number,
      base: pr.base.sha,
      head: pr.head.sha,
      tested: pr.merge_commit_sha,
      full: false,
    });
    for (const item of [...jobs, ...checks]) item.head_sha = pr.head.sha;
  };
  const fullCoverage = () => {
    coverage.status = 'completed';
    coverage.conclusion = 'success';
    coverage.steps = [
      { name: 'Coverage selected: full', status: 'completed', conclusion: 'success' },
    ];
  };
  return {
    pr,
    event,
    run,
    jobs,
    checks,
    coverage,
    client,
    writer,
    mutations,
    options,
    timeline,
    policyRun,
    policyClassifier,
    alignCodeWithCurrent,
    fullCoverage,
    reads: () => reads,
  };
}

test('text policy preserves genuine passing, pending and failed code results without mutations', async () => {
  for (const conclusion of [null, 'success', 'failure', 'cancelled']) {
    const s = scenario();
    for (const item of [s.run, ...s.jobs, ...s.checks]) {
      item.status = conclusion === null ? 'in_progress' : 'completed';
      item.conclusion = conclusion;
    }
    const before = JSON.stringify([s.run, s.jobs, s.checks]);
    const result = await validatePrPolicy(s.options);
    assert.equal(result.run, 100);
    assert.equal(JSON.stringify([s.run, s.jobs, s.checks]), before);
    assert.deepEqual(s.mutations, []);
    assert.ok(s.reads() >= 3);
  }
});

test('invalid title fails before code admission and corrected text is independently revalidated', async () => {
  const s = scenario();
  const seen: string[] = [];
  s.options.validateTitle = (identity: { title: string }) => {
    seen.push(identity.title);
    if (identity.title !== 'Valid ticket title') throw new Error('Invalid title');
  };
  s.pr.title = 'Invalid';
  await assert.rejects(validatePrPolicy(s.options), /Invalid title/);
  s.pr.title = 'Valid ticket title';
  await validatePrPolicy(s.options);
  assert.deepEqual(seen, ['Invalid', 'Valid ticket title']);
  assert.deepEqual(s.mutations, []);
});

test('base change, new code and text cannot borrow an old-base pass or forget full history without a label', async () => {
  const s = scenario();
  s.run.status = 'completed';
  s.run.conclusion = 'success';
  s.pr.base.sha = 'd'.repeat(40);
  s.event.pull_request.base.sha = s.pr.base.sha;
  s.timeline.push({ id: 1, event: 'base_ref_changed', created_at: s.pr.created_at });
  await assert.rejects(validatePrPolicy(s.options), /current source, base/);
  s.pr.head.sha = 'e'.repeat(40);
  s.pr.merge_commit_sha = 'f'.repeat(40);
  s.alignCodeWithCurrent();
  assert.deepEqual(s.pr.labels, []);
  await assert.rejects(validatePrPolicy(s.options), /full.validation|full coverage/i);
  // Historical obligation is not encoded in the static event's run-name flag.
  assert.match(s.run.display_title, /full=0$/);
  s.fullCoverage();
  s.run.conclusion = 'failure';
  for (const item of [...s.jobs.filter((job) => job.name !== s.coverage.name), ...s.checks]) {
    item.status = 'completed';
    item.conclusion = 'failure';
  }
  const result = await validatePrPolicy(s.options);
  assert.equal(result.requiredFull, true);
  assert.ok(s.checks.every((check) => check.conclusion === 'failure'));
});

test('policy fails closed on source drift, late text, missing gates and API failure', async () => {
  const moved = scenario();
  moved.pr.head.sha = 'd'.repeat(40);
  await assert.rejects(validatePrPolicy(moved.options), /source or base changed/);
  const late = scenario();
  const get = late.client.get.bind(late.client);
  late.client.get = async (path) => {
    if (path === 'pulls/129' && late.reads() === 2) late.pr.title = 'Changed during admission';
    return get(path);
  };
  await assert.rejects(validatePrPolicy(late.options), /PR (?:text )?changed|text changed/);
  const missing = scenario();
  missing.jobs.pop();
  await assert.rejects(validatePrPolicy(missing.options), /not admitted before the deadline/);
  const denied = scenario();
  denied.client.list = async () => {
    throw new Error('403');
  };
  await assert.rejects(
    validatePrPolicy(denied.options),
    /Could not read complete PR timeline history/,
  );
});

test('pending admission uses a bounded observable retry and validates the final state', async () => {
  const s = scenario();
  const last = s.jobs.pop()!;
  let now = Date.parse(s.pr.created_at) + 60_000;
  let pauses = 0;
  const result = await validatePrPolicy({
    ...s.options,
    timeoutMs: 120_000,
    now: () => now,
    pause: async (ms) => {
      pauses++;
      assert.equal(ms, 60_000);
      now += ms;
      s.jobs.push(last);
    },
  });
  assert.equal(result.run, 100);
  assert.equal(pauses, 1);
});

test('policy admission can outlast a sixty-minute worker and ordinary queueing', async () => {
  const s = scenario();
  const last = s.jobs.pop()!;
  let elapsed = 0;
  const result = await validatePrPolicy({
    ...s.options,
    timeoutMs: undefined,
    now: () => Date.parse(s.pr.created_at) + 60_000 + elapsed,
    pause: async () => {
      // Simulate a delayed resume after a long legitimate worker plus queueing.
      elapsed = 66 * 60_000;
      s.jobs.push(last);
    },
  });
  assert.equal(result.run, 100);
});

test('exact text edits never mint or use the privileged routing capability', async () => {
  const s = scenario();
  s.timeline.push({ id: 1, event: 'base_ref_changed', created_at: s.pr.created_at });
  s.pr.labels.push({ name: 'ci-revalidate' });
  assert.deepEqual(await routePrEdit(s.event, s.client, s.writer), {
    route: 'policy',
    number: 129,
  });
  assert.deepEqual(s.mutations, []);
});

test('base and ambiguous edits use ordinary-token removal then App addition, preserving the obligation', async () => {
  for (const changes of [{ base: { ref: { from: 'release' } } }, {}, { title: {} }]) {
    const s = scenario();
    s.event.changes = changes;
    s.pr.labels.push({ name: 'ci-revalidate' });
    assert.deepEqual(await routePrEdit(s.event, s.client), { route: 'full', number: 129 });
    assert.deepEqual(s.mutations, []);
    const result = await routePrEdit(s.event, s.client, s.writer);
    assert.equal(result.route, 'requested');
    assert.deepEqual(s.mutations, ['ordinary:remove:ci-revalidate', 'app:add:ci-revalidate']);
    assert.deepEqual(s.pr.labels, [{ name: 'ci-revalidate' }]);
  }
});

test('an old base-edit delivery routes the live PR source and does not disguise denied App mutation', async () => {
  const stale = scenario();
  stale.event.changes = {};
  stale.pr.base.sha = 'd'.repeat(40);
  stale.pr.head.sha = 'e'.repeat(40);
  assert.deepEqual(await routePrEdit(stale.event, stale.client, stale.writer), {
    route: 'requested',
    number: 129,
    base: stale.pr.base.sha,
    head: stale.pr.head.sha,
  });
  assert.deepEqual(stale.mutations, ['app:add:ci-revalidate']);
  const denied = scenario();
  denied.event.changes = {};
  await assert.rejects(
    routePrEdit(denied.event, denied.client, {
      addLabel: async () => {
        throw new Error('403');
      },
    }),
    /403/,
  );
  assert.deepEqual(denied.pr.labels, []);
});

test('missing router key or failed label addition cannot erase an ambiguous edit after a code push', async () => {
  for (const unavailable of ['key', 'mutation']) {
    const s = scenario();
    s.event.changes = {};
    s.policyClassifier.steps = [
      { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
    ];
    if (unavailable === 'key')
      assert.deepEqual(await routePrEdit(s.event, s.client), { route: 'full', number: 129 });
    else
      await assert.rejects(
        routePrEdit(s.event, s.client, {
          addLabel: async () => {
            throw new Error('403');
          },
        }),
        /403/,
      );
    assert.deepEqual(s.pr.labels, []);
    s.pr.head.sha = 'd'.repeat(40);
    s.pr.merge_commit_sha = 'e'.repeat(40);
    s.alignCodeWithCurrent();
    s.event.changes = { title: { from: 'Earlier title' } };
    await assert.rejects(validatePrPolicy(s.options), /full.validation|full coverage/i);
    assert.deepEqual(await routePrEdit(s.event, s.client, s.writer), {
      route: 'policy',
      number: 129,
    });
    assert.deepEqual(s.mutations, []);
  }
});

test('removing the full-revalidation label before a code push cannot narrow validation', async () => {
  const s = scenario();
  s.timeline.push(
    { id: 1, event: 'labeled', created_at: s.pr.created_at, label: { name: 'ci-revalidate' } },
    { id: 2, event: 'unlabeled', created_at: s.pr.created_at, label: { name: 'ci-revalidate' } },
  );
  s.pr.head.sha = 'd'.repeat(40);
  s.alignCodeWithCurrent();
  await assert.rejects(validatePrPolicy(s.options), /full.validation|full coverage/i);
  s.fullCoverage();
  assert.equal((await validatePrPolicy(s.options)).requiredFull, true);
});

test('an ambiguous edit with no router cannot borrow a prior full pass or its later retry', async () => {
  const s = scenario();
  s.fullCoverage();
  s.event.changes = {};
  s.policyRun.created_at = '2026-11-01T12:02:00Z';
  s.policyClassifier.steps = [
    { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
  ];
  s.options.now = () => Date.parse('2026-11-01T12:04:00Z');
  assert.deepEqual(await routePrEdit(s.event, s.client), { route: 'full', number: 129 });
  await assert.rejects(validatePrPolicy(s.options), /new eligible CI run/);
  s.run.run_attempt = 2;
  s.run.run_started_at = s.run.updated_at = '2026-11-01T12:03:00Z';
  await assert.rejects(validatePrPolicy(s.options), /new eligible CI run/);
  s.event.changes = { title: { from: 'Earlier title' } };
  await assert.rejects(validatePrPolicy(s.options), /new eligible CI run/);
  assert.deepEqual(s.mutations, []);
});

test('rapid text supersession waits for independent classification without routing code', async () => {
  const s = scenario();
  s.policyRun.status = 'completed';
  s.policyRun.conclusion = 'cancelled';
  s.policyClassifier.status = 'in_progress';
  s.policyClassifier.conclusion = null;
  s.policyClassifier.steps = [
    { name: 'Edit classification: text', status: 'pending', conclusion: null },
    { name: 'Edit classification: full', status: 'pending', conclusion: null },
  ];
  assert.deepEqual(await routePrEdit(s.event, s.client, s.writer), {
    route: 'policy',
    number: 129,
  });
  let now = Date.parse(s.pr.created_at) + 60_000;
  let pauses = 0;
  const result = await validatePrPolicy({
    ...s.options,
    timeoutMs: 120_000,
    now: () => now,
    pause: async (ms) => {
      assert.equal(ms, 60_000);
      now += ms;
      pauses++;
      s.policyClassifier.status = 'completed';
      s.policyClassifier.conclusion = 'success';
      s.policyClassifier.steps = [
        { name: 'Edit classification: text', status: 'completed', conclusion: 'success' },
      ];
    },
  });
  assert.equal(pauses, 1);
  assert.equal(result.requiredFull, false);
  assert.deepEqual(s.mutations, []);
});

test('router refuses a closed PR or a live non-main target before mutating labels', async () => {
  for (const change of ['closed', 'base']) {
    const s = scenario();
    s.event.changes = {};
    if (change === 'closed') s.pr.state = 'closed';
    else s.pr.base.ref = 'release';
    await assert.rejects(routePrEdit(s.event, s.client, s.writer));
    assert.deepEqual(s.mutations, []);
  }
});

test('GitHub client bounds pagination and credentials to the repository API without redirects', async () => {
  assert.equal(new PrGitHub('owner/repo', 'private-token', fetch, '123').routerAppId, 123);
  assert.equal(new PrGitHub('owner/repo', 'private-token', fetch, '').routerAppId, undefined);
  for (const appId of ['0', '-1', '01', '1e3', 'unsafe', '9007199254740992'])
    assert.throws(() => new PrGitHub('owner/repo', 'private-token', fetch, appId), /App ID/);
  const requests: { url: string; options?: RequestInit }[] = [];
  const client = new PrGitHub('owner/repo', 'private-token', async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(
      JSON.stringify({
        jobs:
          requests.length === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }],
      }),
      { status: 200 },
    );
  });
  assert.equal((await client.list('actions/runs/100/jobs?filter=latest', 'jobs')).length, 101);
  assert.ok(
    requests.every(
      ({ url, options }) =>
        url.startsWith('https://api.github.com/repos/owner/repo/') && options?.redirect === 'error',
    ),
  );
  assert.match(requests[1].url, /page=2$/);
  await assert.rejects(client.get('https://attacker.invalid'), /Invalid repository API path/);
  await assert.rejects(client.addLabel(129, 'unrelated'), /Only the reserved CI label/);
  const failed = new PrGitHub(
    'owner/repo',
    'private-token',
    async () => new Response('private-token', { status: 403 }),
  );
  await assert.rejects(
    failed.get('pulls/129'),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes('private-token') &&
      error.message.includes('403'),
  );
  let pages = 0;
  const timelineClient = new PrGitHub('owner/repo', 'private-token', async () => {
    pages++;
    return new Response(
      JSON.stringify(
        pages === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }],
      ),
      { status: 200 },
    );
  });
  assert.equal((await timelineClient.list('issues/129/timeline', '')).length, 101);
  assert.equal(pages, 2);
  let incompletePages = 0;
  const incompleteTimeline = new PrGitHub('owner/repo', 'private-token', async () => {
    incompletePages++;
    return new Response(
      JSON.stringify(
        incompletePages === 1
          ? Array.from({ length: 100 }, (_, id) => ({ id }))
          : { message: 'incomplete' },
      ),
      { status: 200 },
    );
  });
  await assert.rejects(
    incompleteTimeline.list('issues/129/timeline', ''),
    /collection|pagination/i,
  );
});
