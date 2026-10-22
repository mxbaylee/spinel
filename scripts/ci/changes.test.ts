import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { changedPaths, documentationOnly } from './changes.ts';

test('only known documentation paths qualify, including the exact backlog JSON', () => {
  assert.equal(
    documentationOnly(['docs/todo/SPN-035.md', 'docs/todo/backlog.json', 'README.md']),
    true,
  );
  for (const path of [
    'package.json',
    'package-lock.json',
    'docs/config.json',
    'docs/design/mockup.tsx',
    '.github/workflows/ci.yml',
    'scripts/ci/changes.ts',
    'src/help.md',
    'unknown.md',
  ]) {
    assert.equal(documentationOnly(['docs/todo/SPN-035.md', path]), false, path);
  }
  assert.equal(documentationOnly([]), false);
});

test('unavailable or unsupported event ranges require full validation', () => {
  for (const [name, event] of [
    ['workflow_dispatch', {}],
    ['push', { before: '0'.repeat(40), after: 'a'.repeat(40) }],
    ['pull_request', {}],
    ['push', null],
  ] as const) {
    assert.throws(() => changedPaths(name, event), /full validation required/);
  }
});

test('Git ranges include earlier commits, both rename paths, deletions and unusual names', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'spinel-ci-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'CI test');
    git('config', 'user.email', 'ci@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.hooksPath', '/dev/null');
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'runtime.ts'), 'export const value = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    git('mv', 'runtime.ts', 'docs/example.md');
    git('commit', '-qm', 'move code to docs');
    writeFileSync(join(cwd, 'docs/title\nwith spaces.md'), '# Notes\n');
    git('add', '.');
    git('commit', '-qm', 'latest docs');
    const head = git('rev-parse', 'HEAD');
    const paths = changedPaths('push', { before: base, after: head }, cwd);
    assert.deepEqual(paths.sort(), ['docs/example.md', 'docs/title\nwith spaces.md', 'runtime.ts']);
    assert.equal(documentationOnly(paths), false);
    // Base branch changes after divergence must not make a code PR look docs-only.
    git('checkout', '-qb', 'base-side', base);
    mkdirSync(join(cwd, 'docs'), { recursive: true });
    writeFileSync(join(cwd, 'docs/base.md'), '# Base\n');
    git('add', '.');
    git('commit', '-qm', 'base change');
    const docsHead = git('rev-parse', 'HEAD');
    const eventPath = join(cwd, 'event.json');
    const outputPath = join(cwd, 'output');
    writeFileSync(eventPath, JSON.stringify({ before: base, after: docsHead }));
    execFileSync(process.execPath, [fileURLToPath(new URL('./changes.ts', import.meta.url))], {
      cwd,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
      },
    });
    assert.equal(readFileSync(outputPath, 'utf8'), 'docs_only=true\n');
    assert.deepEqual(
      changedPaths(
        'pull_request',
        { pull_request: { base: { sha: git('rev-parse', 'HEAD') }, head: { sha: head } } },
        cwd,
      ).sort(),
      paths,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
