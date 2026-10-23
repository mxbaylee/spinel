/** A Univer mutation as it travels between clients: its command id and params. */
export interface Mutation<P = any> {
  id: string;
  params: P;
}

/**
 * Which side wins when two concurrent edits conflict. `left` means the edit
 * being transformed wins; its peer is transformed with `right`.
 *
 * Decision (owner, chat 2026-10-20): the edit the server accepted first wins,
 * per cell and key, index or setting, so the other person's unrelated changes
 * to the same cell survive. Last-writer-wins would need the server to rewrite
 * edits it had already acknowledged.
 */
export type Side = 'left' | 'right';

export function flip(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

/**
 * Thrown for a mutation with no transform, so it is never merged by guesswork.
 *
 * Diagnostics (SPN-032, not built): the server counts these as
 * `sync.edit.unsupported` by `mutationId` and logs at error. One means a
 * sender bug or a Univer upgrade that added a mutation, never a user race.
 */
export class UnsupportedMutationError extends Error {
  readonly mutationId: string;
  constructor(mutationId: string) {
    super(`No transform for mutation ${mutationId}.`);
    this.name = 'UnsupportedMutationError';
    this.mutationId = mutationId;
  }
}

/** Why a RefusedEditError refused an edit; its doc describes each. */
export type RefusalReason = 'moved-cells' | 'format-race' | 'name-race' | 'formula-race' | 'growth';

/**
 * Thrown when two concurrent edits cannot be merged, so the server refuses
 * the later one and its sender discards its pending edits and resyncs.
 * `'moved-cells'`: a dragged range or a shift and an edit in its area, which
 * for a shift runs across its band from its start to the sheet's edge: an
 * edit of a cell there, another drag or shift, a row or column edit that cuts
 * it, or for a shift a merge there; also a cut to another sheet and a removal
 * of its target sheet. `'format-race'`: a number-format change and a write
 * to one of its cells that sets no value. `'name-race'`: a defined-name set
 * or removal and a concurrent edit that makes Univer rewrite names (a row or
 * column insert, remove or move, a range move, a sheet removal, or a sheet or
 * workbook rename), or two sets of different ids that give them the same
 * text, in any case or scope. `'formula-race'`: a write of a cell formula
 * and a concurrent edit that makes Univer rewrite formulas (any of those that
 * rewrite names, or a defined-name set or removal, unless the formula's own
 * edit sets or removes that name too), or a command's rewrite of a formula
 * and a concurrent write of no formula to its cell, such as a typed value.
 * `'growth'`: a transform that would grow past its limit. Unlike
 * UnsupportedMutationError it is a race, not a sender bug.
 *
 * Diagnostics (SPN-032, not built): the server counts each refusal as
 * `sync.edit.refused` by `reason`, against `sync.edit.transformed` for the
 * rate, and logs at info, since a refusal is the designed outcome of a race.
 * To tell which rule to replace with a real merge, it would also carry the
 * ids of the two mutations that raced, as labels; never their params, which
 * hold cell content. The sender's resync is the cost to measure (SPN-058).
 */
export class RefusedEditError extends Error {
  readonly reason: RefusalReason;
  constructor(reason: RefusalReason, detail?: string) {
    super(`Edit refused: ${reason}${detail ? ` (${detail})` : ''}.`);
    this.name = 'RefusedEditError';
    this.reason = reason;
  }
}

/**
 * Refuses two concurrent sequences for `reason` when a mutation of `a` and one
 * of `b`, in the same workbook, `race`. They are checked whole, before any
 * pair is transformed, for races that an earlier pair would hide.
 */
export function refuseRaces(
  a: Mutation[],
  b: Mutation[],
  race: (x: Mutation, y: Mutation) => boolean,
  reason: RefusalReason,
): void {
  for (const x of a) {
    for (const y of b) {
      if (x.params.unitId === y.params.unitId && race(x, y)) throw new RefusedEditError(reason);
    }
  }
}
