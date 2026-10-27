import { isFormulaId, isFormulaString, normalizeTextRuns } from '@univerjs/core';
import type { ICellData, IDocumentData, IWorkbookData } from '@univerjs/core';
import { Cells } from './state.ts';
import type { BaseCells } from './state.ts';
import type { Mutation } from './types.ts';

/** Stable native-value encoding shared by the browser and durable server hash. */
export function canonical(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .filter(([, child]) => child !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      );
    return input;
  };
  return JSON.stringify(sort(value));
}

/** Resolve only the native style slot; opaque custom metadata retains its meaning. */
export function inlineSnapshotCell(
  snapshot: IWorkbookData,
  { sheetId, row, column }: { sheetId: string; row: number; column: number },
): ICellData | null {
  const cell = snapshot.sheets[sheetId]?.cellData?.[row]?.[column];
  if (!cell) return null;
  const s = typeof cell.s === 'string' ? snapshot.styles?.[cell.s] : cell.s;
  return { ...cell, s };
}

/** Match native defaults without discarding rich text, formulas or custom metadata. */
export function normalizedCell(cell: ICellData | null | undefined) {
  if (!cell) return null;
  const value = structuredClone(cell) as Record<string, any>;
  delete value.t;
  // Native calculation writes a local scalar cache into formula/shared-formula
  // cells. Its timing must not change authored-content verification. Array
  // spills live in a display interceptor, so ordinary raw cells retain v even
  // when they carry array metadata. Keep rich text, styles and formula identity.
  if (isFormulaString(value.f) || isFormulaId(value.si)) delete value.v;
  for (const field of Object.keys(value)) if (value[field] == null) delete value[field];
  if (value.s && typeof value.s === 'object') {
    for (const decoration of ['ul', 'ol', 'st']) {
      const line = value.s[decoration];
      if (line && typeof line === 'object') delete line.cl;
    }
    for (const field of Object.keys(value.s)) if (value.s[field] == null) delete value.s[field];
    if (!Object.keys(value.s).length) delete value.s;
  }
  if (value.p?.body) value.p.body = normalizedDocBody(value.p.body);
  return Object.keys(value).length ? value : null;
}

export function normalizedDocBody(body: IDocumentData['body']) {
  if (!body) return null;
  const value = structuredClone(body);
  if (value.textRuns) value.textRuns = normalizeTextRuns(value.textRuns);
  for (const paragraph of value.paragraphs ?? []) {
    if (paragraph.bullet?.textStyle && !Object.keys(paragraph.bullet.textStyle).length)
      delete paragraph.bullet.textStyle;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => !(Array.isArray(child) && child.length === 0)),
  );
}

/**
 * A lazy, exact base for an unsent buffer made after the old inflight batch.
 * Keep the source unchanged until all transforms using this reader complete.
 * An optional charge function bounds addresses, expanded values and every
 * retained intermediate cache; it runs before deep clones of source cells.
 */
export function cellsAfter(
  base: BaseCells,
  mutations: readonly Mutation[],
  charge?: (value: unknown) => void,
): BaseCells {
  let state = Cells.of(base, charge);
  for (const mutation of mutations) state = state.after(mutation);
  return state.get.bind(state);
}
