import { LocaleType } from '@univerjs/core';
import { expect, test } from 'vitest';
import type { SheetPrintInput } from './index.ts';
import { fixtureFonts } from './font-fixtures.ts';
import { retainPdf, runNativeJobs } from './native-test-support.ts';

test('every ordinary row stays pixel-complete at Sheet page seams', async () => {
  const font = (await fixtureFonts())[0];
  const make = (rows: number): SheetPrintInput =>
    ({
      fonts: [font],
      defaultFamily: font.family,
      images: [],
      snapshot: {
        id: 'seam-book',
        name: 'Ordinary row seam fixture',
        appVersion: '1.1.0',
        locale: LocaleType.EN_US,
        styles: {},
        sheetOrder: ['sheet'],
        sheets: {
          sheet: {
            id: 'sheet',
            name: 'Rows',
            rowCount: rows,
            columnCount: 2,
            defaultRowHeight: 24,
            defaultColumnWidth: 200,
            showGridlines: 0,
            cellData: Object.fromEntries(
              Array.from({ length: rows }, (_, row) => [
                row,
                {
                  0: { v: 'Complete row', s: { fs: 12, cl: { rgb: '#cc2266' } } },
                  1: { v: `ROW${String(row).padStart(3, '0')}`, s: { fs: 12 } },
                },
              ]),
            ),
          },
        },
      },
    }) as SheetPrintInput;
  const source = make(110);
  const original = structuredClone(source.snapshot);
  const results = await runNativeJobs([{ input: source }, { input: make(1) }]);
  expect(results[0]).toMatchObject({ ok: true, pages: 3, restored: true, remainingFonts: 0 });
  expect(results[1]).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
  const pages = await retainPdf('ordinary-row-seams', results[0].bytes!);
  const [reference] = await retainPdf('ordinary-row-reference', results[1].bytes!);
  const rowPixels = (page: typeof reference, top: number) => {
    const pixels = Buffer.alloc(150 * 18 * 4);
    for (let y = 0; y < 18; y++) {
      const start = ((top + y) * page.width + 36) * 4;
      pixels.set(page.pixels.subarray(start, start + 150 * 4), y * 150 * 4);
    }
    return pixels;
  };
  const fullRow = rowPixels(reference, 36);
  const magenta = (pixels: Uint8Array | Uint8ClampedArray) => {
    let total = 0;
    for (let index = 0; index < pixels.length; index += 4)
      if (pixels[index] > 140 && pixels[index + 1] < 90 && pixels[index + 2] > 70) total++;
    return total;
  };
  const fullInk = magenta(fullRow);
  expect(fullInk).toBeGreaterThan(50);
  let row = 0;
  for (const [index, page] of pages.entries()) {
    const count = [42, 42, 26][index];
    for (let local = 0; local < count; local++, row++) {
      expect(page.text.split(`ROW${String(row).padStart(3, '0')}`)).toHaveLength(2);
      // Compare every raster channel with an independently rendered full native
      // row. Fractional native transforms vary edge antialiasing by at most a
      // few levels; missing glyph pixels differ by far more. The exact ink count
      // below separately forbids any missing/repeated row fragments.
      const rendered = rowPixels(page, 36 + local * 18);
      let difference = 0;
      for (let pixel = 0; pixel < fullRow.length; pixel++)
        difference = Math.max(difference, Math.abs(rendered[pixel] - fullRow[pixel]));
      expect(difference, `Page ${index + 1}, row ${row}`).toBeLessThanOrEqual(5);
    }
    // No fragment of the following/preceding row may be left at either seam.
    expect(magenta(page.pixels)).toBe(fullInk * count);
  }
  expect(row).toBe(110);
  expect(source.snapshot).toEqual(original);
}, 60_000);
