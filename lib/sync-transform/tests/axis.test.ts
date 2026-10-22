import { describe, expect, test } from 'vitest';
import { mapIndex, transformAxis } from '../src/axis.ts';
import {
  insertCols,
  insertRows,
  insertSheet,
  moveCols,
  moveRows,
  moveSheet,
  removeCols,
  removeRows,
  removeSheet,
} from './edits.ts';
import { seededWorkbook } from './generate.ts';
import { converges } from './harness.ts';
import type { Mutation } from '../index.ts';

const sides = ['left', 'right'] as const;

/** The seeded workbook with sheet s1 made 12×12, so rows and columns take the same edits. */
function squareBook() {
  const book = seededWorkbook();
  const cellData: Record<number, Record<number, { v: string }>> = {};
  for (let row = 0; row < 12; row++)
    for (let col = 0; col < 12; col++) (cellData[row] ??= {})[col] = { v: `s1:${row}:${col}` };
  book.sheets.s1 = { ...book.sheets.s1, columnCount: 12, cellData };
  return book;
}

/** Each axis's edits, and its first line read along it: its cells name their original line. */
const axes = {
  row: {
    insert: insertRows,
    remove: removeRows,
    move: moveRows,
    line: (sheet: any) =>
      Array.from({ length: sheet.rowCount }, (_, row) => sheet.cellData[row]?.[0]?.v),
    original: (...rows: number[]) => rows.map((row) => `s1:${row}:0`),
  },
  column: {
    insert: insertCols,
    remove: removeCols,
    move: moveCols,
    line: (sheet: any) =>
      Array.from({ length: sheet.columnCount }, (_, col) => sheet.cellData[0]?.[col]?.v),
    original: (...cols: number[]) => cols.map((col) => `s1:0:${col}`),
  },
};
const order = (snapshot: any): string[] => snapshot.workbook.sheetOrder;

test('maps an index through insert, remove and move', () => {
  expect(mapIndex({ kind: 'insert', at: 2, count: 3 }, 2)).toBe(5);
  expect(mapIndex({ kind: 'remove', at: 2, count: 2 }, 3)).toBeNull();
  expect(mapIndex({ kind: 'remove', at: 2, count: 2 }, 4)).toBe(2);
  // Rows 1-2 move before row 5: they land at 3-4 and rows 3-4 shift up.
  expect(mapIndex({ kind: 'move', from: 1, count: 2, to: 5 }, 1)).toBe(3);
  expect(mapIndex({ kind: 'move', from: 1, count: 2, to: 5 }, 3)).toBe(1);
  expect(mapIndex({ kind: 'move', from: 4, count: 1, to: 0 }, 0)).toBe(1);
});

test('a concurrent edit keeps its own rows: a move survives an insert above it', () => {
  const steps = transformAxis(
    { kind: 'move', from: 3, count: 1, to: 0 },
    { kind: 'insert', at: 1, count: 2 },
    'right',
  );
  expect(steps).toEqual([{ kind: 'move', from: 5, count: 1, to: 0, items: [3] }]);
});

describe.each(
  (['row', 'column'] as const).flatMap((axis) => sides.map((side) => [axis, side] as const)),
)('%ss, %s wins', (axis, side) => {
  const { insert, remove, move, line, original } = axes[axis];
  const document = { workbook: squareBook() };
  const lines = (a: Mutation, b: Mutation) =>
    line(converges(a, b, { side, document }).workbook.sheets.s1);

  test('insert-then-delete: lines inserted inside a removed block survive it', () => {
    expect(lines(insert(3, 2), remove(2, 3))).toEqual([
      ...original(0, 1),
      undefined,
      undefined,
      ...original(5, 6, 7, 8, 9, 10, 11),
    ]);
  });

  test('two removes that overlap remove each line once', () => {
    expect(lines(remove(2, 3), remove(3, 3))).toEqual(original(0, 1, 6, 7, 8, 9, 10, 11));
  });

  test('move-over-move: the winner decides where a line both moved ends up', () => {
    // Left moves line 3 to the start; right moves it before line 8.
    expect(lines(move(3, 1, 0), move(3, 1, 8))).toEqual(
      side === 'left'
        ? original(3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11)
        : original(0, 1, 2, 4, 5, 6, 7, 3, 8, 9, 10, 11),
    );
  });

  test('moves of different lines both land', () => {
    expect(lines(move(1, 1, 6), move(9, 2, 0))).toEqual(
      original(9, 10, 0, 2, 3, 4, 5, 1, 6, 7, 8, 11),
    );
  });

  test('a removed line stays removed when the other side moved it', () => {
    expect(lines(move(3, 1, 0), remove(3, 1))).toEqual(original(0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11));
  });

  test('a moved block lands in place around lines removed beside it', () => {
    expect(lines(move(8, 2, 1), remove(2, 3))).toEqual(original(0, 8, 9, 1, 5, 6, 7, 10, 11));
  });
});

describe.each(sides)('sheet order, %s wins', (side) => {
  test('a reorder and an insert both land', () => {
    const result = converges(moveSheet('s1', 0, 1), insertSheet('n', 0), { side });
    expect(order(result)).toEqual(['n', 's2', 's1']);
  });

  test('a sheet reordered by one side and removed by the other is gone', () => {
    const result = converges(moveSheet('s2', 1, 0), removeSheet('s2', 'Two', 1), { side });
    expect(order(result)).toEqual(['s1']);
  });

  test('two reorders of one sheet: the winner decides where it goes', () => {
    const setup = [insertSheet('n', 2)];
    const result = converges(moveSheet('s1', 0, 2), moveSheet('s1', 0, 1), { side, setup });
    expect(order(result)).toEqual(side === 'left' ? ['s2', 'n', 's1'] : ['s2', 's1', 'n']);
  });

  test('reorders of different sheets both land', () => {
    const setup = [insertSheet('n', 2)];
    const result = converges(moveSheet('s1', 0, 2), moveSheet('n', 2, 0), { side, setup });
    expect(order(result)).toEqual(['n', 's2', 's1']);
  });
});
