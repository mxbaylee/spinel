import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { faviconSvg } from '../../src/ui/favicon.ts';

export type StorybookIdentity = {
  sha: string;
  checkedOutSha: string;
  branch: string;
  pullRequest: number | null;
  workflowUrl: string | null;
  builtAt: string;
};

/** A proposal cannot outlive its implementation ticket or hide behind a generic group. */
export function validateRedesignStories(
  entries: Record<string, { type: string; title: string }>,
  openTickets: readonly string[],
) {
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.type !== 'story' || !entry.title.startsWith('Redesign/')) continue;
    const ticket = /^Redesign\/(SPN-\d{3,}) /.exec(entry.title)?.[1];
    if (!ticket || !openTickets.includes(ticket))
      throw new Error(`${id}: Redesign stories must name an open owning ticket in their title.`);
  }
}

export function stampStorybook(directory: string, identity: StorybookIdentity) {
  if (![identity.sha, identity.checkedOutSha].every((sha) => /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('Storybook identity requires complete source and checkout SHAs.');
  }
  writeFileSync(join(directory, 'sha.json'), `${JSON.stringify(identity, null, 2)}\n`);
  // Match the application's current gem geometry/palette, including OS dark mode.
  writeFileSync(join(directory, 'favicon.svg'), faviconSvg());
  for (const name of ['index.html', 'iframe.html']) {
    const file = join(directory, name);
    const html = readFileSync(file, 'utf8').replace(
      /<link\b(?=[^>]*\brel=["'](?:shortcut )?icon["'])[^>]*>/gi,
      '',
    );
    if (!html.includes('</head>')) throw new Error(`Missing head in ${name}`);
    writeFileSync(
      file,
      html.replace(
        '</head>',
        `<link rel="icon" type="image/svg+xml" sizes="any" href="./favicon.svg?v=${identity.sha}"></head>`,
      ),
    );
  }
}

if (import.meta.main) {
  const index = JSON.parse(readFileSync('storybook-static/index.json', 'utf8'));
  validateRedesignStories(
    index.entries,
    readdirSync('docs/todo')
      .filter((name) => /^SPN-\d+\.md$/.test(name))
      .map((name) => name.slice(0, -3)),
  );
  const checkedOutSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    : {};
  const pr = event.pull_request;
  stampStorybook('storybook-static', {
    sha: pr?.head?.sha ?? checkedOutSha,
    checkedOutSha,
    branch:
      pr?.head?.ref ??
      process.env.GITHUB_REF_NAME ??
      execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    pullRequest: pr?.number ?? null,
    workflowUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    builtAt: new Date().toISOString(),
  });
}
