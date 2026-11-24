import { AuthError } from '../auth/store.ts';
import { PORTABLE_LIMIT } from '../../shared/portable.ts';

/**
 * Literal, bounded CSV/TSV import (SPN-093, decision #130).
 *
 * The delimiter comes from the filename alone. Fields are never typed, trimmed or
 * evaluated, so `007`, `1e3`, `2026-01-02` and `=SUM(A1)` all stay exactly as written.
 */
export type Delimiter = ',' | '\t';

// The editor-expansion budgets for native import apply to a parsed table too.
export const DELIMITED_MAX_ROWS = 100_000;
export const DELIMITED_MAX_COLUMNS = 1_024;
export const DELIMITED_MAX_CELLS = 100_000;

const SUPPORTED = 'Choose a .csv (comma) or .tsv (tab) file.';

/** `.csv` is comma and `.tsv` is tab. Anything else is refused, never guessed. */
export function delimiterFor(filename: unknown): Delimiter | null {
  if (typeof filename !== 'string') return null;
  if (/\.csv$/i.test(filename)) return ',';
  if (/\.tsv$/i.test(filename)) return '\t';
  return null;
}

export const isDelimitedFilename = (filename: unknown) => delimiterFor(filename) !== null;

export function unsupportedDelimitedType() {
  return new AuthError(400, `This file type is not supported. ${SUPPORTED}`);
}

const malformed = (line: number, reason: string) =>
  new AuthError(400, `This file is not valid CSV or TSV (line ${line}): ${reason}`);
const tooLarge = (what: string) =>
  new AuthError(413, `This table is too large to import: ${what}. See the import limits.`);

/**
 * Parse RFC 4180-style text with one explicit delimiter. Quoted fields may contain
 * the delimiter, line breaks and `""` for a quote. Rows may differ in length. Parsing
 * stops at the first limit or error, so a hostile file cannot grow memory past the
 * bounded row, column and populated-cell counts (plus the text it arrived in).
 */
export function parseDelimited(input: unknown, delimiter: Delimiter): string[][] {
  if (typeof input !== 'string') throw new AuthError(400, `Choose a file to import. ${SUPPORTED}`);
  if (Buffer.byteLength(input) > PORTABLE_LIMIT)
    throw new AuthError(413, 'Files must be at most 20 MiB.');
  // A byte-order mark is not data.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.includes('\0')) throw malformed(1, 'it contains a NUL character');
  if (!text.length) throw malformed(1, 'the file is empty');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let populated = 0;
  let line = 1;
  // 'start' = at the first character of a field, 'plain' = inside an unquoted field,
  // 'quoted' = inside quotes, 'closed' = just after a closing quote.
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let quoteLine = 1;

  const endField = () => {
    if (field.length && ++populated > DELIMITED_MAX_CELLS)
      throw tooLarge(`more than ${DELIMITED_MAX_CELLS.toLocaleString('en-US')} non-empty cells`);
    row.push(field);
    if (row.length > DELIMITED_MAX_COLUMNS)
      throw tooLarge(`more than ${DELIMITED_MAX_COLUMNS.toLocaleString('en-US')} columns`);
    field = '';
    state = 'start';
  };
  const endRow = () => {
    endField();
    if (rows.length >= DELIMITED_MAX_ROWS)
      throw tooLarge(`more than ${DELIMITED_MAX_ROWS.toLocaleString('en-US')} rows`);
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else state = 'closed';
      } else {
        if (char === '\n') line++;
        field += char;
      }
      continue;
    }
    if (char === '\r' || char === '\n') {
      // CRLF, LF and a lone CR each end exactly one row.
      if (char === '\r' && text[index + 1] === '\n') index++;
      endRow();
      line++;
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (state === 'closed') throw malformed(line, 'text follows a closing quote');
    if (char === '"') {
      if (state !== 'start') throw malformed(line, 'a quote appears inside an unquoted field');
      state = 'quoted';
      quoteLine = line;
      continue;
    }
    field += char;
    state = 'plain';
  }
  if (state === 'quoted') throw malformed(quoteLine, 'a quoted field is never closed');
  // One final line break does not add an empty row; text without one still ends a row.
  const endsWithBreak = /[\r\n]$/.test(text);
  if (!endsWithBreak) endRow();
  return rows;
}

/**
 * A new one-worksheet native workbook whose non-empty fields are string cells.
 * `t: 1` is Univer's string cell type, so no value is re-read as a number, date,
 * boolean or formula, and no formula (`f`) is ever written.
 */
export function delimitedWorkbook(rows: string[][], name: string) {
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const cellData: Record<number, Record<number, { v: string; t: 1 }>> = {};
  rows.forEach((row, rowIndex) =>
    row.forEach((value, column) => {
      if (!value.length) return;
      (cellData[rowIndex] ??= {})[column] = { v: value, t: 1 };
    }),
  );
  return {
    id: 'delimited-import',
    name,
    appVersion: '',
    locale: 'enUS',
    styles: {},
    sheetOrder: ['sheet-1'],
    sheets: {
      'sheet-1': {
        id: 'sheet-1',
        name: 'Sheet1',
        // Univer's usual blank-sheet size, grown only when the data needs more.
        rowCount: Math.max(1_000, rows.length),
        columnCount: Math.max(20, columns),
        cellData,
      },
    },
  };
}
