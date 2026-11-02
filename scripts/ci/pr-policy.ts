import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { assertPullRequestCheckout } from './changes.ts';
import { admitCodeChecks, selectCodeRun } from './pr-code-admission.ts';
import { exactTextEdit, parsePullRequestEvent, REVALIDATE_LABEL } from './pr-identity.ts';
import type { PullRequestIdentity } from './pr-identity.ts';
import { PrGitHub } from './pr-github.ts';

export type PrReader = Pick<PrGitHub, 'repository' | 'get' | 'list'>;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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

export async function currentPullRequest(client: PrReader, number: number) {
  const raw = await client.get(`pulls/${number}`);
  const identity = parsePullRequestEvent(
    { number, repository: { full_name: client.repository }, pull_request: raw },
    client.repository,
  );
  if (
    !object(raw) ||
    !Array.isArray(raw.labels) ||
    raw.labels.some((label) => !object(label) || typeof label.name !== 'string')
  )
    throw new Error('Current PR labels are unavailable.');
  return { identity, labels: raw.labels.map((label) => (label as { name: string }).name) };
}

/** This gate validates policy and admission, never republishes code outcomes.
 * Pending code retains its own pending checks; failed code retains its failures. */
export async function validatePrPolicy(options: {
  client: PrReader;
  event: unknown;
  tested: string;
  validateTitle: (identity: PullRequestIdentity) => void;
  now?: () => number;
  pause?: (milliseconds: number) => Promise<unknown>;
  timeoutMs?: number;
}) {
  const { client, event, tested, validateTitle } = options;
  const expected = parsePullRequestEvent(event, client.repository);
  expected.tested = tested;
  const first = await currentPullRequest(client, expected.number);
  assertCurrentSource(expected, first.identity);
  validateTitle(first.identity);
  const editedFull = object(event) && event.action === 'edited' && !exactTextEdit(event);
  const labelFull = object(event) && object(event.label) && event.label.name === REVALIDATE_LABEL;
  const requiredFull = editedFull || labelFull || first.labels.includes(REVALIDATE_LABEL);
  const workflow = await client.get('actions/workflows/ci.yml');
  if (
    !object(workflow) ||
    !Number.isSafeInteger(workflow.id) ||
    workflow.path !== '.github/workflows/ci.yml'
  )
    throw new Error('The code-validation workflow identity is unavailable.');
  const now = options.now ?? Date.now;
  const pause = options.pause ?? setTimeout;
  const deadline = now() + (options.timeoutMs ?? 40 * 60_000);
  let reason = 'Code validation has not been admitted.';
  do {
    const current = await currentPullRequest(client, expected.number);
    assertCurrentSource(expected, current.identity);
    if (
      current.identity.title !== first.identity.title ||
      current.identity.body !== first.identity.body
    )
      throw new Error('PR text changed during validation; the newer policy run owns the result.');
    if (current.labels.includes(REVALIDATE_LABEL) && !requiredFull)
      throw new Error('A full revalidation request arrived; the newer policy run owns the result.');
    if (current.identity.tested !== tested)
      throw new Error('Current PR merge identity differs from the immutable event checkout.');
    const runs = await client.list(
      `actions/workflows/${workflow.id}/runs?event=pull_request&head_sha=${expected.head}`,
      'workflow_runs',
    );
    const selected = selectCodeRun(runs, {
      identity: expected,
      workflowId: workflow.id as number,
      requiredFull,
    });
    if (selected.status === 'invalid') throw new Error(selected.reason);
    reason = selected.status === 'pending' ? selected.reason : '';
    if (selected.status === 'ready') {
      const { run } = selected;
      const [jobs, checks] = await Promise.all([
        client.list(`actions/runs/${run.id}/jobs?filter=latest`, 'jobs'),
        client.list(`check-suites/${run.suiteId}/check-runs?filter=latest`, 'check_runs'),
      ]);
      const admitted = admitCodeChecks(run, jobs, checks);
      if (admitted.status === 'invalid') throw new Error(admitted.reason);
      if (admitted.status === 'ready') {
        const final = await currentPullRequest(client, expected.number);
        assertCurrentSource(expected, final.identity);
        if (
          final.identity.tested !== tested ||
          final.identity.title !== first.identity.title ||
          final.identity.body !== first.identity.body ||
          (final.labels.includes(REVALIDATE_LABEL) && !requiredFull)
        )
          throw new Error('PR changed before policy validation completed.');
        return {
          run: run.id,
          attempt: run.attempt,
          suite: run.suiteId,
          identity: {
            number: expected.number,
            repository: expected.repository,
            base: expected.base,
            head: expected.head,
            tested,
          },
          requiredFull,
        };
      }
      reason = admitted.reason;
    }
    if (now() >= deadline) break;
    console.log(`Waiting for genuine code-check admission: ${reason}`);
    await pause(10_000);
  } while (now() <= deadline);
  throw new Error(
    `Code validation was not admitted before the deadline: ${reason} Check the CI router credential and current CI run; rerun policy after fixing the prerequisite.`,
  );
}

if (import.meta.main) {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request')
    throw new Error('Policy requires a pull_request event.');
  const event: unknown = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  const client = new PrGitHub(process.env.GITHUB_REPOSITORY!, process.env.GH_TOKEN!);
  const identity = parsePullRequestEvent(event, client.repository);
  assertPullRequestCheckout(identity, process.env.GITHUB_SHA!);
  const result = await validatePrPolicy({
    client,
    event,
    tested: process.env.GITHUB_SHA!,
    validateTitle: (current) =>
      execFileSync(
        process.execPath,
        ['scripts/backlog/cli.ts', 'pr', '--base', current.base, '--title', current.title],
        { stdio: 'inherit' },
      ),
  });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      '## PR policy and code admission\n\nPolicy passed. Code outcomes remain owned by their original checks.\n\n```json\n' +
        JSON.stringify(result, null, 2) +
        '\n```\n',
    );
}
