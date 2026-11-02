import {
  codeCheckNames,
  parseCodeRunName,
  type CodeRunIdentity,
  type PullRequestIdentity,
} from './pr-identity.ts';

type NotReady = { status: 'pending' | 'invalid'; reason: string };
export type CodeAdmission = { status: 'ready' } | NotReady;
export interface AdmittedCodeRun extends CodeRunIdentity {
  id: number;
  attempt: number;
  suiteId: number;
  repository: string;
  status: 'queued' | 'in_progress' | 'completed';
  createdAt: string;
  startedAt: string;
}
export interface CodeRunExpectation {
  identity: PullRequestIdentity;
  workflowId: number;
  requiredFull: boolean;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const invalid = (reason: string): NotReady => ({ status: 'invalid', reason });
const pending = (reason: string): NotReady => ({ status: 'pending', reason });
const completions = new Set([
  'success',
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
]);
const admittedStatus = (value: Record<string, unknown>) =>
  (['queued', 'in_progress'].includes(String(value.status)) && value.conclusion === null) ||
  (value.status === 'completed' && completions.has(String(value.conclusion)));

function timestamp(value: unknown): number | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return null;
  const parsed = Date.parse(value);
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === normalized ? parsed : null;
}

/** Input is the complete API result scoped to this repository, CI workflow,
 * pull_request event and head SHA. Select the newest attempt before validating
 * its advertised range: an older pass cannot rescue a newer wrong-base run. */
export function selectCodeRun(
  runs: unknown,
  { identity, workflowId, requiredFull }: CodeRunExpectation,
): { status: 'ready'; run: AdmittedCodeRun } | NotReady {
  if (
    !positiveInteger(workflowId) ||
    typeof requiredFull !== 'boolean' ||
    identity.state !== 'open' ||
    !Array.isArray(runs)
  )
    return invalid('Invalid CI run query or pull request state.');
  if (!identity.tested) return pending('GitHub has not supplied the current test merge commit.');
  if (!runs.length) return pending('No eligible CI run exists for the current source.');

  const candidates: {
    raw: Record<string, unknown>;
    id: number;
    created: number;
    started: number;
  }[] = [];
  const seen = new Set<number>();
  for (const raw of runs) {
    if (
      !object(raw) ||
      !positiveInteger(raw.id) ||
      seen.has(raw.id) ||
      !positiveInteger(raw.run_attempt) ||
      !positiveInteger(raw.check_suite_id) ||
      !object(raw.repository) ||
      raw.repository.full_name !== identity.repository ||
      raw.workflow_id !== workflowId ||
      raw.path !== '.github/workflows/ci.yml' ||
      raw.event !== 'pull_request' ||
      raw.head_sha !== identity.head ||
      !Array.isArray(raw.pull_requests) ||
      raw.pull_requests.some((pr) => !object(pr) || !positiveInteger(pr.number))
    )
      return invalid('CI run response does not match its scoped query.');
    seen.add(raw.id);
    // A commit may be used by more than one PR. Association identifies which
    // requests to consider; its mutable base fields never supply range proof.
    if (!raw.pull_requests.some((pr) => object(pr) && pr.number === identity.number)) continue;
    const created = timestamp(raw.created_at);
    const started = timestamp(raw.run_started_at);
    const updated = timestamp(raw.updated_at);
    if (
      created === null ||
      started === null ||
      updated === null ||
      started < created ||
      updated < started
    )
      return invalid('CI attempt timestamps are missing, malformed or inconsistent.');
    candidates.push({ raw, id: raw.id, created, started });
  }
  if (!candidates.length) return pending('No CI run is associated with this pull request.');
  candidates.sort((a, b) => b.started - a.started || b.created - a.created || b.id - a.id);
  const latest = candidates[0].raw;
  let declared: CodeRunIdentity;
  try {
    declared = parseCodeRunName(latest.display_title);
  } catch {
    return invalid('The latest CI attempt has no valid immutable run identity.');
  }
  if (
    declared.number !== identity.number ||
    declared.base !== identity.base ||
    declared.head !== identity.head ||
    declared.tested !== identity.tested
  )
    return invalid(
      'The latest CI attempt does not cover the current source, base and tested merge.',
    );
  if (
    ['requested', 'waiting', 'pending'].includes(String(latest.status)) &&
    latest.conclusion === null
  )
    return pending('The current CI attempt is waiting to be admitted by GitHub.');
  if (!admittedStatus(latest))
    return invalid('The latest CI attempt has an unsupported status or conclusion.');
  return {
    status: 'ready',
    run: {
      ...declared,
      id: latest.id as number,
      attempt: latest.run_attempt as number,
      suiteId: latest.check_suite_id as number,
      repository: identity.repository,
      status: latest.status as AdmittedCodeRun['status'],
      createdAt: latest.created_at as string,
      startedAt: latest.run_started_at as string,
    },
  };
}

/** These are all job attempts and the latest checks in this run's own suite,
 * fully paginated by the caller. GitHub may retain successes in partial retries;
 * their original checks stay authoritative, without publishing copied passes. */
export function admitCodeChecks(
  run: AdmittedCodeRun,
  jobs: unknown,
  checks: unknown,
  requiredFull = false,
): CodeAdmission {
  if (!Array.isArray(jobs) || !Array.isArray(checks))
    return invalid('CI jobs or check-suite response is malformed.');
  if (
    jobs.some((job) => !object(job) || typeof job.name !== 'string') ||
    checks.some((check) => !object(check) || typeof check.name !== 'string')
  )
    return invalid('CI job or check identity is missing.');
  const relevantNames = new Set<string>([...codeCheckNames, `Classify changes (${run.id})`]);
  const observedIds = new Set<number>();
  for (const job of jobs.filter((job) => relevantNames.has(job.name))) {
    if (
      !positiveInteger(job.id) ||
      observedIds.has(job.id) ||
      job.run_id !== run.id ||
      !positiveInteger(job.run_attempt) ||
      job.run_attempt > run.attempt ||
      job.head_sha !== run.head
    )
      return invalid(
        'Code evidence belongs to another run, attempt or source, or repeats a job ID.',
      );
    observedIds.add(job.id);
  }
  const latestJobs = (name: string) => {
    const matching = jobs.filter((job) => job.name === name);
    const attempt = Math.max(0, ...matching.map((job) => job.run_attempt));
    return matching.filter((job) => job.run_attempt === attempt);
  };
  if (requiredFull) {
    // Event names cannot encode history discovered after the workflow starts.
    // Require the actual successful classifier selection from this same run;
    // a native partial retry may retain its original successful classifier.
    const classifiers = latestJobs(`Classify changes (${run.id})`);
    if (classifiers.length > 1) return invalid('Duplicate CI coverage classifier.');
    const classifier = classifiers[0];
    if (!classifier)
      return run.status === 'completed'
        ? invalid('Full validation has no actual coverage classifier evidence.')
        : pending('Waiting for actual full-coverage classifier evidence.');
    if (
      !positiveInteger(classifier.id) ||
      classifier.run_id !== run.id ||
      !positiveInteger(classifier.run_attempt) ||
      classifier.run_attempt > run.attempt ||
      classifier.head_sha !== run.head ||
      !admittedStatus(classifier)
    )
      return invalid('Coverage classifier belongs to another run, attempt or source.');
    if (classifier.status !== 'completed')
      return pending('Waiting for the full-coverage classifier to complete.');
    if (
      classifier.conclusion !== 'success' ||
      !Array.isArray(classifier.steps) ||
      classifier.steps.some((step: unknown) => !object(step) || typeof step.name !== 'string')
    )
      return invalid('Full validation lacks a successful coverage classifier.');
    const markers = classifier.steps.filter((step: Record<string, unknown>) =>
      ['Coverage selected: full', 'Coverage selected: targeted'].includes(String(step.name)),
    );
    if (
      new Set(markers.map((step: Record<string, unknown>) => step.name)).size !== markers.length ||
      markers.some(
        (step: Record<string, unknown>) =>
          step.status !== 'completed' || !['success', 'skipped'].includes(String(step.conclusion)),
      )
    )
      return invalid('Full-validation classifier markers are malformed or duplicated.');
    const selected = markers.filter(
      (step: Record<string, unknown>) => step.conclusion === 'success',
    );
    if (selected.length !== 1 || selected[0].name !== 'Coverage selected: full')
      return invalid('The actual coverage plan does not satisfy the full-validation obligation.');
  }
  let absent: string | null = null;
  let unsettled: string | null = null;
  const seenJobIds = new Set<number>();
  const seenCheckIds = new Set<number>();
  for (const name of codeCheckNames) {
    const matchingJobs = latestJobs(name);
    const matchingChecks = checks.filter((check) => check.name === name);
    if (matchingJobs.length > 1 || matchingChecks.length > 1)
      return invalid(`Duplicate required code gate: ${name}.`);
    const job = matchingJobs[0];
    const check = matchingChecks[0];
    if (
      (job &&
        (!positiveInteger(job.id) ||
          seenJobIds.has(job.id) ||
          job.run_id !== run.id ||
          !positiveInteger(job.run_attempt) ||
          job.run_attempt > run.attempt ||
          job.head_sha !== run.head)) ||
      (check &&
        (!positiveInteger(check.id) ||
          seenCheckIds.has(check.id) ||
          !object(check.check_suite) ||
          check.check_suite.id !== run.suiteId ||
          !object(check.app) ||
          check.app.id !== 15368 ||
          check.head_sha !== run.head))
    )
      return invalid(`Required code gate belongs to another run, attempt, source or app: ${name}.`);
    if (job) seenJobIds.add(job.id);
    if (check) seenCheckIds.add(check.id);
    if ((job && !admittedStatus(job)) || (check && !admittedStatus(check)))
      return invalid(`Required code gate is skipped, neutral or malformed: ${name}.`);
    if (!job || !check) {
      absent = name;
      continue;
    }
    if (
      job.check_run_url !== `https://api.github.com/repos/${run.repository}/check-runs/${check.id}`
    )
      return invalid(`Required code job and check do not have the same identity: ${name}.`);
    if (
      job.run_attempt < run.attempt &&
      !(job.status === 'completed' && job.conclusion === 'success')
    ) {
      if (run.status === 'completed')
        return invalid(`Completed retry retained a nonpassing older-attempt gate: ${name}.`);
      unsettled = `Waiting for the current retry to replace its older-attempt gate: ${name}.`;
    }
    if (job.status !== check.status || job.conclusion !== check.conclusion)
      unsettled = `GitHub is still reconciling the code job and check: ${name}.`;
  }
  if (absent)
    return run.status === 'completed'
      ? invalid(`Completed CI is missing a required code gate: ${absent}.`)
      : pending(`Waiting for the current CI attempt's code gate: ${absent}.`);
  if (unsettled) return pending(unsettled);
  return { status: 'ready' };
}
