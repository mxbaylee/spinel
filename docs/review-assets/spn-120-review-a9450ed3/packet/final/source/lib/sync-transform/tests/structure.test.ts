import { expect, test } from 'vitest';
import { insertSheet, moveSheet } from './edits.ts';
import { structuralEdit } from './generate.ts';
import { converges } from './harness.ts';
import { convergesOver } from './simulate.ts';

// SetWorksheetOrderCommand sends a move even when a tab is dropped where it was.
test.each(['left', 'right'] as const)('a sheet dropped in place meets a move (%s wins)', (side) => {
  const setup = [insertSheet('n1', 2)];
  const { workbook } = converges(moveSheet('s1', 0, 0), moveSheet('s2', 1, 0), { setup, side });
  // Winning, the drop keeps s1 first; losing, s2 lands before it.
  expect(workbook.sheetOrder).toEqual(side === 'left' ? ['s1', 's2', 'n1'] : ['s2', 's1', 'n1']);
});

test('row, column and sheet structure converges across two clients', () => {
  convergesOver(structuralEdit, { seeds: 40, mutations: 200 });
}, 300_000);
