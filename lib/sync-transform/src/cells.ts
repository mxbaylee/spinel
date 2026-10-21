import type { IRange } from '@univerjs/core';
import { removeNumfmt, setCell, setNumfmt } from './univer-merge.ts';
import { mapIndex } from './axis.ts';
import type { AxisEdit } from './axis.ts';
import type { Axis, Family } from './family.ts';
import { pastShift, remark, shiftOf } from './shifts.ts';
import { RefusedEditError } from './types.ts';
import type { Mutation, Side } from './types.ts';

export const cellIds = {
  setRangeValues: 'sheet.mutation.set-range-values',
  setNumfmt: 'sheet.mutation.set.numfmt',
  removeNumfmt: 'sheet.mutation.remove.numfmt',
  moveRange: 'sheet.mutation.move-range',
} as const;

type CellData = Record<string, any>;
type Matrix = Record<number, Record<number, unknown>>;
export type Cell = { row: number; col: number };

/**
 * One cell a mutation writes. `value` is the cell data (SetRangeValues and
 * MoveRange), the pattern id (SetNumfmt) or null (RemoveNumfmt). `slot` tells
 * MoveRange's two matrices apart.
 */
export interface Write extends Cell {
  value: any;
  slot?: 'from' | 'to';
}

/**
 * A part of a write that conflicts on its own. `path` is '' for the whole
 * cell, a top-level key such as `v` or `f`, `s` for the whole style, or
 * `s.<key>` for one style key, which Univer merges into the existing style.
 */
interface Piece {
  path: string;
  value: unknown;
}

export const cellKey = (cell: Cell) => `${cell.row}:${cell.col}`;

function matrixWrites(matrix: Matrix, slot?: 'from' | 'to'): Write[] {
  return Object.entries(matrix ?? {}).flatMap(([row, columns]) =>
    Object.entries(columns ?? {}).map(([col, value]) => ({
      row: Number(row),
      col: Number(col),
      value,
      ...(slot && { slot }),
    })),
  );
}

function rangeWrites(ranges: IRange[], value: unknown): Write[] {
  const writes: Write[] = [];
  for (const range of ranges) {
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startColumn; col <= range.endColumn; col++) {
        writes.push({ row, col, value });
      }
    }
  }
  return writes;
}

const written = new WeakMap<Mutation, Write[]>();

/** The cells `mutation` writes, kept per mutation: a sequence is paired many times. */
export function writesOf(mutation: Mutation): Write[] {
  let writes = written.get(mutation);
  if (!writes) written.set(mutation, (writes = cellWrites(mutation)));
  return writes;
}

function cellWrites(mutation: Mutation): Write[] {
  const p = mutation.params;
  if (mutation.id === cellIds.setRangeValues) {
    return matrixWrites(p.cellValue);
  }
  if (mutation.id === cellIds.setNumfmt) {
    const values = p.values as Record<string, { ranges: IRange[] }>;
    return Object.entries(values).flatMap(([id, { ranges }]) => rangeWrites(ranges, id));
  }
  if (mutation.id === cellIds.removeNumfmt) return rangeWrites(p.ranges, null);
  return [...matrixWrites(p.from.value, 'from'), ...matrixWrites(p.to.value, 'to')];
}

/** The cells as runs along each row. */
function rectangles(writes: Write[]): IRange[] {
  const cells = [...writes].sort((x, y) => x.row - y.row || x.col - y.col);
  const runs: IRange[] = [];
  for (const { row, col } of cells) {
    const last = runs.at(-1);
    if (last && last.startRow === row && last.endColumn === col - 1) last.endColumn = col;
    else runs.push({ startRow: row, endRow: row, startColumn: col, endColumn: col });
  }
  return runs;
}

/** The smallest range holding every cell. */
export function bounds(cells: Cell[]): IRange {
  const rows = cells.map((cell) => cell.row);
  const cols = cells.map((cell) => cell.col);
  return {
    startRow: Math.min(...rows),
    endRow: Math.max(...rows),
    startColumn: Math.min(...cols),
    endColumn: Math.max(...cols),
  };
}

export function toMatrix(writes: Write[]): Matrix {
  const matrix: Matrix = {};
  for (const { row, col, value } of writes) (matrix[row] ??= {})[col] = value;
  return matrix;
}

/** `mutation` rewritten to make exactly `writes`, or nothing if none are left. */
export function rebuild(mutation: Mutation, writes: Write[]): Mutation[] {
  if (writes.length === 0) return [];
  const p = mutation.params;
  const withParams = (params: Record<string, unknown>) => [
    { id: mutation.id, params: { ...p, ...params } },
  ];
  if (mutation.id === cellIds.setRangeValues) return withParams({ cellValue: toMatrix(writes) });
  if (mutation.id === cellIds.removeNumfmt) return withParams({ ranges: rectangles(writes) });
  if (mutation.id === cellIds.setNumfmt) {
    const patternIds = [...new Set(writes.map((write) => write.value as string))];
    const pick = (f: (id: string) => unknown) =>
      Object.fromEntries(patternIds.map((id) => [id, f(id)]));
    return withParams({
      values: pick((id) => ({ ranges: rectangles(writes.filter((write) => write.value === id)) })),
      refMap: pick((id) => p.refMap[id]),
    });
  }
  // The ranges say where the move takes each cell (see `targets`), so they stay.
  const slot = (name: 'from' | 'to') => toMatrix(writes.filter((write) => write.slot === name));
  return withParams({
    from: { ...p.from, value: slot('from') },
    to: { ...p.to, value: slot('to') },
  });
}

/**
 * SetRangeValues merges each key it names into the cell, and each key of an
 * inline style into the cell's style; a null cell deletes it. isOverrideStyle
 * replaces the whole style. Numfmt mutations write style key `n`, valued as
 * SetRangeValues would write it. MoveRange overwrites whole cells.
 */
function piecesOf(mutation: Mutation, write: Write): Piece[] {
  if (mutation.id === cellIds.setNumfmt) {
    return [{ path: 's.n', value: { pattern: mutation.params.refMap[write.value].pattern } }];
  }
  if (mutation.id === cellIds.removeNumfmt) return [{ path: 's.n', value: null }];
  if (mutation.id === cellIds.moveRange || write.value === null) {
    return [{ path: '', value: write.value }];
  }
  // A key set to undefined is absent, as JSON leaves it. An empty write still retypes the value.
  const entries = Object.entries(write.value as CellData).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return [{ path: 't', value: undefined }];
  return entries.flatMap(([key, value]): Piece[] => {
    if (key !== 's' || value === null || mutation.params.isOverrideStyle) {
      return [{ path: key, value }];
    }
    return Object.entries(value).map(([styleKey, v]) => ({ path: `s.${styleKey}`, value: v }));
  });
}

/** `pieces` written as keys into a copy of `base`; '' replaces it. */
function assemble(pieces: Piece[], base: CellData | null = {}): CellData | null {
  let cell = base && { ...base, ...(base.s && { s: { ...base.s } }) };
  for (const { path, value } of pieces) {
    if (path === '') {
      cell = value ? { ...(value as CellData) } : null;
      continue;
    }
    cell ??= {};
    const [key, styleKey] = path.split('.');
    if (styleKey !== undefined) (cell.s ??= {})[styleKey] = value;
    else cell[key] = key === 's' && value ? { ...value } : value;
  }
  return cell;
}

/**
 * Whether writing `path` overwrites `inner`: the whole cell or style covers its
 * parts, and writing a value retypes it, so `v` covers `t`.
 */
const covers = (path: string, inner: string) =>
  path === '' || path === inner || inner.startsWith(`${path}.`) || (path === 'v' && inner === 't');

/**
 * An empty write retypes the value and overwrites nothing, so it covers only
 * another empty write: retyping twice is retyping once.
 */
const overwrites = (winning: Piece, piece: Piece) =>
  winning.path === 't' && winning.value === undefined
    ? piece.path === 't' && piece.value === undefined
    : covers(winning.path, piece.path);

/**
 * `loser`'s writes without the parts `winner` writes to the same cells. Only a
 * SetRangeValues cell splits; any other write stays whole or goes.
 */
function survivors(loser: Mutation, winner: Mutation): Write[] {
  const won = new Map(writesOf(winner).map((write) => [cellKey(write), piecesOf(winner, write)]));
  return writesOf(loser).flatMap((write) => {
    const pieces = won.get(cellKey(write));
    if (!pieces) return [write];
    const left = piecesOf(loser, write).filter(
      (piece) => !pieces.some((winning) => overwrites(winning, piece)),
    );
    if (left.length === 0) return [];
    return isValues(loser) && write.value !== null
      ? [{ ...write, value: assemble(left) }]
      : [write];
  });
}

const formatPaths = new Set(['', 's', 's.n']);
/** A forced type changes how the value reads, as a format does; an empty write's `t` is no force. */
const isForced = ({ path, value }: Piece) => path === 't' && value !== undefined;
const isFormat = (piece: Piece) => formatPaths.has(piece.path) || isForced(piece);
const isStyle = ({ path }: Piece) => path === 's' || path.startsWith('s.');
const isTextFormat = ({ path, value }: Piece) =>
  ((path === 's.n' && value) || (path === 's' && (value as CellData)?.n))?.pattern === '@';
/** The keys that make a cell's value, which a retype writes again. */
const valuePaths = new Set(['v', 'f', 'si']);
const contentPaths = new Set([...valuePaths, 't', 'p']);
/** Whether pieces write content only, which nothing else derives from. */
const isContent = (pieces: Piece[]) =>
  pieces.every((piece) => contentPaths.has(piece.path) && !isFormat(piece));

const isValues = (mutation: Mutation) => mutation.id === cellIds.setRangeValues;

/** Whether `values` writes a cell whose number format `format` changes, without setting its value. */
function formatRace(format: Mutation, values: Mutation): boolean {
  if (format.id !== cellIds.setNumfmt && format.id !== cellIds.removeNumfmt) return false;
  if (!isValues(values)) return false;
  const cells = new Set(writesOf(format).map(cellKey));
  return writesOf(values).some(
    (write) =>
      cells.has(cellKey(write)) &&
      !piecesOf(values, write).some(({ path }) => path === 'v' || path === ''),
  );
}
export const isMove = (mutation: Mutation) => mutation.id === cellIds.moveRange;

/**
 * Univer types a value (`t`) when a SetRangeValues writes it, under the
 * number format then present, and typing can lose the original (`TRUE` as a
 * boolean is stored as 1). Numfmt mutations never retype. So where either of
 * two writes to a cell changes its format, the order decides the type, unless
 * the last write in it writes the value, typing it afresh. `a`'s transform,
 * landing after `b`, ends with `last` at each cell, and where that writes no
 * value it writes the content both leave again. A rewrite of no value types
 * the one the cell holds.
 */
function retype(a: Mutation, b: Mutation, side: Side, landed: Mutation[]): Mutation[] {
  const last = new Map(
    landed.flatMap((mutation) =>
      writesOf(mutation).map((write) => [cellKey(write), piecesOf(mutation, write)] as const),
    ),
  );
  const [winner, loser] = side === 'left' ? [a, b] : [b, a];
  const inB = new Map(writesOf(b).map((write) => [cellKey(write), piecesOf(b, write)]));
  const content = (mutation: Mutation, writes: Write[]) =>
    new Map(
      writes.map((write) => [
        cellKey(write),
        assemble(piecesOf(mutation, write).filter(({ path }) => valuePaths.has(path)))!,
      ]),
    );
  const kept = content(loser, survivors(loser, winner));
  const won = content(winner, writesOf(winner));
  const deleted = new Set(
    writesOf(loser)
      .filter((write) => piecesOf(loser, write).some(({ path, value }) => !path && !value))
      .map(cellKey),
  );
  const cells = writesOf(a).flatMap((write) => {
    const key = cellKey(write);
    const theirs = inB.get(key);
    if (!theirs) return [];
    const ours = piecesOf(a, write);
    const final = last.get(key) ?? theirs;
    // A whole style with no number format still types the value under the old one.
    const typed =
      final.some(({ path }) => path === 'v' || path === '') &&
      !final.some(({ path, value }) => path === 's' && !(value as CellData)?.n);
    if (typed || ![...ours, ...theirs].some(isFormat)) return [];
    const value = { ...kept.get(key), ...won.get(key) };
    // Without a value to type afresh the rewrite retypes the one the cell
    // holds, as a last write that sets no format already did; and a cell the
    // loser deleted holds a value only if the winner writes one.
    const repeats =
      value.v === undefined &&
      (deleted.has(key) || !final.some((piece) => isStyle(piece) || isForced(piece)));
    return value.v === null || repeats ? [] : [{ ...write, value }];
  });
  if (cells.length === 0) return [];
  const { unitId, subUnitId } = a.params;
  return [
    {
      id: cellIds.setRangeValues,
      params: { unitId, subUnitId, cellValue: toMatrix(cells), derived: true },
    },
  ];
}

type Plan = { layer: 'drop' } | { layer: 'alone' | 'merged' | 'whole' | 'replay'; write: Write };

/**
 * How the loser `a` writes a cell the winner `b` writes too. It keeps the
 * parts the winner does not write, with the winner's parts in the same write
 * where Univer derives keys from others (a style write restyles rich text, a
 * value write recomputes `t`), as one write per cell keeps a long run of
 * writes to a cell from multiplying as each later write is transformed. A
 * number format derives nothing, so it stays apart unless a whole style takes
 * it in: as a style key it would restyle rich text. Where no one write can do
 * what the two did in order, the loser lands and the winner's write is
 * replayed after it: past a losing whole cell or whole style; a winning style
 * past losing rich text, which Univer restyles in a cell but not written with
 * or after the style; a style with a value, under which Univer drops rich
 * text; a winning forced type; and where the winner overwrites a losing style
 * with an effect it leaves (rich text a style restyled, which a number format
 * or an override leaves; a text format, which types the next value as text,
 * losing what it was; a type forced with a value, which sticks to the next).
 */
function plan(
  a: Mutation,
  write: Write,
  kept: Write | undefined,
  b: Mutation,
  winning: Piece[],
): Plan {
  const covered = (test: (piece: Piece) => boolean) =>
    piecesOf(a, write).some(
      (piece) => test(piece) && winning.some(({ path }) => covers(path, piece.path)),
    );
  const leaves = isValues(b) ? b.params.isOverrideStyle : true;
  const restyled = isValues(a) && !a.params.isOverrideStyle && leaves && covered(isStyle);
  const typed =
    isValues(b) && ((write.value?.v != null && covered(isForced)) || covered(isTextFormat));
  if (restyled || typed) return { layer: 'replay', write };
  if (!kept) return { layer: 'drop' };
  const ours = piecesOf(a, kept);
  const restylesOurs =
    isValues(b) && ours.some(({ path, value }) => path === 'p' && value) && winning.some(isStyle);
  if (restylesOurs) return { layer: 'replay', write: kept };
  if (isContent(ours)) return { layer: 'alone', write: kept };
  const apart =
    winning.some(isForced) ||
    ours.some(({ path }) => path === '' || (path === 's' && !a.params.isOverrideStyle));
  if (apart) return { layer: 'replay', write: kept };
  const pieces = [...ours, ...winning];
  const whole = pieces.some(({ path }) => path === 's');
  const value = assemble(
    pieces.filter((piece) => piece.path !== 't' || piece.value !== undefined),
  )!;
  if (whole && value.s) {
    value.s = Object.fromEntries(Object.entries(value.s).filter(([, v]) => v !== null));
  }
  if (!whole && 's' in value && value.v != null && !('p' in value)) {
    return { layer: 'replay', write: kept };
  }
  if (!whole && !(isValues(a) && isValues(b))) return { layer: 'alone', write: kept };
  return { layer: whole ? 'whole' : 'merged', write: { ...kept, value } };
}

/** Adjacent SetRangeValues with the same flags and no cell in common, as one. */
function coalesce(mutations: Mutation[]): Mutation[] {
  const result: Mutation[] = [];
  for (const mutation of mutations) {
    const previous = result.at(-1);
    const joins =
      previous &&
      isValues(previous) &&
      isValues(mutation) &&
      !previous.params.isOverrideStyle === !mutation.params.isOverrideStyle &&
      !previous.params.derived === !mutation.params.derived &&
      previous.params.subUnitId === mutation.params.subUnitId &&
      !writesOf(mutation).some(
        (write) => previous.params.cellValue[write.row]?.[write.col] !== undefined,
      );
    if (!joins) {
      result.push(mutation);
      continue;
    }
    result.splice(-1, 1, ...rebuild(previous, [...writesOf(previous), ...writesOf(mutation)]));
  }
  return result;
}

const cellIdSet = new Set<string>(Object.values(cellIds));
const isCells = (mutation: Mutation) => cellIdSet.has(mutation.id);
const sheetKey = (mutation: Mutation, write: Write) =>
  `${mutation.params.unitId}/${mutation.params.subUnitId ?? mutation.params.from.subUnitId}/${cellKey(write)}`;

/**
 * Whether Univer applying `write` twice in a row leaves what once does. It
 * types a value from the format it reads before the write, which the write
 * may change, and from a forced text type (`t` 4) the cell had, which the
 * write may set: Univer forces a long number to text and retypes it as a
 * number the next time. Either way the repeat retypes, unless the write
 * forces the type, or keeps the format, or sets text format, which types as
 * text whatever came before.
 */
function idempotent(mutation: Mutation, write: Write): boolean {
  if (!isValues(mutation) || write.value === null) return true;
  const { s, v, t } = write.value as CellData;
  if (t) return true;
  const text = s?.n?.pattern === '@';
  const keepsFormat =
    s === undefined || (s !== null && !mutation.params.isOverrideStyle && !('n' in s));
  if (!keepsFormat && !text && !(s?.n && v == null)) return false;
  const long =
    typeof v === 'string' &&
    v.trim() !== '' &&
    Number.isFinite(Number(v)) &&
    (Number(v) > Number.MAX_SAFE_INTEGER || v.length >= 16);
  return text || !long;
}

/**
 * Whether `write` of `mutation`, landing right after `earlier` of `before` in
 * its cell, writes nothing new: a repeat of it, or a part of it with no style,
 * which writes the same keys again and types the value the same way. Never
 * for moves: a later transform can make the earlier move carry an edit into
 * the cell, which only the later write would replace.
 */
function rewrites(before: Mutation, earlier: Write, mutation: Mutation, write: Write): boolean {
  if (
    isMove(before) ||
    before.id !== mutation.id ||
    !before.params.isOverrideStyle !== !mutation.params.isOverrideStyle
  ) {
    return false;
  }
  // Key order differs only between writes made apart, so this misses few repeats.
  const keys = new Set(piecesOf(before, earlier).map((piece) => JSON.stringify(piece)));
  const pieces = piecesOf(mutation, write);
  const part = pieces.every((piece) => keys.has(JSON.stringify(piece)));
  const same = part && pieces.length === keys.size;
  return (
    part &&
    (same || !pieces.some(isStyle)) &&
    idempotent(before, earlier) &&
    idempotent(mutation, write)
  );
}

/**
 * `mutations` without the cell writes that change nothing in the end: a write
 * a later delete or move write of the cell replaces (those set it whatever it
 * held), and a cell edit repeating the last one to the cell. Transforming a
 * sequence repeats writes, as a loser replays the winner's, and without this
 * the repeats multiply as the sequence goes past more. Only runs of cell
 * mutations are compacted, as anything between them may re-address cells.
 */
export function compact(mutations: Mutation[]): Mutation[] {
  // One mutation can appear twice, so writes are told apart by position.
  const dead = mutations.map(() => new Set<number>());
  const settled = new Set<string>();
  for (let i = mutations.length - 1; i >= 0; i--) {
    const mutation = mutations[i];
    if (!isCells(mutation)) settled.clear();
    else if (isMove(mutation))
      for (const write of writesOf(mutation)) settled.add(sheetKey(mutation, write));
    else {
      writesOf(mutation).forEach((write, j) => {
        const key = sheetKey(mutation, write);
        if (settled.has(key)) dead[i].add(j);
        else if (isValues(mutation) && write.value === null) settled.add(key);
      });
    }
  }
  const last = new Map<string, { mutation: Mutation; write: Write }>();
  mutations.forEach((mutation, i) => {
    if (!isCells(mutation)) return last.clear();
    writesOf(mutation).forEach((write, j) => {
      if (dead[i].has(j)) return;
      const key = sheetKey(mutation, write);
      const before = last.get(key);
      const repeats =
        before !== undefined && rewrites(before.mutation, before.write, mutation, write);
      if (repeats) dead[i].add(j);
      else last.set(key, { mutation, write });
    });
  });
  if (dead.every((writes) => writes.size === 0)) return mutations;
  return coalesce(
    mutations.flatMap((mutation, i) =>
      dead[i].size === 0
        ? [mutation]
        : rebuild(
            mutation,
            writesOf(mutation).filter((_, j) => !dead[i].has(j)),
          ),
    ),
  );
}

/** `a` past `b` where both write some cells; `b` wins them on the right. */
function conflict(a: Mutation, b: Mutation, side: Side): Mutation[] {
  if (side === 'left') return [a, ...retype(a, b, side, [a])];
  const won = new Map(writesOf(b).map((write) => [cellKey(write), write]));
  const kept = new Map(survivors(a, b).map((write) => [cellKey(write), write]));
  const layers = { alone: [] as Write[], merged: [] as Write[], whole: [] as Write[] };
  const replay: Write[] = [];
  for (const write of writesOf(a)) {
    const key = cellKey(write);
    const theirs = won.get(key);
    const winning = theirs ? piecesOf(b, theirs) : [];
    const cell: Plan = theirs
      ? plan(a, write, kept.get(key), b, winning)
      : { layer: 'alone', write };
    if (cell.layer === 'drop') continue;
    if (cell.layer === 'replay') replay.push(theirs!);
    layers[cell.layer === 'replay' ? 'alone' : cell.layer].push(cell.write);
  }
  const { unitId, subUnitId } = a.params;
  const values = (writes: Write[], whole: boolean): Mutation[] =>
    writes.length === 0
      ? []
      : [
          {
            id: cellIds.setRangeValues,
            params: {
              unitId,
              subUnitId,
              cellValue: toMatrix(writes),
              ...(whole && { isOverrideStyle: true }),
            },
          },
        ];
  const landed = [
    ...rebuild(a, layers.alone),
    ...values(layers.merged, false),
    ...values(layers.whole, true),
    ...rebuild(b, replay),
  ];
  return coalesce([...landed, ...retype(a, b, side, landed)]);
}

/**
 * Where `move` takes each source cell's content: the cell at the same place
 * in `toRange`, while the move still writes it.
 */
export function targets(move: Mutation): Map<string, Cell> {
  const { fromRange, toRange, from, to } = move.params;
  const written = new Set(matrixWrites(to.value).map(cellKey));
  const result = new Map<string, Cell>();
  for (const write of matrixWrites(from.value)) {
    const row = write.row + toRange.startRow - fromRange.startRow;
    const col = write.col + toRange.startColumn - fromRange.startColumn;
    if (written.has(cellKey({ row, col }))) result.set(cellKey(write), { row, col });
  }
  return result;
}

/** A cell's content after `edit` makes `write` to it. */
export function edited(cell: CellData | null, edit: Mutation, write: Write): CellData | null {
  if (edit.id === cellIds.setNumfmt)
    return setNumfmt(cell, edit.params.refMap[write.value].pattern);
  if (edit.id === cellIds.removeNumfmt) return removeNumfmt(cell);
  return setCell(cell, write.value, !!edit.params.isOverrideStyle);
}

const typeOnly = (write: Write) => write.value !== null && Object.keys(write.value).join() === 't';
/** A `t`-only write of forced text, which RemoveNumfmt makes for a cell with no value. */
const forcesText = (write: Write) => typeOnly(write) && write.value.t === 4;

/**
 * Whether `mutation` transforms alike wherever it lands. A write that forces
 * text does not, as cancelled() relies on its cell holding no value. Nor does
 * a move: whether it meets an edit, and so is refused (see `transform`) or
 * carries the edit as a shift, depends on where each lands.
 */
export const landsAnywhere = (mutation: Mutation) =>
  isValues(mutation) ? !writesOf(mutation).some(forcesText) : !isMove(mutation);

/** Whether `mutation` writes a cell any of `others` writes. */
export function meets(mutation: Mutation, others: Mutation[]): boolean {
  const cells = new Set(others.flatMap((other) => writesOf(other).map(cellKey)));
  return writesOf(mutation).some((write) => cells.has(cellKey(write)));
}

/**
 * Univer ignores a `t`-only write to a cell with no value, and a value written
 * after it is typed afresh, so a concurrent write of `v` cancels a `t`-only
 * cell whichever side wins; the same write after the value would force its
 * type. RemoveNumfmt's companion write is the `t`-only kind. Forced text
 * sticks to the next value instead, and RemoveNumfmt forces it only where the
 * cell holds no value, which a concurrent write to the cell may change, so any
 * such write cancels it.
 */
function cancelled(mutation: Mutation, other: Mutation): Mutation[] {
  if (!isValues(mutation)) return [mutation];
  const touched = new Map(writesOf(other).map((write) => [cellKey(write), piecesOf(other, write)]));
  const cancels = (write: Write) => {
    const theirs = touched.get(cellKey(write));
    return (
      !!theirs && typeOnly(write) && (forcesText(write) || theirs.some(({ path }) => path === 'v'))
    );
  };
  const writes = writesOf(mutation);
  return writes.some(cancels)
    ? rebuild(
        mutation,
        writes.filter((write) => !cancels(write)),
      )
    : [mutation];
}

function transform(a: Mutation, b: Mutation, rank: Side): Mutation[] {
  const shifted = pastShift(a, b, rank);
  if (shifted) return shifted;
  if (!meets(a, [b])) return [a];
  // Decision (owner, chat 2026-10-20): a dragged range and a concurrent edit of
  // any cell it moves, in its source or its target, are refused, not merged:
  // the server refuses the later one and its sender reloads. Merging them,
  // with the edit following the moved content and a winning write taking a
  // target over, silently lost or duplicated content in rare races; a refusal
  // is visible, and the person can redo the edit. Two drags of the same cells
  // are refused too, as before. Shifts keep merging (see shifts.pastShift).
  if (isMove(a) && isMove(b)) throw new RefusedEditError('overlapping-moves');
  if (isMove(a) || isMove(b)) throw new RefusedEditError('moved-cells');
  // Decision (owner, chat 2026-10-20): a number-format change and a concurrent
  // write to one of its cells that sets no value, such as a style or a retype,
  // are refused. A write under text format '@' turns the cell's value to text,
  // losing its type, so a transform that sees only the two edits cannot make
  // both orders agree. Not taken: refusing every write to the cell, which
  // refuses values that do converge, and a sender that sends the type it
  // writes (SPN-058).
  if (formatRace(a, b) || formatRace(b, a)) throw new RefusedEditError('format-race');
  // A retype replays content both wrote, so it loses to any edit of the cell.
  const side = !a.params.derived === !b.params.derived ? rank : a.params.derived ? 'right' : 'left';
  const [mine] = cancelled(a, b);
  const [theirs] = cancelled(b, a);
  if (!mine || !theirs) return mine ? [mine] : [];
  return conflict(mine, theirs, side);
}

/** Univer's row and column handlers shift the cell matrix; cells in removed lines go. */
function remap(mutation: Mutation, axis: Axis, edit: AxisEdit): Mutation[] {
  const shift = (write: Write): Write | null => {
    const index = mapIndex(edit, axis === 'row' ? write.row : write.col);
    if (index === null) return null;
    return axis === 'row' ? { ...write, row: index } : { ...write, col: index };
  };
  if (mutation.id === cellIds.moveRange) {
    const parts = (move: Mutation) => remapMove(move, shift);
    return shiftOf(mutation) ? remark(mutation, axis, edit, parts) : parts(mutation);
  }
  return rebuild(
    mutation,
    writesOf(mutation).flatMap((write) => shift(write) ?? []),
  );
}

/**
 * A line inserted or removed inside a move's source or target changes how far
 * some cells move, so the move splits into one per run of cells moving the
 * same way. One move clears every source before writing any target, so each
 * cell's move goes after the move out of its target. Clears whose target went
 * come first, and copies whose source went last.
 */
export function remapMove(move: Mutation, shift: (write: Write) => Write | null): Mutation[] {
  const moved = targets(move);
  const writes = writesOf(move);
  const sources = new Map(writes.filter((w) => w.slot === 'from').map((w) => [cellKey(w), w]));
  const copied = new Map(writes.filter((w) => w.slot === 'to').map((w) => [cellKey(w), w]));
  const pairs: [Write, Write][] = [];
  const placed = new Set<string>();
  const kept = new Set<Write>();
  for (const source of sources.values()) {
    // Follow the cells this one's target moves to, and place them first.
    const chain: [Write, Write][] = [];
    for (let at = source as Write | undefined; at && !placed.has(cellKey(at));) {
      placed.add(cellKey(at));
      const target = moved.get(cellKey(at));
      const copy = target && copied.get(cellKey(target))!;
      const [from, to] = [shift(at), copy && shift(copy)];
      if (from && to) {
        chain.push([from, to]);
        kept.add(at).add(copy!);
      }
      at = target && sources.get(cellKey(target));
    }
    pairs.push(...chain.reverse());
  }
  const unpaired = (slot: 'from' | 'to') =>
    writes.flatMap((write) => (write.slot === slot && !kept.has(write) && shift(write)) || []);
  const offset = ([from, to]: [Write, Write]) => `${to.row - from.row}:${to.col - from.col}`;
  const runs: [Write, Write][][] = [];
  for (const pair of pairs) {
    const run = runs.at(-1);
    if (run && offset(run[0]) === offset(pair)) run.push(pair);
    else runs.push([pair]);
  }
  const p = move.params;
  const part = (from: Write[], to: Write[]): Mutation => ({
    id: move.id,
    params: {
      ...p,
      fromRange: bounds(from.length > 0 ? from : to),
      toRange: bounds(to.length > 0 ? to : from),
      from: { ...p.from, value: toMatrix(from) },
      to: { ...p.to, value: toMatrix(to) },
    },
  });
  const [clears, copies] = [unpaired('from'), unpaired('to')];
  return [
    ...(clears.length > 0 ? [part(clears, [])] : []),
    ...runs.map((run) =>
      part(
        run.map(([from]) => from),
        run.map(([, to]) => to),
      ),
    ),
    ...(copies.length > 0 ? [part([], copies)] : []),
  ];
}

export const cells: Family = { ids: Object.values(cellIds), remap, transform };
