import { expect, test, vi } from 'vitest';
import { HorizontalAlign, ImageSourceType, VerticalAlign } from '@univerjs/core';
import type { ICellData, IWorkbookData } from '@univerjs/core';
import sharp from 'sharp';
import { prepareSheetLayout, replanSheetPages } from './layout.ts';

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

function cellPicture() {
  return {
    p: {
      id: 'cell-picture',
      body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: 'picture' }] },
      documentStyle: {},
      drawingsOrder: ['picture'],
      drawings: {
        picture: {
          drawingId: 'picture',
          unitId: 'cell-picture',
          subUnitId: 'cell-picture',
          drawingType: 0,
          source: 'opaque-image',
          imageSourceType: ImageSourceType.UUID,
          layoutType: 0,
          docTransform: { size: { width: 3, height: 2 }, angle: 0 },
        },
      },
    },
  } as unknown as ICellData;
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
  expect(layout.sheets[0].rows.subarray(0, 6)).toEqual(Float64Array.of(0, 30, 30, 65, 65, 85));
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

test('a wholly collapsed background does not request any prepared bytes', async () => {
  const book = workbook();
  book.sheets.first.columnData = Object.fromEntries(
    Array.from({ length: 5 }, (_, column) => [column, { hd: 1 }]),
  );
  book.sheets.first.backgroundImage = {
    source: 'not-prepared',
    imageSourceType: ImageSourceType.UUID,
  };
  const layout = await prepareSheetLayout(book, [], frame);
  expect(layout.images.size).toBe(0);
  expect(layout.sheets[0].background).toBeNull();
  expect(layout.sheets[0].bounds).toBeNull();
});

test.each([
  { anchorType: 'unknown' },
  { unitId: 'another-book' },
  { sheetTransform: { from: { row: 8, column: 0, rowOffset: 0, columnOffset: 0 } } },
  { transform: { left: 0, top: 0, width: 100_001, height: 1 } },
  { opacity: 2 },
  { srcRect: { l: 1000 } },
])('rejects malformed geometry without exposing source input (%j)', async (extra) => {
  const book = workbook();
  drawings(book, { image: drawing('image', extra) });
  await expect(prepareSheetLayout(book, [], frame)).rejects.toThrow('Invalid PDF image layout.');
});

test.each([
  { drawingType: 1 },
  { groupId: 'group' },
  { transform: { skewX: 25 } },
  { prstGeom: 'ellipse' },
])(
  'fails explicitly for unfinished visible appearance, never silently exporting it (%j)',
  async (extra) => {
    const book = workbook();
    drawings(book, { image: drawing('image', extra) });
    await expect(prepareSheetLayout(book, [], frame)).rejects.toThrow('not supported');
  },
);

test.each([
  { left: 1e20, top: 0, width: 40, height: 30 },
  { left: 0, top: 1e20, width: 40, height: 30 },
  { left: 80, top: 40, width: Number.MIN_VALUE, height: 30 },
  { left: 80, top: 40, width: 40, height: Number.MIN_VALUE },
])(
  'rejects unrepresentable positive image extents before zero-area omission (%j)',
  async (transform) => {
    const book = workbook();
    drawings(book, { image: drawing('image', { anchorType: '2', transform }) });
    // No bytes supplied: the original bug returned a successful blank plan instead
    // of either validating the geometry or requiring the image's prepared source.
    await expect(prepareSheetLayout(book, [], frame)).rejects.toMatchObject({
      code: 'invalid-input',
      message: 'Invalid PDF image layout.',
    });
  },
);

test.each(['width', 'height'])(
  'rejects a fixed anchored image whose positive %s disappears',
  async (axis) => {
    const book = workbook();
    drawings(book, {
      image: drawing('image', {
        transform: { width: 40, height: 30, [axis]: Number.MIN_VALUE },
      }),
    });
    await expect(prepareSheetLayout(book, [], frame)).rejects.toMatchObject({
      code: 'invalid-input',
    });
  },
);

test('intentional zero-size images remain omitted without requesting bytes', async () => {
  const book = workbook();
  drawings(book, {
    width: drawing('width', {
      anchorType: '2',
      transform: { left: 80, top: 40, width: 0, height: 30 },
    }),
    height: drawing('height', {
      anchorType: '2',
      transform: { left: 80, top: 40, width: 40, height: 0 },
    }),
  });
  const layout = await prepareSheetLayout(book, [], frame);
  expect(layout.images.size).toBe(0);
  expect(layout.sheets[0].bounds).toBeNull();
});

test('single native cell images keep aspect and merge/hidden geometry without a URL cache', async () => {
  const book = workbook();
  book.sheets.first.cellData = { 0: { 0: cellPicture() } };
  const before = structuredClone(book);
  const first = await prepareSheetLayout(book, await prepared(), frame);
  expect(first.sheets[0].images).toHaveLength(1);
  expect(first.sheets[0].images[0].bounds).toEqual({ left: 2, top: 2, right: 26, bottom: 18 });
  expect(first.book.sheets.first.cellData[0][0]?.p).toBeUndefined();
  expect(book).toEqual(before);
  // A hidden anchor must retain an image across the visible merged remainder.
  book.sheets.first.rowData = { 0: { hd: 1 } };
  book.sheets.first.columnData = { 0: { hd: 1 } };
  book.sheets.first.mergeData = [{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 }];
  book.sheets.first.cellData[0][0]!.s = { ht: HorizontalAlign.CENTER, vt: VerticalAlign.MIDDLE };
  const merged = await prepareSheetLayout(book, await prepared(), frame);
  expect(merged.sheets[0].images[0].bounds).toEqual({ left: 13, top: 2, right: 67, bottom: 38 });
});

test('fully hidden and nonanchor cell images need no unrelated prepared bytes', async () => {
  const book = workbook();
  book.sheets.first.cellData = { 0: { 0: cellPicture() }, 1: { 1: cellPicture() } };
  book.sheets.first.rowData = { 0: { hd: 1 } };
  book.sheets.first.mergeData = [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 }];
  const layout = await prepareSheetLayout(book, [], frame);
  expect(layout.sheets[0].images).toEqual([]);
  expect(layout.images.size).toBe(0);
  expect(layout.book.sheets.first.cellData[0][0]?.p).toBeUndefined();
  expect(layout.book.sheets.first.cellData[1][1]?.p).toBeUndefined();
});

test('mixed cell text/drawings fail clearly rather than dropping either content', async () => {
  const book = workbook();
  const picture = cellPicture();
  picture.p!.body!.dataStream = 'Text\b\r\n';
  book.sheets.first.cellData = { 0: { 0: picture } };
  await expect(prepareSheetLayout(book, await prepared(), frame)).rejects.toMatchObject({
    code: 'unsupported',
  });
});

test('floating rotation, flips and native source crops preserve their whole transformed frame', async () => {
  const book = workbook();
  drawings(book, {
    picture: drawing('picture', {
      anchorType: '2',
      transform: { left: 100, top: 200, width: 40, height: 30, angle: 90, flipX: true },
      srcRect: { left: 5, right: 10, top: 2, bottom: 4 },
    }),
  });
  const layout = await prepareSheetLayout(book, await prepared(), frame);
  const image = layout.sheets[0].images[0];
  expect(image.bounds.left).toBeCloseTo(105);
  expect(image.bounds.top).toBeCloseTo(195);
  expect(image.bounds.right).toBeCloseTo(135);
  expect(image.bounds.bottom).toBeCloseTo(235);
  expect(image.appearance).toMatchObject({
    angle: 90,
    flipX: true,
    flipY: false,
    srcRect: { left: 5, right: 10, top: 2, bottom: 4 },
  });
  expect(layout.sheets[0].bounds).toEqual(image.bounds);
});

test('negative authored positions and rotated extents are preserved inside a bounded crop', async () => {
  const book = workbook();
  drawings(book, {
    picture: drawing('picture', {
      anchorType: '2',
      transform: { left: -20, top: -10, width: 100, height: 40, angle: 90 },
    }),
  });
  const layout = await prepareSheetLayout(book, await prepared(), frame);
  expect(layout.pages).toHaveLength(1);
  expect(layout.pages[0].source.left).toBeCloseTo(10);
  expect(layout.pages[0].source.top).toBeCloseTo(-40);
  expect(layout.pages[0].source.right).toBeCloseTo(50);
  expect(layout.pages[0].source.bottom).toBeCloseTo(60);
  expect(layout.pages[0].scale).toBe(0.75);
});

test('text-expanded repagination keeps image slices contiguous and rechecks aggregate admission', async () => {
  const book = workbook();
  drawings(book, {
    picture: drawing('picture', {
      anchorType: '2',
      transform: { left: 20, top: 20, width: 60, height: 1500 },
    }),
  });
  const layout = await prepareSheetLayout(book, await prepared(), frame);
  layout.sheets[0].bounds = { left: -2, top: -2, right: 1000, bottom: 2000 };
  const pages = replanSheetPages(layout, frame);
  expect(pages[0].scale).toBeCloseTo(523 / 1002);
  expect(pages[0].images[0].crop.bottom).toBe(pages[1].images[0].crop.top);
  expect(pages[1].images[0].crop.bottom).toBe(1);
  expect(pages.at(-1)?.source.bottom).toBe(2000);
  expect(() =>
    replanSheetPages({ ...layout, limits: { ...layout.limits, pages: 1 } }, frame),
  ).toThrow('page budget');
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
