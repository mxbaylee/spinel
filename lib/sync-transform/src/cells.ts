import { BORDER_KEYS, isFormulaId } from '@univerjs/core';
import type { IRange } from '@univerjs/core';
import { mapIndex } from './axis.ts';
import type { AxisEdit } from './axis.ts';
import type { Axis, Family } from './family.ts';
import { movesMeet, refuseCut, remapMove } from './shifts.ts';
import { structureIds } from './structure.ts';
import { RefusedEditError, refuseRaces } from './types.ts';
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
 * The id of a ghost (see `haunted`): never a Univer mutation, so `check`
 * rejects one sent in, and `transform` drops every one from what it returns.
 */
export const ghostId = 'sync-transform.cells.ghost';
const isGhost = (mutation: Mutation) => mutation.id === ghostId;

/**
 * One cell a mutation writes. `value` is the cell data (SetRangeValues and
 * MoveRange), the pattern id (SetNumfmt) or null (RemoveNumfmt).
 */
interface Write extends Cell {
  value: any;
}

/**
 * A part of a write that conflicts on its own. `path` is '' for the whole
 * cell, a top-level key such as `v` or `f`, `s` for the whole style,
 * `s.<key>` for one style key, which Univer merges into the existing style,
 * or `s.bd.<edge>` for one border edge, which it merges into the border.
 */
interface Piece {
  path: string;
  value: unknown;
}

const cellKey = (cell: Cell) => `${cell.row}:${cell.col}`;

export function matrixWrites(matrix: Matrix): Write[] {
  return Object.entries(matrix ?? {}).flatMap(([row, columns]) =>
    Object.entries(columns ?? {}).map(([col, value]) => ({
      row: Number(row),
      col: Number(col),
      value,
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
  if (mutation.id === cellIds.setRangeValues || isGhost(mutation)) {
    return matrixWrites(p.cellValue);
  }
  if (mutation.id === cellIds.setNumfmt) {
    const values = p.values as Record<string, { ranges: IRange[] }>;
    return Object.entries(values).flatMap(([id, { ranges }]) => rangeWrites(ranges, id));
  }
  if (mutation.id === cellIds.removeNumfmt) return rangeWrites(p.ranges, null);
  return [...matrixWrites(p.from.value), ...matrixWrites(p.to.value)];
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

function toMatrix(writes: Write[]): Matrix {
  const matrix: Matrix = {};
  for (const { row, col, value } of writes) (matrix[row] ??= {})[col] = value;
  return matrix;
}

/** `mutation`, not a move, rewritten to make exactly `writes`, or nothing if none are left. */
function rebuild(mutation: Mutation, writes: Write[]): Mutation[] {
  if (writes.length === 0) return [];
  const p = mutation.params;
  const withParams = (params: Record<string, unknown>) => [
    { id: mutation.id, params: { ...p, ...params } },
  ];
  if (mutation.id === cellIds.setRangeValues || isGhost(mutation)) {
    return withParams({ cellValue: toMatrix(writes) });
  }
  if (mutation.id === cellIds.removeNumfmt) return withParams({ ranges: rectangles(writes) });
  // SetNumfmt: each pattern id's cells as ranges.
  const patternIds = [...new Set(writes.map((write) => write.value as string))];
  const pick = (f: (id: string) => unknown) =>
    Object.fromEntries(patternIds.map((id) => [id, f(id)]));
  return withParams({
    values: pick((id) => ({ ranges: rectangles(writes.filter((write) => write.value === id)) })),
    refMap: pick((id) => p.refMap[id]),
  });
}

/**
 * `trigger`, the command that sent `mutation` (see names.rewrites), as params
 * to spread into a write made for it: a transform's output is its input's, so
 * each write in it carries its input's `trigger`, or none.
 */
const sentBy = (mutation: Mutation) =>
  mutation.params.trigger === undefined ? {} : { trigger: mutation.params.trigger };

/**
 * SetRangeValues merges each key it names into the cell, and each key of an
 * inline style into the cell's style, and each edge of a border into the
 * border (mergeBorderData); a null cell deletes it, a null border every edge.
 * isOverrideStyle replaces the whole style. A formula cleared (`f` null or
 * '') with no formula id in `si` deletes `ft` and `fd` too (mergeCellData),
 * so it writes them as null. Numfmt mutations write style key `n`, valued as
 * SetRangeValues would write it.
 *
 * Decision (owner, chat 2026-10-23): a border conflicts edge by edge, as
 * Univer merges it. Not taken: the border as one key, which diverged, and
 * refusing two border writes to one cell, which refuses edits that merge.
 */
function piecesOf(mutation: Mutation, write: Write): Piece[] {
  if (mutation.id === cellIds.setNumfmt) {
    return [{ path: 's.n', value: { pattern: mutation.params.refMap[write.value].pattern } }];
  }
  if (mutation.id === cellIds.removeNumfmt) return [{ path: 's.n', value: null }];
  if (write.value === null) return [{ path: '', value: null }];
  const cell = write.value as CellData;
  const cleared = (cell.f === null || cell.f === '') && !isFormulaId(cell.si);
  // A key set to undefined is absent, as JSON leaves it. An empty write still retypes the value.
  const entries = Object.entries(cleared ? { ...cell, ft: null, fd: null } : cell).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return [{ path: 't', value: undefined }];
  return entries.flatMap(([key, value]): Piece[] => {
    if (key !== 's' || value === null || mutation.params.isOverrideStyle) {
      return [{ path: key, value }];
    }
    return Object.entries(value).flatMap(([styleKey, v]): Piece[] =>
      styleKey === 'bd' && v
        ? BORDER_KEYS.filter((edge) => (v as CellData)[edge] !== undefined).map((edge) => ({
            path: `s.bd.${edge}`,
            value: (v as CellData)[edge],
          }))
        : [{ path: `s.${styleKey}`, value: v }],
    );
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
    const [key, styleKey, edge] = path.split('.');
    if (edge !== undefined) {
      const s = (cell.s ??= {});
      s.bd = { ...s.bd, [edge]: value };
    } else if (styleKey !== undefined) (cell.s ??= {})[styleKey] = value;
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
const contentPaths = new Set([...valuePaths, 't', 'p', 'ft', 'fd']);
/** Whether pieces write content only, which nothing else derives from. */
const isContent = (pieces: Piece[]) =>
  pieces.every((piece) => contentPaths.has(piece.path) && !isFormat(piece));

const isValues = (mutation: Mutation) => mutation.id === cellIds.setRangeValues;

const setsValue = (mutation: Mutation, write: Write) =>
  piecesOf(mutation, write).some(({ path }) => path === 'v' || path === '');
/** A numfmt, or a style that names `n`. */
const changesFormat = (mutation: Mutation, write: Write) =>
  piecesOf(mutation, write).some(
    ({ path, value }) => path === 's.n' || (path === 's' && (value as CellData)?.n !== undefined),
  );

/**
 * Whether `values` writes a cell whose number format `format` changes, neither
 * setting its value.
 *
 * Decision (agent, chat 2026-10-22): a style that names `n` changes the format
 * as a numfmt does, so it races as one. The cross-sheet fuzz found it (seed
 * 13, shrunk in cells.test.ts): a boolean under '@', with a '0%' style against
 * a style clear. A value-less style write of `n` and any concurrent write to
 * the cell that sets no value, such as a bold, are now refused too, where they
 * used to merge. Not taken: retyping in `retype`,
 * which cannot recover the type only the sender knew.
 */
function formatRace(format: Mutation, values: Mutation): boolean {
  const numfmt = format.id === cellIds.setNumfmt || format.id === cellIds.removeNumfmt;
  if ((!numfmt && !isValues(format)) || !isValues(values)) return false;
  const cells = new Set(
    writesOf(format)
      .filter((write) => changesFormat(format, write) && !setsValue(format, write))
      .map(cellKey),
  );
  return writesOf(values).some((write) => cells.has(cellKey(write)) && !setsValue(values, write));
}
export const isMove = (mutation: Mutation) => mutation.id === cellIds.moveRange;

/** Whether a cell write holds a formula: `f`, or a shared formula's `si`. */
export const hasFormula = (write: Write) => Boolean(write.value?.f || write.value?.si);

/**
 * The params key that marks a formula rewrite a command sent (see
 * names.markRewrites): never a Univer param, so `check` rejects one sent in,
 * and `transform` strips every one before it returns (see `unmarked`).
 */
export const rewriteKey = 'sync-transform.cells.rewrite';

export function unmarked(mutation: Mutation): Mutation {
  if (!Object.hasOwn(mutation.params, rewriteKey)) return mutation;
  const { [rewriteKey]: _, ...params } = mutation.params;
  return { id: mutation.id, params };
}

/**
 * Whether `rewrite`, marked as a command's formula rewrite, rewrites a cell
 * whose value or formula `other` replaces without a formula: a piece of its
 * write there sets `v`, `f` or `si`, or the whole cell, as a typed value
 * (`f: null`) or a clear does. A style or number format there overlaps no
 * piece of the rewrite and merges. A write with a formula is left to
 * names.refuseFormulaRaces, which keeps two edits of one name first-accepted.
 */
function rewriteMet(rewrite: Mutation, other: Mutation): boolean {
  if (!rewrite.params[rewriteKey]) return false;
  const cells = new Set(writesOf(rewrite).filter(hasFormula).map(cellKey));
  return writesOf(other).some(
    (write) =>
      cells.has(cellKey(write)) &&
      !hasFormula(write) &&
      piecesOf(other, write).some(({ path }) => path === '' || valuePaths.has(path)),
  );
}

/**
 * The params key that marks a half of a cut (see `perSheet`) as its `source`
 * or `target` half: never a Univer param, so `check` rejects one sent in, and
 * `transform` joins or strips every one before it returns (see `joinCuts`).
 */
export const halfKey = 'sync-transform.cells.half';

/**
 * A move to another sheet (a cut pasted there) as two moves, one per sheet:
 * one clears its source, one writes its target. Univer's handler writes each
 * side's cells on its own sheet, so the two do what the one does, and every
 * transform addresses one sheet. Each keeps its own range as both of its
 * ranges, so its area is that range alone (see shifts.areasOf). Each is
 * marked with `halfKey`, and `joinCuts` joins them again once transformed.
 *
 * Decision (owner, chat 2026-10-22): a cut and a concurrent edit of its source
 * or target are refused, like a drag's (see shifts.movesMeet). Not taken:
 * merging, which lost writes silently for drags.
 */
export function perSheet(mutation: Mutation): Mutation[] {
  const { from, to, fromRange, toRange } = mutation.params;
  if (!isMove(mutation) || from.subUnitId === to.subUnitId) return [mutation];
  const half = (
    kind: 'source' | 'target',
    subUnitId: string,
    range: IRange,
    fromValue: Matrix,
    toValue: Matrix,
  ) => ({
    id: mutation.id,
    params: {
      ...mutation.params,
      fromRange: range,
      toRange: range,
      from: { subUnitId, value: fromValue },
      to: { subUnitId, value: toValue },
      [halfKey]: { kind },
    },
  });
  return [
    half('source', from.subUnitId, fromRange, from.value, {}),
    half('target', to.subUnitId, toRange, {}, to.value),
  ];
}

/**
 * `mutations`, transformed, with each cut's halves (see `perSheet`) joined
 * again: a source half directly followed by the target half of the same cut
 * becomes one move to the other sheet, so a cut transformed once is still a
 * cut, and a removal of its target sheet is refused when it is transformed
 * again (see
 * `refuseCutsToRemoved`). Univer's handler writes `from` on its sheet, then
 * `to` on its own, as the two halves did in turn. A half whose partner was
 * dropped, by a removal of its sheet, stays a move within its sheet.
 *
 * Pairing by kind alone is enough: a source half survives only beside its own
 * target half. A removal of the target sheet is refused before the cut is
 * split (`refuseCutsToRemoved`), and nothing else drops a target half, so a
 * source half is always followed by its own target half, never another's.
 */
export function joinCuts(mutations: Mutation[]): Mutation[] {
  const result: Mutation[] = [];
  for (let i = 0; i < mutations.length; i++) {
    const { id, params } = mutations[i];
    if (!isMove(mutations[i]) || params[halfKey] === undefined) {
      result.push(mutations[i]);
      continue;
    }
    const { [halfKey]: half, ...plain } = params;
    const next = mutations[i + 1];
    const partner = next?.params[halfKey];
    if (half.kind === 'source' && partner?.kind === 'target') {
      Object.assign(plain, { toRange: next.params.toRange, to: next.params.to });
      i++;
    }
    result.push({ id, params: plain });
  }
  return result;
}

/** Whether `a` cuts cells to another sheet that `b` removes. */
function cutsToRemoved(a: Mutation, b: Mutation): boolean {
  if (!isMove(a) || b.id !== structureIds.removeSheet) return false;
  const { from, to } = a.params;
  return from.subUnitId !== to.subUnitId && b.params.subUnitId === to.subUnitId;
}

/**
 * Refuses a cut to another sheet and a concurrent removal of that sheet,
 * either way round, before `perSheet` splits the cut: the removal drops the
 * half that writes the target, and the half that clears the source would
 * still clear it, losing the cells on both screens.
 *
 * Decision (agent, chat 2026-10-22): refuse it (`'moved-cells'`), extending
 * the owner's rule above that a cut and an edit of its target are refused to
 * the most destructive edit of the target. A removal of the source sheet
 * still converges, with the cells on the target, since nothing is lost. Not
 * taken: letting it converge with the cells lost.
 */
export const refuseCutsToRemoved = (a: Mutation[], b: Mutation[]) =>
  refuseRaces(a, b, (x, y) => cutsToRemoved(x, y) || cutsToRemoved(y, x), 'moved-cells');

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
      params: { unitId, subUnitId, ...sentBy(a), cellValue: toMatrix(cells), derived: true },
    },
  ];
}

/**
 * Whether the winner's `winning` write lands the same after a write it covers
 * as without it: it forces its type (`t`), which Univer takes as it is
 * (getCellType), and sets the value, rich text and no formula (`f` or `si`),
 * so a covered write leaves nothing it reads, not even the `t`, `p`, `ft` or
 * `fd` Univer derives. A loser it covers can go.
 *
 * Decision (agent, chat 2026-10-23): drop such a loser. Replaying both after
 * the winner's doubled each editor commit under '@' past a stale clear, so
 * nine reached the growth cap. Not taken: dropping only a loser equal to the
 * winner, which still multiplied commits that took turns, and dropping any
 * covered loser: unforced, the type reads what it left, so `v: '1'` with
 * number format '0', over forced text under '@', lands text once and a number
 * twice.
 */
function settles(winning: Piece[]): boolean {
  const cell = assemble(winning);
  return !!cell?.t && cell.v != null && cell.p !== undefined && !cell.f && !cell.si;
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
 * replayed after it: past a losing whole cell, whole style, or whole border
 * where the winner writes an edge; a winning style past losing rich text,
 * which Univer restyles in a cell but not written with or after the style; a
 * style with a value, under which Univer drops rich text; a winning forced
 * type; and where the winner overwrites a losing style with an effect it
 * leaves (rich text a style restyled, which a number format or an override
 * leaves; a text format, which types the next value as text, losing what it
 * was; a type forced with a value, which sticks to the next). A loser the
 * winner covers goes where no replay applies, and where the winner `settles`
 * the cell whether one does or not.
 *
 * Decision (owner, chat 2026-10-22): plan the merged write per cell. Not taken:
 * always landing the loser whole and replaying the winner's writes to shared
 * cells after it, with no planner. It still needs rules for which format and
 * value pairs Univer types differently in each order, refuses those (1.3 to
 * 2.7 times as many format races), and doubles a write per replay, so a run of
 * writes to one cell reaches the growth cap.
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
  if (!kept && settles(winning)) return { layer: 'drop' };
  if (restyled || typed) return { layer: 'replay', write };
  if (!kept) return { layer: 'drop' };
  const ours = piecesOf(a, kept);
  const restylesOurs =
    isValues(b) && ours.some(({ path, value }) => path === 'p' && value) && winning.some(isStyle);
  if (restylesOurs) return { layer: 'replay', write: kept };
  if (isContent(ours)) return { layer: 'alone', write: kept };
  // A whole border merged with the winner's edges would drop its clear of the rest.
  const edges = winning.some(({ path }) => path.startsWith('s.bd.'));
  const apart =
    winning.some(isForced) ||
    ours.some(
      ({ path }) =>
        path === '' || (path === 's.bd' && edges) || (path === 's' && !a.params.isOverrideStyle),
    );
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
              ...sentBy(a),
              cellValue: toMatrix(writes),
              ...(whole && { isOverrideStyle: true }),
            },
          },
        ];
  // The winner's replayed writes are `a`'s output: they carry `a`'s `trigger`,
  // not `b`'s, and no mark of `b`'s formula rewrite (see names.markRewrites).
  const { trigger: _, [rewriteKey]: __, ...replayed } = b.params;
  const landed = [
    ...rebuild(a, layers.alone),
    ...values(layers.merged, false),
    ...values(layers.whole, true),
    ...rebuild({ id: b.id, params: { ...replayed, ...sentBy(a) } }, replay),
  ];
  return [...landed, ...retype(a, b, side, landed)];
}

const typeOnly = (write: Write) => write.value !== null && Object.keys(write.value).join() === 't';
/** A `t`-only write of forced text, which RemoveNumfmt makes for a cell with no value. */
const forcesText = (write: Write) => typeOnly(write) && write.value.t === 4;

/** Whether `a` writes a cell `b` writes. */
export function meets(a: Mutation, b: Mutation): boolean {
  const cells = new Set(writesOf(b).map(cellKey));
  return writesOf(a).some((write) => cells.has(cellKey(write)));
}

/**
 * Univer ignores a `t`-only write to a cell with no value, and a value written
 * after it is typed afresh, so a concurrent write of `v` cancels a `t`-only
 * cell whichever side wins; the same write after the value would force its
 * type. RemoveNumfmt's companion write is the `t`-only kind. Forced text
 * sticks to the next value instead, and RemoveNumfmt forces it only where the
 * cell holds no value, which a concurrent write to the cell may change, so any
 * such write cancels it. Returns `mutation` without the writes `other`
 * cancels, or undefined when it cancels them all.
 */
function cancelled(mutation: Mutation, other: Mutation): Mutation | undefined {
  if (!isValues(mutation)) return mutation;
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
      )[0]
    : mutation;
}

function transform(a: Mutation, b: Mutation, rank: Side): Mutation[] {
  // A move and an edit in its area are refused (see shifts.movesMeet).
  if (isMove(a) || isMove(b)) {
    if (movesMeet(a, b)) throw new RefusedEditError('moved-cells');
    return [a];
  }
  if (isGhost(a) || isGhost(b) || !meets(a, b)) return [a];
  // Decision (owner, chat 2026-10-22): see names.refuseFormulaRaces.
  if (rewriteMet(a, b) || rewriteMet(b, a)) throw new RefusedEditError('formula-race');
  // Decision (owner, chat 2026-10-20): a number-format change and a concurrent
  // write to one of its cells that sets no value, such as a style or a retype,
  // are refused. A write under text format '@' turns the cell's value to text,
  // losing its type, so a transform that sees only the two edits cannot make
  // both orders agree. Not taken: refusing every write to the cell, which
  // refuses values that do converge, and a sender that sends the type it
  // writes (SPN-058).
  if (formatRace(a, b) || formatRace(b, a)) throw new RefusedEditError('format-race');
  // A retype replays content already written, so it loses to any edit of the cell.
  const side = !a.params.derived === !b.params.derived ? rank : a.params.derived ? 'right' : 'left';
  const mine = cancelled(a, b);
  const theirs = cancelled(b, a);
  // Diagnostics (SPN-032, not built): `sync.edit.dropped`, rule
  // 'cell-overwritten', when `haunted` adds a ghost.
  if (!mine || !theirs) return haunted(a, mine ? [mine] : []);
  return haunted(a, conflict(mine, theirs, side));
}

/**
 * `a`'s transform `result`, and a ghost of the cells of `a` it no longer
 * writes, which a concurrent write overwrote. Those writes still meet any move
 * later in the other sequence, as a shift command's own clear of the cells it
 * deletes comes before its move, so the move refuses them as it would refuse
 * `a` (see shifts.movesMeet). A ghost is a mutation of its own id,
 * `ghostId`, with the lost cells as a SetRangeValues would name them, so no
 * flag in a Univer mutation's params can be mistaken for one. It writes
 * nothing and meets only moves; `transform` drops it from what it returns.
 */
function haunted(a: Mutation, result: Mutation[]): Mutation[] {
  const kept = new Set(result.flatMap((mutation) => writesOf(mutation).map(cellKey)));
  const lost = writesOf(a).filter((write) => !kept.has(cellKey(write)));
  if (lost.length === 0) return result;
  const { unitId, subUnitId } = a.params;
  const cellValue = toMatrix(lost.map((write) => ({ ...write, value: null })));
  return [...result, { id: ghostId, params: { unitId, subUnitId, cellValue } }];
}

/**
 * Univer's row and column handlers shift the cell matrix; cells in removed
 * lines go. A move whose area the edit cuts is refused (see shifts.refuseCut).
 */
function remap(mutation: Mutation, axis: Axis, edit: AxisEdit): Mutation[] {
  if (isMove(mutation)) {
    refuseCut(mutation, axis, edit);
    return [remapMove(mutation, axis, edit)];
  }
  return rebuild(
    mutation,
    writesOf(mutation).flatMap((write) => {
      const index = mapIndex(edit, axis === 'row' ? write.row : write.col);
      if (index === null) return [];
      return [axis === 'row' ? { ...write, row: index } : { ...write, col: index }];
    }),
  );
}

export const cells: Family = { ids: Object.values(cellIds), remap, transform };
