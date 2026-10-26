/** Prepared results only: this module never evaluates a Formula or resolves its sources. */
import {
  CustomRangeType,
  NAMED_STYLE_MAP,
  PRESET_LIST_TYPE,
  resolveDocumentParagraphStyle,
} from '@univerjs/core';
import type { IDocumentData, IParagraph, ITable, ITextRun, ITextStyle } from '@univerjs/core';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';

export type PreparedFormulaValue = string | number | boolean | null;

export type PreparedDocFormulaResult =
  | { kind: 'scalar'; value: PreparedFormulaValue }
  | {
      kind: 'array' | 'table';
      rows: readonly (readonly PreparedFormulaValue[])[];
      /** Optional positive layout-pixel widths. Omit for equal columns. */
      columnWidths?: readonly number[];
    }
  | { kind: 'unavailable' };

export interface PreparedDocFormula {
  /** Matches one whole-entity CUSTOM range in the prepared public document. */
  rangeId: string;
  result: PreparedDocFormulaResult;
}

function invalid(): never {
  throw new PrintError('invalid-input', 'Invalid prepared PDF Formula result or range.');
}

function limit(): never {
  throw new PrintError('limit', 'PDF Formula projection exceeds its resource budget.');
}

interface Replacement {
  start: number;
  end: number;
  text: string;
  paragraphs: IParagraph[];
  table?: ITable;
  tableStart?: number;
  tableEnd?: number;
  style: ITextStyle;
}

/** The caller has already inspected/cloned the aggregate snapshot and results. */
export function projectDocFormulas(
  snapshot: IDocumentData,
  prepared: readonly PreparedDocFormula[],
  limits: Readonly<PrintLimits>,
  check: () => void,
) {
  const body = snapshot.body!;
  const ranges = body.customRanges ?? [];
  if (!Array.isArray(prepared) || prepared.length > limits.cells) limit();
  const supplied = new Map<string, PreparedDocFormula>();
  for (const item of prepared) {
    check();
    if (
      !item ||
      typeof item.rangeId !== 'string' ||
      !item.rangeId ||
      supplied.has(item.rangeId) ||
      Object.keys(item).some((key) => !['rangeId', 'result'].includes(key))
    )
      invalid();
    supplied.set(item.rangeId, item);
  }
  if (ranges.length !== supplied.size)
    throw new PrintError(
      'unsupported',
      'Every PDF custom range requires an explicit prepared Formula result.',
    );

  const original = body.dataStream;
  const graphemes = new Set([0, original.length]);
  for (const part of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(original))
    graphemes.add(part.index);
  const firstAt = <T>(items: readonly T[], position: number, end: (item: T) => number) => {
    let low = 0,
      high = items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (end(items[middle]) <= position) low = middle + 1;
      else high = middle;
    }
    return items[low];
  };
  const replacements: Replacement[] = [];
  const ids = new Set<string>();
  let cells = 0;
  let projectedCharacters = original.length;
  const resolveStyle = (id: string | undefined, seen = new Set<string>()): ITextStyle => {
    if (id === undefined) return {};
    const definition = snapshot.styles?.[id];
    if (!definition || seen.has(id) || seen.size > 64) invalid();
    seen.add(id);
    return { ...resolveStyle(definition.basedOn, seen), ...definition.textStyle };
  };
  const width =
    snapshot.documentStyle.pageSize!.width! -
    snapshot.documentStyle.marginLeft! -
    snapshot.documentStyle.marginRight!;
  const display = (value: PreparedFormulaValue): string => {
    check();
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    )
      invalid();
    const text = value === null ? '' : String(value);
    // Result text cannot inject native control tokens or paragraphs. Newlines in
    // a prepared cell remain ordinary soft line breaks after normalization.
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text)) invalid();
    projectedCharacters += text.length;
    if (projectedCharacters > limits.textCharacters) limit();
    return text.replace(/\r\n|[\r\n\u0085\u2028\u2029]/gu, '\r');
  };
  for (const range of ranges) {
    check();
    if (
      range.rangeType !== CustomRangeType.CUSTOM ||
      range.wholeEntity !== true ||
      !Number.isSafeInteger(range.startIndex) ||
      !Number.isSafeInteger(range.endIndex) ||
      range.startIndex < 0 ||
      range.endIndex < range.startIndex ||
      range.endIndex >= original.length - 2 ||
      ids.has(range.rangeId) ||
      !supplied.has(range.rangeId)
    )
      invalid();
    ids.add(range.rangeId);
    const start = range.startIndex;
    const end = range.endIndex + 1;
    if (
      !graphemes.has(start) ||
      !graphemes.has(end) ||
      /[\x00-\x1f]/u.test(original.slice(start, end))
    )
      invalid();
    const paragraph = firstAt(body.paragraphs ?? [], start, (item) => item.startIndex + 1);
    const run = firstAt(body.textRuns ?? [], start, (item) => item.ed);
    const inherited = resolveStyle(paragraph?.styleId);
    const resolved = resolveDocumentParagraphStyle(
      snapshot.documentStyle,
      paragraph?.paragraphStyle,
      {
        styles: snapshot.styles,
        paragraphStyleId: paragraph?.styleId,
      },
    );
    const list = paragraph?.bullet
      ? (snapshot.lists?.[paragraph.bullet.listType] ?? PRESET_LIST_TYPE[paragraph.bullet.listType])
      : undefined;
    const style = {
      ...snapshot.documentStyle.textStyle,
      ...(!paragraph?.styleId && resolved.namedStyleType
        ? NAMED_STYLE_MAP[resolved.namedStyleType]
        : {}),
      ...inherited,
      ...resolved.textStyle,
      ...(run && run.st <= start ? { ...resolveStyle(run.sId), ...run.ts } : {}),
      ...list?.nestingLevel?.[0]?.paragraphProperties?.textStyle,
    };
    const replacement: Replacement = { start, end, text: '', paragraphs: [], style };
    const result = supplied.get(range.rangeId)!.result;
    if (!result || typeof result !== 'object') invalid();
    const keys = Object.keys(result);
    if (result.kind === 'unavailable') {
      if (keys.some((key) => key !== 'kind')) invalid();
      // This text is fixed by the package. Source names, reasons and expressions
      // cannot be passed into an unavailable marker.
      replacement.text = 'Unavailable';
      projectedCharacters += replacement.text.length;
    } else if (result.kind === 'scalar') {
      if (keys.some((key) => !['kind', 'value'].includes(key))) invalid();
      replacement.text = display(result.value);
      for (let index = 0; index < replacement.text.length; index++)
        if (replacement.text[index] === '\r')
          replacement.paragraphs.push({
            paragraphId: `print-formula-${replacements.length}-${index}`,
            startIndex: index,
            paragraphStyle: { textStyle: style },
          });
    } else if (result.kind === 'array' || result.kind === 'table') {
      if (keys.some((key) => !['kind', 'rows', 'columnWidths'].includes(key))) invalid();
      if (!Array.isArray(result.rows) || !result.rows.length || result.rows.length > limits.rows)
        limit();
      const columns = result.rows[0]?.length;
      if (!Number.isSafeInteger(columns) || !columns || columns > limits.columns) invalid();
      cells += result.rows.length * columns;
      if (!Number.isSafeInteger(cells) || cells > limits.cells) limit();
      const widths = result.columnWidths ?? Array.from({ length: columns }, () => width / columns);
      if (
        !Array.isArray(widths) ||
        widths.length !== columns ||
        widths.some(
          (value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0,
        ) ||
        widths.reduce((sum, value) => sum + value, 0) > width + 1e-6
      )
        invalid();
      let tableId = `print-formula-${replacements.length}`;
      while (Object.hasOwn(snapshot.tableSource ?? {}, tableId)) tableId += '-generated';
      const table: ITable = {
        tableId,
        align: 0,
        indent: { v: 0, u: 3 },
        textWrap: 0,
        position: { positionH: { relativeFrom: 3 }, positionV: { relativeFrom: 1 } },
        dist: { distT: 0, distB: 0, distL: 0, distR: 0 },
        size: { type: 1, width: { v: widths.reduce((sum, value) => sum + value, 0), u: 3 } },
        layout: 1,
        tableColumns: widths.map((value) => ({ size: { type: 1, width: { v: value, u: 3 } } })),
        tableRows: [],
      };
      // A table result is a block. An inline occurrence splits its surrounding
      // paragraph without dropping either adjacent piece of text.
      let text = start > 0 && !['\r', '\n', '\x0f'].includes(original[start - 1]) ? '\r' : '';
      if (text)
        replacement.paragraphs.push({
          ...structuredClone(paragraph ?? { paragraphId: '', startIndex: 0 }),
          paragraphId: `${tableId}-before`,
          startIndex: 0,
        });
      replacement.tableStart = text.length;
      text += '\x1a';
      for (let row = 0; row < result.rows.length; row++) {
        check();
        const values = result.rows[row];
        if (!Array.isArray(values) || values.length !== columns) invalid();
        text += '\x1b';
        for (let column = 0; column < columns; column++) {
          const value = display(values[column]);
          const cellStart = text.length + 1;
          text += `\x1c${value}`;
          for (let index = 0; index < value.length; index++)
            if (value[index] === '\r')
              replacement.paragraphs.push({
                paragraphId: `${tableId}-${row}-${column}-${index}`,
                startIndex: cellStart + index,
                paragraphStyle: { textStyle: style },
              });
          replacement.paragraphs.push({
            paragraphId: `${tableId}-${row}-${column}`,
            startIndex: text.length,
            paragraphStyle: { textStyle: style },
          });
          text += '\r\n\x1d';
        }
        text += '\x0e';
        const border = {
          color: { rgb: '#777777' },
          width: { v: 0.75, u: 3 as const },
          dashStyle: 1 as const,
        };
        table.tableRows.push({
          trHeight: { val: { v: 0, u: 3 }, hRule: 0 },
          tableCells: widths.map((value) => ({
            size: { type: 1, width: { v: value, u: 3 } },
            margin: {
              start: { v: 5, u: 3 },
              end: { v: 5, u: 3 },
              top: { v: 4, u: 3 },
              bottom: { v: 4, u: 3 },
            },
            borderTop: border,
            borderBottom: border,
            borderLeft: border,
            borderRight: border,
          })),
        });
      }
      text += '\x0f';
      replacement.tableEnd = text.length;
      replacement.table = table;
      replacement.text = text;
    } else invalid();
    if (
      projectedCharacters > limits.textCharacters ||
      replacement.text.length > limits.textCharacters
    )
      limit();
    replacements.push(replacement);
  }
  replacements.sort((a, b) => a.start - b.start);
  for (let i = 1; i < replacements.length; i++)
    if (replacements[i].start < replacements[i - 1].end) invalid();
  const shifts = [0];
  for (const item of replacements)
    shifts.push(shifts.at(-1)! + item.text.length - (item.end - item.start));
  const replacementIndex = (position: number) => {
    let low = 0,
      high = replacements.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (replacements[middle].end <= position) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const offset = (position: number, right = false) => {
    const index = replacementIndex(position);
    const item = replacements[index];
    if (item && position > item.start)
      return item.start + shifts[index] + (right ? item.text.length : 0);
    return position + shifts[index];
  };
  const replacementAt = (position: number) => {
    const item = replacements[replacementIndex(position)];
    return Boolean(item && item.start <= position);
  };
  for (const entries of [body.paragraphs, body.sectionBreaks, body.customBlocks] as const)
    for (const item of entries ?? []) {
      if (replacementAt(item.startIndex)) invalid();
      item.startIndex = offset(item.startIndex);
    }
  for (const table of body.tables ?? []) {
    if (replacementAt(table.startIndex) || replacementAt(table.endIndex - 1)) invalid();
    table.startIndex = offset(table.startIndex);
    table.endIndex = offset(table.endIndex);
  }
  body.renderedPageBreaks = body.renderedPageBreaks?.map((index) => {
    if (replacementAt(index)) invalid();
    return offset(index);
  });
  const runs: ITextRun[] = [];
  for (const run of body.textRuns ?? []) {
    let cursor = run.st;
    for (let index = replacementIndex(cursor); index < replacements.length; index++) {
      const item = replacements[index];
      if (item.start >= run.ed) break;
      if (cursor < item.start)
        runs.push({ ...run, st: offset(cursor), ed: offset(Math.min(item.start, run.ed)) });
      cursor = Math.max(cursor, item.end);
    }
    if (cursor < run.ed) runs.push({ ...run, st: offset(cursor), ed: offset(run.ed) });
  }
  let text = '';
  let cursor = 0;
  for (const item of replacements) {
    text += original.slice(cursor, item.start);
    const start = text.length;
    text += item.text;
    cursor = item.end;
    for (const paragraph of item.paragraphs) {
      paragraph.startIndex += start;
      (body.paragraphs ??= []).push(paragraph);
    }
    if (item.table) {
      (snapshot.tableSource ??= {})[item.table.tableId] = item.table;
      (body.tables ??= []).push({
        startIndex: start + item.tableStart!,
        endIndex: start + item.tableEnd!,
        tableId: item.table.tableId,
      });
    }
    if (item.text.length) runs.push({ st: start, ed: start + item.text.length, ts: item.style });
  }
  text += original.slice(cursor);
  if (text.length > limits.textCharacters) limit();
  body.dataStream = text;
  body.textRuns = runs.sort((a, b) => a.st - b.st);
  body.paragraphs?.sort((a, b) => a.startIndex - b.startIndex);
  body.tables?.sort((a, b) => a.startIndex - b.startIndex);
  // Source expressions and properties leave the owned rendering model entirely.
  delete body.customRanges;
}
