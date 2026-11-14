import sharp from 'sharp';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

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
    let light = 0,
      dark = 0;
    for (let y = 8; y < info.height - 8; y += 8)
      for (let x = 8; x < info.width - 8; x += 8) {
        const at = (y * info.width + x) * info.channels;
        const value = (data[at]! + data[at + 1]! + data[at + 2]!) / 3;
        if (value > 192) light++;
        if (value < 64) dark++;
      }
    const darkPaper = dark > light;
    const ink = (x: number, y: number) => {
      const at = (y * info.width + x) * info.channels;
      const low = Math.min(data[at]!, data[at + 1]!, data[at + 2]!);
      const high = Math.max(data[at]!, data[at + 1]!, data[at + 2]!);
      return high - low < 60 && (darkPaper ? low > 170 : high < 115);
    };
    const inset = Math.max(8, Math.round((info.width / box.width) * 8));
    const bottom = Math.min(info.height - inset, Math.floor(info.height * 0.65));
    for (let y = inset; y < bottom; y++) {
      const top = y;
      let pixels = 0,
        left = info.width,
        right = -1;
      while (y < bottom) {
        let rowPixels = 0;
        for (let x = inset; x < info.width - inset; x++)
          if (ink(x, y)) {
            rowPixels++;
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        if (rowPixels < 2) break;
        pixels += rowPixels;
        y++;
      }
      // Reject a border, a blinking caret or a few incidental antialiased pixels.
      const lineHeight = y - top;
      if (lineHeight < 4 || pixels < 24 || right - left < 12) continue;
      let glyphRight = left;
      while (glyphRight <= right) {
        let occupied = false;
        for (let row = top; row < y; row++) occupied ||= ink(glyphRight, row);
        if (!occupied) break;
        glyphRight++;
      }
      if (glyphRight - left < 2) continue;
      const point = {
        // The leading edge of P selects the start of the first paragraph.
        x: box.x + ((left + 0.2) / info.width) * box.width,
        y: box.y + ((top + lineHeight / 2) / info.height) * box.height,
      };
      const hit = await canvas.evaluate((node, point) => {
        const target = document.elementFromPoint(point.x, point.y);
        // Native layers may use a sibling interaction canvas above the paint.
        return target === node || Boolean(target && node.parentElement?.contains(target));
      }, point);
      if (hit)
        return {
          ...point,
          centerX: box.x + ((left + glyphRight) / 2 / info.width) * box.width,
          glyphWidth: glyphRight - left,
          lineHeight,
          pixels,
        };
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
