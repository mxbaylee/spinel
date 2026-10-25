import type { IRange } from '@univerjs/core';
import { mapIndex } from './axis.ts';
import type { AxisEdit } from './axis.ts';
import type { Axis, Family } from './family.ts';
import { movesMeet, refuseCut, remapMove } from './shifts.ts';
import {
  absolute,
  claimsOf,
  difference,
  effect,
  isAbsolute,
  lands,
  overlay,
  same,
  sameCell,
  tailFor,
} from './state.ts';
import type { CellData, Cells } from './state.ts';
import { structureIds } from './structure.ts';
import { RefusedEditError, refuseRaces } from './types.ts';
import type { Mutation, Side } from './types.ts';
import { cellIds, cellKey, ghostId, isGhost, isMove, meets, writesOf } from './writes.ts';
import type { Matrix, Write } from './writes.ts';

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

/** Whether a cell write holds a formula of its own: `f`, or a shared formula's `si`. */
export const hasFormula = (write: Write) => {
  const own = claimsOf(write.value);
  return Boolean(own?.f || own?.si);
};

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

/** The top-level keys `mutation` writes in a cell as its own edit, '' for the whole cell. */
function keysOf(mutation: Mutation, write: Write): string[] {
  if (mutation.id !== cellIds.setRangeValues) return ['s'];
  const own = claimsOf(write.value);
  if (own === null || own === undefined) return [''];
  return Object.keys(own).filter((key) => own[key] !== undefined);
}

/** The keys that make a cell's value. */
const valueKeys = new Set(['v', 'f', 'si']);

/**
 * Whether `rewrite`, marked as a command's formula rewrite, rewrites a cell
 * whose value or formula `other` replaces without a formula: its write there
 * names `v`, `f` or `si`, or the whole cell, as a typed value (`f: null`) or
 * a clear does. An absolute write names the keys it claims. A style or
 * number format there names no key of the rewrite and merges. A write with a
 * formula is left to names.refuseFormulaRaces, which keeps two edits of one
 * name first-accepted.
 */
function rewriteMet(rewrite: Mutation, other: Mutation): boolean {
  if (!rewrite.params[rewriteKey]) return false;
  const cells = new Set(writesOf(rewrite).filter(hasFormula).map(cellKey));
  return writesOf(other).some(
    (write) =>
      cells.has(cellKey(write)) &&
      !hasFormula(write) &&
      keysOf(other, write).some((key) => key === '' || valueKeys.has(key)),
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

/** A write of `t` alone: a retype of the value its sender saw, as SetNumfmtCommand sends. */
function typeOnly(mutation: Mutation, write: Write): boolean {
  const own = claimsOf(write.value);
  return mutation.id === cellIds.setRangeValues && keysOf(mutation, write).join() === 't' && !!own;
}

const setsValue = (mutation: Mutation, write: Write) =>
  mutation.id === cellIds.setRangeValues && claimsOf(write.value)?.v !== undefined;

/**
 * The side `a`'s write to a cell takes against `b`'s: `side`, except that a
 * write of `t` alone yields to a concurrent write of a value, whichever was
 * accepted first, since it retypes a value its sender saw and no other.
 *
 * Decision (agent, 2026-10-23, docs/implementation/SPN-056.md decision 31):
 * keep the one rule of the rule-based merge the replay merge needs. Landed after
 * another's value, a retype to a number made text NaN (schema seed 909,
 * shrunk). Not taken: landing it anyway, as Univer would.
 */
function sideOf(a: Mutation, write: Write, b: Mutation, theirs: Write, side: Side): Side {
  if (side === 'left' && typeOnly(a, write) && setsValue(b, theirs)) return 'right';
  if (side === 'right' && typeOnly(b, theirs) && setsValue(a, write)) return 'left';
  return side;
}

/**
 * What the winner's write to a cell makes of `cell`: Univer's own merge for a
 * write a sender sent, and for an absolute write its claims laid over it
 * (see state.overlay), so a key it claims nothing of keeps what landed under
 * it.
 *
 * Decision (agent, 2026-10-23, docs/implementation/SPN-056.md decision 34):
 * lay claims over, not merge them in. Merged, a claim of a retyped value with a style deleted rich text it never named
 * (handleStyle), so the replay lost a concurrent edit's `p` (schema seed 352).
 */
function winning(mutation: Mutation, write: Write, cell: CellData | null): CellData | null {
  if (!isAbsolute(write.value)) return effect(mutation, write.value, cell);
  return overlay(claimsOf(write.value), cell);
}

/**
 * The write of the tails `mutation`'s absolute writes need after them (see
 * state.tailFor), or null where none needs one. A tail is rebuilt from its
 * absolute write's cell, which names the ft and fd it puts back.
 */
function tailOf(mutation: Mutation): Mutation | null {
  if (mutation.id !== cellIds.setRangeValues) return null;
  const tails = writesOf(mutation).flatMap((write) => {
    const tail = tailFor(write.value);
    return tail ? [{ ...write, value: tail }] : [];
  });
  if (tails.length === 0) return null;
  const { unitId, subUnitId } = mutation.params;
  // The tail carries claims too, so it is an override write: one with no `s`
  // leaves the style alone (sheets' overrideStyle).
  const params = { unitId, subUnitId, ...sentBy(mutation), isOverrideStyle: true };
  return { id: cellIds.setRangeValues, params: { ...params, cellValue: toMatrix(tails) } };
}

/**
 * Whether `next` writes just the tails `tail` writes, as `tailOf` makes them,
 * key for key: an extra `f: null` would make the sender's Univer drop the ft
 * and fd the tail puts back. `check` already rejects claims without
 * `isOverrideStyle`.
 */
function isTailOf(tail: Mutation, next: Mutation | undefined): boolean {
  if (next?.id !== cellIds.setRangeValues) return false;
  const p = next.params;
  if (p.unitId !== tail.params.unitId || p.subUnitId !== tail.params.subUnitId) return false;
  const theirs = new Map(writesOf(next).map((write) => [cellKey(write), write.value]));
  const mine = writesOf(tail);
  return (
    mine.length === theirs.size &&
    mine.every((write) => same(theirs.get(cellKey(write)), write.value))
  );
}

/**
 * `mutations` with each absolute write's tail folded into it: the write
 * after it of the ft and fd Univer's merge drops (see state.absolute). An
 * absolute write that drops formula data then means itself and its tail
 * (state.lands), so a transform resolves the two as one cell and
 * `withTails` rebuilds the tail from the final cell. Transformed apart, a
 * tail kept the ft or fd of the cell it was made for once its absolute write
 * was resolved again past a later write, and landed it over that write's
 * (F13, schema seed 141,057, shrunk). An absolute write that needs a tail and
 * is not followed by it, as the transform returns it, is rejected
 * (`TypeError`): a transform would put it back where its sender has none.
 *
 * Decision (agent, 2026-10-24, docs/implementation/SPN-056.md decision 36):
 * one tail, rebuilt from the final cell. Not taken: a tail yielding to any
 * other write, which dropped tails a later write still read as landed.
 */
export function withoutTails(mutations: Mutation[]): Mutation[] {
  const result: Mutation[] = [];
  for (let i = 0; i < mutations.length; i++) {
    result.push(mutations[i]);
    const tail = tailOf(mutations[i]);
    if (!tail) continue;
    if (!isTailOf(tail, mutations[i + 1])) {
      throw new TypeError(
        'An absolute write that names ft or fd Univer drops needs its tail after it.',
      );
    }
    i++;
  }
  return result;
}

/** `mutations`, each absolute write followed by its tail where it needs one (see `withoutTails`). */
export const withTails = (mutations: Mutation[]): Mutation[] =>
  mutations.flatMap((mutation) => {
    const tail = tailOf(mutation);
    return tail ? [mutation, tail] : [mutation];
  });

/**
 * `a`'s write to a cell `b` writes too, past `b`, with `cell` the cell both
 * were made on. Both end on the cell Univer makes of the loser's write and
 * then the winner's, in the server's order. The winner, landing last, lands
 * as it is, unless it is an absolute write, which lands its claims over the
 * loser's (see `winning`). The loser lands that cell as an absolute write,
 * claiming what it changes of the winner's, or goes where it changes
 * nothing. Each write lands with its tail (see `withoutTails`). Returns
 * the write's new value, null to delete the cell, or undefined to drop it.
 */
function resolve(
  a: Mutation,
  write: Write,
  b: Mutation,
  theirs: Write,
  side: Side,
  cell: CellData | null,
): unknown {
  if (side === 'left') {
    if (!isAbsolute(write.value)) return write.value;
    const under = lands(b, theirs.value, cell);
    const desired = winning(a, write, under);
    if (sameCell(lands(a, write.value, under), desired)) return write.value;
    return absolute(desired, claimsOf(write.value)).value;
  }
  const landed = lands(b, theirs.value, cell);
  const desired = winning(b, theirs, lands(a, write.value, cell));
  if (sameCell(desired, landed)) return undefined;
  return absolute(desired, difference(landed, desired)).value;
}

/**
 * `a` past `b` where both write some cells; `b` wins them on the right. The
 * cells only `a` writes stay in `a`; the shared ones it rewrites go out as
 * one SetRangeValues that overrides styles, since an absolute write names
 * its whole style.
 *
 * Decision (agent, chat 2026-10-23, accepted, docs/implementation/SPN-056.md
 * decision 29): resolve a shared cell by replaying both writes through
 * Univer's own merge on the base cells (the replay merge). Not taken: the
 * rule-based merge, a rule per shape, which every fuzz round found another
 * shape for; it lost the final comparison ("Two merge strategies compared").
 */
function conflict(a: Mutation, b: Mutation, side: Side, state: Cells): Mutation[] {
  const { unitId, subUnitId } = a.params;
  const theirs = new Map(writesOf(b).map((write) => [cellKey(write), write]));
  const kept: Write[] = [];
  const settled: Write[] = [];
  for (const write of writesOf(a)) {
    const other = theirs.get(cellKey(write));
    const cell = other ? state.get(unitId, subUnitId, write.row, write.col) : null;
    const value = other
      ? resolve(a, write, b, other, sideOf(a, write, b, other, side), cell)
      : write.value;
    if (value === write.value) kept.push(write);
    else if (value !== undefined) settled.push({ ...write, value });
  }
  if (kept.length === writesOf(a).length) return [a];
  const marks = a.params[rewriteKey] === undefined ? {} : { [rewriteKey]: a.params[rewriteKey] };
  const params = { unitId, subUnitId, ...sentBy(a), ...marks };
  const values = (writes: Write[], extra = {}): Mutation[] =>
    writes.length === 0
      ? []
      : [
          {
            id: cellIds.setRangeValues,
            params: { ...params, ...extra, cellValue: toMatrix(writes) },
          },
        ];
  return [...rebuild(a, kept), ...values(settled, { isOverrideStyle: true })];
}

function transform(a: Mutation, b: Mutation, side: Side, state: Cells): Mutation[] {
  // A move and an edit in its area are refused (see shifts.movesMeet).
  if (isMove(a) || isMove(b)) {
    if (movesMeet(a, b)) throw new RefusedEditError('moved-cells');
    return [a];
  }
  if (isGhost(a) || isGhost(b) || !meets(a, b)) return [a];
  // Decision (owner, chat 2026-10-22): see names.refuseFormulaRaces.
  if (rewriteMet(a, b) || rewriteMet(b, a)) throw new RefusedEditError('formula-race');
  // Diagnostics (SPN-057, not built): `sync.edit.dropped`, rule
  // 'cell-overwritten', when `haunted` adds a ghost.
  return haunted(a, conflict(a, b, side, state));
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
