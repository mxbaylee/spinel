import type { IRange } from '@univerjs/core';
import { mapIndex, transformAxis } from './axis.ts';
import type { AxisEdit } from './axis.ts';
import { axisKeys } from './family.ts';
import type { Axis } from './family.ts';
import {
  bounds,
  cellKey,
  edited,
  isMove,
  rebuild,
  remapMove,
  toMatrix,
  writesOf,
} from './cells.ts';
import type { Cell, Write } from './cells.ts';
import { mergeIds } from './merges.ts';
import { RefusedEditError } from './types.ts';
import type { Mutation, Side } from './types.ts';

/**
 * Inserting or deleting cells with a shift (InsertRangeMoveDown/Right,
 * DeleteRangeMoveUp/Left) sends a MoveRange of every cell after the range in
 * its band of columns (or rows). The sender marks it with `shift`, which the
 * transforms, being stateless, could not tell apart from a dragged range: the
 * axis it shifts along, insert or remove, and the range's start and size on
 * that axis. Within the band it is a row (or column) edit, so it reuses
 * axis.ts; outside it, nothing moves.
 */
export interface Shift {
  axis: Axis;
  kind: 'insert' | 'remove';
  at: number;
  count: number;
  /**
   * Set by the transforms, never by a sender: the lines this shift inserts are
   * the ones a concurrent shift command added at the sheet's end, which that
   * command's own shift then fills.
   */
  tail?: true;
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

/**
 * The shift `move` past the line edit `edit` along `axis`, `parts` being how
 * the edit cuts a MoveRange. Across the band the band maps through the edit,
 * and an insert inside it splits it in two. Along the shift, an edit of lines
 * before its start moves it whole.
 *
 * Decision (owner, chat 2026-10-20): a row or column edit along a shift, at or
 * past its start, is refused: it would cut the lines the shift moves. Lines
 * inserted past everything it moves are kept, being where a shift at the
 * sheet's end adds its own (see `pastTail`).
 */
export function remark(
  move: Mutation,
  axis: Axis,
  edit: AxisEdit,
  parts: (move: Mutation) => Mutation[],
): Mutation[] {
  const shift = shiftOf(move)!;
  if (axis === shift.axis) {
    refuseCut(move, { axis, edit });
    return pastTail(move, shift, axis, edit) ?? mark(parts(move));
  }
  const [first, last] = span(move.params.fromRange, axis);
  if (edit.kind !== 'insert' || edit.at <= first || edit.at > last) return mark(parts(move));
  return [within(move, first, edit.at - 1), within(move, edit.at, last)].flatMap((piece) =>
    mark(parts(piece)),
  );
}

/**
 * Refuses the line edit `edit` along the shift `move`'s axis if it touches the
 * lines from the shift's start to the last it moves, unless it inserts past
 * the shift's sources (see `pastTail`). Either way round, as `remark` does.
 */
export function refuseCut(move: Mutation, { axis, edit }: { axis: Axis; edit: AxisEdit }): void {
  const shift = shiftOf(move);
  if (!shift || axis !== shift.axis || pastTail(move, shift, axis, edit)) return;
  const end = Math.max(span(move.params.fromRange, axis)[1], span(move.params.toRange, axis)[1]);
  const [lo, hi] =
    edit.kind === 'move'
      ? [Math.min(edit.from, edit.to), Math.max(edit.from + edit.count, edit.to) - 1]
      : [edit.at, edit.kind === 'insert' ? edit.at : edit.at + edit.count - 1];
  if (lo <= end && hi >= shift.at) throw new RefusedEditError('overlapping-moves');
}

/**
 * A shift's one part re-marked, or the parts as moves when the edit moved its
 * cells apart. A move that can no longer be marked moves only some of its band.
 */
function mark(parts: Mutation[]): Mutation[] {
  const unmark = (part: Mutation): Mutation => {
    const { shift: _, ...params } = part.params;
    return { ...part, params };
  };
  if (parts.length !== 1) return parts.map(unmark);
  const [part] = parts;
  const shift = shiftOf(part)!;
  const [start] = axisKeys(shift.axis);
  const { fromRange: from, toRange: to } = part.params;
  const at = shift.kind === 'insert' ? from[start] : to[start];
  const count = Math.abs(to[start] - from[start]);
  const params = { ...part.params, shift: { ...shift, at, count } };
  return [markError({ ...part, params }) === undefined ? { ...part, params } : unmark(part)];
}

/**
 * An insert shift past lines inserted among its targets but past its sources:
 * the shift whole, then a shift of the targets from the inserted lines on,
 * which carries them past the lines. Content past the shift's sources is
 * empty to its sender, so this lands as the cut pieces would, and both stay
 * shifts.
 */
function pastTail(
  move: Mutation,
  shift: Shift,
  axis: Axis,
  edit: AxisEdit,
): Mutation[] | undefined {
  if (axis !== shift.axis || edit.kind !== 'insert' || shift.kind !== 'insert') return undefined;
  const [, end] = axisKeys(axis);
  const { fromRange: from, toRange: to } = move.params;
  if (edit.at <= from[end] || edit.at > to[end]) return undefined;
  const lines = new Map<number, Line>();
  for (let index = edit.at; index <= to[end]; index++) {
    lines.set(index, lineOf(move.params.to.value ?? {}, axis, index));
  }
  const tail = { axis, kind: 'insert', at: edit.at, count: edit.count, tail: true } as const;
  return [move, stepMove(move, tail, [edit.at, to[end]], lines)];
}

/**
 * Where the cell at `cell` is after the shift `shift`, if its move covers it:
 * as a line edit moves it, or null if the shift removes it. The move stops at
 * the sheet's edge, and a cell past it stays where it is.
 */
function shifted(move: Mutation, shift: Shift, cell: Cell): Cell | null {
  const { fromRange, toRange } = move.params as { fromRange: IRange; toRange: IRange };
  if (removes(move, shift, cell)) return null;
  if (!inRange(fromRange, cell) && !inRange(toRange, cell)) return cell;
  const moved = mapIndex(shift, shift.axis === 'row' ? cell.row : cell.col);
  if (moved === null) return null;
  return shift.axis === 'row' ? { ...cell, row: moved } : { ...cell, col: moved };
}

/**
 * An added merge past a shift, or the shift past it. A merge the shift moves
 * whole moves with it, and one outside its cells stays; past the merge the
 * shift moves it as its command would have. A removal of a merge the shift
 * moves follows it, and the shift passes the removal: its command already
 * removes and re-adds the merges it moves, and the two meet there.
 *
 * Decision (owner, chat 2026-10-20): a merge across the band's edge or the
 * shift's start is dropped on both screens, as `merges.cutBy` drops a merge a
 * row edit cuts.
 */
export function pastMerge(a: Mutation, b: Mutation): Mutation[] {
  const [move, merge] = shiftOf(a) ? [a, b] : [b, a];
  const shift = shiftOf(move)!;
  const kept: IRange[] = [];
  const [cut, from, to]: IRange[][] = [[], [], []];
  for (const range of merge.params.ranges as IRange[]) {
    const offsets = new Set<string>();
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startColumn; col <= range.endColumn; col++) {
        const cell = shifted(move, shift, { row, col });
        offsets.add(cell ? `${cell.row - row}:${cell.col - col}` : 'gone');
      }
    }
    const [offset] = offsets;
    if (offsets.size > 1 || offset === 'gone') cut.push(range);
    else if (offset === '0:0') kept.push(range);
    else {
      const [rows, cols] = offset.split(':').map(Number);
      const moved = {
        ...range,
        startRow: range.startRow + rows,
        endRow: range.endRow + rows,
        startColumn: range.startColumn + cols,
        endColumn: range.endColumn + cols,
      };
      from.push(range);
      to.push(moved);
    }
  }
  const merges = (id: string, ranges: IRange[]) =>
    ranges.length === 0 ? [] : [{ id, params: { ...merge.params, ranges } }];
  if (merge.id === mergeIds.remove)
    return a === move ? [a] : merges(merge.id, [...kept, ...cut, ...to]);
  if (a === merge) return merges(mergeIds.add, [...kept, ...to]);
  return [
    ...merges(mergeIds.remove, cut),
    move,
    ...merges(mergeIds.remove, from),
    ...merges(mergeIds.add, to),
  ];
}

/**
 * Whether the remove shift `shift` deletes `cell`: one of the lines it removes,
 * within its band, though past its target when it moves few lines.
 */
function removes(move: Mutation, { axis, kind, at, count }: Shift, cell: Cell): boolean {
  const [first, last] = span(move.params.fromRange, other(axis));
  const [index, across] = axis === 'row' ? [cell.row, cell.col] : [cell.col, cell.row];
  return (
    kind === 'remove' && across >= first && across <= last && index >= at && index < at + count
  );
}

/**
 * `a` past `b` when either is a marked shift, or undefined for a shift and a
 * dragged range, which transform as moves. A shift moves cells it does not
 * write, so it meets an edit by its band, not its footprint.
 */
export function pastShift(a: Mutation, b: Mutation, side: Side): Mutation[] | undefined {
  const other = shiftOf(a) ? b : a;
  if (!shiftOf(a) && !shiftOf(b)) return undefined;
  if (shiftOf(other)) return pastPeer(a, b, side);
  return isMove(other) ? pastDrag(a, b) : pastEdit(a, b);
}

/**
 * A shift and a dragged range commute while each of the drag's ranges shifts
 * whole: the drag moves its ranges where the shift takes them, and the shift
 * carries what the drag left in the cells it moves, then lands the drag's
 * writes to cells it only writes where those cells would go.
 *
 * Decision (owner, chat 2026-10-20): a drag whose range the band's edge or the
 * shift's start cuts is refused; part of it would shift and part not.
 */
function pastDrag(a: Mutation, b: Mutation): Mutation[] {
  const [move, drag] = shiftOf(a) ? [a, b] : [b, a];
  const shift = shiftOf(move)!;
  const land = (write: Write): Write => ({ ...write, ...shifted(move, shift, write)! });
  // A MoveRange moves only the cells its matrices name, so those are its ranges.
  const offsets = (['from', 'to'] as const).map((slot) => {
    const writes = writesOf(drag).filter((write) => write.slot === slot);
    return [
      ...new Set(
        writes.map((write) => {
          const cell = shifted(move, shift, write);
          return cell ? `${cell.row - write.row}:${cell.col - write.col}` : 'gone';
        }),
      ),
    ];
  });
  if (offsets.some((seen) => seen.length > 1 || seen[0] === 'gone')) {
    throw new RefusedEditError('overlapping-moves');
  }
  if (offsets.every(([offset = '0:0']) => offset === '0:0')) return [a];
  if (a === drag) return remapMove(drag, land);
  const to = structuredClone(move.params.to.value ?? {});
  const after = new Map<string, Write>();
  for (const write of writesOf(drag)) {
    const cell = land(write);
    if (cellKey(cell) === cellKey(write)) continue;
    if (inRange(move.params.fromRange, write)) (to[cell.row] ??= {})[cell.col] = write.value;
    else after.set(cellKey(cell), cell);
  }
  const folded = { ...move, params: { ...move.params, to: { ...move.params.to, value: to } } };
  if (after.size === 0) return [folded];
  // A MoveRange with no sources writes whole cells, as the drag did.
  const writes = [...after.values()];
  const p = drag.params;
  const copy = {
    id: drag.id,
    params: {
      ...p,
      fromRange: bounds(writes),
      toRange: bounds(writes),
      from: { ...p.from, value: {} },
      to: { ...p.to, value: toMatrix(writes) },
    },
  };
  return [folded, copy];
}

/**
 * A cell edit and a concurrent shift commute, so neither side wins: the edit
 * lands where the shift takes its cell, or goes with a cell the shift removes.
 * Past the edit, the shift lands an edit of a cell it moves within the content
 * it writes, and an edit of a cell it only writes after itself, where that
 * cell would go. Where cells go comes from the mark, not the matrices, which
 * compacting leaves without empty targets the move also clears.
 */
function pastEdit(a: Mutation, b: Mutation): Mutation[] {
  const [move, edit] = isMove(a) ? [a, b] : [b, a];
  const shift = shiftOf(move)!;
  const landing = writesOf(edit).map((write): [Write, Cell | null] => [
    write,
    shifted(move, shift, write),
  ]);
  if (a === edit) {
    return rebuild(
      edit,
      landing.flatMap(([write, cell]) => (cell ? [{ ...write, ...cell }] : [])),
    );
  }
  const to = structuredClone(move.params.to.value ?? {});
  const from = structuredClone(move.params.from.value ?? {});
  const after: Write[] = [];
  for (const [write, cell] of landing) {
    // The sender cleared the lines it removes before the edit; the move clears
    // the edit there too, past its target, so the delete takes it.
    if (!cell && !inRange(move.params.toRange, write)) (from[write.row] ??= {})[write.col] = null;
    if (!cell || cellKey(cell) === cellKey(write)) continue;
    if (!inRange(move.params.fromRange, write)) {
      after.push({ ...write, ...cell });
      continue;
    }
    (to[cell.row] ??= {})[cell.col] = edited(to[cell.row]?.[cell.col] ?? null, edit, write);
    // The write's old cell may be one the sender had empty, which the move does not clear.
    (from[write.row] ??= {})[write.col] ??= null;
  }
  const params = { ...move.params, from: { ...move.params.from, value: from } };
  const folded = { ...move, params: { ...params, to: { ...move.params.to, value: to } } };
  return [folded, ...rebuild(edit, after)];
}

const inRange = (range: IRange, { row, col }: Cell) =>
  row >= range.startRow &&
  row <= range.endRow &&
  col >= range.startColumn &&
  col <= range.endColumn;

/** The span of `range` along `axis`, first and last. */
const span = (range: IRange, axis: Axis): [number, number] =>
  axis === 'row' ? [range.startRow, range.endRow] : [range.startColumn, range.endColumn];

/** Whether two lines hold the same cells, an empty cell as no cell. */
function sameLine(x: Line, y: Line): boolean {
  const cells = (line: Line) =>
    Object.entries(line)
      .filter(([, cell]) => cell !== null && cell !== undefined)
      .sort(([i], [j]) => Number(i) - Number(j));
  return stable(cells(x)) === stable(cells(y));
}

/** JSON with object keys sorted, so equal values print the same. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([i], [j]) => (i < j ? -1 : 1)))
      : v,
  );

/** One row (or column) of a band: its cells by their index across the band. */
type Line = Record<number, unknown>;

function lineOf(matrix: Record<number, Record<number, unknown>>, axis: Axis, index: number): Line {
  if (axis === 'row') return { ...matrix[index] };
  const line: Line = {};
  for (const [row, cells] of Object.entries(matrix)) {
    if (cells[index] !== undefined) line[Number(row)] = cells[index];
  }
  return line;
}

/** The shift that undoes the tail `tail` of `move`: its targets back up onto the lines it inserts. */
function closeUp(move: Mutation, tail: Shift): Mutation {
  const [, end] = axisKeys(tail.axis);
  const last = move.params.toRange[end];
  const lines = new Map<number, Line>();
  for (let index = tail.at + tail.count; index <= last; index++) {
    lines.set(index, lineOf(move.params.to.value ?? {}, tail.axis, index));
  }
  const removal = { axis: tail.axis, kind: 'remove', at: tail.at, count: tail.count } as const;
  return stepMove(move, removal, [tail.at + tail.count, last], lines);
}

/** A shift past a concurrent shift: bands that miss pass, crossing ones are refused. */
function pastPeer(a: Mutation, b: Mutation, side: Side): Mutation[] {
  const [self, peer] = [shiftOf(a)!, shiftOf(b)!];
  const across = (move: Mutation, axis: Axis) => span(move.params.fromRange, other(axis));
  const [first, last] = across(a, self.axis);
  const [peerFirst, peerLast] = across(b, peer.axis);
  if (a.params.to.subUnitId !== b.params.to.subUnitId) return [a];
  if (self.axis !== peer.axis) {
    // Each shift moves and writes only its band from its `at` on, to the
    // sheet's edge, whatever its matrices hold (seed 229).
    if (last < peer.at || peerLast < self.at) return [a];
    // Decision (owner, chat 2026-10-20): shifts along different axes whose
    // cells meet are refused.
    throw new RefusedEditError('overlapping-moves');
  }
  const [lo, hi] = [Math.max(first, peerFirst), Math.min(last, peerLast)];
  if (lo > hi) return [a];
  // Decision (owner, chat 2026-10-20): bands that partly overlap split. Each
  // line of a band shifts on its own, so the lines only `a` shifts pass, and
  // the lines both shift merge.
  const own = [
    [first, lo - 1],
    [hi + 1, last],
  ].flatMap(([from, to]) => (from <= to ? [within(a, from, to)] : []));
  // A tail stands for the lines the peer's shift fills; past the peer's band
  // those lines are a plain inserted row that writes may land in, so a tail
  // the peer's band does not cover has no merge (seed 107).
  if ((self.tail && own.length) || (peer.tail && (peerFirst < lo || peerLast > hi)))
    throw new RefusedEditError('overlapping-moves');
  return [...own, ...pastSameBand(within(a, lo, hi), within(b, lo, hi), side)];
}

/** `move` cut to the lines `first` to `last` across its band. */
function within(move: Mutation, first: number, last: number): Mutation {
  const axis = shiftOf(move)!.axis;
  const [lo, hi] = axisKeys(other(axis));
  const keep = (matrix: Record<number, Record<number, unknown>> = {}) => {
    const kept: Record<number, Record<number, unknown>> = {};
    for (const [row, cells] of Object.entries(matrix)) {
      for (const [col, cell] of Object.entries(cells)) {
        const index = Number(axis === 'row' ? col : row);
        if (index >= first && index <= last) (kept[Number(row)] ??= {})[Number(col)] = cell;
      }
    }
    return kept;
  };
  const p = move.params;
  return {
    ...move,
    params: {
      ...p,
      fromRange: { ...p.fromRange, [lo]: first, [hi]: last },
      toRange: { ...p.toRange, [lo]: first, [hi]: last },
      from: { ...p.from, value: keep(p.from.value) },
      to: { ...p.to, value: keep(p.to.value) },
    },
  };
}

/**
 * A shift past a concurrent shift of the same band: a line edit of it, so
 * transformAxis merges the two as it does row edits, and each step it returns
 * becomes a shift of its own. A MoveRange writes the content it carries, not
 * what its cells hold, so each step's content is rebuilt from what both moves
 * carry, the winner's first.
 */
function pastSameBand(a: Mutation, b: Mutation, side: Side): Mutation[] {
  const [self, peer] = [shiftOf(a)!, shiftOf(b)!];
  // The peer's own shift fills the lines a tail stands for, so the tail goes,
  // and past a tail the peer first closes the lines up again.
  if (self.tail) return [];
  if (peer.tail) return [closeUp(b, peer), a];
  const { axis } = self;
  const [winner, loser] = side === 'left' ? [a, b] : [b, a];
  const carriedBy = (move: Mutation, index: number): Line | undefined => {
    const [start, end] = span(move.params.fromRange, axis);
    const at = mapIndex(shiftOf(move)!, index);
    // A line past the content it moves is one its sender saw empty.
    if (index > end) return {};
    if (index < start || at === null) return undefined;
    return lineOf(move.params.to.value ?? {}, axis, at);
  };
  const carried = (index: number): Line => {
    const [won, lost] = [carriedBy(winner, index), carriedBy(loser, index)];
    // Each side's own shift already wrote what it carries, so one that
    // carries a line differently than the other, after writes in its own
    // sequence, has no merge both sides agree on.
    if (won && lost && !sameLine(won, lost)) throw new RefusedEditError('overlapping-moves');
    return won ?? lost ?? {};
  };
  // The band's lines where the peer leaves them.
  let lines = new Map<number, Line>();
  const end = Math.max(span(a.params.fromRange, axis)[1], span(b.params.fromRange, axis)[1]);
  for (let index = Math.min(self.at, peer.at); index <= end; index++) {
    const at = mapIndex(peer, index);
    if (at !== null) lines.set(at, carried(index));
  }
  const steps: Mutation[] = [];
  for (const step of transformAxis(self, peer, side)) {
    if (step.kind === 'move') continue;
    const edit = { kind: step.kind, at: step.at, count: step.count } as const;
    // The lines either move carries, to the last; past them the band is empty.
    // Each move also covers the cells it inserts or deletes, to clear them.
    const known = Math.max(-1, ...lines.keys());
    const start = edit.kind === 'insert' ? edit.at : edit.at + edit.count;
    const end = Math.max(known, start + edit.count - 1);
    if (end >= start) steps.push(stepMove(a, { axis, ...edit }, [start, end], lines));
    lines = new Map(
      [...lines].flatMap(([at, line]): [number, Line][] => {
        const moved = mapIndex(edit, at);
        return moved === null ? [] : [[moved, line]];
      }),
    );
  }
  return steps;
}

/** The MoveRange of one merged step `shift`: lines `start` to `end` of `move`'s band, carrying `lines`. */
function stepMove(
  move: Mutation,
  shift: Shift,
  [start, end]: [number, number],
  lines: Map<number, Line>,
): Mutation {
  const [first, last] = span(move.params.fromRange, other(shift.axis));
  const by = shift.kind === 'insert' ? shift.count : -shift.count;
  const from: Record<number, Record<number, unknown>> = {};
  const to: Record<number, Record<number, unknown>> = {};
  const put = (matrix: typeof from, index: number, cross: number, cell: unknown) => {
    const [row, col] = shift.axis === 'row' ? [index, cross] : [cross, index];
    (matrix[row] ??= {})[col] = cell;
  };
  for (let index = start; index <= end; index++) {
    const line = lines.get(index) ?? {};
    for (let cross = first; cross <= last; cross++) {
      put(from, index, cross, null);
      put(to, index + by, cross, line[cross] ?? null);
    }
  }
  const range = (lo: number, hi: number): IRange =>
    shift.axis === 'row'
      ? { ...move.params.fromRange, startRow: lo, endRow: hi, startColumn: first, endColumn: last }
      : { ...move.params.fromRange, startRow: first, endRow: last, startColumn: lo, endColumn: hi };
  const p = move.params;
  return {
    id: move.id,
    params: {
      ...p,
      fromRange: range(start, end),
      toRange: range(start + by, end + by),
      from: { ...p.from, value: from },
      to: { ...p.to, value: to },
      shift,
    },
  };
}
