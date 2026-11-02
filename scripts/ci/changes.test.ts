import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertPullRequestCheckout,
  changedPaths,
  documentationOnly,
  pullRequestFullReason,
} from './changes.ts';
import type { PrReader } from './pr-state.ts';

const repository = 'mxbaylee/spinel';
const createdAt = '2026-11-01T12:00:00Z';
const sourceEvent = () => ({
  action: 'synchronize',
  number: 231,
  repository: { full_name: repository },
  pull_request: {
    number: 231,
    base: { sha: 'a'.repeat(40), ref: 'main', repo: { full_name: repository } },
    head: { sha: 'b'.repeat(40), ref: 'feature', repo: { full_name: repository } },
    merge_commit_sha: 'c'.repeat(40),
    state: 'open',
    title: 'A current title',
    body: null,
    labels: [],
    created_at: createdAt,
  },
});

function historyFixture(
  options: {
    current?: unknown;
    timeline?: unknown[];
    pendingEdit?: boolean;
    failAt?: string;
  } = {},
) {
  const calls: string[] = [];
  const client: PrReader = {
    repository,
    async get(path) {
      calls.push(path);
      if (options.failAt === path) throw new Error('Required API is unavailable.');
      if (path === 'pulls/231') return options.current ?? sourceEvent().pull_request;
      assert.equal(path, 'actions/workflows/pr-policy.yml');
      return { id: 42, path: '.github/workflows/pr-policy.yml' };
    },
    async list(path, key) {
      calls.push(path);
      if (options.failAt === path) throw new Error('History pagination did not complete.');
      if (path === 'issues/231/timeline') {
        assert.equal(key, '');
        return options.timeline ?? [];
      }
      if (path.startsWith('actions/workflows/42/runs?')) {
        assert.equal(key, 'workflow_runs');
        return options.pendingEdit
          ? [
              {
                id: 10,
                workflow_id: 42,
                path: '.github/workflows/pr-policy.yml',
                event: 'pull_request',
                repository: { full_name: repository },
                pull_requests: [{ number: 231 }],
                head_sha: 'b'.repeat(40),
                created_at: createdAt,
                run_attempt: 1,
                display_title: 'PR policy v1 pr=231 action=edited',
                status: 'queued',
                conclusion: null,
              },
            ]
          : [];
      }
      assert.equal(path, 'actions/runs/10/jobs?filter=all');
      assert.equal(key, 'jobs');
      return [];
    },
  };
  return { client, calls };
}

test('classification retains historical base or removed-label obligations without current labels', async () => {
  for (const entry of [
    { event: 'base_ref_changed' },
    { event: 'unlabeled', label: { name: 'ci-revalidate' } },
  ]) {
    const { client } = historyFixture({ timeline: [{ id: 1, created_at: createdAt, ...entry }] });
    const reason = await pullRequestFullReason(sourceEvent(), client);
    assert.match(reason!, /recorded base change|historical full-revalidation/);
  }
  const { client } = historyFixture();
  assert.equal(await pullRequestFullReason(sourceEvent(), client), undefined);
});

test('unavailable or still-pending edit history conservatively selects full coverage', async () => {
  for (const failAt of ['issues/231/timeline', 'actions/workflows/pr-policy.yml']) {
    const { client } = historyFixture({ failAt });
    assert.match(
      (await pullRequestFullReason(sourceEvent(), client))!,
      /full validation is required/,
    );
  }
  const { client } = historyFixture({ pendingEdit: true });
  assert.match(
    (await pullRequestFullReason(sourceEvent(), client))!,
    /Waiting for PR edit classification/,
  );
});

test('classification rejects stale live source/base before consulting a potentially clear history', async () => {
  const raw = sourceEvent();
  for (const current of [
    { ...raw.pull_request, state: 'closed' },
    { ...raw.pull_request, base: { ...raw.pull_request.base, sha: 'd'.repeat(40) } },
    { ...raw.pull_request, head: { ...raw.pull_request.head, sha: 'd'.repeat(40) } },
  ]) {
    const { client, calls } = historyFixture({ current });
    await assert.rejects(pullRequestFullReason(raw, client), /source or base changed/);
    assert.deepEqual(calls, ['pulls/231']);
  }
  const { client } = historyFixture({ failAt: 'pulls/231' });
  await assert.rejects(pullRequestFullReason(raw, client), /Required API is unavailable/);
});

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
    assert.match(readFileSync(outputPath, 'utf8'), /^docs_only=true\n/);
    const published = JSON.parse(readFileSync(join(cwd, 'ci-plan.json'), 'utf8'));
    assert.equal(published.base, base);
    assert.equal(published.head, docsHead);
    assert.equal(published.suites['unit-tests'].selected, false);
    assert.deepEqual(
      changedPaths(
        'pull_request',
        { pull_request: { base: { sha: git('rev-parse', 'HEAD') }, head: { sha: head } } },
        cwd,
      ).sort(),
      paths,
    );
    git('merge', '--no-ff', '-m', 'test merge', head);
    const tested = git('rev-parse', 'HEAD');
    assertPullRequestCheckout({ base: docsHead, head }, tested, cwd);
    assert.throws(
      () => assertPullRequestCheckout({ base: head, head: docsHead }, tested, cwd),
      /checkout does not match/,
    );
    assert.throws(
      () => assertPullRequestCheckout({ base, head }, tested, cwd),
      /checkout does not match/,
    );
    assert.throws(
      () => assertPullRequestCheckout({ base: docsHead, head }, head, cwd),
      /checkout does not match/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
