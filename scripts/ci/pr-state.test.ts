import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { coveragePlan, type CoveragePlan } from './plan.ts';
import {
  assertCurrentSource,
  classifyPrEdit,
  currentPullRequest,
  guardCurrentCode,
  readFullValidationRequirement,
  type CurrentPullRequest,
  type PrReader,
} from './pr-state.ts';

const repository = 'owner/repo';
const createdAt = '2026-11-01T12:00:00Z';
const now = () => Date.parse(createdAt) + 60_000;
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
  run_number: overrides.id ?? 10,
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
const ciRun = (overrides: Record<string, unknown> = {}) => ({
  id: 100,
  path: '.github/workflows/ci.yml',
  event: 'pull_request',
  head_sha: 'b'.repeat(40),
  repository: { full_name: repository },
  created_at: '2026-11-01T12:00:10Z',
  run_started_at: '2026-11-01T12:00:10Z',
  run_attempt: 1,
  ...overrides,
});

function fixture(
  options: {
    pr?: unknown;
    timeline?: unknown[];
    runs?: unknown[];
    jobs?: unknown[];
    jobsByRun?: Record<number, unknown[]>;
    codeRun?: unknown;
    routerAppId?: number;
    rawRuns?: unknown[];
    failAt?: string;
  } = {},
) {
  const calls: string[] = [];
  const client: PrReader = {
    repository,
    routerAppId: options.routerAppId,
    async get(path) {
      calls.push(path);
      if (options.failAt === path) throw new Error('Unavailable capability.');
      if (path === 'pulls/129') return options.pr ?? rawPr();
      if (path === 'actions/workflows/42/runs?per_page=100&page=1') {
        const records = options.runs ?? [];
        const minimum = Math.min(
          10,
          ...records.map((run) => Number((run as { run_number?: number })?.run_number ?? 10)),
        );
        const predecessor = policyRun({
          id: 1,
          run_number: minimum - 1,
          created_at: '2026-11-01T11:59:59Z',
          pull_requests: [{ number: 128 }],
          display_title: 'PR policy v1 pr=128 action=opened',
        });
        const rows =
          options.rawRuns ??
          [...records, predecessor].sort(
            (a, b) =>
              Number((b as { run_number: number }).run_number) -
              Number((a as { run_number: number }).run_number),
          );
        return { total_count: rows.length, workflow_runs: rows };
      }
      if (path === 'actions/runs/100') return options.codeRun ?? ciRun();
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
  return readFullValidationRequirement(client, state, now);
}

const codeEvent = () => ({
  number: 129,
  repository: { full_name: repository },
  action: 'synchronize',
  pull_request: rawPr(),
});
const codePlan = (full = false) =>
  coveragePlan(
    'pull_request',
    codeEvent(),
    ['docs/todo/SPN-129.md'],
    'c'.repeat(40),
    full ? 'Persistent edit requires full validation.' : undefined,
  );
async function guard(
  client: PrReader,
  plan: CoveragePlan = codePlan(),
  overrides: {
    raw?: string;
    digest?: string;
    tested?: string;
    classification?: string;
    runId?: string | number;
    now?: () => number;
  } = {},
) {
  const raw = overrides.raw ?? JSON.stringify(plan);
  return guardCurrentCode(
    client,
    codeEvent(),
    raw,
    overrides.digest ?? createHash('sha256').update(raw).digest('hex'),
    overrides.tested ?? 'c'.repeat(40),
    overrides.classification ?? 'success',
    overrides.runId ?? 100,
    overrides.now ?? now,
  );
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
    { event: 'automatic_base_change_succeeded' },
    { event: 'labeled', label: { name: 'ci-revalidate' } },
    { event: 'unlabeled', label: { name: 'ci-revalidate' } },
  ]) {
    const { client, calls } = fixture({
      timeline: [{ id: 1, created_at: createdAt, ...entry }],
    });
    const state = await currentPullRequest(client, 129);
    assert.deepEqual(state.labels, []);
    const result = await readFullValidationRequirement(client, state, now);
    assert.equal(result.state, 'full');
    assert.equal(result.after, Date.parse(createdAt));
    assert.equal(calls.includes('actions/workflows/pr-policy.yml'), true);
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
      (await readFullValidationRequirement(client, await currentPullRequest(client, 129), now))
        .state,
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
        runs: [policyRun({ status: 'in_progress', conclusion: null })],
        jobs: [
          classifier({
            status: 'in_progress',
            conclusion: null,
            steps: [
              { name: 'Edit classification: text', status: 'pending', conclusion: null },
              { name: 'Edit classification: full', status: 'pending', conclusion: null },
            ],
          }),
        ],
      })
    ).state,
    'pending',
  );
  assert.equal(
    (
      await requirement({
        runs: [policyRun({ status: 'in_progress', conclusion: null })],
        jobs: [
          classifier({
            status: 'in_progress',
            conclusion: null,
            steps: [
              { name: 'Edit classification: text', status: 'completed', conclusion: 'success' },
              { name: 'Edit classification: full', status: 'pending', conclusion: null },
            ],
          }),
        ],
      })
    ).state,
    'clear',
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

test('immutable text proof survives pending and failed classifier retries without passing code', async () => {
  const runs = [policyRun({ run_attempt: 2 })];
  assert.equal((await requirement({ runs, jobs: [classifier()] })).state, 'clear');
  for (const retry of [
    classifier({ id: 51, run_attempt: 2 }),
    classifier({ id: 51, run_attempt: 2, status: 'in_progress', conclusion: null, steps: [] }),
    ...['failure', 'cancelled', 'timed_out'].map((conclusion) =>
      classifier({
        id: 51,
        run_attempt: 2,
        status: 'completed',
        conclusion,
        steps: [{ name: 'Edit classification: text', status: 'completed', conclusion }],
      }),
    ),
  ]) {
    // A retry has the same original payload; it cannot manufacture a new edit.
    for (const jobs of [
      [classifier(), retry],
      [retry, classifier()],
    ]) {
      const result = await requirement({ runs, jobs });
      assert.equal(result.state, 'clear');
      assert.equal(result.pending, false);
      assert.equal(result.after, null);
    }
  }
});

test('failed classification without prior proof cannot establish a text edit', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const result = await requirement({
      runs: [policyRun()],
      jobs: [
        classifier({
          status: 'completed',
          conclusion,
          steps: [{ name: 'Edit classification: text', status: 'completed', conclusion }],
        }),
      ],
    });
    assert.equal(result.state, 'full');
    assert.equal(result.after, Date.parse(createdAt));
  }
});

test('conflicting successful proofs cannot establish a trustworthy history boundary', async () => {
  for (const fullAttempt of [1, 2]) {
    const jobs = [1, 2].map((run_attempt) =>
      classifier({
        id: 50 + run_attempt,
        run_attempt,
        steps: [
          {
            name:
              run_attempt === fullAttempt
                ? 'Edit classification: full'
                : 'Edit classification: text',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      }),
    );
    const result = await requirement({ runs: [policyRun({ run_attempt: 2 })], jobs });
    assert.equal(result.state, 'full');
    assert.equal(result.pending, false);
    assert.equal(result.after, null);
    assert.match(result.reason, /conflicting successful classification proofs/);
  }
});

test('malformed evidence cannot downgrade conflicting proofs to timestamped full validation', async () => {
  for (const malformedAttempt of [1, 2, 3]) {
    for (const malformed of [
      { steps: [null] },
      { steps: [{ name: 'Edit classification: text', status: 'missing', conclusion: null }] },
      { head_sha: 'd'.repeat(40) },
      { id: 50 },
    ]) {
      const otherAttempts = [1, 2, 3].filter((attempt) => attempt !== malformedAttempt);
      const jobs = [
        classifier({ id: 50, run_attempt: otherAttempts[0] }),
        classifier({
          id: 51,
          run_attempt: otherAttempts[1],
          steps: [
            { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
          ],
        }),
        classifier({ id: 52, run_attempt: malformedAttempt, ...malformed }),
      ];
      const history = { runs: [policyRun({ run_attempt: 3 })], jobs };
      const result = await requirement(history);
      assert.equal(result.state, 'full');
      assert.equal(result.after, null);
      await assert.rejects(
        guard(fixture(history).client, codePlan(true)),
        /Unable to establish full-validation freshness/,
      );
    }
  }
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
  for (const latest of [
    classifier({ id: 51, run_attempt: 2, status: 'in_progress', conclusion: null, steps: [] }),
    classifier({ id: 51, run_attempt: 2, status: 'completed', conclusion: 'failure', steps: [] }),
    classifier({
      id: 51,
      run_attempt: 2,
      status: 'in_progress',
      conclusion: null,
      steps: [
        { name: 'Edit classification: text', status: 'pending', conclusion: null },
        { name: 'Edit classification: full', status: 'pending', conclusion: null },
      ],
    }),
    classifier({ id: 51, run_attempt: 2 }),
  ]) {
    assert.equal(
      (
        await requirement({
          runs: [policyRun({ run_attempt: 2, status: 'in_progress', conclusion: null })],
          jobs: [
            classifier({
              steps: [
                { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
              ],
            }),
            latest,
          ],
        })
      ).state,
      'full',
    );
  }
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
  const runsPath = 'actions/workflows/42/runs?per_page=100&page=1';
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
    (await readFullValidationRequirement(client, { ...state, createdAt: 'invalid' }, now)).state,
    'full',
  );
});

test('age alone never replaces complete surviving history with a moving validation deadline', async () => {
  const { client, calls } = fixture({ runs: [policyRun()], jobs: [classifier()] });
  const state = await currentPullRequest(client, 129);
  const deadline = Date.parse(createdAt) + 24 * 60 * 60_000;
  for (const currentTime of [
    deadline - 1,
    deadline,
    deadline + 1,
    deadline + 7 * 24 * 60 * 60_000,
  ]) {
    const result = await readFullValidationRequirement(client, state, () => currentTime);
    assert.equal(result.state, 'clear');
    assert.equal(result.after, null);
    assert.equal(result.checkpoint?.full, false);
  }
  assert.ok(calls.includes('actions/workflows/42/runs?per_page=100&page=1'));
  const missing = fixture({ rawRuns: [] });
  const result = await readFullValidationRequirement(missing.client, state, () => deadline + 1);
  assert.equal(result.state, 'full');
  assert.equal(result.after, null);
  assert.equal(result.checkpoint, undefined);
});

test('same-source targeted retries fail when a persistent full obligation appeared after their plan', async () => {
  const obligations: Parameters<typeof fixture>[0][] = [
    { timeline: [{ id: 1, created_at: createdAt, event: 'automatic_base_change_succeeded' }] },
    {
      timeline: [
        { id: 1, created_at: createdAt, event: 'unlabeled', label: { name: 'ci-revalidate' } },
      ],
    },
    {
      runs: [policyRun()],
      jobs: [
        classifier({
          steps: [
            { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
          ],
        }),
      ],
    },
  ];
  for (const options of obligations) {
    const { client } = fixture(options);
    await assert.rejects(guard(client), /history requires full coverage/);
  }
});

test('clear or pending text history preserves targeted code while policy owns pending classification', async () => {
  const clear = fixture({ runs: [policyRun()], jobs: [classifier()] });
  assert.equal((await guard(clear.client)).state, 'clear');
  assert.equal(clear.calls.filter((path) => path === 'pulls/129').length, 2);
  const pending = fixture({
    runs: [policyRun({ status: 'in_progress', conclusion: null })],
    jobs: [
      classifier({
        status: 'in_progress',
        conclusion: null,
        steps: [
          { name: 'Edit classification: text', status: 'pending', conclusion: null },
          { name: 'Edit classification: full', status: 'pending', conclusion: null },
        ],
      }),
    ],
  });
  const result = await guard(pending.client);
  assert.equal(result.state, 'pending');
  assert.match(result.reason, /required PR policy remains pending/);
  assert.equal(pending.calls.filter((path) => path === 'pulls/129').length, 2);
});

test('a full plan still checks history freshness and must select every suite', async () => {
  const { client, calls } = fixture({
    timeline: [{ id: 1, created_at: createdAt, event: 'base_ref_changed' }],
  });
  assert.equal((await guard(client, codePlan(true))).state, 'full');
  assert.ok(calls.includes('issues/129/timeline'));
  assert.ok(calls.includes('actions/runs/100'));
  assert.equal(calls.filter((path) => path === 'pulls/129').length, 2);
  const incomplete = codePlan(true);
  incomplete.suites['phone-compatibility'].selected = false;
  await assert.rejects(guard(client, incomplete), /full coverage plan must select every suite/);
  await assert.rejects(
    guard(fixture({ failAt: 'issues/129/timeline' }).client, codePlan(true)),
    /Unable to establish full-validation freshness/,
  );
});

test('code guards bind plan digest, classifier success and immutable event source before allowing full coverage', async () => {
  for (const overrides of [
    { digest: '0'.repeat(64) },
    { raw: '{}' },
    { classification: 'cancelled' },
    { tested: 'd'.repeat(40) },
  ]) {
    await assert.rejects(guard(fixture().client, codePlan(true), overrides), /Coverage plan/);
  }
  for (const change of [
    { event: 'push' },
    { base: 'd'.repeat(40) },
    { head: 'd'.repeat(40) },
    { tested: null },
  ]) {
    await assert.rejects(
      guard(fixture().client, { ...codePlan(true), ...change }),
      /immutable PR event/,
    );
  }
  const malformed = codePlan(true);
  malformed.suites.lint.reason = '';
  await assert.rejects(guard(fixture().client, malformed), /Malformed coverage decision/);
  for (const change of [
    { id: 101 },
    { path: '.github/workflows/pr-policy.yml' },
    { event: 'workflow_dispatch' },
    { head_sha: 'd'.repeat(40) },
    { repository: { full_name: 'another/repo' } },
    { created_at: null },
  ]) {
    await assert.rejects(
      guard(fixture({ codeRun: ciRun(change) }).client, codePlan(true)),
      /workflow run identity or creation time/,
    );
  }
});

test('code guards re-read the live PR and reject a source change before completing', async () => {
  for (const plan of [codePlan(), codePlan(true)]) {
    const { client } = fixture();
    const read = client.get.bind(client);
    let reads = 0;
    client.get = async (path) => {
      if (path === 'pulls/129' && ++reads === 2) {
        const changed = rawPr();
        changed.base.sha = 'd'.repeat(40);
        return changed;
      }
      return read(path);
    };
    await assert.rejects(guard(client, plan), /source or base changed/);
    assert.equal(reads, 2);
  }
});

test('an ambiguous request requires a genuinely new full run even when source and base are unchanged', async () => {
  const requestedAt = '2026-11-01T12:00:20Z';
  const history = {
    runs: [policyRun({ created_at: requestedAt })],
    jobs: [
      classifier({
        steps: [{ name: 'Edit classification: full', status: 'completed', conclusion: 'success' }],
      }),
    ],
  };
  for (const codeRun of [
    ciRun(),
    ciRun({ run_attempt: 2, run_started_at: '2026-11-01T12:00:30Z' }),
    ciRun({ created_at: requestedAt }),
  ]) {
    await assert.rejects(
      guard(fixture({ ...history, codeRun }).client, codePlan(true)),
      /new CI run created strictly after/,
    );
  }
  const fresh = fixture({ ...history, codeRun: ciRun({ created_at: '2026-11-01T12:00:21Z' }) });
  const result = await guard(fresh.client, codePlan(true));
  assert.equal(result.state, 'full');
  assert.equal(result.after, Date.parse(requestedAt));
  assert.equal(result.pending, false);
  const withPending = {
    runs: [
      ...history.runs,
      policyRun({ id: 11, created_at: '2026-11-01T12:00:30Z', status: 'queued', conclusion: null }),
    ],
    jobsByRun: { 10: history.jobs, 11: [] },
  };
  await assert.rejects(
    guard(fixture(withPending).client, codePlan(true)),
    /new CI run created strictly after/,
  );
  const coveredPending = await guard(
    fixture({ ...withPending, codeRun: ciRun({ created_at: '2026-11-01T12:00:21Z' }) }).client,
    codePlan(true),
  );
  assert.equal(coveredPending.state, 'full');
  assert.equal(coveredPending.after, Date.parse(requestedAt));
  assert.equal(coveredPending.pending, true);
});

test('every later full request advances the barrier across timeline and policy records in either order', async () => {
  const timeline = [
    { id: 1, event: 'base_ref_changed', created_at: '2026-11-01T12:00:10Z' },
    {
      id: 2,
      event: 'labeled',
      label: { name: 'ci-revalidate' },
      created_at: '2026-11-01T12:00:20Z',
    },
    { id: 3, event: 'automatic_base_change_succeeded', created_at: '2026-11-01T12:00:30Z' },
    {
      id: 4,
      event: 'unlabeled',
      label: { name: 'ci-revalidate' },
      created_at: '2026-11-01T12:00:40Z',
    },
  ];
  const runs = [
    policyRun({ created_at: '2026-11-01T12:00:15Z' }),
    policyRun({ id: 11, created_at: '2026-11-01T12:00:50Z' }),
  ];
  const jobsByRun = Object.fromEntries(
    runs.map((run, index) => [
      run.id,
      [
        classifier({
          id: 50 + index,
          run_id: run.id,
          name: `Classify PR edit (${run.id})`,
          steps: [
            { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
          ],
        }),
      ],
    ]),
  );
  for (const reverse of [false, true]) {
    const result = await requirement({
      pr: { ...rawPr(), labels: [{ name: 'ci-revalidate' }] },
      timeline: reverse ? [...timeline].reverse() : timeline,
      runs: reverse ? [...runs].reverse() : runs,
      jobsByRun,
    });
    assert.equal(result.after, Date.parse('2026-11-01T12:00:50Z'));
    assert.equal(result.pending, false);
  }
  const laterBase = await requirement({
    timeline: [
      ...timeline,
      { id: 5, event: 'automatic_base_change_succeeded', created_at: '2026-11-01T12:00:55Z' },
    ],
    runs,
    jobsByRun,
  });
  assert.equal(laterBase.after, Date.parse('2026-11-01T12:00:55Z'));
});

test('older complete history still scans later full requests and preserves a pending classifier', async () => {
  const recentRequest = '2026-11-02T12:00:20Z';
  const { client } = fixture({
    runs: [
      policyRun({ created_at: recentRequest }),
      policyRun({
        id: 11,
        created_at: '2026-11-02T12:00:30Z',
        status: 'in_progress',
        conclusion: null,
      }),
    ],
    jobsByRun: {
      10: [
        classifier({
          steps: [
            { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
          ],
        }),
      ],
      11: [],
    },
  });
  const state = await currentPullRequest(client, 129);
  const result = await readFullValidationRequirement(client, state, () =>
    Date.parse('2026-11-03T12:00:00Z'),
  );
  assert.equal(result.state, 'full');
  assert.equal(result.after, Date.parse(recentRequest));
  assert.equal(result.pending, true);
});

test('known creation times bound legacy or failed classification conservatively without blocking fresh full runs forever', async () => {
  const requestedAt = '2026-11-01T12:00:20Z';
  const histories: Parameters<typeof fixture>[0][] = [
    { runs: [policyRun({ created_at: requestedAt, display_title: 'PR policy' })] },
    { runs: [policyRun({ created_at: requestedAt, pull_requests: [] })] },
    { runs: [policyRun({ created_at: requestedAt })], jobs: [] },
    {
      runs: [policyRun({ created_at: requestedAt })],
      jobs: [classifier({ conclusion: 'failure', steps: [] })],
    },
  ];
  for (const history of histories) {
    const result = await guard(
      fixture({ ...history, codeRun: ciRun({ created_at: '2026-11-01T12:00:21Z' }) }).client,
      codePlan(true),
    );
    assert.equal(result.state, 'full');
    assert.equal(result.after, Date.parse(requestedAt));
  }
  for (const history of [
    { runs: [policyRun({ created_at: null })] },
    { failAt: 'actions/workflows/pr-policy.yml' },
    { pr: { ...rawPr(), labels: [{ name: 'ci-revalidate' }] } },
  ]) {
    assert.equal((await requirement(history)).after, null);
    await assert.rejects(
      guard(fixture(history).client, codePlan(true)),
      /Unable to establish full-validation freshness/,
    );
  }
});

test('trusted router notifications allow equal creation time only after a separately established request', async () => {
  const routerAppId = 123;
  const timeline = [
    { id: 1, event: 'base_ref_changed', created_at: '2026-11-01T12:00:10Z' },
    {
      id: 2,
      event: 'labeled',
      label: { name: 'ci-revalidate' },
      created_at: '2026-11-01T12:00:20Z',
      performed_via_github_app: { id: routerAppId },
    },
    {
      id: 3,
      event: 'unlabeled',
      label: { name: 'ci-revalidate' },
      created_at: '2026-11-01T12:00:40Z',
    },
    {
      id: 4,
      event: 'labeled',
      label: { name: 'ci-revalidate' },
      created_at: '2026-11-01T12:00:40Z',
      performed_via_github_app: { id: routerAppId },
    },
  ];
  for (const entries of [timeline, [...timeline].reverse()]) {
    const result = await guard(
      fixture({
        routerAppId,
        timeline: entries,
        codeRun: ciRun({ created_at: '2026-11-01T12:00:40Z' }),
      }).client,
      codePlan(true),
    );
    assert.equal(result.after, Date.parse('2026-11-01T12:00:10Z'));
    assert.equal(result.atOrAfter, Date.parse('2026-11-01T12:00:40Z'));
  }
  await assert.rejects(
    guard(
      fixture({ routerAppId, timeline, codeRun: ciRun({ created_at: '2026-11-01T12:00:39Z' }) })
        .client,
      codePlan(true),
    ),
    /at or after the latest trusted router notification/,
  );
  const notificationOnly = fixture({
    routerAppId,
    timeline: [timeline[1]],
    codeRun: ciRun({ created_at: '2026-11-01T12:00:20Z' }),
  });
  await assert.rejects(
    guard(notificationOnly.client, codePlan(true)),
    /Unable to establish full-validation freshness/,
  );
});

test('manual, missing and foreign App label evidence keeps strict same-second freshness', async () => {
  for (const evidence of [
    { routerAppId: 123, performed_via_github_app: undefined },
    { routerAppId: 123, performed_via_github_app: null },
    { routerAppId: 123, performed_via_github_app: { id: 999 } },
    { routerAppId: 123, performed_via_github_app: { id: '123' } },
    { routerAppId: undefined, performed_via_github_app: { id: 123 } },
  ]) {
    const history = {
      routerAppId: evidence.routerAppId,
      timeline: [
        { id: 1, event: 'base_ref_changed', created_at: '2026-11-01T12:00:10Z' },
        {
          id: 2,
          event: 'labeled',
          label: { name: 'ci-revalidate' },
          created_at: '2026-11-01T12:00:20Z',
          performed_via_github_app: evidence.performed_via_github_app,
        },
      ],
    };
    const result = await requirement(history);
    assert.equal(result.after, Date.parse('2026-11-01T12:00:20Z'));
    assert.equal(result.atOrAfter, null);
    await assert.rejects(
      guard(
        fixture({ ...history, codeRun: ciRun({ created_at: '2026-11-01T12:00:20Z' }) }).client,
        codePlan(true),
      ),
      /new CI run created strictly after/,
    );
  }
});

test('a trusted notification never relaxes an actual edit at the same time or a later strict request', async () => {
  for (const requestedAt of ['2026-11-01T12:00:20Z', '2026-11-01T12:00:30Z']) {
    const history = {
      routerAppId: 123,
      timeline: [
        { id: 1, event: 'base_ref_changed', created_at: '2026-11-01T12:00:10Z' },
        {
          id: 2,
          event: 'labeled',
          label: { name: 'ci-revalidate' },
          created_at: '2026-11-01T12:00:20Z',
          performed_via_github_app: { id: 123 },
        },
      ],
      runs: [policyRun({ created_at: requestedAt })],
      jobs: [
        classifier({
          steps: [
            { name: 'Edit classification: full', status: 'completed', conclusion: 'success' },
          ],
        }),
      ],
    };
    const result = await requirement(history);
    assert.equal(result.after, Date.parse(requestedAt));
    assert.equal(result.atOrAfter, Date.parse('2026-11-01T12:00:20Z'));
    await assert.rejects(
      guard(
        fixture({ ...history, codeRun: ciRun({ created_at: requestedAt }) }).client,
        codePlan(true),
      ),
      /new CI run created strictly after/,
    );
  }
});

test('reserved-label removal retains the original duty and uses its own time only without another request boundary', async () => {
  const removal = {
    id: 2,
    event: 'unlabeled',
    label: { name: 'ci-revalidate' },
    created_at: '2026-11-01T12:00:30Z',
  };
  const manual = {
    id: 1,
    event: 'labeled',
    label: { name: 'ci-revalidate' },
    created_at: '2026-11-01T12:00:10Z',
  };
  const retained = await guard(
    fixture({ timeline: [manual, removal], codeRun: ciRun({ created_at: '2026-11-01T12:00:30Z' }) })
      .client,
    codePlan(true),
  );
  assert.equal(retained.after, Date.parse('2026-11-01T12:00:10Z'));
  const fallback = await requirement({ timeline: [removal] });
  assert.equal(fallback.state, 'full');
  assert.equal(fallback.after, Date.parse(removal.created_at));
  assert.equal(fallback.atOrAfter, null);
  await assert.rejects(
    guard(
      fixture({ timeline: [removal], codeRun: ciRun({ created_at: removal.created_at }) }).client,
      codePlan(true),
    ),
    /new CI run created strictly after/,
  );
});
