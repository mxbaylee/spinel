import { Rectangle } from '@univerjs/core';
import type { IRange } from '@univerjs/core';
import { mapIndex } from './axis.ts';
import type { AxisEdit } from './axis.ts';
import { axisKeys } from './family.ts';
import type { Axis, Family } from './family.ts';
import { observeTransform } from './types.ts';
import type { Mutation, Side, TransformObserver } from './types.ts';

export const mergeIds = {
  add: 'sheet.mutation.add-worksheet-merge',
  remove: 'sheet.mutation.remove-worksheet-merge',
} as const;

/**
 * How far MergeCellController's mutation listener, which runs on every client,
 * shifts a merge for a row or column edit: it moves whole, and only when the
 * edit lies entirely before it (or a move jumps it). A merge the edit cuts
 * through keeps its place and size. The listener tests a move against the
 * source rows across every column; Univer's commands always move whole rows.
 */
function shift(range: IRange, axis: Axis, edit: AxisEdit): number {
  const [start, end] = axisKeys(axis);
  const first = range[start];
  const last = range[end];
  if (edit.kind === 'insert') return edit.at <= first ? edit.count : 0;
  if (edit.kind === 'remove') return edit.at + edit.count - 1 < first ? -edit.count : 0;
  const { from, count, to } = edit;
  if (from <= last && from + count - 1 >= first) return 0;
  if (from < first && to > last) return -count;
  if (from > last && to <= first) return count;
  return 0;
}

/** `mutation`'s target with these ranges, or nothing if there are none. */
const withRanges = (mutation: Mutation, id: string, ranges: IRange[]): Mutation[] =>
  ranges.length === 0 ? [] : [{ id, params: { ...mutation.params, ranges } }];

const isCell = (range: IRange) =>
  range.startRow === range.endRow && range.startColumn === range.endColumn;

/**
 * Whether a row or column edit cuts through a merge: an insert inside it, or a
 * remove, or a move's source, overlapping it, or a move's target inside it.
 * Univer's commands remove such merges first; a merge added while someone
 * else's edit cuts it is dropped on both screens (see `cutBy`).
 */
export function cuts(range: IRange, axis: Axis, edit: AxisEdit): boolean {
  const [start, end] = axisKeys(axis);
  const inside = (at: number) => range[start] < at && at <= range[end];
  if (edit.kind === 'insert') return inside(edit.at);
  const at = edit.kind === 'remove' ? edit.at : edit.from;
  const overlaps = range[start] < at + edit.count && range[end] >= at;
  return overlaps || (edit.kind === 'move' && inside(edit.to));
}

/**
 * What a structural edit must remove first when it passes a concurrent
 * add-merge: the added merges it cuts, which `remap` drops on the other side.
 *
 * Decision (owner, chat 2026-10-20): a merge cut by a concurrent row or column
 * edit is dropped on both screens rather than grown or shrunk. Univer's merge
 * listener leaves a cut merge in place, so resizing it would differ from what
 * Univer does for one person; losing the new merge beats screens that differ.
 */
export function cutBy(
  mutation: Mutation,
  axis: Axis,
  edit: AxisEdit,
  observe?: TransformObserver,
): Mutation[] {
  if (mutation.id !== mergeIds.add) return [];
  const ranges = (mutation.params.ranges as IRange[]).filter((range) => cuts(range, axis, edit));
  if (ranges.length)
    observeTransform(observe, { kind: 'dropped', rule: 'merge-cut', value: ranges.length });
  return withRanges(mutation, mergeIds.remove, ranges);
}

/**
 * Where a removal range must go so it still intersects the merges it did.
 * The rows (or columns) a remove or move takes away are trimmed off, since
 * every merge they cut is removed first, and the rest is mapped like cells,
 * which for an insert is exact. A range wholly inside them goes.
 */
function retarget(range: IRange, axis: Axis, edit: AxisEdit): IRange[] {
  const [start, end] = axisKeys(axis);
  let first = range[start];
  let last = range[end];
  if (edit.kind !== 'insert') {
    const at = edit.kind === 'remove' ? edit.at : edit.from;
    const after = at + edit.count;
    if (first >= at && first < after) first = after;
    if (last >= at && last < after) last = at - 1;
    if (first > last) return [];
  }
  return [{ ...range, [start]: mapIndex(edit, first), [end]: mapIndex(edit, last) }];
}

/** An added merge, moved as the listener moves it. */
function moved(range: IRange, axis: Axis, edit: AxisEdit): IRange {
  const [start, end] = axisKeys(axis);
  const by = shift(range, axis, edit);
  return { ...range, [start]: range[start] + by, [end]: range[end] + by };
}

/** The listener drops single-cell merges, and `cutBy` removes cut ones, so neither is added. */
function remap(
  mutation: Mutation,
  axis: Axis,
  edit: AxisEdit,
  observe?: TransformObserver,
): Mutation[] {
  let dropped = 0;
  const ranges = (mutation.params.ranges as IRange[]).flatMap((range) => {
    if (mutation.id === mergeIds.remove) return retarget(range, axis, edit);
    const cut = cuts(range, axis, edit);
    if (cut && !isCell(range)) dropped++;
    return isCell(range) || cut ? [] : [moved(range, axis, edit)];
  });
  if (dropped) observeTransform(observe, { kind: 'dropped', rule: 'merge-cut', value: dropped });
  return withRanges(mutation, mutation.id, ranges);
}

/**
 * An added merge conflicts with a concurrent add or removal it intersects, and
 * the winner stands: a losing add leaves out those ranges, a winning add first
 * removes the other add's merges, and a winning removal is followed by the add
 * again. Two removals commute.
 */
function transform(a: Mutation, b: Mutation, side: Side): Mutation[] {
  if (a.id === mergeIds.remove && b.id === mergeIds.remove) return [a];
  const add = a.id === mergeIds.add ? a : b;
  const other: IRange[] = (add === a ? b : a).params.ranges;
  const ranges: IRange[] = add.params.ranges;
  const hit = ranges.filter((range) => other.some((r) => Rectangle.intersects(range, r)));
  if (hit.length === 0) return [a];
  const addWins = (add === a) === (side === 'left');
  if (add !== a) return addWins ? [a, ...withRanges(add, mergeIds.add, hit)] : [a];
  if (!addWins)
    return withRanges(
      a,
      mergeIds.add,
      ranges.filter((range) => !hit.includes(range)),
    );
  return b.id === mergeIds.add ? [...withRanges(a, mergeIds.remove, hit), a] : [a];
}

export const merges: Family = { ids: Object.values(mergeIds), remap, transform };
