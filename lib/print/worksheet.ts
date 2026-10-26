import {
  CellValueType,
  Styles,
  Worksheet,
  getDisplayValueFromCell,
  getNumfmtLocaleTag,
  numfmt,
} from '@univerjs/core';
import type { ICellDataForSheetInterceptor, IWorkbookData, IWorksheetData } from '@univerjs/core';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import { filteredSheetRows } from './sheet-filter.ts';

/** One admission ledger spans filter evaluation, geometry and final native drawing. */
export function displayTextBudget(limits: Readonly<PrintLimits>, check: () => void) {
  const admitted = new Map<string, Set<string>>();
  let characters = 0;
  return {
    check,
    admit(sheet: string, row: number, column: number, cell: ICellDataForSheetInterceptor) {
      check();
      // Retain a worksheet id once: copying a long input id into every cell key
      // would amplify snapshot bytes outside the displayed-character budget.
      let cells = admitted.get(sheet);
      const key = `${row}:${column}`;
      if (cells?.has(key)) return;
      const text = cell.p?.body?.dataStream ?? getDisplayValueFromCell(cell);
      if (typeof text !== 'string')
        throw new PrintError('invalid-input', 'Invalid PDF displayed text.');
      characters += text.length;
      if (!Number.isSafeInteger(characters) || characters > limits.textCharacters)
        throw new PrintError('limit', 'PDF formatted text exceeds its layout budget.');
      if (!cells) admitted.set(sheet, (cells = new Set()));
      cells.add(key);
    },
  };
}

type DisplayTextBudget = ReturnType<typeof displayTextBudget>;

/** Public Worksheet adapters replace editor-only interceptors, not SDK internals. */
export class PrintWorksheet extends Worksheet {
  readonly book: IWorkbookData;
  protected textBudget?: DisplayTextBudget;
  private excludedRows = new Set<number>();

  constructor(
    book: IWorkbookData,
    sheet: Partial<IWorksheetData>,
    styles: Styles,
    textBudget?: DisplayTextBudget,
  ) {
    // Worksheet fills defaults in place; never pass caller-owned snapshot objects.
    super(
      book.id,
      structuredClone({ ...sheet, defaultStyle: sheet.defaultStyle ?? book.defaultStyle }),
      styles,
    );
    this.book = book;
    this.textBudget = textBudget;
  }

  override getCell(row: number, column: number): ICellDataForSheetInterceptor | null {
    this.textBudget?.check();
    const cell = this.displayCell(row, column);
    if (cell) this.textBudget?.admit(this.getSheetId(), row, column, cell);
    return cell;
  }

  private displayCell(row: number, column: number): ICellDataForSheetInterceptor | null {
    const raw = super.getCellRaw(row, column);
    if (!raw) return null;
    // Formula evaluation and authorization belong to the caller. Missing cached
    // results must never turn a visible formula into a successful blank export.
    if (raw.f && raw.v === undefined && !raw.p)
      throw new PrintError('invalid-input', 'PDF formulas require prepared cached values.');
    const style = this.getComposedCellStyleByCellData(row, column, raw);
    const cell: ICellDataForSheetInterceptor = { ...raw, s: style };
    const pattern = style.n?.pattern;
    if (
      !pattern ||
      pattern === 'General' ||
      raw.p ||
      raw.t === CellValueType.BOOLEAN ||
      raw.t === CellValueType.FORCE_STRING ||
      (typeof raw.v !== 'number' && !(raw.t === CellValueType.NUMBER && typeof raw.v === 'string'))
    )
      return cell;
    if (typeof pattern !== 'string' || pattern.length > 2048)
      throw new PrintError('invalid-input', 'Invalid PDF number format.');
    // Native number-format interception accepts numeric strings explicitly typed
    // NUMBER. Ordinary/forced strings retain their literal presentation.
    const numericValue = Number(raw.v);
    if (!Number.isFinite(numericValue) || (typeof raw.v === 'string' && !raw.v.trim()))
      throw new PrintError('invalid-input', 'Invalid PDF numeric cell value.');
    try {
      if (!numfmt.isValidFormat(pattern)) throw new Error('Invalid format');
      if (numfmt.isTextFormat(pattern)) return { ...cell, t: CellValueType.STRING };
      const options = {
        locale: getNumfmtLocaleTag(this.book.locale),
        dateSystem: this.book.dateSystem,
        throws: true,
      };
      const text = numfmt.format(pattern, numericValue, options);
      const color = numfmt.formatColor(pattern, numericValue, options);
      return {
        ...cell,
        v: text,
        t: CellValueType.NUMBER,
        ...(text === '' ? { coverable: false } : {}),
        ...(color ? { interceptorStyle: { cl: { rgb: String(color) } } } : {}),
      };
    } catch {
      // Native preview helpers log raw patterns on failure; export errors must not.
      throw new PrintError('invalid-input', 'PDF number formatting failed.');
    }
  }

  override getRowFiltered(row: number) {
    return this.excludedRows?.has(row) ?? false;
  }
  override isRowFiltered(row: number) {
    return this.excludedRows?.has(row) ?? false;
  }
  override getRowHeight(row: number) {
    return this.isRowFiltered(row) ? 0 : super.getRowHeight(row);
  }

  /** The native saved filter cache is authoritative, just as when the workbook opens. */
  applyFilter(value: unknown, limits: Readonly<PrintLimits>, check: () => void) {
    if (value === undefined) return;
    this.excludedRows = filteredSheetRows(this, value, limits, check);
  }
}
