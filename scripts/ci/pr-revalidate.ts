import { appendFileSync, readFileSync } from 'node:fs';
import { exactTextEdit, parsePullRequestEvent, REVALIDATE_LABEL } from './pr-identity.ts';
import { currentPullRequest } from './pr-state.ts';
import { PrGitHub } from './pr-github.ts';

/** Trusted-base code only. The App has Pull requests: write; this client uses
 * it only to add the reserved label. It has no code/check/admin write scope. */
export async function routePrEdit(
  event: unknown,
  reader: Pick<PrGitHub, 'repository' | 'get' | 'list' | 'removeLabel'>,
  writer?: Pick<PrGitHub, 'addLabel'>,
) {
  const expected = parsePullRequestEvent(event, reader.repository);
  const requireOpenMain = (state: Awaited<ReturnType<typeof currentPullRequest>>) => {
    if (state.identity.state !== 'open' || state.identity.baseRef !== 'main')
      throw new Error('Routing requires the same open PR targeting main.');
  };
  const current = await currentPullRequest(reader, expected.number);
  requireOpenMain(current);
  // Even a historical full obligation must not turn a later text edit into a
  // code event. Policy and code classification independently retain that duty.
  if (exactTextEdit(event)) return { route: 'policy' as const, number: expected.number };
  if (!writer) return { route: 'full' as const, number: expected.number };

  // The ordinary token's removal does not emit a workflow event. The App's
  // addition does. Leave the label present so a concurrent code push also runs
  // full coverage instead of cancelling the base obligation with a narrow run.
  // Apply the request to the live PR even if a source push overtook this edit;
  // the emitted label event supplies its own current immutable source/base.
  if (current.labels.includes(REVALIDATE_LABEL))
    await reader.removeLabel(expected.number, REVALIDATE_LABEL);
  const beforeAdd = await currentPullRequest(reader, expected.number);
  requireOpenMain(beforeAdd);
  await writer.addLabel(expected.number, REVALIDATE_LABEL);
  const after = await currentPullRequest(reader, expected.number);
  requireOpenMain(after);
  if (!after.labels.includes(REVALIDATE_LABEL))
    throw new Error('Full-validation label was not retained.');
  return {
    route: 'requested' as const,
    number: expected.number,
    base: after.identity.base,
    head: after.identity.head,
  };
}

if (import.meta.main) {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request_target')
    throw new Error('Privileged routing requires a trusted pull_request_target event.');
  const event: unknown = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  const reader = new PrGitHub(process.env.GITHUB_REPOSITORY!, process.env.GH_TOKEN!);
  const identity = parsePullRequestEvent(event, reader.repository);
  if (identity.baseRef !== 'main' || process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('The router may execute only the trusted main branch.');
  const command = process.argv[2];
  if (!['plan', 'route'].includes(command)) throw new Error('Expected plan or route.');
  const writer =
    command === 'route' ? new PrGitHub(reader.repository, process.env.ROUTER_TOKEN!) : undefined;
  const result = await routePrEdit(event, reader, writer);
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `full=${result.route === 'full'}\n`);
}
