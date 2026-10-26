import { createHash } from 'node:crypto';
import { normalizeTextRuns } from '@univerjs/core';
import type { ICellData, IDocumentData, IWorkbookData } from '@univerjs/core';
import type { BaseCells } from '@spinel/sync-transform';
import type {
  CellAddress,
  CellBeforeImage,
  NativeSnapshot,
  SyncRevision,
  SyncUnit,
  Touched,
} from './types.ts';
import { SyncError } from './types.ts';

/** Stable JSON is shared with clients; no document values enter diagnostics. */
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
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const key = ({ sheetId, row, column }: CellAddress) => JSON.stringify([sheetId, row, column]);

export function snapshotCells(snapshot: IWorkbookData): BaseCells {
  return (unitId, sheetId, row, column) => {
    if (snapshot.id !== unitId) return null;
    const cell = snapshot.sheets[sheetId]?.cellData?.[row]?.[column];
    if (!cell) return null;
    const s = typeof cell.s === 'string' ? snapshot.styles?.[cell.s] : cell.s;
    return structuredClone({ ...cell, s });
  };
}

function allCells(snapshot: IWorkbookData): Map<string, CellBeforeImage> {
  const cells = new Map<string, CellBeforeImage>();
  const read = snapshotCells(snapshot);
  for (const [sheetId, sheet] of Object.entries(snapshot.sheets)) {
    for (const [r, columns] of Object.entries(sheet.cellData ?? {})) {
      for (const [c, cell] of Object.entries(columns ?? {})) {
        if (!cell) continue;
        const address = { sheetId, row: Number(r), column: Number(c) };
        cells.set(key(address), { ...address, value: read(snapshot.id, sheetId, +r, +c) ?? null });
      }
    }
  }
  return cells;
}

/** Capture only changed native cells. Comparing both coordinate sets covers moves,
 * inserted/deleted axes and whole removed/restored sheets without inverse commands. */
export function changes(before: NativeSnapshot, after: NativeSnapshot, kind: SyncUnit['kind']) {
  if (kind === 'doc') return { beforeCells: [] as CellBeforeImage[], touched: { kind: 'doc' } as Touched };
  const old = allCells(before as IWorkbookData);
  const next = allCells(after as IWorkbookData);
  const beforeCells: CellBeforeImage[] = [];
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id);
    const b = next.get(id);
    if (canonical(a?.value ?? null) === canonical(b?.value ?? null)) continue;
    const address = a ?? b!;
    beforeCells.push({ sheetId: address.sheetId, row: address.row, column: address.column, value: a?.value ?? null });
  }
  beforeCells.sort((a, b) => key(a).localeCompare(key(b)));
  return {
    beforeCells,
    touched: {
      kind: 'sheet',
      cells: beforeCells.map(({ value: _, ...address }) => address),
    } as Touched,
  };
}

/** Sparse rollback overlays exact before-images over the one live snapshot. */
export function cellsAt(unit: SyncUnit, revision: number, later: SyncRevision[]): BaseCells {
  if (unit.kind !== 'sheet') return () => null;
  const read = snapshotCells(unit.snapshot as IWorkbookData);
  const overrides = new Map<string, ICellData | null>();
  let expected = unit.revision;
  for (const edit of [...later].reverse()) {
    if (edit.revision <= revision) continue;
    if (edit.revision !== expected || edit.beforeCells === null) throw new SyncError('stale');
    for (const image of edit.beforeCells) overrides.set(key(image), image.value);
    expected--;
  }
  if (expected !== revision) throw new SyncError('stale');
  return (unitId, sheetId, row, column) => {
    if (unitId !== unit.unitId) return null;
    const address = key({ sheetId, row, column });
    return structuredClone(overrides.has(address) ? overrides.get(address)! : read(unitId, sheetId, row, column));
  };
}

/** Match the transform fuzz model's native-only defaults: type is derived, and
 * font color is copied into decoration color during application. Preserve rich
 * text and all other document content rather than reducing it to plain text. */
function hashCell(cell: ICellData | null | undefined) {
  if (!cell) return null;
  const value = structuredClone(cell) as Record<string, any>;
  delete value.t;
  for (const field of Object.keys(value)) if (value[field] == null) delete value[field];
  if (value.s && typeof value.s === 'object') {
    for (const decoration of ['ul', 'ol', 'st']) {
      const line = value.s[decoration];
      if (line && typeof line === 'object') delete line.cl;
    }
    for (const field of Object.keys(value.s)) if (value.s[field] == null) delete value.s[field];
    if (!Object.keys(value.s).length) delete value.s;
  }
  if (value.p?.body) value.p.body = normalizedBody(value.p.body);
  return Object.keys(value).length ? value : null;
}

function normalizedBody(body: IDocumentData['body']) {
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

/** A pending-free client hashes the last applied revision's declared footprint. */
export function hashTouched(snapshot: NativeSnapshot, touched: Touched): string {
  if (touched.kind === 'doc') return digest(normalizedBody((snapshot as IDocumentData).body));
  const book = snapshot as IWorkbookData;
  const read = snapshotCells(book);
  return digest(
    [...touched.cells]
      .sort((a, b) => key(a).localeCompare(key(b)))
      .map((address) => ({
        ...address,
        value: hashCell(read(book.id, address.sheetId, address.row, address.column)),
      })),
  );
}
