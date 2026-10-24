import { describe, expect, test } from 'vitest';
import type { Mutation } from '../index.ts';
import {
  absolute,
  Cells,
  claimError,
  claimKey,
  difference,
  effect,
  overlay,
} from '../src/state.ts';
import type { CellData } from '../src/state.ts';
import { structureIds } from '../src/structure.ts';
import { cellIds } from '../src/writes.ts';

const unitId = 'wb';
const subUnitId = 's1';
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
const write = (cellValue: Record<number, Record<number, unknown>>, extra = {}): Mutation => ({
  id: cellIds.setRangeValues,
  params: { unitId, subUnitId, cellValue, ...extra },
});
const numfmt = (pattern: string, ranges = [range(0, 0)]): Mutation => ({
  id: cellIds.setNumfmt,
  params: { unitId, subUnitId, values: { k: { ranges } }, refMap: { k: { pattern } } },
});
const removeNumfmt = (ranges = [range(0, 0)]): Mutation => ({
  id: cellIds.removeNumfmt,
  params: { unitId, subUnitId, ranges },
});
const lines = (id: string, at: number, count: number, axis: 'row' | 'column'): Mutation => ({
  id,
  params: {
    unitId,
    subUnitId,
    range: axis === 'row' ? range(at, 0, at + count - 1, 9) : range(0, at, 9, at + count - 1),
  },
});
const moveRows = (from: number, count: number, to: number): Mutation => ({
  id: structureIds.moveRows,
  params: {
    unitId,
    subUnitId,
    sourceRange: range(from, 0, from + count - 1, 9),
    targetRange: range(to, 0, to + count - 1, 9),
  },
});
const moveCols = (from: number, count: number, to: number): Mutation => ({
  id: structureIds.moveCols,
  params: {
    unitId,
    subUnitId,
    sourceRange: range(0, from, 9, from + count - 1),
    targetRange: range(0, to, 9, to + count - 1),
  },
});

/** Cells holding `{ v: 'r:c' }` at each row and column under 5, and none past. */
const grid = () =>
  Cells.of((unit, sheet, row, col) =>
    unit === unitId && sheet === subUnitId && row < 5 && col < 5 ? { v: `${row}:${col}` } : null,
  );
const column = (cells: Cells, col: number) =>
  Array.from({ length: 6 }, (_, row) => cells.get(unitId, subUnitId, row, col)?.v ?? null);
const row = (cells: Cells, at: number) =>
  Array.from({ length: 6 }, (_, col) => cells.get(unitId, subUnitId, at, col)?.v ?? null);

describe('difference', () => {
  test('claims each key that changed, and null for each one dropped', () => {
    expect(difference({ v: 1, t: 2, f: '=A1' }, { v: 1, t: 2, f: '=A2' })).toEqual({ f: '=A2' });
    expect(difference({ v: 1, t: 2, custom: { a: 1 } }, { v: 1, t: 2 })).toEqual({ custom: null });
    expect(difference({ v: 1, t: 2 }, { v: 1, t: 2 })).toEqual({});
    expect(difference(null, null)).toEqual({});
  });

  test('claims a value with its type, and a retype as the value with it', () => {
    expect(difference({ v: 1, t: 2 }, { v: 2, t: 2 })).toEqual({ v: 2, t: 2 });
    expect(difference({ v: '1', t: 2 }, { v: '1', t: 1 })).toEqual({ v: '1', t: 1 });
    expect(difference({ v: 1, t: 2 }, {})).toEqual({ v: null });
  });

  test('claims no type Univer only gave a value held untyped, but a forced one', () => {
    expect(difference({ v: 'x' }, { v: 'x', t: 1, fd: 1 })).toEqual({ fd: 1 });
    expect(difference({ v: 'x' }, { v: 'x', t: 4 })).toEqual({ v: 'x', t: 4 });
    expect(difference({ v: 7 }, { v: 7, t: 1, s: { n: { pattern: '@' } } })).toEqual({
      s: { n: { pattern: '@' } },
    });
  });

  test('claims a style key by key and a border edge by edge', () => {
    const edge = { s: 1, cl: { rgb: '#000' } };
    expect(difference({ s: { bl: 1, it: 1 } }, { s: { bl: 0, it: 1 } })).toEqual({ s: { bl: 0 } });
    expect(difference({ s: { bd: { t: edge, b: edge } } }, { s: { bd: { t: edge } } })).toEqual({
      s: { bd: { b: null } },
    });
    expect(difference({ s: { bl: 1 } }, {})).toEqual({ s: { bl: null } });
  });

  test('claims each key a deletion drops, not the whole cell', () => {
    expect(difference({ v: 'x', t: 1, s: { bl: 1 } }, null)).toEqual({ v: null, s: { bl: null } });
  });
});

describe('overlay', () => {
  test('sets what the claims name and keeps the rest', () => {
    expect(overlay({ v: 2, t: 2 }, { v: 1, t: 2, s: { bl: 1 } })).toEqual({
      v: 2,
      t: 2,
      s: { bl: 1 },
    });
    expect(overlay({ f: null }, { v: 1, t: 2, f: '=1' })).toEqual({ v: 1, t: 2 });
    expect(overlay({}, null)).toBeNull();
  });

  test('drops the type with a deleted value, and the cell once nothing is left', () => {
    expect(overlay({ v: null }, { v: 1, t: 2, s: { bl: 1 } })).toEqual({ s: { bl: 1 } });
    expect(overlay({ v: null, s: { bl: null } }, { v: 1, t: 2, s: { bl: 1 } })).toBeNull();
  });

  test('sets a style key by key and a border edge by edge', () => {
    const [top, bottom] = [{ s: 1 }, { s: 2 }];
    const cell = { s: { bl: 1, bd: { t: top } } };
    expect(overlay({ s: { it: 1, bd: { b: bottom } } }, cell)).toEqual({
      s: { bl: 1, it: 1, bd: { t: top, b: bottom } },
    });
    expect(overlay({ s: { bd: { t: null } } }, cell)).toEqual({ s: { bl: 1 } });
    expect(overlay({ s: null }, cell)).toBeNull();
  });

  test('undoes difference: overlaying what changed gives what it changed to', () => {
    const pairs: [CellData | null, CellData | null][] = [
      [
        { v: 1, t: 2, s: { bl: 1 } },
        { v: 'x', t: 1, s: { it: 1 } },
      ],
      [{ f: '=1', v: 1, t: 2 }, null],
      [null, { v: 1, t: 2, s: { bd: { t: { s: 1 } } } }],
      [
        { v: '5', t: 1, s: { n: { pattern: '@' } } },
        { v: '5', t: 1 },
      ],
    ];
    for (const [from, to] of pairs) expect(overlay(difference(from, to), from)).toEqual(to);
  });
});

describe('the number format effect', () => {
  const set = numfmt('@');
  test('sets style key n and keeps the value and its type', () => {
    expect(effect(set, 'k', { v: 5, t: 2, s: { bl: 1 } })).toEqual({
      v: 5,
      t: 2,
      s: { bl: 1, n: { pattern: '@' } },
    });
    expect(effect(set, 'k', null)).toEqual({ s: { n: { pattern: '@' } } });
  });

  test('a removal deletes only style key n, and the cell once nothing is left', () => {
    const cell = { v: 5, t: 2, s: { bl: 1, n: { pattern: '0%' } } };
    expect(effect(removeNumfmt(), null, cell)).toEqual({ v: 5, t: 2, s: { bl: 1 } });
    expect(effect(removeNumfmt(), null, { s: { n: { pattern: '0%' } } })).toBeNull();
    expect(effect(removeNumfmt(), null, null)).toBeNull();
  });

  test('a value written after the text format is typed as text, and not after its removal', () => {
    const typed = effect(write({ 0: { 0: { v: '5' } } }), { v: '5' }, effect(set, 'k', null));
    expect(typed).toEqual({ v: '5', t: 1, s: { n: { pattern: '@' } } });
    const removed = effect(removeNumfmt(), null, typed);
    expect(removed).toEqual({ v: '5', t: 1 });
    expect(effect(write({ 0: { 0: { v: '7' } } }), { v: '7' }, removed)).toEqual({ v: 7, t: 2 });
  });

  test('Cells.after applies one to each cell of its ranges', () => {
    const cells = grid().after(numfmt('0%', [range(1, 1, 2, 1)]));
    expect(cells.get(unitId, subUnitId, 1, 1)).toEqual({ v: '1:1', s: { n: { pattern: '0%' } } });
    expect(cells.get(unitId, subUnitId, 2, 1)).toEqual({ v: '2:1', s: { n: { pattern: '0%' } } });
    expect(cells.get(unitId, subUnitId, 3, 1)).toEqual({ v: '3:1' });
    const removed = cells.after(removeNumfmt([range(2, 1)]));
    expect(removed.get(unitId, subUnitId, 1, 1)).toEqual({ v: '1:1', s: { n: { pattern: '0%' } } });
    expect(removed.get(unitId, subUnitId, 2, 1)).toEqual({ v: '2:1' });
  });
});

describe('an absolute write', () => {
  test('names every cell key, null where absent', () => {
    const claims = { s: { bl: 1 } };
    expect(absolute({ v: 1, t: 2, s: { bl: 1 } }, claims).value).toEqual({
      v: 1,
      t: 2,
      f: null,
      si: null,
      p: null,
      s: { bl: 1 },
      custom: null,
      ft: null,
      fd: null,
      ref: null,
      xf: null,
      [claimKey]: claims,
    });
    expect(absolute(null, {})).toEqual({
      value: expect.objectContaining({ v: null, t: null, s: null }),
    });
  });

  test('writes ft and fd again after itself, typed as the cell is, where no formula keeps them', () => {
    const tail = (ft: CellData) => ({ ...ft, [claimKey]: ft });
    expect(absolute({ v: 1, t: 2, ft: 0 }, {}).tail).toEqual({ ...tail({ ft: 0 }), t: 2 });
    expect(absolute({ ft: 0, fd: 1 }, {}).tail).toEqual(tail({ ft: 0, fd: 1 }));
    expect(absolute({ f: '=1', ft: 0 }, {}).tail).toBeUndefined();
  });

  test('its claims pass the check only where the cell writes what they claim', () => {
    const { value } = absolute({ v: 1, t: 2, s: { bl: 1, bd: { t: { s: 1 } } } }, { v: 1, t: 2 });
    expect(claimError(value, true)).toBeUndefined();
    expect(claimError(value, false)).toBe('claims without `isOverrideStyle`');
    const claim = (claims: unknown) => claimError({ ...value, [claimKey]: claims }, true);
    expect(claim({})).toBeUndefined();
    expect(claim({ s: { bl: 1, it: null, bd: { t: { s: 1 }, b: null } } })).toBeUndefined();
    expect(claim({ v: 2 })).toBe('claims a `v` it does not write');
    expect(claim({ f: '=1' })).toBe('claims a `f` it does not write');
    expect(claim({ s: { bl: 0 } })).toBe('claims a style `bl` it does not write');
    expect(claim({ s: { bd: { t: null } } })).toBe('claims a border edge `t` it does not write');
    expect(claim({ x: 1 })).toBe('claims `x`');
    expect(claim(null)).toBe('claims no object');
    expect(claimError({ v: 1, 'sync-transform.other': 1 }, true)).toBe(
      'names a `sync-transform.` key',
    );
    expect(claimError({ v: 1 }, false)).toBeUndefined();
  });
});

describe('Cells.after', () => {
  test('a cell write merges into the cell, typing its value, and a null deletes it', () => {
    const cells = grid().after(write({ 1: { 1: { s: { bl: 1 } } }, 2: { 2: null } }));
    expect(cells.get(unitId, subUnitId, 1, 1)).toEqual({ v: '1:1', t: 1, s: { bl: 1 } });
    expect(cells.get(unitId, subUnitId, 2, 2)).toBeNull();
    expect(cells.get(unitId, subUnitId, 3, 3)).toEqual({ v: '3:3' });
    expect(cells.get(unitId, 'other', 1, 1)).toBeNull();
  });

  test('a row insert or removal moves the rows past it, and an inserted row is empty', () => {
    const inserted = grid().after(lines(structureIds.insertRow, 1, 2, 'row'));
    expect(column(inserted, 0)).toEqual(['0:0', null, null, '1:0', '2:0', '3:0']);
    const removed = grid().after(lines(structureIds.removeRow, 1, 2, 'row'));
    expect(column(removed, 0)).toEqual(['0:0', '3:0', '4:0', null, null, null]);
  });

  test('a column insert or removal moves the columns past it', () => {
    const inserted = grid().after(lines(structureIds.insertCol, 0, 1, 'column'));
    expect(row(inserted, 2)).toEqual([null, '2:0', '2:1', '2:2', '2:3', '2:4']);
    const removed = grid().after(lines(structureIds.removeCol, 3, 2, 'column'));
    expect(row(removed, 2)).toEqual(['2:0', '2:1', '2:2', null, null, null]);
  });

  test('a row or column move takes its lines to before the line at its target', () => {
    // Rows 0 and 1 to before row 4: 2, 3, 0, 1, 4.
    expect(column(grid().after(moveRows(0, 2, 4)), 0)).toEqual([
      '2:0',
      '3:0',
      '0:0',
      '1:0',
      '4:0',
      null,
    ]);
    // Row 3 to before row 1: 0, 3, 1, 2, 4.
    expect(column(grid().after(moveRows(3, 1, 1)), 0)).toEqual([
      '0:0',
      '3:0',
      '1:0',
      '2:0',
      '4:0',
      null,
    ]);
    expect(row(grid().after(moveCols(4, 1, 0)), 1)).toEqual([
      '1:4',
      '1:0',
      '1:1',
      '1:2',
      '1:3',
      null,
    ]);
  });

  test('a structure edit on another sheet leaves the cells', () => {
    const other = { ...lines(structureIds.insertRow, 0, 1, 'row') };
    other.params = { ...other.params, subUnitId: 'other' };
    expect(column(grid().after(other), 0)).toEqual(column(grid(), 0));
  });

  test('a write after a row insert lands on the cell as it moved', () => {
    const cells = grid()
      .after(lines(structureIds.insertRow, 0, 1, 'row'))
      .after(write({ 1: { 0: { s: { bl: 1 } } } }));
    expect(cells.get(unitId, subUnitId, 1, 0)).toEqual({ v: '0:0', t: 1, s: { bl: 1 } });
    expect(cells.get(unitId, subUnitId, 0, 0)).toBeNull();
  });

  test('a range move writes its source and target whole', () => {
    const move: Mutation = {
      id: cellIds.moveRange,
      params: {
        unitId,
        from: { subUnitId, value: { 0: { 0: null } } },
        to: { subUnitId, value: { 0: { 4: { v: '0:0' } } } },
      },
    };
    const cells = grid().after(move);
    expect(cells.get(unitId, subUnitId, 0, 0)).toBeNull();
    expect(cells.get(unitId, subUnitId, 0, 4)).toEqual({ v: '0:0' });
  });

  const insertSheet = (id: string, cellData: object): Mutation => ({
    id: structureIds.insertSheet,
    params: { unitId, index: 1, sheet: { id, name: id, cellData } },
  });
  const removeSheet = (id: string): Mutation => ({
    id: structureIds.removeSheet,
    params: { unitId, subUnitId: id, subUnitName: id, index: 1 },
  });

  test("a sheet insert's cells are the base of its sheet, and other sheets keep theirs", () => {
    const cells = grid().after(
      insertSheet('new', { 0: { 1: { v: 'n', s: { bl: 1 } }, 2: { v: null, s: {} } } }),
    );
    expect(cells.get(unitId, 'new', 0, 1)).toEqual({ v: 'n', s: { bl: 1 } });
    // Empty keys and styles go, as from any base, and a cell it leaves out is none.
    expect(cells.get(unitId, 'new', 0, 2)).toBeNull();
    expect(cells.get(unitId, 'new', 3, 3)).toBeNull();
    expect(cells.get(unitId, subUnitId, 0, 1)).toEqual({ v: '0:1' });
    expect(cells.get('other', 'new', 0, 1)).toBeNull();
  });

  test('a sheet removal empties its sheet, and a re-insert under its id brings its own cells', () => {
    const removed = grid().after(removeSheet(subUnitId));
    expect(removed.get(unitId, subUnitId, 0, 0)).toBeNull();
    expect(removed.get(unitId, 'other', 0, 0)).toBeNull();
    const kept = Cells.of((_, sheet, row, col) => ({ v: `${sheet} ${row}:${col}` })).after(
      removeSheet(subUnitId),
    );
    expect(kept.get(unitId, 'other', 0, 0)).toEqual({ v: 'other 0:0' });
    expect(kept.get('other', subUnitId, 0, 0)).toEqual({ v: `${subUnitId} 0:0` });
    const again = removed.after(insertSheet(subUnitId, { 1: { 1: { v: 'back' } } }));
    expect(again.get(unitId, subUnitId, 1, 1)).toEqual({ v: 'back' });
    expect(again.get(unitId, subUnitId, 0, 0)).toBeNull();
  });

  test('reads its base once per cell, and only the cells asked for', () => {
    const reads: string[] = [];
    const cells = Cells.of((_, __, row, col) => {
      reads.push(`${row}:${col}`);
      return { v: 1 };
    });
    cells.get(unitId, subUnitId, 0, 0);
    cells.get(unitId, subUnitId, 0, 0);
    expect(reads).toEqual(['0:0']);
  });

  test('without base cells, a read throws', () => {
    expect(() => Cells.of().get(unitId, subUnitId, 0, 0)).toThrow(TypeError);
    // No read, no throw.
    expect(() => Cells.of().after(write({ 0: { 0: { v: 1 } } }))).not.toThrow();
  });
});
