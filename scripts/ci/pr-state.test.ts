import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertCurrentSource,
  classifyPrEdit,
  currentPullRequest,
  readFullValidationRequirement,
  type CurrentPullRequest,
  type PrReader,
} from './pr-state.ts';

const repository = 'owner/repo';
const createdAt = '2026-11-01T12:00:00Z';
const rawPr = () => ({
  number: 129,
  base: { sha: 'a'.repeat(40), ref: 'main', repo: { full_name: repository } },
  head: { sha: 'b'.repeat(40), ref: 'feature', repo: { full_name: repository } },
  merge_commit_sha: 'c'.repeat(40),
  state: 'open',
  title: 'A policy title',
  body: null,
  labels: [],
  created_at: createdAt,
});
const policyRun = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  workflow_id: 42,
  path: '.github/workflows/pr-policy.yml',
  event: 'pull_request',
  repository: { full_name: repository },
  pull_requests: [{ number: 129 }],
  head_sha: 'b'.repeat(40),
  created_at: createdAt,
  run_attempt: 1,
  display_title: 'PR policy v1 pr=129 action=edited',
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});
const classifier = (overrides: Record<string, unknown> = {}) => ({
  id: 50,
  run_id: 10,
  run_attempt: 1,
  head_sha: 'b'.repeat(40),
  name: 'Classify PR edit (10)',
  status: 'completed',
  conclusion: 'success',
  steps: [{ name: 'Edit classification: text', status: 'completed', conclusion: 'success' }],
  ...overrides,
});

function fixture(
  options: {
    pr?: unknown;
    timeline?: unknown[];
    runs?: unknown[];
    jobs?: unknown[];
    jobsByRun?: Record<number, unknown[]>;
    failAt?: string;
  } = {},
) {
  const calls: string[] = [];
  const client: PrReader = {
    repository,
    async get(path) {
      calls.push(path);
      if (options.failAt === path) throw new Error('Unavailable capability.');
      if (path === 'pulls/129') return options.pr ?? rawPr();
      assert.equal(path, 'actions/workflows/pr-policy.yml');
      return { id: 42, path: '.github/workflows/pr-policy.yml' };
    },
    async list(path, key) {
      calls.push(path);
      if (options.failAt === path) throw new Error('Pagination did not complete.');
      if (path === 'issues/129/timeline') {
        assert.equal(key, '');
        return options.timeline ?? [];
      }
      if (path.startsWith('actions/workflows/42/runs?')) {
        assert.equal(key, 'workflow_runs');
        assert.equal(
          path,
          `actions/workflows/42/runs?event=pull_request&created=${encodeURIComponent(`>=${createdAt}`)}`,
        );
        return options.runs ?? [];
      }
      const match = /^actions\/runs\/([0-9]+)\/jobs\?filter=all$/.exec(path);
      assert.ok(match);
      assert.equal(key, 'jobs');
      return options.jobsByRun?.[Number(match[1])] ?? options.jobs ?? [];
    },
  };
  return { client, calls };
}
async function requirement(options: Parameters<typeof fixture>[0] = {}) {
  const { client } = fixture(options);
  const state = await currentPullRequest(client, 129);
  return readFullValidationRequirement(client, state);
}

test('live source guards reject changed bases, heads, repositories, refs and closed PRs', async () => {
  const { client } = fixture();
  const state = await currentPullRequest(client, 129);
  assert.equal(state.createdAt, createdAt);
  assertCurrentSource(state.identity, { ...state.identity, title: 'A newer title' });
  for (const change of [
    { base: 'd'.repeat(40) },
    { head: 'd'.repeat(40) },
    { repository: 'another/repo' },
    { headRepository: 'another/repo' },
    { baseRef: 'other-base' },
    { headRef: 'other-head' },
    { number: 130 },
    { state: 'closed' as const },
  ])
    assert.throws(
      () => assertCurrentSource(state.identity, { ...state.identity, ...change }),
      /source or base changed/,
    );
});

test('current state requires a complete valid creation time and label inventory', async () => {
  for (const pr of [
    { ...rawPr(), created_at: undefined },
    { ...rawPr(), created_at: '2026-02-30T12:00:00Z' },
    { ...rawPr(), labels: [{}] },
  ]) {
    const { client } = fixture({ pr });
    await assert.rejects(currentPullRequest(client, 129), /labels or creation time/);
  }
});

test('a historical base change or removed label persists without a current label or router capability', async () => {
  for (const entry of [
    { event: 'base_ref_changed' },
    { event: 'labeled', label: { name: 'ci-revalidate' } },
    { event: 'unlabeled', label: { name: 'ci-revalidate' } },
  ]) {
    const { client, calls } = fixture({
      timeline: [{ id: 1, created_at: createdAt, ...entry }],
      failAt: 'actions/workflows/pr-policy.yml',
    });
    const state = await currentPullRequest(client, 129);
    assert.deepEqual(state.labels, []);
    assert.equal((await readFullValidationRequirement(client, state)).state, 'full');
    assert.equal(calls.includes('actions/workflows/pr-policy.yml'), false);
  }
});

test('ordinary non-edit policy runs do not request full validation while pending or missing markers', async () => {
  for (const action of ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']) {
    const { client, calls } = fixture({
      runs: [
        policyRun({
          display_title: `PR policy v1 pr=129 action=${action}`,
          status: 'queued',
          conclusion: null,
        }),
      ],
    });
    assert.equal(
      (await readFullValidationRequirement(client, await currentPullRequest(client, 129))).state,
      'clear',
    );
    assert.equal(calls.includes('actions/runs/10/jobs?filter=all'), false);
  }
});

test('an uncancelled successful text classifier remains evidence after its policy run is cancelled', async () => {
  for (const status of ['in_progress', 'completed']) {
    assert.equal(
      (
        await requirement({
          runs: [policyRun({ status, conclusion: status === 'completed' ? 'cancelled' : null })],
          jobs: [classifier()],
        })
      ).state,
      'clear',
    );
  }
  assert.equal(
    (
      await requirement({
        runs: [policyRun({ run_attempt: 2 })],
        jobs: [classifier()],
      })
    ).state,
    'clear',
  );
});

test('classification work that is still pending is distinct from failed or cancelled missing proof', async () => {
  assert.equal(
    (await requirement({ runs: [policyRun({ status: 'queued', conclusion: null })] })).state,
    'pending',
  );
  assert.equal(
    (
      await requirement({
        runs: [policyRun()],
        jobs: [classifier({ status: 'in_progress', conclusion: null, steps: [] })],
      })
    ).state,
    'pending',
  );
  for (const conclusion of ['failure', 'cancelled', 'success']) {
    assert.equal(
      (
        await requirement({
          runs: [policyRun({ status: 'completed', conclusion })],
          jobs: [],
        })
      ).state,
      'full',
    );
    assert.equal(
      (
        await requirement({
          runs: [policyRun({ status: 'in_progress', conclusion: null })],
          jobs: [classifier({ status: 'completed', conclusion, steps: [] })],
        })
      ).state,
      'full',
    );
  }
});

test('partial retries retain a genuine prior classifier but a newer pending or failed classifier owns its result', async () => {
  const runs = [policyRun({ run_attempt: 2 })];
  assert.equal((await requirement({ runs, jobs: [classifier()] })).state, 'clear');
  assert.equal(
    (await requirement({ runs, jobs: [classifier(), classifier({ id: 51, run_attempt: 2 })] }))
      .state,
    'clear',
  );
  assert.equal(
    (
      await requirement({
        runs,
        jobs: [
          classifier(),
          classifier({
            id: 51,
            run_attempt: 2,
            status: 'in_progress',
            conclusion: null,
            steps: [],
          }),
        ],
      })
    ).state,
    'pending',
  );
  assert.equal(
    (
      await requirement({
        runs,
        jobs: [
          classifier(),
          classifier({
            id: 51,
            run_attempt: 2,
            status: 'completed',
            conclusion: 'failure',
            steps: [],
          }),
        ],
      })
    ).state,
    'full',
  );
});

test('a recorded full marker persists and cannot be replaced by later text classification', async () => {
  const result = await requirement({
    runs: [policyRun({ id: 11 }), policyRun()],
    jobsByRun: {
      11: [classifier({ id: 51, run_id: 11, name: 'Classify PR edit (11)' })],
      10: [
        classifier({
          steps: [
            { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
            { name: 'Edit classification: text', status: 'completed', conclusion: 'skipped' },
          ],
        }),
      ],
    },
  });
  assert.equal(result.state, 'full');
});

test('missing or contradictory PR associations cannot erase a full edit before a later code run', async () => {
  for (const associations of [[], [{ number: 130 }]]) {
    assert.equal(
      (
        await requirement({
          runs: [
            policyRun({ pull_requests: associations }),
            policyRun({ id: 11, display_title: 'PR policy v1 pr=129 action=synchronize' }),
          ],
          jobs: [
            classifier({
              steps: [
                { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
              ],
            }),
          ],
        })
      ).state,
      'full',
    );
  }
  assert.equal(
    (
      await requirement({
        runs: [policyRun({ pull_requests: [], display_title: 'Unknown policy event' })],
      })
    ).state,
    'full',
  );
});

test('malformed, duplicate and foreign run or classification bindings conservatively require full validation', async () => {
  for (const change of [
    { workflow_id: 43 },
    { path: '.github/workflows/ci.yml' },
    { event: 'workflow_dispatch' },
    { repository: { full_name: 'another/repo' } },
    { pull_requests: [{ number: 129 }, { number: 129 }] },
    { display_title: 'PR policy v1 pr=129 action=edited\n' },
    { display_title: 'PR policy v1 pr=130 action=edited' },
    { head_sha: null },
    { run_attempt: 0 },
    { created_at: null },
  ])
    assert.equal(
      (await requirement({ runs: [policyRun(change)], jobs: [classifier()] })).state,
      'full',
    );
  assert.equal(
    (await requirement({ runs: [policyRun(), policyRun()], jobs: [classifier()] })).state,
    'full',
  );
  for (const change of [
    { run_id: 11 },
    { run_attempt: 2 },
    { head_sha: 'd'.repeat(40) },
    { steps: [null] },
  ])
    assert.equal(
      (await requirement({ runs: [policyRun()], jobs: [classifier(change)] })).state,
      'full',
    );
  assert.equal(
    (await requirement({ runs: [policyRun()], jobs: [classifier(), classifier()] })).state,
    'full',
  );
  assert.equal(
    (
      await requirement({
        runs: [policyRun()],
        jobs: [
          classifier({
            steps: [
              { name: 'Edit classification: text', status: 'completed', conclusion: 'success' },
              { name: 'Edit classification: text', status: 'completed', conclusion: 'success' },
            ],
          }),
        ],
      })
    ).state,
    'full',
  );
  assert.equal(
    (
      await requirement({
        runs: [policyRun()],
        jobs: [
          classifier({
            steps: [
              { name: 'Edit classification: text', status: 'completed', conclusion: 'success' },
              { name: 'Edit classification: full', status: 'missing', conclusion: null },
            ],
          }),
        ],
      })
    ).state,
    'full',
  );
});

test('unrelated PR runs are ignored but missing or incomplete API history cannot clear an obligation', async () => {
  assert.equal(
    (
      await requirement({
        runs: [
          policyRun({
            pull_requests: [{ number: 130 }],
            display_title: 'PR policy v1 pr=130 action=edited',
          }),
        ],
      })
    ).state,
    'clear',
  );
  const runsPath = `actions/workflows/42/runs?event=pull_request&created=${encodeURIComponent(`>=${createdAt}`)}`;
  for (const failAt of [
    'issues/129/timeline',
    'actions/workflows/pr-policy.yml',
    runsPath,
    'actions/runs/10/jobs?filter=all',
  ])
    assert.equal(
      (await requirement({ failAt, runs: [policyRun()], jobs: [classifier()] })).state,
      'full',
    );
  for (const timeline of [
    [null],
    [{ event: 'labeled', id: 1, created_at: createdAt, label: null }],
    [1, 1].map((id) => ({
      id,
      created_at: createdAt,
      event: 'labeled',
      label: { name: 'unrelated' },
    })),
  ])
    assert.equal((await requirement({ timeline })).state, 'full');
});

test('classification recognizes only exact text changes and known code event actions', () => {
  assert.equal(
    classifyPrEdit({ action: 'edited', changes: { title: { from: 'old' }, body: { from: null } } }),
    'text',
  );
  for (const event of [
    null,
    {},
    { action: 'edited' },
    { action: 'edited', changes: { base: {} } },
    { action: 'unknown' },
  ])
    assert.equal(classifyPrEdit(event), 'full');
  for (const action of ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled'])
    assert.equal(classifyPrEdit({ action }), 'code');
});

test('history input with invalid creation bounds cannot claim a clear requirement', async () => {
  const { client } = fixture();
  const state: CurrentPullRequest = await currentPullRequest(client, 129);
  assert.equal(
    (await readFullValidationRequirement(client, { ...state, createdAt: 'invalid' })).state,
    'full',
  );
});
