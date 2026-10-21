import { JSON1 } from '@univerjs/core';
import { unaffected } from './family.ts';
import type { Family } from './family.ts';
import type { Mutation, Side } from './types.ts';

export const docIds = {
  richText: 'doc.mutation.rich-text-editing',
  rename: 'doc.mutation.rename-doc',
  // The hyperlink mutations' handlers do nothing (links live in the body's
  // custom ranges), so they pass every transform unchanged.
  addHyperLink: 'docs.mutation.add-hyper-link',
  updateHyperLink: 'docs.mutation.update-hyper-link',
  deleteHyperLink: 'docs.mutation.delete-hyper-link',
} as const;

/**
 * A rich-text edit's `actions` are one ot-json1 op over the document snapshot.
 * TextX is registered as json1's `text-x` subtype, so the body, headers,
 * footers, notes and doc drawings (`drawings`, `drawingsOrder`) all transform
 * in one call; json1 resolves write conflicts in favour of the winning side.
 *
 * `textRanges` are left alone: a remote edit never moves the receiver's
 * selection. `layoutState` is dropped: it was captured for the document the
 * edit was made on, so the receiver must lay the result out itself.
 */
function transformRichText(a: Mutation, b: Mutation, side: Side): Mutation[] {
  const transformed = JSON1.type.transformNoConflict(a.params.actions, b.params.actions, side);
  if (JSON1.type.isNoop(transformed)) return [];
  const actions = withoutEmptyMerges(transformed);
  const { layoutState: _layoutState, ...params } = a.params;
  return [{ id: a.id, params: { ...params, actions } }];
}

interface TextAction {
  t: string;
  coverType?: number;
  body?: Record<string, unknown>;
}

/**
 * TextX.transform leaves the losing style edit `textRuns: []` where the
 * winner's styles override all of it, meaning "no change". Univer's apply
 * reads an empty list in a merging retain as "clear these styles", so the
 * loser would wipe the winner's. A merging retain's empty lists change
 * nothing, so they are dropped.
 */
function withoutEmptyMerges(op: unknown): unknown {
  if (Array.isArray(op)) return op.map(withoutEmptyMerges);
  const component = op as { et?: string; e?: TextAction[] } | null;
  if (component?.et !== 'text-x') return op;
  const e = component.e!.map((action) => {
    if (action.t !== 'r' || action.coverType === 1 || !action.body) return action;
    const body = Object.fromEntries(
      Object.entries(action.body).filter(([, v]) => !(Array.isArray(v) && v.length === 0)),
    );
    return { ...action, body };
  });
  return { ...component, e };
}

export const docs: Family = {
  ids: Object.values(docIds),
  // Docs have no rows or columns.
  remap: unaffected,
  transform(a, b, side) {
    if (a.id !== b.id) return [a];
    if (a.id === docIds.richText) return transformRichText(a, b, side);
    // Two renames: the winner's name stands.
    if (a.id === docIds.rename) return side === 'left' ? [a] : [];
    return [a];
  },
};
