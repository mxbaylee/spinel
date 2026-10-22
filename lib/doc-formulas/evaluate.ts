import { LocaleType, Univer } from '@univerjs/core';
import type { ICellData, IWorkbookData, IWorksheetData } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverFormulaEnginePlugin, serializeRangeWithSpreadsheet } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import '@univerjs/sheets/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-formula/facade';
import { FORMULA_LIMITS, formulaRange, validateFormulaDefinition } from './definition.ts';
import type {
  FormulaDefinition,
  FormulaResult,
  FormulaSource,
  FormulaValue,
} from './definition.ts';
export const FORMULA_SOURCE_LIMITS = { cells: 20000, bytes: 8 * 1024 * 1024, sheets: 32 } as const;
const tooLarge = (): FormulaResult => ({ ok: false, reason: 'too-large' });
const primitive = (value: unknown): value is FormulaValue =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

export function formulaResult(value: unknown): FormulaResult {
  let result: FormulaResult;
  if (primitive(value)) result = { ok: true, kind: 'scalar', value };
  else if (Array.isArray(value)) {
    if (
      !value.length ||
      value.some(
        (row) =>
          !Array.isArray(row) ||
          !row.length ||
          row.length !== value[0].length ||
          row.some((cell: unknown) => !primitive(cell) && cell !== undefined),
      )
    )
      return { ok: false, reason: 'invalid-formula' };
    if (
      value.length > FORMULA_LIMITS.resultRows ||
      value[0].length > FORMULA_LIMITS.resultColumns ||
      value.length * value[0].length > FORMULA_LIMITS.resultCells
    )
      return tooLarge();
    const rows = value.map((row: (FormulaValue | undefined)[]) => row.map((cell) => cell ?? null));
    result =
      rows.length === 1 && rows[0].length === 1
        ? { ok: true, kind: 'scalar', value: rows[0][0] }
        : { ok: true, kind: 'table', rows };
  } else return { ok: false, reason: 'invalid-formula' };
  return new TextEncoder().encode(JSON.stringify(result)).length > FORMULA_LIMITS.resultBytes
    ? tooLarge()
    : result;
}

/** Keep the calculation input small and remove images, plugin resources and unrelated UI state. */
export function formulaWorkbooks(sources: FormulaSource[]): IWorkbookData[] {
  if (sources.length > FORMULA_LIMITS.sources) throw new Error('too-large');
  let cells = 0;
  return sources.map(({ itemId, snapshot }) => {
    if (snapshot.sheetOrder.length > FORMULA_SOURCE_LIMITS.sheets) throw new Error('too-large');
    const sheets: Record<string, IWorksheetData> = {};
    for (const sheetId of snapshot.sheetOrder) {
      const source = snapshot.sheets[sheetId];
      if (!source) throw new Error('missing-source');
      const rowCount = source.rowCount ?? 1000;
      const columnCount = source.columnCount ?? 26;
      if (
        !Number.isSafeInteger(rowCount) ||
        rowCount < 1 ||
        rowCount > 100000 ||
        !Number.isSafeInteger(columnCount) ||
        columnCount < 1 ||
        columnCount > 1024
      )
        throw new Error('too-large');
      const cellData: IWorksheetData['cellData'] = {};
      for (const [row, columns] of Object.entries(source.cellData ?? {})) {
        for (const [column, entry] of Object.entries(columns)) {
          if (!entry) continue;
          const cell = entry as ICellData;
          if (++cells > FORMULA_SOURCE_LIMITS.cells) throw new Error('too-large');
          const value = cell.v ?? cell.p?.body?.dataStream.replace(/\r\n$/, '') ?? null;
          const plain: ICellData = {
            v: primitive(value) ? value : null,
            ...(cell.t === undefined ? {} : { t: cell.t }),
            ...(cell.f ? { f: cell.f, v: null } : {}),
            ...(cell.si ? { si: cell.si, v: null } : {}),
          };
          (cellData[Number(row)] ??= {})[Number(column)] = plain;
        }
      }
      sheets[sheetId] = {
        id: sheetId,
        name: source.name,
        rowCount,
        columnCount,
        cellData,
      } as IWorksheetData;
    }
    const book: IWorkbookData = {
      id: itemId,
      name: snapshot.name,
      appVersion: snapshot.appVersion,
      locale: LocaleType.EN_US,
      styles: {},
      sheetOrder: [...snapshot.sheetOrder],
      sheets,
    };
    if (new TextEncoder().encode(JSON.stringify(book)).length > FORMULA_SOURCE_LIMITS.bytes)
      throw new Error('too-large');
    return book;
  });
}

/**
 * Run only in a disposable worker. A caller must terminate the worker at its
 * deadline: a Promise timeout cannot interrupt a synchronous spreadsheet formula.
 */
export async function evaluateFormula(
  input: FormulaDefinition,
  sources: FormulaSource[],
): Promise<FormulaResult> {
  const definition = validateFormulaDefinition(input);
  let univer: Univer | undefined;
  try {
    const only = definition.references.length === 1 ? definition.references[0] : undefined;
    if (
      only &&
      definition.expression.slice(1).trim() === definition.expression.slice(only.start, only.end)
    ) {
      const range = formulaRange(only.range);
      const rows = range.endRow - range.startRow + 1;
      const columns = range.endColumn - range.startColumn + 1;
      if (
        rows > FORMULA_LIMITS.resultRows ||
        columns > FORMULA_LIMITS.resultColumns ||
        rows * columns > FORMULA_LIMITS.resultCells
      )
        return tooLarge();
    }
    const books = formulaWorkbooks(sources);
    if (new TextEncoder().encode(JSON.stringify(books)).length > FORMULA_SOURCE_LIMITS.bytes)
      return tooLarge();
    let expression = definition.expression;
    for (const reference of [...definition.references].reverse()) {
      const book = books.find((candidate) => candidate.id === reference.itemId);
      const sheet =
        book && Object.hasOwn(book.sheets, reference.sheetId)
          ? book.sheets[reference.sheetId]
          : undefined;
      if (!book || !sheet) return { ok: false, reason: 'missing-source' };
      const range = formulaRange(reference.range);
      if (range.endRow >= (sheet.rowCount ?? 1000) || range.endColumn >= (sheet.columnCount ?? 26))
        return { ok: false, reason: 'missing-source' };
      const engineReference = serializeRangeWithSpreadsheet(
        book.id,
        sheet.name ?? reference.sheetId,
        range,
      );
      expression =
        expression.slice(0, reference.start) + engineReference + expression.slice(reference.end);
    }
    univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: {} } });
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin, {
      initialFormulaComputing: CalculationMode.NO_CALCULATION,
    });
    const api = FUniver.newAPI(univer);
    // A separate blank evaluation workbook makes unqualified A1 refer to nothing,
    // never to an arbitrary source workbook.
    const evaluationId = '__spinel_doc_formula__';
    const evaluationSheet = '__result__';
    api.createWorkbook({
      id: evaluationId,
      name: evaluationId,
      sheetOrder: [evaluationSheet],
      sheets: { [evaluationSheet]: { id: evaluationSheet, name: evaluationSheet, cellData: {} } },
    });
    for (const book of books) api.createWorkbook(book);
    const formula = api.getFormula();
    formula.executeCalculation();
    await formula.onCalculationResultApplied(10000);
    const result = await formula.executeFormulas(
      { [evaluationId]: { [evaluationSheet]: { 0: { 0: [expression] } } } },
      10000,
    );
    const value = result[evaluationId]?.[evaluationSheet]?.[0]?.[0]?.[0]?.value;
    // An absent parsed result is a failure. Native errors such as #NAME? remain
    // recognizable spreadsheet values, including intentionally authored strings.
    return value === undefined || value === null
      ? { ok: false, reason: 'invalid-formula' }
      : formulaResult(value);
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message === 'too-large' ? 'too-large' : 'invalid-formula',
    };
  } finally {
    univer?.dispose();
  }
}
