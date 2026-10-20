import { expect, test, vi } from 'vitest';
import { LocaleType } from '@univerjs/core';
import { parseFormula } from '@spinel/doc-formulas';
import type { FormulaDefinition, FormulaSource } from '@spinel/doc-formulas';
import { runFormula } from './runner.ts';

vi.setConfig({ testTimeout: 20000 });
function definition(expression: string): FormulaDefinition {
  return {
    version: 1,
    expression,
    references: parseFormula(expression).map((reference) => ({
      start: reference.start,
      end: reference.end,
      itemId: reference.documentName.toLowerCase(),
      sheetId: 'summary',
      range: reference.range,
    })),
  };
}
function source(itemId: string, value: number): FormulaSource {
  return {
    itemId,
    snapshot: {
      id: `${itemId}-obsolete-unit`,
      name: itemId,
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      styles: {},
      sheetOrder: ['summary'],
      sheets: {
        summary: {
          id: 'summary',
          name: 'Summary',
          rowCount: 100,
          columnCount: 26,
          cellData: {
            0: { 0: { v: value }, 1: { f: '=A1*2', v: 987654321 } },
            1: { 0: { v: value + 1 } },
          },
        },
      },
    },
  };
}

test('the public Univer engine calculates cross-workbook formulas and recalculates source cells', async () => {
  const result = await runFormula(definition('=SUM(Budget.Summary.B1,Forecast.Summary.A2)'), [
    source('budget', 7),
    source('forecast', 20),
  ]);
  expect(result).toEqual({ ok: true, kind: 'scalar', value: 35 });
});

test('native range and array formula results use table presentation', async () => {
  expect(await runFormula(definition('=Budget.Summary.A1:B2'), [source('budget', 7)])).toEqual({
    ok: true,
    kind: 'table',
    // Univer array references coerce empty spreadsheet cells to zero, as formulas do.
    rows: [
      [7, 14],
      [8, 0],
    ],
  });
  expect(await runFormula(definition('={1,2;3,4}'), [])).toEqual({
    ok: true,
    kind: 'table',
    rows: [
      [1, 2],
      [3, 4],
    ],
  });
});

test('oversized arrays fail as a whole and source external references cannot reuse cached secrets', async () => {
  expect(await runFormula(definition('=SEQUENCE(31,1)'), [])).toEqual({
    ok: false,
    reason: 'too-large',
  });
  const book = source('budget', 7);
  book.snapshot.sheets.summary.cellData![0]![0] = {
    f: '=[not-authorized]Summary!A1',
    v: 'PRIVATE-CACHED-SECRET',
  };
  const result = await runFormula(definition('=Budget.Summary.A1'), [book]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE-CACHED-SECRET');
  expect(result).not.toMatchObject({ ok: true, value: 7 });
});

test('worker deadlines terminate execution and release admission for the next request', async () => {
  const pending = runFormula(definition('=SUM(1,2)'), [], 1);
  expect(await runFormula(definition('=SUM(1,2)'), [])).toEqual({
    ok: false,
    reason: 'busy',
  });
  expect(await pending).toEqual({ ok: false, reason: 'timeout' });
  expect(await runFormula(definition('=SUM(1,2)'), [])).toEqual({
    ok: true,
    kind: 'scalar',
    value: 3,
  });
});

test('native error values remain readable while a formula with no parsed result fails', async () => {
  expect(await runFormula(definition('=$@'), [])).toEqual({
    ok: false,
    reason: 'invalid-formula',
  });
  expect(await runFormula(definition('=NOFUNCTION(1)'), [])).toEqual({
    ok: true,
    kind: 'scalar',
    value: '#NAME?',
  });
  expect(await runFormula(definition('="#NAME?"'), [])).toEqual({
    ok: true,
    kind: 'scalar',
    value: '#NAME?',
  });
});
