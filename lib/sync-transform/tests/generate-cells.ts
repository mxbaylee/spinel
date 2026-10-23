import { Tools } from '@univerjs/core';
import type { IRange, IWorkbookData, Worksheet } from '@univerjs/core';
import { checkCellValueType, getMoveRangeCommandMutations } from '@univerjs/sheets';
import type { Mutation } from '../index.ts';
import { cellIds } from '../src/cells.ts';
import { structureIds } from '../src/structure.ts';
import { capture, pick, randomSheet, seededWorkbook, wire } from './generate.ts';
import type { Generate } from './generate.ts';
import type { Replica } from './harness.ts';

let written = 0;
/**
 * `text` with a token no other write has, `w#12` for content and `c#3` for a
 * colour, so the intent checks can tell content copied from content moved
 * (see simulate).
 */
const token = (text: string, kind: 'w' | 'c' = 'w') => `${text}${kind}#${++written}`;

/** A value to write: text gets a token; numbers and their text stay as they are, for retyping. */
const value = (next: () => number) => {
  const picked = pick(next, ['a', 'b', 'TRUE', '7', 1, 2.5, 0]);
  return picked === 'a' || picked === 'b' ? token(picked) : picked;
};
const patterns = ['@', '0.00', '#,##0', 'yyyy-mm-dd', '0%'];
const styles = [
  () => ({ bl: 1 }),
  () => ({ bl: 0 }),
  () => ({ it: 1 }),
  () => ({ bl: null }),
  (next: () => number) => ({ cl: { rgb: pick(next, ['#ff0000', '#00ff00', '#0000ff']) } }),
  (next: () => number) => ({ n: { pattern: pick(next, patterns) } }),
  (next: () => number) => ({ bl: 1, cl: { rgb: pick(next, ['#111111', '#222222']) } }),
];
/**
 * Off for all of a command edit: Univer's inserts copy a neighbour's style
 * into the inserted cells, so a colour there can rightly be in two cells, and
 * an editor commit in a command edit would token that copied colour afresh.
 */
let tokenColours = true;
/** `style` for one cell, its colour tokened afresh. */
const colored = (style: Record<string, any>) =>
  tokenColours && style.cl
    ? { ...style, cl: { rgb: token(style.cl.rgb.replace(/c#\d+$/, ''), 'c') } }
    : style;
/** An editor input: text, or a formula whose text holds the token. */
const input = (picked: string) =>
  picked.startsWith('=') ? `${picked}&"${token('')}"` : token(picked);

function randomRange(sheet: Worksheet, next: () => number): IRange {
  const rows = sheet.getRowCount();
  const columns = sheet.getColumnCount();
  const startRow = next() % rows;
  const startColumn = next() % columns;
  return {
    startRow,
    startColumn,
    endRow: Math.min(rows - 1, startRow + (next() % 3)),
    endColumn: Math.min(columns - 1, startColumn + (next() % 3)),
  };
}

function eachCell(range: IRange, f: (row: number, col: number) => void) {
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startColumn; col <= range.endColumn; col++) f(row, col);
  }
}

function fill(range: IRange, value: () => unknown) {
  const matrix: Record<number, Record<number, unknown>> = {};
  eachCell(range, (row, col) => ((matrix[row] ??= {})[col] = value()));
  return matrix;
}

/** A cell's rich text, styled in part so getCellDataByInput keeps it as rich text. */
export const richDoc = (text: string) => ({
  id: 'cell',
  documentStyle: {},
  body: {
    dataStream: `${text}\r\n`,
    textRuns: [{ st: 0, ed: 1, ts: { it: 1 } }],
    paragraphs: [{ startIndex: text.length }],
    sectionBreaks: [{ startIndex: text.length + 1 }],
  },
});

/**
 * The cell the editor commits for rich text or a formula, as
 * getCellDataByInput builds it: the existing cell, so its style too, with the
 * input's keys over it and `t` cleared. A text format stores the input as
 * text. The style is inline, as a sender must send it, and a formula the cell
 * already holds commits nothing.
 */
function editorCommit(replica: Replica, sheet: Worksheet, row: number, col: number, input: string) {
  const cell: Record<string, any> = { ...Tools.deepClone(sheet.getCellRaw(row, col) ?? {}) };
  if (typeof cell.s === 'string') cell.s = replica.workbook()!.getStyles().get(cell.s);
  if (cell.s == null) delete cell.s;
  // The commit writes the colour again, so as a new write it gets a new token.
  else cell.s = colored(cell.s);
  delete cell.t;
  const formula = input.startsWith('=');
  const previousFormula = cell.f;
  if (cell.s?.n?.pattern === '@') {
    Object.assign(cell, { v: input, f: null, si: null, p: formula ? null : richDoc(input), t: 1 });
  } else if (formula) {
    if (cell.f === input) return null;
    Object.assign(cell, { f: input, si: null, v: null, p: null });
  } else {
    Object.assign(cell, { p: richDoc(input), v: null, f: null, si: null });
  }
  if (cell.f !== previousFormula && (cell.ft !== undefined || cell.fd !== undefined)) {
    Object.assign(cell, { ft: null, fd: null });
  }
  return cell;
}

/** As getMoveRangeUndoRedoMutations builds it: sources cleared, then copied with inline styles. */
function moveRange(
  replica: Replica,
  sheet: Worksheet,
  from: IRange,
  next: () => number,
  toSheet = sheet,
): Mutation {
  const rows = from.endRow - from.startRow;
  const columns = from.endColumn - from.startColumn;
  const startRow = next() % (toSheet.getRowCount() - rows);
  const startColumn = next() % (toSheet.getColumnCount() - columns);
  const to = { startRow, startColumn, endRow: startRow + rows, endColumn: startColumn + columns };
  const styleSheet = replica.workbook()!.getStyles();
  const toValue: Record<number, Record<number, unknown>> = {};
  eachCell(from, (row, col) => {
    const cell = Tools.deepClone(sheet.getCellMatrix().getValue(row, col)) ?? null;
    if (cell?.s) cell.s = styleSheet.get(cell.s);
    (toValue[row - from.startRow + to.startRow] ??= {})[col - from.startColumn + to.startColumn] =
      cell;
  });
  const subUnitId = sheet.getSheetId();
  return {
    id: cellIds.moveRange,
    params: {
      unitId: replica.workbook()!.getUnitId(),
      fromRange: from,
      toRange: to,
      from: { subUnitId, value: fill(from, () => null) },
      to: { subUnitId: toSheet.getSheetId(), value: toValue },
    },
  };
}

/** A same-sheet range move alone, for checking moves keep the content they move. */
export const cellMove: Generate = (replica, next) => {
  const sheet = randomSheet(replica, next);
  return [moveRange(replica, sheet, randomRange(sheet, next), next)];
};

/**
 * Cell edits shaped as Univer's commands emit them: the editor's full content
 * write, rich text and formulas from the editor, clear contents, clear all, a
 * style toggle, clear formats, a pasted whole style, number formats and
 * same-sheet range moves.
 */
export const cellEdit: Generate = (replica, next) => {
  const sheet = randomSheet(replica, next);
  const unitId = replica.workbook()!.getUnitId();
  const subUnitId = sheet.getSheetId();
  const range = randomRange(sheet, next);
  const set = (cellValue: unknown, extra = {}): Mutation[] => [
    { id: cellIds.setRangeValues, params: { unitId, subUnitId, cellValue, ...extra } },
  ];
  const kind = next() % 11;
  if (kind >= 9) {
    const typed = input(kind === 9 ? pick(next, ['bye', 'hi there']) : pick(next, ['=1+2', '=A1']));
    const commit = editorCommit(replica, sheet, range.startRow, range.startColumn, typed);
    return commit ? set({ [range.startRow]: { [range.startColumn]: commit } }) : null;
  }
  if (kind === 0) {
    return set(fill(range, () => ({ v: value(next), f: null, si: null, p: null })));
  }
  if (kind === 1) {
    return set(fill(range, () => ({ v: null, p: null, f: null, si: null, custom: null })));
  }
  if (kind === 2) return set(fill(range, () => null));
  if (kind === 3) {
    const s = pick(next, styles)(next);
    return set(fill(range, () => ({ s: colored(s) })));
  }
  if (kind === 4) return set(fill(range, () => ({ s: null })));
  if (kind === 5) {
    const s = { ...pick(next, styles)(next), it: 1 };
    return set(
      fill(range, () => ({ s: colored(s), v: value(next) })),
      { isOverrideStyle: true },
    );
  }
  if (kind === 6) {
    const params = {
      unitId,
      subUnitId,
      values: { k1: { ranges: [range] } },
      refMap: { k1: { pattern: pick(next, patterns) } },
    };
    return [{ id: cellIds.setNumfmt, params }];
  }
  if (kind === 7) {
    // As SetNumfmtCommand's removal retypes each existing cell, `t: 4` for
    // one with no value.
    const retype: Record<number, Record<number, unknown>> = {};
    eachCell(range, (row, col) => {
      const cell = sheet.getCellRaw(row, col);
      const t = cell && checkCellValueType(cell.v);
      if (cell && t !== cell.t) (retype[row] ??= {})[col] = { t };
    });
    return [
      { id: cellIds.removeNumfmt, params: { unitId, subUnitId, ranges: [range] } },
      ...set(retype),
    ];
  }
  return [moveRange(replica, sheet, range, next)];
};

export const commands = {
  setRangeValues: 'sheet.command.set-range-values',
  setStyle: 'sheet.command.set-style',
  setNumfmt: 'sheet.command.numfmt.set.numfmt',
  insertMoveDown: 'sheet.command.insert-range-move-down',
  insertMoveRight: 'sheet.command.insert-range-move-right',
  deleteMoveUp: 'sheet.command.delete-range-move-up',
  deleteMoveLeft: 'sheet.command.delete-range-move-left',
};

/**
 * A shift command's mutations, captured and marked as SPN-058's client marks
 * them: its MoveRange gets `shift`, the axis the cells shift along, insert or
 * remove, and the range's start and size on that axis. Univer sends an empty
 * MoveRange when the range spans the sheet and it edits whole lines instead;
 * that one moves nothing and is left unmarked.
 */
export function shiftCommand(
  replica: Replica,
  command: string,
  params: { unitId: string; subUnitId: string; range: IRange },
): Mutation[] | null {
  const axis =
    command === commands.insertMoveDown || command === commands.deleteMoveUp ? 'row' : 'column';
  const kind =
    command === commands.insertMoveDown || command === commands.insertMoveRight
      ? 'insert'
      : 'remove';
  const { range } = params;
  const [at, end] =
    axis === 'row' ? [range.startRow, range.endRow] : [range.startColumn, range.endColumn];
  const shift = { axis, kind, at, count: end - at + 1 };
  return (
    capture(replica, command, params)?.map((mutation) =>
      mutation.id === cellIds.moveRange && Object.keys(mutation.params.from.value).length > 0
        ? { ...mutation, params: { ...mutation.params, shift } }
        : mutation,
    ) ?? null
  );
}

/**
 * Cell edits as Univer's own commands send them (see `capture`): an editor
 * commit of a value, rich text or a formula, a style toggle, setting and
 * removing a number format, a range move, and inserting or deleting a range
 * with the cells after it shifting, which also inserts lines at the end.
 * Clear contents, clear all, clear formats and a pasted whole style act on
 * the selection or the clipboard, so those stay as `cellEdit` builds them.
 */
export const commandEdit: Generate = (replica, next) => {
  tokenColours = false;
  try {
    return command(replica, next);
  } finally {
    tokenColours = true;
  }
};

const command: Generate = (replica, next) => {
  const sheet = randomSheet(replica, next);
  const target = { unitId: replica.workbook()!.getUnitId(), subUnitId: sheet.getSheetId() };
  const range = randomRange(sheet, next);
  const { startRow: row, startColumn: col } = range;
  const one = { startRow: row, startColumn: col, endRow: row, endColumn: col };
  const kind = next() % 12;
  if (kind === 0) {
    const cell = { v: value(next), f: null, si: null, p: null };
    return capture(replica, commands.setRangeValues, { ...target, range: one, value: cell });
  }
  if (kind === 1) {
    const typed = input(pick(next, ['bye', 'hi there', '=1+2', '=A1']));
    const cell = editorCommit(replica, sheet, row, col, typed);
    return (
      cell && capture(replica, commands.setRangeValues, { ...target, range: one, value: cell })
    );
  }
  if (kind === 2) {
    const [type, value] = pick(next, [
      ['bl', 1],
      ['bl', 0],
      ['it', 1],
      ['cl', { rgb: '#ff0000' }],
    ] as const);
    return capture(replica, commands.setStyle, { ...target, range, style: { type, value } });
  }
  if (kind === 3 || kind === 4) {
    const pattern = kind === 3 ? pick(next, patterns) : undefined;
    const cells: { row: number; col: number; pattern?: string }[] = [];
    eachCell(range, (row, col) => cells.push({ row, col, pattern }));
    return capture(replica, commands.setNumfmt, { ...target, values: cells });
  }
  if (kind === 5) return randomMove(replica, sheet, range, sheet, next);
  // Inserting adds lines past the used range where the band's content would
  // pass it. A sheet of 8 rows or 6 columns or more takes only an insert its
  // used range absorbs, so a small sheet stays small and a large one shifts.
  if (kind === 6 || kind === 7) {
    const down = kind === 6;
    const small = down ? sheet.getRowCount() < 8 : sheet.getColumnCount() < 6;
    const shift = down ? commands.insertMoveDown : commands.insertMoveRight;
    const sent = shiftCommand(replica, shift, { ...target, range });
    const adds = down ? structureIds.insertRow : structureIds.insertCol;
    if (small || !sent?.some(({ id }) => id === adds)) return sent;
  }
  if (kind === 8 || kind === 9) {
    return shiftCommand(replica, kind === 8 ? commands.deleteMoveUp : commands.deleteMoveLeft, {
      ...target,
      range,
    });
  }
  return cellEdit(replica, next);
};

/** A range move as MoveRangeCommand sends it, to `toRange` on sheet `to`. */
export function moveCommand(
  replica: Replica,
  from: string,
  fromRange: IRange,
  to: string,
  toRange: IRange,
): Mutation[] | null {
  const unitId = replica.workbook()!.getUnitId();
  const params = {
    unitId,
    subUnitId: from,
    fromSubUnitId: from,
    toSubUnitId: to,
    fromRange,
    toRange,
  };
  // The command awaits before it sends, so its mutations are built as it builds them.
  const sent = replica.injector.invoke((accessor) =>
    getMoveRangeCommandMutations(accessor, params, { includeSelection: false }),
  );
  const redos = sent?.redos.filter(({ id }) => id.includes('.mutation.'));
  return redos?.length ? redos.map(({ id, params }) => ({ id, params: wire(params) })) : null;
}

/** `range` moved to a random place on `toSheet`, as MoveRangeCommand sends it. */
function randomMove(
  replica: Replica,
  sheet: Worksheet,
  range: IRange,
  toSheet: Worksheet,
  next: () => number,
): Mutation[] | null {
  const fits =
    range.endRow - range.startRow < toSheet.getRowCount() &&
    range.endColumn - range.startColumn < toSheet.getColumnCount();
  if (!fits) return null;
  const { toRange } = moveRange(replica, sheet, range, next, toSheet).params;
  return moveCommand(replica, sheet.getSheetId(), range, toSheet.getSheetId(), toRange);
}

/** Cells cut from one sheet and pasted on another, as MoveRangeCommand sends them. */
export const sheetCut: Generate = (replica, next) => {
  const workbook = replica.workbook()!;
  const sheet = randomSheet(replica, next);
  const others = workbook.getSheetOrders().filter((id) => id !== sheet.getSheetId());
  if (others.length === 0) return null;
  const toSheet = workbook.getSheetBySheetId(pick(next, others))!;
  return randomMove(replica, sheet, randomRange(sheet, next), toSheet, next);
};

/** A 200×26 sheet with content in its first 30 rows and 10 columns, for `realEdit`. */
export function realBook(): IWorkbookData {
  const book = seededWorkbook();
  const cellData: Record<number, Record<number, { v: string }>> = {};
  for (let row = 0; row < 30; row++)
    for (let col = 0; col < 10; col++) (cellData[row] ??= {})[col] = { v: `s1:${row}:${col}` };
  const s1 = { id: 's1', name: 'One', rowCount: 200, columnCount: 26, cellData };
  return { ...book, sheets: { s1 }, sheetOrder: ['s1'] };
}

/**
 * Edits aimed at `realBook`'s content, as people make them: 40% values, 10%
 * bold, 10% drags and 40% inserts and deletes with a shift. The README's
 * realistic refusal rate is measured with it.
 */
export const realEdit: Generate = (replica, next) => {
  const sheet = replica.workbook()!.getSheets()[0];
  const target = { unitId: replica.workbook()!.getUnitId(), subUnitId: sheet.getSheetId() };
  const [startRow, startColumn] = [next() % 32, next() % 11];
  const range = {
    startRow,
    startColumn,
    endRow: startRow + (next() % 3),
    endColumn: startColumn + (next() % 3),
  };
  const one = { ...range, endRow: startRow, endColumn: startColumn };
  const kind = next() % 10;
  if (kind <= 3) {
    const value = { v: pick(next, ['a', 'b', 1, 2.5]), f: null, si: null, p: null };
    return capture(replica, commands.setRangeValues, { ...target, range: one, value });
  }
  if (kind === 4) {
    const style = { type: 'bl', value: 1 };
    return capture(replica, commands.setStyle, { ...target, range, style });
  }
  if (kind === 5) {
    const [dr, dc] = [(next() % 7) - 3, (next() % 7) - 3];
    const [row, col] = [Math.max(0, startRow + dr), Math.max(0, startColumn + dc)];
    const toRange = {
      startRow: row,
      startColumn: col,
      endRow: row + range.endRow - startRow,
      endColumn: col + range.endColumn - startColumn,
    };
    const params = { ...target, fromSubUnitId: target.subUnitId, fromRange: range, toRange };
    const sent = replica.injector.invoke((accessor) =>
      getMoveRangeCommandMutations(accessor, params, { includeSelection: false }),
    );
    const redos = sent?.redos.filter(({ id }) => id.includes('.mutation.'));
    return redos?.length ? redos.map(({ id, params }) => ({ id, params: wire(params) })) : null;
  }
  const shifts = [
    commands.insertMoveDown,
    commands.insertMoveRight,
    commands.deleteMoveUp,
    commands.deleteMoveLeft,
  ];
  return shiftCommand(replica, shifts[kind - 6], { ...target, range });
};
