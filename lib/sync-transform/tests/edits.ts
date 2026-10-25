import { mergeWorksheetSnapshotWithDefault } from '@univerjs/core';
import type { Mutation } from '../index.ts';
import { structureIds } from '../src/structure.ts';

/** Row and column edits on sheet s1 of `seededWorkbook()` (12 rows, 6 columns). */
export const target = { unitId: 'wb', subUnitId: 's1' };

/** Whole rows or columns, as Univer's row and column commands address them. */
export const rows = (start: number, end = start) => ({
  startRow: start,
  endRow: end,
  startColumn: 0,
  endColumn: 5,
});
export const cols = (start: number, end = start) => ({
  startColumn: start,
  endColumn: end,
  startRow: 0,
  endRow: 11,
});

const edit = (id: string, params: object): Mutation => ({ id, params: { ...target, ...params } });

export const insertRows = (at: number, count: number) =>
  edit(structureIds.insertRow, { range: rows(at, at + count - 1) });
export const removeRows = (at: number, count: number) =>
  edit(structureIds.removeRow, { range: rows(at, at + count - 1) });
export const moveRows = (from: number, count: number, to: number) =>
  edit(structureIds.moveRows, {
    sourceRange: rows(from, from + count - 1),
    targetRange: rows(to, to + count - 1),
  });
export const insertCols = (at: number, count: number) =>
  edit(structureIds.insertCol, { range: cols(at, at + count - 1) });
export const removeCols = (at: number, count: number) =>
  edit(structureIds.removeCol, { range: cols(at, at + count - 1) });
export const moveCols = (from: number, count: number, to: number) =>
  edit(structureIds.moveCols, {
    sourceRange: cols(from, from + count - 1),
    targetRange: cols(to, to + count - 1),
  });

/** Sheet inserts, removes and reorders, as the sheet-tab commands send them. */
export const insertSheet = (id: string, index: number) => ({
  id: structureIds.insertSheet,
  params: {
    unitId: 'wb',
    index,
    sheet: mergeWorksheetSnapshotWithDefault({ id, name: id, rowCount: 4, columnCount: 3 }),
  },
});
export const removeSheet = (subUnitId: string, name: string, index: number) => ({
  id: structureIds.removeSheet,
  params: { unitId: 'wb', subUnitId, subUnitName: name, index },
});
export const moveSheet = (subUnitId: string, fromOrder: number, toOrder: number) => ({
  id: structureIds.setWorksheetOrder,
  params: { unitId: 'wb', subUnitId, fromOrder, toOrder },
});
