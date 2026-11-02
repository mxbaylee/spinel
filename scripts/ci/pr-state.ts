import { appendFileSync, readFileSync } from 'node:fs';
import { PrGitHub } from './pr-github.ts';
import {
  exactTextEdit,
  parsePullRequestEvent,
  REVALIDATE_LABEL,
  type PullRequestIdentity,
} from './pr-identity.ts';

export type PrReader = Pick<PrGitHub, 'repository' | 'get' | 'list'>;
export interface CurrentPullRequest {
  identity: PullRequestIdentity;
  labels: string[];
  createdAt: string;
}
export interface FullValidationRequirement {
  state: 'full' | 'clear' | 'pending';
  reason: string;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
const active = (status: unknown) =>
  ['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(String(status));
const full = (reason: string): FullValidationRequirement => ({ state: 'full', reason });
const textMarker = 'Edit classification: text';
const fullMarker = 'Edit classification: full';

function timestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'))
  );
}

export function assertCurrentSource(expected: PullRequestIdentity, actual: PullRequestIdentity) {
  if (
    actual.state !== 'open' ||
    ['number', 'repository', 'headRepository', 'base', 'head', 'baseRef', 'headRef'].some(
      (key) =>
        expected[key as keyof PullRequestIdentity] !== actual[key as keyof PullRequestIdentity],
    )
  )
    throw new Error(
      'PR source or base changed; wait for the current event instead of validating stale work.',
    );
}

export async function currentPullRequest(
  client: PrReader,
  number: number,
): Promise<CurrentPullRequest> {
  const raw = await client.get(`pulls/${number}`);
  const identity = parsePullRequestEvent(
    { number, repository: { full_name: client.repository }, pull_request: raw },
    client.repository,
  );
  if (
    !object(raw) ||
    !Array.isArray(raw.labels) ||
    raw.labels.some((label) => !object(label) || typeof label.name !== 'string') ||
    !timestamp(raw.created_at)
  )
    throw new Error('Current PR labels or creation time are unavailable.');
  return {
    identity,
    labels: raw.labels.map((label) => (label as { name: string }).name),
    createdAt: raw.created_at,
  };
}

export function classifyPrEdit(event: unknown): 'text' | 'full' | 'code' {
  if (exactTextEdit(event)) return 'text';
  if (
    object(event) &&
    ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled'].includes(String(event.action))
  )
    return 'code';
  return 'full';
}

/** Full-validation obligations belong to the PR history, not a removable label
 * or an available router credential. An independent successful classification
 * step proves a text edit even if its later policy job was cancelled. */
export async function readFullValidationRequirement(
  client: PrReader,
  state: CurrentPullRequest,
): Promise<FullValidationRequirement> {
  let reading = 'PR timeline';
  try {
    if (
      state.identity.repository !== client.repository ||
      !positiveInteger(state.identity.number) ||
      !timestamp(state.createdAt)
    )
      return full('PR history identity is malformed.');
    if (state.labels.includes(REVALIDATE_LABEL))
      return full('The PR has a full-revalidation label.');
    const timeline = await client.list(`issues/${state.identity.number}/timeline`, '');
    if (!Array.isArray(timeline)) return full('PR timeline is unavailable or incomplete.');
    const timelineIds = new Set<number>();
    for (const entry of timeline) {
      if (!object(entry) || typeof entry.event !== 'string')
        return full('PR timeline contains malformed history.');
      if (!['base_ref_changed', 'labeled', 'unlabeled'].includes(entry.event)) continue;
      if (!positiveInteger(entry.id) || timelineIds.has(entry.id) || !timestamp(entry.created_at))
        return full('PR timeline has malformed or duplicate change identities.');
      timelineIds.add(entry.id);
      if (entry.event === 'base_ref_changed') return full('The PR has a recorded base change.');
      if (!object(entry.label) || typeof entry.label.name !== 'string')
        return full('PR label history is malformed.');
      if (entry.label.name === REVALIDATE_LABEL)
        return full(
          'The PR has a historical full-revalidation request, even if its label was removed.',
        );
    }

    reading = 'policy workflow';
    const workflow = await client.get('actions/workflows/pr-policy.yml');
    if (
      !object(workflow) ||
      !positiveInteger(workflow.id) ||
      workflow.path !== '.github/workflows/pr-policy.yml'
    )
      return full('The PR-policy workflow identity is unavailable.');
    const runs = await client.list(
      `actions/workflows/${workflow.id}/runs?event=pull_request&created=${encodeURIComponent(`>=${state.createdAt}`)}`,
      'workflow_runs',
    );
    if (!Array.isArray(runs)) return full('PR-policy run history is unavailable or incomplete.');
    const runIds = new Set<number>();
    let pendingReason: string | null = null;
    for (const run of runs) {
      if (
        !object(run) ||
        !positiveInteger(run.id) ||
        runIds.has(run.id) ||
        run.workflow_id !== workflow.id ||
        run.path !== '.github/workflows/pr-policy.yml' ||
        run.event !== 'pull_request' ||
        !object(run.repository) ||
        run.repository.full_name !== client.repository ||
        !Array.isArray(run.pull_requests) ||
        run.pull_requests.some((pr) => !object(pr) || !positiveInteger(pr.number)) ||
        new Set(run.pull_requests.map((pr) => (pr as { number: number }).number)).size !==
          run.pull_requests.length
      )
        return full('PR-policy history has malformed, duplicate or foreign run bindings.');
      runIds.add(run.id);
      const name =
        typeof run.display_title === 'string'
          ? /^PR policy v1 pr=([1-9][0-9]*) action=(opened|edited|synchronize|reopened|labeled|unlabeled)$/.exec(
              run.display_title,
            )
          : null;
      const declaredNumber =
        name && name[0] === run.display_title && positiveInteger(Number(name[1]))
          ? Number(name[1])
          : null;
      if (!run.pull_requests.some((pr) => object(pr) && pr.number === state.identity.number)) {
        // A missing API association must not erase an edit that its immutable
        // event name attributes to this PR, or history we cannot attribute.
        if (
          declaredNumber === state.identity.number ||
          (run.pull_requests.length === 0 && declaredNumber === null)
        )
          return full('A PR-policy run has missing or contradictory PR associations.');
        continue;
      }
      if (
        !sha(run.head_sha) ||
        !positiveInteger(run.run_attempt) ||
        !timestamp(run.created_at) ||
        Date.parse(run.created_at) < Date.parse(state.createdAt)
      )
        return full('A PR-policy run has incomplete immutable metadata.');
      if (!name || declaredNumber !== state.identity.number)
        return full('A PR-policy run has an unknown edit classification identity.');
      if (name[2] !== 'edited') continue;

      reading = `policy classification for run ${run.id}`;
      const runAttempt = run.run_attempt;
      const jobs = await client.list(`actions/runs/${run.id}/jobs?filter=all`, 'jobs');
      if (
        !Array.isArray(jobs) ||
        jobs.some(
          (job) =>
            !object(job) ||
            typeof job.name !== 'string' ||
            job.run_id !== run.id ||
            !positiveInteger(job.run_attempt) ||
            job.run_attempt > runAttempt ||
            job.head_sha !== run.head_sha,
        )
      )
        return full('A PR edit has malformed classification jobs.');
      const classifiers = jobs.filter(
        (job) => object(job) && job.name === `Classify PR edit (${run.id})`,
      );
      if (
        new Set(classifiers.map((job) => (object(job) ? job.run_attempt : null))).size !==
          classifiers.length ||
        new Set(classifiers.map((job) => (object(job) ? job.id : null))).size !== classifiers.length
      )
        return full('A PR edit has duplicate classification jobs in one attempt.');
      if (!classifiers.length) {
        if (active(run.status)) {
          pendingReason = `Waiting for PR edit classification in run ${run.id}.`;
          continue;
        }
        return full('A completed or cancelled PR edit lacks successful classification evidence.');
      }
      const job = classifiers.sort(
        (a, b) => Number(object(b) ? b.run_attempt : 0) - Number(object(a) ? a.run_attempt : 0),
      )[0];
      if (
        !object(job) ||
        !positiveInteger(job.id) ||
        job.run_id !== run.id ||
        !positiveInteger(job.run_attempt) ||
        job.run_attempt > runAttempt ||
        job.head_sha !== run.head_sha ||
        !Array.isArray(job.steps) ||
        job.steps.some((step) => !object(step) || typeof step.name !== 'string')
      )
        return full('A PR edit classification does not belong to its recorded run.');
      const markers = job.steps.filter(
        (step) => object(step) && [textMarker, fullMarker].includes(String(step.name)),
      );
      if (new Set(markers.map((step) => (step as { name: string }).name)).size !== markers.length)
        return full('A PR edit has duplicate classification markers.');
      if (
        markers.some(
          (step) =>
            !object(step) ||
            !(
              (['queued', 'in_progress'].includes(String(step.status)) &&
                step.conclusion === null) ||
              (step.status === 'completed' &&
                ['success', 'skipped'].includes(String(step.conclusion)))
            ),
        )
      )
        return full('A PR edit has malformed or failed classification markers.');
      const completed = markers.filter(
        (step) => object(step) && step.status === 'completed' && step.conclusion === 'success',
      );
      if (completed.some((step) => object(step) && step.name === fullMarker))
        return full('A prior PR edit requires full validation.');
      if (completed.some((step) => object(step) && step.name === textMarker)) continue;
      if (active(job.status)) {
        pendingReason = `Waiting for PR edit classification in run ${run.id}.`;
        continue;
      }
      return full(
        'A failed, cancelled or incomplete PR edit classification requires full validation.',
      );
    }
    return pendingReason
      ? { state: 'pending', reason: pendingReason }
      : { state: 'clear', reason: 'Complete PR history contains no full-validation obligation.' };
  } catch {
    return full(`Could not read complete ${reading} history; full validation is required.`);
  }
}

if (import.meta.main) {
  const event: unknown = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  if (process.argv[2] === 'classify') {
    const kind = classifyPrEdit(event);
    appendFileSync(process.env.GITHUB_OUTPUT!, `kind=${kind}\n`);
    console.log(`PR event classification: ${kind}`);
  } else if (process.argv[2] === 'guard') {
    if (process.env.GITHUB_EVENT_NAME !== 'pull_request')
      throw new Error('The live source guard requires a pull_request event.');
    const client = new PrGitHub(process.env.GITHUB_REPOSITORY!, process.env.GH_TOKEN!);
    const expected = parsePullRequestEvent(event, client.repository);
    assertCurrentSource(expected, (await currentPullRequest(client, expected.number)).identity);
    console.log('The current PR source and base match the immutable event.');
  } else {
    throw new Error('Expected pr-state.ts classify or guard.');
  }
}
