import { transformAxis } from './axis.ts';
import type { AxisEdit, AxisStep } from './axis.ts';
import { axisKeys } from './family.ts';
import type { Axis } from './family.ts';
import type { Mutation, Side } from './types.ts';

/**
 * Univer 1.1.0 row, column and sheet mutation ids. Kept as strings so the
 * transforms load without Univer's plugins; tests/ids.test.ts checks every id
 * the transforms support against Univer's registry.
 */
export const structureIds = {
  insertRow: 'sheet.mutation.insert-row',
  insertCol: 'sheet.mutation.insert-col',
  removeRow: 'sheet.mutation.remove-rows',
  removeCol: 'sheet.mutation.remove-col',
  moveRows: 'sheet.mutation.move-rows',
  moveCols: 'sheet.mutation.move-columns',
  insertSheet: 'sheet.mutation.insert-sheet',
  removeSheet: 'sheet.mutation.remove-sheet',
  setWorksheetOrder: 'sheet.mutation.set-worksheet-order',
} as const;

/** Row and column inserts, removes and moves, which re-address every other edit. */
const axes = {
  row: {
    insert: structureIds.insertRow,
    remove: structureIds.removeRow,
    move: structureIds.moveRows,
  },
  column: {
    insert: structureIds.insertCol,
    remove: structureIds.removeCol,
    move: structureIds.moveCols,
  },
} as const;

export const axisIds: readonly string[] = [
  ...Object.values(axes.row),
  ...Object.values(axes.column),
];

export function axisEdit(mutation: Mutation): { axis: Axis; edit: AxisEdit } | null {
  for (const axis of ['row', 'column'] as const) {
    const [start, end] = axisKeys(axis);
    const { insert, remove, move } = axes[axis];
    const p = mutation.params;
    if (mutation.id === insert || mutation.id === remove) {
      const count = p.range[end] - p.range[start] + 1;
      const kind = mutation.id === insert ? 'insert' : 'remove';
      return { axis, edit: { kind, at: p.range[start], count } };
    }
    if (mutation.id === move) {
      const from = p.sourceRange[start];
      const count = p.sourceRange[end] - from + 1;
      return { axis, edit: { kind: 'move', from, count, to: p.targetRange[start] } };
    }
  }
  return null;
}

function toMutation(self: Mutation, axis: Axis, step: AxisStep): Mutation {
  const [start, end] = axisKeys(axis);
  const { unitId, subUnitId } = self.params;
  const template = self.params.range ?? self.params.sourceRange;
  const range = (at: number, count: number) => ({
    ...template,
    [start]: at,
    [end]: at + count - 1,
  });
  if (step.kind === 'remove') {
    return {
      id: axes[axis].remove,
      params: { unitId, subUnitId, range: range(step.at, step.count) },
    };
  }
  if (step.kind === 'move') {
    const params = {
      unitId,
      subUnitId,
      sourceRange: range(step.from, step.count),
      targetRange: range(step.to, step.count),
    };
    return { id: axes[axis].move, params };
  }
  const infoKey = axis === 'row' ? 'rowInfo' : 'colInfo';
  const params: Record<string, unknown> = { unitId, subUnitId, range: range(step.at, step.count) };
  const info = self.params[infoKey];
  if (info) {
    // Info is keyed from the start of the insert; keep this slice's entries.
    const slice: Record<number, unknown> = {};
    for (let i = 0; i < step.count; i++) {
      if (info[step.offset + i] !== undefined) slice[i] = info[step.offset + i];
    }
    params[infoKey] = slice;
  }
  return { id: axes[axis].insert, params };
}

/**
 * Re-addresses the span a range covers along the other axis (a row edit's
 * columns), so a whole-width range stays whole-width: an insert inside or just
 * after it extends it, and a remove shrinks it by the overlap. Univer's handlers
 * ignore this span, but the merge listener tests a move against it.
 */
function across(range: Record<string, number>, axis: Axis, edit: AxisEdit) {
  if (edit.kind === 'move') return range;
  const [start, end] = axisKeys(axis);
  const first = range[start];
  const last = range[end];
  if (edit.kind === 'insert') {
    const before = edit.at < first ? edit.count : 0;
    const inside = edit.at <= last + 1 ? edit.count : 0;
    return { ...range, [start]: first + before, [end]: last + inside };
  }
  const k = edit.at + edit.count - 1;
  const before = Math.max(0, Math.min(k, first - 1) - edit.at + 1);
  const overlap = Math.max(0, Math.min(k, last) - Math.max(edit.at, first) + 1);
  return {
    ...range,
    [start]: first - before,
    [end]: Math.max(first - before, last - before - overlap),
  };
}

/** Transforms a structural edit past another on the same sheet. */
export function transformStructure(a: Mutation, b: Mutation, side: Side): Mutation[] {
  const self = axisEdit(a)!;
  const peer = axisEdit(b)!;
  if (self.axis !== peer.axis) {
    const params = { ...a.params };
    for (const key of ['range', 'sourceRange', 'targetRange']) {
      if (params[key]) params[key] = across(params[key], peer.axis, peer.edit);
    }
    return [{ id: a.id, params }];
  }
  return transformAxis(self.edit, peer.edit, side).map((step) => toMutation(a, self.axis, step));
}

/**
 * A workbook's sheet order is an axis too. RemoveSheetMutation carries no
 * position, so the sender must add `index`, the sheet's place in the order
 * before removal (see README). SetWorksheetOrderMutation's `toOrder` counts
 * after the sheet is taken out; an AxisEdit's `to` counts before.
 *
 * Decision (owner, chat 2026-10-20): two removals that together leave no sheet
 * both go through here; the sync server checks the merged workbook and refuses
 * the second (SPN-057). No transform of one pair can see the whole workbook,
 * and refusing every removal that might collide would block them whenever two
 * people edit.
 */
export const sheetOrderIds: readonly string[] = [
  structureIds.insertSheet,
  structureIds.removeSheet,
  structureIds.setWorksheetOrder,
];

function sheetEdit(mutation: Mutation): AxisEdit {
  const p = mutation.params;
  if (mutation.id === structureIds.insertSheet) return { kind: 'insert', at: p.index, count: 1 };
  if (mutation.id === structureIds.removeSheet) return { kind: 'remove', at: p.index, count: 1 };
  const to = p.toOrder < p.fromOrder ? p.toOrder : p.toOrder + 1;
  return { kind: 'move', from: p.fromOrder, count: 1, to };
}

function sheetId(mutation: Mutation): string {
  return mutation.params.subUnitId ?? mutation.params.sheet.id;
}

function sheetMutations(self: Mutation, peer: Mutation, step: AxisStep): Mutation[] {
  if (step.kind !== 'move') return [{ id: self.id, params: { ...self.params, index: step.at } }];
  // Only sheets an edit named are ever moved; look each one up by its position.
  const moves = [peer, self].filter((m) => m.id === structureIds.setWorksheetOrder);
  const named = new Map(moves.map((m) => [m.params.fromOrder as number, sheetId(m)]));
  const forward = step.to > step.from;
  return step.items.map((item, i) => ({
    id: structureIds.setWorksheetOrder,
    params: {
      unitId: self.params.unitId,
      subUnitId: named.get(item)!,
      fromOrder: forward ? step.from : step.from + i,
      toOrder: forward ? step.to - 1 : step.to + i,
    },
  }));
}

export function transformSheetOrder(a: Mutation, b: Mutation, side: Side): Mutation[] {
  return transformAxis(sheetEdit(a), sheetEdit(b), side).flatMap((step) =>
    sheetMutations(a, b, step),
  );
}
