import { Rectangle } from '@univerjs/core';
import type { IRange, Worksheet } from '@univerjs/core';
import type { Mutation } from '../index.ts';
import { axisKeys } from '../src/family.ts';
import { mergeIds } from '../src/merges.ts';
import { propertyIds } from '../src/properties.ts';
import { settingIds } from '../src/settings.ts';
import { pick, randomSheet } from './generate.ts';
import type { Generate } from './generate.ts';

/** A run of up to three rows (or columns) spanning the sheet, as a header selection gives. */
function lines(sheet: Worksheet, next: () => number, row: boolean): IRange {
  const length = row ? sheet.getRowCount() : sheet.getColumnCount();
  const start = next() % length;
  const end = Math.min(length - 1, start + (next() % 3));
  return row
    ? { startRow: start, endRow: end, startColumn: 0, endColumn: sheet.getColumnCount() - 1 }
    : { startColumn: start, endColumn: end, startRow: 0, endRow: sheet.getRowCount() - 1 };
}

/** The parts of `range` whose rows (or columns) are hidden, or visible, as the hide and show commands send. */
function byVisibility(sheet: Worksheet, range: IRange, row: boolean, hidden: boolean): IRange[] {
  const [start, end] = axisKeys(row ? 'row' : 'column');
  const ranges: IRange[] = [];
  for (let i = range[start]; i <= range[end]; i++) {
    const visible = row ? sheet.getRowRawVisible(i) : sheet.getColVisible(i);
    if (visible === hidden) continue;
    const last = ranges.at(-1);
    if (last && last[end] === i - 1) last[end] = i;
    else ranges.push({ ...range, [start]: i, [end]: i });
  }
  return ranges;
}

const styles = [{ bl: 1 }, { it: 1 }, { cl: { rgb: '#ff0000' } }];

/** Row heights, column widths, hiding, auto height and row or column data. */
export const propertyEdit: Generate = (replica, next) => {
  const sheet = randomSheet(replica, next);
  const target = { unitId: replica.workbook()!.getUnitId(), subUnitId: sheet.getSheetId() };
  const row = next() % 2 === 0;
  const range = lines(sheet, next, row);
  const kind = next() % 6;
  if (kind === 0 && row) {
    // SetRowHeightCommand (24 is the default height, which clears `h`).
    const rowHeight = pick(next, [24, 30, 45]);
    return [
      { id: propertyIds.rowHeight, params: { ...target, ranges: [range], rowHeight } },
      {
        id: propertyIds.rowIsAutoHeight,
        params: { ...target, ranges: [range], autoHeightInfo: 0 },
      },
    ];
  }
  if (kind === 0) {
    // SetColWidthCommand, or pasted widths keyed by column (88 is the default width).
    const width = pick(next, [88, 60, 120]);
    const colWidth: number | Record<number, number> =
      next() % 2 === 0 ? width : { [range.startColumn]: width, [range.endColumn]: width + 10 };
    return [{ id: propertyIds.colWidth, params: { ...target, ranges: [range], colWidth } }];
  }
  if (kind === 1 || kind === 2) {
    // SetRowHiddenCommand / SetColHiddenCommand send visible lines; showing sends hidden ones.
    const hide = kind === 1;
    const ranges = byVisibility(sheet, range, row, !hide);
    if (ranges.length === 0) return null;
    const ids = row
      ? [propertyIds.rowHidden, propertyIds.rowVisible]
      : [propertyIds.colHidden, propertyIds.colVisible];
    return [{ id: hide ? ids[0] : ids[1], params: { ...target, ranges } }];
  }
  if (kind === 3 && row) {
    // SetWorksheetRowIsAutoHeightCommand, then the measured heights.
    const rowsAutoHeightInfo = [];
    for (let i = range.startRow; i <= range.endRow; i++)
      rowsAutoHeightInfo.push({ row: i, autoHeight: 20 + (next() % 3) * 7 });
    return [
      {
        id: propertyIds.rowIsAutoHeight,
        params: { ...target, ranges: [range], autoHeightInfo: 1 },
      },
      { id: propertyIds.rowAutoHeight, params: { ...target, rowsAutoHeightInfo } },
    ];
  }
  // SetRowDataCommand / SetColDataCommand: partial data, or null to clear a line.
  const data: Record<number, unknown> = {};
  const [start, end] = row ? [range.startRow, range.endRow] : [range.startColumn, range.endColumn];
  for (let i = start; i <= end; i++) {
    const choice = next() % 5;
    if (choice === 0) data[i] = null;
    else if (choice === 1) data[i] = { hd: next() % 2 };
    else if (choice === 2) data[i] = row ? { h: 33 } : { w: 70 };
    else data[i] = { s: pick(next, styles), ...(choice === 4 && { hd: 0 }) };
  }
  const field = row ? 'rowData' : 'columnData';
  return [
    { id: row ? propertyIds.rowData : propertyIds.colData, params: { ...target, [field]: data } },
  ];
};

/** AddWorksheetMergeCommand and RemoveWorksheetMergeCommand. */
export const mergeEdit: Generate = (replica, next) => {
  const sheet = randomSheet(replica, next);
  const target = { unitId: replica.workbook()!.getUnitId(), subUnitId: sheet.getSheetId() };
  const rows = sheet.getRowCount();
  const columns = sheet.getColumnCount();
  const startRow = next() % rows;
  const startColumn = next() % columns;
  // In the key order MergeCellController rewrites merges in after a row or column edit.
  const endRow = Math.min(rows - 1, startRow + (next() % 3));
  const range = {
    startRow,
    endRow,
    startColumn,
    endColumn: Math.min(columns - 1, startColumn + (next() % 3)),
  };
  // Both commands send the exact merges the selection touches.
  const touched = sheet.getMergeData().filter((merge) => Rectangle.intersects(merge, range));
  const remove = touched.length > 0 && {
    id: mergeIds.remove,
    params: { ...target, ranges: touched },
  };
  if (next() % 3 === 0) return remove ? [remove] : null;
  if (range.startRow === range.endRow && range.startColumn === range.endColumn) return null;
  const add = { id: mergeIds.add, params: { ...target, ranges: [range] } };
  return remove ? [remove, add] : [add];
};

/** One sheet or workbook setting, as its command sends it. */
export const settingEdit: Generate = (replica, next) => {
  const workbook = replica.workbook()!;
  const sheet = randomSheet(replica, next);
  const unitId = workbook.getUnitId();
  const target = { unitId, subUnitId: sheet.getSheetId() };
  const flag = next() % 2;
  const settings: (() => Mutation)[] = [
    () => {
      const ySplit = next() % Math.min(4, sheet.getRowCount());
      const xSplit = next() % Math.min(3, sheet.getColumnCount());
      return {
        id: settingIds.frozen,
        params: { ...target, startRow: ySplit, startColumn: xSplit, ySplit, xSplit },
      };
    },
    () => ({
      id: settingIds.rowCount,
      params: { ...target, rowCount: sheet.getRowCount() + 1 + (next() % 3) },
    }),
    () => ({
      id: settingIds.columnCount,
      params: { ...target, columnCount: sheet.getColumnCount() + 1 + (next() % 3) },
    }),
    () => ({
      id: settingIds.defaultStyle,
      params: { ...target, defaultStyle: pick(next, styles) },
    }),
    () => ({
      id: settingIds.gridlinesColor,
      params: { ...target, color: pick(next, ['#ff0000', '#00ff00']) },
    }),
    () => ({ id: settingIds.gridlines, params: { ...target, showGridlines: flag } }),
    () => ({
      id: settingIds.name,
      params: { ...target, name: `${sheet.getSheetId()}-${next() % 100}` },
    }),
    () => ({
      id: settingIds.tabColor,
      params: { ...target, color: pick(next, ['#0000ff', '#ffff00']) },
    }),
    // Concurrent hides could hide every sheet, so only sheets made during the run are hidden.
    () => ({
      id: settingIds.hidden,
      params: { ...target, hidden: target.subUnitId.startsWith('n') ? flag : 0 },
    }),
    () => ({ id: settingIds.workbookName, params: { unitId, name: `Book ${next() % 100}` } }),
  ];
  return [pick(next, settings)()];
};
