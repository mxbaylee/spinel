import { LocaleType, Univer } from '@univerjs/core';
import type { ICellData, IWorkbookData, IWorksheetData } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { FormulaDataModel, UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { SheetRangeThemeModel, UniverSheetsPlugin } from '@univerjs/sheets';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import '@univerjs/sheets/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-formula/facade';
import { PDF_LIMITS, PdfError } from './limits.ts';
import { inspectPdfSnapshot } from './prepare.ts';

function invalid(): never { throw new PdfError('unsupported'); }
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const primitive = (value: unknown) => value == null || typeof value === 'string' ||
  typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

function referenceCheck(expression: unknown, unitId: string) {
  if (typeof expression !== 'string') invalid();
  // Quoted strings are values; explicit workbook qualifiers outside them must
  // name this exact already-authorized snapshot. No other workbook is loaded.
  const syntax = expression.replace(/"(?:[^"]|"")*"/g, '""');
  for (const reference of syntax.matchAll(/\[([^\]]+)\]/g))
    if (reference[1] !== unitId) invalid();
}

/**
 * Disposable process only. Recalculate the confirmed workbook through public
 * APIs; cached v fields and interactive array-result caches are never trusted.
 * The caller enforces hard time/RSS limits, including synchronous native work.
 */
export async function prepareSheetFormulas(source: IWorkbookData, signal?: AbortSignal) {
  inspectPdfSnapshot(source);
  const result = structuredClone(source);
  if (!Array.isArray(result.sheetOrder) || result.sheetOrder.length > PDF_LIMITS.worksheets ||
      !object(result.sheets)) invalid();
  let cells = 0;
  let formulas = false;
  const sheets: Record<string, Partial<IWorksheetData>> = {};
  const check = () => signal?.throwIfAborted();
  for (const id of result.sheetOrder) {
    check();
    const sheet = result.sheets[id];
    if (!sheet || !Number.isSafeInteger(sheet.rowCount ?? 1000) ||
        (sheet.rowCount ?? 1000) < 1 || (sheet.rowCount ?? 1000) > PDF_LIMITS.rows ||
        !Number.isSafeInteger(sheet.columnCount ?? 26) || (sheet.columnCount ?? 26) < 1 ||
        (sheet.columnCount ?? 26) > PDF_LIMITS.columns || !object(sheet.cellData ?? {})) invalid();
    const cellData: IWorksheetData['cellData'] = {};
    for (const [row, columns] of Object.entries(sheet.cellData ?? {})) {
      if (!/^(0|[1-9]\d*)$/.test(row) || Number(row) >= (sheet.rowCount ?? 1000) ||
          !object(columns)) invalid();
      for (const [column, raw] of Object.entries(columns)) {
        if (!/^(0|[1-9]\d*)$/.test(column) || Number(column) >= (sheet.columnCount ?? 26)) invalid();
        if (raw == null) continue;
        if (!object(raw)) invalid();
        if (++cells > PDF_LIMITS.cells) throw new PdfError('limit');
        const cell = raw as ICellData;
        const value = cell.v ?? cell.p?.body?.dataStream.replace(/\r\n$/, '') ?? null;
        if (!primitive(value)) invalid();
        const plain: ICellData = { v: value, ...(cell.t === undefined ? {} : { t: cell.t }),
          ...(cell.s === undefined ? {} : { s: cell.s }) };
        if (cell.f) { referenceCheck(cell.f, result.id); plain.f = cell.f; formulas = true; }
        if (cell.si) { plain.si = cell.si; formulas = true; }
        if (cell.f || cell.si) plain.v = null;
        (cellData[Number(row)] ??= {})[Number(column)] = plain;
      }
    }
    sheets[id] = { ...sheet, cellData };
  }
  const calculationResources = result.resources?.filter((resource) =>
    ['SHEET_DEFINED_NAME_PLUGIN', 'SHEET_RANGE_THEME_MODEL_PLUGIN'].includes(resource.name)) ?? [];
  const themeResource = calculationResources.find((resource) => resource.name === 'SHEET_RANGE_THEME_MODEL_PLUGIN');
  const theme = themeResource ? JSON.parse(themeResource.data) as Record<string, unknown> : {};
  if (!object(theme)) invalid();
  const rules = theme.rangeThemeStyleRuleMap ?? {};
  if (!object(rules)) invalid();
  for (const resource of calculationResources) {
    const data: unknown = JSON.parse(resource.data);
    if (!object(data)) invalid();
    if (resource.name === 'SHEET_DEFINED_NAME_PLUGIN')
      for (const name of Object.values(data)) {
        if (!object(name)) invalid();
        for (const key of ['formulaOrRefString', 'formulaOrRefStringWithPrefix'])
          if (name[key] !== undefined) referenceCheck(name[key], result.id);
      }
  }
  const ranges: { sheetId: string; startRow: number; endRow: number; startColumn: number; endColumn: number; themeName: string }[] = [];
  let styled = 0;
  for (const raw of Object.values(rules)) {
    if (!object(raw) || !object(raw.rangeInfo) || typeof raw.themeName !== 'string') invalid();
    const info = raw.rangeInfo;
    if (info.unitId !== result.id || typeof info.subUnitId !== 'string' ||
        !object(info.range)) invalid();
    const sheet = result.sheets[info.subUnitId];
    if (!sheet) invalid();
    const range = info.range;
    for (const key of ['startRow', 'endRow', 'startColumn', 'endColumn'])
      if (!Number.isSafeInteger(range[key]) || (range[key] as number) < 0 ||
          (range[key] as number) >= (key.endsWith('Row') ? (sheet.rowCount ?? 1000) : (sheet.columnCount ?? 26))) invalid();
    const { startRow, endRow, startColumn, endColumn } = range as Record<string, number>;
    if (startRow > endRow || startColumn > endColumn ||
        (range.rangeType !== undefined && range.rangeType !== 0) || raw.themeName.startsWith('table')) invalid();
    styled += (endRow - startRow + 1) * (endColumn - startColumn + 1);
    if (styled > PDF_LIMITS.cells) throw new PdfError('limit');
    ranges.push({ sheetId: info.subUnitId, startRow, endRow, startColumn, endColumn, themeName: raw.themeName });
  }
  // These resources govern editing, not printable appearance or document read
  // authorization. Spinel has already resolved exact current document access.
  const consumed = new Set([
    'SHEET_DEFINED_NAME_PLUGIN', 'SHEET_RANGE_THEME_MODEL_PLUGIN',
    'SHEET_WORKSHEET_PROTECTION_PLUGIN', 'SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN',
    'SHEET_RANGE_PROTECTION_PLUGIN',
  ]);
  if (!formulas && !ranges.length) {
    result.resources = result.resources?.filter((resource) => !consumed.has(resource.name));
    return result;
  }
  let univer: Univer | undefined;
  try {
    univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: {} } });
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.NO_CALCULATION });
    const api = FUniver.newAPI(univer);
    const book = api.createWorkbook({ ...result, sheets, resources: calculationResources });
    if (formulas) {
      const formula = api.getFormula();
      formula.executeCalculation();
      await formula.onCalculationResultApplied(10_000);
      check();
    }
    const native = book.getWorkbook();
    const arrays = univer.__getInjector().get(FormulaDataModel).getArrayFormulaCellData()[result.id] ?? {};
    let projected = 0;
    for (const id of result.sheetOrder) {
      check();
      const worksheet = native.getSheetBySheetId(id);
      if (!worksheet) invalid();
      const output = (result.sheets[id].cellData ??= {});
      const positions = new Map<string, Set<string>>();
      for (const matrix of [output, arrays[id] ?? {}])
        for (const [row, columns] of Object.entries(matrix))
          for (const [column, value] of Object.entries(columns ?? {})) {
            if (value == null) continue;
            let columnsAt = positions.get(row);
            if (!columnsAt) positions.set(row, columnsAt = new Set());
            columnsAt.add(column);
          }
      for (const [row, columns] of positions)
        for (const column of columns) {
          if (++projected > PDF_LIMITS.cells) throw new PdfError('limit');
          const r = Number(row), c = Number(column);
          if (r >= (result.sheets[id].rowCount ?? 1000) || c >= (result.sheets[id].columnCount ?? 26)) invalid();
          const original = output[r]?.[c];
          if (!original?.f && !original?.si && !arrays[id]?.[r]?.[c]) continue;
          const calculated = worksheet.getCell(r, c);
          if (!calculated || !primitive(calculated.v) || calculated.v === undefined) invalid();
          const updated = { ...original, v: calculated.v, t: calculated.t };
          // A persisted rich-text cache cannot override a freshly calculated value.
          delete updated.p;
          (output[r] ??= {})[c] = updated;
        }
    }
    const themes = univer.__getInjector().get(SheetRangeThemeModel);
    for (const range of ranges) {
      const worksheet = native.getSheetBySheetId(range.sheetId)!;
      if (!themes.getRangeThemeStyle(result.id, range.themeName)) invalid();
      const output = (result.sheets[range.sheetId].cellData ??= {});
      for (let row = range.startRow; row <= range.endRow; row++) {
        check();
        for (let column = range.startColumn; column <= range.endColumn; column++) {
          const original = output[row]?.[column] ?? {};
          const themeStyle = themes.getCellStyle(result.id, range.sheetId, row, column);
          (output[row] ??= {})[column] = { ...original, s: worksheet.getComposedCellStyleByCellData(
            row, column, { ...original, themeStyle },
          ) };
        }
      }
    }
    result.resources = result.resources?.filter((resource) => !consumed.has(resource.name));
    inspectPdfSnapshot(result);
    return result;
  } catch (error) {
    if (error instanceof PdfError || signal?.aborted) throw error;
    throw new PdfError('unsupported');
  } finally { univer?.dispose(); }
}
