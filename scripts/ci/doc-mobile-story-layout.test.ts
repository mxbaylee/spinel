import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mobileDocStoryLayoutReady } from '../../web/docMobileStoryLayout.ts';
import type { MobileDocStoryLayout } from '../../web/docMobileStoryLayout.ts';

const completed = (width: number): MobileDocStoryLayout => ({
  hasCompleteLayout: true,
  layoutPending: false,
  coversContentEnd: true,
  mountWidth: width,
  canvasWidth: width,
  bitmapWidth: width,
  pixelRatio: 1,
  nativeWidth: width,
  pageWidths: [width - 24],
  pageMarginLeft: 12,
});

test('a partial published Doc cannot become the line-count baseline', () => {
  // The first hosted failure compared restored 15 with initial 11. Its initial
  // progress was not retained. This controlled partial publication demonstrates
  // the unsafe baseline contract, without claiming that missing historical state.
  const samples = [
    {
      lines: 11,
      layout: {
        ...completed(390),
        hasCompleteLayout: false,
        layoutPending: true,
        coversContentEnd: false,
      },
    },
    { lines: 15, layout: completed(390) },
  ];
  const previousBaseline = samples.find((sample) => sample.lines >= 5)!;
  const completeBaseline = samples.find((sample) => mobileDocStoryLayoutReady(sample.layout))!;
  assert.equal(previousBaseline.lines, 11);
  assert.equal(completeBaseline.lines, 15);
  const restored = { lines: 15, layout: completed(390) };
  assert.ok(mobileDocStoryLayoutReady(restored.layout));
  assert.equal(restored.lines, completeBaseline.lines);
});

test('a previous complete generation does not cover active layout or missing final content', () => {
  assert.equal(mobileDocStoryLayoutReady({ ...completed(390), layoutPending: true }), false);
  assert.equal(mobileDocStoryLayoutReady({ ...completed(390), coversContentEnd: false }), false);
  assert.equal(mobileDocStoryLayoutReady({ ...completed(390), hasCompleteLayout: false }), false);
});

test('narrow and restored line counts wait for the current canvas and page width', () => {
  const initial = { lines: 15, layout: completed(390) };
  const shrinking = { ...initial.layout, mountWidth: 320 };
  assert.equal(mobileDocStoryLayoutReady(shrinking), false);
  const narrow = { lines: 20, layout: completed(320) };
  assert.ok(mobileDocStoryLayoutReady(narrow.layout));
  assert.ok(narrow.lines > initial.lines);
  const restoring = { ...narrow.layout, mountWidth: 390 };
  assert.equal(mobileDocStoryLayoutReady(restoring), false);
  assert.equal(mobileDocStoryLayoutReady({ ...completed(390), pageWidths: [296] }), false);
  assert.equal(mobileDocStoryLayoutReady({ ...completed(390), bitmapWidth: 320 }), false);
  const restored = { lines: 15, layout: completed(390) };
  assert.ok(mobileDocStoryLayoutReady(restored.layout));
  assert.equal(restored.lines, initial.lines);
});

test('missing geometry cannot count as completed native layout', () => {
  assert.equal(mobileDocStoryLayoutReady({ ...completed(390), pageWidths: [] }), false);
  assert.equal(mobileDocStoryLayoutReady({ ...completed(390), mountWidth: NaN }), false);
  assert.equal(mobileDocStoryLayoutReady({ ...completed(390), nativeWidth: 0 }), false);
  assert.equal(mobileDocStoryLayoutReady({ ...completed(390), pageMarginLeft: NaN }), false);
  assert.ok(mobileDocStoryLayoutReady({ ...completed(390), pixelRatio: 2, bitmapWidth: 780 }));
});
