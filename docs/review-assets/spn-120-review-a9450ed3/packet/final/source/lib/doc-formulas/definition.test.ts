import { expect, test } from 'vitest';
import { formatFormulaValue, parseFormula, validateFormulaDefinition } from './definition.ts';

test('friendly references retain exact spans and quote names without interpreting string literals', () => {
  const expression = `=SUM('Owner''s Budget'.'This year'.$A$1:C30,Forecast.Summary.A2,"Fake.Sheet.A1")`;
  const parsed = parseFormula(expression);
  expect(parsed).toEqual([
    {
      start: 5,
      end: 43,
      documentName: "Owner's Budget",
      sheetName: 'This year',
      range: 'A1:C30',
    },
    {
      start: 44,
      end: 63,
      documentName: 'Forecast',
      sheetName: 'Summary',
      range: 'A2',
    },
  ]);
  expect(parsed.map((reference) => expression.slice(reference.start, reference.end))).toEqual([
    "'Owner''s Budget'.'This year'.$A$1:C30",
    'Forecast.Summary.A2',
  ]);
  expect(parseFormula('={1,2;3,4}')).toEqual([]);
  expect(parseFormula('=IF(TRUE,"a""Budget.Sheet.A1",3.5)')).toEqual([]);
});

test('definitions bind every parsed reference and cannot carry persisted computed values', () => {
  const expression = '=Budget.Summary.A1';
  const parsed = parseFormula(expression)[0];
  const definition = {
    version: 1,
    expression,
    references: [
      { start: parsed.start, end: parsed.end, itemId: 'book', sheetId: 'sheet', range: 'A1' },
    ],
    format: 'number',
  };
  expect(validateFormulaDefinition(definition)).toEqual(definition);
  for (const bad of [
    { ...definition, result: 4000 },
    { ...definition, references: [] },
    { ...definition, format: '<img>' },
    { ...definition, references: [{ ...definition.references[0], start: 2 }] },
    { ...definition, references: [{ ...definition.references[0], range: 'A1:C30' }] },
    { ...definition, references: [{ ...definition.references[0], value: 4000 }] },
  ])
    expect(() => validateFormulaDefinition(bad)).toThrow();
});

test('malformed, raw engine references and oversized expressions fail before evaluation', () => {
  for (const expression of [
    'SUM(1,2)',
    '=',
    '=Book.Sheet.A0',
    '=Book.Sheet.A2:A1',
    '=Book.Sheet.A100001',
    '=Book.Sheet.ZZZ1',
    '=Book.Sheet.A1extra',
    "='unfinished.Sheet.A1",
    '="unterminated',
    '=[private]Sheet!A1',
    '=Sheet!A1',
    '=Book.Sheet.A1\n',
    `=${'1+'.repeat(1024)}1`,
  ])
    expect(() => parseFormula(expression), expression).toThrow();
});

test('formatting is shared across scalar and table renderers', () => {
  expect(formatFormulaValue(null)).toBe('');
  expect(formatFormulaValue(true)).toBe('TRUE');
  expect(formatFormulaValue('=not evaluated', 'currency')).toBe('=not evaluated');
  expect(formatFormulaValue(12.5, 'number')).toBe('12.50');
  expect(formatFormulaValue(0.125, 'percent')).toBe('12.5%');
  expect(formatFormulaValue(1234.5, 'currency')).toBe('$1,234.50');
  expect(formatFormulaValue(25569, 'date')).toBe('Jan 1, 1970');
  expect(formatFormulaValue(1, 'date')).toBe('Jan 1, 1900');
  expect(formatFormulaValue(60, 'date')).toBe('Feb 29, 1900');
});
