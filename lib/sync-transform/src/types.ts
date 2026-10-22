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
 * Transforms `a` so it applies after `b`, where both were made from the same
 * document. For every pair, applying `b` then `transform(a, b, side)` must give
 * the same document as applying `a` then `transform(b, a, flip(side))`.
 * Returns zero or more mutations: an edit can vanish, or split in two.
 */
export type PairTransform = (a: Mutation, b: Mutation, side: Side) => Mutation[];

/** Thrown for a mutation with no transform, so it is never merged by guesswork. */
export class UnsupportedMutationError extends Error {
  readonly mutationId: string;
  constructor(mutationId: string) {
    super(`No transform for mutation ${mutationId}.`);
    this.name = 'UnsupportedMutationError';
    this.mutationId = mutationId;
  }
}

/** Why a RefusedEditError refused an edit; its doc describes each. */
export type RefusalReason = 'moved-cells' | 'format-race' | 'growth';

/**
 * Thrown when two concurrent edits cannot be merged, so the server refuses
 * the later one and its sender discards its pending edits and resyncs.
 * `'moved-cells'`: a dragged range or a shift and an edit in its area, which
 * for a shift runs across its band from its start to the sheet's edge: an
 * edit of a cell there, another drag or shift, a row or column edit that cuts
 * it, or for a shift a merge there. `'format-race'`: a number-format change
 * and a write to one of its cells that sets no value. `'growth'`: a transform
 * that would grow past its limit. Unlike UnsupportedMutationError it is a
 * race, not a sender bug.
 */
export class RefusedEditError extends Error {
  readonly reason: RefusalReason;
  constructor(reason: RefusalReason, detail?: string) {
    super(`Edit refused: ${reason}${detail ? ` (${detail})` : ''}.`);
    this.name = 'RefusedEditError';
    this.reason = reason;
  }
}
