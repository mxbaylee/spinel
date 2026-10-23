import { expect, test } from 'vitest';
import { CellValueType, DateSystem, LocaleType, Styles } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { PRINT_LIMITS } from './index.ts';
import { PrintWorksheet } from './worksheet.ts';

function fixture() {
  const book: IWorkbookData = {
    id: 'book', name: 'Test', appVersion: '1.1.0', locale: LocaleType.EN_US,
    sheetOrder: ['sheet'], styles: { money: { n: { pattern: '$#,##0.00' } } },
    sheets: { sheet: { id: 'sheet', rowCount: 4, columnCount: 3, cellData: {
      0: { 0: { v: 1250.5, s: 'money' }, 1: { v: 'Header' } },
      1: { 0: { v: 20 }, 1: { v: 'Keep' } },
      2: { 0: { v: 5 }, 1: { v: 'Drop' } },
      3: { 0: { v: 40 }, 1: { v: 'Keep' } },
    } } },
  };
  return { book, sheet: new PrintWorksheet(book, book.sheets.sheet, new Styles(book.styles)) };
}

test('public number formatting preserves raw values and numeric alignment', () => {
  const { sheet } = fixture();
  expect(sheet.getCell(0, 0)).toMatchObject({ v: '$1,250.50', t: CellValueType.NUMBER });
  expect(sheet.getCellRaw(0, 0)).toEqual({ v: 1250.5, s: 'money' });
});

test('uses inherited formats and workbook date system, without formatting booleans or forced text', () => {
  const { book } = fixture();
  book.dateSystem = DateSystem.Date1904;
  book.sheets.sheet.columnData = { 0: { s: { n: { pattern: 'yyyy-mm-dd' } } } };
  book.sheets.sheet.cellData = { 0: { 0: { v: 0 }, 1: { v: true, t: CellValueType.BOOLEAN, s: 'money' }, 2: { v: '12', t: CellValueType.FORCE_STRING, s: 'money' } } };
  const sheet = new PrintWorksheet(book, book.sheets.sheet, new Styles(book.styles));
  expect(sheet.getCell(0, 0)?.v).toBe('1904-01-01');
  expect(sheet.getCell(0, 1)?.v).toBe(true);
  expect(sheet.getCell(0, 2)?.v).toBe('12');
});

test('native filter recomputation sees displayed values while raw conditional comparisons remain numeric', () => {
  const { sheet } = fixture();
  sheet.applyFilter({ ref: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 }, filterColumns: [{ colId: 1, filters: { filters: ['Keep'] } }] }, PRINT_LIMITS, () => {});
  expect(sheet.getRowFiltered(2)).toBe(true);
  expect(sheet.isRowFiltered(2)).toBe(true);
  expect(sheet.getRowVisible(2)).toBe(false);
  expect(sheet.getRowHeight(2)).toBe(0);
  expect(sheet.getRowHeight(1)).toBe(24);
  expect(sheet.getCellRaw(2, 0)?.v).toBe(5);
});

test('loads the saved native filter cache and bounds criteria before native scans', () => {
  const { sheet } = fixture();
  const ref = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 };
  // Snapshot fidelity matches native reopening, even when a saved cache is present.
  sheet.applyFilter({ ref, cachedFilteredOut: [1, 3], filterColumns: [{ colId: 1, filters: { filters: ['Keep'] } }] }, PRINT_LIMITS, () => {});
  expect(sheet.getRowFiltered(1)).toBe(true);
  expect(sheet.getRowFiltered(2)).toBe(false);
  expect(() => sheet.applyFilter({ ref, cachedFilteredOut: [100] }, PRINT_LIMITS, () => {})).toThrow('filter');
  expect(() => sheet.applyFilter({ ref, filterColumns: [{ colId: 0, unknownCriteria: true }] }, PRINT_LIMITS, () => {})).toThrow('unsupported');
  expect(() => sheet.applyFilter({ ref, filterColumns: [{ colId: 0, filters: {} }] }, { ...PRINT_LIMITS, gridCells: 2 }, () => {})).toThrow('scan budget');
});
