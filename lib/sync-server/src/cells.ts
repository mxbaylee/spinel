import { createHash } from 'node:crypto';
import type { ICellData, IDocumentData, IWorkbookData } from '@univerjs/core';
import type { BaseCells, Mutation } from '@spinel/sync-transform';
import {
  canonical,
  inlineSnapshotCell as inlineCell,
  normalizedCell as hashCell,
  normalizedDocBody as normalizedBody,
} from '@spinel/sync-transform';
import type {
  CellAddress,
  CellBeforeImage,
  NativeSnapshot,
  SyncRevision,
  SyncUnit,
  Touched,
} from './types.ts';
import { MAX_CELL_WORK_BYTES, SyncError } from './types.ts';
import { sheetRangePath } from './geometry.ts';

export { canonical };
export const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Compact IDs and shared styles can expand once per cell. Charge each encoded
 * key/value before retaining or cloning it, including lazy transform base reads. */
class CellBudget {
  private remaining = MAX_CELL_WORK_BYTES;
  json(value: unknown): string {
    const encoded = JSON.stringify(value);
    this.remaining -= Buffer.byteLength(encoded);
    if (this.remaining < 0) throw new SyncError('capacity');
    return encoded;
  }
  key({ sheetId, row, column }: CellAddress): string {
    return this.json([sheetId, row, column]);
  }
  clone(cell: ICellData | null): ICellData | null {
    this.json(cell);
    return structuredClone(cell);
  }
}

export function snapshotCells(snapshot: IWorkbookData): BaseCells {
  const budget = new CellBudget();
  return (unitId, sheetId, row, column) => {
    if (snapshot.id !== unitId) return null;
    const address = { sheetId, row, column };
    budget.key(address);
    return budget.clone(inlineCell(snapshot, address));
  };
}

function allCells(snapshot: IWorkbookData, budget: CellBudget): Map<string, CellBeforeImage> {
  const cells = new Map<string, CellBeforeImage>();
  for (const [sheetId, sheet] of Object.entries(snapshot.sheets)) {
    for (const [r, columns] of Object.entries(sheet.cellData ?? {})) {
      for (const [c, cell] of Object.entries(columns ?? {})) {
        if (!cell) continue;
        const address = { sheetId, row: Number(r), column: Number(c) };
        const id = budget.key(address);
        cells.set(id, { ...address, value: budget.clone(inlineCell(snapshot, address)) });
      }
    }
  }
  return cells;
}

/** Capture only changed native cells. Comparing both coordinate sets covers moves,
 * inserted/deleted axes and whole removed/restored sheets without inverse commands. */
export function changes(
  before: NativeSnapshot,
  after: NativeSnapshot,
  kind: SyncUnit['kind'],
  mutations: Mutation[],
) {
  if (kind === 'doc')
    return { beforeCells: [] as CellBeforeImage[], touched: { kind: 'doc' } as Touched };
  const old = allCells(before as IWorkbookData, new CellBudget());
  const next = allCells(after as IWorkbookData, new CellBudget());
  const changed: { id: string; image: CellBeforeImage }[] = [];
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id);
    const b = next.get(id);
    if (canonical(a?.value ?? null) === canonical(b?.value ?? null)) continue;
    const address = a ?? b!;
    changed.push({
      id,
      image: {
        sheetId: address.sheetId,
        row: address.row,
        column: address.column,
        value: a?.value ?? null,
      },
    });
  }
  const beforeCells = changed.sort((a, b) => compare(a.id, b.id)).map(({ image }) => image);
  const budget = new CellBudget();
  const touched = new Map<string, CellAddress>();
  const add = (address: CellAddress) => {
    const id = budget.key(address);
    if (touched.has(id)) return;
    budget.json(address);
    touched.set(id, address);
  };
  for (const { value: _, ...address } of beforeCells) add(address);
  const matrix = (
    data: Record<string, Record<string, unknown>> | undefined,
    sheetId: string | undefined,
  ) => {
    if (!data || typeof sheetId !== 'string') return;
    for (const [row, columns] of Object.entries(data))
      for (const column of Object.keys(columns ?? {})) add({ sheetId, row: +row, column: +column });
  };
  const ranges = (value: unknown, sheetId: string | undefined, path: string[] = []) => {
    const scope = sheetRangePath(path);
    if (!scope) return;
    if (!value || typeof value !== 'object') return;
    const data = value as Record<string, any>;
    if (
      scope === 'range' &&
      typeof sheetId === 'string' &&
      ['startRow', 'endRow', 'startColumn', 'endColumn'].every((field) =>
        Number.isSafeInteger(data[field]),
      )
    ) {
      // Admission uses this same path grammar and bounds aggregate range area.
      for (let row = data.startRow; row <= data.endRow; row++)
        for (let column = data.startColumn; column <= data.endColumn; column++)
          add({ sheetId, row, column });
    }
    if (scope === 'range') return;
    for (const [field, child] of Object.entries(data)) {
      let target = sheetId;
      if (!path.length) {
        if (field === 'fromRange') target = data.from?.subUnitId ?? target;
        else if (field === 'toRange') target = data.to?.subUnitId ?? target;
        else if (field === 'sheet') target = data.sheet?.id;
      }
      ranges(child, target, [...path, field]);
    }
  };
  for (const { id, params } of mutations) {
    if (!id.startsWith('sheet.mutation.')) continue;
    matrix(params.cellValue, params.subUnitId);
    matrix(params.from?.value, params.from?.subUnitId ?? params.subUnitId);
    matrix(params.to?.value, params.to?.subUnitId ?? params.subUnitId);
    ranges(params, params.subUnitId);
  }
  return {
    beforeCells,
    touched: {
      kind: 'sheet',
      cells: [...touched.values()],
    } as Touched,
  };
}

/** Sparse rollback overlays exact before-images over the one live snapshot. */
export function cellsAt(unit: SyncUnit, revision: number, later: SyncRevision[]): BaseCells {
  if (unit.kind !== 'sheet') return () => null;
  const budget = new CellBudget();
  const overrides = new Map<string, ICellData | null>();
  let expected = unit.revision;
  for (const edit of [...later].reverse()) {
    if (edit.revision <= revision) continue;
    if (edit.revision !== expected || edit.beforeCells === null) throw new SyncError('stale');
    for (const image of edit.beforeCells) overrides.set(budget.key(image), image.value);
    expected--;
  }
  if (expected !== revision) throw new SyncError('stale');
  return (unitId, sheetId, row, column) => {
    if (unitId !== unit.unitId) return null;
    const address = { sheetId, row, column };
    const id = budget.key(address);
    return budget.clone(
      overrides.has(id) ? overrides.get(id)! : inlineCell(unit.snapshot as IWorkbookData, address),
    );
  };
}

/** A pending-free client hashes the last applied revision's declared footprint. */
export function hashTouched(snapshot: NativeSnapshot, touched: Touched): string {
  if (touched.kind === 'doc') return digest(normalizedBody((snapshot as IDocumentData).body));
  const book = snapshot as IWorkbookData;
  const budget = new CellBudget();
  const addresses = touched.cells.map((address) => ({ id: budget.key(address), address }));
  addresses.sort((a, b) => compare(a.id, b.id));
  const hash = createHash('sha256').update('[');
  for (const [index, { address }] of addresses.entries()) {
    budget.json(address);
    const value = hashCell(budget.clone(inlineCell(book, address)));
    if (index) hash.update(',');
    hash.update(canonical({ ...address, value }));
  }
  return hash.update(']').digest('hex');
}
