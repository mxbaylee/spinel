import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkStorybookReviewResults } from './storybook-review-gate.ts';
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
    viewports: { desktop: 'success', tablet: 'success', mobile: 'success' },
  };
  assert.match(checkStorybookReviewResults(passed), /All desktop, tablet, and mobile/);
  for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
    for (const viewport of reviewViewports) {
      assert.throws(() =>
        checkStorybookReviewResults({
          ...passed,
          viewports: { ...passed.viewports, [viewport]: status },
        }),
      );
    }
    for (const dependency of ['classification', 'build']) {
      assert.throws(() => checkStorybookReviewResults({ ...passed, [dependency]: status }));
    }
  }
  assert.throws(() => checkStorybookReviewResults({ ...passed, docsOnly: undefined }));
});

test('docs-only reviews pass with explicitly skipped shards, but cannot hide failures or missing results', () => {
  const skipped = {
    classification: 'success',
    build: 'success',
    docsOnly: 'true',
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
});
