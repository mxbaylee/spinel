import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { coveragePlan, suiteIds, titleBodyOnly, verifyCoverage } from './plan.ts';
const base = 'a'.repeat(40),
  head = 'b'.repeat(40);
const pr = (action = 'synchronize', labels: string[] = [], changes?: unknown) => ({
  action,
  changes,
  pull_request: {
    base: { sha: base },
    head: { sha: head },
    labels: labels.map((name) => ({ name })),
  },
});
const all = (plan: ReturnType<typeof coveragePlan>) =>
  Object.fromEntries(suiteIds.map((id) => [id, plan.suites[id].selected ? 'success' : 'skipped']));

test('metadata requires exact title/body edit payload and a proved immutable range', () => {
  for (const changes of [
    { title: { from: 'Old title' } },
    { body: { from: null } },
    { title: { from: '' }, body: { from: '' } },
  ]) {
    const event = pr('edited', ['ci-full'], changes);
    assert.equal(titleBodyOnly('pull_request', event), true);
    const plan = coveragePlan('pull_request', event, ['server/app.ts'], head);
    assert.equal(plan.mode, 'metadata');
    assert.deepEqual(
      suiteIds.filter((id) => plan.suites[id].selected),
      ['pull-request'],
    );
    assert.equal(coveragePlan('pull_request', event, null, head).mode, 'full');
  }
  for (const changes of [
    undefined,
    {},
    [],
    { base: { ref: { from: 'main' } } },
    { title: { from: 'Old' }, base: {} },
    { title: {} },
    { title: { from: null } },
    { body: { from: '', surprise: true } },
    { unknown: { from: '' } },
  ]) {
    const event = pr('edited', [], changes);
    assert.equal(titleBodyOnly('pull_request', event), false);
    assert.equal(coveragePlan('pull_request', event, ['docs/notes.md']).mode, 'full');
  }
});

test('service changes keep candidate correctness and all existing broad checks without historical comparisons', () => {
  const plan = coveragePlan('pull_request', pr(), ['src/server/auth/passkeys.ts']);
  for (const id of [
    'typecheck',
    'unit-tests',
    'playwright-run',
    'container-smoke',
    'sync-transition',
    'doc-responsiveness',
    'doc-callback-lifetimes',
  ] as const)
    assert.equal(plan.suites[id].selected, true, id);
  assert.equal(plan.suites['responsiveness-baseline'].selected, false);
  assert.equal(plan.suites['callback-baseline'].selected, false);
  assert.equal(plan.suites['lib-test-run'].selected, false);
  assert.equal(plan.suites['phone-compatibility'].selected, false);
});

test('dependency closure and unknown paths fail closed, including old rename/deleted sides', () => {
  for (const path of [
    'web/nativeDocInput.ts',
    'src/server/history/restore.ts',
    'src/server/sync/http.ts',
    'server/database.ts',
    'package-lock.json',
    '.nvmrc',
    'vite.config.ts',
    'e2e/doc-responsiveness.spec.ts',
    'scripts/dependencies/patch-univer-docs.ts',
  ]) {
    const plan = coveragePlan('pull_request', pr(), [path, 'docs/deleted.md']);
    assert.equal(plan.suites['responsiveness-baseline'].selected, true, path);
    assert.equal(plan.suites['callback-baseline'].selected, true, path);
  }
  for (const path of ['unrecognized/runtime.ts', 'docs/unknown.json', 'src/new-domain.ts']) {
    const plan = coveragePlan('pull_request', pr(), [path]);
    assert.equal(plan.mode, 'full');
    assert.ok(suiteIds.every((id) => plan.suites[id].selected));
  }
  for (const path of [
    'lib/sync-server/store.ts',
    'package-lock.json',
    'scripts/dependencies/patch-univer-core.ts',
  ])
    assert.equal(coveragePlan('pull_request', pr(), [path]).suites['lib-test-run'].selected, true);
});

test('labels only add coverage; removal recomputes automatic requirements', () => {
  const paths = ['src/server/workspace/grants.ts'];
  const ordinary = coveragePlan('pull_request', pr('unlabeled'), paths);
  for (const label of ['ci-performance', 'ci-full']) {
    const added = coveragePlan('pull_request', pr('labeled', [label]), paths);
    for (const id of suiteIds)
      if (ordinary.suites[id].selected) assert.equal(added.suites[id].selected, true, id);
    assert.equal(added.suites['responsiveness-baseline'].selected, true);
  }
  const removed = coveragePlan('pull_request', pr('unlabeled'), ['web/docHistory.ts']);
  assert.equal(removed.suites['responsiveness-baseline'].selected, true);
  const docsPerformance = coveragePlan('pull_request', pr('labeled', ['ci-performance']), [
    'docs/notes.md',
  ]);
  assert.equal(docsPerformance.suites['doc-responsiveness'].selected, true);
  assert.equal(docsPerformance.suites['callback-baseline'].selected, true);
});

test('main ranges, scheduled/manual backstops, unknown events and missing ranges', () => {
  const main = coveragePlan('push', { before: base, after: head }, [
    'src/server/backup/service.ts',
  ]);
  assert.equal(main.base, base);
  assert.equal(main.head, head);
  assert.equal(main.suites['unit-tests'].selected, true);
  for (const name of ['schedule', 'workflow_dispatch', 'unknown']) {
    const plan = coveragePlan(name, {}, []);
    assert.equal(plan.mode, 'full');
    assert.ok(
      suiteIds.filter((id) => id !== 'pull-request').every((id) => plan.suites[id].selected),
    );
  }
  for (const [event, paths] of [
    [pr(), null],
    [pr(), []],
    [{}, ['docs/notes.md']],
  ] as const)
    assert.equal(
      coveragePlan('pull_request', event, paths === null ? null : [...paths]).mode,
      'full',
    );
});

test('aggregates require selected success and explicit inapplicable skipped; known regression remains red', () => {
  const plan = coveragePlan('pull_request', pr(), ['src/server/auth/session.ts']);
  const result = all(plan);
  assert.equal(verifyCoverage(plan, 'success', result, suiteIds).length, suiteIds.length);
  for (const status of [undefined, 'failure', 'cancelled', 'skipped', '']) {
    assert.throws(
      () => verifyCoverage(plan, 'success', { ...result, 'doc-responsiveness': status }, suiteIds),
      /Incomplete coverage/,
    );
  }
  assert.throws(() =>
    verifyCoverage(plan, 'success', { ...result, 'lib-test-run': 'success' }, suiteIds),
  );
  for (const classification of ['failure', 'cancelled', 'skipped', ''])
    assert.throws(() => verifyCoverage(plan, classification, result, suiteIds));
  for (const malformed of [null, {}, { ...plan, suites: {} }, { ...plan, mode: 'metadata' }])
    assert.throws(() => verifyCoverage(malformed, 'success', result, suiteIds));
});

test('workflow keeps seven exact code names, unique metadata names and protected concurrency', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const name of [
    'Backlog',
    'Lint',
    'Typecheck',
    'Unit tests',
    'Lib tests',
    'Playwright smoke',
  ])
    assert.ok(workflow.includes(`'Metadata only - ${name}' || '${name}'`), name);
  assert.match(workflow, /name: Pull request\n/);
  assert.match(workflow, /format\('event-\{0\}', github.run_id\)/);
  assert.match(workflow, /cancel-in-progress:.*github.event.action == 'synchronize'/);
  assert.match(workflow, /types: \[opened, edited, synchronize, reopened, labeled, unlabeled\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.ok(!workflow.includes('needs.changes.outputs.docs_only'));
});

test('phone ownership removes only six ordinary cases from instrumented duplicate runs', () => {
  const spec = readFileSync(new URL('../../e2e/doc-mobile.spec.ts', import.meta.url), 'utf8');
  assert.equal(spec.match(/@phone-ordinary/g)?.length, 3); // parameterized 3 zoom + 1 formulas + 2 traditional
  for (const title of [
    'phone guest Doc reader cannot write',
    'phone Doc typing keeps the rendered caret',
    'a peer-protocol page-layout change preserves',
  ]) {
    const start = spec.indexOf(title);
    assert.ok(start >= 0);
    assert.ok(!spec.slice(start, spec.indexOf('async', start)).includes('@phone-ordinary'));
  }
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /SPINEL_CI_FULL_COMPATIBILITY === 'false'/);
  assert.equal(config.match(/grepInvert: syncExclusions/g)?.length, 2);
});
