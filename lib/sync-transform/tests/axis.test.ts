import { describe, expect, test } from 'vitest';
import { mapIndex, transformAxis } from '../src/axis.ts';
import { insertRows, insertSheet, moveRows, moveSheet, removeRows, removeSheet } from './edits.ts';
import { converges } from './harness.ts';

const sides = ['left', 'right'] as const;

/** Column 0 of sheet s1, whose seeded cells name their original row: `s1:<row>:0`. */
function column(snapshot: any): (string | undefined)[] {
  const sheet = snapshot.workbook.sheets.s1;
  return Array.from({ length: sheet.rowCount }, (_, row) => sheet.cellData[row]?.[0]?.v);
}
const original = (...rows: number[]) => rows.map((row) => `s1:${row}:0`);
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

describe.each(sides)('rows, %s wins', (side) => {
  test('insert-then-delete: rows inserted inside a removed block survive it', () => {
    const result = converges(insertRows(3, 2), removeRows(2, 3), { side });
    expect(column(result)).toEqual([
      ...original(0, 1),
      undefined,
      undefined,
      ...original(5, 6, 7, 8, 9, 10, 11),
    ]);
  });

  test('two removes that overlap remove each row once', () => {
    const result = converges(removeRows(2, 3), removeRows(3, 3), { side });
    expect(column(result)).toEqual(original(0, 1, 6, 7, 8, 9, 10, 11));
  });

  test('move-over-move: the winner decides where a row both moved ends up', () => {
    // Left moves row 3 to the top; right moves it before row 8.
    const result = converges(moveRows(3, 1, 0), moveRows(3, 1, 8), { side });
    expect(column(result)).toEqual(
      side === 'left'
        ? original(3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11)
        : original(0, 1, 2, 4, 5, 6, 7, 3, 8, 9, 10, 11),
    );
  });

  test('moves of different rows both land', () => {
    const result = converges(moveRows(1, 1, 6), moveRows(9, 2, 0), { side });
    expect(column(result)).toEqual(original(9, 10, 0, 2, 3, 4, 5, 1, 6, 7, 8, 11));
  });

  test('a removed row stays removed when the other side moved it', () => {
    const result = converges(moveRows(3, 1, 0), removeRows(3, 1), { side });
    expect(column(result)).toEqual(original(0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11));
  });

  test('a moved block lands in place around rows removed beside it', () => {
    const result = converges(moveRows(8, 2, 1), removeRows(2, 3), { side });
    expect(column(result)).toEqual(original(0, 8, 9, 1, 5, 6, 7, 10, 11));
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
