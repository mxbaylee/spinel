import { expect, test } from 'vitest';
import { blackTextInkTop } from './raster-text-test-support.ts';

test('visible sentinel clearance rejects touching, overlapping and missing ink', () => {
  const page = { width: 30, height: 30, pixels: new Uint8ClampedArray(30 * 30 * 4).fill(255) };
  const item = { width: 10, height: 10, transform: [10, 0, 0, 10, 10, 10] };
  const imageBottom = 15;
  for (const row of [16, 15, 14]) {
    page.pixels.fill(255);
    const offset = (row * page.width + 10) * 4;
    page.pixels.fill(0, offset, offset + 3);
    expect(blackTextInkTop(page, item) > imageBottom).toBe(row > imageBottom);
  }
  page.pixels.fill(255);
  expect(() => blackTextInkTop(page, item)).toThrow('no visible black ink');
  // A visible following paragraph cannot stand in for an invisible sentinel.
  const nextLine = (23 * page.width + 10) * 4;
  page.pixels.fill(0, nextLine, nextLine + 3);
  expect(() => blackTextInkTop(page, item)).toThrow('no visible black ink');
});
