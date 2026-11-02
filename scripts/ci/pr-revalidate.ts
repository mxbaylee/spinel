import { appendFileSync, readFileSync } from 'node:fs';
import { exactTextEdit, parsePullRequestEvent, REVALIDATE_LABEL } from './pr-identity.ts';
import { assertCurrentSource, currentPullRequest } from './pr-policy.ts';
import { PrGitHub } from './pr-github.ts';

/** Trusted-base code only. The App can add one label; it cannot write code,
 * publish checks, change protections, or substitute a dispatched validation. */
export async function routePrEdit(
  event: unknown,
  reader: Pick<PrGitHub, 'repository' | 'get' | 'list' | 'removeLabel'>,
  writer?: Pick<PrGitHub, 'addLabel'>,
) {
  const expected = parsePullRequestEvent(event, reader.repository);
  const current = await currentPullRequest(reader, expected.number);
  assertCurrentSource(expected, current.identity);
  if (exactTextEdit(event)) return { route: 'policy' as const, number: expected.number };
  if (!writer) return { route: 'full' as const, number: expected.number };

  // The ordinary token's removal does not emit a workflow event. The App's
  // addition does. Leave the label present so a concurrent code push also runs
  // full coverage instead of cancelling the base obligation with a narrow run.
  if (current.labels.includes(REVALIDATE_LABEL))
    await reader.removeLabel(expected.number, REVALIDATE_LABEL);
  const beforeAdd = await currentPullRequest(reader, expected.number);
  assertCurrentSource(expected, beforeAdd.identity);
  await writer.addLabel(expected.number, REVALIDATE_LABEL);
  const after = await currentPullRequest(reader, expected.number);
  assertCurrentSource(expected, after.identity);
  if (!after.labels.includes(REVALIDATE_LABEL))
    throw new Error('Full-validation label was not retained.');
  return {
    route: 'requested' as const,
    number: expected.number,
    base: expected.base,
    head: expected.head,
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
