import { expect, test } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { SheetPrintInput } from '@spinel/print';
import { fixtureFonts } from './font-fixtures.ts';
import { retainPdf, runNativeJobs } from './native-test-support.ts';

test('reopens ordered subsets, empty sheets and exact sparse hidden-axis crops', async () => {
  const fonts = await fixtureFonts();
  const input: SheetPrintInput = {
    fonts: [fonts[0]],
    defaultFamily: fonts[0].family,
    images: [],
    snapshot: {
      id: 'selection',
      name: 'Synthetic selection fixture',
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      styles: {},
      sheetOrder: ['first', 'blank', 'hidden', 'last'],
      sheets: {
        first: {
          id: 'first',
          rowCount: 50,
          columnCount: 20,
          defaultRowHeight: 30,
          defaultColumnWidth: 160,
          showGridlines: 0,
          cellData: { 20: { 10: { v: 'Sparse first' } } },
        },
        blank: { id: 'blank', rowCount: 1_000, columnCount: 20 },
        hidden: { id: 'hidden', hidden: 2, cellData: { 0: { 0: { v: 'HIDDEN-SHEET' } } } },
        last: {
          id: 'last',
          rowCount: 4,
          columnCount: 4,
          defaultRowHeight: 30,
          defaultColumnWidth: 160,
          showGridlines: 0,
          rowData: { 1: { hd: 1 }, 2: { h: 55.5 } },
          columnData: { 1: { hd: 1 }, 2: { w: 80.5 } },
          cellData: {
            0: { 0: { v: 'Last start' }, 1: { v: 'HIDDEN-COLUMN' } },
            1: { 0: { v: 'HIDDEN-ROW' } },
            3: { 3: { v: 'Last end' } },
          },
        },
      },
    },
  };
  const results = await runNativeJobs([
    { input },
    { input, options: { worksheetIds: ['last', 'first', 'hidden'] } },
    { input, options: { worksheetIds: ['blank'] } },
  ]);
  const names = ['selection-all', 'selection-subset', 'selection-empty'];
  const expectedPages = [3, 2, 1];
  for (const [index, result] of results.entries()) {
    expect(result).toMatchObject({
      ok: true,
      pages: expectedPages[index],
      restored: true,
      remainingFonts: 0,
    });
    const pages = await retainPdf(names[index], result.bytes!);
    expect(pages).toHaveLength(expectedPages[index]);
    expect(pages.map((page) => page.text).join(' ')).not.toContain('HIDDEN');
    for (const page of pages) expect(page.view).toEqual([0, 0, 595, 842]);
    if (index < 2) {
      expect(pages[0].text).toContain('Sparse first');
      expect(pages.at(-1)!.text).toContain('Last start');
      expect(pages.at(-1)!.text).toContain('Last end');
      // A far-away sparse cell starts at the same print margin; the hundreds of
      // empty editor rows/columns before it do not become PDF whitespace/pages.
      const first = pages[0].items.find((item) => item.str.includes('Sparse first'))!;
      expect(first.transform[4]).toBeGreaterThanOrEqual(36);
      expect(first.transform[4]).toBeLessThan(45);
    }
    if (index !== 1) {
      const blank = pages[index === 0 ? 1 : 0];
      expect(blank.text).toBe('');
      expect(blank.pixels.every((value) => value === 255)).toBe(true);
    }
  }
}, 90_000);
