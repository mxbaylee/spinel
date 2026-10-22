import { ActionIterator, JSON1 } from '@univerjs/core';
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

type Op = Parameters<typeof JSON1.type.transformNoConflict>[0];

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
  const [mine, theirs] = [a, b].map(({ params }) => withoutUnstyledRuns(params.actions) as Op);
  const transformed = JSON1.type.transformNoConflict(mine, theirs, side);
  if (JSON1.type.isNoop(transformed)) return [];
  const merged = withoutTransformClears(transformed, mine, theirs);
  const actions = side === 'right' ? withPeerParagraphIds(merged, theirs) : merged;
  const { layoutState: _layoutState, ...params } = a.params;
  return [{ id: a.id, params: { ...params, actions } }];
}

/**
 * Univer's TextX.transform keeps the transformed edit's own `paragraphId`
 * wherever both edits cover the same paragraph, so whichever lands last
 * names it. That matters because an id can change: DeleteTextCommand
 * (`deleteSelectionTextX`) looks for the paragraph after the deleted range
 * with `startIndex >= end - 1`, which matches the deleted paragraph itself
 * when the range ends just past its break, and its merging cover then gives
 * the next paragraph the deleted one's id. So a losing edit takes the
 * winner's id for every paragraph the winner covers with one: the first
 * accepted edit's id stands on every screen.
 *
 * Where the winner covers a paragraph without an id, the loser keeps its
 * own. Nothing stateless can do better: had the loser landed first, the
 * winner could not restore an id it never saw. Univer's paragraph covers all
 * carry ids, so this does not arise from its commands.
 */
function withPeerParagraphIds(op: unknown, peer: unknown): unknown {
  const ids = new Map<string, Map<number, string>>();
  forEachText(peer, (component, path) => {
    const here = new Map<number, string>();
    let at = 0;
    for (const action of component.e ?? []) {
      if (action.t === 'd') continue;
      for (const { startIndex, paragraphId } of paragraphsOf(action)) {
        if (paragraphId !== undefined) here.set(at + startIndex, paragraphId);
      }
      at += action.len;
    }
    ids.set(path, here);
  });
  return mapText(op, (component, path) => {
    const here = ids.get(path);
    if (!here?.size) return component;
    let at = 0;
    const e = (component.e ?? []).map((action) => {
      const paragraphs = paragraphsOf(action);
      const from = at;
      if (action.t !== 'i') at += action.len;
      if (action.t !== 'r' || paragraphs.length === 0) return action;
      const named = paragraphs.map((p) => {
        const id = here.get(from + p.startIndex);
        return id === undefined ? p : { ...p, paragraphId: id };
      });
      return { ...action, body: { ...action.body, paragraphs: named } };
    });
    return { ...component, e };
  });
}

interface Paragraph {
  startIndex: number;
  paragraphId?: string;
}
type TextComponent = { et: 'text-x'; e?: TextAction[] };

const paragraphsOf = (action: TextAction) =>
  action.t === 'r' ? ((action.body?.paragraphs as Paragraph[] | undefined) ?? []) : [];

/** Calls `visit` with each text-x component of a json1 op and its path. */
function forEachText(op: unknown, visit: (component: TextComponent, path: string) => void) {
  mapText(op, (component, path) => {
    visit(component, path);
    return component;
  });
}

/** A json1 op with each text-x component replaced by `replace`'s result. */
function mapText(
  op: unknown,
  replace: (component: TextComponent, path: string) => unknown,
  path: (string | number)[] = [],
): unknown {
  if (!Array.isArray(op)) return op;
  const here = [...path];
  return op.map((item: unknown) => {
    if (Array.isArray(item)) return mapText(item, replace, here);
    if (typeof item === 'string' || typeof item === 'number') {
      here.push(item);
      return item;
    }
    const component = item as { et?: string } | null;
    return component?.et === 'text-x'
      ? replace(component as TextComponent, JSON.stringify(here))
      : item;
  });
}

interface TextAction {
  t: string;
  len: number;
  coverType?: number;
  body?: Record<string, unknown>;
}

/**
 * In a merging retain, Univer's apply (updateAttribute) reads an empty list
 * as "clear this range": `textRuns` (coverTextRuns), `customRanges`
 * (updateCustomRanges: DeleteDocHyperLinkCommand's unlink is exactly that),
 * and the lists it deletes and inserts again: `paragraphs`, `sectionBreaks`,
 * `customBlocks`, `docxRawCustomBlocks`, `tables`, `columnGroups` and
 * `blockRanges`. Only `customDecorations: []` changes nothing. So a list the
 * sender sent empty is kept, whatever its key.
 *
 * TextX.transform also returns empty lists of its own. `textRuns: []` means
 * "no change" where the winner's styles override all of the loser's, or
 * either side's slice has none (transformTextRuns); applied, the loser would
 * wipe the winner's styles. `customRanges: []` comes where the sender linked
 * text the peer unlinked (transformCustomRanges); the unlink has already
 * cleared that span here, so applied it changes nothing. Both are dropped.
 * Each retain with a body in the transformed op is a slice of one of the
 * sender's actions (TextX joins only retains without one), so mapping its
 * start back past the peer's edit finds the action, and an empty list it did
 * not have is the transform's.
 */
function withoutTransformClears(op: unknown, input: unknown, peer: unknown): unknown {
  const sent = new Map<string, TextAction[]>();
  const peers = new Map<string, TextAction[]>();
  forEachText(input, (component, path) => sent.set(path, component.e ?? []));
  forEachText(peer, (component, path) => peers.set(path, component.e ?? []));
  return mapText(op, (component, path) => {
    const actions = sent.get(path) ?? [];
    let at = 0;
    const e = (component.e ?? []).map((action) => {
      const from = at;
      if (action.t !== 'i') at += action.len;
      if (action.t !== 'r' || action.coverType === 1 || !action.body) return action;
      const own = actionAt(actions, inputPosition(peers.get(path) ?? [], from));
      const body = Object.fromEntries(
        Object.entries(action.body).filter(
          ([key, value]) => !isEmpty(value) || isEmpty(own?.body?.[key]),
        ),
      );
      return { ...action, body };
    });
    return { ...component, e };
  });
}

const isEmpty = (value: unknown) => Array.isArray(value) && value.length === 0;

/** The position before `peer` of position `at` after it, inside text it kept. */
function inputPosition(peer: TextAction[], at: number): number {
  let after = 0;
  let before = 0;
  for (const { t, len } of peer) {
    if (t === 'd') before += len;
    else if (at < after + len) return before + at - after;
    else {
      after += len;
      if (t === 'r') before += len;
    }
  }
  return before + at - after;
}

/** The retain or delete among `actions` that covers input position `at`. */
function actionAt(actions: TextAction[], at: number): TextAction | undefined {
  let from = 0;
  for (const action of actions) {
    if (action.t === 'i') continue;
    if (at < from + action.len) return action;
    from += action.len;
  }
  return undefined;
}

/**
 * TextX.transform slices both retains to a common length, the slice drops
 * runs with no style, and a slice left with `textRuns: []` makes it return
 * `[]` for the other side's runs, dropping their styles there. A transformed
 * loser keeps `ts: {}` where the winner overrode it, so the next edit of a
 * batch, transformed past it, lost its styles. Splitting such a retain where
 * its runs start and end, and dropping the runs from the parts with no style,
 * leaves no slice that empty. A list the sender sent empty is left alone.
 */
function withoutUnstyledRuns(op: unknown): unknown {
  return mapText(op, (component) => ({ ...component, e: component.e?.flatMap(splitAtRuns) }));
}

interface TextRun {
  st: number;
  ed: number;
  ts?: Record<string, unknown>;
  sId?: string;
}

const styled = ({ ts, sId }: TextRun) => sId != null || Object.keys(ts ?? {}).length > 0;

/**
 * A merging retain as retains each a slice of it, cut where its runs start and
 * end, if it has a run with no style or a stretch no run covers. Univer's own
 * ActionIterator cuts them, as TextX.transform would.
 */
function splitAtRuns(action: TextAction): TextAction[] {
  const runs = action.body?.textRuns as TextRun[] | undefined;
  if (action.t !== 'r' || action.coverType === 1 || !runs?.length) return [action];
  const { len } = action;
  let covered = 0;
  for (const run of runs)
    covered = run.st <= covered && styled(run) ? Math.max(covered, run.ed) : covered;
  if (covered >= len && runs.every(styled)) return [action];
  const cuts = [...new Set([0, len, ...runs.flatMap(({ st, ed }) => [st, ed])])]
    .filter((at) => at >= 0 && at <= len)
    .sort((x, y) => x - y);
  const iterator = new ActionIterator([action as never]);
  return cuts.slice(1).map((at, i) => {
    const part = iterator.next(at - cuts[i]) as TextAction;
    const textRuns = (part.body?.textRuns as TextRun[] | undefined)?.filter(styled);
    const { textRuns: _textRuns, ...rest } = part.body!;
    return { ...part, body: textRuns?.length ? { ...rest, textRuns } : rest };
  });
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
