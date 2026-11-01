import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { coveragePlan, documentationOnly } from './plan.ts';
export { documentationOnly } from './plan.ts';

export function changedPaths(eventName: string, event: unknown, cwd = process.cwd()): string[] {
  const payload = event as {
    before?: string;
    after?: string;
    pull_request?: { base?: { sha?: string }; head?: { sha?: string } };
  };
  const base = eventName === 'pull_request' ? payload?.pull_request?.base?.sha : payload?.before;
  const head = eventName === 'pull_request' ? payload?.pull_request?.head?.sha : payload?.after;
  if (
    !['push', 'pull_request'].includes(eventName) ||
    ![base, head].every(
      (sha) => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha),
    )
  ) {
    throw new Error('No reliable commit range; full validation required.');
  }
  // PRs compare against their merge base; pushes include every pushed commit.
  // Disable rename detection so moving code into docs cannot hide its old path.
  return execFileSync(
    'git',
    [
      'diff',
      '--no-renames',
      '--name-only',
      '-z',
      `${base}${eventName === 'pull_request' ? '...' : '..'}${head}`,
      '--',
    ],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
}

if (import.meta.main) {
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  let event: unknown = null;
  let paths: string[] | null = null;
  try {
    event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'));
    paths = changedPaths(eventName, event);
  } catch {
    console.log('Change classification unavailable; running full validation.');
  }
  let plan = coveragePlan(eventName, event, paths, process.env.GITHUB_SHA);
  // Actions limits job outputs. Oversized classification must select full, not
  // silently lose a decision or truncate paths into an unsafe narrow plan.
  if (Buffer.byteLength(JSON.stringify(plan)) > 64 * 1024)
    plan = coveragePlan(eventName, event, null, process.env.GITHUB_SHA);
  const json = JSON.stringify(plan);
  const digest = createHash('sha256').update(json).digest('hex');
  writeFileSync('ci-plan.json', json + '\n');
  console.log(JSON.stringify(plan, null, 2));
  appendFileSync(
    process.env.GITHUB_OUTPUT!,
    [
      `docs_only=${documentationOnly(paths ?? []) && plan.mode === 'targeted'}`,
      `mode=${plan.mode}`,
      `plan=${json}`,
      `plan_sha256=${digest}`,
      ...Object.entries(plan.suites).map(
        ([id, suite]) => `${id.replaceAll('-', '_')}=${suite.selected}`,
      ),
    ].join('\n') + '\n',
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Immutable CI coverage plan\n\nSHA-256: ${digest}\n\n` +
        '```json\n' +
        JSON.stringify(plan, null, 2) +
        '\n```\n',
    );
}
