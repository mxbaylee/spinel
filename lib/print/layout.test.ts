import { expect, test, vi } from 'vitest';
import { ImageSourceType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import sharp from 'sharp';
import { prepareSheetLayout } from './layout.ts';

const frame = { width: 595, height: 842 };
function workbook(): IWorkbookData {
  return {
    id: 'book',
    name: 'Private workbook',
    appVersion: '1.1.0',
    locale: 'enUS',
    styles: {},
    sheetOrder: ['first'],
    sheets: {
      first: {
        id: 'first',
        rowCount: 8,
        columnCount: 5,
        defaultRowHeight: 20,
        defaultColumnWidth: 80,
        cellData: {},
      },
    },
  } as IWorkbookData;
}
function drawing(id: string, extra: Record<string, unknown> = {}) {
  return {
    drawingId: id,
    unitId: 'book',
    subUnitId: 'first',
    drawingType: 0,
    source: 'opaque-image',
    anchorType: '0',
    transform: { width: 40, height: 30 },
    sheetTransform: {
      from: { row: 2, column: 2, rowOffset: 3, columnOffset: 5 },
      to: { row: 4, column: 4, rowOffset: 4, columnOffset: 6 },
    },
    ...extra,
  };
}
function drawings(book: IWorkbookData, data: Record<string, unknown>, order = Object.keys(data)) {
  book.resources ??= [];
  book.resources.push({
    name: 'SHEET_DRAWING_PLUGIN',
    data: JSON.stringify({ first: { data, order } }),
  });
}
async function prepared() {
  return [
    {
      source: 'opaque-image',
      bytes: await sharp({
        create: {
          width: 3,
          height: 2,
          channels: 4,
          background: '#8844cc',
        },
      })
        .png()
        .toBuffer(),
    },
  ];
}

test('resolves native filter and hidden axes before anchored images, preserving z-order and raw input', async () => {
  const book = workbook();
  book.sheets.first.rowData = { 0: { h: 30 }, 1: { hd: 1 }, 2: { ah: 35 } };
  book.sheets.first.columnData = { 1: { hd: 1 }, 2: { w: 60 } };
  book.sheets.first.cellData = { 3: { 0: { v: 'FILTERED-SENTINEL' } }, 5: { 0: { v: 'Visible' } } };
  book.resources = [
    {
      name: 'SHEET_FILTER_PLUGIN',
      data: JSON.stringify({
        first: {
          ref: { startRow: 0, endRow: 7, startColumn: 0, endColumn: 4 },
          cachedFilteredOut: [3],
        },
      }),
    },
  ];
  drawings(
    book,
    {
      fixed: drawing('fixed'),
      both: drawing('both', { anchorType: '1' }),
      absolute: drawing('absolute', {
        anchorType: '2',
        transform: { left: 7, top: 9, width: 12, height: 13 },
      }),
    },
    ['both', 'fixed'],
  );
  const before = structuredClone(book);
  const layout = await prepareSheetLayout(book, await prepared(), frame);
  expect([...layout.sheets[0].rows.slice(0, 6)]).toEqual([0, 30, 30, 65, 65, 85]);
  expect(layout.sheets[0].images.map((image) => image.bounds)).toEqual([
    { left: 85, top: 33, right: 226, bottom: 69 },
    { left: 85, top: 33, right: 125, bottom: 63 },
    { left: 7, top: 9, right: 19, bottom: 22 },
  ]);
  expect(layout.book.sheets.first.rowData?.[3].hd).toBe(1);
  expect(layout.book.sheets.first.cellData?.[3]?.[0]?.v).toBe('FILTERED-SENTINEL');
  expect(book).toEqual(before);
});

test('counts late floating images in the used range without appending unused grid', async () => {
  const book = workbook();
  book.sheets.first.cellData = { 0: { 0: { v: 'Origin' } } };
  drawings(book, {
    late: drawing('late', {
      anchorType: '2',
      transform: { left: 300, top: 1500, width: 60, height: 100 },
    }),
  });
  const layout = await prepareSheetLayout(book, await prepared(), frame);
  expect(layout.sheets[0].bounds).toEqual({ left: 0, top: 0, right: 360, bottom: 1600 });
  expect(layout.pages).toHaveLength(2);
  expect(layout.pages[0].images).toEqual([]);
  expect(layout.pages[1].images[0].crop).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  expect(layout.pages.at(-1)?.source.bottom).toBe(1600);
});

test('a tall image has adjacent source crops with an intact tail and no per-page fitting', async () => {
  const book = workbook();
  drawings(book, {
    tall: drawing('tall', {
      anchorType: '2',
      transform: { left: 10, top: 30, width: 100, height: 3000 },
    }),
  });
  const layout = await prepareSheetLayout(book, await prepared(), frame);
  expect(layout.pages).toHaveLength(3);
  const slices = layout.pages.map((page) => page.images[0]);
  expect(slices.every((slice) => slice.bounds.top === 30 && slice.bounds.bottom === 3030)).toBe(
    true,
  );
  expect(slices[0].crop.top).toBe(0);
  expect(slices[2].crop.bottom).toBe(1);
  expect(slices[0].crop.bottom).toBe(slices[1].crop.top);
  expect(slices[1].crop.bottom).toBe(slices[2].crop.top);
  expect(slices.reduce((sum, slice) => sum + slice.crop.bottom - slice.crop.top, 0)).toBeCloseTo(1);
});

test.each([false, true])(
  'a finite background rectangle has a fixed tile origin across hidden axes and pages (mixed=%s)',
  async (mixed) => {
    const book = workbook();
    book.sheets.first.rowCount = 120;
    book.sheets.first.rowData = { 1: { hd: 1 } };
    book.sheets.first.columnData = { 1: { hd: 1 } };
    book.sheets.first.backgroundImage = {
      source: 'opaque-image',
      imageSourceType: ImageSourceType.UUID,
      scaleX: 20,
      scaleY: 20,
    };
    if (mixed) book.sheets.first.cellData = { 2: { 3: { v: 'Visible content' } } };
    const layout = await prepareSheetLayout(book, await prepared(), frame);
    expect(layout.sheets[0].bounds).toEqual({ left: 0, top: 0, right: 320, bottom: 2380 });
    expect(layout.sheets[0].visibleGridCells).toBe(119 * 4);
    expect(layout.pages).toHaveLength(3);
    for (const page of layout.pages) {
      expect(page.background).toMatchObject({
        origin: { x: 0, y: 0 },
        tileWidth: 60,
        tileHeight: 40,
      });
      expect(page.background?.clip).toEqual(page.source);
    }
    // A page break is not a new pattern origin: the second slice begins partway
    // through a tile. A future compositor must translate by the absolute source top.
    expect(layout.pages[1].source.top % 40).not.toBe(0);
    expect(layout.pages.at(-1)?.source.bottom).toBe(2380);
  },
);

test('grid/page aggregate limits fail before asking for missing image bytes', async () => {
  const book = workbook();
  drawings(book, { first: drawing('first') });
  book.sheets.first.backgroundImage = {
    source: 'opaque-image',
    imageSourceType: ImageSourceType.UUID,
  };
  await expect(prepareSheetLayout(book, [], frame, { limits: { gridCells: 39 } })).rejects.toThrow(
    'layout budget',
  );
  book.sheets.second = { ...book.sheets.first, id: 'second', backgroundImage: undefined };
  book.sheetOrder.push('second');
  await expect(prepareSheetLayout(book, [], frame, { limits: { pages: 1 } })).rejects.toThrow(
    'page budget',
  );
  // Tile draw-work is admitted in addition to the visible cell grid.
  book.sheetOrder.pop();
  delete book.sheets.second;
  await expect(
    prepareSheetLayout(book, await prepared(), frame, { limits: { gridCells: 100 } }),
  ).rejects.toThrow('layout budget');
});

test('omits hidden/unselected sheets and collapsed two-cell images without resolving their bytes', async () => {
  const book = workbook();
  book.sheets.first.rowData = { 2: { hd: 1 }, 3: { hd: 1 } };
  drawings(book, {
    collapsed: drawing('collapsed', {
      anchorType: '1',
      sheetTransform: {
        from: { row: 2, column: 0, rowOffset: 0, columnOffset: 0 },
        to: { row: 3, column: 1, rowOffset: 0, columnOffset: 0 },
      },
    }),
    hidden: drawing('hidden', { hidden: true, source: 'not-prepared' }),
  });
  book.sheetOrder.push('hidden');
  book.sheets.hidden = {
    id: 'hidden',
    hidden: 1,
    backgroundImage: { source: 'private-unselected', imageSourceType: ImageSourceType.UUID },
  } as IWorkbookData['sheets'][string];
  const layout = await prepareSheetLayout(book, [], frame);
  expect(layout.images.size).toBe(0);
  expect(layout.pages).toHaveLength(1);
  expect(layout.pages[0].source).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
});

test.each([
  { anchorType: 'unknown' },
  { unitId: 'another-book' },
  { sheetTransform: { from: { row: 8, column: 0, rowOffset: 0, columnOffset: 0 } } },
  { transform: { left: 0, top: 0, width: 100_001, height: 1 } },
  { opacity: 2 },
])('rejects malformed geometry without exposing source input (%j)', async (extra) => {
  const book = workbook();
  drawings(book, { image: drawing('image', extra) });
  await expect(prepareSheetLayout(book, [], frame)).rejects.toThrow('Invalid PDF image layout.');
});

test.each([
  { drawingType: 1 },
  { groupId: 'group' },
  { transform: { angle: 25 } },
  { srcRect: { l: 1000 } },
])(
  'fails explicitly for unfinished visible appearance, never silently exporting it (%j)',
  async (extra) => {
    const book = workbook();
    drawings(book, { image: drawing('image', extra) });
    await expect(prepareSheetLayout(book, [], frame)).rejects.toThrow('not implemented yet');
  },
);

test('cell drawing support remains an explicit pending requirement instead of a hidden URL-cache fetch', async () => {
  const book = workbook();
  book.sheets.first.cellData = {
    0: {
      0: {
        p: {
          id: 'rich',
          body: { dataStream: '\b\r\n' },
          drawings: { image: { source: 'private-image' } },
        },
      },
    },
  } as IWorkbookData['sheets'][string]['cellData'];
  await expect(prepareSheetLayout(book, [], frame)).rejects.toThrow('not implemented yet');
  // Hiding the anchor does not hide the visible remainder of its merged cell.
  book.sheets.first.rowData = { 0: { hd: 1 } };
  book.sheets.first.mergeData = [{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 }];
  await expect(prepareSheetLayout(book, [], frame)).rejects.toThrow('not implemented yet');
});

test('owns prepared data across metadata awaits, performs no network work and honors cancellation', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'));
  try {
    const book = workbook();
    drawings(book, { image: drawing('image') });
    const bytes = await prepared();
    const pending = prepareSheetLayout(book, bytes, frame);
    book.sheets.first.defaultRowHeight = 999;
    bytes[0].bytes.fill(0);
    const layout = await pending;
    expect(layout.sheets[0].images[0].bounds.top).toBe(43);
    expect(layout.images.get('opaque-image')?.bytes[0]).toBe(137);
    expect(fetch).not.toHaveBeenCalled();
    const aborted = AbortSignal.abort();
    await expect(
      prepareSheetLayout(workbook(), [], frame, { signal: aborted }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  } finally {
    fetch.mockRestore();
  }
});
