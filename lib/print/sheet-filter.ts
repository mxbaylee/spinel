/**
 * Copyright 2023-present DreamNum Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified for Spinel: isolate the v1.1.0 FilterModel/FilterColumn and custom
 * filter evaluation used by saved PDF snapshots, with bounded admission and
 * checkpoints. No reactive model, editor services or rendering imports.
 */
import { CellValueType, ColorKit, extractPureTextFromCell, isNumeric } from '@univerjs/core';
import type { ICellData, IStyleData, Worksheet } from '@univerjs/core';
import type { IAutoFilter, ICustomFilter, IFilterColumn } from '@univerjs/sheets-filter';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import { resourceRecord } from './resources.ts';

const operators = [
  'equal',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'notEqual',
];

function conditionalValue(worksheet: Worksheet, row: number, column: number) {
  const intercepted = worksheet.getCell(row, column);
  if (!intercepted) return null;
  const raw = worksheet.getCellRaw(row, column);
  if (!raw) return filterValue(intercepted);
  if (intercepted.t === CellValueType.NUMBER && typeof intercepted.v === 'string') return raw.v;
  if (intercepted.t === CellValueType.NUMBER) return Number(raw.v);
  return filterValue(raw);
}

function filterValue(cell: ICellData) {
  const rich = cell.p?.body?.dataStream;
  if (rich) return rich.trimEnd();
  const value = cell.v;
  if (typeof value === 'string')
    return cell.t === CellValueType.BOOLEAN ? value.toUpperCase() : value;
  if (typeof value === 'number')
    return cell.t === CellValueType.BOOLEAN ? (value ? 'TRUE' : 'FALSE') : value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return '';
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'boolean' || value == null) return null;
  return typeof value === 'string' ? value : String(value);
}

// Match the native non-Unicode /i behavior one UTF-16 unit at a time. In
// particular, multi-unit uppercase expansions and non-ASCII → ASCII folds do
// not match in that mode (ß/SS, long s/S and Kelvin sign/K).
function foldUnit(value: string): number {
  const original = value.charCodeAt(0);
  const upper = value.toUpperCase();
  const folded = upper.charCodeAt(0);
  return upper.length !== 1 || (original >= 128 && folded < 128) ? original : folded;
}

function isLineEnd(value: string): boolean {
  return value === '\n' || value === '\r' || value === '\u2028' || value === '\u2029';
}

/**
 * The native wildcard regex can backtrack exponentially before an isolated PDF
 * worker starts. Keep its literal, star and question-mark semantics with charged steps.
 * Remembering the latest star is sufficient; even repeated suffix scans share
 * the worksheet's finite work ledger and cancellation/deadline checkpoints.
 */
function wildcardPredicate(pattern: unknown, step: () => void): (text: string) => boolean {
  let units: number[] | undefined;
  return (text) => {
    if (!units) {
      if (typeof pattern !== 'string')
        throw new PrintError('invalid-input', 'PDF worksheet filtering failed.');
      units = [];
      for (let index = 0; index < pattern.length; index++) {
        step();
        const unit = pattern[index];
        units.push(unit === '*' ? -1 : unit === '?' ? -2 : foldUnit(unit));
      }
    }
    let source = 0;
    let criterion = 0;
    let star = -1;
    let starEnd = 0;
    while (source < text.length) {
      step();
      const unit = units[criterion];
      if (unit === -1) {
        star = criterion++;
        starEnd = source;
      } else if (unit === -2 ? !isLineEnd(text[source]) : unit === foldUnit(text[source])) {
        source++;
        criterion++;
      } else if (star !== -1 && !isLineEnd(text[starEnd])) {
        source = ++starEnd;
        criterion = star + 1;
      } else return false;
    }
    while (units[criterion] === -1) {
      step();
      criterion++;
    }
    return criterion === units.length;
  };
}

function customPredicate(filter: ICustomFilter, step: () => void): (value: unknown) => boolean {
  const compare = filter.val;
  const wildcard = wildcardPredicate(compare, step);
  const numeric =
    typeof compare === 'number' || (typeof compare === 'string' && isNumeric(compare));
  if (filter.operator === 'notEqual' && !numeric) {
    return (value) => {
      if (compare === ' ') return value !== undefined && value !== null;
      const text = stringValue(value);
      if (text && typeof compare === 'string' && (compare.includes('*') || compare.includes('?')))
        return !wildcard(text);
      return text !== compare;
    };
  }
  if (filter.operator) {
    if (!numeric) return () => false;
    const number = Number(compare);
    return (value) => {
      if (typeof value !== 'number') return filter.operator === 'notEqual';
      switch (filter.operator) {
        case 'equal':
          return value === number;
        case 'notEqual':
          return value !== number;
        case 'greaterThan':
          return value > number;
        case 'greaterThanOrEqual':
          return value >= number;
        case 'lessThan':
          return value < number;
        case 'lessThanOrEqual':
          return value <= number;
        default:
          throw new PrintError('invalid-input', 'PDF worksheet filtering failed.');
      }
    };
  }
  return (value) => {
    const text = stringValue(value);
    if (text === null) return compare === '';
    return wildcard(text);
  };
}

function columnPredicate(column: IFilterColumn, step: () => void): (value: unknown) => boolean {
  if (column.filters) {
    const includeBlank = !!column.filters.blank;
    const values = new Set(column.filters.filters);
    return (value) =>
      value === undefined || value === '' ? includeBlank : values.has(String(value));
  }
  if (column.colorFilters) {
    const { cellFillColors, cellTextColors } = column.colorFilters;
    if (cellFillColors) {
      const colors = new Set(cellFillColors);
      return (value) => {
        const style = value as IStyleData | null;
        return style?.bg?.rgb
          ? colors.has(new ColorKit(style.bg.rgb).toRgbString())
          : colors.has(null);
      };
    }
    if (cellTextColors) {
      const colors = new Set(cellTextColors);
      return (value) => {
        const style = value as IStyleData | null;
        // Public COLOR_BLACK_RGB, without importing the rendering barrel.
        return colors.has(style?.cl?.rgb ? new ColorKit(style.cl.rgb).toRgbString() : 'rgb(0,0,0)');
      };
    }
    throw new PrintError('invalid-input', 'PDF worksheet filtering failed.');
  }
  const custom = column.customFilters!;
  const predicates = custom.customFilters.map((filter) => customPredicate(filter, step));
  return custom.and
    ? (value) => predicates.every((predicate) => predicate(value))
    : (value) => predicates.some((predicate) => predicate(value));
}

/** Same saved-cache precedence and merged-row iteration as public FilterModel. */
export function filteredSheetRows(
  worksheet: Worksheet,
  value: unknown,
  limits: Readonly<PrintLimits>,
  check: () => void,
): Set<number> {
  if (value === undefined) return new Set();
  const filter = validateFilter(value, worksheet.getRowCount(), worksheet.getColumnCount(), limits);
  check();
  let work = 0;
  const step = () => {
    if (++work > limits.gridCells * 4)
      throw new PrintError('limit', 'PDF filter exceeds its wildcard work budget.');
    if (work % 256 === 0) check();
  };
  try {
    // Native deserialization builds every predicate before accepting its cache.
    const columns = (filter.filterColumns ?? []).map((column) => {
      check();
      if (column.colId < filter.ref.startColumn || column.colId > filter.ref.endColumn)
        throw new PrintError('invalid-input', 'PDF worksheet filtering failed.');
      return { column, predicate: columnPredicate(column, step) };
    });
    if (filter.cachedFilteredOut) return new Set(filter.cachedFilteredOut);
    const excluded = new Set<number>();
    for (const { column, predicate } of columns) {
      const range = {
        startColumn: column.colId,
        endColumn: column.colId,
        startRow: filter.ref.startRow + 1,
        endRow: filter.ref.endRow,
      };
      const current = new Set<number>();
      for (const { row, rowSpan, col } of worksheet.iterateByColumn(range, false, false)) {
        check();
        if (excluded.has(row) && (!rowSpan || rowSpan === 1)) continue;
        const tested = column.filters
          ? extractPureTextFromCell(worksheet.getCell(row, col))
          : column.colorFilters
            ? worksheet.getComposedCellStyle(row, col)
            : conditionalValue(worksheet, row, col);
        if (!predicate(tested)) {
          current.add(row);
          for (let index = 1; index < (rowSpan ?? 1); index++) {
            check();
            current.add(row + index);
          }
        }
      }
      for (const row of current) excluded.add(row);
    }
    check();
    return excluded;
  } catch (error) {
    if (error instanceof PrintError) throw error;
    throw new PrintError('invalid-input', 'PDF worksheet filtering failed.');
  }
}

function validateFilter(
  value: unknown,
  rows: number,
  columns: number,
  limits: Readonly<PrintLimits>,
): IAutoFilter {
  const fail = (): never => {
    throw new PrintError('invalid-input', 'Invalid or unsupported PDF worksheet filter.');
  };
  const filter = resourceRecord(value);
  if (
    Object.keys(filter).some((key) => !['ref', 'filterColumns', 'cachedFilteredOut'].includes(key))
  )
    fail();
  const range = resourceRecord(filter.ref);
  for (const key of ['startRow', 'endRow', 'startColumn', 'endColumn']) {
    const limit = key.endsWith('Row') ? rows : columns;
    if (
      !Number.isSafeInteger(range[key]) ||
      (range[key] as number) < 0 ||
      (range[key] as number) >= limit
    )
      fail();
  }
  if (
    (range.startRow as number) > (range.endRow as number) ||
    (range.startColumn as number) > (range.endColumn as number)
  )
    fail();
  if (filter.cachedFilteredOut !== undefined) {
    if (!Array.isArray(filter.cachedFilteredOut) || filter.cachedFilteredOut.length > rows) fail();
    for (const row of filter.cachedFilteredOut as unknown[])
      if (
        !Number.isSafeInteger(row) ||
        (row as number) <= (range.startRow as number) ||
        (row as number) > (range.endRow as number)
      )
        fail();
  }
  if (filter.filterColumns !== undefined) {
    if (!Array.isArray(filter.filterColumns) || filter.filterColumns.length > columns) fail();
    const seen = new Set<number>();
    const criteria = filter.filterColumns as unknown[];
    if (
      criteria.length * ((range.endRow as number) - (range.startRow as number)) >
      limits.gridCells
    )
      throw new PrintError('limit', 'PDF filter exceeds its scan budget.');
    for (const entry of criteria) {
      const column = resourceRecord(entry);
      const colId = column.colId as number;
      if (
        !Number.isSafeInteger(colId) ||
        colId < (range.startColumn as number) ||
        colId > (range.endColumn as number) ||
        seen.has(colId)
      )
        fail();
      seen.add(colId);
      const kinds = ['filters', 'colorFilters', 'customFilters'].filter(
        (key) => column[key] !== undefined,
      );
      if (
        kinds.length !== 1 ||
        Object.keys(column).some((key) => key !== 'colId' && !kinds.includes(key))
      )
        fail();
      const rule = resourceRecord(column[kinds[0]]);
      if (kinds[0] === 'filters') {
        if (
          Object.keys(rule).some((key) => !['blank', 'filters'].includes(key)) ||
          (rule.blank !== undefined && rule.blank !== true)
        )
          fail();
        if (
          rule.filters !== undefined &&
          (!Array.isArray(rule.filters) ||
            rule.filters.length > limits.cells ||
            rule.filters.some((item) => typeof item !== 'string'))
        )
          fail();
      } else if (kinds[0] === 'colorFilters') {
        if (Object.keys(rule).some((key) => !['cellFillColors', 'cellTextColors'].includes(key)))
          fail();
        for (const [key, colors] of Object.entries(rule))
          if (
            !Array.isArray(colors) ||
            colors.length > limits.cells ||
            colors.some(
              (color) => typeof color !== 'string' && !(key === 'cellFillColors' && color === null),
            )
          )
            fail();
      } else {
        if (
          Object.keys(rule).some((key) => !['and', 'customFilters'].includes(key)) ||
          (rule.and !== undefined && rule.and !== 1) ||
          !Array.isArray(rule.customFilters) ||
          rule.customFilters.length < 1 ||
          rule.customFilters.length > 2
        )
          fail();
        for (const condition of rule.customFilters as unknown[]) {
          const item = resourceRecord(condition);
          if (
            Object.keys(item).some((key) => !['val', 'operator'].includes(key)) ||
            !['string', 'number'].includes(typeof item.val) ||
            (item.operator !== undefined && !operators.includes(item.operator as string))
          )
            fail();
        }
      }
    }
  }
  return filter as unknown as IAutoFilter;
}
