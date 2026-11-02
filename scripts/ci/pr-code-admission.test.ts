import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admitCodeChecks, selectCodeRun } from './pr-code-admission.ts';
import { codeCheckNames, formatCodeRunName, type PullRequestIdentity } from './pr-identity.ts';

const identity: PullRequestIdentity = {
  number: 129,
  repository: 'owner/repo',
  headRepository: 'owner/repo',
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  tested: 'c'.repeat(40),
  baseRef: 'main',
  headRef: 'feature',
  title: 'A valid title',
  body: null,
  state: 'open',
};
const expected = { identity, workflowId: 42, requiredFull: false };
const runName = (overrides = {}) =>
  formatCodeRunName({ ...identity, tested: identity.tested!, full: false, ...overrides });
const workflowRun = (overrides: Record<string, unknown> = {}) => ({
  id: 100,
  workflow_id: 42,
  path: '.github/workflows/ci.yml',
  event: 'pull_request',
  head_sha: identity.head,
  repository: { full_name: identity.repository },
  pull_requests: [{ number: identity.number }],
  display_title: runName(),
  check_suite_id: 200,
  run_attempt: 1,
  created_at: '2026-11-01T12:00:00Z',
  run_started_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-01T12:01:00Z',
  status: 'in_progress',
  conclusion: null,
  ...overrides,
});
const admittedRun = (overrides: Record<string, unknown> = {}) => {
  const result = selectCodeRun([workflowRun(overrides)], expected);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw new Error('Expected admitted CI run.');
  return result.run;
};
const evidence = () => ({
  jobs: codeCheckNames.map((name, index) => ({
    id: 300 + index,
    name,
    run_id: 100,
    run_attempt: 1,
    head_sha: identity.head,
    check_run_url: `https://api.github.com/repos/owner/repo/check-runs/${400 + index}`,
    status: 'in_progress',
    conclusion: null as string | null,
  })),
  checks: codeCheckNames.map((name, index) => ({
    id: 400 + index,
    name,
    check_suite: { id: 200 },
    app: { id: 15368 },
    head_sha: identity.head,
    status: 'in_progress',
    conclusion: null as string | null,
  })),
});

test('latest CI identity is selected independently of input order and cannot fall back to an old pass', () => {
  const old = workflowRun({ status: 'completed', conclusion: 'success' });
  const newer = workflowRun({
    id: 101,
    created_at: '2026-11-01T12:02:00Z',
    run_started_at: '2026-11-01T12:02:00Z',
    updated_at: '2026-11-01T12:02:00Z',
    display_title: runName({ base: 'd'.repeat(40) }),
  });
  for (const runs of [
    [old, newer],
    [newer, old],
  ])
    assert.equal(selectCodeRun(runs, expected).status, 'invalid');
  newer.display_title = 'missing immutable name';
  assert.equal(selectCodeRun([old, newer], expected).status, 'invalid');
  for (const pull_requests of [[], [{ number: 130 }]])
    assert.equal(
      selectCodeRun([old, { ...newer, display_title: runName(), pull_requests }], expected).status,
      'invalid',
    );
  assert.equal(selectCodeRun([old, { ...newer, pull_requests: [] }], expected).status, 'invalid');
});

test('a fresh attempt of an old-base run cannot borrow a newer run identity', () => {
  const oldRerun = workflowRun({
    run_attempt: 2,
    run_started_at: '2026-11-01T12:05:00Z',
    updated_at: '2026-11-01T12:05:00Z',
    display_title: runName({ base: 'd'.repeat(40) }),
  });
  const current = workflowRun({
    id: 101,
    created_at: '2026-11-01T12:02:00Z',
    run_started_at: '2026-11-01T12:02:00Z',
    updated_at: '2026-11-01T12:04:00Z',
  });
  assert.equal(selectCodeRun([current, oldRerun], expected).status, 'invalid');
});

test('full coverage is established by actual selection rather than an event-name flag', () => {
  assert.equal(
    selectCodeRun([workflowRun()], {
      ...expected,
      requiredFull: true,
      fullAfter: Date.parse('2026-11-01T11:59:59Z'),
    }).status,
    'ready',
  );
  assert.equal(
    selectCodeRun([workflowRun({ display_title: runName({ full: true }) })], {
      ...expected,
      requiredFull: true,
      fullAfter: Date.parse('2026-11-01T11:59:59Z'),
    }).status,
    'ready',
  );
  const { jobs, checks } = evidence();
  const classifier = {
    id: 299,
    name: 'Classify changes (100)',
    run_id: 100,
    run_attempt: 1,
    head_sha: identity.head,
    status: 'completed',
    conclusion: 'success',
    steps: [{ name: 'Coverage selected: targeted', status: 'completed', conclusion: 'success' }],
  };
  assert.equal(
    admitCodeChecks(admittedRun(), [...jobs, classifier], checks, true).status,
    'invalid',
  );
  classifier.steps[0].name = 'Coverage selected: full';
  assert.equal(admitCodeChecks(admittedRun(), [...jobs, classifier], checks, true).status, 'ready');
  classifier.steps[0].conclusion = 'skipped';
  assert.equal(
    admitCodeChecks(admittedRun(), [...jobs, classifier], checks, true).status,
    'invalid',
  );
  assert.equal(admitCodeChecks(admittedRun(), jobs, checks, true).status, 'pending');
});

test('all-attempt evidence selects the latest real gate and cannot revive an earlier pass', () => {
  const { jobs, checks } = evidence();
  const retry = admittedRun({
    run_attempt: 2,
    run_started_at: '2026-11-01T12:02:00Z',
    updated_at: '2026-11-01T12:02:00Z',
  });
  for (const item of [...jobs, ...checks])
    Object.assign(item, { status: 'completed', conclusion: 'success' });
  const failed = {
    ...jobs[0],
    id: 399,
    run_attempt: 2,
    conclusion: 'failure',
    check_run_url: 'https://api.github.com/repos/owner/repo/check-runs/499',
  };
  Object.assign(checks[0], { id: 499, conclusion: 'failure' });
  assert.equal(admitCodeChecks(retry, [...jobs, failed], checks).status, 'ready');
  assert.equal(checks[0].conclusion, 'failure');
  assert.equal(
    admitCodeChecks(retry, [...jobs, failed, { ...failed, id: 398 }], checks).status,
    'invalid',
  );
  const classifier = {
    id: 299,
    name: 'Classify changes (100)',
    run_id: 100,
    run_attempt: 1,
    head_sha: identity.head,
    status: 'completed',
    conclusion: 'success',
    steps: [{ name: 'Coverage selected: full', status: 'completed', conclusion: 'success' }],
  };
  assert.equal(admitCodeChecks(retry, [...jobs, failed, classifier], checks, true).status, 'ready');
  assert.equal(
    admitCodeChecks(
      retry,
      [
        ...jobs,
        failed,
        classifier,
        { ...classifier, id: 298, run_attempt: 2, conclusion: 'failure' },
      ],
      checks,
      true,
    ).status,
    'invalid',
  );
});

test('full requests require a genuinely new eligible run, not a newer attempt of prior full work', () => {
  const freshness = {
    ...expected,
    requiredFull: true,
    fullAfter: Date.parse('2026-11-01T12:01:00Z'),
  };
  const old = workflowRun({
    display_title: runName({ full: true }),
    status: 'completed',
    conclusion: 'success',
  });
  assert.equal(selectCodeRun([old], freshness).status, 'invalid');
  const retried = {
    ...old,
    run_attempt: 2,
    run_started_at: '2026-11-01T12:02:00Z',
    updated_at: '2026-11-01T12:02:00Z',
  };
  assert.equal(selectCodeRun([retried], freshness).status, 'invalid');
  const fresh = { ...retried, id: 101, run_attempt: 1, created_at: '2026-11-01T12:02:00Z' };
  assert.equal(selectCodeRun([old, fresh], freshness).status, 'ready');
  assert.equal(
    selectCodeRun([fresh], { ...freshness, fullAfter: Date.parse(fresh.created_at) }).status,
    'invalid',
  );
  assert.equal(selectCodeRun([fresh], { ...freshness, fullAfter: null }).status, 'invalid');
});

test('matching run identity binds PR, tested merge, head, and immutable base', () => {
  for (const mismatch of [
    { number: 130 },
    { base: 'd'.repeat(40) },
    { head: 'd'.repeat(40) },
    { tested: 'd'.repeat(40) },
  ])
    assert.equal(
      selectCodeRun([workflowRun({ display_title: runName(mismatch) })], expected).status,
      'invalid',
    );
});

test('foreign or malformed scoped responses do not silently disappear during selection', () => {
  for (const mismatch of [
    { repository: { full_name: 'another/repository' } },
    { workflow_id: 43 },
    { path: '.github/workflows/ci.yml@untrusted' },
    { event: 'workflow_dispatch' },
    { head_sha: 'd'.repeat(40) },
    { run_attempt: 0 },
    { run_attempt: 1.5 },
    { created_at: '2026-02-30T12:00:00Z' },
    { run_started_at: '2026-11-01T11:59:59Z' },
    { updated_at: '2026-11-01T11:59:59Z' },
    { run_started_at: null },
    { pull_requests: [null] },
  ])
    assert.equal(selectCodeRun([workflowRun(mismatch)], expected).status, 'invalid');
  assert.equal(selectCodeRun([workflowRun(), workflowRun()], expected).status, 'invalid');
  assert.equal(selectCodeRun({}, expected).status, 'invalid');
});

test('missing run or test merge remains pending; another PR on the same head supplies no evidence', () => {
  assert.equal(selectCodeRun([], expected).status, 'pending');
  assert.equal(
    selectCodeRun(
      [workflowRun({ pull_requests: [{ number: 130 }], display_title: runName({ number: 130 }) })],
      expected,
    ).status,
    'pending',
  );
  assert.equal(
    selectCodeRun([workflowRun()], { ...expected, identity: { ...identity, tested: null } }).status,
    'pending',
  );
});

test('genuine queued, pending, failed and successful code gates retain their existing outcomes', () => {
  for (const status of ['queued', 'in_progress', 'completed']) {
    const conclusions =
      status === 'completed'
        ? ['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']
        : [null];
    for (const conclusion of conclusions) {
      const { jobs, checks } = evidence();
      for (const item of [...jobs, ...checks]) Object.assign(item, { status, conclusion });
      assert.deepEqual(admitCodeChecks(admittedRun(), jobs, checks), { status: 'ready' });
    }
  }
});

test('missing required gates are pending only while the selected run remains pending', () => {
  const { jobs, checks } = evidence();
  assert.equal(admitCodeChecks(admittedRun(), jobs.slice(1), checks).status, 'pending');
  assert.equal(admitCodeChecks(admittedRun(), jobs, checks.slice(1)).status, 'pending');
  assert.equal(
    admitCodeChecks(
      admittedRun({ status: 'completed', conclusion: 'failure' }),
      jobs,
      checks.slice(1),
    ).status,
    'invalid',
  );
});

test('future attempts, another suite, another source, and foreign apps cannot supply the six gates', () => {
  const corruptions = [
    ({ jobs }: ReturnType<typeof evidence>) => {
      jobs[0].run_attempt = 2;
    },
    ({ jobs }: ReturnType<typeof evidence>) => {
      jobs[0].run_id = 101;
    },
    ({ jobs }: ReturnType<typeof evidence>) => {
      jobs[0].head_sha = 'd'.repeat(40);
    },
    ({ jobs }: ReturnType<typeof evidence>) => {
      jobs[0].check_run_url += '?different';
    },
    ({ checks }: ReturnType<typeof evidence>) => {
      checks[0].check_suite.id = 201;
    },
    ({ checks }: ReturnType<typeof evidence>) => {
      checks[0].app.id = 1;
    },
    ({ checks }: ReturnType<typeof evidence>) => {
      checks[0].head_sha = 'd'.repeat(40);
    },
  ];
  for (const corrupt of corruptions) {
    const current = evidence();
    corrupt(current);
    assert.equal(admitCodeChecks(admittedRun(), current.jobs, current.checks).status, 'invalid');
  }
});

test('failed-job retries retain actual earlier successes in the same run and suite only', () => {
  const { jobs, checks } = evidence();
  for (const item of [...jobs, ...checks]) {
    item.status = 'completed';
    item.conclusion = 'success';
  }
  jobs[0].run_attempt = 2;
  jobs[0].status = 'in_progress';
  jobs[0].conclusion = null;
  checks[0].status = 'in_progress';
  checks[0].conclusion = null;
  const retry = admittedRun({
    run_attempt: 2,
    run_started_at: '2026-11-01T12:02:00Z',
    updated_at: '2026-11-01T12:02:00Z',
  });
  assert.deepEqual(admitCodeChecks(retry, jobs, checks), { status: 'ready' });
  jobs[1].conclusion = checks[1].conclusion = 'failure';
  assert.equal(admitCodeChecks(retry, jobs, checks).status, 'pending');
  assert.equal(admitCodeChecks({ ...retry, status: 'completed' }, jobs, checks).status, 'invalid');
});

test('duplicate gate names and reused identities fail even when all six names are present', () => {
  const { jobs, checks } = evidence();
  assert.equal(admitCodeChecks(admittedRun(), [...jobs, jobs[0]], checks).status, 'invalid');
  assert.equal(admitCodeChecks(admittedRun(), jobs, [...checks, checks[0]]).status, 'invalid');
  jobs[1].id = jobs[0].id;
  assert.equal(admitCodeChecks(admittedRun(), jobs, checks).status, 'invalid');
});

test('skipped, neutral and malformed conclusions never become genuine code admission', () => {
  for (const conclusion of ['skipped', 'neutral', 'unknown', null]) {
    for (const side of ['jobs', 'checks'] as const) {
      const data = evidence();
      Object.assign(data[side][0], { status: 'completed', conclusion });
      assert.equal(admitCodeChecks(admittedRun(), data.jobs, data.checks).status, 'invalid');
    }
  }
  assert.equal(admitCodeChecks(admittedRun(), null, []).status, 'invalid');
  assert.equal(admitCodeChecks(admittedRun(), [null], []).status, 'invalid');
});

test('non-atomic API snapshots stay pending while code status reconciles', () => {
  const { jobs, checks } = evidence();
  jobs[0].status = 'completed';
  jobs[0].conclusion = 'failure';
  assert.equal(admitCodeChecks(admittedRun(), jobs, checks).status, 'pending');
  checks[0].status = 'completed';
  checks[0].conclusion = 'failure';
  assert.equal(admitCodeChecks(admittedRun(), jobs, checks).status, 'ready');
});

test('missing or reconciling gates cannot hide malformed evidence elsewhere in the suite', () => {
  const { jobs, checks } = evidence();
  checks[5].app.id = 1;
  assert.equal(admitCodeChecks(admittedRun(), jobs.slice(1), checks).status, 'invalid');
  jobs[0].status = 'completed';
  jobs[0].conclusion = 'success';
  assert.equal(admitCodeChecks(admittedRun(), jobs, checks).status, 'invalid');
});
