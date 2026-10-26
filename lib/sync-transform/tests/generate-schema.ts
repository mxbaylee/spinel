import {
  BaselineOffset,
  BooleanNumber,
  BORDER_KEYS,
  BorderStyleTypes,
  CellValueType,
  FormulaType,
  HorizontalAlign,
  STYLE_KEYS,
  TextDecoration,
  TextDirection,
  VerticalAlign,
  WrapStrategy,
} from '@univerjs/core';
import type { ICellData, IStyleData, IWorkbookData, Worksheet } from '@univerjs/core';
import { checkCellValueType } from '@univerjs/sheets';
import { cellIds } from '../src/writes.ts';
import { commandEdit, denseBook, richDoc, sheetCut, token } from './generate-cells.ts';
import { pick } from './generate.ts';
import type { Generate } from './generate.ts';

/**
 * What a field gets in one write: left out, null, the falsy value its type
 * allows (`0`, `''`, `false`, or an "off" object such as `{ s: 0 }`), or a
 * value set.
 */
type Choice = 'absent' | 'null' | 'falsy' | 'set';

/**
 * A field's values, as Univer 1.1.0's types allow them and its sanitizers
 * keep them (`sanitizeStyleValue` and friends in `@univerjs/sheets`): `falsy`
 * is left out where the type has none, and `set` gets the cell the write
 * lands on, for a type that has to agree with its value.
 */
interface Values {
  falsy?: readonly unknown[];
  set: (next: () => number, cell: ICellData) => unknown;
}

const colour = (next: () => number) => ({ rgb: pick(next, ['#ff0000', '#00ff00', '#0000ff']) });
const decoration: Values = {
  falsy: [{ s: BooleanNumber.FALSE }],
  set: (next) =>
    pick(next, [
      { s: BooleanNumber.TRUE },
      { s: BooleanNumber.TRUE, t: TextDecoration.DOUBLE, cl: colour(next) },
    ]),
};
const edge: Values = {
  falsy: [{ s: BorderStyleTypes.NONE, cl: { rgb: '#000000' } }],
  set: (next) => ({
    s: pick(next, [BorderStyleTypes.THIN, BorderStyleTypes.DASHED, BorderStyleTypes.THICK]),
    cl: colour(next),
  }),
};

/** Each border edge, `BORDER_KEYS` from `IBorderData`. */
const edges = Object.fromEntries(BORDER_KEYS.map((key) => [key, edge])) as Record<
  (typeof BORDER_KEYS)[number],
  Values
>;

/**
 * Every `IStyleData` key, which `STYLE_KEYS` lists for Univer's merge; `bd` is
 * built edge by edge (see `border`).
 */
const styleValues: Record<keyof IStyleData, Values> = {
  ff: { falsy: [''], set: (next) => pick(next, ['Arial', 'Times New Roman']) },
  eastAsiaFontFamily: { falsy: [''], set: () => 'SimSun' },
  fs: { falsy: [0], set: (next) => pick(next, [9, 14]) },
  it: { falsy: [BooleanNumber.FALSE], set: () => BooleanNumber.TRUE },
  bl: { falsy: [BooleanNumber.FALSE], set: () => BooleanNumber.TRUE },
  ul: decoration,
  bbl: decoration,
  st: decoration,
  ol: decoration,
  bg: { set: colour },
  bd: { set: (next) => border(next) },
  cl: { set: colour },
  va: { set: (next) => pick(next, [BaselineOffset.SUBSCRIPT, BaselineOffset.SUPERSCRIPT]) },
  // A pattern of '' is no format (hasNumberFormat), and '@' types the next value as text.
  n: { falsy: [{ pattern: '' }], set: (next) => ({ pattern: pick(next, ['@', '0.00', '0%']) }) },
  stf: { falsy: [BooleanNumber.FALSE], set: () => BooleanNumber.TRUE },
  tr: {
    falsy: [{ a: 0 }],
    set: (next) => pick(next, [{ a: 45 }, { a: 0, v: BooleanNumber.TRUE }]),
  },
  td: {
    falsy: [TextDirection.UNSPECIFIED],
    set: (next) => pick(next, [TextDirection.LEFT_TO_RIGHT, TextDirection.RIGHT_TO_LEFT]),
  },
  ht: {
    falsy: [HorizontalAlign.UNSPECIFIED],
    set: (next) => pick(next, [HorizontalAlign.CENTER, HorizontalAlign.RIGHT]),
  },
  vt: {
    falsy: [VerticalAlign.UNSPECIFIED],
    set: (next) => pick(next, [VerticalAlign.TOP, VerticalAlign.MIDDLE]),
  },
  tb: {
    falsy: [WrapStrategy.UNSPECIFIED],
    set: (next) => pick(next, [WrapStrategy.CLIP, WrapStrategy.WRAP]),
  },
  pd: { falsy: [{ t: 0 }], set: () => ({ t: 2, l: 3 }) },
};

/** Text that holds a token, numbers and booleans as they are, and their text forms. */
const anyValue = (next: () => number) => {
  const picked = pick(next, ['a', 7, 2.5, 'TRUE', '7', true, 1]);
  return picked === 'a' ? token('a') : picked;
};

/**
 * A forced type that agrees with the value it types: text for anything, a
 * number only for a number, a boolean only for one that reads as a boolean.
 */
function forcedType(next: () => number, value: unknown) {
  const types: CellValueType[] = [CellValueType.STRING, CellValueType.FORCE_STRING];
  const read = value ?? null;
  if (read !== null && checkCellValueType(read as never) === CellValueType.NUMBER) {
    types.push(CellValueType.NUMBER);
  }
  if (read !== null && checkCellValueType(read as never) === CellValueType.BOOLEAN) {
    types.push(CellValueType.BOOLEAN);
  }
  return pick(next, types);
}

/**
 * Every `ICellData` key. `t` is picked last, to agree with `v` (see
 * `forcedType`), and a style id is never written: the README's sender rules
 * keep styles inline.
 */
const cellValues: Record<keyof ICellData, Values> = {
  v: { falsy: [0, '', false], set: anyValue },
  p: { set: () => richDoc(token('r')) },
  // Filled by `schemaCell`, with the style keys it is given.
  s: { set: () => ({}) },
  // Only beside a value (see `schemaCell`).
  t: { set: (next, cell) => forcedType(next, cell.v) },
  // No token: Univer writes a shared formula's text into the cells that share
  // it, so a token there would read as content in two cells.
  f: { falsy: [''], set: (next) => pick(next, ['=1+2', '=A1', '=SUM(B1:B2)']) },
  // A new id, never the seeded one: a cell that joined B1's shared formula
  // with a typed formula's token would copy that token to B2 the same way.
  si: { falsy: [''], set: () => token('si') },
  ft: {
    falsy: [FormulaType.NORMAL],
    set: (next) => pick(next, [FormulaType.SHARED, FormulaType.ARRAY]),
  },
  fd: { falsy: [BooleanNumber.FALSE], set: () => BooleanNumber.TRUE },
  ref: { falsy: [''], set: () => 'A1:B2' },
  xf: { falsy: [''], set: () => '_xlfn.' },
  custom: { set: () => ({ note: token('n') }) },
};

/** `keys`, each left out unless picked one time in `odds`, then null, falsy or set. */
function fields<K extends string>(
  next: () => number,
  values: Record<K, Values>,
  keys: readonly K[],
  odds: number,
  cell: ICellData = {},
): Partial<Record<K, unknown>> {
  const result: Partial<Record<K, unknown>> = {};
  for (const key of keys) {
    const { falsy, set } = values[key];
    const choices: Choice[] = falsy ? ['null', 'falsy', 'set'] : ['null', 'set'];
    const choice: Choice = next() % odds === 0 ? pick(next, choices) : 'absent';
    if (choice === 'absent') continue;
    result[key] =
      choice === 'null' ? null : choice === 'falsy' ? pick(next, falsy!) : set(next, cell);
  }
  return result;
}

/** A border with each edge left out, null, `s: NONE`, or set. */
const border = (next: () => number) => fields(next, edges, BORDER_KEYS, 3);

/** A style with about three of its 21 keys, of `keys`. */
const style = (next: () => number, keys: readonly (keyof IStyleData)[]): IStyleData =>
  fields(next, styleValues, keys, 7) as IStyleData;

/** The keys a generator writes: cell keys but `t`, whether `t`, and style keys. */
interface Keys {
  cell: (keyof ICellData)[];
  typed: boolean;
  style: (keyof IStyleData)[];
}

/**
 * A cell write with about three of its keys, each absent, null, falsy or set,
 * or now and then the whole cell deleted. Text gets a token, so the intent
 * checks can tell a copy from a move.
 */
function schemaCell(next: () => number, keys: Keys) {
  if (next() % 10 === 0) return null;
  const cell = fields(next, cellValues, keys.cell, 4) as ICellData;
  // Univer derives `t` from the value, so its writers send one only with a
  // value: a paste or an undo with the cell's own, or RemoveNumfmt's retype of
  // the value the cell holds, which `commandEdit` sends. A `t` alone, or one
  // that disagrees with its value, is no shape they send.
  if (keys.typed && cell.v !== undefined)
    Object.assign(cell, fields(next, cellValues, ['t'], 4, cell));
  // An empty write still retypes the value, as the README's transform notes.
  if (cell.s) cell.s = style(next, keys.style);
  return cell;
}

/**
 * A SetRangeValues of one to four cells of a sheet, each made by
 * `schemaCell`, sometimes with `isOverrideStyle`.
 */
function schemaWrite(sheet: Worksheet, unitId: string, next: () => number, keys: Keys) {
  const rows = sheet.getRowCount();
  const columns = sheet.getColumnCount();
  const startRow = next() % rows;
  const startColumn = next() % columns;
  const endRow = Math.min(rows - 1, startRow + (next() % 2));
  const endColumn = Math.min(columns - 1, startColumn + (next() % 2));
  const cellValue: Record<number, Record<number, unknown>> = {};
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startColumn; col <= endColumn; col++) {
      (cellValue[row] ??= {})[col] = schemaCell(next, keys);
    }
  }
  const override = next() % 5 === 0;
  return [
    {
      id: cellIds.setRangeValues,
      params: {
        unitId,
        subUnitId: sheet.getSheetId(),
        cellValue,
        ...(override && { isOverrideStyle: true }),
      },
    },
  ];
}

/**
 * Cell writes generated from Univer's own types, not from hand-made lists:
 * every `ICellData` key, every `IStyleData` key and every border edge is
 * absent, null, falsy or set, so writes take shapes no command was written
 * for. Three edits in ten are Univer's own (`commandEdit`: editor commits,
 * style and number-format commands, range moves and shifts, and `cellEdit`'s
 * clears and pasted styles) and one in ten a cut to the other sheet, so the
 * schema's writes meet real command shapes. `skip` names cell keys and style
 * keys (`s.<key>`) the schema's writes leave out, to look past a finding.
 */
export function schemaEdits(skip: string[] = []): Generate {
  const keys: Keys = {
    cell: (Object.keys(cellValues) as (keyof ICellData)[]).filter(
      (key) => key !== 't' && !skip.includes(key),
    ),
    typed: !skip.includes('t'),
    style: STYLE_KEYS.filter((key) => !skip.includes(`s.${key}`)),
  };
  return (replica, next) => {
    const roll = next() % 10;
    if (roll < 3) return commandEdit(replica, next);
    if (roll === 3) return sheetCut(replica, next);
    const workbook = replica.workbook()!;
    // Most writes go to One, the dense sheet, so they collide.
    const sheets = workbook.getSheetOrders();
    const sheet = workbook.getSheetBySheetId(next() % 4 === 0 ? pick(next, sheets) : sheets[0])!;
    return schemaWrite(sheet, workbook.getUnitId(), next, keys);
  };
}

/** `schemaEdits` with every key. */
export const schemaEdit = schemaEdits();

/**
 * `denseBook()`'s 4×3 sheet with the state the older generators never wrote:
 * a formula with its type and dynamic-array flag (`ft`, `fd`) at A1, a
 * shared formula's first cell at B1 and a cell that uses it at B2 (`si`),
 * a cell with `custom` at C2 and rich text under a bordered style at C3. A
 * second 2×2 sheet, Two, takes cuts.
 */
export function schemaBook(): IWorkbookData {
  const book = denseBook();
  const cells = book.sheets.s1.cellData!;
  const line = { s: BorderStyleTypes.THIN, cl: { rgb: '#000000' } };
  Object.assign(cells[0], {
    0: { f: '=B2', ft: FormulaType.ARRAY, fd: BooleanNumber.TRUE, ref: 'A1' },
    1: { f: '=C1', si: 'sf1' },
  });
  Object.assign(cells[1], {
    1: { si: 'sf1' },
    2: { v: 's1:1:2', custom: { note: 's1:1:2' } },
  });
  Object.assign(cells[2], { 2: { p: richDoc('s1:2:2'), s: { bd: { t: line, l: line } } } });
  const two: Record<number, Record<number, ICellData>> = {};
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) (two[row] ??= {})[col] = { v: `s2:${row}:${col}` };
  }
  book.sheets.s2 = { id: 's2', name: 'Two', rowCount: 2, columnCount: 2, cellData: two };
  book.sheetOrder = ['s1', 's2'];
  return book;
}
