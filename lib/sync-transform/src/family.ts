import type { AxisEdit } from './axis.ts';
import type { Mutation, Side } from './types.ts';

export type Axis = 'row' | 'column';

/** The range keys a row or column span lives in. */
export const axisKeys = (axis: Axis) =>
  axis === 'row' ? (['startRow', 'endRow'] as const) : (['startColumn', 'endColumn'] as const);

/**
 * A group of mutations that can conflict with each other. Mutations in
 * different families touch disjoint parts of a document and commute, except
 * that a structural edit re-addresses every family through `remap`.
 */
export interface Family {
  readonly ids: readonly string[];
  /** Re-addresses `mutation` after rows or columns of its sheet changed. */
  remap(mutation: Mutation, axis: Axis, edit: AxisEdit): Mutation[];
  /** Transforms `a` past `b`; both are in this family and on the same sheet. */
  transform(a: Mutation, b: Mutation, side: Side): Mutation[];
}

/** For families whose state does not depend on row or column positions. */
export const unaffected = (mutation: Mutation): Mutation[] => [mutation];
