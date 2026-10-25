import { describe, expect, test } from 'vitest';
import type { IWorkbookData } from '@univerjs/core';
import { PRINT_LIMITS, PrintError, paginateSheet, preflightSheets } from './index.ts';
import { inspectSnapshot } from './preflight.ts';

function sparseArray<T>(length: number): T[] {
  const result: T[] = [];
  // Preserve real holes: filled entries would not exercise logical-length admission.
  result.length = length;
  return result;
}

function workbook(): IWorkbookData {
  return {
    id: 'book',
    name: 'Private workbook',
    appVersion: '1.1.0',
    locale: 'enUS',
    styles: {},
    sheetOrder: ['first', 'second', 'hidden', 'very-hidden'],
    sheets: {
      first: {
        id: 'first',
        rowCount: 10,
        columnCount: 5,
        defaultRowHeight: 20,
        defaultColumnWidth: 80,
        cellData: { 0: { 0: { v: 'First' } } },
      },
      second: { id: 'second', rowCount: 4, columnCount: 3, cellData: { 3: { 2: { v: 'Last' } } } },
      hidden: { id: 'hidden', hidden: 1 },
      'very-hidden': { id: 'very-hidden', hidden: 2 },
    },
  } as IWorkbookData;
}

test('selects only visible worksheets in workbook order, never caller order', () => {
  const book = workbook();
  expect(preflightSheets(book).sheets.map((sheet) => sheet.id)).toEqual(['first', 'second']);
  expect(
    preflightSheets(book, { worksheetIds: ['second', 'hidden', 'first'] }).sheets.map(
      (sheet) => sheet.id,
    ),
  ).toEqual(['first', 'second']);
  for (const worksheetIds of [[], ['hidden'], ['missing'], ['first', 'first']])
    expect(() => preflightSheets(book, { worksheetIds })).toThrow(PrintError);
  book.sheetOrder.push('first');
  expect(() => preflightSheets(book)).toThrow('worksheet order');
});

test('keeps native indices but collapses hidden axes and honors automatic row height', () => {
  const book = workbook();
  book.sheets.first.rowData = {
    0: { h: 50, ah: 30 },
    1: { hd: 1, h: 60 },
    2: { ia: 0, h: 40, ah: 90 },
  };
  book.sheets.first.columnData = { 0: { w: 100 }, 1: { hd: 1 }, 2: { w: 25 } };
  book.sheets.first.cellData = { 1: { 1: { v: 'Hidden only' } }, 2: { 2: { v: 0 } } };
  const first = preflightSheets(book).sheets[0];
  expect(first.rows.subarray(0, 4)).toEqual(Float64Array.of(0, 30, 30, 70));
  expect(first.columns.subarray(0, 4)).toEqual(Float64Array.of(0, 100, 100, 125));
  expect(first.cellBounds).toEqual({ left: 100, top: 30, right: 125, bottom: 70 });
  expect(first.visibleGridCells).toBe(1);
});

test('bounds sparse content, explicit cell styles and inclusive merges without adding viewport grid', () => {
  const book = workbook();
  book.sheets.first.cellData = {
    2: { 1: { v: false } },
    4: { 2: { s: { bg: { rgb: '#FF0000' } } } },
  };
  book.sheets.first.mergeData = [{ startRow: 4, endRow: 6, startColumn: 2, endColumn: 3 }];
  const before = JSON.stringify(book);
  const first = preflightSheets(book).sheets[0];
  expect(first.cellBounds).toEqual({ left: 80, top: 40, right: 320, bottom: 140 });
  expect(first.visibleGridCells).toBe(15);
  expect(JSON.stringify(book)).toBe(before);
  book.sheets.first.cellData = {};
  book.sheets.first.mergeData = [];
  expect(preflightSheets(book).sheets[0].cellBounds).toBeNull();
});

describe('bounded malformed input handling before native allocation', () => {
  test('rejects out-of-grid cells, malformed ranges and excessive grid work', () => {
    const book = workbook();
    book.sheets.first.cellData = { 10: { 0: { v: 1 } } };
    expect(() => preflightSheets(book)).toThrow('out of range');
    book.sheets.first.cellData = { 0: { 0: { v: 1 } }, 9: { 4: { v: 2 } } };
    expect(() => preflightSheets(book, { limits: { gridCells: 49 } })).toThrow('layout budget');
    book.sheets.first.mergeData = [{ startRow: 2, endRow: 1, startColumn: 0, endColumn: 1 }];
    expect(() => preflightSheets(book)).toThrow('merge order');
  });

  test('limits aggregate populated cells and merges across worksheets', () => {
    expect(() => preflightSheets(workbook(), { limits: { cells: 1 } })).toThrow('populated cells');
    const book = workbook();
    book.sheets.first.mergeData = [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }];
    book.sheets.second.mergeData = [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }];
    expect(() => preflightSheets(book, { limits: { merges: 1 } })).toThrow('too many merges');
    book.sheets.first.rowData = { 0: { hd: 1 }, 1: { hd: 1 } };
    expect(() => preflightSheets(book, { limits: { mergeCells: 3 } })).toThrow('index budget');
    expect(() => preflightSheets(workbook(), { limits: { textCharacters: 2 } })).toThrow(
      'text exceeds',
    );
  });

  test('rejects whole-axis and overlapping merges before native indexing', () => {
    const book = workbook();
    for (const rangeType of [1, 2, 3]) {
      book.sheets.first.mergeData = [
        { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0, rangeType },
      ];
      expect(() => preflightSheets(book)).toThrow('finite cell ranges');
    }
    const first = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 };
    for (const overlapping of [
      first,
      { startRow: 1, endRow: 3, startColumn: 1, endColumn: 2 },
      { startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 },
    ]) {
      book.sheets.first.mergeData = [first, overlapping];
      expect(() => preflightSheets(book)).toThrow('must not overlap');
    }
    book.sheets.first.mergeData = [
      first,
      { startRow: 0, endRow: 2, startColumn: 2, endColumn: 3 },
      { startRow: 3, endRow: 4, startColumn: 0, endColumn: 1, rangeType: 0 },
    ];
    expect(() => preflightSheets(book)).not.toThrow();
  });

  test('caps nodes, text bytes, nesting, arrays and axes', () => {
    expect(() => preflightSheets(workbook(), { limits: { snapshotNodes: 3 } })).toThrow('entries');
    expect(() => preflightSheets(workbook(), { limits: { snapshotBytes: 30 } })).toThrow(
      'byte budget',
    );
    expect(() => preflightSheets(workbook(), { limits: { rows: 3 } })).toThrow('axis count');
    const book = workbook();
    let nested: Record<string, unknown> = {};
    book.custom = nested;
    for (let i = 0; i < 66; i++) {
      const child = {};
      nested.next = child;
      nested = child;
    }
    expect(() => preflightSheets(book)).toThrow('deeply nested');
  });

  test('charges sparse logical entries before downstream resource iteration', () => {
    const book = workbook();
    // This allocates no image/resource payload, but an unchecked consumer would
    // still see billions of logical entries rather than the tiny own-key count.
    book.resources = sparseArray(0xffffffff);
    expect(() => preflightSheets(book)).toThrow('array exceeds its entry budget');
    delete book.resources;
    book.custom = { first: sparseArray(130_000), second: sparseArray(130_000) };
    expect(() => preflightSheets(book)).toThrow('too many entries');

    const sparse = sparseArray(4);
    expect(() =>
      inspectSnapshot(sparse, { ...PRINT_LIMITS, snapshotNodes: 5 }, () => {}),
    ).not.toThrow();
    expect(() => inspectSnapshot(sparse, { ...PRINT_LIMITS, snapshotNodes: 4 }, () => {})).toThrow(
      'entries',
    );
    expect(() => inspectSnapshot(sparse, { ...PRINT_LIMITS, snapshotBytes: 21 }, () => {})).toThrow(
      'byte budget',
    );
    expect(() =>
      inspectSnapshot(sparse, { ...PRINT_LIMITS, snapshotBytes: 22 }, () => {}),
    ).not.toThrow();
    const explicitEmpty = { first: [undefined, undefined], second: [undefined, undefined] };
    expect(() =>
      inspectSnapshot(explicitEmpty, { ...PRINT_LIMITS, snapshotNodes: 6 }, () => {}),
    ).toThrow('entries');
    expect(() =>
      inspectSnapshot(explicitEmpty, { ...PRINT_LIMITS, snapshotNodes: 8 }, () => {}),
    ).not.toThrow();
  });

  test('rejects hidden accessors before geometry reads and hidden data before cloning', () => {
    const book = workbook();
    let invoked = false;
    Object.defineProperty(book.sheets.first, 'rowData', {
      configurable: true,
      get() {
        invoked = true;
        throw new Error('Private getter output');
      },
    });
    expect(() => preflightSheets(book)).toThrow('must not contain accessors');
    expect(invoked).toBe(false);
    Object.defineProperty(book.sheets.first, 'rowData', { value: {}, enumerable: false });
    expect(() => preflightSheets(book)).toThrow('properties must be enumerable');

    const hidden = Object.defineProperty({}, Symbol('private'), {
      get() {
        invoked = true;
        throw new Error('Private symbol output');
      },
    });
    expect(() => inspectSnapshot(hidden, PRINT_LIMITS, () => {})).toThrow(
      'Invalid PDF snapshot key',
    );
    expect(invoked).toBe(false);
  });

  test('rejects cycles and accessors without invoking them or revealing private input', () => {
    const book = workbook();
    book.custom = { loop: book };
    expect(() => preflightSheets(book)).toThrow('cycle');
    let invoked = false;
    book.custom = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error('Sensitive content');
      },
    });
    expect(() => preflightSheets(book)).toThrow('accessors');
    expect(invoked).toBe(false);
    book.sheets.first.defaultRowHeight = Number.NaN;
    delete book.custom;
    expect(() => preflightSheets(book)).toThrow('non-finite');
  });

  test('allows lower limits only and respects cancellation before work', () => {
    expect(() =>
      preflightSheets(workbook(), { limits: { pages: PRINT_LIMITS.pages + 1 } }),
    ).toThrow('within package bounds');
    expect(() => preflightSheets(workbook(), { limits: { durationMs: 0 } })).toThrow('positive');
    const controller = new AbortController();
    controller.abort();
    expect(() => preflightSheets(workbook(), { signal: controller.signal })).toThrow(
      expect.objectContaining({ code: 'cancelled' }),
    );
  });
});

test('shrinks wide content once across and never enlarges narrow content', () => {
  const frame = { width: 595, height: 842 };
  const narrow = paginateSheet('first', { left: 50, top: 20, right: 250, bottom: 70 }, frame, 100);
  expect(narrow).toEqual([
    { sheetId: 'first', scale: 0.75, source: { left: 50, top: 20, right: 250, bottom: 70 } },
  ]);
  const wide = paginateSheet('first', { left: 0, top: 0, right: 2000, bottom: 4000 }, frame, 100);
  expect(wide[0].scale).toBe((595 - 72) / 2000);
  expect(wide).toHaveLength(2);
  expect(wide[0].source.bottom).toBe(wide[1].source.top);
  expect(wide[1].source.bottom).toBe(4000);
});

test('continues oversized row/merge/image pixel slices, with zero overlap or missing tail', () => {
  const source = { left: 0, top: 42, right: 200, bottom: 3042 };
  const pages = paginateSheet('first', source, { width: 595, height: 842 }, 100);
  expect(pages).toHaveLength(3);
  expect(pages[0].source.top).toBe(42);
  expect(pages.at(-1)!.source.bottom).toBe(3042);
  expect(pages.slice(1).every((page, i) => page.source.top === pages[i].source.bottom)).toBe(true);
  // Exact adjacent edges above prove continuity; summing fractional page heights
  // adds ordinary floating-point rounding and needs a sub-pixel tolerance.
  expect(pages.reduce((sum, page) => sum + page.source.bottom - page.source.top, 0)).toBeCloseTo(
    3000,
    9,
  );
  expect(() => paginateSheet('first', source, { width: 595, height: 842 }, 2)).toThrow(
    'page budget',
  );
  expect(paginateSheet('empty', null, { width: 595, height: 842 }, 1)[0].source).toEqual({
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  });
});

test('preserves bounded negative drawing and border extents inside the PDF margins', () => {
  const bounds = { left: -30.25, top: -0.5, right: 180, bottom: 40 };
  expect(paginateSheet('rotated', bounds, { width: 595, height: 842 }, 1)[0]).toEqual({
    sheetId: 'rotated',
    source: bounds,
    scale: 0.75,
  });
  expect(() =>
    paginateSheet('invalid', { ...bounds, left: -1e20 }, { width: 595, height: 842 }, 1),
  ).toThrow('used range');
});
