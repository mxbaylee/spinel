import type { IWorkbookData, Workbook } from '@univerjs/core';
import type { Mutation } from '@spinel/sync-transform';
import { byteBudget } from './budget.ts';
import { ClientError } from './types.ts';
import type { DocumentKind, NativeSnapshot } from './types.ts';

// Match the server's native geometry limits before an SDK handler can allocate.
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const MAX_SHEETS = 1024;
const MAX_RANGE_CELLS = 250_000;

function coordinate(value: unknown, maximum: number, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new ClientError('malformed');
  if ((value as number) > maximum) throw new ClientError('capacity');
  return value as number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ClientError('malformed');
  return value as Record<string, unknown>;
}

function span(start: unknown, end: unknown, maximum: number): number {
  const first = coordinate(start, maximum);
  const last = coordinate(end, maximum);
  if (last < first) throw new ClientError('malformed');
  return last - first + 1;
}

function dimensions(sheet: Record<string, unknown>) {
  if (sheet.rowCount !== undefined) coordinate(sheet.rowCount, MAX_ROWS, 1);
  if (sheet.columnCount !== undefined) coordinate(sheet.columnCount, MAX_COLUMNS, 1);
}

/** Use native rangeType semantics for the cache footprint, as the server does. */
function mergeBudget(groups: readonly unknown[]) {
  let cells = 0;
  for (const group of groups) {
    if (group === undefined) continue;
    if (!Array.isArray(group)) throw new ClientError('malformed');
    for (const value of group) {
      const range = object(value);
      const type = range.rangeType === undefined ? 0 : range.rangeType;
      if (![0, 1, 2, 3].includes(type as number)) throw new ClientError('malformed');
      const rows = type === 0 || type === 1 ? span(range.startRow, range.endRow, MAX_ROWS - 1) : 1;
      const columns =
        type === 0 || type === 2 ? span(range.startColumn, range.endColumn, MAX_COLUMNS - 1) : 1;
      cells += rows * columns;
      if (cells > MAX_RANGE_CELLS) throw new ClientError('capacity');
    }
  }
}

/** Compact native merge ranges must be bounded before SpanModel expands them. */
export function admitSnapshot(snapshot: NativeSnapshot, kind: DocumentKind) {
  byteBudget()(snapshot);
  if (kind !== 'sheet') return;
  const sheets = Object.values(object((snapshot as IWorkbookData).sheets));
  if (sheets.length > MAX_SHEETS) throw new ClientError('capacity');
  for (const sheet of sheets) dimensions(object(sheet));
  mergeBudget(sheets.map((sheet) => object(sheet).mergeData));
}

/** Only native geometry slots are inspected; cell/custom metadata is opaque. */
function ranges(params: Record<string, any>) {
  let cells = 0;
  const range = (value: unknown) => {
    const data = object(value);
    let axes = 0;
    let area = 1;
    for (const [start, end, maximum] of [
      ['startRow', 'endRow', MAX_ROWS - 1],
      ['startColumn', 'endColumn', MAX_COLUMNS - 1],
    ] as const) {
      if (!(start in data) && !(end in data)) continue;
      area *= span(data[start], data[end], maximum);
      axes++;
    }
    if (!axes) throw new ClientError('malformed');
    cells += area;
    if (cells > MAX_RANGE_CELLS) throw new ClientError('capacity');
  };
  const list = (value: unknown) => {
    if (!Array.isArray(value)) throw new ClientError('malformed');
    for (const entry of value) range(entry);
  };
  for (const key of ['range', 'sourceRange', 'targetRange', 'fromRange', 'toRange'])
    if (params[key] !== undefined) range(params[key]);
  if (params.ranges !== undefined) list(params.ranges);
  if (params.sheet?.mergeData !== undefined) list(params.sheet.mergeData);
  for (const value of Object.values(params.values ?? {})) {
    const nested = value as { ranges?: unknown } | null;
    if (nested?.ranges !== undefined) list(nested.ranges);
  }
}

/** Bound the live model before either local or remote native handlers can allocate. */
export function admitNativeMutation(mutation: Mutation, workbook: Workbook | null) {
  if (!mutation.id.startsWith('sheet.mutation.')) return;
  if (!workbook) throw new ClientError('malformed');
  const { id, params } = mutation;
  dimensions(params);
  ranges(params);
  if (id === 'sheet.mutation.set-worksheet-row-count') coordinate(params.rowCount, MAX_ROWS, 1);
  if (id === 'sheet.mutation.set-worksheet-column-count')
    coordinate(params.columnCount, MAX_COLUMNS, 1);
  if (id === 'sheet.mutation.insert-sheet') {
    const sheet = object(params.sheet);
    dimensions(sheet);
    const order = workbook.getSheetOrders();
    if (order.length >= MAX_SHEETS) throw new ClientError('capacity');
    coordinate(params.index, MAX_SHEETS);
    if (
      params.index > order.length ||
      typeof sheet.id !== 'string' ||
      !sheet.id ||
      order.includes(sheet.id)
    )
      throw new ClientError('malformed');
    mergeBudget([
      ...workbook.getSheets().map((entry) => entry.getConfig().mergeData),
      sheet.mergeData,
    ]);
  } else if (id === 'sheet.mutation.add-worksheet-merge') {
    if (!Array.isArray(params.ranges)) throw new ClientError('malformed');
    // Read the current pre-step model: an earlier removal frees its budget.
    mergeBudget([
      ...workbook.getSheets().map((entry) => entry.getConfig().mergeData),
      params.ranges,
    ]);
  } else if (id === 'sheet.mutation.insert-row' || id === 'sheet.mutation.insert-col') {
    const sheet = workbook.getSheetBySheetId(params.subUnitId);
    if (!sheet) throw new ClientError('malformed');
    const range = object(params.range);
    if (id === 'sheet.mutation.insert-row')
      coordinate(
        sheet.getRowCount() + span(range.startRow, range.endRow, MAX_ROWS - 1),
        MAX_ROWS,
        1,
      );
    else
      coordinate(
        sheet.getColumnCount() + span(range.startColumn, range.endColumn, MAX_COLUMNS - 1),
        MAX_COLUMNS,
        1,
      );
  } else if (id === 'sheet.mutation.set-worksheet-order') {
    const order = workbook.getSheetOrders();
    const from = coordinate(params.fromOrder, MAX_SHEETS);
    const to = coordinate(params.toOrder, MAX_SHEETS);
    if (from >= order.length || to >= order.length || order[from] !== params.subUnitId)
      throw new ClientError('malformed');
  }
}
