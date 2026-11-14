import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { cellsAt, changes, hashTouched, snapshotCells } from '../src/cells.ts';
import type { CellAddress, SyncRevision, SyncUnit } from '../index.ts';

const largeStyle = 'f'.repeat(30 * 1024);
function workbook(count = 400, sheetId = 'sheet'): IWorkbookData {
  return {
    id: 'book',
    name: 'Book',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: { shared: { ff: largeStyle } },
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: 'Sheet',
        rowCount: 500,
        columnCount: 26,
        cellData: Object.fromEntries(
          Array.from({ length: count }, (_, row) => [row, { 0: { v: row, s: 'shared' } }]),
        ),
      },
    },
  };
}
const addresses = (count = 400): CellAddress[] =>
  Array.from({ length: count }, (_, row) => ({ sheetId: 'sheet', row, column: 0 }));
function unit(snapshot: IWorkbookData, revision = 1): SyncUnit {
  return { unitId: 'book', kind: 'sheet', revision, retainedFrom: 1, snapshot };
}

test('expanded shared styles are bounded before snapshot or transform base clones accumulate', () => {
  const book = workbook();
  expect(Buffer.byteLength(JSON.stringify(book))).toBeLessThan(64 * 1024);
  for (const read of [snapshotCells(book), cellsAt(unit(book), 1, [])]) {
    let readCount = 0;
    expect(() => {
      for (const address of addresses()) {
        read('book', address.sheetId, address.row, address.column);
        readCount++;
      }
    }).toThrow('Sync request capacity');
    expect(readCount).toBeGreaterThan(100);
    expect(readCount).toBeLessThan(400);
  }
});

test('historical inline cells share the transform read budget with current cells', () => {
  const book = workbook(200);
  const previous: SyncRevision = {
    unitId: 'book',
    revision: 2,
    baseRevision: 1,
    actorId: 'owner',
    mutationId: 'earlier',
    requestHash: '',
    mutations: [],
    beforeCells: addresses()
      .slice(200)
      .map((address) => ({ ...address, value: { s: { ff: largeStyle } } })),
    touched: { kind: 'sheet', cells: [] },
    hash: '',
  };
  const read = cellsAt(unit(book, 2), 1, [previous]);
  let readCount = 0;
  expect(() => {
    for (const address of addresses()) {
      read('book', address.sheetId, address.row, address.column);
      readCount++;
    }
  }).toThrow('Sync request capacity');
  expect(readCount).toBeGreaterThan(200);
  expect(readCount).toBeLessThan(400);
});

test('snapshot differences and hash payloads refuse compact shared-style expansion', () => {
  // Old and new each get a bounded allowance, preserving large unchanged cells.
  const eachSideFits = workbook(200);
  expect(changes(eachSideFits, eachSideFits, 'sheet', [])).toEqual({
    beforeCells: [],
    touched: { kind: 'sheet', cells: [] },
  });
  const book = workbook();
  expect(() => changes(book, eachSideFits, 'sheet', [])).toThrow('Sync request capacity');
  expect(() => changes(eachSideFits, book, 'sheet', [])).toThrow('Sync request capacity');
  expect(() => hashTouched(book, { kind: 'sheet', cells: addresses() })).toThrow(
    'Sync request capacity',
  );
});

test('a compact long-ID range is refused while enumerating its bounded footprint', () => {
  const sheetId = 's'.repeat(30 * 1024);
  const book = workbook(0, sheetId);
  expect(() =>
    changes(book, book, 'sheet', [
      {
        id: 'sheet.mutation.remove.numfmt',
        params: {
          unitId: 'book',
          subUnitId: sheetId,
          ranges: [{ startRow: 0, endRow: 19, startColumn: 0, endColumn: 19 }],
        },
      },
    ]),
  ).toThrow('Sync request capacity');
});

test('admitted long IDs and styles preserve the canonical hash and independent cell copies', () => {
  const sheetId = 's'.repeat(1024);
  const book = workbook(2, sheetId);
  book.styles.shared = { bl: 1 };
  const read = snapshotCells(book);
  const first = read('book', sheetId, 0, 0)!;
  first.s.bl = 0;
  expect(read('book', sheetId, 0, 0)?.s).toEqual({ bl: 1 });
  const expected = [0, 1].map((row) => ({
    column: 0,
    row,
    sheetId,
    value: { s: { bl: 1 }, v: row },
  }));
  expect(
    hashTouched(book, {
      kind: 'sheet',
      cells: [1, 0].map((row) => ({ sheetId, row, column: 0 })),
    }),
  ).toBe(createHash('sha256').update(JSON.stringify(expected)).digest('hex'));
});
