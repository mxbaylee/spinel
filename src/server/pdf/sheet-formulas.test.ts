import { expect, test } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { prepareSheetFormulas } from './sheet-formulas.ts';
import { PdfError } from './limits.ts';

function workbook(): IWorkbookData {
  return {
    id: 'confirmed-book', name: 'Confirmed workbook', locale: LocaleType.EN_US,
    appVersion: '1.1.0', styles: {}, sheetOrder: ['summary', 'source'],
    sheets: {
      summary: { id: 'summary', name: 'Summary', rowCount: 40, columnCount: 4, cellData: {} },
      source: { id: 'source', name: 'Source', rowCount: 40, columnCount: 4, cellData: { 0: { 0: { v: 7 } }, 1: { 0: { v: 5 } } } },
    },
  };
}

test('recalculates missing and stale formula caches from this confirmed workbook', async () => {
  const source = workbook();
  source.sheets.summary.cellData = {
    0: { 0: { f: '=SUM(Source!A1:A2)', v: 99999, s: { bl: 1, n: { pattern: '$0.00' } } } },
    1: { 0: { f: '=A1*2' } },
    2: { 0: { f: '=A2+1', p: { id: 'stale', documentStyle: {}, body: { dataStream: 'PRIVATE CACHED TEXT\r\n' } } } },
  };
  const prepared = await prepareSheetFormulas(source);
  expect(prepared.sheets.summary.cellData![0][0]).toMatchObject({ v: 12, s: { bl: 1, n: { pattern: '$0.00' } } });
  expect(prepared.sheets.summary.cellData![1][0]?.v).toBe(24);
  expect(prepared.sheets.summary.cellData![2][0]?.v).toBe(25);
  expect(prepared.sheets.summary.cellData![2][0]?.p).toBeUndefined();
  expect(source.sheets.summary.cellData![0][0]?.v).toBe(99999);
  expect(source.sheets.summary.cellData![2][0]?.p).toBeDefined();
});

test('projects every array spill cell, including the complete thirty-row result', async () => {
  const source = workbook();
  source.sheets.summary.cellData = { 0: { 0: { f: '=SEQUENCE(30,2,1,1)', v: -1 } } };
  const prepared = await prepareSheetFormulas(source);
  for (let row = 0; row < 30; row++) {
    expect(prepared.sheets.summary.cellData![row][0]?.v).toBe(row * 2 + 1);
    expect(prepared.sheets.summary.cellData![row][1]?.v).toBe(row * 2 + 2);
  }
  expect(source.sheets.summary.cellData![29]).toBeUndefined();
});

test('explicit external workbook references never reuse cached private values', async () => {
  const source = workbook();
  source.sheets.summary.cellData = { 0: { 0: { f: '=[private-book]Secret!A1', v: 'PRIVATE CACHE' } } };
  await expect(prepareSheetFormulas(source)).rejects.toBeInstanceOf(PdfError);
  source.sheets.summary.cellData![0][0] = { f: '="[ordinary text]"', v: 'STALE' };
  expect((await prepareSheetFormulas(source)).sheets.summary.cellData![0][0]?.v).toBe('[ordinary text]');
});

test('public native range themes preserve themed blanks and explicit cell-style precedence', async () => {
  const source = workbook();
  source.sheets.summary.cellData = { 0: { 0: { v: 'Header', s: { cl: { rgb: '#ff0000' } } } } };
  source.resources = [{ name: 'SHEET_RANGE_THEME_MODEL_PLUGIN', data: JSON.stringify({
    rangeThemeStyleRuleMap: { rule: { themeName: 'print-theme', rangeInfo: {
      unitId: source.id, subUnitId: 'summary', range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
    } } },
    rangeThemeStyleMapJson: { 'print-theme': { name: 'print-theme', wholeStyle: { bg: { rgb: '#ccffcc' }, cl: { rgb: '#0000ff' } } } },
  }) }];
  const prepared = await prepareSheetFormulas(source);
  expect(prepared.sheets.summary.cellData![0][0]?.s).toMatchObject({ bg: { rgb: '#ccffcc' }, cl: { rgb: '#ff0000' } });
  expect(prepared.sheets.summary.cellData![2][1]?.s).toMatchObject({ bg: { rgb: '#ccffcc' }, cl: { rgb: '#0000ff' } });
  expect(prepared.resources).toEqual([]);
  expect(source.resources).toHaveLength(1);
});

test('unknown visible plugin state is retained for explicit renderer refusal', async () => {
  const source = workbook();
  source.resources = [{ name: 'CUSTOM_VISIBLE_PLUGIN', data: '{"color":"#123456"}' }];
  expect((await prepareSheetFormulas(source)).resources).toEqual(source.resources);
  const controller = new AbortController();
  controller.abort();
  await expect(prepareSheetFormulas(source, controller.signal)).rejects.toThrow();
});
