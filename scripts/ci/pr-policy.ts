import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { assertPullRequestCheckout } from './changes.ts';
import { admitCodeChecks, selectCodeRun } from './pr-code-admission.ts';
import { exactTextEdit, parsePullRequestEvent, REVALIDATE_LABEL } from './pr-identity.ts';
import type { PullRequestIdentity } from './pr-identity.ts';
import { PrGitHub } from './pr-github.ts';
import { historyCheckpointMarker, type PolicyInvocation } from './pr-history.ts';
import { adoptionMarker } from './pr-history-adoption.ts';
import {
  assertCurrentSource,
  currentPullRequest,
  readFullValidationRequirement,
  type FullValidationRequirement,
  type PrReader,
} from './pr-state.ts';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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
  invocation?: PolicyInvocation;
}) {
  const { client, event, tested, validateTitle } = options;
  const historyContext = options.invocation
    ? { invocation: options.invocation, phase: 'admission' as const }
    : undefined;
  const now = options.now ?? Date.now;
  const expected = parsePullRequestEvent(event, client.repository);
  expected.tested = tested;
  const first = await currentPullRequest(client, expected.number);
  assertCurrentSource(expected, first.identity);
  validateTitle(first.identity);
  const editedFull = object(event) && event.action === 'edited' && !exactTextEdit(event);
  const labelFull = object(event) && object(event.label) && event.label.name === REVALIDATE_LABEL;
  let requiredFull = editedFull || labelFull || first.labels.includes(REVALIDATE_LABEL);
  let history = await readFullValidationRequirement(client, first, now, historyContext);
  requiredFull ||= history.state === 'full';
  let fullAfter = history.state === 'full' ? history.after : null;
  let fullAtOrAfter = history.state === 'full' ? history.atOrAfter : null;
  let fullReason = history.reason;
  const observeHistory = (next: FullValidationRequirement) => {
    history = next;
    if (next.state === 'full') {
      requiredFull = true;
      fullReason = next.reason;
      if (next.after !== null) fullAfter = Math.max(fullAfter ?? 0, next.after);
      if (next.atOrAfter !== null) fullAtOrAfter = Math.max(fullAtOrAfter ?? 0, next.atOrAfter);
    }
  };
  const unsettledHistory = () =>
    history.pending ||
    (requiredFull && (fullAfter === null || (history.state === 'full' && history.after === null)));
  const workflow = await client.get('actions/workflows/ci.yml');
  if (
    !object(workflow) ||
    !Number.isSafeInteger(workflow.id) ||
    workflow.path !== '.github/workflows/ci.yml'
  )
    throw new Error('The code-validation workflow identity is unavailable.');
  const pause = options.pause ?? setTimeout;
  // The longest code worker has a 60-minute limit. Allow aggregate jobs and
  // ordinary queueing too; timeout still fails visibly rather than inventing
  // check evidence. One-minute polling avoids a tight repository API loop.
  const deadline = now() + (options.timeoutMs ?? 90 * 60_000);
  let reason = 'Code validation has not been admitted.';
  do {
    const current = await currentPullRequest(client, expected.number);
    assertCurrentSource(expected, current.identity);
    if (
      current.identity.title !== first.identity.title ||
      current.identity.body !== first.identity.body
    )
      throw new Error('PR text changed during validation; the newer policy run owns the result.');
    if (!requiredFull && current.labels.includes(REVALIDATE_LABEL)) {
      requiredFull = true;
      fullReason = 'The PR now has a full-revalidation label.';
    }
    if (current.identity.tested !== tested)
      throw new Error('Current PR merge identity differs from the immutable event checkout.');
    // Completed full history is monotonic for this invocation. Clear history
    // is read again before admission, not on every poll of slow code workers.
    if (unsettledHistory())
      observeHistory(await readFullValidationRequirement(client, current, now, historyContext));
    if (unsettledHistory()) {
      reason = history.reason;
    } else {
      const runs = await client.list(
        `actions/workflows/${workflow.id}/runs?event=pull_request&head_sha=${expected.head}`,
        'workflow_runs',
      );
      const selected = selectCodeRun(runs, {
        identity: expected,
        workflowId: workflow.id as number,
        requiredFull,
        fullAfter,
        fullAtOrAfter,
      });
      if (selected.status === 'invalid') throw new Error(selected.reason);
      reason = selected.status === 'pending' ? selected.reason : '';
      if (selected.status === 'ready') {
        const { run } = selected;
        const [jobs, checks] = await Promise.all([
          client.list(`actions/runs/${run.id}/jobs?filter=all`, 'jobs'),
          client.list(`check-suites/${run.suiteId}/check-runs?filter=latest`, 'check_runs'),
        ]);
        let admitted = admitCodeChecks(run, jobs, checks, requiredFull);
        if (admitted.status === 'invalid') throw new Error(admitted.reason);
        if (admitted.status === 'ready') {
          const final = await currentPullRequest(client, expected.number);
          assertCurrentSource(expected, final.identity);
          if (
            final.identity.tested !== tested ||
            final.identity.title !== first.identity.title ||
            final.identity.body !== first.identity.body
          )
            throw new Error('PR changed before policy validation completed.');
          observeHistory(await readFullValidationRequirement(client, final, now, historyContext));
          if (!unsettledHistory()) {
            const fresh = selectCodeRun(runs, {
              identity: expected,
              workflowId: workflow.id as number,
              requiredFull,
              fullAfter,
              fullAtOrAfter,
            });
            if (fresh.status === 'invalid') throw new Error(fresh.reason);
            admitted = admitCodeChecks(run, jobs, checks, requiredFull);
          }
          if (admitted.status === 'invalid') throw new Error(admitted.reason);
          if (!unsettledHistory() && admitted.status === 'ready')
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
              fullReason: requiredFull ? fullReason : null,
              fullAfter:
                requiredFull && fullAfter !== null ? new Date(fullAfter).toISOString() : null,
              fullAtOrAfter:
                requiredFull && fullAtOrAfter !== null
                  ? new Date(fullAtOrAfter).toISOString()
                  : null,
            };
          reason = unsettledHistory()
            ? history.reason
            : admitted.status === 'pending'
              ? admitted.reason
              : reason;
        } else {
          reason = admitted.reason;
        }
      }
    }
    if (now() >= deadline) break;
    console.log(`Waiting for genuine code-check admission: ${reason}`);
    await pause(Math.min(60_000, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  throw new Error(
    `Code validation was not admitted before the deadline: ${reason} Check the CI router credential and current CI run; rerun policy after fixing the prerequisite.`,
  );
}

/** Issue only complete history, independently of title validity or code outcome.
 * A known bounded full obligation may proceed to admission without a certificate.
 * No unknown/pending event can be compressed into a clear prefix. */
interface HistoryPhaseOptions {
  client: PrReader;
  event: unknown;
  tested: string;
  invocation: PolicyInvocation;
  now?: () => number;
  pause?: (milliseconds: number) => Promise<unknown>;
  timeoutMs?: number;
}

async function runHistoryPhase(options: HistoryPhaseOptions, phase: 'adoption' | 'issuance') {
  const now = options.now ?? Date.now;
  const pause = options.pause ?? setTimeout;
  const expected = parsePullRequestEvent(options.event, options.client.repository);
  const deadline = now() + (options.timeoutMs ?? 90 * 60_000);
  let reason = 'History has not been proved complete.';
  do {
    const current = await currentPullRequest(options.client, expected.number);
    assertCurrentSource(expected, current.identity);
    if (current.identity.tested !== options.tested)
      throw new Error('History issuer no longer matches the current tested merge.');
    const history = await readFullValidationRequirement(options.client, current, now, {
      invocation: options.invocation,
      phase,
    });
    reason = history.reason;
    const boundedFull = history.state === 'full' && history.after !== null && !history.pending;
    const marker =
      phase === 'adoption' && history.adoptionReady !== undefined
        ? adoptionMarker(history.adoptionReady)
        : history.checkpoint || boundedFull
          ? phase === 'issuance' && history.checkpoint
            ? historyCheckpointMarker(history.checkpoint)
            : null
          : undefined;
    if (marker !== undefined) {
      const final = await currentPullRequest(options.client, expected.number);
      assertCurrentSource(expected, final.identity);
      if (
        final.identity.tested !== options.tested ||
        final.identity.title !== current.identity.title ||
        final.identity.body !== current.identity.body
      )
        throw new Error('PR changed before history issuance completed.');
      return marker;
    }
    if (now() >= deadline) break;
    console.log(`Waiting for complete policy history: ${reason}`);
    await pause(Math.min(60_000, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  throw new Error(`PR history was not sealed: ${reason}`);
}

export const capturePrHistory = (options: HistoryPhaseOptions) =>
  runHistoryPhase(options, 'issuance');
export const prepareLegacyAdoption = (options: HistoryPhaseOptions) =>
  runHistoryPhase(options, 'adoption');

if (import.meta.main) {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request')
    throw new Error('Policy requires a pull_request event.');
  const event: unknown = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  const client = new PrGitHub(process.env.GITHUB_REPOSITORY!, process.env.GH_TOKEN!);
  const identity = parsePullRequestEvent(event, client.repository);
  assertPullRequestCheckout(identity, process.env.GITHUB_SHA!);
  const invocation: PolicyInvocation = {
    id: Number(process.env.GITHUB_RUN_ID),
    sequence: Number(process.env.GITHUB_RUN_NUMBER),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    action: object(event) ? String(event.action) : '',
    base: identity.base,
    head: identity.head,
    tested: process.env.GITHUB_SHA!,
  };
  if (['history', 'adoption'].includes(process.argv[2] ?? '')) {
    const operation = process.argv[2] === 'adoption' ? prepareLegacyAdoption : capturePrHistory;
    const marker = await operation({
      client,
      event,
      tested: process.env.GITHUB_SHA!,
      invocation,
    });
    if (!process.env.GITHUB_OUTPUT)
      throw new Error('The checkpoint output channel is unavailable.');
    if (marker) appendFileSync(process.env.GITHUB_OUTPUT, `marker=${marker}\n`);
    console.log(
      marker ?? 'No new history marker issued; ordinary genuine code admission remains required.',
    );
  } else {
    const result = await validatePrPolicy({
      client,
      event,
      invocation,
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
}
