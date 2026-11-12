/** Visible ink of the upright black Atkinson sentinels in native PDF fixtures. */
export function blackTextInkTop(
  page: { width: number; height: number; pixels: Uint8ClampedArray },
  item: { width: number; height: number; transform: number[] },
): number {
  const [a, b, c, d, x, y] = item.transform;
  if (
    ![a, b, c, d, x, y, item.width, item.height].every(Number.isFinite) ||
    a <= 0 ||
    d <= 0 ||
    b !== 0 ||
    c !== 0 ||
    item.width <= 0 ||
    item.height <= 0
  )
    throw new Error('Expected upright sentinel text');
  // PDF.js TextItem.height is the transformed font/em height, not glyph ascent.
  // These uppercase sentinels have no descenders. Search the full em above the
  // baseline, including horizontal overhangs, but exclude the following line.
  // Never start at the image boundary: overlapping ink must remain observable.
  const baseline = page.height - y;
  const left = Math.max(0, Math.floor(x - item.height));
  const right = Math.min(page.width, Math.ceil(x + item.width + item.height));
  const top = Math.max(0, Math.floor(baseline - item.height));
  const bottom = Math.min(page.height, Math.ceil(baseline));
  for (let row = top; row < bottom; row++)
    for (let column = left; column < right; column++) {
      const offset = (row * page.width + column) * 4;
      if (
        page.pixels[offset] < 80 &&
        page.pixels[offset + 1] < 80 &&
        page.pixels[offset + 2] < 80 &&
        page.pixels[offset + 3] === 255
      )
        return row;
    }
  throw new Error('Sentinel has no visible black ink');
}
