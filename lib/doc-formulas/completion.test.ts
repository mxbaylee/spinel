import { describe, expect, it } from 'vitest';
import { completeFormula, moveFormulaBindings } from './completion.ts';
const sources = [
  { itemId: 'budget-one', name: 'Budget' },
  { itemId: 'budget-two', name: 'Budget' },
  { itemId: 'forecast', name: 'Forecast' },
];
const sheets = [
  { sheetId: 'summary', name: 'Summary' },
  { sheetId: 'next', name: 'Next year' },
];
describe('readable reference completion', () => {
  it('offers authorized names with distinct identities inside a multi-source expression', () => {
    const value = '=SUM(Forecast.Summary.A1,Bud)';
    const matches = completeFormula(value, value.length - 1, sources, sheets).options;
    expect(matches.map((item) => item.label)).toEqual(['Budget (budget-o)', 'Budget (budget-t)']);
    expect(matches[1]?.source.itemId).toBe('budget-two');
    expect(matches[1]?.expression).toBe('=SUM(Forecast.Summary.A1,Budget.)');
    expect(
      completeFormula('=Budget.Su', 10, sources, sheets, 'budget-two').options[0]?.expression,
    ).toBe('=Budget.Summary.');
  });
  it('quotes worksheet names and does not complete inside string literals', () => {
    expect(
      completeFormula('=Budget.N', 9, sources, sheets, 'budget-one').options[0]?.expression,
    ).toBe("=Budget.'Next year'.");
    expect(completeFormula('="Budget', 8, sources, sheets).options).toEqual([]);
    expect(
      completeFormula('=Budget.Summary.A1', 18, sources, sheets, 'budget-one').options,
    ).toEqual([]);
  });
  it('moves explicit IDs through unrelated text edits and drops bindings when their text is edited', () => {
    const binding = { start: 1, end: 18, itemId: 'budget-two', sheetId: 'summary', range: 'A1' };
    expect(moveFormulaBindings('=Budget.Summary.A1', '=SUM(Budget.Summary.A1', [binding])).toEqual([
      { ...binding, start: 5, end: 22 },
    ]);
    expect(moveFormulaBindings('=Budget.Summary.A1', '=Budget.Summary.B2', [binding])).toEqual([]);
  });
});
