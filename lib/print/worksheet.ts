import { CellValueType, Styles, Worksheet, getNumfmtLocaleTag, numfmt } from '@univerjs/core';
import type { ICellDataForSheetInterceptor, IWorkbookData, IWorksheetData } from '@univerjs/core';
import { CustomFilterOperator, FilterModel } from '@univerjs/sheets-filter';
import type { IAutoFilter } from '@univerjs/sheets-filter';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import { resourceRecord } from './resources.ts';

/** Public Worksheet adapters replace editor-only interceptors, not SDK internals. */
export class PrintWorksheet extends Worksheet {
  readonly book: IWorkbookData;
  private excludedRows = new Set<number>();

  constructor(book: IWorkbookData, sheet: Partial<IWorksheetData>, styles: Styles) {
    // Worksheet fills defaults in place; never pass caller-owned snapshot objects.
    super(book.id, structuredClone({ ...sheet, defaultStyle: sheet.defaultStyle ?? book.defaultStyle }), styles);
    this.book = book;
  }

  override getCell(row: number, column: number): ICellDataForSheetInterceptor | null {
    const raw = super.getCellRaw(row, column);
    if (!raw) return null;
    const style = this.getComposedCellStyleByCellData(row, column, raw);
    const cell: ICellDataForSheetInterceptor = { ...raw, s: style };
    const pattern = style.n?.pattern;
    if (!pattern || pattern === 'General' || raw.p || raw.t === CellValueType.BOOLEAN || raw.t === CellValueType.FORCE_STRING || typeof raw.v !== 'number') return cell;
    if (typeof pattern !== 'string' || pattern.length > 2048)
      throw new PrintError('invalid-input', 'Invalid PDF number format.');
    try {
      if (!numfmt.isValidFormat(pattern)) throw new Error('Invalid format');
      if (numfmt.isTextFormat(pattern)) return { ...cell, t: CellValueType.STRING };
      const options = { locale: getNumfmtLocaleTag(this.book.locale), dateSystem: this.book.dateSystem, throws: true };
      const text = numfmt.format(pattern, raw.v, options);
      const color = numfmt.formatColor(pattern, raw.v, options);
      return {
        ...cell, v: text, t: CellValueType.NUMBER,
        ...(text === '' ? { coverable: false } : {}),
        ...(color ? { interceptorStyle: { cl: { rgb: String(color) } } } : {}),
      };
    } catch {
      // Native preview helpers log raw patterns on failure; export errors must not.
      throw new PrintError('invalid-input', 'PDF number formatting failed.');
    }
  }

  override getRowFiltered(row: number) { return this.excludedRows?.has(row) ?? false; }
  override isRowFiltered(row: number) { return this.excludedRows?.has(row) ?? false; }
  override getRowHeight(row: number) { return this.isRowFiltered(row) ? 0 : super.getRowHeight(row); }

  /** The native saved filter cache is authoritative, just as when the workbook opens. */
  applyFilter(value: unknown, limits: Readonly<PrintLimits>, check: () => void) {
    if (value === undefined) return;
    const filter = validateFilter(value, this.getRowCount(), this.getColumnCount(), limits);
    check();
    let model: FilterModel | undefined;
    try {
      model = FilterModel.deserialize(this.book.id, this.getSheetId(), this, filter);
      this.excludedRows = new Set(model.filteredOutRows);
      check();
    } catch (error) {
      if (error instanceof PrintError) throw error;
      throw new PrintError('invalid-input', 'PDF worksheet filtering failed.');
    } finally {
      model?.dispose();
    }
  }
}

function validateFilter(value: unknown, rows: number, columns: number, limits: Readonly<PrintLimits>): IAutoFilter {
  const fail = (): never => { throw new PrintError('invalid-input', 'Invalid or unsupported PDF worksheet filter.'); };
  const filter = resourceRecord(value);
  if (Object.keys(filter).some((key) => !['ref', 'filterColumns', 'cachedFilteredOut'].includes(key))) fail();
  const range = resourceRecord(filter.ref);
  for (const key of ['startRow', 'endRow', 'startColumn', 'endColumn']) {
    const limit = key.endsWith('Row') ? rows : columns;
    if (!Number.isSafeInteger(range[key]) || (range[key] as number) < 0 || (range[key] as number) >= limit) fail();
  }
  if ((range.startRow as number) > (range.endRow as number) || (range.startColumn as number) > (range.endColumn as number)) fail();
  if (filter.cachedFilteredOut !== undefined) {
    if (!Array.isArray(filter.cachedFilteredOut) || filter.cachedFilteredOut.length > rows) fail();
    for (const row of filter.cachedFilteredOut as unknown[])
      if (!Number.isSafeInteger(row) || (row as number) <= (range.startRow as number) || (row as number) > (range.endRow as number)) fail();
  }
  if (filter.filterColumns !== undefined) {
    if (!Array.isArray(filter.filterColumns) || filter.filterColumns.length > columns) fail();
    const seen = new Set<number>();
    const criteria = filter.filterColumns as unknown[];
    if (criteria.length * ((range.endRow as number) - (range.startRow as number)) > limits.gridCells)
      throw new PrintError('limit', 'PDF filter exceeds its scan budget.');
    for (const entry of criteria) {
      const column = resourceRecord(entry);
      const colId = column.colId as number;
      if (!Number.isSafeInteger(colId) || colId < 0 || colId > (range.endColumn as number) - (range.startColumn as number) || seen.has(colId)) fail();
      seen.add(colId);
      const kinds = ['filters', 'colorFilters', 'customFilters'].filter((key) => column[key] !== undefined);
      if (kinds.length !== 1 || Object.keys(column).some((key) => key !== 'colId' && !kinds.includes(key))) fail();
      const rule = resourceRecord(column[kinds[0]]);
      if (kinds[0] === 'filters') {
        if (Object.keys(rule).some((key) => !['blank', 'filters'].includes(key)) || (rule.blank !== undefined && rule.blank !== true)) fail();
        if (rule.filters !== undefined && (!Array.isArray(rule.filters) || rule.filters.length > limits.cells || rule.filters.some((item) => typeof item !== 'string'))) fail();
      } else if (kinds[0] === 'colorFilters') {
        if (Object.keys(rule).some((key) => !['cellFillColors', 'cellTextColors'].includes(key))) fail();
        for (const [key, colors] of Object.entries(rule))
          if (!Array.isArray(colors) || colors.length > limits.cells || colors.some((color) => typeof color !== 'string' && !(key === 'cellFillColors' && color === null))) fail();
      } else {
        if (Object.keys(rule).some((key) => !['and', 'customFilters'].includes(key)) || (rule.and !== undefined && rule.and !== 1) || !Array.isArray(rule.customFilters) || rule.customFilters.length < 1 || rule.customFilters.length > 2) fail();
        for (const condition of rule.customFilters as unknown[]) {
          const item = resourceRecord(condition);
          if (Object.keys(item).some((key) => !['val', 'operator'].includes(key)) || !['string', 'number'].includes(typeof item.val) || (item.operator !== undefined && !Object.values(CustomFilterOperator).includes(item.operator))) fail();
        }
      }
    }
  }
  return filter as unknown as IAutoFilter;
}
