import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { coveragePlan, suiteIds, verifyCoverage } from './plan.ts';
const base = 'a'.repeat(40),
  head = 'b'.repeat(40);
const automaticSuites = suiteIds.filter((id) => id !== 'doc-editing-mobile');
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

test('every PR edit runs full validation, including title/body, base and ambiguous payloads', () => {
  for (const changes of [
    { title: { from: 'Old title' } },
    { body: { from: null } },
    { title: { from: '' }, body: { from: '' } },
    { base: { ref: { from: 'main' } } },
    { title: { from: 'Old' }, base: {} },
    undefined,
    {},
    [],
    { title: {} },
    { title: { from: null } },
    { body: { from: '', surprise: true } },
    { unknown: { from: '' } },
  ]) {
    for (const paths of [['docs/notes.md'], ['src/server/auth/session.ts'], null]) {
      const plan = coveragePlan('pull_request', pr('edited', [], changes), paths, head);
      assert.equal(plan.mode, 'full');
      assert.ok(automaticSuites.every((id) => plan.suites[id].selected));
      // A later text edit must revalidate rather than hide failed base/code evidence.
      assert.throws(
        () =>
          verifyCoverage(
            plan,
            'success',
            {
              ...all(plan),
              'doc-responsiveness': 'failure',
            },
            suiteIds,
          ),
        /Incomplete coverage/,
      );
    }
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

test('the opt-in SPN-146 A/B stays tested without widening to full or performance coverage', () => {
  const experiment = [
    '.github/workflows/patch-ab.yml',
    'scripts/ci/patch-ab/toggle.ts',
    'scripts/ci/patch-ab/summarize.ts',
    'scripts/ci/patch-ab.test.ts',
  ];
  const plan = coveragePlan('pull_request', pr(), experiment, head);
  assert.equal(plan.mode, 'targeted');
  for (const id of ['unit-tests', 'lint', 'typecheck'] as const)
    assert.equal(plan.suites[id].selected, true, id);
  for (const id of [
    'restore-timing',
    'responsiveness-baseline',
    'callback-baseline',
    'lib-test-run',
    'phone-compatibility',
  ] as const)
    assert.equal(plan.suites[id].selected, false, id);
  // Each experiment path alone, including the workflow file, still runs the script tests, lint and typecheck.
  for (const path of experiment) {
    const alone = coveragePlan('pull_request', pr(), [path], head);
    assert.equal(alone.mode, 'targeted', path);
    for (const id of ['unit-tests', 'lint', 'typecheck'] as const)
      assert.equal(alone.suites[id].selected, true, `${path} ${id}`);
  }
  // Neighbouring workflow and CI script paths keep their full-coverage rule.
  for (const path of ['.github/workflows/spaces-acceptance.yml', 'scripts/ci/patch-ab-other.ts'])
    assert.equal(coveragePlan('pull_request', pr(), [path], head).mode, 'full', path);
  assert.equal(
    coveragePlan('pull_request', pr(), [...experiment, 'web/App.tsx'], head).mode,
    'targeted',
  );
  assert.equal(
    coveragePlan('pull_request', pr(), [...experiment, 'scripts/ci/plan.ts'], head).mode,
    'full',
  );
});

test('sized restore participates in the immutable plan and fails closed', () => {
  for (const path of [
    'src/server/auth/store.ts',
    'e2e/restore-browser.acceptance.ts',
    'web/BackupRestore.tsx',
    'scripts/ci/plan.ts',
    'unrecognized/input.ts',
  ]) {
    const plan = coveragePlan('pull_request', pr(), [path], head);
    assert.equal(plan.suites['restore-timing'].selected, true, path);
    for (const status of [undefined, 'skipped', 'failure', 'cancelled'])
      assert.throws(
        () =>
          verifyCoverage(plan, 'success', { ...all(plan), 'restore-timing': status }, [
            'restore-timing',
          ]),
        /Incomplete coverage restore-timing/,
      );
  }
  assert.equal(
    coveragePlan('pull_request', pr(), ['docs/backups.md'], head).suites['restore-timing'].selected,
    false,
  );
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /restore_timing: \$\{\{ steps.changes.outputs.restore_timing \}\}/);
  assert.match(workflow, /if: needs.changes.outputs.restore_timing == 'true'/);
  assert.match(workflow, /"restore-timing":"\$\{\{ needs.restore-timing.result \}\}"/);
  assert.match(workflow.slice(workflow.indexOf('  playwright:\n')), /restore-timing,/);
});

test('the extracted Doc touch raster keeps every browser owner and the sized restore dependency', () => {
  const original = coveragePlan('pull_request', pr(), ['e2e/doc-touch.ts'], head);
  const extracted = coveragePlan('pull_request', pr(), ['e2e/doc-touch-raster.ts'], head);
  assert.equal(extracted.mode, 'targeted');
  for (const id of suiteIds)
    assert.equal(extracted.suites[id].selected, original.suites[id].selected, id);
  for (const id of [
    'restore-timing',
    'playwright-run',
    'doc-responsiveness',
    'doc-callback-lifetimes',
    'responsiveness-baseline',
    'callback-baseline',
  ] as const)
    assert.equal(extracted.suites[id].selected, true, id);
  assert.ok(
    extracted.suites['restore-timing'].dependencies.some((path) =>
      path.includes('doc-touch-raster'),
    ),
  );
  assert.throws(
    () =>
      verifyCoverage(
        extracted,
        'success',
        { ...all(extracted), 'restore-timing': 'skipped' },
        suiteIds,
      ),
    /Incomplete coverage restore-timing/,
  );
  // The immutable diff retains the old dependency when it is deleted or moved
  // into documentation; only an unrelated similarly named helper stays outside.
  assert.equal(
    coveragePlan('pull_request', pr(), ['e2e/doc-touch-raster.ts', 'docs/raster-helper.md'], head)
      .suites['restore-timing'].selected,
    true,
  );
  for (const path of [
    'e2e/doc-touch-recorder.ts',
    'e2e/doc-touch-raster-unrelated.ts',
    'e2e/doc-touch-raster/notes.ts',
    'docs/doc-touch-raster.md',
  ])
    assert.equal(
      coveragePlan('pull_request', pr(), [path], head).suites['restore-timing'].selected,
      false,
      path,
    );
});

test('shared offline image assertions retain ordinary CI and native desktop coverage', () => {
  const path = 'scripts/ci/offline-image-pixels.ts';
  const plan = coveragePlan('pull_request', pr(), [path], head);
  assert.equal(plan.mode, 'full');
  assert.ok(automaticSuites.every((id) => plan.suites[id].selected));
  const desktop = readFileSync(
    new URL('../../.github/workflows/desktop-offline.yml', import.meta.url),
    'utf8',
  );
  const paths = desktop.split('    paths:\n')[1].split('  workflow_dispatch:')[0];
  assert.ok(paths.split('\n').some((line) => line.trim() === `- ${path}`));
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
    'e2e/doc-responsiveness-callback-progress.ts',
    'e2e/doc-responsiveness-callback-proto.ts',
    'e2e/doc-responsiveness-callback-converter.ts',
    'scripts/ci/doc-trace-processor.ts',
    'scripts/dependencies/patch-univer-docs.ts',
  ]) {
    const plan = coveragePlan('pull_request', pr(), [path, 'docs/deleted.md']);
    assert.equal(plan.suites['responsiveness-baseline'].selected, true, path);
    assert.equal(plan.suites['callback-baseline'].selected, true, path);
  }
  for (const path of ['unrecognized/runtime.ts', 'docs/unknown.json', 'src/new-domain.ts']) {
    const plan = coveragePlan('pull_request', pr(), [path]);
    assert.equal(plan.mode, 'full');
    assert.ok(automaticSuites.every((id) => plan.suites[id].selected));
  }
  for (const path of [
    'lib/sync-server/store.ts',
    'package-lock.json',
    'scripts/dependencies/patch-univer-core.ts',
  ])
    assert.equal(coveragePlan('pull_request', pr(), [path]).suites['lib-test-run'].selected, true);
});

test('API transport repair and its server fixture retain Node and browser coverage', () => {
  for (const path of [
    'scripts/dependencies/patch-playwright.ts',
    'scripts/dependencies/patch-playwright.test.ts',
    'scripts/dependencies/playwright-transport-fixture.ts',
    'scripts/dependencies/playwright-test-client.ts',
    'scripts/ci/restore-snapshot.test.ts',
    'e2e/restore-snapshot.ts',
    'server/http.ts',
    'e2e/reset-diagnostics.ts',
    'package.json',
  ]) {
    const plan = coveragePlan('pull_request', pr(), [path]);
    for (const suite of ['unit-tests', 'playwright-run'] as const)
      assert.equal(plan.suites[suite].selected, true, `${path}: ${suite}`);
  }
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
      automaticSuites.filter((id) => id !== 'pull-request').every((id) => plan.suites[id].selected),
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

const mobileLabel = (action = 'labeled', label = 'ci-doc-editing-mobile') => ({
  ...pr(action, ['ci-doc-editing-mobile']),
  label: { name: label },
  repository: { id: 170 },
  pull_request: {
    ...pr().pull_request,
    base: { sha: base, repo: { id: 170 } },
    head: { sha: head, repo: { id: 170 } },
    labels: [{ name: 'ci-doc-editing-mobile' }],
  },
});

test('mobile editing requests are one-shot label additions on the recorded same-repository head', () => {
  const merge = 'c'.repeat(40);
  for (const paths of [['docs/testing.md'], ['web/docPhoneView.ts'], ['unknown/input'], null]) {
    const plan = coveragePlan('pull_request', mobileLabel(), paths, merge);
    assert.equal(plan.suites['doc-editing-mobile'].selected, true);
    assert.deepEqual(plan.docEditingMobileRequest, { kind: 'label', sha: head });
    assert.equal(plan.tested, merge);
    for (const status of [undefined, 'skipped', 'failure', 'cancelled'])
      assert.throws(
        () =>
          verifyCoverage(plan, 'success', { ...all(plan), 'doc-editing-mobile': status }, suiteIds),
        /Incomplete coverage doc-editing-mobile/,
      );
    assert.doesNotThrow(() => verifyCoverage(plan, 'success', all(plan), suiteIds));
  }
  for (const action of ['opened', 'synchronize', 'reopened', 'edited', 'unlabeled']) {
    const plan = coveragePlan('pull_request', mobileLabel(action), ['playwright.config.ts'], merge);
    assert.equal(plan.suites['doc-editing-mobile'].selected, false, action);
    assert.equal(plan.docEditingMobileRequest, null);
    assert.ok(
      automaticSuites.every((id) => plan.suites[id].selected),
      action,
    );
  }
  for (const label of [
    'ci-full',
    'ci-performance',
    'ci-doc-editing-mobile-extra',
    'CI-DOC-EDITING-MOBILE',
  ])
    assert.equal(
      coveragePlan('pull_request', mobileLabel('labeled', label), null, merge).suites[
        'doc-editing-mobile'
      ].selected,
      false,
      label,
    );
});

test('full, fallback, scheduled, push and unrelated manual coverage never request new mobile editing', () => {
  for (const event of [
    pr(),
    pr('labeled', ['ci-full']),
    pr('labeled', ['ci-performance']),
    {},
    null,
  ])
    for (const paths of [
      null,
      [],
      ['unknown/file'],
      ['scripts/ci/changes.ts'],
      ['docs/testing.md'],
    ]) {
      const plan = coveragePlan('pull_request', event, paths, head);
      assert.equal(plan.suites['doc-editing-mobile'].selected, false);
    }
  for (const name of ['push', 'schedule', 'unknown']) {
    const plan = coveragePlan(
      name,
      { ...mobileLabel(), before: base, after: head, inputs: { run_doc_editing_mobile: true } },
      null,
      head,
    );
    assert.equal(plan.suites['doc-editing-mobile'].selected, false, name);
    assert.equal(plan.docEditingMobileRequest, null);
  }
  for (const value of [undefined, false, 'false', '1', 1, 'TRUE', '']) {
    const plan = coveragePlan(
      'workflow_dispatch',
      { inputs: { run_doc_editing_mobile: value } },
      null,
      head,
    );
    assert.equal(plan.suites['doc-editing-mobile'].selected, false, String(value));
    assert.equal(plan.suites['phone-compatibility'].selected, true);
  }
  for (const value of [true, 'true']) {
    const plan = coveragePlan(
      'workflow_dispatch',
      { inputs: { run_doc_editing_mobile: value } },
      null,
      head,
    );
    assert.deepEqual(plan.docEditingMobileRequest, { kind: 'manual', sha: head });
    assert.equal(plan.suites['doc-editing-mobile'].selected, true);
    assert.equal(plan.suites['phone-compatibility'].selected, true);
  }
});

test('malformed explicit mobile requests and altered request evidence fail closed', () => {
  const valid = mobileLabel();
  for (const event of [
    { ...valid, repository: {} },
    { ...valid, pull_request: { ...valid.pull_request, head: { sha: head, repo: { id: 171 } } } },
    {
      ...valid,
      pull_request: { ...valid.pull_request, head: { sha: 'branch-name', repo: { id: 170 } } },
    },
  ])
    assert.throws(
      () => coveragePlan('pull_request', event, [], head),
      /immutable same-repository PR head/,
    );
  assert.throws(
    () => coveragePlan('workflow_dispatch', { inputs: { run_doc_editing_mobile: true } }, null),
    /no tested SHA/,
  );
  const plan = coveragePlan('pull_request', valid, ['web/docPhoneView.ts'], head);
  for (const request of [
    undefined,
    null,
    {},
    { kind: 'manual', sha: 'branch' },
    { kind: 'other', sha: head },
    { kind: 'label', sha: base },
    { kind: 'manual', sha: head },
  ])
    assert.throws(
      () =>
        verifyCoverage(
          { ...plan, docEditingMobileRequest: request },
          'success',
          all(plan),
          suiteIds,
        ),
      /Mobile Doc editing request/,
    );
});

test('mobile worker wiring preserves automatic owners and the required aggregate', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(
    workflow,
    /run_doc_editing_mobile:\n\s+description:.*\n\s+type: boolean\n\s+default: false/,
  );
  assert.match(
    workflow,
    /doc_editing_mobile: \$\{\{ steps.changes.outputs.doc_editing_mobile \}\}/,
  );
  assert.match(workflow, /if: needs.changes.outputs.doc_editing_mobile == 'true'/);
  assert.match(workflow, /ref: \$\{\{ needs.changes.outputs.doc_editing_mobile_sha \}\}/);
  assert.match(workflow, /SPINEL_DOC_EDITING_MOBILE: '1'/);
  assert.match(workflow, /--project=doc-editing-mobile --list --reporter=json/);
  assert.match(workflow, /Require complete first-attempt mobile evidence\n\s+if: always\(\)/);
  assert.match(workflow, /"doc-editing-mobile":"\$\{\{ needs.doc-editing-mobile.result \}\}"/);
  assert.match(workflow.slice(workflow.indexOf('  playwright:\n')), /doc-editing-mobile,/);
  assert.match(workflow, /project: mobile-https/);
  assert.match(workflow, /project: sync-production/);
  const mobileJob = workflow.slice(
    workflow.indexOf('  doc-editing-mobile:\n'),
    workflow.indexOf('  # Pair each preset'),
  );
  assert.match(mobileJob, /git rev-parse HEAD > doc-editing-mobile-build-revision\.txt/);
  assert.match(mobileJob, /test -s dist\/index\.html/);
  assert.match(
    mobileJob,
    /name: doc-editing-mobile-build\n\s+path: \|\n\s+dist\/\n\s+doc-editing-mobile-build-revision\.txt\n\s+retention-days: 30\n\s+if-no-files-found: error/,
  );
  assert.ok(
    mobileJob.indexOf('name: Build\n') < mobileJob.indexOf('name: Record own-device build source'),
  );
  assert.ok(
    mobileJob.indexOf('name: Retain own-device test build') <
      mobileJob.indexOf('name: Record requested collection'),
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

test('workflow keeps seven static code names and protected edit concurrency', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const name of [
    'Backlog',
    'Lint',
    'Typecheck',
    'Unit tests',
    'Lib tests',
    'Playwright smoke',
  ])
    assert.ok(workflow.includes(`name: ${name}\n`), name);
  assert.match(workflow, /name: Pull request\n/);
  assert.ok(!workflow.includes('Metadata only'));
  assert.ok(!workflow.includes("outputs.mode == 'metadata'"));
  assert.match(workflow, /format\('event-\{0\}', github.run_id\)/);
  assert.match(workflow, /cancel-in-progress:.*github.event.action == 'synchronize'/);
  assert.match(workflow, /types: \[opened, edited, synchronize, reopened, labeled, unlabeled\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.ok(!workflow.includes('needs.changes.outputs.docs_only'));
});

test('phone ownership removes only eight ordinary cases from instrumented duplicate runs', () => {
  const spec = readFileSync(new URL('../../e2e/doc-mobile.spec.ts', import.meta.url), 'utf8');
  assert.equal(spec.match(/@phone-ordinary/g)?.length, 4); // 3 zoom + 1 formulas + 2 upgrades + 2 traditional
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
