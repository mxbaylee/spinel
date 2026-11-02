import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeCheckNames, formatCodeRunName } from './pr-identity.ts';
import type { PullRequestIdentity } from './pr-identity.ts';
import { validatePrPolicy } from './pr-policy.ts';
import { routePrEdit } from './pr-revalidate.ts';
import { PrGitHub } from './pr-github.ts';

function scenario() {
  const repository = 'owner/repo';
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
    created_at: '2026-11-01T12:00:00Z',
    run_started_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:01:00Z',
    status: 'in_progress',
    conclusion: null as string | null,
  };
  const jobs = codeCheckNames.map((name, index) => ({
    id: 300 + index,
    name,
    run_id: 100,
    run_attempt: 1,
    head_sha: head,
    check_run_url: `https://api.github.com/repos/owner/repo/check-runs/${400 + index}`,
    status: 'in_progress',
    conclusion: null as string | null,
  }));
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
  let reads = 0;
  const client = {
    repository,
    async get(path: string) {
      if (path === 'pulls/129') {
        reads++;
        return structuredClone(pr);
      }
      if (path === 'actions/workflows/ci.yml') return { id: 42, path: '.github/workflows/ci.yml' };
      throw new Error(`Unexpected read ${path}`);
    },
    async list(path: string, key: string) {
      if (
        path === `actions/workflows/42/runs?event=pull_request&head_sha=${head}` &&
        key === 'workflow_runs'
      )
        return [structuredClone(run)];
      if (path === 'actions/runs/100/jobs?filter=latest' && key === 'jobs')
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
    timeoutMs: 0,
  };
  return { pr, event, run, jobs, checks, client, writer, mutations, options, reads: () => reads };
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

test('base change followed by text cannot borrow a previous-base pass or a targeted run', async () => {
  const s = scenario();
  s.run.status = 'completed';
  s.run.conclusion = 'success';
  s.pr.base.sha = 'd'.repeat(40);
  s.event.pull_request.base.sha = s.pr.base.sha;
  await assert.rejects(validatePrPolicy(s.options), /current source, base/);
  s.run.display_title = formatCodeRunName({
    number: 129,
    base: s.pr.base.sha,
    head: s.pr.head.sha,
    tested: s.pr.merge_commit_sha,
    full: false,
  });
  s.pr.labels.push({ name: 'ci-revalidate' });
  await assert.rejects(validatePrPolicy(s.options), /full-validation obligation/);
  s.run.display_title = s.run.display_title.replace('full=0', 'full=1');
  s.run.conclusion = 'failure';
  for (const item of [...s.jobs, ...s.checks]) {
    item.status = 'completed';
    item.conclusion = 'failure';
  }
  await validatePrPolicy(s.options);
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
  await assert.rejects(validatePrPolicy(late.options), /PR changed before/);
  const missing = scenario();
  missing.jobs.pop();
  await assert.rejects(validatePrPolicy(missing.options), /not admitted before the deadline/);
  const denied = scenario();
  denied.client.list = async () => {
    throw new Error('403');
  };
  await assert.rejects(validatePrPolicy(denied.options), /403/);
});

test('pending admission uses a bounded observable retry and validates the final state', async () => {
  const s = scenario();
  const last = s.jobs.pop()!;
  let now = 0;
  let pauses = 0;
  const result = await validatePrPolicy({
    ...s.options,
    timeoutMs: 20_000,
    now: () => now,
    pause: async (ms) => {
      pauses++;
      now += ms;
      s.jobs.push(last);
    },
  });
  assert.equal(result.run, 100);
  assert.equal(pauses, 1);
});

test('exact text edits never mint or use the privileged routing capability', async () => {
  const s = scenario();
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

test('router never labels a stale source and does not disguise a denied App mutation', async () => {
  const stale = scenario();
  stale.event.changes = {};
  stale.pr.base.sha = 'd'.repeat(40);
  await assert.rejects(
    routePrEdit(stale.event, stale.client, stale.writer),
    /source or base changed/,
  );
  assert.deepEqual(stale.mutations, []);
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

test('GitHub client bounds pagination and credentials to the repository API without redirects', async () => {
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
});
