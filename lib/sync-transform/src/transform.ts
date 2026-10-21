import { cellIds, cells, compact, landsAnywhere, meets } from './cells.ts';
import { docs } from './docs.ts';
import { drawingIds, drawings } from './drawings.ts';
import type { Family } from './family.ts';
import { cutBy, merges } from './merges.ts';
import { markError, pastMerge, refuseCut, shiftOf } from './shifts.ts';
import { properties } from './properties.ts';
import { settings } from './settings.ts';
import {
  axisEdit,
  sheetOrderIds,
  axisIds,
  structureIds,
  transformSheetOrder,
  transformStructure,
} from './structure.ts';
import { flip, RefusedEditError, UnsupportedMutationError } from './types.ts';
import type { Mutation, Side } from './types.ts';

const families: Family[] = [cells, properties, merges, settings, drawings, docs];

const familyById = new Map<string, Family | 'structure' | 'sheet-order'>();
for (const family of families) for (const id of family.ids) familyById.set(id, family);
for (const id of axisIds) familyById.set(id, 'structure');
for (const id of sheetOrderIds) familyById.set(id, 'sheet-order');

/** Every mutation id the transforms understand. Anything else is rejected. */
export const supportedMutationIds: readonly string[] = [...familyById.keys()];

function familyOf(mutation: Mutation) {
  return familyById.get(mutation.id)!;
}

/**
 * Rejects what the transforms cannot merge, and what a sender failed to add
 * (README, "What a sender must do"), before any transform runs: a check made
 * only when two edits collide would let a broken sender pass until they do.
 *
 * Decision (owner, chat 2026-10-20): an unsupported mutation is rejected, never
 * passed through untransformed. A guess lets two screens drift with no sign; a
 * refusal shows up in logs, and SPN-059 hides the menus that send them.
 *
 * Decision (owner, chat 2026-10-20): the sender adds what the transforms, being
 * stateless, cannot know: inline styles, RemoveSheet's `index`, kept paragraph
 * ids and a new doc's drawing containers (SPN-058). The alternative, a server
 * that keeps per-document state to fill them in, is not built.
 */
function check(mutation: Mutation): void {
  const { id, params: p } = mutation;
  if (!familyById.has(id)) throw new UnsupportedMutationError(id);
  // Cutting cells to another sheet edits two sheets; every transform addresses one.
  if (id === cellIds.moveRange && p.from.subUnitId !== p.to.subUnitId) {
    throw new UnsupportedMutationError(id);
  }
  // Formula results apply locally on each client and are never sent.
  if (id === cellIds.setRangeValues && p.sourceFormulaData !== undefined) {
    throw new UnsupportedMutationError(id);
  }
  const shiftError = id === cellIds.moveRange ? markError(mutation) : undefined;
  if (shiftError) throw new TypeError(`MoveRangeMutation's \`shift\` is wrong: ${shiftError}.`);
  if (id === structureIds.removeSheet && !Number.isInteger(p.index)) {
    throw new TypeError('RemoveSheetMutation needs `index`, its position before removal.');
  }
  if (id.startsWith('sheet.') && namesStyleId(p)) {
    throw new TypeError(`${id} needs inline styles: style ids differ on every client.`);
  }
}

/** Whether any `s` in a sheet mutation's params is a style id rather than a style. */
function namesStyleId(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([key, v]) => (key === 's' && typeof v === 'string') || namesStyleId(v),
  );
}

/** The sheet a mutation edits, or undefined for a workbook- or document-wide edit. */
function sheetOf(mutation: Mutation): string | undefined {
  const p = mutation.params;
  return p.subUnitId ?? p.sheet?.id ?? p.from?.subUnitId;
}

/** Transforms one mutation past one concurrent mutation. */
export function transformMutation(a: Mutation, b: Mutation, side: Side): Mutation[] {
  check(a);
  check(b);
  return pair(a, b, side);
}

function pair(a: Mutation, b: Mutation, side: Side): Mutation[] {
  const self = familyOf(a);
  const peer = familyOf(b);
  if (a.params.unitId !== b.params.unitId) return [a];
  if (self === 'sheet-order' && peer === 'sheet-order') return transformSheetOrder(a, b, side);
  // An edit to a removed sheet is dropped, except a drawing op: the drawing
  // tree keeps a removed sheet's entry, and RemoveSheetCommand itself sends
  // its drawing removals after the sheet removal, so later ops still meet it.
  if (peer === 'sheet-order') {
    const gone = b.id === structureIds.removeSheet && sheetOf(a) === sheetOf(b);
    return gone && a.id !== drawingIds.apply ? [] : [a];
  }
  if (self === 'sheet-order' || sheetOf(a) !== sheetOf(b)) return [a];
  if (peer === 'structure') {
    if (self === 'structure') return transformStructure(a, b, side);
    const { axis, edit } = axisEdit(b)!;
    return self.remap(a, axis, edit);
  }
  // A row edit removes the concurrently added merges it cuts (see merges.cutBy).
  if (self === 'structure' && peer === merges) {
    const { axis, edit } = axisEdit(a)!;
    return [...cutBy(b, axis, edit), a];
  }
  const meets = (x: Mutation, y: Mutation) => !!shiftOf(x) && familyOf(y) === merges;
  if (meets(a, b) || meets(b, a)) return pastMerge(a, b);
  // A row edit that cuts a shift is refused either way round (see shifts.remark).
  if (self === 'structure' && peer === cells) refuseCut(b, axisEdit(a)!);
  if (self === 'structure' || self !== peer) return [a];
  return self.transform(a, b, side);
}

/**
 * Transforms a sequence of mutations past a concurrent sequence, both made
 * from the same document, by pairing them up in order. For every `a` and `b`:
 * applying `b` then `transform(a, b, side)` gives the same document as
 * applying `a` then `transform(b, a, flip(side))`.
 */
export function transform(a: Mutation[], b: Mutation[], side: Side): Mutation[] {
  // Check every mutation up front, even when the other side is empty.
  for (const mutation of [...a, ...b]) check(mutation);
  // Without the writes that change nothing, which transforming repeats and
  // later transforms would multiply. Only the result is compacted: the other
  // side's transform pairs up the same mutations, which must stay as they are.
  return compact(pastMany(a, b, side, growth * (a.length + b.length)));
}

/**
 * The most mutations a sequence may hold while transforming, per mutation
 * transformed. Transforms that multiply their output would otherwise run
 * for hours on a few dozen edits; this refuses them in milliseconds.
 */
const growth = 50;

function pastMany(a: Mutation[], b: Mutation[], side: Side, limit: number): Mutation[] {
  if (a.length === 1 && b.length === 1) return pair(a[0], b[0], side);
  for (const peer of b) a = pastOne(a, peer, side, limit);
  return a;
}

/**
 * Each of `a` goes past `b` as `b` has been changed by the earlier ones.
 *
 * A cell edit that loses to the peer can end by replaying the peer, and each
 * later edit of `a` would replay it again after its own, so the output would
 * double with every edit. Instead the replay waits at the end: `peer` then
 * `m` past it does what `m` then `peer` past `m` does, so each later cell edit
 * lands as made and the peer follows it. Most cell edits transform alike in
 * any document, so this holds wherever they land; anything else lands the
 * replay first. So does an edit of other cells: the two orders agree only
 * while both write the same cells, and a later move can bring them together.
 */
const anywhere = (mutation: Mutation) => familyOf(mutation) === cells && landsAnywhere(mutation);

function pastOne(a: Mutation[], b: Mutation, side: Side, limit: number): Mutation[] {
  const result: Mutation[] = [];
  let peer = [b];
  let waiting = false;
  for (const mutation of a) {
    const next = pastMany(peer, [mutation], flip(side), limit);
    if (waiting && anywhere(mutation) && next.every(anywhere) && meets(mutation, peer)) {
      result.push(mutation);
      peer = next;
      continue;
    }
    if (waiting) result.push(...peer);
    const out = pastMany([mutation], peer, side, limit);
    const kept = out.length - next.length;
    waiting =
      kept >= 0 &&
      next.every((m, i) => anywhere(m) && JSON.stringify(m) === JSON.stringify(out[kept + i]));
    result.push(...(waiting ? out.slice(0, kept) : out));
    peer = next;
    if (result.length + peer.length > limit) {
      throw new RefusedEditError('growth', `past ${limit} mutations`);
    }
  }
  if (waiting) result.push(...peer);
  return result;
}
