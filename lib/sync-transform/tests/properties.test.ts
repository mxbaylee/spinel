import { describe, expect, test } from 'vitest';
import { transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { propertyIds } from '../src/properties.ts';
import { withStructure } from './generate.ts';
import { propertyEdit } from './generate-sheet.ts';
import { cols, insertRows, moveRows, removeCols, rows, target } from './edits.ts';
import { converges } from './harness.ts';
import { convergesOver } from './simulate.ts';

const m = (id: string, params: object): Mutation => ({ id, params: { ...target, ...params } });

const height = (h: unknown, ...ranges: object[]) =>
  m(propertyIds.rowHeight, { ranges, rowHeight: h });
const width = (w: unknown, ...ranges: object[]) => m(propertyIds.colWidth, { ranges, colWidth: w });
const hideRows = (...ranges: object[]) => m(propertyIds.rowHidden, { ranges });
const hideCols = (...ranges: object[]) => m(propertyIds.colHidden, { ranges });
const showCols = (...ranges: object[]) => m(propertyIds.colVisible, { ranges });
const rowData = (rowData: object) => m(propertyIds.rowData, { rowData });
const colData = (columnData: object) => m(propertyIds.colData, { columnData });
const autoHeight = (row: number, h: number) =>
  m(propertyIds.rowAutoHeight, { rowsAutoHeightInfo: [{ row, autoHeight: h }] });
const rowsOf = (snapshot: any) => snapshot.workbook.sheets.s1.rowData;
const colsOf = (snapshot: any) => snapshot.workbook.sheets.s1.columnData;

describe('remap', () => {
  test('heights follow their rows past an insert, skipping the inserted rows', () => {
    const result = converges(height(50, rows(1, 3)), insertRows(2, 2));
    expect([1, 2, 3, 4, 5].map((r) => rowsOf(result)[r]?.h)).toEqual([
      50,
      undefined,
      undefined,
      50,
      50,
    ]);
  });

  test('a width keyed by column is re-keyed, and a removed column drops out', () => {
    converges(width({ 1: 60, 3: 70 }, cols(1, 3)), removeCols(1, 1));
    expect(transform([width({ 1: 60 }, cols(1))], [removeCols(1, 1)], 'left')).toEqual([]);
  });

  test('row data and auto heights follow a move', () => {
    converges(rowData({ 2: { hd: 1 }, 7: null }), moveRows(1, 2, 8));
    converges(autoHeight(4, 31), moveRows(5, 2, 0));
  });

  test('a column edit leaves row heights alone', () => {
    const mutation = height(50, rows(1));
    expect(transform([mutation], [removeCols(0, 1)], 'left')).toEqual([mutation]);
  });
});

describe('transform', () => {
  for (const side of ['left', 'right'] as const) {
    test(`overlapping heights converge on the winner (${side} wins)`, () => {
      const result = converges(height(50, rows(1, 3)), height({ 3: 70, 4: 80 }, rows(3, 4)), {
        side,
      });
      expect(rowsOf(result)[3].h).toBe(side === 'left' ? 50 : 70);
    });

    test(`clearing a row against a partial write (${side} wins)`, () => {
      const result = converges(rowData({ 2: null }), hideRows(rows(2)), { side });
      expect(rowsOf(result)[2]).toEqual(side === 'left' ? undefined : { hd: 1 });
    });

    test(`a width on a column hidden concurrently still applies (${side} wins)`, () => {
      const result = converges(width(120, cols(1, 2)), hideCols(cols(2, 3)), { side });
      expect(colsOf(result)[2]).toEqual({ w: 120, hd: 1 });
    });

    test(`a width on a hidden column shown concurrently applies (${side} wins)`, () => {
      const setup = [hideCols(cols(2))];
      const result = converges(width(120, cols(2)), showCols(cols(2)), { setup, side });
      expect(colsOf(result)[2]).toEqual({ w: 120, hd: 0 });
    });

    test(`default width against column data writing w (${side} wins)`, () => {
      converges(width(88, cols(1, 2)), colData({ 1: { w: 70 }, 2: null }), {
        setup: [hideCols(cols(1))],
        side,
      });
    });

    test(`two widths on a hidden column (${side} wins)`, () => {
      converges(width(60, cols(1)), width({ 1: 90 }, cols(0, 1)), {
        setup: [hideCols(cols(1))],
        side,
      });
    });
  }

  test('rows and columns never conflict', () => {
    const mutation = height(50, rows(1));
    expect(transform([mutation], [hideCols(cols(1))], 'right')).toEqual([mutation]);
  });
});

test('row and column properties converge with structural edits', () => {
  convergesOver(withStructure(propertyEdit), { seeds: 30 });
}, 300_000);
