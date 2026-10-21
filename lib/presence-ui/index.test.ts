import { expect, test } from 'vitest';
import { parseSheetSelection, boundedSheetRange } from './selection.ts';
test('only bounded Sheet addresses are accepted as cursor ranges', () => {
  expect(parseSheetSelection('first!A1:B3')).toEqual({ sheetId: 'first', address: 'A1:B3' });
  expect(parseSheetSelection('first!C9')).toEqual({ sheetId: 'first', address: 'C9' });
  for (const value of [
    '',
    '!A1',
    'first!A0',
    'first!A-1',
    'first!A9007199254740992',
    'first!A1<script>',
    '1:2:1:TEXT::-1',
  ])
    expect(parseSheetSelection(value)).toBeUndefined();
});

test('row, column and all selections become bounded cell rectangles', () => {
  expect(
    boundedSheetRange({ startRow: 1, endRow: 1, startColumn: NaN, endColumn: NaN }, 200, 30),
  ).toEqual({ startRow: 1, endRow: 1, startColumn: 0, endColumn: 29 });
  expect(
    boundedSheetRange({ startRow: NaN, endRow: NaN, startColumn: 2, endColumn: 2 }, 200, 30),
  ).toEqual({ startRow: 0, endRow: 199, startColumn: 2, endColumn: 2 });
  expect(
    boundedSheetRange(
      { startRow: 0, endRow: Infinity, startColumn: 0, endColumn: Infinity },
      200,
      30,
    ),
  ).toEqual({ startRow: 0, endRow: 199, startColumn: 0, endColumn: 29 });
});
