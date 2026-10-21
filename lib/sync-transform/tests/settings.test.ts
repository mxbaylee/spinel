import { describe, expect, test } from 'vitest';
import { transformMutation } from '../index.ts';
import type { Mutation, Side } from '../index.ts';
import { structureIds } from '../src/structure.ts';
import { settingIds } from '../src/settings.ts';
import { withStructure } from './generate.ts';
import { settingEdit } from './generate-sheet.ts';
import { cols, insertRows, removeCols, removeRows, target } from './edits.ts';
import { converges } from './harness.ts';
import { convergesOver } from './simulate.ts';

const m = (id: string, params: object): Mutation => ({ id, params: { ...target, ...params } });

const rowCount = (count: number) => m(settingIds.rowCount, { rowCount: count });
const columnCount = (count: number) => m(settingIds.columnCount, { columnCount: count });
const name = (value: string) => m(settingIds.name, { name: value });

/** Sheet s1 and the workbook once `a` and `b` meet, after checking both orders agree. */
function converged(a: Mutation, b: Mutation, side: Side = 'left') {
  const { workbook } = converges(a, b, { side });
  return { sheet: workbook.sheets.s1, workbook };
}

describe('transform', () => {
  for (const side of ['left', 'right'] as const) {
    test(`two of the same setting keep the winner's value (${side} wins)`, () => {
      expect(converged(name('Left'), name('Right'), side).sheet.name).toBe(
        side === 'left' ? 'Left' : 'Right',
      );
      const frozen = (ySplit: number) =>
        m(settingIds.frozen, { startRow: ySplit, startColumn: 0, ySplit, xSplit: 0 });
      expect(converged(frozen(1), frozen(3), side).sheet.freeze.ySplit).toBe(
        side === 'left' ? 1 : 3,
      );
    });

    test(`two workbook names keep the winner's (${side} wins)`, () => {
      const book = (value: string) => ({
        id: settingIds.workbookName,
        params: { unitId: 'wb', name: value },
      });
      expect(converged(book('A'), book('B'), side).workbook.name).toBe(side === 'left' ? 'A' : 'B');
    });
  }

  test('different settings, or the same one on different sheets, both apply', () => {
    const color = m(settingIds.tabColor, { color: '#0000ff' });
    expect(transformMutation(name('X'), color, 'right')).toEqual([name('X')]);
    const other = { id: settingIds.name, params: { unitId: 'wb', subUnitId: 's2', name: 'Y' } };
    expect(transformMutation(name('X'), other, 'right')).toEqual([name('X')]);
  });
});

describe('remap', () => {
  test('a row count grows past an insert and shrinks past a remove', () => {
    const insert = insertRows(2, 2);
    expect(converged(rowCount(20), insert).sheet.rowCount).toBe(22);
    const remove = removeRows(0, 1);
    expect(converged(rowCount(20), remove).sheet.rowCount).toBe(19);
  });

  test('a column count follows column edits only, and no move', () => {
    expect(converged(columnCount(9), removeCols(1, 2)).sheet.columnCount).toBe(7);
    const insertRow = insertRows(2, 2);
    expect(transformMutation(columnCount(9), insertRow, 'left')).toEqual([columnCount(9)]);
    const move = m(structureIds.moveCols, { sourceRange: cols(0, 0), targetRange: cols(3, 3) });
    expect(transformMutation(columnCount(9), move, 'left')).toEqual([columnCount(9)]);
  });

  test('frozen panes stay put, as Univer sends its own SetFrozen with a row edit', () => {
    const frozen = m(settingIds.frozen, { startRow: 2, startColumn: 0, ySplit: 2, xSplit: 0 });
    expect(transformMutation(frozen, insertRows(0, 1), 'left')).toEqual([frozen]);
  });
});

test('sheet and workbook settings converge with structural edits', () => {
  convergesOver(withStructure(settingEdit), { seeds: 30 });
}, 300_000);
