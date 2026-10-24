import type { IWorkbookData, IWorksheetData } from '@univerjs/core';
import { PrintError, printCheckpoint, printLimits } from './contract.ts';
import type { PrintBox, PrintLimits, SheetPrintOptions, SheetPrintPage } from './contract.ts';

export interface SheetGeometry {
  id: string;
  /** Prefix edges retain native row/column indices; hidden axes have zero extent. */
  rows: Float64Array;
  columns: Float64Array;
  /** Cell/merge extent only. Native text overflow and image extents must augment it. */
  cellBounds: PrintBox | null;
  visibleGridCells: number;
}

export interface SheetPreflight {
  sheets: SheetGeometry[];
  limits: Readonly<PrintLimits>;
  deadline: number;
}

function invalid(message: string): never {
  throw new PrintError('invalid-input', message);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Expected a PDF snapshot object.');
  return value as Record<string, unknown>;
}

/** Inspect without stringify/clone or calling getters. No native allocation happens here. */
export function inspectSnapshot(
  snapshot: unknown,
  limits: Readonly<PrintLimits>,
  check: () => void,
) {
  const ancestors = new Set<object>();
  const pending: { value: unknown; depth: number; leave?: boolean }[] = [
    { value: snapshot, depth: 0 },
  ];
  let bytes = 0;
  let nodes = 0;
  while (pending.length) {
    check();
    const { value, depth, leave } = pending.pop()!;
    if (leave) {
      ancestors.delete(value as object);
      continue;
    }
    if (++nodes > limits.snapshotNodes || depth > 64)
      throw new PrintError('limit', 'PDF snapshot is too large or too deeply nested.');
    if (typeof value === 'string') bytes += Buffer.byteLength(value, 'utf8') + 2;
    else if (value === null || typeof value === 'boolean') bytes += 5;
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) invalid('PDF snapshot contains a non-finite number.');
      bytes += 24;
    } else if (typeof value === 'object') {
      if (ancestors.has(value)) invalid('PDF snapshot must not contain a cycle.');
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
        invalid('PDF snapshot must contain only plain data.');
      const array = Array.isArray(value);
      const length = array
        ? (Object.getOwnPropertyDescriptor(value, 'length')!.value as number)
        : 0;
      // Holes still cost downstream array iteration/serialization work. Check the
      // logical length before enumerating keys, without allocating the holes.
      if (length > limits.snapshotNodes)
        throw new PrintError('limit', 'PDF snapshot array exceeds its entry budget.');
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key !== 'string')) invalid('Invalid PDF snapshot key.');
      const keys = (ownKeys as string[]).filter((key) => !array || key !== 'length');
      const entries = array
        ? keys.filter((key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < length).length
        : 0;
      const holes = length - entries;
      nodes += holes;
      bytes += holes * 5; // A serialized sparse entry occupies null plus a separator.
      if (keys.length + nodes + pending.length > limits.snapshotNodes)
        throw new PrintError('limit', 'PDF snapshot contains too many entries.');
      ancestors.add(value);
      pending.push({ value, depth, leave: true });
      bytes += 2;
      for (const key of keys) {
        if (['__proto__', 'prototype', 'constructor'].includes(key))
          invalid('Invalid PDF snapshot key.');
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!Object.hasOwn(descriptor, 'value'))
          invalid('PDF snapshot must not contain accessors.');
        if (!descriptor.enumerable) invalid('PDF snapshot properties must be enumerable.');
        bytes += Buffer.byteLength(key, 'utf8') + 4;
        // Optional SDK fields may be undefined in an in-memory snapshot.
        if (descriptor.value !== undefined)
          pending.push({ value: descriptor.value, depth: depth + 1 });
        else if (array) {
          // Explicit undefined array entries have the same logical cost as holes.
          nodes++;
          bytes += 5;
        }
      }
    } else invalid('PDF snapshot must contain only plain data.');
    if (bytes > limits.snapshotBytes)
      throw new PrintError('limit', 'PDF snapshot exceeds its byte budget.');
  }
}

function integer(value: unknown, max: number, message: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max)
    invalid(message);
  return value as number;
}

function index(key: string, count: number) {
  if (!/^(0|[1-9]\d*)$/.test(key)) invalid('Invalid PDF cell or axis index.');
  return integer(Number(key), count - 1, 'PDF cell or axis index is out of range.');
}

function dimension(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000)
    invalid('Invalid PDF row or column dimension.');
  return value;
}

function axis(sheet: Partial<IWorksheetData>, rows: boolean, limits: Readonly<PrintLimits>) {
  const count = integer(
    rows ? (sheet.rowCount ?? 1000) : (sheet.columnCount ?? 20),
    rows ? limits.rows : limits.columns,
    'PDF axis count exceeds its bounds.',
  );
  const fallback = dimension(
    rows ? (sheet.defaultRowHeight ?? 24) : (sheet.defaultColumnWidth ?? 88),
  );
  const entries = record((rows ? sheet.rowData : sheet.columnData) ?? {});
  for (const key of Object.keys(entries)) index(key, count);
  const edges = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const item = entries[i] === undefined ? {} : record(entries[i]);
    if (item.hd !== undefined && item.hd !== 0 && item.hd !== 1)
      invalid('Invalid PDF axis visibility.');
    if (item.ia !== undefined && item.ia !== 0 && item.ia !== 1)
      invalid('Invalid PDF row auto-height flag.');
    const size = dimension(
      rows
        ? (item.ia === undefined || item.ia === 1) && typeof item.ah === 'number'
          ? item.ah
          : (item.h ?? fallback)
        : (item.w ?? fallback),
    );
    edges[i + 1] = edges[i] + (item.hd === 1 ? 0 : size);
  }
  return edges;
}

export function unionBox(current: PrintBox | null, box: PrintBox): PrintBox | null {
  if (box.right <= box.left || box.bottom <= box.top) return current;
  return current
    ? {
        left: Math.min(current.left, box.left),
        top: Math.min(current.top, box.top),
        right: Math.max(current.right, box.right),
        bottom: Math.max(current.bottom, box.bottom),
      }
    : { ...box };
}

/** This stage admits geometry; it deliberately does not claim complete render support. */
export function preflightSheets(
  snapshot: IWorkbookData,
  options: SheetPrintOptions = {},
): SheetPreflight {
  return preflightSheetsBefore(
    snapshot,
    options,
    performance.now() + printLimits(options).durationMs,
  );
}

/** Internal stages share one deadline; remeasuring filtered axes must not reset it. */
export function preflightSheetsBefore(
  snapshot: IWorkbookData,
  options: SheetPrintOptions,
  deadline: number,
): SheetPreflight {
  const limits = printLimits(options);
  const check = () => printCheckpoint(options.signal, deadline);
  inspectSnapshot(snapshot, limits, check);
  record(snapshot);
  if (!Array.isArray(snapshot.sheetOrder) || snapshot.sheetOrder.length > limits.worksheets)
    throw new PrintError('limit', 'PDF workbook has too many worksheets.');
  const sheets = record(snapshot.sheets);
  const ordered = new Set<string>();
  for (const id of snapshot.sheetOrder) {
    if (typeof id !== 'string' || !id || ordered.has(id) || !Object.hasOwn(sheets, id))
      invalid('Invalid PDF worksheet order.');
    ordered.add(id);
  }
  if (Object.keys(sheets).some((id) => !ordered.has(id)))
    invalid('PDF worksheet is missing from workbook order.');
  let selected: Set<string> | undefined;
  if (options.worksheetIds !== undefined) {
    if (!Array.isArray(options.worksheetIds) || options.worksheetIds.length > limits.worksheets)
      invalid('Invalid PDF worksheet selection.');
    selected = new Set();
    for (const id of options.worksheetIds) {
      if (typeof id !== 'string' || !ordered.has(id) || selected.has(id))
        invalid('Invalid PDF worksheet selection.');
      selected.add(id);
    }
  }
  let cells = 0;
  let textCharacters = 0;
  let merges = 0;
  let mergeCells = 0;
  let gridCells = 0;
  const result: SheetGeometry[] = [];
  for (const id of snapshot.sheetOrder) {
    check();
    const sheet = record(sheets[id]) as Partial<IWorksheetData>;
    if (sheet.id !== undefined && sheet.id !== id)
      invalid('PDF worksheet identity does not match its key.');
    if (sheet.hidden !== undefined && ![0, 1, 2].includes(sheet.hidden))
      invalid('Invalid PDF worksheet visibility.');
    if (sheet.hidden || (selected && !selected.has(id))) continue;
    const rows = axis(sheet, true, limits);
    const columns = axis(sheet, false, limits);
    let bounds: PrintBox | null = null;
    const addRange = (startRow: number, endRow: number, startColumn: number, endColumn: number) => {
      bounds = unionBox(bounds, {
        left: columns[startColumn],
        right: columns[endColumn + 1],
        top: rows[startRow],
        bottom: rows[endRow + 1],
      });
    };
    for (const [rowKey, rowValue] of Object.entries(record(sheet.cellData ?? {}))) {
      check();
      const row = index(rowKey, rows.length - 1);
      for (const [columnKey, value] of Object.entries(record(rowValue))) {
        const column = index(columnKey, columns.length - 1);
        if (++cells > limits.cells)
          throw new PrintError('limit', 'PDF workbook has too many populated cells.');
        if (value == null) continue;
        const cell = record(value);
        if (typeof cell.v === 'string') textCharacters += cell.v.length;
        if (cell.p != null) {
          const body = record(record(cell.p).body ?? {});
          if (typeof body.dataStream === 'string') textCharacters += body.dataStream.length;
        }
        if (textCharacters > limits.textCharacters)
          throw new PrintError('limit', 'PDF text exceeds its layout budget.');
        if (
          ['v', 'p', 's', 'f'].some(
            (key) => cell[key] !== undefined && cell[key] !== null && cell[key] !== '',
          )
        )
          addRange(row, row, column, column);
      }
    }
    if (sheet.mergeData !== undefined && !Array.isArray(sheet.mergeData))
      invalid('Invalid PDF merge collection.');
    for (const mergeValue of sheet.mergeData ?? []) {
      check();
      if (++merges > limits.merges)
        throw new PrintError('limit', 'PDF workbook has too many merges.');
      const merge = record(mergeValue);
      const startRow = integer(merge.startRow, rows.length - 2, 'Invalid PDF merge row.');
      const endRow = integer(merge.endRow, rows.length - 2, 'Invalid PDF merge row.');
      const startColumn = integer(
        merge.startColumn,
        columns.length - 2,
        'Invalid PDF merge column.',
      );
      const endColumn = integer(merge.endColumn, columns.length - 2, 'Invalid PDF merge column.');
      if (endRow < startRow || endColumn < startColumn) invalid('Invalid PDF merge order.');
      // Native Worksheet builds an index for every raw merged cell, including hidden axes.
      mergeCells += (endRow - startRow + 1) * (endColumn - startColumn + 1);
      if (mergeCells > limits.mergeCells)
        throw new PrintError('limit', 'PDF merges exceed their index budget.');
      addRange(startRow, endRow, startColumn, endColumn);
    }
    let visibleRows = 0;
    let visibleColumns = 0;
    if (bounds) {
      const extent: PrintBox = bounds;
      for (let i = 1; i < rows.length; i++)
        if (rows[i] > rows[i - 1] && rows[i] > extent.top && rows[i - 1] < extent.bottom)
          visibleRows++;
      for (let i = 1; i < columns.length; i++)
        if (
          columns[i] > columns[i - 1] &&
          columns[i] > extent.left &&
          columns[i - 1] < extent.right
        )
          visibleColumns++;
    }
    const visibleGridCells = visibleRows * visibleColumns;
    gridCells += visibleGridCells;
    if (gridCells > limits.gridCells)
      throw new PrintError('limit', 'PDF visible grid exceeds its layout budget.');
    result.push({ id, rows, columns, cellBounds: bounds, visibleGridCells });
  }
  if (!result.length) invalid('PDF selection contains no visible worksheets.');
  check();
  return { sheets: result, limits, deadline };
}

/** Actual backend MediaBox dimensions must be supplied; no hidden A4 rounding assumption. */
export function paginateSheet(
  sheetId: string,
  bounds: PrintBox | null,
  mediaBox: { width: number; height: number },
  pageLimit: number,
): SheetPrintPage[] {
  const margin = 36; // 12.7 mm at 72 PDF points/inch.
  if (
    ![mediaBox.width, mediaBox.height].every(
      (value) => Number.isFinite(value) && value > margin * 2,
    ) ||
    !Number.isSafeInteger(pageLimit) ||
    pageLimit < 1 ||
    pageLimit > 100
  )
    invalid('Invalid PDF page frame or limit.');
  // An empty visible worksheet has one deliberately blank page and no surplus grid.
  const source = bounds ?? { left: 0, top: 0, right: 0, bottom: 0 };
  if (
    !Object.values(source).every(Number.isFinite) ||
    source.left < 0 ||
    source.top < 0 ||
    source.right < source.left ||
    source.bottom < source.top
  )
    invalid('Invalid PDF used range.');
  const width = source.right - source.left;
  const height = source.bottom - source.top;
  const scale = width ? Math.min(0.75, (mediaBox.width - margin * 2) / width) : 0.75;
  const sliceHeight = (mediaBox.height - margin * 2) / scale;
  const count = Math.max(1, Math.ceil(height / sliceHeight));
  if (!Number.isFinite(count) || count > pageLimit)
    throw new PrintError('limit', 'PDF exceeds its page budget.');
  return Array.from({ length: count }, (_, index) => ({
    sheetId,
    scale,
    source: {
      ...source,
      top: source.top + sliceHeight * index,
      bottom: Math.min(source.bottom, source.top + sliceHeight * (index + 1)),
    },
  }));
}
