import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

// Deliberately narrow: Markdown under docs may describe executable examples,
// but .ts/.tsx design mockups and unknown JSON still need the full suite.
export function documentationOnly(paths: string[]): boolean {
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        /^(README|AGENTS|THIRD-PARTY-NOTICES)\.md$/.test(path) ||
        /^docs\/.+\.md$/.test(path) ||
        path === 'docs/todo/backlog.json',
    )
  );
}

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
  let docsOnly = false;
  try {
    docsOnly = documentationOnly(
      changedPaths(
        process.env.GITHUB_EVENT_NAME ?? '',
        JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')),
      ),
    );
  } catch {
    console.log('Change classification unavailable; running full validation.');
  }
  console.log(
    docsOnly
      ? 'Documentation-only change: backlog and lint checks remain required.'
      : 'Full validation required.',
  );
  appendFileSync(process.env.GITHUB_OUTPUT!, `docs_only=${docsOnly}\n`);
}
