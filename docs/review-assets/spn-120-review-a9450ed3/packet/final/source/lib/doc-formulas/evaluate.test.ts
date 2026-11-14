import { expect, test } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { FormulaSource } from './definition.ts';
import { formulaResult, formulaWorkbooks } from './evaluate.ts';

test('result shape follows dimensionality without truncating cells or accepting complex values', () => {
  expect(formulaResult([[7]])).toEqual({ ok: true, kind: 'scalar', value: 7 });
  expect(
    formulaResult([
      [1, 2],
      [3, null],
    ]),
  ).toEqual({
    ok: true,
    kind: 'table',
    rows: [
      [1, 2],
      [3, null],
    ],
  });
  expect(formulaResult(Array.from({ length: 51 }, () => [1]))).toEqual({
    ok: false,
    reason: 'too-large',
  });
  expect(formulaResult('x'.repeat(65536))).toEqual({ ok: false, reason: 'too-large' });
  for (const value of [undefined, [], [[1], [2, 3]], { value: 7 }, Number.POSITIVE_INFINITY])
    expect(formulaResult(value)).toEqual({ ok: false, reason: 'invalid-formula' });
});

test('calculation inputs drop resources and cached formula values without mutating snapshots', () => {
  const source: FormulaSource = {
    itemId: 'stable-item',
    snapshot: {
      id: 'old-unit',
      name: 'Budget',
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      sheetOrder: ['sheet'],
      sheets: {
        sheet: {
          id: 'sheet',
          name: 'Summary',
          cellData: {
            0: { 0: { v: 7 }, 1: { f: '=A1*2', v: 999 }, 2: { si: 'shared', v: 999 } },
          },
        },
      },
      styles: { private: { ff: 'Secret font' } },
      resources: [{ name: 'DRAWINGS', data: 'https://private.example/image' }],
    },
  };
  const books = formulaWorkbooks([source]);
  expect(books[0].id).toBe('stable-item');
  expect(books[0].resources).toBeUndefined();
  expect(books[0].styles).toEqual({});
  expect(books[0].sheets.sheet.cellData?.[0]?.[1]).toMatchObject({ f: '=A1*2', v: null });
  expect(books[0].sheets.sheet.cellData?.[0]?.[2]).toMatchObject({ si: 'shared', v: null });
  expect(source.snapshot.sheets.sheet.cellData?.[0]?.[1]?.v).toBe(999);
});
