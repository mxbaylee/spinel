import { cellIds, cells } from './cells.ts';
import { docs } from './docs.ts';
import { drawingIds, drawings } from './drawings.ts';
import type { Family } from './family.ts';
import { cutBy, merges } from './merges.ts';
import { markError, mergeMeets, refuseCut } from './shifts.ts';
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
  return pair(a, b, side).filter(isReal);
}

/** Whether a mutation is no ghost of an overwritten write (see cells.haunted). */
const isReal = (mutation: Mutation) => !mutation.params.ghost;

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
  // A shift and a merge edit in its area are refused (see shifts.movesMeet).
  const [merge, move] = self === merges ? [a, b] : [b, a];
  if (familyOf(merge) === merges && mergeMeets(move, merge)) {
    throw new RefusedEditError('moved-cells');
  }
  // A row edit that cuts a move's area is refused either way round (see cells.remap).
  if (self === 'structure' && peer === cells) {
    const { axis, edit } = axisEdit(a)!;
    refuseCut(b, axis, edit);
  }
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
  return pastMany(a, b, side, growth * (a.length + b.length)).filter(isReal);
}

/**
 * The most mutations a sequence may hold while transforming, per mutation
 * transformed. Transforms that multiply their output would otherwise run
 * for hours on a few dozen edits; this refuses them in milliseconds.
 *
 * Decision (owner, chat 2026-10-21): a transform that grows past this is
 * refused like any other race, rather than left to run for hours. Not taken:
 * dropping the retype that makes a write grow (cells.ts), which could leave a
 * value with the wrong type.
 */
const growth = 50;

function pastMany(a: Mutation[], b: Mutation[], side: Side, limit: number): Mutation[] {
  if (a.length === 1 && b.length === 1) return pair(a[0], b[0], side);
  for (const peer of b) a = pastOne(a, peer, side, limit);
  return a;
}

/** Each of `a` goes past `b` as `b` has been changed by the earlier ones. */
function pastOne(a: Mutation[], b: Mutation, side: Side, limit: number): Mutation[] {
  const result: Mutation[] = [];
  let peer = [b];
  for (const mutation of a) {
    result.push(...pastMany([mutation], peer, side, limit));
    peer = pastMany(peer, [mutation], flip(side), limit);
    if (result.length + peer.length > limit) {
      throw new RefusedEditError('growth', `past ${limit} mutations`);
    }
  }
  return result;
}
