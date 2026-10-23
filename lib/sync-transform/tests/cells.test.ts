import { DrawingTypeEnum, IResourceManagerService, UniverInstanceType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { DrawingApplyType, ISheetDrawingService } from '@univerjs/sheets-drawing';
import { describe, expect, test } from 'vitest';
import { RefusedEditError, transform } from '../index.ts';
import type { Mutation, Side } from '../index.ts';
import { cellIds } from '../src/cells.ts';
import { drawingIds } from '../src/drawings.ts';
import { mergeIds } from '../src/merges.ts';
import { nameIds } from '../src/names.ts';
import { propertyIds } from '../src/properties.ts';
import { settingIds } from '../src/settings.ts';
import { structureIds } from '../src/structure.ts';
import {
  cellEdit,
  cellMove,
  commandEdit,
  commands,
  moveCommand,
  realBook,
  realEdit,
  richDoc,
  sheetCut,
  shiftCommand,
} from './generate-cells.ts';
import { capture, lineEdit, seededWorkbook, withStructure } from './generate.ts';
import { converges, refusedBothWays, Replica } from './harness.ts';
import {
  insertCols,
  insertRows,
  insertSheet,
  moveRows,
  moveSheet,
  removeCols,
  removeRows,
} from './edits.ts';
import { convergesOver, newStats, simulate } from './simulate.ts';
import type { Generate, Step } from './simulate.ts';

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
    const [kept] = transform(
      [setNumfmt('0%', [range(0, 0, 1, 1)])],
      [cell(0, 0, { s: { n: null }, v: 'x' })],
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

// A cut pasted on another sheet is transformed as one move per sheet (see cells.perSheet).
// Decision (owner, chat 2026-10-22): it meets edits as a drag does, so an edit
// of its source or target is refused (see shifts.movesMeet).
describe('a cut to another sheet', () => {
  // B2:C3 of sheet One (s1) to B6:C7 of sheet Two (s2).
  const area = (row: number) => ({ startRow: row, endRow: row + 1, startColumn: 1, endColumn: 2 });
  const cut = moveCommand(
    new Replica({ workbook: seededWorkbook() }),
    's1',
    area(1),
    's2',
    area(5),
  )!;
  const onTwo = (mutation: Mutation): Mutation => ({
    ...mutation,
    params: { ...mutation.params, subUnitId: 's2' },
  });

  test('moves with a row insert on its target sheet and leaves its source empty', () => {
    for (const side of ['left', 'right'] as const) {
      const { workbook } = converges(cut, onTwo(insertRows(0, 1)), { side });
      expect(workbook.sheets.s2.cellData[6][1]).toEqual({ v: 's1:1:1' });
      expect(workbook.sheets.s2.cellData[7][2]).toEqual({ v: 's1:2:2' });
      expect(workbook.sheets.s1.cellData[1][1]).toBeUndefined();
    }
  });

  test('moves with a row insert above its source, and its cells still land on its target', () => {
    for (const side of ['left', 'right'] as const) {
      const { workbook } = converges(cut, insertRows(0, 1), { side });
      expect(workbook.sheets.s1.cellData[1][1]).toEqual({ v: 's1:0:1' });
      expect(workbook.sheets.s1.cellData[2][1]).toBeUndefined();
      expect(workbook.sheets.s1.cellData[3][2]).toBeUndefined();
      expect(workbook.sheets.s1.cellData[4][1]).toEqual({ v: 's1:3:1' });
      expect(workbook.sheets.s2.cellData[5][1]).toEqual({ v: 's1:1:1' });
      expect(workbook.sheets.s2.cellData[6][2]).toEqual({ v: 's1:2:2' });
    }
  });

  test('a write to its source or its target is refused', () => {
    refusedBothWays(cut, cell(1, 1, { v: 'x' }));
    refusedBothWays(cut, onTwo(cell(6, 2, { v: 'x' })));
  });

  test('a number format on its target is refused', () => {
    refusedBothWays(cut, onTwo(setNumfmt('0.00', [area(5)])));
  });

  test('a write elsewhere on either sheet passes unchanged', () => {
    for (const side of ['left', 'right'] as const) {
      for (const write of [cell(0, 0, { v: 'x' }), onTwo(cell(1, 1, { v: 'x' }))]) {
        expect(transform([write], cut, side)).toEqual([write]);
        converges(cut, write, { side });
      }
    }
  });

  test('a row edit that cuts its source is refused', () => {
    refusedBothWays(cut, removeRows(2, 1));
  });

  /** RemoveSheetCommand's mutations for `sheet`, with the `index` a sender adds. */
  const removal = (sheet: string, index: number) =>
    capture(new Replica({ workbook: seededWorkbook() }), 'sheet.command.remove-sheet', {
      unitId,
      subUnitId: sheet,
    })!.map((m) =>
      m.id === structureIds.removeSheet ? { ...m, params: { ...m.params, index } } : m,
    );

  // Decision (agent, chat 2026-10-22): see cells.refuseCutsToRemoved.
  test('removing its target sheet is refused', () => {
    refusedBothWays(cut, removal('s2', 1));
  });

  test('removing its source sheet leaves the cells on its target', () => {
    for (const side of ['left', 'right'] as const) {
      const { workbook } = converges(cut, removal('s1', 0), { side });
      expect(workbook.sheets.s1).toBeUndefined();
      expect(workbook.sheets.s2.cellData[5][1]).toEqual({ v: 's1:1:1' });
      expect(workbook.sheets.s2.cellData[6][2]).toEqual({ v: 's1:2:2' });
    }
  });

  // The transform joins a cut's halves again (see cells.joinCuts), so a cut
  // the server stored, or a client rebased, is still one when transformed again.
  const moves = (mutations: Mutation[]) => mutations.filter(({ id }) => id === cellIds.moveRange);
  const [moved] = moves(cut);
  const elsewhere = cell(0, 0, { v: 'x' });

  test('past an unrelated edit it is one move to the other sheet', () => {
    for (const side of ['left', 'right'] as const) {
      expect(moves(transform(cut, [elsewhere], side))).toEqual([moved]);
    }
  });

  test('transformed once, it is still refused against removing its target sheet', () => {
    for (const side of ['left', 'right'] as const) {
      refusedBothWays(transform(cut, [elsewhere], side), removal('s2', 1));
    }
  });

  test('past a row insert on its source or its target it is one move, with that side moved', () => {
    const { fromRange, toRange, from, to } = moved.params;
    const down = (range: typeof fromRange) => ({
      ...range,
      startRow: range.startRow + 1,
      endRow: range.endRow + 1,
    });
    const rowsDown = (matrix: object) =>
      Object.fromEntries(Object.entries(matrix).map(([row, cells]) => [Number(row) + 1, cells]));
    for (const side of ['left', 'right'] as const) {
      expect(moves(transform(cut, [insertRows(0, 1)], side))).toEqual([
        {
          ...moved,
          params: {
            ...moved.params,
            fromRange: down(fromRange),
            from: { ...from, value: rowsDown(from.value) },
          },
        },
      ]);
      expect(moves(transform(cut, [onTwo(insertRows(0, 1))], side))).toEqual([
        {
          ...moved,
          params: {
            ...moved.params,
            toRange: down(toRange),
            to: { ...to, value: rowsDown(to.value) },
          },
        },
      ]);
    }
  });

  test('past removing its source sheet only its target half is left', () => {
    for (const side of ['left', 'right'] as const) {
      expect(moves(transform(cut, removal('s1', 0), side))).toEqual([
        {
          ...moved,
          params: {
            ...moved.params,
            fromRange: moved.params.toRange,
            from: { subUnitId: 's2', value: {} },
          },
        },
      ]);
    }
  });

  test('a row or column insert that cuts its target is refused', () => {
    refusedBothWays(cut, onTwo(insertRows(6, 1)));
    refusedBothWays(cut, onTwo(insertCols(2, 1)));
  });

  // Edits of other families over the cut's cells, on its source and its target.
  const drawing = (sheet: string, row: number): Mutation => {
    const at = { unitId, subUnitId: sheet };
    const image = {
      ...at,
      drawingId: 'g',
      drawingType: DrawingTypeEnum.DRAWING_IMAGE,
      imageSourceType: 'URL',
      source: 'https://example.com/g.png',
      transform: { left: 88, top: row * 20, width: 176, height: 40 },
    };
    const service = new Replica({ workbook: seededWorkbook() }).injector.get(ISheetDrawingService);
    const { redo, objects } = service.getBatchAddOp([image as never]) as any;
    const type = DrawingApplyType.INSERT;
    return { id: drawingIds.apply, params: { ...at, op: redo, objects, type } };
  };
  const others = (sheet: string, row: number): [string, string, Mutation][] => {
    const at = { unitId, subUnitId: sheet };
    const ranges = [area(row)];
    const edits: [string, Mutation][] = [
      ['a merge', { id: mergeIds.add, params: { ...at, ranges } }],
      ['a row height', { id: propertyIds.rowHeight, params: { ...at, ranges, rowHeight: 40 } }],
      ['a column width', { id: propertyIds.colWidth, params: { ...at, ranges, colWidth: 60 } }],
      ['a tab colour', { id: settingIds.tabColor, params: { ...at, color: '#0000ff' } }],
      ['a drawing', drawing(sheet, row)],
    ];
    return edits.map(([name, edit]) => [name, sheet, edit]);
  };
  const sheets: [string, string, Mutation][] = [
    ['a sheet reorder', 'the workbook', moveSheet('s2', 1, 0)],
    ['a sheet insert', 'the workbook', insertSheet('s3', 0)],
  ];
  test.each([...others('s1', 1), ...others('s2', 5), ...sheets])(
    '%s on %s passes unchanged and converges',
    (_name, _sheet, edit) => {
      for (const side of ['left', 'right'] as const) {
        expect(transform([edit], cut, side)).toEqual([edit]);
        converges(cut, edit, { side });
      }
    },
  );
});

// Decision (owner, chat 2026-10-21): a row or column edit that cuts a drag's
// source or target is refused (see shifts.movesMeet).
describe('a drag against a concurrent row edit', () => {
  // Cuts A1:A3 to D10:D12.
  const cut = moveColumn(0, 2, 0, 9, 3);
  const columnD = (edit: Mutation, side: Side) => {
    const data = merged(cut, edit, side);
    return Array.from({ length: 14 }, (_, row) => data[row]?.[3]?.v);
  };

  test('one inside or over its source or target is refused, both ways and on either side', () => {
    for (const edit of [
      insertRows(1, 1),
      insertRows(10, 1),
      removeRows(1, 1),
      removeRows(10, 1),
      removeRows(0, 1),
      moveRows(1, 1, 6),
    ]) {
      refusedBothWays(cut, edit);
    }
  });

  test('one outside both moves each whole', () => {
    const moved = ['s1:0:0', 's1:1:0', 's1:2:0'];
    for (const side of ['left', 'right'] as const) {
      // Rows inserted between the source and the target move the target only.
      expect(columnD(insertRows(5, 2), side).slice(11, 14)).toEqual(moved);
      // A row inserted just past the source, or above both, moves what is past it.
      expect(columnD(insertRows(3, 1), side).slice(10, 13)).toEqual(moved);
      expect(columnD(insertRows(0, 1), side).slice(10, 13)).toEqual(moved);
    }
  });
});

describe('rows and columns move under cell edits', () => {
  const remapped = (edit: Mutation, structural: Mutation) => {
    const [result] = transform([edit], [structural], 'left');
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
    expect(transform([cell(3, 0, { v: 'x' })], [removeRows(2, 2)], 'left')).toEqual([]);
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

// A drag and a concurrent edit of a cell it moves are refused, not merged
// (see shifts.movesMeet).
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
          expect(() => transform([a], [b], side)).toThrow(
            expect.objectContaining({ reason: 'moved-cells' }),
          );
        }
      }
    });
  }

  test('an edit of another cell passes, both ways and on either side', () => {
    const edit = cell(2, 2, { v: 'x' });
    for (const side of sides) {
      expect(transform([drag], [edit], side)).toEqual([drag]);
      expect(transform([edit], [drag], side)).toEqual([edit]);
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
        expect(() => transform([a], [b], side)).toThrow(
          expect.objectContaining({ reason: 'format-race' }),
        );
      }
    }
  });

  // Once seed 13 of the cuts to other sheets, shrunk: '0%' as a style and a
  // style clear, each typing the boolean under the format it finds.
  test('a format written as a style races as a numfmt does', () => {
    const [style, clear] = [cell(2, 1, { s: { n: { pattern: '0%' } } }), cell(2, 1, { s: null })];
    for (const side of sides) {
      for (const [a, b] of [
        [style, clear],
        [clear, style],
      ]) {
        expect(() => transform([a], [b], side)).toThrow(
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
      expect(transform([bold], [percent], side)).toEqual([bold]);
      expect(transform([percent], [bold], side)).toEqual([percent]);
      const data = merged(bold, percent, side, setup);
      expect([data[0][0].s.bl, data[2][1].s.n]).toEqual([1, { pattern: '0%' }]);
    }
  });
});

// Decision (owner, chat 2026-10-21): a shift and a concurrent edit in its
// area, its band from its start to the sheet's edge, are refused (see
// shifts.movesMeet).
describe('a shift against a concurrent edit', () => {
  // On realBook, whose content ends at row 30 of 200: deleting B2:B3 with a
  // shift up moves B4:B30 up two rows, and its area is column B from row 2 on.
  const document = { workbook: realBook() };
  const shift = (command: string, at = range(1, 1, 2, 1)) =>
    shiftCommand(new Replica(document), command, { unitId, subUnitId, range: at })!;
  const deleteUp = (at?: ReturnType<typeof range>) => shift(commands.deleteMoveUp, at);
  const moveOf = (mutations: Mutation[]) => mutations.find(({ id }) => id === cellIds.moveRange)!;
  const cells = (a: Mutation | Mutation[], b: Mutation | Mutation[], side: Side) =>
    converges(a, b, { side, document }).workbook.sheets[subUnitId].cellData;

  test('an edit in its area is refused, both ways and on either side', () => {
    for (const edit of [
      cell(5, 1, { v: 'x' }),
      cell(5, 1, { s: { bl: 1 } }),
      cell(1, 1, { v: 'x' }),
      setNumfmt('0.00', [range(5, 1)]),
    ]) {
      refusedBothWays(deleteUp(), edit);
      refusedBothWays(shift(commands.insertMoveDown), edit);
    }
  });

  test('an edit below the cells it moves is in its area, and refused', () => {
    // B100 is past B30, the last cell either move covers.
    refusedBothWays(deleteUp(), cell(99, 1, { v: 'x' }));
    refusedBothWays(shift(commands.insertMoveDown), cell(99, 1, { v: 'x' }));
  });

  for (const side of ['left', 'right'] as const) {
    test(`an edit outside its band, or above its start, passes unchanged (${side})`, () => {
      const edits = [cell(5, 2, { v: 'x' }), cell(0, 1, { v: 'y' })];
      const move = moveOf(deleteUp());
      for (const edit of edits) {
        expect(transform([edit], [move], side)).toEqual([edit]);
        expect(transform([move], [edit], side)).toEqual([move]);
      }
      const data = cells(deleteUp(), edits, side);
      expect([data[5][2].v, data[0][1].v, data[1][1].v]).toEqual(['x', 'y', 's1:3:1']);
    });

    test(`a row inserted above its area moves it whole (${side})`, () => {
      // Row 2 is the shift's start, so a row inserted there is above its area.
      for (const at of [0, 1]) {
        const data = cells(deleteUp(), insertRows(at, 1), side);
        const column = [0, 1, 2, 3].map((row) => data[row]?.[1]?.v);
        expect(column).toEqual(
          at === 0
            ? [undefined, 's1:0:1', 's1:3:1', 's1:4:1']
            : ['s1:0:1', undefined, 's1:3:1', 's1:4:1'],
        );
      }
    });

    test(`a column edit outside its band moves it whole (${side})`, () => {
      const data = cells(deleteUp(), insertCols(0, 1), side);
      expect([data[1][2].v, data[1][1].v]).toEqual(['s1:3:1', 's1:1:0']);
      expect(cells(deleteUp(), removeCols(4, 1), side)[1][1].v).toBe('s1:3:1');
    });
  }

  test('a row edit inside its area is refused, both ways and on either side', () => {
    // Row 51 is past the content the move covers, but in its area.
    for (const edit of [
      insertRows(2, 1),
      insertRows(50, 1),
      removeRows(5, 2),
      removeRows(0, 2),
      moveRows(40, 1, 0),
    ]) {
      refusedBothWays(deleteUp(), edit);
    }
  });

  test('a column edit across its band is refused, both ways and on either side', () => {
    // Deleting B2:C3 up: its band is columns B and C.
    for (const edit of [insertCols(2, 1), removeCols(1, 1), removeCols(2, 2)]) {
      refusedBothWays(deleteUp(range(1, 1, 2, 2)), edit);
    }
  });

  test("a shift whose area meets the other shift's is refused, both ways and on either side", () => {
    // One band; bands that partly overlap; shifts along different axes; and
    // bands that miss, where an insert's command also inserts rows below the
    // content (row 31 of realBook), which cuts the other's area.
    for (const [x, y] of [
      [shift(commands.insertMoveDown, range(2, 1)), deleteUp()],
      [deleteUp(range(1, 1, 2, 2)), shift(commands.insertMoveDown, range(2, 2, 2, 3))],
      [shift(commands.insertMoveDown, range(1, 1)), shift(commands.insertMoveRight, range(4, 0))],
      [shift(commands.insertMoveDown, range(2, 1)), deleteUp(range(1, 3))],
    ]) {
      refusedBothWays(x, y);
    }
  });

  for (const side of ['left', 'right'] as const) {
    test(`shifts whose areas miss both land (${side})`, () => {
      // Disjoint bands; and B6 down against D3 right, whose areas miss.
      const disjoint = cells(deleteUp(), deleteUp(range(1, 3)), side);
      expect([disjoint[1][1].v, disjoint[1][3].v]).toEqual(['s1:3:1', 's1:2:3']);
      const down = shift(commands.insertMoveDown, range(5, 1));
      const data = cells(down, shift(commands.insertMoveRight, range(2, 3)), side);
      expect([data[6][1].v, data[2][4].v]).toEqual(['s1:5:1', 's1:2:3']);
    });
  }

  test('a drag with a cell in its area is refused, both ways and on either side', () => {
    // Within the cells it moves, into them, out of them, and below them.
    for (const drag of [
      move([5, 1], [8, 1], { v: 's1:5:1' }),
      move([0, 0], [7, 1], { v: 's1:0:0' }),
      move([9, 1], [1, 4], { v: 's1:9:1' }),
      move([0, 0], [99, 1], { v: 's1:0:0' }),
    ]) {
      refusedBothWays(deleteUp(), drag);
    }
  });

  for (const side of ['left', 'right'] as const) {
    test(`a drag outside its area passes unchanged (${side})`, () => {
      const drag = move([0, 1], [0, 4], { v: 's1:0:1' });
      expect(transform([drag], [moveOf(deleteUp())], side)).toEqual([drag]);
      const data = cells(deleteUp(), drag, side);
      expect([data[0][4].v, data[0]?.[1], data[1][1].v]).toEqual(['s1:0:1', undefined, 's1:3:1']);
    });
  }

  // The README's accepted limit (Known limits): the command names only cells
  // up to the content, which ends at column J, so a write to K5 is merged.
  test('a write beyond the content stays put while the shift moves the content', () => {
    for (const side of ['left', 'right'] as const) {
      const data = cells(
        shift(commands.insertMoveDown, range(1, 9, 1, 10)),
        cell(4, 10, { v: 'x' }),
        side,
      );
      expect([data[4][10].v, data[5][9].v, data[4]?.[9]?.v]).toEqual(['x', 's1:4:9', 's1:3:9']);
    }
  });

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

  test('a shift mark on a move with no sources is rejected', () => {
    const empty = deleteUp().map((mutation) =>
      mutation.params.shift
        ? { ...mutation, params: { ...mutation.params, from: { subUnitId, value: {} } } }
        : mutation,
    );
    expect(() => transform(empty, [], 'left')).toThrow(TypeError);
  });
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
          expect(() => transform([a], [b], side)).toThrow(
            expect.objectContaining({ reason: 'moved-cells' }),
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

// The seeded runs below are bounded by their seeds and mutations, not by time, so
// they turn vitest's clock off (a timeout of 0): a slow machine cannot fail
// them, and CI's job limit still stops a run that never ends.
const unclocked = 0;

// The intent checks make this the slowest run but one, about 25 s on its own
// (measured 2026-10-22).
test(
  'cell edits converge across two clients, as the edits meant',
  () => {
    convergesOver(cellEdit, { seeds: 200, intent: true });
  },
  unclocked,
);

// Moves alone, where concurrent moves meet most: each refused, none merged.
test(
  'moves alone neither copy nor lose content',
  () => {
    convergesOver(cellMove, { seeds: 50, intent: true });
  },
  unclocked,
);

// Structural edits run Univer's own commands, which is slow, so fewer seeds.
test(
  'cell edits converge with structure across two clients',
  () => {
    convergesOver(withStructure(cellEdit), { seeds: 40 });
  },
  unclocked,
);

// Cuts to other sheets among cell edits, where intent follows the cut's cells.
test(
  'cuts to other sheets converge with cell and structural edits, as the edits meant',
  () => {
    const cutOrEdit: Generate = (replica, next) =>
      next() % 3 === 0 ? sheetCut(replica, next) : cellEdit(replica, next);
    convergesOver(cutOrEdit, { seeds: 60, intent: true });
    convergesOver(withStructure(cutOrEdit), { seeds: 20 });
  },
  unclocked,
);

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
// within a few mutations per input. That, the seeds and the mutations per seed
// bound each run, with no clock, so a slow machine cannot fail it. Short runs
// meet the seeded cells before edits replace them.
test(
  'dense cell edits converge within budget, as the edits meant',
  () => {
    const document = { workbook: denseBook() };
    // Commands' range inserts and deletes move most of the sheet, so their
    // long runs are few: 300 seeds of 300 mutations take over a minute. The four
    // runs take about a minute together.
    for (const [generate, seeds, mutations] of [
      [cellEdit, 1000, 40],
      [cellEdit, 300, 300],
      [commandEdit, 300, 40],
      [commandEdit, 20, 300],
    ] as const) {
      convergesOver(generate, { seeds, mutations, document, budget: 5, intent: true });
    }
  },
  unclocked,
);

// The 4×3 sheet's runs were tuned on their own seeds; other sheets meet other
// shapes, such as those that once failed on 3×3 (seed 377), 5×4 (seed 162)
// and 2×5 (seeds 314 and 355).
// Seeds per sheet keep the file's run under three minutes (165 s, 2026-10-22).
test.each([
  [3, 3, 400],
  [2, 3, 250],
  [5, 4, 200],
  [2, 5, 400],
])(
  'dense command edits on a %i×%i sheet converge, as the edits meant',
  (rows, cols, seeds) => {
    const document = { workbook: denseBook(rows, cols) };
    convergesOver(commandEdit, {
      seeds,
      mutations: 40,
      document,
      budget: 5,
      intent: true,
    });
  },
  unclocked,
);

// Shifts and drags meet row and column edits, which move or cut their areas.
// Sheet edits are left out: the intent check does not follow a removed sheet.
test.each([
  ['realEdit on a real sheet', realEdit, () => realBook()],
  ['commandEdit on a 6×5 sheet', commandEdit, () => denseBook(6, 5)],
])(
  '%s with row and column edits converges, as the edits meant',
  (_name, generate, workbook) => {
    const document = { workbook: workbook() };
    convergesOver(withStructure(generate, lineEdit), {
      seeds: 120,
      mutations: 40,
      document,
      intent: true,
    });
  },
  unclocked,
);

// Review 6's counterexample: the incoming write to B6 cannot pass the drag
// of B6 still in the client's buffer, so the client resyncs. The write to A1
// it already sent can, and the server, which pairs it only with the incoming
// write, accepts it.
test('a client that resyncs still has the batch it sent accepted', () => {
  const script: Step[] = [
    { client: 0, edit: [cell(0, 0, { v: 'w#1' })] },
    { client: 0, take: 'send' },
    { client: 0, edit: [move([5, 1], [6, 1], { v: 's1:5:1' })] },
    { client: 1, edit: [cell(5, 1, { v: 'w#2' })] },
    { client: 1, take: 'send' },
    { client: 1, take: 'server' },
    { client: 0, take: 'client' },
  ];
  const document = { workbook: seededWorkbook() };
  const run = simulate({
    seed: 1,
    document,
    mutations: 0,
    generate: () => null,
    intent: true,
    script,
  });
  expect(run.stats).toMatchObject({ batches: 2, accepted: 2, refused: 0, resynced: 1 });
  // Only the drag, which was never sent, is lost.
  expect(run.stats.discarded).toBe(1);
  const expected = run.server.snapshot() as any;
  for (const client of run.clients) expect(client.snapshot()).toEqual(expected);
  const data = expected.workbook.sheets[subUnitId].cellData;
  expect([data[0][0].v, data[5][1].v, data[6][1].v]).toEqual(['w#1', 'w#2', 's1:6:1']);
  for (const replica of [run.server, ...run.clients]) replica.univer.dispose();
});

/** `realBook()` with one defined name, over A3:B5 of its content, held as Univer saves it. */
function namedBook(): IWorkbookData {
  const replica = new Replica({ workbook: realBook() });
  const budget = { unitId, id: 'N', name: 'budget', formulaOrRefString: 'One!$A$3:$B$5' };
  replica.apply([{ id: nameIds.set, params: budget }]);
  const resources = replica.injector
    .get(IResourceManagerService)
    .getResourcesByType(unitId, UniverInstanceType.UNIVER_SHEET);
  const workbook = { ...replica.workbook()!.getSnapshot(), resources };
  replica.univer.dispose();
  return workbook;
}

/**
 * `namedBook()` with formulas Univer rewrites when a command moves the cells
 * they read: beside One's content a column sum, a product and a sum of the
 * name, and on a second 200×26 sheet, Two, two references to One's content.
 */
function formulaBook(): IWorkbookData {
  const book = namedBook();
  Object.assign(book.sheets.s1.cellData![0], { 10: { f: '=SUM(A1:A30)' } });
  Object.assign(book.sheets.s1.cellData![1], { 10: { f: '=B2*2' } });
  Object.assign(book.sheets.s1.cellData![2], { 10: { f: '=SUM(budget)' } });
  const cellData = { 0: { 0: { f: '=One!B10' }, 1: { f: '=SUM(One!C1:C30)' } } };
  book.sheets.s2 = { id: 's2', name: 'Two', rowCount: 200, columnCount: 26, cellData };
  book.sheetOrder = ['s1', 's2'];
  return book;
}

// The README's refusal rates, 40 mutations a seed: realEdit on realBook, with
// and without a defined name, and commandEdit on the 4×3 sheet, on realBook
// and on a book with formulas. REFUSAL_SEEDS=300 reproduces them and prints the counts (see
// simulate's `stats`); the default is quick.
const refusalSeeds = Number(process.env.REFUSAL_SEEDS ?? 10);
test(
  'refusals on a real sheet and a dense one are counted as the README counts them',
  () => {
    const seeds = refusalSeeds;
    for (const [name, generate, workbook] of [
      ['realEdit, 200×26', realEdit, realBook()],
      ['realEdit, 200×26, one name', realEdit, namedBook()],
      ['commandEdit, 4×3', commandEdit, denseBook()],
      ['commandEdit, 200×26', commandEdit, realBook()],
      ['commandEdit, 200×26, formulas and one name', commandEdit, formulaBook()],
    ] as const) {
      const stats = newStats();
      convergesOver(generate, {
        seeds,
        mutations: 40,
        document: { workbook },
        intent: true,
        stats,
      });
      if (process.env.REFUSAL_SEEDS) process.stdout.write(`${name}: ${JSON.stringify(stats)}\n`);
      expect(stats.accepted + stats.refused).toBe(stats.batches);
      expect(stats.discarded).toBeLessThanOrEqual(stats.mutations);
    }
  },
  unclocked,
);

// Once fuzz seed 863 of the dense 40-edit run, shrunk, with no move, and b's
// writes given values so that none races a's format: a losing write to a cell
// whose format either side changes keeps its own write, then replays the
// winner and retypes, so one write becomes three and the next edit meets all
// of them. Not fixed; the growth cap refuses it, either way round.
test('writes past many style writes to one cell are refused as growth', () => {
  const text = { n: { pattern: '@' } };
  const bold = { bl: 1, it: 1 };
  const a = [cell(3, 1, { f: null, p: richDoc('bye'), si: null }), cell(3, 1, { s: text })];
  const b = [
    cell(3, 1, { s: null, v: 1 }),
    cell(3, 1, { s: text, v: 2 }),
    cell(3, 1, { s: text, v: 3 }),
    set({ 3: { 1: { s: bold, v: 0 } } }, { isOverrideStyle: true }),
    set({ 3: { 1: { s: bold, v: 'b' } } }, { isOverrideStyle: true }),
  ];
  for (const [x, y, side] of [
    [a, b, 'right'],
    [b, a, 'left'],
  ] as const) {
    expect(() => transform(x, y, side)).toThrow(RefusedEditError);
    expect(() => transform(x, y, side)).toThrow(expect.objectContaining({ reason: 'growth' }));
  }
});
