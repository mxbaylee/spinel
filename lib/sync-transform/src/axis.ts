import type { Side } from './types.ts';

/**
 * One structural edit along an axis: the rows or columns of a sheet, or a
 * workbook's sheet order. `move` follows Univer's MoveRowsMutation: the block
 * lands before the item that was at `to` before the move.
 */
export type AxisEdit =
  | { kind: 'insert'; at: number; count: number }
  | { kind: 'remove'; at: number; count: number }
  | { kind: 'move'; from: number; count: number; to: number };

/** Where item `index` ends up after `edit`, or null if the edit removed it. */
export function mapIndex(edit: AxisEdit, index: number): number | null {
  if (edit.kind === 'insert') return index >= edit.at ? index + edit.count : index;
  if (edit.kind === 'remove') {
    if (index < edit.at) return index;
    return index < edit.at + edit.count ? null : index - edit.count;
  }
  const { from, count, to } = edit;
  if (index >= from && index < from + count) {
    return to < from ? to + index - from : to - count + index - from;
  }
  if (to < from && index >= to && index < from) return index + count;
  if (to > from && index >= from + count && index < to) return index - count;
  return index;
}

/**
 * A slot in the window of items a pair of edits can touch: an original item
 * (its index) or an item one of the edits inserted (`owner`, offset in the edit).
 */
type Token = number | { owner: 'peer' | 'self'; offset: number };

/** A step that turns the peer's result into the merged result. */
export type AxisStep =
  | { kind: 'insert'; at: number; count: number; offset: number }
  | { kind: 'remove'; at: number; count: number }
  /** `items` are the original indices moved, so a sheet move can name its sheet. */
  | { kind: 'move'; from: number; count: number; to: number; items: number[] };

function bounds(edit: AxisEdit): [number, number] {
  if (edit.kind === 'move') {
    return [Math.min(edit.from, edit.to), Math.max(edit.from + edit.count, edit.to) + 1];
  }
  return [edit.at, edit.at + edit.count + 1];
}

function apply(edit: AxisEdit, list: Token[], owner: 'peer' | 'self', offset: number): Token[] {
  const next = [...list];
  if (edit.kind === 'insert') {
    const inserted = Array.from({ length: edit.count }, (_, i) => ({ owner, offset: i }));
    next.splice(edit.at - offset, 0, ...inserted);
  } else if (edit.kind === 'remove') {
    next.splice(edit.at - offset, edit.count);
  } else {
    const from = edit.from - offset;
    const to = edit.to - offset;
    const block = next.splice(from, edit.count);
    next.splice(to < from ? to : to - edit.count, 0, ...block);
  }
  return next;
}

function originals(edit: AxisEdit): number[] {
  if (edit.kind === 'insert') return [];
  const start = edit.kind === 'move' ? edit.from : edit.at;
  return Array.from({ length: edit.count }, (_, i) => start + i);
}

/**
 * The list position of the first original item at or after `index` that is
 * still present and was not moved by the winner. Anchoring past moved items
 * keeps every unmoved item in the same relative order on both sides, which
 * `diff` relies on.
 */
function anchor(list: Token[], index: number, limit: number, moved: Set<number>): number {
  for (let item = index; item < limit; item++) {
    if (moved.has(item)) continue;
    const at = list.indexOf(item);
    if (at >= 0) return at;
  }
  return list.length;
}

/**
 * Applies the losing edit's intent to the list the winning edit produced. The
 * winner keeps every item it moved; removals from either side stick; an insert
 * or a moved block lands before the original item it was aimed at, after any
 * insert the winner made there. Inserts do not follow rows the winner moved.
 */
function applyIntent(
  edit: AxisEdit,
  list: Token[],
  owner: 'peer' | 'self',
  winnerMoved: Set<number>,
  end: number,
): Token[] {
  const next = [...list];
  if (edit.kind === 'insert') {
    const inserted = Array.from({ length: edit.count }, (_, i) => ({ owner, offset: i }));
    next.splice(anchor(next, edit.at, end, winnerMoved), 0, ...inserted);
    return next;
  }
  const items = originals(edit).filter((item) => next.includes(item));
  if (edit.kind === 'remove') return next.filter((token) => !items.includes(token as number));
  const moving = items.filter((item) => !winnerMoved.has(item));
  if (moving.length === 0) return next;
  const rest = next.filter((token) => !moving.includes(token as number));
  rest.splice(anchor(rest, edit.to, end, winnerMoved), 0, ...moving);
  return rest;
}

const same = (x: Token, y: Token) =>
  x === y ||
  (typeof x === 'object' && typeof y === 'object' && x.owner === y.owner && x.offset === y.offset);

const indexOf = (list: Token[], token: Token) => list.findIndex((item) => same(item, token));

/**
 * The steps that turn `from` into `to`: removals, then, in `to`'s order, each
 * new item inserted and each `movable` item moved right after its predecessor.
 * Every other item already has the right relative order, so only items one of
 * the edits named are ever moved (a sheet move must name its sheet).
 */
function diff(from: Token[], to: Token[], offset: number, movable: Set<number>): AxisStep[] {
  const steps: AxisStep[] = [];
  let list = [...from];
  for (let i = list.length - 1; i >= 0; i--) {
    if (indexOf(to, list[i]) >= 0) continue;
    let start = i;
    while (start > 0 && indexOf(to, list[start - 1]) < 0) start--;
    steps.push({ kind: 'remove', at: start + offset, count: i - start + 1 });
    list.splice(start, i - start + 1);
    i = start;
  }
  const isNew = (token: Token) => indexOf(list, token) < 0;
  const isMovable = (token: Token) => typeof token === 'number' && movable.has(token);
  for (let i = 0; i < to.length; i++) {
    const at = i === 0 ? 0 : indexOf(list, to[i - 1]) + 1;
    const token = to[i];
    if (typeof token === 'object' && isNew(token)) {
      let count = 1;
      while (i + count < to.length && typeof to[i + count] === 'object' && isNew(to[i + count])) {
        count++;
      }
      list.splice(at, 0, ...to.slice(i, i + count));
      steps.push({ kind: 'insert', at: at + offset, count, offset: token.offset });
      i += count - 1;
      continue;
    }
    if (!isMovable(token) || same(list[at], token)) continue;
    const from = indexOf(list, token);
    let count = 1;
    while (
      i + count < to.length &&
      isMovable(to[i + count]) &&
      same(list[from + count], to[i + count])
    ) {
      count++;
    }
    const items = list.slice(from, from + count) as number[];
    steps.push({ kind: 'move', from: from + offset, count, to: at + offset, items });
    list = apply({ kind: 'move', from, count, to: at }, list, 'self', 0);
    i += count - 1;
  }
  return steps;
}

/**
 * Transforms structural edit `self` so it applies after concurrent `peer` on
 * the same axis. Both sides compute the same merged order, so applying either
 * edit and then the other's transform converges. Only the window both edits
 * touch is modelled; items past it never move relative to each other.
 */
export function transformAxis(self: AxisEdit, peer: AxisEdit, side: Side): AxisStep[] {
  const [selfStart, selfEnd] = bounds(self);
  const [peerStart, peerEnd] = bounds(peer);
  const offset = Math.min(selfStart, peerStart);
  const end = Math.max(selfEnd, peerEnd);
  const base: Token[] = Array.from({ length: end - offset }, (_, i) => i + offset);
  const [winner, loser] = side === 'left' ? [self, peer] : [peer, self];
  const winnerOwner = side === 'left' ? 'self' : 'peer';
  const loserOwner = side === 'left' ? 'peer' : 'self';
  const winnerMoved = new Set(winner.kind === 'move' ? originals(winner) : []);
  const won = apply(winner, base, winnerOwner, offset);
  const merged = applyIntent(loser, won, loserOwner, winnerMoved, end);
  const movable = new Set(
    [self, peer].flatMap((edit) => (edit.kind === 'move' ? originals(edit) : [])),
  );
  return diff(apply(peer, base, 'peer', offset), merged, offset, movable);
}
