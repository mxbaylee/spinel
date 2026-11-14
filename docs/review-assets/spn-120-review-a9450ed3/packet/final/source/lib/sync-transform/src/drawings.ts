import { JSON1 } from '@univerjs/core';
import { unaffected } from './family.ts';
import type { Family } from './family.ts';
import type { Mutation, Side } from './types.ts';

export const drawingIds = {
  apply: 'sheet.mutation.set-drawing-apply',
  backgroundImage: 'sheet.mutation.set-worksheet-background-image',
} as const;

/**
 * SetDrawingApply's `op` is one ot-json1 op over the drawing manager's tree
 * `{[unitId]: {[subUnitId]: {data: {[drawingId]: drawing}, order: string[]}}}`,
 * so json1 transforms it whole; write conflicts go to the winning side.
 *
 * `objects` only names the drawings whose renderers are notified, and every
 * listener looks the drawing up again and skips it when it is gone, so it
 * passes unchanged. An op left empty (both sides removed the same drawing,
 * say) is dropped.
 */
function transformApply(a: Mutation, b: Mutation, side: Side): Mutation[] {
  const op = JSON1.type.transformNoConflict(a.params.op, b.params.op, side);
  if (JSON1.type.isNoop(op)) return [];
  return [{ id: a.id, params: { ...a.params, op } }];
}

export const drawings: Family = {
  ids: Object.values(drawingIds),
  // Drawing anchors are not moved by row or column mutations: the issuing
  // client's command emits companion SetDrawingApply mutations, computed from
  // its layout, for the drawings it knows. A drawing added concurrently keeps
  // its anchor on every client, so passing it unchanged is what converges.
  // Decision (owner, chat 2026-10-20): so a drawing can sit off by the rows
  // someone inserted at the same moment; both screens agree (README, "Known
  // limits"). Re-deriving its place would need the sender's layout.
  remap: unaffected,
  transform(a, b, side) {
    if (a.id !== b.id) return [a];
    if (a.id === drawingIds.apply) return transformApply(a, b, side);
    // Two background images on one sheet: the winner's stands.
    return side === 'left' ? [a] : [];
  },
};
