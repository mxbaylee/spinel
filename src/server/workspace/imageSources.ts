import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { AuthError } from '../auth/store.ts';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Visit only image-bearing native locations, never URL-looking ordinary text. */
export function imageSources(
  snapshot: IDocumentData | IWorkbookData,
  map: (source: string) => string,
) {
  let nodes = 0;
  const walk = (value: unknown, depth = 0): boolean => {
    if (++nodes > 200_000 || depth > 64)
      throw new AuthError(400, 'Image data is nested too deeply or is too large.');
    if (!value || typeof value !== 'object') return false;
    let changed = false;
    if (object(value) && Object.hasOwn(value, 'source')) {
      if (typeof value.source !== 'string') throw new AuthError(400, 'Invalid document images.');
      const source = map(value.source);
      if (source !== value.source) {
        value.source = source;
        value.imageSourceType = source.startsWith('data:image/') ? 'BASE64' : 'URL';
        changed = true;
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new AuthError(400, 'Invalid document images.');
      changed = walk(child, depth + 1) || changed;
    }
    return changed;
  };
  const document = (doc: IDocumentData & { notes?: unknown }) => {
    for (const value of [
      doc.drawings,
      doc.headers,
      doc.footers,
      doc.footnotes,
      doc.endnotes,
      doc.notes,
    ])
      walk(value);
  };
  document(snapshot as IDocumentData);
  const workbook = snapshot as IWorkbookData;
  for (const sheet of Object.values(workbook.sheets ?? {})) {
    walk(sheet.backgroundImage);
    for (const row of Object.values(sheet.cellData ?? {}))
      for (const cell of Object.values(row ?? {}))
        if (object(cell) && object(cell.p)) document(cell.p as unknown as IDocumentData);
  }
  for (const resource of snapshot.resources ?? []) {
    if (!['DOC_DRAWING_PLUGIN', 'SHEET_DRAWING_PLUGIN'].includes(resource.name)) continue;
    let data: unknown;
    try {
      data = JSON.parse(resource.data);
    } catch {
      throw new AuthError(400, 'Invalid document images.');
    }
    if (walk(data)) resource.data = JSON.stringify(data);
  }
}
