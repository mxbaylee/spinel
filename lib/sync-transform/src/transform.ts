import {
  cells,
  halfKey,
  joinCuts,
  perSheet,
  refuseCutsToRemoved,
  rewriteKey,
  unmarked,
  withoutTails,
  withTails,
} from './cells.ts';
import { docs } from './docs.ts';
import { drawingIds, drawings } from './drawings.ts';
import type { Family } from './family.ts';
import { cutBy, merges } from './merges.ts';
import { markRewrites, names, refuseFormulaRaces, refuseNameRaces } from './names.ts';
import { markError, mergeMeets, refuseCut } from './shifts.ts';
import { properties, propertyIds } from './properties.ts';
import { settings, settingIds } from './settings.ts';
import { baseError, Cells, claimError, isAbsolute } from './state.ts';
import type { BaseCells } from './state.ts';
import {
  axisEdit,
  sheetOrderIds,
  axisIds,
  structureIds,
  transformSheetOrder,
  transformStructure,
} from './structure.ts';
import {
  flip,
  RefusedEditError,
  UnsupportedMutationError,
  MalformedEditError,
  observeTransform,
} from './types.ts';
import type { Mutation, Side, TransformObserver, DropRule } from './types.ts';
import { cellIds, ghostId, matrixWrites } from './writes.ts';
import type { Matrix } from './writes.ts';

const families: Family[] = [cells, properties, merges, settings, drawings, docs, names];

const familyById = new Map<string, Family | 'structure' | 'sheet-order'>();
for (const family of families) for (const id of family.ids) familyById.set(id, family);
for (const id of axisIds) familyById.set(id, 'structure');
for (const id of sheetOrderIds) familyById.set(id, 'sheet-order');

/** Every mutation id the transforms understand. Anything else is rejected. */
export const supportedMutationIds: readonly string[] = [...familyById.keys()];
const supported = new Set(supportedMutationIds);
// Routed but never accepted: a ghost exists only inside one `transform` call.
familyById.set(ghostId, cells);

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
 * Decision (owner, chat 2026-10-20): the sender adds what the transforms
 * cannot know from the mutations alone: inline styles, RemoveSheet's `index`,
 * kept paragraph ids and a new doc's drawing containers (SPN-058). Since
 * decision 29 (docs/implementation/SPN-056.md) the transforms also read the
 * base cells where two writes meet one cell, and to validate every absolute
 * write against the exact base it was made on.
 */
function check(mutation: Mutation): void {
  const { id, params: p } = mutation;
  if (!supported.has(id)) throw new UnsupportedMutationError(id);
  // Formula results apply locally on each client and are never sent.
  if (id === cellIds.setRangeValues && p.sourceFormulaData !== undefined) {
    throw new UnsupportedMutationError(id);
  }
  const shiftError = id === cellIds.moveRange ? markError(mutation) : undefined;
  if (shiftError)
    throw new MalformedEditError('shift', `MoveRangeMutation's \`shift\` is wrong: ${shiftError}.`);
  // A cut's half and a rewrite's mark exist only inside one `transform` (see
  // cells.joinCuts and names.markRewrites).
  for (const key of [halfKey, rewriteKey]) {
    if (Object.hasOwn(p, key))
      throw new MalformedEditError('reserved-key', `\`${key}\` is the transform's own mark.`);
  }
  // An absolute write's claims come back as the transform returned them, so
  // each is checked against what its cell writes (see state.claimError). A
  // move, which never overrides styles, carries none.
  const matrices =
    id === cellIds.setRangeValues
      ? [p.cellValue]
      : id === cellIds.moveRange
        ? [p.from?.value, p.to?.value]
        : [];
  const override = id === cellIds.setRangeValues && p.isOverrideStyle === true;
  for (const { value } of matrices.flatMap(matrixWrites)) {
    const error = claimError(value, override);
    if (error) throw new MalformedEditError('claim', `A cell of ${id} ${error}.`);
  }
  if (id === structureIds.removeSheet && !Number.isInteger(p.index)) {
    throw new MalformedEditError(
      'remove-index',
      'RemoveSheetMutation needs `index`, its position before removal.',
    );
  }
  if (namesStyleId(mutation)) {
    throw new MalformedEditError(
      'inline-style',
      `${id} needs inline styles: style ids differ on every client.`,
    );
  }
}

/** Only actual style slots contain style ids; custom data may use the same keys. */
function namesStyleId({ id, params: p }: Mutation): boolean {
  const dataStyles = (data: Record<number, { s?: unknown } | null> | undefined) =>
    Object.values(data ?? {}).some((value) => typeof value?.s === 'string');
  const cellStyles = (matrix: Matrix) =>
    matrixWrites(matrix).some(({ value }) => typeof value?.s === 'string');
  switch (id) {
    case cellIds.setRangeValues:
      return cellStyles(p.cellValue);
    case cellIds.moveRange:
      return cellStyles(p.from?.value) || cellStyles(p.to?.value);
    case settingIds.defaultStyle:
      return typeof p.defaultStyle === 'string';
    case propertyIds.rowData:
      return dataStyles(p.rowData);
    case propertyIds.colData:
      return dataStyles(p.columnData);
    case structureIds.insertRow:
      return dataStyles(p.rowInfo);
    case structureIds.insertCol:
      return dataStyles(p.colInfo);
    case structureIds.insertSheet:
      return (
        typeof p.sheet?.defaultStyle === 'string' ||
        cellStyles(p.sheet?.cellData) ||
        dataStyles(p.sheet?.rowData) ||
        dataStyles(p.sheet?.columnData)
      );
    default:
      return false;
  }
}

/**
 * Rejects an absolute write in `mutations`, made in turn on `state`, that
 * changes a key of its cell it does not claim (see state.baseError), as
 * `check` rejects a claim of a key it does not write. The base is the one
 * the list was made on, with the list's earlier mutations applied. Without
 * it no claim can be checked, so an absolute write needs the base cells
 * (`state` null where none were given), even where no two writes meet: a
 * claim taken on trust could carry a formula past `'formula-race'`.
 */
export function checkBases(mutations: Mutation[], state: Cells | null): void {
  for (const mutation of mutations) {
    if (mutation.id === cellIds.setRangeValues) {
      const { unitId, subUnitId, cellValue } = mutation.params;
      for (const { row, col, value } of matrixWrites(cellValue)) {
        if (!isAbsolute(value)) continue;
        if (!state) {
          throw new MalformedEditError(
            'base-cells',
            'An absolute write needs the base cells (`options.cells`) to check its claims.',
          );
        }
        const error = baseError(value, state.get(unitId, subUnitId, row, col));
        if (error) throw new MalformedEditError('base-claim', `A cell of ${mutation.id} ${error}.`);
      }
    }
    state = state && state.after(mutation);
  }
}

/** The sheet a mutation edits, or undefined for a workbook- or document-wide edit. */
function sheetOf(mutation: Mutation): string | undefined {
  const p = mutation.params;
  return p.subUnitId ?? p.sheet?.id ?? p.from?.subUnitId;
}

/** Whether a mutation is no ghost of an overwritten write (see cells.haunted). */
const isReal = (mutation: Mutation) => mutation.id !== ghostId;

function pair(
  a: Mutation,
  b: Mutation,
  side: Side,
  state: Cells,
  observe?: TransformObserver,
): Mutation[] {
  try {
    return pairCore(a, b, side, state, observe);
  } catch (error) {
    if (error instanceof RefusedEditError) {
      error.mutationId ??= a.id;
      error.againstMutationId ??= b.id;
    }
    throw error;
  }
}

function pairCore(
  a: Mutation,
  b: Mutation,
  side: Side,
  state: Cells,
  observe?: TransformObserver,
): Mutation[] {
  const self = familyOf(a);
  const peer = familyOf(b);
  if (a.params.unitId !== b.params.unitId) return [a];
  // Names are workbook-wide; `transform` refused their races up front.
  if (self === names || peer === names)
    return self === peer ? names.transform(a, b, side, state, observe) : [a];
  if (self === 'sheet-order' && peer === 'sheet-order') return transformSheetOrder(a, b, side);
  // An edit to a removed sheet is dropped, except a drawing op: the drawing
  // tree keeps a removed sheet's entry, and RemoveSheetCommand itself sends
  // its drawing removals after the sheet removal, so later ops still meet it.
  if (peer === 'sheet-order') {
    const gone = b.id === structureIds.removeSheet && sheetOf(a) === sheetOf(b);
    if (gone && a.id !== drawingIds.apply) {
      observeTransform(observe, { kind: 'dropped', rule: 'removed-sheet', value: 1 });
      return [];
    }
    return [a];
  }
  if (self === 'sheet-order' || sheetOf(a) !== sheetOf(b)) return [a];
  if (peer === 'structure') {
    if (self === 'structure') return transformStructure(a, b, side);
    const { axis, edit } = axisEdit(b)!;
    return self.remap(a, axis, edit, observe);
  }
  // A row edit removes the concurrently added merges it cuts (see merges.cutBy).
  if (self === 'structure' && peer === merges) {
    const { axis, edit } = axisEdit(a)!;
    return [...cutBy(b, axis, edit, observe), a];
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
  return self.transform(a, b, side, state, observe);
}

/**
 * Transforms a sequence of mutations past a concurrent sequence, both made
 * from the same document, by pairing them up in order. For every `a` and `b`:
 * applying `b` then `transform(a, b, side)` gives the same document as
 * applying `a` then `transform(b, a, flip(side))`.
 *
 * `options.cells` reads that document's cells. Two writes to one cell are
 * resolved against the cell (see cells.conflict), and an absolute write is
 * checked against it (see `checkBases`), so a transform where two writes
 * meet, or either list holds an absolute write, needs it, and throws a
 * TypeError without it; any other never reads it. The server reads its
 * snapshot at the revision both sequences were made on; a client its
 * document before its pending edits.
 */
export function transform(
  a: Mutation[],
  b: Mutation[],
  side: Side,
  options: { cells?: BaseCells; observe?: TransformObserver } = {},
): Mutation[] {
  // Timing belongs to the server. This call only observes content-free counts.
  // Check every mutation up front, even when the other side is empty.
  for (const mutation of [...a, ...b]) check(mutation);
  const state = Cells.of(options.cells);
  for (const list of [a, b]) checkBases(list, options.cells ? state : null);
  const [mine, theirs] = [markRewrites(a).flatMap(perSheet), markRewrites(b).flatMap(perSheet)];
  const limit = growth * (mine.length + theirs.length);
  // Each absolute write and its tail are transformed as one (see
  // cells.withoutTails). A write missing its tail is rejected before any race
  // is refused, so it is never reported as a refusal.
  const [lone, peers] = [withoutTails(mine), withoutTails(theirs)];
  refuseNameRaces(a, b);
  refuseFormulaRaces(a, b);
  refuseCutsToRemoved(a, b);
  const observation = { peak: lone.length + peers.length };
  const dropped = new Map<DropRule, number>();
  let offsets = 0;
  const collect: TransformObserver | undefined = options.observe
    ? (event) => {
        if (event.kind === 'dropped')
          dropped.set(event.rule, (dropped.get(event.rule) ?? 0) + event.value);
        else if (event.kind === 'offset') offsets += event.value;
      }
    : undefined;
  try {
    const past = pastMany(lone, peers, side, limit, state, observation, collect);
    const result = withTails(joinCuts(past.filter(isReal)).map(unmarked));
    // If a later pair refuses the batch, none of its earlier drops are delivered.
    for (const [rule, value] of dropped)
      observeTransform(options.observe, { kind: 'dropped', rule, value });
    if (offsets) observeTransform(options.observe, { kind: 'offset', value: offsets });
    return result;
  } finally {
    observeTransform(options.observe, { kind: 'growth', value: observation.peak });
  }
}

/**
 * The most mutations a sequence may hold while transforming, per mutation
 * transformed. Transforms that multiply their output would otherwise run
 * for hours on a few dozen edits; this refuses them in milliseconds.
 *
 * Decision (owner, chat 2026-10-21): a transform that grows past this is
 * refused like any other race, rather than left to run for hours. The retype
 * that made a write grow went with decision 29 (docs/implementation/
 * SPN-056.md); a losing write now becomes at most its other cells, an
 * absolute write and its tail, and the cap stays as a cheap guard.
 */
const growth = 50;

/** `a` past `b`, both made on `state`. Each pair meets on the cells both made it on. */
function pastMany(
  a: Mutation[],
  b: Mutation[],
  side: Side,
  limit: number,
  state: Cells,
  observation: { peak: number },
  observe?: TransformObserver,
): Mutation[] {
  if (a.length === 1 && b.length === 1) {
    const result = pair(a[0], b[0], side, state, observe);
    observation.peak = Math.max(observation.peak, result.length + b.length);
    return result;
  }
  for (const peer of b) {
    a = pastOne(a, peer, side, limit, state, observation, observe);
    state = state.after(peer, true);
  }
  return a;
}

/** Each of `a` goes past `b` as `b` has been changed by the earlier ones. */
function pastOne(
  a: Mutation[],
  b: Mutation,
  side: Side,
  limit: number,
  state: Cells,
  observation: { peak: number },
  observe?: TransformObserver,
): Mutation[] {
  const result: Mutation[] = [];
  let peer = [b];
  for (const mutation of a) {
    result.push(...pastMany([mutation], peer, side, limit, state, observation, observe));
    // The reversed transform only aligns the next pair; its losses are not delivered.
    peer = pastMany(peer, [mutation], flip(side), limit, state, observation);
    state = state.after(mutation, true);
    observation.peak = Math.max(observation.peak, result.length + peer.length);
    if (result.length + peer.length > limit) {
      const error = new RefusedEditError('growth', `past ${limit} mutations`);
      error.mutationId = mutation.id;
      error.againstMutationId = b.id;
      throw error;
    }
  }
  return result;
}
