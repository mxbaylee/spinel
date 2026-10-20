export const FORMULA_FORMATS = ['general', 'number', 'currency', 'percent', 'date'] as const;
export type FormulaFormat = (typeof FORMULA_FORMATS)[number];
export type FormulaValue = string | number | boolean | null;
export type FormulaResult =
  | { ok: true; kind: 'scalar'; value: FormulaValue }
  | { ok: true; kind: 'table'; rows: FormulaValue[][] }
  | {
      ok: false;
      reason:
        | 'private-source'
        | 'missing-source'
        | 'invalid-formula'
        | 'too-large'
        | 'busy'
        | 'timeout'
        | 'unavailable';
    };
export interface FormulaReference {
  start: number;
  end: number;
  itemId: string;
  sheetId: string;
  range: string;
}
export interface FormulaDefinition {
  version: 1;
  expression: string;
  references: FormulaReference[];
  format?: FormulaFormat;
}
export interface ParsedReference {
  start: number;
  end: number;
  documentName: string;
  sheetName: string;
  range: string;
}
export const FORMULA_LIMITS = {
  expression: 2048,
  references: 16,
  sources: 4,
  resultRows: 30,
  resultColumns: 12,
  resultCells: 360,
  resultBytes: 64 * 1024,
} as const;
const invalid = () =>
  new Error('Use a formula starting with = and references like Budget.Summary.A1.');
// Formulas are single-line native atoms; document structural controls are never part of one.
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001f]/;
const name = /(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_]*))/uy;
const cell = /\$?([A-Za-z]{1,3})\$?([1-9]\d{0,5})/y;

/** Public syntax only; arithmetic, functions, arrays and errors belong to Univer. */
export function parseFormula(expression: string): ParsedReference[] {
  if (
    typeof expression !== 'string' ||
    !expression.startsWith('=') ||
    expression.length < 2 ||
    expression.length > FORMULA_LIMITS.expression ||
    controlCharacters.test(expression)
  )
    throw invalid();
  const references: ParsedReference[] = [];
  for (let at = 1; at < expression.length;) {
    if (expression[at] === '"') {
      // Excel strings escape a quote by doubling it. Never bind references inside strings.
      at++;
      let closed = false;
      while (at < expression.length) {
        if (expression[at++] !== '"') continue;
        if (expression[at] === '"') at++;
        else {
          closed = true;
          break;
        }
      }
      if (!closed) throw invalid();
      continue;
    }
    // Raw engine workbook/sheet qualifiers cannot bypass the stable bindings.
    if ('[]!'.includes(expression[at])) throw invalid();
    const start = at;
    name.lastIndex = at;
    const document = name.exec(expression);
    if (!document) {
      if (expression[at] === "'") throw invalid();
      at++;
      continue;
    }
    at = name.lastIndex;
    if (expression[at] !== '.') continue;
    name.lastIndex = at + 1;
    const sheet = name.exec(expression);
    if (!sheet || expression[name.lastIndex] !== '.') throw invalid();
    cell.lastIndex = name.lastIndex + 1;
    const first = cell.exec(expression);
    if (!first) throw invalid();
    let range = first[0].replaceAll('$', '').toUpperCase();
    at = cell.lastIndex;
    if (expression[at] === ':') {
      cell.lastIndex = at + 1;
      const last = cell.exec(expression);
      if (!last) throw invalid();
      range += `:${last[0].replaceAll('$', '').toUpperCase()}`;
      at = cell.lastIndex;
    }
    if (/[\p{L}\p{N}_.$:]/u.test(expression[at] ?? '')) throw invalid();
    formulaRange(range);
    references.push({
      start,
      end: at,
      documentName: (document[1] ?? document[2]).replaceAll("''", "'"),
      sheetName: (sheet[1] ?? sheet[2]).replaceAll("''", "'"),
      range,
    });
    if (references.length > FORMULA_LIMITS.references) throw invalid();
  }
  return references;
}

export function formulaRange(range: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,5})(?::([A-Z]{1,3})([1-9]\d{0,5}))?$/.exec(range);
  if (!match) throw invalid();
  const column = (letters: string) =>
    [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  const startRow = Number(match[2]) - 1,
    startColumn = column(match[1]),
    endRow = Number(match[4] ?? match[2]) - 1,
    endColumn = column(match[3] ?? match[1]);
  if (endRow < startRow || endColumn < startColumn || endRow >= 100000 || endColumn >= 1024)
    throw invalid();
  return { startRow, startColumn, endRow, endColumn };
}

/** Reject unknown fields so results cannot hitchhike in the persisted definition. */
export function validateFormulaDefinition(value: unknown): FormulaDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) => !['version', 'expression', 'references', 'format'].includes(key),
    ) ||
    data.version !== 1 ||
    typeof data.expression !== 'string' ||
    !Array.isArray(data.references) ||
    (data.format !== undefined && !FORMULA_FORMATS.includes(data.format as FormulaFormat))
  )
    throw invalid();
  const parsed = parseFormula(data.expression);
  if (parsed.length !== data.references.length) throw invalid();
  const references = data.references.map((value, index): FormulaReference => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const reference = value as Record<string, unknown>;
    if (
      Object.keys(reference).some(
        (key) => !['start', 'end', 'itemId', 'sheetId', 'range'].includes(key),
      ) ||
      reference.start !== parsed[index].start ||
      reference.end !== parsed[index].end ||
      reference.range !== parsed[index].range ||
      typeof reference.itemId !== 'string' ||
      !/^[\w-]{1,100}$/.test(reference.itemId) ||
      typeof reference.sheetId !== 'string' ||
      !reference.sheetId.length ||
      reference.sheetId.length > 100 ||
      controlCharacters.test(reference.sheetId) ||
      ['__proto__', 'constructor', 'prototype'].includes(reference.sheetId)
    )
      throw invalid();
    return reference as unknown as FormulaReference;
  });
  if (new Set(references.map((reference) => reference.itemId)).size > FORMULA_LIMITS.sources)
    throw invalid();
  return {
    version: 1,
    expression: data.expression,
    references,
    ...(data.format === undefined ? {} : { format: data.format as FormulaFormat }),
  };
}

export function formatFormulaValue(value: FormulaValue, format: FormulaFormat = 'general') {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value !== 'number' || format === 'general') return String(value);
  if (format === 'date') {
    // Preserve Excel's fictitious leap day; UTC keeps every reader on the same date.
    if (Math.floor(value) === 60) return 'Feb 29, 1900';
    const serial = value >= 1 && value < 60 ? value + 1 : value;
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return Number.isNaN(date.getTime())
      ? '#VALUE!'
      : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' }).format(date);
  }
  return new Intl.NumberFormat('en-US', {
    ...(format === 'currency' ? { style: 'currency', currency: 'USD' } : {}),
    ...(format === 'percent' ? { style: 'percent' } : {}),
    minimumFractionDigits: format === 'number' ? 2 : undefined,
    maximumFractionDigits: 2,
  }).format(value);
}
import type { IWorkbookData } from '@univerjs/core';

export interface FormulaSource {
  itemId: string;
  snapshot: IWorkbookData;
}
