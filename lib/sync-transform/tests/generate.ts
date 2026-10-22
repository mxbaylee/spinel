import {
  Direction,
  ICommandService,
  IResourceManagerService,
  LocaleService,
  LocaleType,
  RANGE_TYPE,
  UniverInstanceType,
} from '@univerjs/core';
import type { IRange, IWorkbookData, Worksheet } from '@univerjs/core';
import { SetWorksheetActiveOperation } from '@univerjs/sheets';
import { ISheetDrawingService } from '@univerjs/sheets-drawing';
import { SetNumfmtCommand } from '@univerjs/sheets-numfmt';
import type { Mutation } from '../index.ts';
import { structureIds } from '../src/structure.ts';
import { Replica } from './harness.ts';
import type { Generate } from './simulate.ts';

export type { Generate };

/** A workbook whose cells name their original position, so misplaced rows show. */
export function seededWorkbook(): IWorkbookData {
  const sheet = (id: string, name: string) => {
    const cellData: Record<number, Record<number, { v: string }>> = {};
    const rowData: Record<number, { h: number }> = {};
    for (let row = 0; row < 12; row++) {
      rowData[row] = { h: 20 + row };
      for (let column = 0; column < 6; column++)
        cellData[row] = { ...cellData[row], [column]: { v: `${id}:${row}:${column}` } };
    }
    return { id, name, rowCount: 12, columnCount: 6, cellData, rowData };
  };
  return {
    id: 'wb',
    name: 'Book',
    appVersion: '1.1.0',
    locale: 'enUS' as never,
    styles: {},
    sheetOrder: ['s1', 's2'],
    sheets: { s1: sheet('s1', 'One'), s2: sheet('s2', 'Two') },
  };
}

export const pick = <T>(next: () => number, items: readonly T[]): T => items[next() % items.length];

/** A random existing sheet and its worksheet. */
export function randomSheet(replica: Replica, next: () => number): Worksheet {
  const workbook = replica.workbook()!;
  return workbook.getSheetBySheetId(pick(next, workbook.getSheetOrders()))!;
}

/** Params as they arrive over the wire, as JSON: a key set to undefined is gone. */
export const wire = (params: unknown) => JSON.parse(JSON.stringify(params));

/**
 * The mutations a command sends, as a collaboration client would forward them,
 * run on a copy of `replica` so the simulator can apply them to it itself.
 * Univer's undo is not a way back: it rewrites cells and refuses some moves.
 */
export function capture(
  replica: Replica,
  id: string,
  params: { unitId: string; subUnitId?: string; [key: string]: unknown },
) {
  const { unitId, subUnitId } = params;
  const resources = replica.injector
    .get(IResourceManagerService)
    .getResourcesByType(unitId, UniverInstanceType.UNIVER_SHEET);
  const copy = new Replica({ workbook: { ...replica.workbook()!.getSnapshot(), resources } });
  const commands = copy.injector.get(ICommandService);
  // The number format command needs none of its plugin's services.
  commands.registerCommand(SetNumfmtCommand);
  // Some commands look up a message, as for a refused move; any text will do.
  copy.injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
  // Merge interceptors watch only the active sheet.
  if (subUnitId) commands.syncExecuteCommand(SetWorksheetActiveOperation.id, { unitId, subUnitId });
  const sent: Mutation[] = [];
  commands.onCommandExecuted((info) => {
    if (info.id.includes('.mutation.')) sent.push({ id: info.id, params: wire(info.params) });
  });
  let ok: boolean;
  let skip = false;
  try {
    ok = commands.syncExecuteCommand(id, params);
    // Univer 1.1.0's own row and column commands can leave a drawing with a
    // zero or negative size, and its resize listener then throws on the next
    // row or column change. Such edits are skipped (README, "Known limits").
    skip = hasEmptyDrawing(copy, unitId);
  } catch (error) {
    // Commands throw on some edits they refuse, such as an out-of-range anchor.
    // The range insert and delete commands are async with nothing to await,
    // so they send every mutation before syncExecuteCommand refuses the promise.
    ok = String(error).includes('should not return a promise') && sent.length > 0;
  } finally {
    copy.univer.dispose();
  }
  if (!ok && sent.length > 0)
    throw new Error(`${id} failed after sending ${sent.length} mutations`);
  return ok && !skip && sent.length > 0 ? sent : null;
}

function hasEmptyDrawing(replica: Replica, unitId: string): boolean {
  const sheets = replica.injector.get(ISheetDrawingService).getDrawingDataForUnit(unitId);
  const positive = (size: number | undefined) => (size ?? 0) > 0;
  return Object.values(sheets).some((sheet) =>
    Object.values(sheet.data ?? {}).some(
      ({ transform }) => !positive(transform?.width) || !positive(transform?.height),
    ),
  );
}

/** Whole rows or columns `start` to `start + count - 1`, as a header selection gives. */
function lines(sheet: Worksheet, row: boolean, start: number, count: number): IRange {
  const end = start + count - 1;
  return row
    ? { startRow: start, endRow: end, startColumn: 0, endColumn: sheet.getColumnCount() - 1 }
    : { startColumn: start, endColumn: end, startRow: 0, endRow: sheet.getRowCount() - 1 };
}

/**
 * Row and column inserts, removes and moves, and sheet inserts, removes and
 * reorders, as Univer's own commands send them (see `capture`).
 */
export const structuralEdit: Generate = (replica, next) => {
  const workbook = replica.workbook()!;
  const unitId = workbook.getUnitId();
  const order = workbook.getSheetOrders();
  const kind = next() % 8;
  if (kind === 6) {
    const id = `n${next() % 1e9}`;
    const sheet = { id, name: id, rowCount: 4, columnCount: 3, cellData: { 0: { 0: { v: id } } } };
    return capture(replica, commandIds.insertSheet, {
      unitId,
      index: next() % (order.length + 1),
      sheet,
    });
  }
  if (kind === 7) {
    const index = next() % order.length;
    const subUnitId = order[index];
    // Only sheets made during the run are removed: two people removing the last
    // two sheets at once would leave a workbook Univer cannot hold.
    if (next() % 2 === 0 && subUnitId.startsWith('n')) {
      const batch = capture(replica, commandIds.removeSheet, { unitId, subUnitId });
      // RemoveSheetMutation carries no index; the sender adds the one the transform needs.
      return (
        batch?.map((m) =>
          m.id === structureIds.removeSheet ? { ...m, params: { ...m.params, index } } : m,
        ) ?? null
      );
    }
    return capture(replica, commandIds.setWorksheetOrder, {
      unitId,
      subUnitId,
      order: next() % order.length,
    });
  }
  return editLines(replica, next, kind);
};

/** Row and column inserts, removes and moves alone, as `structuralEdit` makes them. */
export const lineEdit: Generate = (replica, next) => editLines(replica, next, next() % 6);

/** Kinds 0 to 2 insert, remove and move rows; 3 to 5 columns. */
function editLines(replica: Replica, next: () => number, kind: number) {
  const sheet = randomSheet(replica, next);
  const target = { unitId: replica.workbook()!.getUnitId(), subUnitId: sheet.getSheetId() };
  const row = kind < 3;
  const length = row ? sheet.getRowCount() : sheet.getColumnCount();
  const action = kind % 3;
  if (action === 0) {
    const at = next() % (length + 1);
    // The command copies the size of its anchor: the line before `at` (DOWN or
    // RIGHT of it) or the one at `at` (UP or LEFT of it).
    const [after, before] = row
      ? [Direction.DOWN, Direction.UP]
      : [Direction.RIGHT, Direction.LEFT];
    const direction = at === length || (at > 0 && next() % 2 === 0) ? after : before;
    const range = lines(sheet, row, at, 1 + (next() % 2));
    return capture(replica, row ? commandIds.insertRow : commandIds.insertCol, {
      ...target,
      range,
      direction,
    });
  }
  // Keep at least two rows and columns so edits always have room.
  if (length <= 2) return null;
  const at = next() % length;
  const count = 1 + (next() % Math.min(2, length - at));
  if (action === 1) {
    if (length - count < 2) return null;
    const range = lines(sheet, row, at, count);
    return capture(replica, row ? commandIds.removeRow : commandIds.removeCol, {
      ...target,
      range,
    });
  }
  const to = next() % (length + 1);
  if (to >= at && to < at + count) return null;
  const fromRange = lines(sheet, row, at, count);
  const range = { ...fromRange, rangeType: row ? RANGE_TYPE.ROW : RANGE_TYPE.COLUMN };
  const toRange = lines(sheet, row, to, count);
  return capture(replica, row ? commandIds.moveRows : commandIds.moveCols, {
    ...target,
    fromRange,
    toRange,
    range,
  });
}

const commandIds = {
  insertRow: 'sheet.command.insert-row-by-range',
  insertCol: 'sheet.command.insert-col-by-range',
  removeRow: 'sheet.command.remove-row-by-range',
  removeCol: 'sheet.command.remove-col-by-range',
  moveRows: 'sheet.command.move-rows',
  moveCols: 'sheet.command.move-cols',
  insertSheet: 'sheet.command.insert-sheet',
  removeSheet: 'sheet.command.remove-sheet',
  setWorksheetOrder: 'sheet.command.set-worksheet-order',
};

/** `generate`, with one edit in three a structural one instead. */
export const withStructure =
  (generate: Generate, structure: Generate = structuralEdit): Generate =>
  (replica, next) =>
    next() % 3 === 0 ? structure(replica, next) : generate(replica, next);
