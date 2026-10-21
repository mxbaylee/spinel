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

/**
 * Thrown when two concurrent edits cannot be merged, so the server refuses
 * the later one and its sender discards its pending edits and resyncs.
 * `'moved-cells'`: a dragged range and an edit of a cell it moves.
 * `'overlapping-moves'`: two moves of the same cells; a shift cut by a move,
 * a row or column edit or a shift on the other axis; a shift that inserts at
 * the sheet's end against a same-axis shift of only part of its band; or two
 * shifts of one band that carry a line differently. `'format-race'`: a
 * number-format change and a write to one of its cells that sets no value.
 * `'growth'`: a transform that would grow past its limit. Unlike
 * UnsupportedMutationError it is a race, not a sender bug.
 */
export class RefusedEditError extends Error {
  readonly reason: 'overlapping-moves' | 'moved-cells' | 'format-race' | 'growth';
  constructor(
    reason: 'overlapping-moves' | 'moved-cells' | 'format-race' | 'growth',
    detail?: string,
  ) {
    super(`Edit refused: ${reason}${detail ? ` (${detail})` : ''}.`);
    this.name = 'RefusedEditError';
    this.reason = reason;
  }
}
