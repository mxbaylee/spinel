import { expect, test } from 'vitest';
import { parseSheetSelection } from './selection.ts';
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
