import { describe, expect, test } from 'vitest';
import { RefusedEditError, transform, transformMutation } from '../index.ts';
import type { Mutation, Side } from '../index.ts';
import { cellIds } from '../src/cells.ts';
import {
  cellEdit,
  cellMove,
  commandEdit,
  commands,
  richDoc,
  shiftCommand,
} from './generate-cells.ts';
import { seededWorkbook, withStructure } from './generate.ts';
import { converges, Replica } from './harness.ts';
import { insertCols, insertRows, moveRows, removeCols, removeRows } from './edits.ts';
import { convergesOver } from './simulate.ts';

const unitId = 'wb';
const subUnitId = 's1';

const set = (cellValue: unknown, extra = {}): Mutation => ({
  id: cellIds.setRangeValues,
  params: { unitId, subUnitId, cellValue, ...extra },
});
const cell = (row: number, col: number, value: unknown) => set({ [row]: { [col]: value } });
const range = (
  startRow: number,
  startColumn: number,
  endRow = startRow,
  endColumn = startColumn,
) => ({
  startRow,
  startColumn,
  endRow,
  endColumn,
});
const setNumfmt = (pattern: string, ranges: unknown[]): Mutation => ({
  id: cellIds.setNumfmt,
  params: { unitId, subUnitId, values: { k: { ranges } }, refMap: { k: { pattern } } },
});
const removeNumfmt = (ranges: unknown[]): Mutation => ({
  id: cellIds.removeNumfmt,
  params: { unitId, subUnitId, ranges },
});
/** Moves one cell, as getMoveRangeUndoRedoMutations would with `value` there. */
const move = (from: [number, number], to: [number, number], value: unknown): Mutation => ({
  id: cellIds.moveRange,
  params: {
    unitId,
    fromRange: range(...from),
    toRange: range(...to),
    from: { subUnitId, value: { [from[0]]: { [from[1]]: null } } },
    to: { subUnitId, value: { [to[0]]: { [to[1]]: value } } },
  },
});
/** Moves rows `start` to `end` of column `col` to start at `toRow` of `toCol`, on the seeded sheet. */
function moveColumn(
  start: number,
  end: number,
  col: number,
  toRow: number,
  toCol: number,
): Mutation {
  const from: Record<number, Record<number, null>> = {};
  const to: Record<number, Record<number, unknown>> = {};
  for (let row = start; row <= end; row++) {
    from[row] = { [col]: null };
    to[row - start + toRow] = { [toCol]: { v: `s1:${row}:${col}` } };
  }
  return {
    id: cellIds.moveRange,
    params: {
      unitId,
      fromRange: range(start, col, end, col),
      toRange: range(toRow, toCol, toRow + end - start, toCol),
      from: { subUnitId, value: from },
      to: { subUnitId, value: to },
    },
  };
}
function cellAt(mutations: Mutation[], row: number, col: number) {
  const replica = new Replica({ workbook: seededWorkbook() });
  replica.apply(mutations);
  const snapshot = replica.snapshot() as any;
  return snapshot.workbook.sheets[subUnitId].cellData[row]?.[col];
}

/** The cells of s1 after both orders of `a` and `b`, which must agree. */
const merged = (
  a: Mutation | Mutation[],
  b: Mutation | Mutation[],
  side: Side = 'left',
  setup: Mutation[] = [],
) => converges(a, b, { side, setup }).workbook.sheets[subUnitId].cellData;

describe('concurrent cell writes', () => {
  // A command's own mutations, before JSON drops them, can set a key to
  // undefined, as InsertRangeMoveDownCommand does for `s`, and the sender
  // transforms its own pending edits as made.
  test('a key set to undefined counts as absent', () => {
    const a = cell(0, 0, { s: undefined, v: 'a' });
    const b = cell(0, 0, { s: { bl: 1 }, v: 'b' });
    expect(merged(a, b, 'right')[0][0]).toMatchObject({ v: 'b', s: { bl: 1 } });
    expect(merged(b, a, 'left')[0][0]).toMatchObject({ v: 'b', s: { bl: 1 } });
  });

  test('the winner takes a value both write', () => {
    expect(merged(cell(0, 0, { v: 'a' }), cell(0, 0, { v: 'b' }))[0][0].v).toBe('a');
    expect(merged(cell(0, 0, { v: 'a' }), cell(0, 0, { v: 'b' }), 'right')[0][0].v).toBe('b');
  });

  test('different keys of one cell both land', () => {
    const data = merged(cell(1, 1, { s: { bl: 1 } }), cell(1, 1, { s: { it: 1 }, v: 'x' }));
    expect(data[1][1]).toMatchObject({ v: 'x', s: { bl: 1, it: 1 } });
  });

  test('different cells of one write are untouched by the conflict', () => {
    const a = set({ 0: { 0: { v: 'a' }, 1: { v: 'a' } } });
    const data = merged(a, cell(0, 1, { v: 'b' }), 'right');
    expect([data[0][0].v, data[0][1].v]).toEqual(['a', 'b']);
  });

  test('a delete beats a style it loses to, and is restyled by one it loses to', () => {
    expect(merged(cell(2, 2, null), cell(2, 2, { s: { bl: 1 } }))[2]?.[2]).toBeUndefined();
    expect(merged(cell(2, 2, { s: { bl: 1 } }), cell(2, 2, null))[2][2]).toEqual({ s: { bl: 1 } });
  });

  test('an overriding style replaces style keys written concurrently', () => {
    const override = set({ 3: { 0: { s: { it: 1 } } } }, { isOverrideStyle: true });
    expect(merged(override, cell(3, 0, { s: { bl: 1 } }))[3][0].s).toEqual({ it: 1 });
    expect(merged(override, cell(3, 0, { s: { bl: 1 } }), 'right')[3][0].s).toEqual({
      it: 1,
      bl: 1,
    });
  });

  test('number formats conflict with a style write of `n` only', () => {
    const write = cell(0, 0, { s: { n: { pattern: '0.00' }, bl: 1 }, v: 'x' });
    const data = merged(setNumfmt('0%', [range(0, 0, 1, 1)]), write);
    expect(data[0][0].s).toEqual({ n: { pattern: '0%' }, bl: 1 });
    expect(merged(removeNumfmt([range(0, 0)]), write, 'right')[0][0].s).toEqual({
      n: { pattern: '0.00' },
      bl: 1,
    });
  });

  test('a value written concurrently with text format is typed as text in both orders', () => {
    const value = cell(0, 0, { v: 7, f: null, si: null, p: null });
    for (const side of ['left', 'right'] as const) {
      expect(merged(setNumfmt('@', [range(0, 0)]), value, side)[0][0]).toMatchObject({
        t: 1,
        v: '7',
      });
    }
  });

  test('a value is typed by the format that wins its cell', () => {
    const pasted = set(
      { 0: { 0: { s: { n: { pattern: '@' } }, v: 0 } } },
      { isOverrideStyle: true },
    );
    expect(merged(setNumfmt('0%', [range(0, 0)]), pasted)[0][0]).toMatchObject({ t: 2, v: 0 });
    expect(merged(setNumfmt('0%', [range(0, 0)]), pasted, 'right')[0][0]).toMatchObject({
      t: 1,
      v: '0',
    });
  });

  test('a losing number format keeps its other cells, regrouped', () => {
    const [kept] = transformMutation(
      setNumfmt('0%', [range(0, 0, 1, 1)]),
      cell(0, 0, { s: { n: null }, v: 'x' }),
      'right',
    );
    expect(kept.params.values.k.ranges).toEqual([range(0, 1), range(1, 0, 1, 1)]);
  });

  test('a value cancels a concurrent type-only write, whichever wins', () => {
    // RemoveNumfmt's companion types a cell with no value as text (4).
    const styleOnly = [cell(0, 0, null), cell(0, 0, { s: { bl: 1 } })];
    for (const side of ['left', 'right'] as const) {
      const data = merged(cell(0, 0, { t: 4 }), cell(0, 0, { v: 'b' }), side, styleOnly);
      expect(data[0][0]).toEqual({ v: 'b', t: 1, s: { bl: 1 } });
    }
  });

  test('a type forced with a value types a concurrent value written after it', () => {
    // Forced text sticks to the next value; the editor's commit under `@` forces plain text.
    const stuck = [cell(0, 0, { s: { n: { pattern: '@' } }, v: 'x', t: 4 })];
    const commit = cell(0, 0, { v: '=1+2', t: 1, f: null, si: null, p: null });
    const value = cell(0, 0, { v: 1, f: null, si: null, p: null });
    expect(merged(commit, value, 'right', stuck)[0][0]).toMatchObject({ v: '1', t: 1 });
    expect(merged(commit, value, 'left', stuck)[0][0]).toMatchObject({ v: '=1+2', t: 1 });
  });
});

describe('rich text and styles', () => {
  const style = cell(0, 0, { s: { bl: 1 } });
  // As getCellDataByInput commits rich text over a plain value.
  const commit = cell(0, 0, { p: richDoc('bye'), v: null, f: null, si: null });
  const holdsRichText = [cell(0, 0, { p: richDoc('old'), v: null })];
  const bold = (data: any) =>
    data[0][0].p.body.textRuns.map((run: { ts?: { bl?: number } }) => run.ts?.bl === 1);

  test('a style that wins restyles rich text written concurrently', () => {
    for (const setup of [[], holdsRichText]) {
      for (const data of [
        merged(style, commit, 'left', setup),
        merged(commit, style, 'right', setup),
      ]) {
        expect(data[0][0].s).toEqual({ bl: 1 });
        expect(bold(data)).toEqual([true, true]);
      }
    }
  });

  test('rich text that wins keeps its own runs under a concurrent style', () => {
    for (const setup of [[], holdsRichText]) {
      for (const data of [
        merged(style, commit, 'right', setup),
        merged(commit, style, 'left', setup),
      ]) {
        expect(data[0][0].s).toEqual({ bl: 1 });
        expect(bold(data)).toEqual([false]);
      }
    }
  });
});

describe('a move past rows inserted or removed inside it', () => {
  // Cuts A1:A3 to D10:D12; the other client edits a row inside it.
  const cut = moveColumn(0, 2, 0, 9, 3);
  const columnD = (edits: Mutation[], side: Side) => {
    const data = merged(cut, edits, side);
    return Array.from({ length: 14 }, (_, row) => data[row]?.[3]?.v);
  };
  const sides = ['left', 'right'] as const;

  test('an insert inside the source splits the move', () => {
    for (const side of sides) {
      const d = columnD([insertRows(1, 1)], side);
      expect(d.slice(10, 13)).toEqual(['s1:0:0', 's1:1:0', 's1:2:0']);
    }
  });

  test('an insert inside the target splits the move', () => {
    for (const side of sides) {
      const d = columnD([insertRows(10, 1)], side);
      expect(d.slice(9, 13)).toEqual(['s1:0:0', undefined, 's1:1:0', 's1:2:0']);
    }
  });

  test('a removal inside the source still lands the copy', () => {
    for (const side of sides) {
      const d = columnD([removeRows(1, 1)], side);
      expect(d.slice(8, 11)).toEqual(['s1:0:0', 's1:1:0', 's1:2:0']);
    }
  });

  test('a removal inside the target drops that copy only', () => {
    for (const side of sides) {
      const d = columnD([removeRows(10, 1)], side);
      expect(d.slice(9, 11)).toEqual(['s1:0:0', 's1:2:0']);
    }
  });

  test('a removal over the start of the source leaves valid ranges', () => {
    const [shifted] = transformMutation(cut, removeRows(0, 1), 'left');
    expect(shifted.params.fromRange.startRow).toBeGreaterThanOrEqual(0);
    for (const side of sides) {
      expect(columnD([removeRows(0, 1)], side).slice(8, 11)).toEqual([
        's1:0:0',
        's1:1:0',
        's1:2:0',
      ]);
    }
  });
});

describe('rows and columns move under cell edits', () => {
  const remapped = (edit: Mutation, structural: Mutation) => {
    const [result] = transformMutation(edit, structural, 'left');
    merged(edit, structural);
    return result;
  };

  test('an insert above shifts the cell down', () => {
    expect(remapped(cell(3, 1, { v: 'x' }), insertRows(1, 2)).params.cellValue).toEqual({
      5: { 1: { v: 'x' } },
    });
  });

  test('a removed row drops its cells, and the edit when none are left', () => {
    const write = set({ 3: { 0: { v: 'x' } }, 4: { 0: { v: 'y' } } });
    expect(remapped(write, removeRows(3, 1)).params.cellValue).toEqual({ 3: { 0: { v: 'y' } } });
    expect(transformMutation(cell(3, 0, { v: 'x' }), removeRows(2, 2), 'left')).toEqual([]);
  });

  test('a row move carries the cell with it', () => {
    expect(remapped(cell(1, 0, { v: 'x' }), moveRows(1, 1, 5)).params.cellValue).toEqual({
      4: { 0: { v: 'x' } },
    });
  });

  test('a number format range split by an insert becomes two ranges', () => {
    const result = remapped(setNumfmt('0%', [range(1, 0, 2, 0)]), insertRows(2, 1));
    expect(result.params.values.k.ranges).toEqual([range(1, 0), range(3, 0)]);
  });

  test('a column insert shifts a move and its ranges', () => {
    const result = remapped(move([0, 0], [2, 2], { v: 's1:0:0' }), insertCols(0, 1));
    expect(result.params.fromRange).toEqual(range(0, 1));
    expect(result.params.to.value).toEqual({ 2: { 3: { v: 's1:0:0' } } });
  });

  test('the cell lands where Univer put the content', () => {
    expect(cellAt([moveRows(1, 1, 5)], 4, 0).v).toBe('s1:1:0');
  });
});

// Decision (owner, chat 2026-10-20): a drag and a concurrent edit of a cell it
// moves are refused, not merged (see cells.transform).
describe('a drag against a concurrent edit of its cells', () => {
  const drag = move([0, 0], [5, 5], { v: 's1:0:0' });
  const sides = ['left', 'right'] as const;
  const touching: [string, Mutation][] = [
    ['its source', cell(0, 0, { s: { bl: 1 } })],
    ['its target', cell(5, 5, { v: 'x' })],
    ['its source, by number format', setNumfmt('0%', [range(0, 0)])],
    ['its target, by number format', setNumfmt('0%', [range(5, 5)])],
  ];
  for (const [name, edit] of touching) {
    test(`an edit of ${name} is refused, both ways and on either side`, () => {
      for (const side of sides) {
        for (const [a, b] of [
          [drag, edit],
          [edit, drag],
        ]) {
          expect(() => transform([a], [b], side)).toThrow(RefusedEditError);
          expect(() => transformMutation(a, b, side)).toThrow(
            expect.objectContaining({ reason: 'moved-cells' }),
          );
        }
      }
    });
  }

  test('an edit of another cell passes, both ways and on either side', () => {
    const edit = cell(2, 2, { v: 'x' });
    for (const side of sides) {
      expect(transformMutation(drag, edit, side)).toEqual([drag]);
      expect(transformMutation(edit, drag, side)).toEqual([edit]);
      const data = merged(drag, edit, side);
      expect([data[5][5].v, data[2][2].v, data[0]?.[0]]).toEqual(['s1:0:0', 'x', undefined]);
    }
  });

  test('a sequence with an edit of a moved cell is refused', () => {
    const edits = [cell(2, 2, { v: 'x' }), cell(0, 0, { v: 'y' })];
    for (const side of sides) {
      expect(() => transform(edits, [drag], side)).toThrow(RefusedEditError);
      expect(() => transform([drag], edits, side)).toThrow(RefusedEditError);
    }
  });
});

describe('a number format against a write to its cell that sets no value', () => {
  // Once dense seed 627, shrunk: SetNumfmtCommand '@' sends no retype, so the
  // cell keeps its boolean under text format. Bold written under '@' turns it
  // to text "1", which '0%' then types as a number; bold written after '0%'
  // leaves the boolean.
  const setup = [
    set({ 2: { 1: { s: { n: { pattern: '0.00' } }, v: 'TRUE' } } }, { isOverrideStyle: true }),
    setNumfmt('@', [range(2, 1, 3, 1)]),
  ];
  const percent = setNumfmt('0%', [range(2, 1, 3, 1)]);
  const sides = ['left', 'right'] as const;

  test('is refused, both ways and on either side', () => {
    const bold = cell(2, 1, { s: { bl: 0 } });
    for (const side of sides) {
      for (const [a, b] of [
        [bold, percent],
        [percent, bold],
      ]) {
        expect(() => transform([a], [b], side)).toThrow(RefusedEditError);
        expect(() => transformMutation(a, b, side)).toThrow(
          expect.objectContaining({ reason: 'format-race' }),
        );
      }
    }
  });

  test('a value written under text format converges with it', () => {
    const value = cell(2, 1, { v: 'TRUE', f: null, si: null, p: null });
    for (const side of sides) {
      expect(merged(value, percent, side, setup)[2][1]).toMatchObject({ v: 1, t: 3 });
    }
  });

  test('a style write to another cell passes', () => {
    const bold = cell(0, 0, { s: { bl: 1 } });
    for (const side of sides) {
      expect(transformMutation(bold, percent, side)).toEqual([bold]);
      expect(transformMutation(percent, bold, side)).toEqual([percent]);
      const data = merged(bold, percent, side, setup);
      expect([data[0][0].s.bl, data[2][1].s.n]).toEqual([1, { pattern: '0%' }]);
    }
  });
});

describe('a cell edit against a concurrent shift', () => {
  // Deleting B2:B3 with a shift up moves B4 and the cells below it up two rows.
  const shift = (command: string) =>
    shiftCommand(new Replica({ workbook: seededWorkbook() }), command, {
      unitId,
      subUnitId,
      range: range(1, 1, 2, 1),
    })!;
  const deleteUp = () => shift(commands.deleteMoveUp);
  const values = (data: any) => JSON.stringify(data);

  for (const side of ['left', 'right'] as const) {
    test(`a write in the band lands where the shift takes its cell (${side})`, () => {
      const data = merged(cell(5, 1, { v: 'x' }), deleteUp(), side);
      expect([data[3]?.[1]?.v, data[5]?.[1]?.v]).toEqual(['x', cellAt(deleteUp(), 5, 1)?.v]);
    });

    test(`a number format in the band lands where the shift takes its cell (${side})`, () => {
      const data = merged(setNumfmt('0.00', [range(5, 1)]), deleteUp(), side);
      expect(data[3]?.[1]?.s).toMatchObject({ n: { pattern: '0.00' } });
      expect(data[5]?.[1]?.s?.n).toBeUndefined();
    });

    test(`a write to a source cell the shift does not clear moves with the shift (${side})`, () => {
      // B11 moves to B9 and nothing moves onto it. Compacting drops the
      // shift's clear of B11 when the same message already emptied it, so
      // only the folded write can clear it there.
      const setup = [cell(10, 1, null)];
      const removal = deleteUp();
      const shift = removal.find((mutation) => mutation.id === cellIds.moveRange)!;
      delete shift.params.from.value[10][1];
      const data = merged(setNumfmt('0.00', [range(10, 1)]), removal, side, setup);
      expect(data[8]?.[1]?.s).toMatchObject({ n: { pattern: '0.00' } });
      expect(data[10]?.[1]).toBeUndefined();
    });

    test(`a write outside the band stays (${side})`, () => {
      expect(merged(cell(5, 2, { v: 'x' }), deleteUp(), side)[5]?.[2]?.v).toBe('x');
    });

    test(`a write to a deleted cell goes with it (${side})`, () => {
      const data = merged(cell(1, 1, { v: 'x' }), deleteUp(), side);
      expect(data[1]?.[1]).toEqual(cellAt(deleteUp(), 1, 1));
      expect(values(data)).not.toContain('"x"');
    });

    test(`a write where cells are inserted moves down with its cell (${side})`, () => {
      const insertDown = shift(commands.insertMoveDown);
      const data = merged(cell(1, 1, { v: 'x' }), insertDown, side);
      expect(data[3]?.[1]?.v).toBe('x');
      expect(data[1]?.[1]?.v).toBeUndefined();
    });
  }

  test('a shift whose mark disagrees with its ranges is rejected', () => {
    const wrong = deleteUp().map((mutation) =>
      mutation.params.shift
        ? {
            ...mutation,
            params: { ...mutation.params, shift: { ...mutation.params.shift, at: 0 } },
          }
        : mutation,
    );
    expect(() => transform(wrong, [cell(0, 0, { v: 1 })], 'left')).toThrow(TypeError);
  });
});

describe('two shifts of one band', () => {
  // Shifts in column B of the seeded sheet, whose cells name their original row.
  const shift = (
    command: string,
    start: number,
    end = start,
    replica = new Replica({ workbook: seededWorkbook() }),
  ) => shiftCommand(replica, command, { unitId, subUnitId, range: range(start, 1, end, 1) })!;
  const insertDown = (start: number, end = start) => shift(commands.insertMoveDown, start, end);
  const deleteUp = (start: number, end = start) => shift(commands.deleteMoveUp, start, end);
  /** Column B, row by row, as the names of the rows its cells came from. */
  const band = (data: any, col = 1) => {
    const last = Math.max(...Object.keys(data).map(Number));
    return Array.from({ length: last + 1 }, (_, row) => data[row]?.[col]?.v);
  };
  const original = (...rows: number[]) => rows.map((row) => `s1:${row}:1`);
  const through = (from: number, to: number, col = 1) =>
    Array.from({ length: to - from + 1 }, (_, i) => `s1:${from + i}:${col}`);
  const command = (name: string, at: ReturnType<typeof range>) =>
    shiftCommand(new Replica({ workbook: seededWorkbook() }), name, {
      unitId,
      subUnitId,
      range: at,
    })!;

  for (const side of ['left', 'right'] as const) {
    test(`two inserts at the same row both land (${side})`, () => {
      const data = merged(insertDown(2), insertDown(2, 3), side);
      expect(band(data).slice(0, 15)).toEqual([
        ...original(0, 1),
        undefined,
        undefined,
        undefined,
        ...through(2, 11),
      ]);
    });

    test(`cells inserted inside a deleted range survive it (${side})`, () => {
      const data = merged(deleteUp(1, 3), insertDown(2), side);
      expect(band(data).slice(0, 10)).toEqual([...original(0), undefined, ...through(4, 11)]);
    });

    test(`two overlapping deletes remove each cell once (${side})`, () => {
      const data = merged(deleteUp(1, 3), deleteUp(2, 4), side);
      expect(band(data).slice(0, 8)).toEqual([...original(0), ...through(5, 11)]);
    });

    test(`insert-then-delete: both of one side's shifts land past the other's (${side})`, () => {
      const replica = new Replica({ workbook: seededWorkbook() });
      const insert = shift(commands.insertMoveDown, 2, 2, replica);
      replica.apply(insert);
      const then = [...insert, ...shift(commands.deleteMoveUp, 5, 6, replica)];
      const data = merged(then, deleteUp(1), side);
      expect(band(data).slice(0, 10)).toEqual([
        ...original(0),
        undefined,
        ...original(2, 3),
        ...through(6, 11),
      ]);
    });

    test(`a write in cells one side shifted follows both shifts (${side})`, () => {
      const replica = new Replica({ workbook: seededWorkbook() });
      const removal = shift(commands.deleteMoveUp, 1, 2, replica);
      replica.apply(removal);
      const data = merged([...removal, cell(5, 1, { v: 'x' })], insertDown(2), side);
      expect(band(data).slice(0, 11)).toEqual([
        ...original(0),
        undefined,
        ...original(3, 4, 5, 6),
        'x',
        ...through(8, 11),
      ]);
    });
  }

  test('shifts of disjoint bands both land', () => {
    const other = shiftCommand(new Replica({ workbook: seededWorkbook() }), commands.deleteMoveUp, {
      unitId,
      subUnitId,
      range: range(1, 3),
    })!;
    const data = merged(insertDown(2), other);
    expect([data[3]?.[1]?.v, data[1]?.[3]?.v]).toEqual(['s1:2:1', 's1:2:3']);
  });

  for (const side of ['left', 'right'] as const) {
    test(`shifts of partly overlapping bands split, each part landing (${side})`, () => {
      // Deleting B2:C3 up against inserting C3:D3 down: column B only deletes,
      // column C merges the two, column D only inserts.
      const removal = command(commands.deleteMoveUp, range(1, 1, 2, 2));
      const insert = command(commands.insertMoveDown, range(2, 2, 2, 3));
      const data = merged(removal, insert, side);
      expect(band(data, 1).slice(0, 10)).toEqual(['s1:0:1', ...through(3, 11, 1)]);
      expect(band(data, 2).slice(0, 11)).toEqual(['s1:0:2', undefined, ...through(3, 11, 2)]);
      expect(band(data, 3).slice(0, 13)).toEqual([
        ...through(0, 1, 3),
        undefined,
        ...through(2, 11, 3),
      ]);
    });

    test(`shifts along different axes that miss each other both land (${side})`, () => {
      // B6 down shifts column B from row 6; D3 right shifts row 3 from column D.
      const down = command(commands.insertMoveDown, range(5, 1));
      const right = command(commands.insertMoveRight, range(2, 3));
      const data = merged(down, right, side);
      expect([data[6]?.[1]?.v, data[2]?.[4]?.v]).toEqual(['s1:5:1', 's1:2:3']);
    });
  }

  test('shifts along different axes whose cells meet are refused', () => {
    const down = command(commands.insertMoveDown, range(1, 1));
    const right = command(commands.insertMoveRight, range(4, 0));
    expect(() => transform(down, right, 'left')).toThrow(RefusedEditError);
  });
});

describe('a shift and a dragged range', () => {
  // Inserting B3 down shifts column B from row 2 by one, on the seeded sheet.
  const insertDown = () =>
    shiftCommand(new Replica({ workbook: seededWorkbook() }), commands.insertMoveDown, {
      unitId,
      subUnitId,
      range: range(2, 1),
    })!;
  const band = (data: any) => Array.from({ length: 13 }, (_, row) => data[row]?.[1]?.v);
  const names = (...rows: (number | undefined)[]) =>
    rows.map((row) => (row === undefined ? undefined : `s1:${row}:1`));

  for (const side of ['left', 'right'] as const) {
    test(`a drag within the shifted cells shifts with them (${side})`, () => {
      const data = merged(insertDown(), move([5, 1], [8, 1], { v: 's1:5:1' }), side);
      expect(band(data)).toEqual(names(0, 1, undefined, 2, 3, 4, undefined, 6, 7, 5, 9, 10, 11));
    });

    test(`a drag into the shifted cells lands where its target went (${side})`, () => {
      const data = merged(insertDown(), move([0, 0], [7, 1], { v: 's1:0:0' }), side);
      expect(data[0]?.[0]?.v).toBeUndefined();
      expect(band(data)).toEqual([
        ...names(0, 1, undefined, 2, 3, 4, 5, 6),
        's1:0:0',
        ...names(8, 9, 10, 11),
      ]);
    });

    test(`a drag out of the shifted cells takes the content from where it went (${side})`, () => {
      const data = merged(insertDown(), move([9, 1], [1, 4], { v: 's1:9:1' }), side);
      expect(data[1][4].v).toBe('s1:9:1');
      expect(band(data)).toEqual(names(0, 1, undefined, 2, 3, 4, 5, 6, 7, 8, undefined, 10, 11));
    });

    test(`a drag the band's edge or the shift's start cuts is refused (${side})`, () => {
      const [a, b] = side === 'left' ? [0, 1] : [1, 0];
      // A5:B5 to D5:E5 and B2:B4 to E2:E4.
      const edge = moveColumn(4, 4, 0, 4, 3);
      edge.params.fromRange.endColumn = 1;
      edge.params.toRange.endColumn = 4;
      edge.params.from.value[4][1] = null;
      edge.params.to.value[4][4] = { v: 's1:4:1' };
      const start = moveColumn(1, 3, 1, 1, 4);
      for (const drag of [edge, start]) {
        const pair = [insertDown(), [drag]];
        expect(() => transform(pair[a], pair[b], side)).toThrow(RefusedEditError);
      }
    });
  }
});

describe('a shift and a row or column edit', () => {
  // Inserting B3:C3 down shifts columns B and C from row 2 by one.
  const insertDown = () =>
    shiftCommand(new Replica({ workbook: seededWorkbook() }), commands.insertMoveDown, {
      unitId,
      subUnitId,
      range: range(2, 1, 2, 2),
    })!;
  const column = (data: any, col: number) =>
    Array.from({ length: 6 }, (_, row) => data[row]?.[col]?.v);
  const shiftedColumn = (col: number) => [
    `s1:0:${col}`,
    `s1:1:${col}`,
    undefined,
    `s1:2:${col}`,
    `s1:3:${col}`,
    `s1:4:${col}`,
  ];

  for (const side of ['left', 'right'] as const) {
    const other = side === 'left' ? 'right' : 'left';
    test(`rows inserted above the shift move it whole (${side})`, () => {
      const data = merged(insertDown(), insertRows(0, 1), side);
      expect(column(data, 1)).toEqual([undefined, ...shiftedColumn(1).slice(0, 5)]);
    });

    test(`rows inserted or removed at or past the shift's start are refused (${side})`, () => {
      for (const edit of [insertRows(2, 1), insertRows(5, 1), removeRows(4, 2)]) {
        expect(() => transform(insertDown(), [edit], side)).toThrow(RefusedEditError);
        expect(() => transform([edit], insertDown(), other)).toThrow(RefusedEditError);
      }
    });

    test(`a column inserted inside the band splits the shift around it (${side})`, () => {
      const data = merged(insertDown(), [insertCols(2, 1), cell(4, 2, { v: 'x' })], side);
      expect(column(data, 1)).toEqual(shiftedColumn(1));
      expect(column(data, 2)).toEqual([undefined, undefined, undefined, undefined, 'x', undefined]);
      expect(column(data, 3)).toEqual(shiftedColumn(2));
      expect(column(data, 4)).toEqual(['s1:0:3', 's1:1:3', 's1:2:3', 's1:3:3', 's1:4:3', 's1:5:3']);
    });

    test(`a column removed from the band narrows the shift (${side})`, () => {
      const data = merged(insertDown(), removeCols(1, 1), side);
      expect(column(data, 1)).toEqual(shiftedColumn(2));
      expect(column(data, 2)).toEqual(['s1:0:3', 's1:1:3', 's1:2:3', 's1:3:3', 's1:4:3', 's1:5:3']);
    });
  }
});

describe('concurrent moves', () => {
  // Each pair touches a cell both move: a source both take, a target one
  // takes the other's content into, a target both write.
  const overlapping: [string, Mutation, Mutation][] = [
    ['one source', move([0, 0], [0, 3], { v: 's1:0:0' }), move([0, 0], [5, 4], { v: 's1:0:0' })],
    [
      'a target the other moves out of',
      move([0, 0], [0, 1], { v: 's1:0:0' }),
      move([0, 1], [0, 2], { v: 's1:0:1' }),
    ],
    ['one target', move([0, 0], [6, 0], { v: 's1:0:0' }), move([1, 0], [6, 0], { v: 's1:1:0' })],
  ];
  for (const [name, x, y] of overlapping) {
    test(`two moves of ${name} are refused, both ways and on either side`, () => {
      for (const side of ['left', 'right'] as const) {
        for (const [a, b] of [
          [x, y],
          [y, x],
        ]) {
          expect(() => transform([a], [b], side)).toThrow(RefusedEditError);
          expect(() => transformMutation(a, b, side)).toThrow(
            expect.objectContaining({ reason: 'overlapping-moves' }),
          );
        }
      }
    });
  }

  test('a move within a sequence that meets a concurrent move refuses the sequence', () => {
    const a = [cell(4, 4, { v: 'x' }), move([0, 0], [0, 3], { v: 's1:0:0' })];
    const b = [move([2, 2], [0, 3], { v: 's1:2:2' })];
    for (const side of ['left', 'right'] as const) {
      expect(() => transform(a, b, side)).toThrow(RefusedEditError);
      expect(() => transform(b, a, side)).toThrow(RefusedEditError);
    }
  });

  test('two moves of different cells both land', () => {
    const x = move([0, 0], [0, 3], { v: 's1:0:0' });
    const y = move([1, 1], [5, 4], { v: 's1:1:1' });
    for (const side of ['left', 'right'] as const) {
      const data = merged(x, y, side);
      expect([data[0][3].v, data[5][4].v, data[0]?.[0], data[1]?.[1]]).toEqual([
        's1:0:0',
        's1:1:1',
        undefined,
        undefined,
      ]);
    }
  });
});

test('cell edits converge across two clients, as the edits meant', () => {
  convergesOver(cellEdit, { seeds: 200, intent: true });
}, 20000);

// Moves alone, where concurrent moves meet most: each refused, none merged.
test('moves alone neither copy nor lose content', () => {
  convergesOver(cellMove, { seeds: 50, intent: true });
}, 20000);

// Structural edits run Univer's own commands, which is slow, so fewer seeds.
test('cell edits converge with structure across two clients', () => {
  convergesOver(withStructure(cellEdit), { seeds: 40 });
}, 20000);

/** The seeded workbook cut to one 4×3 sheet, so nearly every edit meets another. */
function denseBook(rows = 4, cols = 3) {
  const book = seededWorkbook();
  const sheet = book.sheets.s1;
  sheet.rowCount = rows;
  sheet.columnCount = cols;
  const cells: NonNullable<typeof sheet.cellData> = {};
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const value = sheet.cellData?.[row]?.[col];
      if (value) (cells[row] ??= {})[col] = value;
    }
  }
  // Numbers under text format, which removing the format retypes on the next write.
  for (const [row, col] of [
    [1, 0],
    [2, 1],
    [3, 0],
  ]) {
    if (row < rows) (cells[row] ??= {})[col] = { v: 7, t: 2, s: { n: { pattern: '@' } } };
  }
  sheet.cellData = cells;
  book.sheetOrder = ['s1'];
  delete book.sheets.s2;
  return book;
}

// Dense conflict once made output grow without bound: each transform must stay
// within a few mutations per input, and each seed within seconds. Short runs
// meet the seeded cells before edits replace them.
test('dense cell edits converge within budget, as the edits meant', () => {
  const document = { workbook: denseBook() };
  // Commands' range inserts and deletes move most of the sheet, so their
  // long runs are few: 300 seeds of 300 edits take over a minute.
  for (const [generate, seeds, edits] of [
    [cellEdit, 1000, 40],
    [cellEdit, 300, 300],
    [commandEdit, 300, 40],
    [commandEdit, 20, 300],
  ] as const) {
    convergesOver(generate, { seeds, edits, document, budget: 5, seconds: 5, intent: true });
  }
}, 60000);

// The 4×3 sheet's runs were tuned on their own seeds; other sheets meet other
// shapes, such as the repeat compacting once dropped (3×3, seed 377).
test.each([
  [3, 3],
  [2, 3],
])(
  'dense command edits on a %i×%i sheet converge, as the edits meant',
  (rows, cols) => {
    const document = { workbook: denseBook(rows, cols) };
    convergesOver(commandEdit, {
      seeds: 400,
      edits: 40,
      document,
      budget: 5,
      seconds: 5,
      intent: true,
    });
  },
  60000,
);

// Once dense 2×3 seed 178: deleting A2:B4 with a shift left moves C2:C4 to
// A2:A4. A concurrent write to B2 goes with the cell the delete removes, and
// the move clears it there, so the delete takes it rather than a later write.
test('a delete with a shift clears a concurrent write to a cell it deletes', () => {
  const document = { workbook: denseBook() };
  const removal = shiftCommand(new Replica(document), commands.deleteMoveLeft, {
    unitId,
    subUnitId,
    range: range(1, 0, 3, 1),
  })!;
  const shift = removal.find((mutation) => mutation.id === cellIds.moveRange)!;
  const write = cell(1, 1, { v: 'x' });
  for (const side of ['left', 'right'] as const) {
    const past = transformMutation(shift, write, side);
    expect(past.map(({ id }) => id)).toEqual([cellIds.moveRange]);
    expect(past[0].params.from.value[1][1]).toBeNull();
    const data = converges(removal, write, { side, document }).workbook.sheets[subUnitId].cellData;
    expect(JSON.stringify(data)).not.toContain('"x"');
  }
});

// Once fuzz seed 863 of the dense 40-edit run, shrunk, with no move: a losing
// write to a cell whose format either side changes keeps its own write, then
// replays the winner and retypes, so one write becomes three and the next
// edit meets all of them. Not fixed; the growth cap makes it throw.
test.fails('writes past many style writes to one cell stay within budget', () => {
  const text = { n: { pattern: '@' } };
  const bold = { bl: 1, it: 1 };
  const a = [cell(3, 1, { f: null, p: richDoc('bye'), si: null }), cell(3, 1, { s: text })];
  const b = [
    cell(3, 1, { s: null }),
    cell(3, 1, { s: text }),
    cell(3, 1, { s: text }),
    set({ 3: { 1: { s: bold, v: 0 } } }, { isOverrideStyle: true }),
    set({ 3: { 1: { s: bold, v: 'b' } } }, { isOverrideStyle: true }),
  ];
  for (const [x, y, side] of [
    [a, b, 'right'],
    [b, a, 'left'],
  ] as const) {
    expect(transform(x, y, side).length).toBeLessThanOrEqual(5 * (a.length + b.length));
  }
});
