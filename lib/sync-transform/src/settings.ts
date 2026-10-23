import type { AxisEdit } from './axis.ts';
import type { Axis, Family } from './family.ts';
import type { Mutation, Side } from './types.ts';

/**
 * Mutations that each set one value of a sheet, or of the workbook. Two of the
 * same kind conflict and the winner's value stands. Frozen panes do not follow
 * rows: Univer's insert, remove and move commands emit their own SetFrozen,
 * which conflicts like any other.
 *
 * Decision (owner, chat 2026-10-20): so the frozen line can sit off by the rows
 * someone inserted at the same moment; both screens agree (README, "Known
 * limits"). Hiding the last visible sheet twice at once is the sync server's
 * check, as with sheet removal (structure.ts, SPN-057).
 */
export const settingIds = {
  frozen: 'sheet.mutation.set-frozen',
  rowCount: 'sheet.mutation.set-worksheet-row-count',
  columnCount: 'sheet.mutation.set-worksheet-column-count',
  defaultStyle: 'sheet.mutation.set-worksheet-default-style',
  gridlinesColor: 'sheet.mutation.set-gridlines-color',
  gridlines: 'sheet.mutation.toggle-gridlines',
  name: 'sheet.mutation.set-worksheet-name',
  tabColor: 'sheet.mutation.set-tab-color',
  hidden: 'sheet.mutation.set-worksheet-hidden',
  workbookName: 'sheet.mutation.set-workbook-name',
} as const;

/** Insert and remove mutations add their count to the sheet's row or column count. */
const counts = {
  [settingIds.rowCount]: { axis: 'row', field: 'rowCount' },
  [settingIds.columnCount]: { axis: 'column', field: 'columnCount' },
} as const;

function remap(mutation: Mutation, axis: Axis, edit: AxisEdit): Mutation[] {
  const count = counts[mutation.id as keyof typeof counts];
  if (count?.axis !== axis || edit.kind === 'move') return [mutation];
  const by = edit.kind === 'insert' ? edit.count : -edit.count;
  return [
    {
      id: mutation.id,
      params: { ...mutation.params, [count.field]: mutation.params[count.field] + by },
    },
  ];
}

// Diagnostics (SPN-032, not built): `sync.edit.dropped`, rule 'setting-first-accepted'.
const transform = (a: Mutation, b: Mutation, side: Side): Mutation[] =>
  a.id === b.id && side === 'right' ? [] : [a];

export const settings: Family = { ids: Object.values(settingIds), remap, transform };
