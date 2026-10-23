import type { IRange } from '@univerjs/core';
import { mapIndex } from './axis.ts';
import type { AxisEdit } from './axis.ts';
import { axisKeys } from './family.ts';
import type { Axis } from './family.ts';
import { isMove, meets, writesOf } from './cells.ts';
import type { Cell } from './cells.ts';
import { RefusedEditError } from './types.ts';
import type { Mutation } from './types.ts';

/**
 * Inserting or deleting cells with a shift (InsertRangeMoveDown/Right,
 * DeleteRangeMoveUp/Left) sends a MoveRange of every cell after the range in
 * its band of columns (or rows). The sender marks it with `shift`, which the
 * transforms, being stateless, could not tell apart from a dragged range: the
 * axis it shifts along, insert or remove, and the range's start and size on
 * that axis. A shift moves cells it does not write, so its area (see
 * `areasOf`) is not a drag's.
 */
interface Shift {
  axis: Axis;
  kind: 'insert' | 'remove';
  at: number;
  count: number;
}

/** The shift a MoveRange is marked as, or undefined for a dragged range. */
export const shiftOf = (mutation: Mutation): Shift | undefined =>
  isMove(mutation) ? mutation.params.shift : undefined;

const other = (axis: Axis): Axis => (axis === 'row' ? 'column' : 'row');

/** Why a MoveRange's `shift` disagrees with its ranges, or undefined if it agrees. */
export function markError(move: Mutation): string | undefined {
  const shift = shiftOf(move);
  if (shift === undefined) return undefined;
  const { axis, kind, at, count } = shift;
  if (axis !== 'row' && axis !== 'column') return 'its axis must be row or column';
  if (kind !== 'insert' && kind !== 'remove') return 'its kind must be insert or remove';
  if (!Number.isInteger(at) || at < 0 || !Number.isInteger(count) || count < 1) {
    return 'it needs a whole `at` and a positive whole `count`';
  }
  if (move.params.from.subUnitId !== move.params.to.subUnitId)
    return 'it moves cells within one sheet';
  if (Object.keys(move.params.from.value ?? {}).length === 0)
    return 'a move with no sources is no shift';
  const { fromRange: from, toRange: to } = move.params;
  const [start, end] = axisKeys(axis);
  const [first, last] = axisKeys(other(axis));
  if (from[first] !== to[first] || from[last] !== to[last]) {
    return 'its ranges must cover the same band';
  }
  const [source, target] = kind === 'insert' ? [from, to] : [to, from];
  if (source[start] !== at || target[start] !== at + count || target[end] - source[end] !== count) {
    return `its ranges must move the cells from ${at} on by ${count}`;
  }
  return undefined;
}

/** A block of cells by its first and last row and column; a shift's runs to Infinity. */
interface Area {
  rows: [number, number];
  cols: [number, number];
}

const areaOf = (range: IRange): Area => ({
  rows: [range.startRow, range.endRow],
  cols: [range.startColumn, range.endColumn],
});

/**
 * Where a move moves or writes cells: a drag's source and target, and a
 * shift's band from its `at` to the sheet's edge. Univer's MoveRange stops at
 * the band's last cell with content, but the cells past it are empty only on
 * the sender's screen, so the area does not stop there (seed 229).
 *
 * Across the shift the area is only the band the MoveRange names, and Univer
 * clips that band at the sheet's last line with content. A delete that reaches
 * the content's last line sends no MoveRange at all.
 *
 * Decision (owner, chat 2026-10-21): a concurrent write beyond the content in
 * the part the MoveRange leaves out is therefore merged, not refused. It stays
 * where it was made rather than moving with the shift, so it sits off from its
 * neighbours by the shift. Both screens agree and nothing is lost (README,
 * "Known limits"). Not taken: a `shift` mark that carries the command's whole
 * band and is sent even with no MoveRange, which would make SPN-058's sender
 * read Univer's command params rather than only its mutations.
 */
function areasOf(move: Mutation): Area[] {
  const shift = shiftOf(move);
  const { fromRange, toRange } = move.params as { fromRange: IRange; toRange: IRange };
  if (!shift) return [areaOf(fromRange), areaOf(toRange)];
  const band = areaOf(fromRange);
  const strip: [number, number] = [shift.at, Infinity];
  return [shift.axis === 'row' ? { ...band, rows: strip } : { ...band, cols: strip }];
}

const overlap = ([lo, hi]: [number, number], [first, last]: [number, number]) =>
  lo <= last && first <= hi;
const meet = (x: Area, y: Area) => overlap(x.rows, y.rows) && overlap(x.cols, y.cols);
const inArea = (area: Area, { row, col }: Cell) =>
  meet(area, { rows: [row, row], cols: [col, col] });

/**
 * Whether a move and a concurrent cell mutation, `a` and `b` in either order,
 * meet in a move's area: a drag's cells and the other's, a shift's area and
 * an edit's or a drag's cells, or two shifts' areas.
 *
 * Decision (owner, chat 2026-10-21): a dragged range or a shift and any
 * concurrent edit in its area are refused, not merged: cell values, styles and
 * number formats, another drag or shift, and a row or column edit that cuts
 * the area (see `refuseCut`). The server refuses the later one and its sender
 * reloads. Merging moved cells with concurrent edits lost writes silently in
 * rare races; a refusal is visible, and the person can redo the edit. Edits
 * outside the area pass both ways unchanged, and row and column edits wholly
 * outside it move the move. Not taken: transforming a shift as a row or column
 * edit of its band.
 *
 * A merge edit in a shift's area is an edit there, so it is refused too (see
 * `mergeMeets`). A drag and a merge edit pass each other, as before.
 */
export function movesMeet(a: Mutation, b: Mutation): boolean {
  const strips = [a, b].filter((mutation) => shiftOf(mutation));
  if (strips.length === 0) return meets(a, b);
  const [area] = areasOf(strips[0]);
  if (strips.length === 2) return meet(area, areasOf(strips[1])[0]);
  return writesOf(strips[0] === a ? b : a).some((write) => inArea(area, write));
}

/** Whether a shift and a concurrent merge edit meet: a merged range in its area. */
export function mergeMeets(move: Mutation, merge: Mutation): boolean {
  if (!shiftOf(move)) return false;
  const [area] = areasOf(move);
  return (merge.params.ranges as IRange[]).some((range) => meet(area, areaOf(range)));
}

/**
 * Whether `edit` cuts the lines `lo` to `hi`: removes any of them, or moves
 * them other than all together. Past the last line it touches, the edit moves
 * every line alike, so lines are tested only that far.
 */
function cuts(edit: AxisEdit, lo: number, hi: number): boolean {
  const reach =
    edit.kind === 'insert'
      ? edit.at
      : edit.kind === 'remove'
        ? edit.at + edit.count
        : Math.max(edit.from + edit.count, edit.to);
  const first = mapIndex(edit, lo);
  if (first === null) return true;
  for (let index = lo + 1; index <= Math.min(hi, reach); index++) {
    if (mapIndex(edit, index) !== first + index - lo) return true;
  }
  return false;
}

/** Refuses a row or column edit that cuts a move's area, either way round (see `movesMeet`). */
export function refuseCut(move: Mutation, axis: Axis, edit: AxisEdit): void {
  if (!isMove(move)) return;
  for (const area of areasOf(move)) {
    const [lo, hi] = axis === 'row' ? area.rows : area.cols;
    if (cuts(edit, lo, hi)) throw new RefusedEditError('moved-cells');
  }
}

/**
 * `move` past a row or column edit that cuts none of its area (see
 * `refuseCut`): its ranges, the cells in them and a shift's `at` go where the
 * edit moves them.
 */
export function remapMove(move: Mutation, axis: Axis, edit: AxisEdit): Mutation {
  const [start, end] = axisKeys(axis);
  const range = (r: IRange): IRange => ({
    ...r,
    [start]: mapIndex(edit, r[start])!,
    [end]: mapIndex(edit, r[end])!,
  });
  const matrix = (cells: Record<number, Record<number, unknown>> = {}) => {
    const moved: Record<number, Record<number, unknown>> = {};
    for (const [row, line] of Object.entries(cells)) {
      for (const [col, cell] of Object.entries(line ?? {})) {
        const [r, c] = [Number(row), Number(col)];
        const index = mapIndex(edit, axis === 'row' ? r : c);
        if (index === null) continue;
        const [to, across] = axis === 'row' ? [index, c] : [r, index];
        (moved[to] ??= {})[across] = cell;
      }
    }
    return moved;
  };
  const p = move.params;
  const shift = shiftOf(move);
  return {
    id: move.id,
    params: {
      ...p,
      fromRange: range(p.fromRange),
      toRange: range(p.toRange),
      from: { ...p.from, value: matrix(p.from.value) },
      to: { ...p.to, value: matrix(p.to.value) },
      ...(shift?.axis === axis && { shift: { ...shift, at: mapIndex(edit, shift.at)! } }),
    },
  };
}
