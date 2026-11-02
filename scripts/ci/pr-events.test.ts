import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeCheckNames, formatCodeRunName } from './pr-identity.ts';
import type { PullRequestIdentity } from './pr-identity.ts';
import { capturePrHistory, prepareLegacyAdoption, validatePrPolicy } from './pr-policy.ts';
import {
  adoptionMarker,
  adoptionValidationStep,
  legacyHistoryCutoff,
  noAdoptionStep,
} from './pr-history-adoption.ts';
import {
  historyCheckpointMarker,
  historyValidationStep,
  parseHistoryCheckpointMarker,
} from './pr-history.ts';
import { routePrEdit } from './pr-revalidate.ts';
import { PrGitHub } from './pr-github.ts';

function scenario(historyV2 = false, repository = 'owner/repo') {
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
    check_suite_id: 503,
    run_number: 2,
    workflow_id: 43,
    path: '.github/workflows/pr-policy.yml',
    event: 'pull_request',
    head_sha: head,
    repository: { full_name: repository },
    pull_requests: [{ number: 129 }],
    display_title: historyV2
      ? `PR policy v2 pr=129 action=edited base=${base} head=${head} tested=${tested}`
      : 'PR policy v1 pr=129 action=edited',
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
    async get(path: string): Promise<unknown> {
      if (path === 'actions/runs/500') return structuredClone(policyRun);
      if (path === 'pulls/129') {
        reads++;
        return structuredClone(pr);
      }
      if (path === 'actions/workflows/43/runs?per_page=100&page=1')
        return {
          total_count: 2,
          workflow_runs: [
            structuredClone(policyRun),
            {
              ...structuredClone(policyRun),
              id: 499,
              run_number: 1,
              created_at: '2026-11-01T11:59:59Z',
              pull_requests: [{ number: 128 }],
              display_title: 'PR policy v1 pr=128 action=opened',
            },
          ],
        };
      if (path === 'actions/workflows/ci.yml') return { id: 42, path: '.github/workflows/ci.yml' };
      if (path === 'actions/workflows/pr-policy.yml')
        return { id: 43, path: '.github/workflows/pr-policy.yml' };
      throw new Error(`Unexpected read ${path}`);
    },
    async list(path: string, key: string): Promise<unknown[]> {
      if (
        path === `actions/workflows/42/runs?event=pull_request&head_sha=${pr.head.sha}` &&
        key === 'workflow_runs'
      )
        return [structuredClone(run)];
      if (path === 'issues/129/timeline' && key === '') return structuredClone(timeline);
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
  const invocation = { id: 500, sequence: 2, attempt: 1, action: 'edited', base, head, tested };
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
    invocation,
    timeline,
    policyRun,
    policyClassifier,
    alignCodeWithCurrent,
    fullCoverage,
    reads: () => reads,
  };
}

function legacyScenario() {
  const s = scenario(true, legacyHistoryCutoff.repository);
  s.policyRun.workflow_id = legacyHistoryCutoff.workflowId;
  s.policyRun.run_number = s.invocation.sequence = 16;
  s.policyRun.created_at = '2026-11-02T19:31:00Z';
  s.policyRun.display_title = s.policyRun.display_title.replace('v2 ', 'v3 ');
  s.options.now = () => Date.parse('2026-11-02T19:33:00Z');
  s.run.run_started_at = s.run.updated_at = '2026-11-02T19:32:00Z';
  for (const job of s.jobs)
    job.check_run_url = job.check_run_url.replace('owner/repo', s.client.repository);
  const prior = {
    ...s.policyRun,
    id: 499,
    run_number: 15,
    created_at: '2026-11-02T19:30:30Z',
    display_title: s.policyRun.display_title
      .replace('v3 ', 'v2 ')
      .replace('action=edited', 'action=synchronize'),
  };
  const runs = [s.policyRun, prior];
  const job = {
    id: 504,
    run_id: 500,
    run_attempt: 1,
    head_sha: s.policyRun.head_sha,
    name: 'Pull request',
    status: 'in_progress',
    conclusion: null as string | null,
    check_run_url: `https://api.github.com/repos/${s.client.repository}/check-runs/505`,
    steps: [
      {
        number: 3,
        name: adoptionValidationStep,
        status: 'in_progress',
        conclusion: null as string | null,
        completed_at: null as string | null,
      },
      {
        number: 4,
        name: noAdoptionStep,
        status: 'queued',
        conclusion: null as string | null,
        completed_at: null as string | null,
      },
    ],
  };
  const records: Record<number, unknown[]> = { 500: [s.policyClassifier, job], 499: [] };
  const check = {
    id: 505,
    name: job.name,
    head_sha: job.head_sha,
    check_suite: { id: 503 },
    app: { id: 15368 },
    status: 'in_progress',
    conclusion: null as string | null,
    completed_at: null as string | null,
  };
  const policyChecks: Record<number, typeof check> = { 505: check };
  const workflowAttempts: Record<number, unknown> = {};
  const get = s.client.get.bind(s.client);
  const list = s.client.list.bind(s.client);
  s.client.get = async (path) => {
    const attempt = new RegExp(`^actions/runs/${s.policyRun.id}/attempts/([1-9][0-9]*)$`).exec(
      path,
    )?.[1];
    if (attempt && workflowAttempts[Number(attempt)])
      return structuredClone(workflowAttempts[Number(attempt)]);
    if (path === `actions/runs/${s.policyRun.id}`) return structuredClone(s.policyRun);
    if (path === 'actions/workflows/pr-policy.yml')
      return { id: legacyHistoryCutoff.workflowId, path: '.github/workflows/pr-policy.yml' };
    if (path === `actions/workflows/${legacyHistoryCutoff.workflowId}/runs?per_page=100&page=1`)
      return { total_count: runs.length, workflow_runs: structuredClone(runs) };
    const checkId = /^check-runs\/(\d+)$/.exec(path)?.[1];
    if (checkId && policyChecks[Number(checkId)])
      return structuredClone(policyChecks[Number(checkId)]);
    return get(path);
  };
  s.client.list = async (path, key) => {
    const match = /^actions\/runs\/(\d+)\/jobs\?filter=all$/.exec(path);
    if (match && records[Number(match[1])]) return structuredClone(records[Number(match[1])]);
    return list(path, key);
  };
  const issued = (marker = adoptionMarker(s.policyRun.run_number)) => {
    job.steps[0] = {
      number: 3,
      name: adoptionValidationStep,
      status: 'completed',
      conclusion: 'success',
      completed_at: '2026-11-02T19:31:01Z',
    };
    job.steps[1] = {
      number: 4,
      name: marker,
      status: 'completed',
      conclusion: 'success',
      completed_at: '2026-11-02T19:31:02Z',
    };
  };
  return { ...s, runs, prior, job, records, check, policyChecks, workflowAttempts, issued };
}

test('legacy adoption requires genuinely later full code and retains its original provider barrier on retry', async () => {
  const s = legacyScenario();
  const options = { ...s.options, invocation: s.invocation };
  const marker = await prepareLegacyAdoption(options);
  assert.equal(marker, adoptionMarker(16));
  await assert.rejects(capturePrHistory(options), /not sealed/);
  s.issued(marker!);
  const sealed = parseHistoryCheckpointMarker(await capturePrHistory(options));
  assert.ok(sealed?.adoption);
  assert.deepEqual(sealed.adoption, {
    cutoff: legacyHistoryCutoff.runId,
    run: 500,
    job: 504,
    attempt: 1,
    step: 4,
    completed: Date.parse('2026-11-02T19:31:02Z'),
  });
  assert.equal(sealed.full, true);
  assert.equal(sealed.after, sealed.adoption.completed);
  await assert.rejects(validatePrPolicy(options), /full|fresh|created/i);
  s.fullCoverage();
  s.run.created_at = '2026-11-02T19:31:02Z';
  await assert.rejects(validatePrPolicy(options), /full|fresh|created/i);
  s.run.created_at = '2026-11-02T19:31:03Z';
  assert.equal((await validatePrPolicy(options)).fullAfter, '2026-11-02T19:31:02.000Z');
  // A later failed/cancelled job cannot erase its already completed adoption.
  s.job.status = s.check.status = 'completed';
  s.job.conclusion = s.check.conclusion = 'cancelled';
  const later = structuredClone(s.job);
  later.id = 506;
  later.run_attempt = 2;
  later.status = 'in_progress';
  later.conclusion = null;
  later.check_run_url = later.check_run_url.replace('/505', '/507');
  s.policyChecks[507] = {
    ...structuredClone(s.check),
    id: 507,
    status: 'in_progress',
    conclusion: null,
  };
  later.steps = [
    {
      number: 3,
      name: adoptionValidationStep,
      status: 'in_progress',
      conclusion: null,
      completed_at: null,
    },
    { number: 4, name: noAdoptionStep, status: 'queued', conclusion: null, completed_at: null },
  ];
  s.records[500].push(later);
  s.policyRun.run_attempt = s.invocation.attempt = 2;
  assert.equal(await prepareLegacyAdoption(options), null);
  later.steps[0] = {
    ...later.steps[0],
    status: 'completed',
    conclusion: 'success',
    completed_at: '2026-11-02T19:32:01Z',
  };
  later.steps[1] = {
    ...later.steps[1],
    status: 'completed',
    conclusion: 'skipped',
    completed_at: '2026-11-02T19:32:02Z',
  };
  assert.deepEqual(
    parseHistoryCheckpointMarker(await capturePrHistory(options))?.adoption,
    sealed.adoption,
  );
  assert.equal((await validatePrPolicy(options)).fullAfter, '2026-11-02T19:31:02.000Z');
  assert.equal(s.run.conclusion, null);
  assert.deepEqual(s.mutations, []);
  s.timeline.push({ id: 44, event: 'base_ref_changed', created_at: '2026-11-02T19:32:20Z' });
  const laterRequirement = parseHistoryCheckpointMarker(await capturePrHistory(options));
  assert.deepEqual(laterRequirement?.adoption, sealed.adoption);
  assert.equal(laterRequirement?.after, Date.parse('2026-11-02T19:32:20Z'));
  await assert.rejects(validatePrPolicy(options), /full|fresh|created/i);
});

test('adoption never treats missing modern history or an unresolved earlier attempt as first adoption', async () => {
  for (const kind of [
    'gap',
    'prior-job-missing',
    'prior-step-missing',
    'prior-pending',
    'conflicting-classifier',
    'foreign-check',
    'late-pr',
    'future-request',
  ]) {
    const s = legacyScenario();
    if (kind === 'gap') s.runs.pop();
    if (kind.startsWith('prior-') || kind === 'foreign-check') {
      const old = structuredClone(s.job);
      old.run_attempt = 1;
      s.job.run_attempt = s.invocation.attempt = s.policyRun.run_attempt = 2;
      s.job.id = 506;
      s.job.check_run_url = s.job.check_run_url.replace('/505', '/507');
      s.policyChecks[507] = { ...structuredClone(s.check), id: 507 };
      if (kind !== 'prior-job-missing') s.records[500].push(old);
      if (kind === 'prior-step-missing') old.steps = [];
      if (kind === 'foreign-check') {
        old.steps[0] = { ...old.steps[0], status: 'completed', conclusion: 'failure' };
        old.steps[1] = { ...old.steps[1], status: 'completed', conclusion: 'skipped' };
        s.check.app.id = 1;
      }
    }
    if (kind === 'conflicting-classifier')
      s.policyClassifier.steps.push({
        name: 'Edit classification: full',
        status: 'completed',
        conclusion: 'success',
      });
    if (kind === 'late-pr') {
      s.pr.created_at = legacyHistoryCutoff.createdAt;
      s.event.pull_request.created_at = legacyHistoryCutoff.createdAt;
    }
    if (kind === 'future-request')
      s.timeline.push({ id: 45, event: 'base_ref_changed', created_at: '2026-11-02T19:34:00Z' });
    await assert.rejects(
      prepareLegacyAdoption({ ...s.options, invocation: s.invocation }),
      Error,
      kind,
    );
  }
});

test('provider-proved cancellation before runner assignment permits first adoption but missing execution evidence does not', async () => {
  for (const change of [
    'none',
    'assigned',
    'missing-runner',
    'missing-completion',
    'check-failure',
    'wrong-app',
  ]) {
    const s = legacyScenario();
    // Shape observed on provider job125505126821: started_at is populated even
    // though runner/group identity is explicitly zero and no steps executed.
    s.event.action = s.invocation.action = 'synchronize';
    s.policyRun.display_title = s.policyRun.display_title.replace(
      'action=edited',
      'action=synchronize',
    );
    s.policyClassifier.name = 'Classify PR edit (${{ github.run_id }})';
    s.policyClassifier.conclusion = 'skipped';
    s.policyClassifier.steps = [];
    Object.assign(s.job, {
      status: 'completed',
      conclusion: 'cancelled',
      runner_id: 0,
      runner_name: '',
      runner_group_id: 0,
      runner_group_name: '',
      started_at: '2026-11-02T19:31:00Z',
      completed_at: '2026-11-02T19:31:02Z',
      steps: [],
    });
    Object.assign(s.check, {
      status: 'completed',
      conclusion: 'cancelled',
      completed_at: '2026-11-02T19:31:02Z',
    });
    const current = {
      ...structuredClone(s.job),
      id: 509,
      run_attempt: 2,
      status: 'in_progress',
      conclusion: null,
      steps: [
        {
          number: 3,
          name: adoptionValidationStep,
          status: 'in_progress',
          conclusion: null,
          completed_at: null,
        },
        { number: 4, name: noAdoptionStep, status: 'queued', conclusion: null, completed_at: null },
      ],
    };
    s.records[500].push(current);
    s.policyRun.run_attempt = s.invocation.attempt = 2;
    if (change === 'assigned') Object.assign(s.job, { runner_id: 123, runner_name: 'assigned' });
    if (change === 'missing-runner') Reflect.deleteProperty(s.job, 'runner_id');
    if (change === 'missing-completion') Reflect.deleteProperty(s.job, 'completed_at');
    if (change === 'check-failure') s.check.conclusion = 'failure';
    if (change === 'wrong-app') s.check.app.id = 1;
    const prepare = () => prepareLegacyAdoption({ ...s.options, invocation: s.invocation });
    if (change === 'none') assert.equal(await prepare(), adoptionMarker(16));
    else await assert.rejects(prepare, Error, change);
  }
});

test('classifier-only retries preserve an existing adoption even while the retry is pending or fails', async () => {
  for (const conclusion of [null, 'failure', 'success']) {
    const s = legacyScenario();
    s.issued();
    s.job.status = s.check.status = 'completed';
    s.job.conclusion = s.check.conclusion = 'success';
    s.policyRun.run_attempt = 2;
    s.records[500].push({
      ...structuredClone(s.policyClassifier),
      id: 508,
      run_attempt: 2,
      status: conclusion === null ? 'in_progress' : 'completed',
      conclusion,
      steps: conclusion === 'success' ? s.policyClassifier.steps : [],
    });
    s.fullCoverage();
    s.run.created_at = '2026-11-02T19:31:03Z';
    // The retained policy result and code guards consume proof; there is no
    // invented policy attempt2 invocation or replacement code success.
    assert.equal((await validatePrPolicy(s.options)).fullAfter, '2026-11-02T19:31:02.000Z');
    assert.equal(s.run.conclusion, null);
    assert.deepEqual(s.mutations, []);
  }
});

test('before first adoption an active classifier-only attempt remains unresolved until its returned jobs settle', async () => {
  const s = legacyScenario();
  s.job.steps[0] = {
    ...s.job.steps[0],
    status: 'completed',
    conclusion: 'failure',
    completed_at: '2026-11-02T19:31:01Z',
  };
  s.job.steps[1] = {
    ...s.job.steps[1],
    status: 'completed',
    conclusion: 'skipped',
    completed_at: '2026-11-02T19:31:02Z',
  };
  s.job.status = s.check.status = 'completed';
  s.job.conclusion = s.check.conclusion = 'failure';
  const classifierRetry = {
    ...structuredClone(s.policyClassifier),
    id: 508,
    run_attempt: 2,
    status: 'in_progress',
    conclusion: null as string | null,
    steps: [],
  };
  const currentPolicy = {
    ...structuredClone(s.job),
    id: 509,
    run_attempt: 3,
    status: 'in_progress',
    conclusion: null,
    check_run_url: s.job.check_run_url.replace('/505', '/510'),
    steps: [
      {
        number: 3,
        name: adoptionValidationStep,
        status: 'in_progress',
        conclusion: null,
        completed_at: null,
      },
      { number: 4, name: noAdoptionStep, status: 'queued', conclusion: null, completed_at: null },
    ],
  };
  s.records[500].push(classifierRetry, currentPolicy);
  s.policyRun.run_attempt = s.invocation.attempt = 3;
  const options = { ...s.options, invocation: s.invocation };
  await assert.rejects(prepareLegacyAdoption(options), /not sealed/);
  classifierRetry.status = 'completed';
  classifierRetry.conclusion = 'failure';
  const attempt = {
    ...structuredClone(s.policyRun),
    run_attempt: 2,
    status: 'in_progress',
    conclusion: null as string | null,
  };
  s.workflowAttempts[2] = attempt;
  await assert.rejects(prepareLegacyAdoption(options), /not sealed/);
  attempt.status = 'completed';
  attempt.conclusion = 'failure';
  for (const invalid of [
    { ...attempt, run_attempt: 3 },
    { ...attempt, head_sha: 'd'.repeat(40) },
    { ...attempt, workflow_id: 1 },
    { ...attempt, repository: { full_name: 'foreign/repo' } },
  ]) {
    s.workflowAttempts[2] = invalid;
    await assert.rejects(prepareLegacyAdoption(options), /not sealed/);
  }
  s.workflowAttempts[2] = attempt;
  assert.equal(await prepareLegacyAdoption(options), adoptionMarker(16));
});

test('a carrying checkpoint survives original adoption expiry and cannot move the barrier on a later retry', async () => {
  const s = legacyScenario();
  s.issued();
  const original = parseHistoryCheckpointMarker(
    await capturePrHistory({ ...s.options, invocation: s.invocation }),
  )!;
  // Model a later genuine policy job which completed history before old runs
  // expired. Its carried origin remains independently authenticated by this job.
  s.policyRun.id = s.invocation.id = 600;
  s.policyRun.run_number = s.invocation.sequence = 17;
  s.policyRun.created_at = '2026-11-02T19:32:00Z';
  s.policyRun.check_suite_id = 603;
  s.runs.splice(0, s.runs.length, s.policyRun);
  delete s.records[500];
  delete s.records[499];
  delete s.policyChecks[505];
  const carrier = {
    ...structuredClone(s.job),
    id: 604,
    run_id: 600,
    status: 'completed',
    conclusion: 'success',
    check_run_url: `https://api.github.com/repos/${s.client.repository}/check-runs/605`,
    steps: [
      {
        number: 3,
        name: adoptionValidationStep,
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-11-02T19:32:01Z',
      },
      {
        number: 4,
        name: noAdoptionStep,
        status: 'completed',
        conclusion: 'skipped',
        completed_at: '2026-11-02T19:32:01Z',
      },
      {
        number: 5,
        name: 'Validate PR history v3',
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-11-02T19:32:02Z',
      },
      {
        number: 6,
        name: historyCheckpointMarker({ ...original, sequence: 17 }),
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-11-02T19:32:03Z',
      },
    ],
  };
  s.records[600] = [carrier];
  s.policyChecks[605] = {
    ...s.check,
    id: 605,
    check_suite: { id: 603 },
    status: 'completed',
    conclusion: 'success',
  };
  s.fullCoverage();
  s.run.created_at = '2026-11-02T19:31:03Z';
  assert.equal(
    (await validatePrPolicy({ ...s.options, invocation: s.invocation })).fullAfter,
    '2026-11-02T19:31:02.000Z',
  );
  const retry = {
    ...structuredClone(carrier),
    id: 606,
    run_attempt: 2,
    check_run_url: carrier.check_run_url.replace('/605', '/607'),
    steps: carrier.steps.slice(0, 2),
  };
  s.records[600].push(retry);
  s.policyChecks[607] = { ...structuredClone(s.policyChecks[605]), id: 607 };
  s.policyRun.run_attempt = s.invocation.attempt = 2;
  const options = { ...s.options, invocation: s.invocation };
  assert.equal(await prepareLegacyAdoption(options), null);
  assert.deepEqual(
    parseHistoryCheckpointMarker(await capturePrHistory(options))?.adoption,
    original.adoption,
  );
  // Losing every original or carrying proof is unknown, never permission to
  // make a new deadline that a subsequent text edit can silently move again.
  carrier.steps = carrier.steps.slice(0, 2);
  await assert.rejects(prepareLegacyAdoption(options), /not sealed/);
});

test('conflicting successful adoption origins cannot replace the original with a newer deadline', async () => {
  const s = legacyScenario();
  s.issued();
  const duplicate = structuredClone(s.job);
  duplicate.id = 506;
  duplicate.run_attempt = 2;
  duplicate.check_run_url = duplicate.check_run_url.replace('/505', '/507');
  duplicate.steps[1].completed_at = '2026-11-02T19:32:02Z';
  s.records[500].push(duplicate);
  s.policyChecks[507] = { ...structuredClone(s.check), id: 507 };
  s.policyRun.run_attempt = s.invocation.attempt = 2;
  const options = { ...s.options, invocation: s.invocation };
  assert.equal(await prepareLegacyAdoption(options), null);
  await assert.rejects(capturePrHistory(options), /not sealed/);
  await assert.rejects(validatePrPolicy(options), /not admitted/);
});

test('history issuance precedes title/code admission without changing genuine code results', async () => {
  for (const conclusion of [null, 'success', 'failure', 'cancelled']) {
    const s = scenario(true);
    s.pr.title = 'Invalid title';
    s.options.validateTitle = () => {
      throw new Error('Invalid title');
    };
    for (const item of [s.run, ...s.jobs, ...s.checks]) {
      item.status = conclusion === null ? 'in_progress' : 'completed';
      item.conclusion = conclusion;
    }
    const before = JSON.stringify([s.run, s.jobs, s.checks]);
    const list = s.client.list.bind(s.client);
    s.client.list = async (path, key) => {
      assert.ok(
        !path.includes('/42/runs') &&
          !path.includes('/100/jobs') &&
          !path.includes('/200/check-runs'),
        'history issuance must not borrow a code result',
      );
      return list(path, key);
    };
    assert.deepEqual(
      parseHistoryCheckpointMarker(
        await capturePrHistory({ ...s.options, invocation: s.invocation }),
      ),
      {
        sequence: 2,
        full: false,
        after: null,
        atOrAfter: null,
      },
    );
    await assert.rejects(
      validatePrPolicy({ ...s.options, invocation: s.invocation }),
      /Invalid title/,
    );
    assert.equal(JSON.stringify([s.run, s.jobs, s.checks]), before);
    assert.deepEqual(s.mutations, []);
  }
});

test('known bounded failed classification skips certificate issuance and still admits genuinely fresh full code', async () => {
  const s = scenario(true);
  s.policyClassifier.conclusion = 'failure';
  s.policyClassifier.steps = [];
  assert.equal(await capturePrHistory({ ...s.options, invocation: s.invocation }), null);
  await assert.rejects(
    validatePrPolicy({ ...s.options, invocation: s.invocation }),
    /full.validation|full coverage/i,
  );
  s.fullCoverage();
  s.run.created_at = s.pr.created_at;
  await assert.rejects(
    validatePrPolicy({ ...s.options, invocation: s.invocation }),
    /created|fresh|full.validation/i,
  );
  s.run.created_at = '2026-11-01T12:01:00Z';
  assert.equal(
    (await validatePrPolicy({ ...s.options, invocation: s.invocation })).requiredFull,
    true,
  );
  assert.equal(s.run.conclusion, null);
  assert.deepEqual(s.mutations, []);
});

test('admission consumes its completed checkpoint after prefix expiry while issuance cannot self-certify', async () => {
  const s = scenario(true);
  const marker = await capturePrHistory({ ...s.options, invocation: s.invocation });
  assert.equal(typeof marker, 'string');
  const job = {
    id: 504,
    run_id: 500,
    run_attempt: 1,
    head_sha: s.policyRun.head_sha,
    name: 'Pull request',
    status: 'in_progress',
    conclusion: null,
    check_run_url: 'https://api.github.com/repos/owner/repo/check-runs/505',
    steps: [
      {
        number: 3,
        name: historyValidationStep,
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-11-01T12:00:01Z',
      },
      {
        number: 4,
        name: marker!,
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-11-01T12:00:02Z',
      },
    ],
  };
  const get = s.client.get.bind(s.client);
  const list = s.client.list.bind(s.client);
  s.client.get = async (path) => {
    if (path === 'actions/workflows/43/runs?per_page=100&page=1')
      return { total_count: 1, workflow_runs: [structuredClone(s.policyRun)] };
    if (path === 'check-runs/505')
      return {
        id: 505,
        name: job.name,
        head_sha: job.head_sha,
        check_suite: { id: 503 },
        app: { id: 15368 },
        status: 'in_progress',
        conclusion: null,
      };
    return get(path);
  };
  s.client.list = async (path, key) =>
    path === 'actions/runs/500/jobs?filter=all'
      ? structuredClone([s.policyClassifier, job])
      : list(path, key);
  await assert.rejects(
    capturePrHistory({ ...s.options, invocation: s.invocation }),
    /history was not sealed/,
  );
  assert.equal((await validatePrPolicy({ ...s.options, invocation: s.invocation })).run, 100);
  for (const conclusion of ['failure', 'skipped']) {
    job.steps[1].conclusion = conclusion;
    await assert.rejects(
      validatePrPolicy({ ...s.options, invocation: s.invocation }),
      /not admitted/,
    );
  }
  assert.equal(s.run.conclusion, null);
  assert.deepEqual(s.mutations, []);
});

test('unproved classifications, gaps and stale invocation identities cannot issue history', async () => {
  for (const change of ['pending', 'malformed', 'gap', 'attempt', 'source', 'tested', 'sequence']) {
    const s = scenario(true);
    if (change === 'pending') {
      s.policyClassifier.status = 'in_progress';
      s.policyClassifier.conclusion = null;
      s.policyClassifier.steps = [];
    }
    if (change === 'malformed') s.policyClassifier.steps.push({ ...s.policyClassifier.steps[0] });
    if (change === 'gap') {
      s.policyRun.run_number = s.invocation.sequence = 3;
    }
    if (change === 'attempt') s.invocation.attempt++;
    if (change === 'sequence') s.invocation.sequence++;
    if (change === 'source') s.pr.head.sha = 'd'.repeat(40);
    if (change === 'tested') s.pr.merge_commit_sha = 'd'.repeat(40);
    await assert.rejects(
      capturePrHistory({ ...s.options, invocation: s.invocation }),
      Error,
      change,
    );
    assert.deepEqual(s.mutations, []);
  }
});

test('retained checkpoints preserve missing prefix obligations across source changes without admitting code', async () => {
  for (const full of [false, true]) {
    const s = scenario(true);
    s.policyRun.run_number = s.invocation.sequence = 3;
    s.policyRun.created_at = '2026-11-01T12:00:30Z';
    const oldHead = 'e'.repeat(40);
    const prior = {
      ...s.policyRun,
      id: 498,
      run_number: 2,
      check_suite_id: 600,
      head_sha: oldHead,
      created_at: '2026-11-01T12:00:05Z',
      display_title: `PR policy v2 pr=129 action=edited base=${'d'.repeat(40)} head=${oldHead} tested=${'f'.repeat(40)}`,
    };
    const checkpoint = {
      sequence: 2,
      full,
      after: full ? Date.parse('2026-11-01T12:00:10Z') : null,
      atOrAfter: full ? Date.parse('2026-11-01T12:00:20Z') : null,
    };
    const job = {
      id: 601,
      run_id: prior.id,
      run_attempt: 1,
      head_sha: oldHead,
      name: 'Pull request',
      status: 'completed',
      conclusion: 'failure',
      check_run_url: 'https://api.github.com/repos/owner/repo/check-runs/602',
      steps: [
        {
          number: 3,
          name: historyValidationStep,
          status: 'completed',
          conclusion: 'success',
          completed_at: '2026-11-01T12:00:25Z',
        },
        {
          number: 4,
          name: historyCheckpointMarker(checkpoint),
          status: 'completed',
          conclusion: 'success',
          completed_at: '2026-11-01T12:00:26Z',
        },
      ],
    };
    const get = s.client.get.bind(s.client);
    const list = s.client.list.bind(s.client);
    s.client.get = async (path) => {
      if (path === 'actions/workflows/43/runs?per_page=100&page=1')
        return { total_count: 2, workflow_runs: structuredClone([s.policyRun, prior]) };
      if (path === 'check-runs/602')
        return {
          id: 602,
          name: 'Pull request',
          head_sha: oldHead,
          check_suite: { id: 600 },
          app: { id: 15368 },
          status: 'completed',
          conclusion: 'failure',
        };
      return get(path);
    };
    s.client.list = async (path, key) => {
      if (path === 'actions/runs/498/jobs?filter=all') return [structuredClone(job)];
      return list(path, key);
    };
    const captured = parseHistoryCheckpointMarker(
      await capturePrHistory({ ...s.options, invocation: s.invocation }),
    );
    assert.deepEqual(captured, { ...checkpoint, sequence: 3 });
    if (full) {
      await assert.rejects(
        validatePrPolicy({ ...s.options, invocation: s.invocation }),
        /full.validation|full coverage/i,
      );
      s.fullCoverage();
    }
    const admitted = await validatePrPolicy({ ...s.options, invocation: s.invocation });
    assert.equal(admitted.requiredFull, full);
    assert.equal(s.run.status, 'in_progress');
    assert.ok(s.checks.every((check) => check.conclusion === null));
    // A later full edit remains a new obligation even with a valid earlier seal.
    s.policyClassifier.steps[0].name = 'Edit classification: full';
    s.policyRun.created_at = '2026-11-01T12:01:30Z';
    s.options.now = () => Date.parse('2026-11-01T12:02:00Z');
    await assert.rejects(
      validatePrPolicy({ ...s.options, invocation: s.invocation }),
      /fresh|created|full.validation/i,
    );
    job.steps[1].conclusion = 'failure';
    await assert.rejects(
      capturePrHistory({ ...s.options, invocation: s.invocation }),
      /history was not sealed/i,
    );
    assert.deepEqual(s.mutations, []);
  }
});

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
