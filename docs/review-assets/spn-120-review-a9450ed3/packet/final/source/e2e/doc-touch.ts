import sharp from 'sharp';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { textPoints } from './doc-touch-raster.ts';

// The renderer caches glyphs on offscreen canvases, so fillText interception
// cannot locate their final screen positions. Find the first real text line in
// the visible raster instead. The fixture starts with "Phone journal"; its
// neutral, high-contrast ink identifies the document text.
export async function textPoint(page: Page) {
  const canvas = page
    .getByRole('region', { name: 'Doc document', exact: true })
    .getByLabel('Document canvas', { exact: true });
  const read = async () => {
    const box = await canvas.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    const { data, info } = await sharp(await canvas.screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const point of textPoints({ data, ...info, box })) {
      const hit = await canvas.evaluate((node, point) => {
        const target = document.elementFromPoint(point.x, point.y);
        // Native layers may use a sibling interaction canvas above the paint.
        return target === node || Boolean(target && node.parentElement?.contains(target));
      }, point);
      if (hit) return point;
    }
    return null;
  };
  await expect.poll(read).not.toBeNull();
  const point = (await read())!;
  expect(point.glyphWidth).toBeGreaterThanOrEqual(2);
  expect(point.lineHeight).toBeGreaterThanOrEqual(4);
  expect(point.pixels).toBeGreaterThanOrEqual(24);
  return point;
}

export async function beginWriting(page: Page) {
  const point = await textPoint(page);
  await page.touchscreen.tap(point.x, point.y);
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator('[contenteditable="true"][data-u-comp="editor"]')).toBeFocused();
}
