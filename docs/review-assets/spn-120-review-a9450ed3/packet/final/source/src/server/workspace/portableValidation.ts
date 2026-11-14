import { AuthError } from '../auth/store.ts';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const invalid = () =>
  new AuthError(400, 'Invalid or oversized Univer layout. See the import limits.');

/** Byte limits alone do not bound the editor's row/column caches or layout work. */
export function validatePortableLayout(data: ObjectValue, kind: 'sheet' | 'doc') {
  if (kind === 'doc') {
    if (!object(data.body) || typeof data.body.dataStream !== 'string') throw invalid();
    if (data.body.dataStream.length > 1_000_000) throw invalid();
    if (!data.body.dataStream.endsWith('\r\n'))
      throw new AuthError(400, 'Invalid document data. Changes have not been saved.');
    for (const field of ['paragraphs', 'sectionBreaks', 'textRuns', 'tables', 'customBlocks']) {
      const entries = data.body[field];
      if (entries === undefined) continue;
      if (!Array.isArray(entries)) throw invalid();
      for (const entry of entries) {
        if (!object(entry)) throw invalid();
        for (const key of ['startIndex', 'endIndex', 'st', 'ed'])
          if (entry[key] !== undefined && !integer(entry[key], 0, data.body.dataStream.length))
            throw invalid();
      }
    }
    return;
  }
  if (
    !object(data.sheets) ||
    !Array.isArray(data.sheetOrder) ||
    !data.sheetOrder.length ||
    data.sheetOrder.length > 100 ||
    new Set(data.sheetOrder).size !== data.sheetOrder.length ||
    Object.keys(data.sheets).length !== data.sheetOrder.length
  )
    throw invalid();
  let rows = 0,
    columns = 0,
    cells = 0;
  for (const id of data.sheetOrder) {
    if (typeof id !== 'string' || !Object.hasOwn(data.sheets, id)) throw invalid();
    const sheet = data.sheets[id];
    if (
      !object(sheet) ||
      sheet.id !== id ||
      typeof sheet.name !== 'string' ||
      !integer(sheet.rowCount, 1, 100_000) ||
      !integer(sheet.columnCount, 1, 1_024)
    )
      throw invalid();
    rows += sheet.rowCount;
    columns += sheet.columnCount;
    // Product budgets for the small server, not claims about Univer's maximum capacity (#69).
    if (rows > 250_000 || columns > 4_096) throw invalid();
    const matrix = (value: unknown, size: number, visit: (entry: unknown) => void) => {
      if (value === undefined) return;
      if (!object(value)) throw invalid();
      for (const [key, entry] of Object.entries(value)) {
        if (!/^(0|[1-9]\d*)$/.test(key) || !integer(Number(key), 0, size - 1)) throw invalid();
        visit(entry);
      }
    };
    matrix(sheet.cellData, sheet.rowCount, (row) =>
      matrix(row, sheet.columnCount as number, (cell) => {
        if (cell === null) return;
        if (!object(cell) || ++cells > 100_000) throw invalid();
        if (cell.f !== undefined && typeof cell.f !== 'string') throw invalid();
        if (
          cell.v !== undefined &&
          cell.v !== null &&
          !['string', 'number', 'boolean'].includes(typeof cell.v)
        )
          throw invalid();
      }),
    );
    matrix(sheet.rowData, sheet.rowCount, (row) => {
      if (row !== null && !object(row)) throw invalid();
    });
    matrix(sheet.columnData, sheet.columnCount, (column) => {
      if (column !== null && !object(column)) throw invalid();
    });
    if (sheet.mergeData !== undefined) {
      if (!Array.isArray(sheet.mergeData)) throw invalid();
      for (const range of sheet.mergeData) {
        if (
          !object(range) ||
          !integer(range.startRow, 0, sheet.rowCount - 1) ||
          !integer(range.endRow, range.startRow, sheet.rowCount - 1) ||
          !integer(range.startColumn, 0, sheet.columnCount - 1) ||
          !integer(range.endColumn, range.startColumn, sheet.columnCount - 1)
        )
          throw invalid();
      }
    }
  }
}
