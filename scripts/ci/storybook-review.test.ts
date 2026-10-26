import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkStorybookReviewResults } from './storybook-review-gate.ts';
import { resolveStorybookReviewPolicy } from './storybook-review-policy.ts';
import { reviewViewports, selectStorybookReview } from './storybook-review.ts';

const entries = {
  'screen--default': { type: 'story' },
  'screen--error': { type: 'story' },
  'screen--docs': { type: 'docs' },
};

test('the three viewport jobs cover all existing captures and extra interactions once', () => {
  const full = selectStorybookReview([], entries);
  const shards = reviewViewports.map((viewport) =>
    selectStorybookReview(['--viewport', viewport], entries),
  );
  assert.deepEqual(full.variants, [
    ['light', 1280, 'light'],
    ['dark', 1280, 'dark'],
    ['light', 390, 'phone'],
    ['dark', 390, 'phone-dark'],
    ['light', 768, 'tablet'],
  ]);
  const sort = (values: readonly unknown[]) =>
    [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const key of [
    'variants',
    'nativeEditorKinds',
    'dashboardViewports',
    'spaceWidths',
    'journeyWidths',
  ] as const) {
    assert.deepEqual(
      sort(shards.flatMap<unknown>((shard) => shard[key])),
      sort(full[key]),
      `${key}: no missing or duplicated coverage`,
    );
  }
  assert.deepEqual(full.nativeEditorKinds, ['sheet', 'doc']);
  assert.deepEqual(full.dashboardViewports, [
    [1280, false],
    [768, true],
    [613, false],
    [390, true],
  ]);
  assert.deepEqual(full.spaceWidths, [1280, 768, 390]);
  assert.deepEqual(full.journeyWidths, [1280, 390]);
  for (const shard of shards) assert.deepEqual(shard.requested, full.requested);
});

test('default reviews include all stories; focused manual reviews keep their IDs on every viewport', () => {
  assert.deepEqual(selectStorybookReview([], entries).requested, [
    'screen--default',
    'screen--error',
  ]);
  for (const viewport of ['all', ...reviewViewports]) {
    const focused = selectStorybookReview(['--viewport', viewport, 'screen--error'], entries);
    assert.deepEqual(focused.requested, ['screen--error']);
    assert.ok(focused.variants.length > 0);
  }
  assert.deepEqual(
    selectStorybookReview(['--viewport', 'all'], entries),
    selectStorybookReview([], entries),
  );
});

for (const viewport of ['desktop', 'mobile']) {
  test(`${viewport} theme jobs preserve every capture and interaction without duplication`, () => {
    for (const ids of [[], ['screen--error']]) {
      const full = selectStorybookReview(['--viewport', viewport, ...ids], entries);
      const shards = ['light', 'dark'].map((theme) =>
        selectStorybookReview(['--viewport', viewport, '--theme', theme, ...ids], entries),
      );
      for (const key of [
        'variants',
        'nativeEditorKinds',
        'dashboardViewports',
        'spaceWidths',
        'journeyWidths',
      ] as const) {
        assert.deepEqual(
          shards.flatMap<unknown>((shard) => shard[key]),
          full[key],
          key,
        );
      }
      assert.deepEqual(
        shards.map((shard) => shard.variants),
        viewport === 'mobile'
          ? [[['light', 390, 'phone']], [['dark', 390, 'phone-dark']]]
          : [[['light', 1280, 'light']], [['dark', 1280, 'dark']]],
      );
      for (const shard of shards) assert.deepEqual(shard.requested, full.requested);
      assert.deepEqual(
        selectStorybookReview(['--viewport', viewport, '--theme', 'all', ...ids], entries),
        full,
      );
    }
  });
}

test('the five CI partitions retain the complete catalog, variants and once-only journeys', () => {
  const full = selectStorybookReview([], entries);
  const partitions = [
    ['--viewport', 'desktop', '--theme', 'light'],
    ['--viewport', 'desktop', '--theme', 'dark'],
    ['--viewport', 'tablet'],
    ['--viewport', 'mobile', '--theme', 'light'],
    ['--viewport', 'mobile', '--theme', 'dark'],
  ].map((args) => selectStorybookReview(args, entries));
  const sort = (values: readonly unknown[]) =>
    [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const key of [
    'variants',
    'nativeEditorKinds',
    'dashboardViewports',
    'spaceWidths',
    'journeyWidths',
  ] as const) {
    assert.deepEqual(
      sort(partitions.flatMap<unknown>((partition) => partition[key])),
      sort(full[key]),
      key,
    );
  }
  for (const partition of partitions) assert.deepEqual(partition.requested, full.requested);
  assert.deepEqual(partitions[0].nativeEditorKinds, ['sheet', 'doc']);
  for (const partition of partitions.slice(1)) assert.deepEqual(partition.nativeEditorKinds, []);
});

test('omitting routine screenshots cannot narrow render, play, native or journey checks', () => {
  for (const args of [
    [],
    ['--viewport', 'desktop', '--theme', 'light'],
    ['--viewport', 'desktop', '--theme', 'dark', 'screen--error'],
    ['--viewport', 'tablet'],
    ['--viewport', 'mobile', '--theme', 'dark'],
  ]) {
    const capture = selectStorybookReview(args, entries);
    const check = selectStorybookReview([...args, '--no-screenshots'], entries);
    assert.equal(capture.captureScreenshots, true);
    assert.equal(check.captureScreenshots, false);
    assert.deepEqual({ ...check, captureScreenshots: true }, capture);
  }
  assert.throws(() => selectStorybookReview(['--no-screenshots', '--no-screenshots'], entries));
});

test('invalid theme splits cannot silently omit validation', () => {
  for (const args of [
    ['--viewport', 'mobile', '--theme'],
    ['--viewport', 'mobile', '--theme', 'system'],
    ['--viewport', 'mobile', '--theme', 'light', '--theme', 'dark'],
    ['--theme', 'dark'],
    ['--viewport', 'tablet', '--theme', 'dark'],
  ])
    assert.throws(() => selectStorybookReview(args, entries));
});

test('invalid viewports, repeated viewport flags and unknown stories fail instead of narrowing coverage silently', () => {
  for (const args of [
    ['--viewport'],
    ['--viewport', 'phone'],
    ['--viewport', 'mobile', '--viewport', 'desktop'],
    ['--unknown'],
    ['missing--story'],
    ['screen--docs'],
  ]) {
    assert.throws(() => selectStorybookReview(args, entries));
  }
});

test('the stable gate requires successful classification, build, and all three viewport jobs', () => {
  const passed = {
    classification: 'success',
    build: 'success',
    docsOnly: 'false',
    captureScreenshots: 'true',
    viewports: { desktop: 'success', tablet: 'success', mobile: 'success' },
  };
  assert.match(checkStorybookReviewResults(passed), /All desktop, tablet, and mobile/);
  assert.match(
    checkStorybookReviewResults({ ...passed, captureScreenshots: 'false' }),
    /checks passed; routine screenshots were not requested/,
  );
  for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
    for (const viewport of reviewViewports) {
      for (const captureScreenshots of ['true', 'false']) {
        assert.throws(() =>
          checkStorybookReviewResults({
            ...passed,
            captureScreenshots,
            viewports: { ...passed.viewports, [viewport]: status },
          }),
        );
      }
    }
    for (const dependency of ['classification', 'build']) {
      assert.throws(() => checkStorybookReviewResults({ ...passed, [dependency]: status }));
    }
  }
  assert.throws(() => checkStorybookReviewResults({ ...passed, docsOnly: undefined }));
  assert.throws(() => checkStorybookReviewResults({ ...passed, captureScreenshots: undefined }));
  assert.throws(() => checkStorybookReviewResults({ ...passed, captureScreenshots: 'unknown' }));
});

test('docs-only reviews pass with explicitly skipped shards, but cannot hide failures or missing results', () => {
  const skipped = {
    classification: 'success',
    build: 'success',
    docsOnly: 'true',
    captureScreenshots: 'false',
    viewports: { desktop: 'skipped', tablet: 'skipped', mobile: 'skipped' },
  };
  assert.match(checkStorybookReviewResults(skipped), /Not applicable/);
  for (const status of ['failure', 'cancelled', 'success', undefined]) {
    for (const viewport of reviewViewports) {
      assert.throws(() =>
        checkStorybookReviewResults({
          ...skipped,
          viewports: { ...skipped.viewports, [viewport]: status },
        }),
      );
    }
  }
  assert.throws(() => checkStorybookReviewResults({ ...skipped, docsOnly: 'false' }));
  assert.throws(() => checkStorybookReviewResults({ ...skipped, captureScreenshots: 'true' }));
  assert.match(
    checkStorybookReviewResults({
      ...skipped,
      captureScreenshots: 'true',
      viewports: { desktop: 'success', tablet: 'success', mobile: 'success' },
    }),
    /captures and interactions passed/,
  );
});

test('PR screenshots follow the visual-review label while application checks remain required', () => {
  const options = {
    eventName: 'pull_request',
    docsOnly: 'false',
    visualReview: false,
    manualCapture: false,
  };
  assert.deepEqual(resolveStorybookReviewPolicy(options), {
    captureScreenshots: false,
    reviewRequired: true,
  });
  assert.deepEqual(resolveStorybookReviewPolicy({ ...options, visualReview: true }), {
    captureScreenshots: true,
    reviewRequired: true,
  });
  // Removing the label disables only routine captures; manual input cannot override a PR.
  assert.deepEqual(resolveStorybookReviewPolicy({ ...options, manualCapture: true }), {
    captureScreenshots: false,
    reviewRequired: true,
  });
  assert.deepEqual(resolveStorybookReviewPolicy({ ...options, docsOnly: 'true' }), {
    captureScreenshots: false,
    reviewRequired: false,
  });
  assert.deepEqual(
    resolveStorybookReviewPolicy({ ...options, docsOnly: 'true', visualReview: true }),
    { captureScreenshots: true, reviewRequired: true },
  );
});

test('manual capture is explicit and main pushes do not repeat PR screenshots', () => {
  const options = {
    eventName: 'workflow_dispatch',
    docsOnly: 'false',
    visualReview: false,
    manualCapture: true,
  };
  assert.deepEqual(resolveStorybookReviewPolicy(options), {
    captureScreenshots: true,
    reviewRequired: true,
  });
  assert.deepEqual(
    resolveStorybookReviewPolicy({ ...options, manualCapture: false, visualReview: true }),
    { captureScreenshots: false, reviewRequired: true },
  );
  assert.deepEqual(
    resolveStorybookReviewPolicy({ ...options, eventName: 'push', visualReview: true }),
    { captureScreenshots: false, reviewRequired: true },
  );
  assert.throws(() => resolveStorybookReviewPolicy({ ...options, eventName: 'unknown' }));
  for (const docsOnly of ['', 'unknown', undefined]) {
    assert.throws(() => resolveStorybookReviewPolicy({ ...options, docsOnly }));
  }
});
