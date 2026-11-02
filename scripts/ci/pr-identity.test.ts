import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  codeCheckNames,
  exactTextEdit,
  formatCodeRunName,
  parseCodeRunName,
  parsePullRequestEvent,
  REVALIDATE_LABEL,
} from './pr-identity.ts';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const tested = 'c'.repeat(40);
const repository = 'mxbaylee/spinel';
const event = () => ({
  action: 'edited',
  number: 231,
  repository: { full_name: repository },
  changes: { title: { from: 'Old title' } },
  pull_request: {
    number: 231,
    title: '🪶 SPN-129 Validate PR text edits without replacing code evidence',
    body: 'A body with literal `$(commands)` and\nnewlines.',
    state: 'open',
    base: { sha: base, ref: 'main', repo: { full_name: repository } },
    head: {
      sha: head,
      ref: 'codex/spn-129-pr-metadata-validation',
      repo: { full_name: repository },
    },
    merge_commit_sha: tested,
  },
});

test('only exact title/body changes avoid full validation', () => {
  for (const changes of [
    { title: { from: '' } },
    { body: { from: null } },
    { title: { from: 'Prior title' }, body: { from: 'Prior body' } },
  ])
    assert.equal(exactTextEdit({ ...event(), changes }), true);
  for (const changes of [
    undefined,
    null,
    [],
    {},
    { title: {} },
    { title: { from: null } },
    { title: { from: 1 } },
    { body: { from: false } },
    { body: [] },
    { body: { from: '', extra: true } },
    { base: { ref: { from: 'main' } } },
    { title: { from: 'Prior title' }, base: { ref: { from: 'main' } } },
    { title: { from: 'Prior title' }, unknown: { from: '' } },
  ])
    assert.equal(exactTextEdit({ ...event(), changes }), false, JSON.stringify(changes));
  for (const raw of [null, [], {}, { ...event(), action: 'synchronize' }])
    assert.equal(exactTextEdit(raw), false);
});

test('PR identity keeps immutable sources separate from names and treats metadata as data', () => {
  const raw = event();
  raw.pull_request.head.repo.full_name = 'contributor/spinel-fork';
  const parsed = parsePullRequestEvent(raw, repository);
  assert.deepEqual(parsed, {
    number: 231,
    repository,
    headRepository: 'contributor/spinel-fork',
    base,
    head,
    tested,
    baseRef: 'main',
    headRef: 'codex/spn-129-pr-metadata-validation',
    title: raw.pull_request.title,
    body: raw.pull_request.body,
    state: 'open',
  });
  raw.pull_request.base.sha = 'd'.repeat(40);
  raw.pull_request.title = 'Later title';
  assert.equal(parsed.base, base);
  assert.notEqual(parsed.title, raw.pull_request.title);
});

test('missing, substituted or malformed PR identities cannot be silently repaired', () => {
  const raw = event();
  for (const invalid of [
    null,
    [],
    {},
    { ...raw, number: 232 },
    { ...raw, number: '231' },
    { ...raw, repository: { full_name: 'attacker/spinel' } },
    { ...raw, pull_request: { ...raw.pull_request, number: 0 } },
    { ...raw, pull_request: { ...raw.pull_request, state: 'unknown' } },
    { ...raw, pull_request: { ...raw.pull_request, body: undefined } },
    { ...raw, pull_request: { ...raw.pull_request, title: null } },
    { ...raw, pull_request: { ...raw.pull_request, merge_commit_sha: 'c'.repeat(39) } },
    {
      ...raw,
      pull_request: {
        ...raw.pull_request,
        base: { ...raw.pull_request.base, repo: { full_name: 'attacker/spinel' } },
      },
    },
    {
      ...raw,
      pull_request: {
        ...raw.pull_request,
        head: { ...raw.pull_request.head, repo: null },
      },
    },
    ...['0'.repeat(40), 'b'.repeat(39), 'B'.repeat(40), head + '\n'].map((sha) => ({
      ...raw,
      pull_request: { ...raw.pull_request, head: { ...raw.pull_request.head, sha } },
    })),
    ...['', 'branch\nname', 'branch\0name'].map((ref) => ({
      ...raw,
      pull_request: { ...raw.pull_request, base: { ...raw.pull_request.base, ref } },
    })),
  ])
    assert.throws(() => parsePullRequestEvent(invalid, repository), /Invalid pull request/);
  assert.throws(() => parsePullRequestEvent(raw, 'https://github.com/mxbaylee/spinel'));
});

test('uncomputed merge identity stays unavailable rather than falling back to head', () => {
  for (const merge_commit_sha of [null, undefined]) {
    const raw = event();
    assert.equal(
      parsePullRequestEvent(
        { ...raw, pull_request: { ...raw.pull_request, merge_commit_sha, body: null } },
        repository,
      ).tested,
      null,
    );
  }
});

test('run identity preserves base/head/tested/full separately and rejects ambiguous text', () => {
  const identity = { number: 231, base, head, tested, full: false };
  const expected = `CI pr=231 base=${base} head=${head} tested=${tested} full=0`;
  assert.equal(formatCodeRunName(identity), expected);
  assert.deepEqual(parseCodeRunName(expected), identity);
  assert.deepEqual(parseCodeRunName(expected.slice(0, -1) + '1'), { ...identity, full: true });
  for (const invalid of [
    null,
    {},
    expected + '\n',
    ' ' + expected,
    expected + ' trailing',
    expected.replace('pr=231', 'pr=0231'),
    expected.replace('pr=231', 'pr=0'),
    expected.replace('pr=231', 'pr=9007199254740993'),
    expected.replace(`base=${base}`, `base=${'0'.repeat(40)}`),
    expected.replace(`tested=${tested}`, `tested=${'f'.repeat(39)}`),
    expected.replace('full=0', 'full=false'),
    expected.replace('full=0', 'full=2'),
    expected.replace(`head=${head}`, `head=${head.toUpperCase()}`),
  ])
    assert.throws(() => parseCodeRunName(invalid), /Invalid CI run identity/);
  assert.throws(() => formatCodeRunName({ ...identity, number: -1 }), /Invalid CI/);
  assert.throws(() => formatCodeRunName({ ...identity, tested: '' }), /Invalid CI/);
  assert.throws(
    () => formatCodeRunName({ ...identity, full: 'false' } as unknown as typeof identity),
    /Invalid CI/,
  );
});

test('reserved route label cannot impersonate a code verdict or policy check', () => {
  assert.equal(REVALIDATE_LABEL, 'ci-revalidate');
  assert.deepEqual(codeCheckNames, [
    'Backlog',
    'Lint',
    'Typecheck',
    'Unit tests',
    'Lib tests',
    'Playwright smoke',
  ]);
  const names: readonly string[] = codeCheckNames;
  assert.ok(!names.includes('Pull request'));
  assert.ok(!names.includes(REVALIDATE_LABEL));
});
