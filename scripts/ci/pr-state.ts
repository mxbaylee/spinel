import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { suiteIds, verifyCoverage, type CoveragePlan } from './plan.ts';
import { PrGitHub } from './pr-github.ts';
import {
  exactTextEdit,
  parsePullRequestEvent,
  REVALIDATE_LABEL,
  type PullRequestIdentity,
} from './pr-identity.ts';

export type PrReader = Pick<PrGitHub, 'repository' | 'get' | 'list'> & { routerAppId?: number };
export interface CurrentPullRequest {
  identity: PullRequestIdentity;
  labels: string[];
  createdAt: string;
}
export interface FullValidationRequirement {
  state: 'full' | 'clear' | 'pending';
  reason: string;
  after: number | null;
  atOrAfter: number | null;
  pending: boolean;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
const active = (status: unknown) =>
  ['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(String(status));
const full = (
  reason: string,
  after: number | null = null,
  pending = false,
  atOrAfter: number | null = null,
): FullValidationRequirement => ({ state: 'full', reason, after, atOrAfter, pending });
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
  now: () => number = Date.now,
): Promise<FullValidationRequirement> {
  let reading = 'PR timeline';
  let after: number | null = null;
  let atOrAfter: number | null = null;
  let removedAt: number | null = null;
  let fullReason: string | null = null;
  let pendingReason: string | null = null;
  const recordFull = (time: number, reason: string) => {
    if (after === null || time >= after) {
      after = time;
      fullReason = reason;
    }
  };
  const unknown = (reason: string) => full(reason, null, pendingReason !== null, atOrAfter);
  try {
    if (
      state.identity.repository !== client.repository ||
      !positiveInteger(state.identity.number) ||
      !timestamp(state.createdAt)
    )
      return unknown('PR history identity is malformed.');
    const currentTime = now();
    const createdTime = Date.parse(state.createdAt);
    if (!Number.isFinite(currentTime) || currentTime < createdTime)
      return unknown('PR history has an invalid current time or creation bound.');
    // Actions retention can remove runs after one day. An older PR can no
    // longer prove complete edit history from surviving workflow runs alone.
    const historyFloor = currentTime - 24 * 60 * 60_000;
    if (historyFloor >= createdTime)
      recordFull(
        historyFloor,
        'PR history exceeds the guaranteed 24-hour Actions retention window.',
      );
    const timeline = await client.list(`issues/${state.identity.number}/timeline`, '');
    if (!Array.isArray(timeline)) return unknown('PR timeline is unavailable or incomplete.');
    const timelineIds = new Set<number>();
    let recordedLabel = false;
    for (const entry of timeline) {
      if (!object(entry) || typeof entry.event !== 'string')
        return unknown('PR timeline contains malformed history.');
      if (
        !['base_ref_changed', 'automatic_base_change_succeeded', 'labeled', 'unlabeled'].includes(
          entry.event,
        )
      )
        continue;
      if (
        !positiveInteger(entry.id) ||
        timelineIds.has(entry.id) ||
        !timestamp(entry.created_at) ||
        Date.parse(entry.created_at) < createdTime
      )
        return unknown('PR timeline has malformed or duplicate change identities.');
      timelineIds.add(entry.id);
      if (['base_ref_changed', 'automatic_base_change_succeeded'].includes(entry.event)) {
        recordFull(Date.parse(entry.created_at), 'The PR has a recorded base change.');
        continue;
      }
      if (!object(entry.label) || typeof entry.label.name !== 'string')
        return unknown('PR label history is malformed.');
      if (entry.label.name === REVALIDATE_LABEL) {
        recordedLabel = true;
        const time = Date.parse(entry.created_at);
        if (entry.event === 'unlabeled') {
          removedAt = Math.max(removedAt ?? time, time);
        } else if (
          positiveInteger(client.routerAppId) &&
          object(entry.performed_via_github_app) &&
          entry.performed_via_github_app.id === client.routerAppId
        ) {
          atOrAfter = Math.max(atOrAfter ?? time, time);
          fullReason ??= 'The trusted router notified code validation of a full request.';
        } else {
          recordFull(
            time,
            'The PR has a full-revalidation label request from an unverified or manual actor.',
          );
        }
      }
    }
    const unresolvedLabel = state.labels.includes(REVALIDATE_LABEL) && !recordedLabel;

    reading = 'policy workflow';
    const workflow = await client.get('actions/workflows/pr-policy.yml');
    if (
      !object(workflow) ||
      !positiveInteger(workflow.id) ||
      workflow.path !== '.github/workflows/pr-policy.yml'
    )
      return unknown('The PR-policy workflow identity is unavailable.');
    const runsSince =
      historyFloor > createdTime ? new Date(historyFloor).toISOString() : state.createdAt;
    const runs = await client.list(
      `actions/workflows/${workflow.id}/runs?event=pull_request&created=${encodeURIComponent(`>=${runsSince}`)}`,
      'workflow_runs',
    );
    if (!Array.isArray(runs)) return unknown('PR-policy run history is unavailable or incomplete.');
    const runIds = new Set<number>();
    for (const run of runs) {
      if (
        !object(run) ||
        !positiveInteger(run.id) ||
        runIds.has(run.id) ||
        run.workflow_id !== workflow.id ||
        run.path !== '.github/workflows/pr-policy.yml' ||
        run.event !== 'pull_request' ||
        !object(run.repository) ||
        run.repository.full_name !== client.repository
      )
        return unknown('PR-policy history has malformed, duplicate or foreign run bindings.');
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
      const associations = Array.isArray(run.pull_requests) ? run.pull_requests : [];
      const associationsValid =
        Array.isArray(run.pull_requests) &&
        associations.every((pr) => object(pr) && positiveInteger(pr.number)) &&
        new Set(associations.map((pr) => (pr as { number: number }).number)).size ===
          associations.length;
      const associated =
        associationsValid &&
        associations.some((pr) => object(pr) && pr.number === state.identity.number);
      if (
        associationsValid &&
        !associated &&
        declaredNumber !== state.identity.number &&
        (associations.length > 0 || declaredNumber !== null)
      )
        continue;
      if (!timestamp(run.created_at) || Date.parse(run.created_at) < createdTime)
        return unknown('A relevant PR-policy run has an unavailable creation timestamp.');
      const requestedAt = Date.parse(run.created_at);
      if (!associated) {
        recordFull(requestedAt, 'A PR-policy run has missing or contradictory PR associations.');
        continue;
      }
      if (!name || declaredNumber !== state.identity.number) {
        recordFull(requestedAt, 'A PR-policy run has an unknown edit classification identity.');
        continue;
      }
      if (!sha(run.head_sha) || !positiveInteger(run.run_attempt)) {
        recordFull(requestedAt, 'A PR-policy run has incomplete immutable metadata.');
        continue;
      }
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
      ) {
        recordFull(requestedAt, 'A PR edit has malformed classification jobs.');
        continue;
      }
      const classifiers = jobs.filter(
        (job) => object(job) && job.name === `Classify PR edit (${run.id})`,
      );
      if (
        new Set(classifiers.map((job) => (object(job) ? job.run_attempt : null))).size !==
          classifiers.length ||
        new Set(classifiers.map((job) => (object(job) ? job.id : null))).size !== classifiers.length
      ) {
        recordFull(requestedAt, 'A PR edit has duplicate classification jobs in one attempt.');
        continue;
      }
      if (!classifiers.length) {
        if (active(run.status)) {
          pendingReason = `Waiting for PR edit classification in run ${run.id}.`;
          continue;
        }
        recordFull(
          requestedAt,
          'A completed or cancelled PR edit lacks successful classification evidence.',
        );
        continue;
      }
      classifiers.sort(
        (a, b) => Number(object(b) ? b.run_attempt : 0) - Number(object(a) ? a.run_attempt : 0),
      );
      let latest: 'text' | 'pending' | 'full' = 'full';
      let malformed = false;
      let recordedFull = false;
      for (const [index, job] of classifiers.entries()) {
        if (
          !object(job) ||
          !positiveInteger(job.id) ||
          job.run_id !== run.id ||
          !positiveInteger(job.run_attempt) ||
          job.run_attempt > runAttempt ||
          job.head_sha !== run.head_sha ||
          !Array.isArray(job.steps) ||
          job.steps.some((step) => !object(step) || typeof step.name !== 'string')
        ) {
          malformed = true;
          break;
        }
        const markers = job.steps.filter(
          (step) => object(step) && [textMarker, fullMarker].includes(String(step.name)),
        );
        if (
          new Set(markers.map((step) => (step as { name: string }).name)).size !== markers.length
        ) {
          malformed = true;
          break;
        }
        if (
          markers.some(
            (step) =>
              !object(step) ||
              !(
                (['pending', 'queued', 'in_progress'].includes(String(step.status)) &&
                  step.conclusion === null) ||
                (step.status === 'completed' &&
                  ['success', 'skipped'].includes(String(step.conclusion)))
              ),
          )
        ) {
          malformed = true;
          break;
        }
        const completed = markers.filter(
          (step) => object(step) && step.status === 'completed' && step.conclusion === 'success',
        );
        // A rerun may replace the latest text proof, but can never erase a
        // validated full obligation from any earlier classifier attempt.
        const fullAttempt = completed.some((step) => object(step) && step.name === fullMarker);
        if (fullAttempt) {
          recordedFull = true;
          recordFull(requestedAt, 'A prior PR edit requires full validation.');
        }
        if (index === 0)
          latest = fullAttempt
            ? 'full'
            : completed.some((step) => object(step) && step.name === textMarker)
              ? 'text'
              : active(job.status)
                ? 'pending'
                : 'full';
      }
      if (malformed) {
        recordFull(requestedAt, 'A PR edit has malformed or failed classification evidence.');
        continue;
      }
      if (latest === 'text') continue;
      if (latest === 'pending') {
        pendingReason = `Waiting for PR edit classification in run ${run.id}.`;
        continue;
      }
      if (recordedFull) continue;
      recordFull(
        requestedAt,
        'A failed, cancelled or incomplete PR edit classification requires full validation.',
      );
    }
    if (unresolvedLabel)
      return unknown('The current full-revalidation label has no verified request timestamp.');
    // Removal retains the full duty but does not replace a known request with
    // a later timestamp. Use it only when complete history offers no request.
    if (after === null && removedAt !== null)
      recordFull(
        removedAt,
        'A removed full-revalidation label is the only available request boundary.',
      );
    if (fullReason !== null) return full(fullReason, after, pendingReason !== null, atOrAfter);
    return pendingReason
      ? { state: 'pending', reason: pendingReason, after: null, atOrAfter: null, pending: true }
      : {
          state: 'clear',
          reason: 'Complete PR history contains no full-validation obligation.',
          after: null,
          atOrAfter: null,
          pending: false,
        };
  } catch {
    return unknown(`Could not read complete ${reading} history; full validation is required.`);
  }
}

/** A retained successful code job may be retried after a new edit obligation.
 * Bind its original coverage plan again before allowing that result to finish. */
export async function guardCurrentCode(
  client: PrReader,
  event: unknown,
  rawPlan: string,
  digest: string,
  tested: string,
  classification: string,
  runId: string | number,
  now: () => number = Date.now,
): Promise<FullValidationRequirement> {
  const expected = parsePullRequestEvent(event, client.repository);
  const current = await currentPullRequest(client, expected.number);
  assertCurrentSource(expected, current.identity);
  if (typeof rawPlan !== 'string' || createHash('sha256').update(rawPlan).digest('hex') !== digest)
    throw new Error('Coverage plan digest changed or missing.');
  const raw: unknown = JSON.parse(rawPlan);
  verifyCoverage(raw, classification, {}, []);
  const plan = raw as CoveragePlan;
  if (
    plan.event !== 'pull_request' ||
    plan.base !== expected.base ||
    plan.head !== expected.head ||
    !sha(tested) ||
    plan.tested !== tested
  )
    throw new Error('Coverage plan does not identify this immutable PR event and tested commit.');
  const allSelected = suiteIds.every((id) => plan.suites[id].selected);
  if (plan.mode === 'full' && !allSelected)
    throw new Error('A full coverage plan must select every suite.');
  if (current.identity.tested !== tested)
    throw new Error('Current PR merge identity differs from this tested commit.');
  if (!/^[1-9][0-9]*$/.test(String(runId)) || !positiveInteger(Number(runId)))
    throw new Error('Current code workflow run ID is unavailable.');
  const run = await client.get(`actions/runs/${runId}`);
  if (
    !object(run) ||
    run.id !== Number(runId) ||
    run.path !== '.github/workflows/ci.yml' ||
    run.event !== 'pull_request' ||
    run.head_sha !== expected.head ||
    !object(run.repository) ||
    run.repository.full_name !== client.repository ||
    !timestamp(run.created_at) ||
    Date.parse(run.created_at) < Date.parse(current.createdAt)
  )
    throw new Error('Current code workflow run identity or creation time is unavailable.');
  const requirement = await readFullValidationRequirement(client, current, now);
  if (requirement.state === 'full' && (plan.mode !== 'full' || !allSelected))
    throw new Error(`Current PR history requires full coverage: ${requirement.reason}`);
  if (requirement.state === 'full') {
    if (requirement.after === null)
      throw new Error(`Unable to establish full-validation freshness: ${requirement.reason}`);
    if (Date.parse(run.created_at) <= requirement.after)
      throw new Error(
        'Full validation requires a new CI run created strictly after the latest request; rerunning an earlier run does not establish freshness.',
      );
    if (requirement.atOrAfter !== null && Date.parse(run.created_at) < requirement.atOrAfter)
      throw new Error(
        'Full validation requires a CI run created at or after the latest trusted router notification.',
      );
  }
  // Pending classification does not invalidate code results. The independent
  // required policy check remains pending until that uncertainty is resolved.
  const final = await currentPullRequest(client, expected.number);
  assertCurrentSource(expected, final.identity);
  if (final.identity.tested !== tested)
    throw new Error('Current PR merge identity changed before code validation completed.');
  return requirement.pending
    ? {
        ...requirement,
        reason: `${requirement.reason} Code results are preserved while required PR policy remains pending.`,
      }
    : requirement;
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
    const requirement = await guardCurrentCode(
      client,
      event,
      process.env.COVERAGE_PLAN ?? '',
      process.env.COVERAGE_PLAN_SHA256 ?? '',
      process.env.GITHUB_SHA ?? '',
      process.env.CLASSIFICATION ?? '',
      process.env.GITHUB_RUN_ID ?? '',
    );
    console.log(
      `Current PR source, base and coverage verified (${requirement.state}): ${requirement.reason}`,
    );
  } else {
    throw new Error('Expected pr-state.ts classify or guard.');
  }
}
