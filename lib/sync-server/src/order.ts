import type { IWorkbookData } from '@univerjs/core';
import type { Mutation } from '@spinel/sync-transform';
import type { SyncRevision, SyncUnit } from './types.ts';
import { MAX_WORKSHEETS, SyncError } from './types.ts';

const insert = 'sheet.mutation.insert-sheet';
const remove = 'sheet.mutation.remove-sheet';
const move = 'sheet.mutation.set-worksheet-order';

function position(value: unknown, last: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > last)
    throw new SyncError('malformed');
  return value as number;
}

function identity(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new SyncError('malformed');
  return value;
}

/** Apply (or undo) only the worksheet permutation, validating each pre-step ID.
 * The actual native handler removes/moves by ID while the transform uses these
 * positions: accepting disagreement would make later clients transform another
 * sheet. This function never allocates by a sender-supplied coordinate. */
export function applySheetOrder(base: string[], mutations: Mutation[], reverse = false): string[] {
  if (
    !Array.isArray(base) ||
    base.some((id) => typeof id !== 'string' || !id) ||
    new Set(base).size !== base.length
  )
    throw new SyncError('malformed');
  if (base.length > MAX_WORKSHEETS) throw new SyncError('capacity');
  const order = [...base];
  for (const mutation of reverse ? [...mutations].reverse() : mutations) {
    const p = mutation.params;
    if (mutation.id === insert || mutation.id === remove) {
      const id = identity(mutation.id === insert ? p.sheet?.id : p.subUnitId);
      const adding = reverse ? mutation.id === remove : mutation.id === insert;
      const index = position(p.index, adding ? order.length : order.length - 1);
      if (adding) {
        if (order.includes(id)) throw new SyncError('malformed');
        if (order.length === MAX_WORKSHEETS) throw new SyncError('capacity');
        order.splice(index, 0, id);
      } else {
        if (order[index] !== id) throw new SyncError('malformed');
        order.splice(index, 1);
      }
    } else if (mutation.id === move) {
      const id = identity(p.subUnitId);
      const from = position(reverse ? p.toOrder : p.fromOrder, order.length - 1);
      const to = position(reverse ? p.fromOrder : p.toOrder, order.length - 1);
      if (order[from] !== id) throw new SyncError('malformed');
      order.splice(from, 1);
      order.splice(to, 0, id);
    }
  }
  return order;
}

/** Reverse validated accepted operations over the live order. Their exact
 * position metadata is already in the durable log, so no per-revision snapshot
 * or second retained copy of worksheet order is necessary. */
export function sheetOrderAt(unit: SyncUnit, revision: number, later: SyncRevision[]): string[] {
  let order = [...(unit.snapshot as IWorkbookData).sheetOrder];
  let expected = unit.revision;
  for (const entry of [...later].reverse()) {
    if (entry.revision <= revision) continue;
    if (entry.revision !== expected || entry.unitId !== unit.unitId) throw new SyncError('stale');
    try {
      order = applySheetOrder(order, entry.mutations, true);
    } catch {
      throw new SyncError('stale');
    }
    expected--;
  }
  if (expected !== revision) throw new SyncError('stale');
  return order;
}
