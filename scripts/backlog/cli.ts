// Backlog checker. See docs/todo/process.md for the rules it enforces.
//
//   node scripts/backlog/cli.ts check                 validate tickets and the index
//   node scripts/backlog/cli.ts index                 rewrite each ticket's score and docs/todo/readme.md
//   node scripts/backlog/cli.ts new <emoji> <title>   create the next ticket from the template
//   node scripts/backlog/cli.ts pr --base <ref> --title <title>
//                                                     check a PR against its base branch

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import {
  type Backlog,
  type BacklogIO,
  type Result,
  CONFIG_PATH,
  checkPullRequest,
  formatId,
  loadBacklog,
  renderIndex,
  scores,
  staleScores,
  validateBacklog,
  withScore,
} from './lib.ts';

const root = process.cwd();
const INDEX = 'docs/todo/readme.md';
const inActions = Boolean(process.env.GITHUB_ACTIONS);

function report({ errors, warnings }: Result): boolean {
  for (const w of warnings) console.log(inActions ? `::warning::${w}` : `warning: ${w}`);
  for (const e of errors) console.log(inActions ? `::error::${e}` : `error: ${e}`);
  if (errors.length) process.exitCode = 1;
  return errors.length === 0;
}

function args(list: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith('--')) out[list[i].slice(2)] = list[i + 1] ?? '';
    if (list[i].startsWith('--')) i++;
  }
  return out;
}

function gitIO(ref: string): BacklogIO {
  const git = (...a: string[]) =>
    execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const tryGit = (...a: string[]) => {
    try {
      return git(...a);
    } catch {
      return null;
    }
  };
  return {
    read: (p) => git('show', `${ref}:${p}`),
    exists: (p) => tryGit('cat-file', '-e', `${ref}:${p}`) !== null,
    list: (d) =>
      (tryGit('ls-tree', '--name-only', `${ref}:${d}`) ?? '').split('\n').filter(Boolean),
  };
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'check') {
  const backlog = loadBacklog(root);
  const result = validateBacklog(backlog);
  if (!result.errors.length) result.errors.push(...staleScores(backlog.tickets).errors);
  if (!result.errors.length && backlog.index !== renderIndex(backlog))
    result.errors.push(`${INDEX} is stale; run \`npm run backlog:index\` and commit the result`);
  if (report(result)) console.log(`backlog ok: ${backlog.tickets.length} open tickets`);
} else if (command === 'index') {
  const backlog = loadBacklog(root);
  const result = validateBacklog(backlog);
  if (report(result)) {
    const expected = scores(backlog.tickets);
    for (const t of backlog.tickets) {
      if (t.score === expected.get(t.id)) continue;
      const file = join(root, 'docs/todo', t.file);
      writeFileSync(file, withScore(readFileSync(file, 'utf8'), expected.get(t.id) ?? 0));
      console.log(`${t.id}: score ${t.score} → ${expected.get(t.id)}`);
    }
    // Reload so the index shows the scores just written; validating fills in titles.
    const updated = loadBacklog(root);
    validateBacklog(updated);
    writeFileSync(join(root, INDEX), renderIndex(updated));
    console.log(`wrote ${INDEX}`);
  }
} else if (command === 'new') {
  const [emoji, ...words] = rest;
  if (!emoji || !words.length) {
    console.error('usage: cli.ts new <emoji> <title>');
    process.exit(2);
  }
  const configPath = join(root, CONFIG_PATH);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const id = formatId(config.prefix, config.next_id);
  const personas = posix.relative('docs/todo', config.personas);
  const file = `docs/todo/${id}.md`;
  writeFileSync(
    join(root, file),
    `---
id: ${id}
emoji: ${emoji}
effort: M                # S | M | L | XL
# phase: pre_launch      # optional; pre_launch (default) | launch | post_launch
impact_owner: M          # S | M | L for each persona it touches; leave the rest out
score: 4                 # written by npm run backlog:index
depends_on: []
decisions: []
---

# ${emoji} ${id} ${words.join(' ')}

## Story

As the [Owner](${personas}#owner), I want <goal>, so that <value>.

## Scenarios

### <observable outcome>

Given <starting state>,
When <action>,
Then <result>.

## Rules

## Out of scope

## Verify

- <tests and what a reviewer should see>
`,
  );
  config.next_id += 1;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`created ${file}; next_id is now ${config.next_id}`);
} else if (command === 'pr') {
  const opts = args(rest);
  if (!opts.base || opts.title === undefined) {
    console.error('usage: cli.ts pr --base <ref> --title <title>');
    process.exit(2);
  }
  const head = loadBacklog(root);
  const headResult = validateBacklog(head);
  const baseIO = gitIO(opts.base);
  // The PR that introduces the backlog has no base backlog to compare against.
  const base: Backlog = baseIO.exists(CONFIG_PATH)
    ? loadBacklog(root, baseIO)
    : {
        config: {
          ...head.config,
          next_id: 1,
          grooming: { ...head.config.grooming, last: undefined, completed_since: [] },
        },
        tickets: [],
        strays: [],
        personasText: null,
      };
  const mergeBase = execFileSync('git', ['merge-base', opts.base, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const numstat = execFileSync('git', ['diff', '--numstat', mergeBase, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  // A broken head backlog is reported as-is; comparing it to the base would only crash.
  const result = headResult.errors.length
    ? headResult
    : checkPullRequest({ title: opts.title, base, head, numstat });
  if (report(result)) console.log('pull request ok');
} else {
  console.error(
    'usage: cli.ts check | index | new <emoji> <title> | pr --base <ref> --title <title>',
  );
  process.exit(2);
}
