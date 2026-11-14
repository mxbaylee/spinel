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

export type DropRule =
  | 'name-first-accepted'
  | 'cell-overwritten'
  | 'merge-cut'
  | 'removed-sheet'
  | 'setting-first-accepted'
  | 'doc-formula-first-accepted';
export type TransformObservation =
  | { kind: 'dropped'; rule: DropRule; value: number }
  | { kind: 'offset'; value: number }
  | { kind: 'growth'; value: number };
export type TransformObserver = (event: TransformObservation) => void;
/** Optional observations cannot change the output or throw through a transform. */
export function observeTransform(
  observer: TransformObserver | undefined,
  event: TransformObservation,
) {
  try {
    observer?.(event);
  } catch {
    /* A broken observer cannot lose an edit. */
  }
}
export type MalformedCheck =
  | 'shift'
  | 'reserved-key'
  | 'claim'
  | 'remove-index'
  | 'inline-style'
  | 'base-cells'
  | 'base-claim'
  | 'tail'
  | 'other';
/** A stable content-free diagnostic code; the inherited message is never telemetry. */
export class MalformedEditError extends TypeError {
  readonly check: MalformedCheck;
  constructor(check: MalformedCheck, message: string) {
    super(message);
    this.name = 'MalformedEditError';
    this.check = check;
  }
}

export function flip(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

/**
 * Thrown for a mutation with no transform, so it is never merged by guesswork.
 *
 * Diagnostics (SPN-057): the server counts these as
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
export type RefusalReason = 'moved-cells' | 'name-race' | 'formula-race' | 'growth';

/**
 * Thrown when two concurrent edits cannot be merged, so the server refuses
 * the later one and its sender discards its pending edits and resyncs. The
 * README's "What it covers" gives each rule in full:
 * - `'moved-cells'`: a drag, shift or cut and an edit in its area, or a
 *   removal of a cut's target sheet.
 * - `'name-race'`: a defined-name edit and an edit that makes Univer rewrite
 *   names, two defined names given the same text, or colliding worksheet
 *   names/inserted IDs (including native add, copy and restore commands).
 * - `'formula-race'`: a formula write and an edit that makes Univer rewrite
 *   formulas, or a command's rewrite of a formula and a write that replaces
 *   its cell's formula with none. Undo/redo cell writes conservatively count
 *   as possible reference rewrites because their original command is hidden.
 * - `'growth'`: a transform that would grow past its limit.
 *
 * Unlike UnsupportedMutationError it is a race, not a sender bug.
 *
 * Diagnostics (SPN-057): the server counts each refusal as
 * `sync.edit.refused` by `reason`, against `sync.edit.transformed` for the
 * rate, and logs at info, since a refusal is the designed outcome of a race.
 * The error also carries the ids of the two mutations that raced; the server
 * maps these through its fixed mutation vocabulary before using them as labels.
 * It never exports error messages or params, which may hold cell content. The sender's resync is the cost to measure (SPN-058).
 */
export class RefusedEditError extends Error {
  readonly reason: RefusalReason;
  mutationId?: string;
  againstMutationId?: string;
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
      if (x.params.unitId === y.params.unitId && race(x, y)) {
        const error = new RefusedEditError(reason);
        error.mutationId = x.id;
        error.againstMutationId = y.id;
        throw error;
      }
    }
  }
}
