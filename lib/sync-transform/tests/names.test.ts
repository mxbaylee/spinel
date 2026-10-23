import { Direction, RANGE_TYPE } from '@univerjs/core';
import { describe, expect, test } from 'vitest';
import type { Mutation } from '../index.ts';
import { cellIds } from '../src/cells.ts';
import { nameIds } from '../src/names.ts';
import { structureIds } from '../src/structure.ts';
import { cols, rows } from './edits.ts';
import { capture, seededWorkbook, withStructure } from './generate.ts';
import { nameEdit } from './generate-names.ts';
import { settingEdit } from './generate-sheet.ts';
import { converges, refusedBothWays, Replica } from './harness.ts';
import { convergesOver } from './simulate.ts';

const unitId = 'wb';
const document = { workbook: seededWorkbook() };
// "budget" names rows 3 to 5 of the first two columns of sheet One (s1).
const budget = { unitId, id: 'N', name: 'budget', formulaOrRefString: 'One!$A$3:$B$5' };
const setup: Mutation[] = [{ id: nameIds.set, params: budget }];

/** What Univer's `command` sends after `before`, by default "budget" defined. */
function sent(command: string, params: object, before = setup): Mutation[] {
  const replica = new Replica(document);
  replica.apply(before);
  return capture(replica, command, { unitId, ...params })!;
}

const insertRow = (subUnitId: string) =>
  sent('sheet.command.insert-row-by-range', {
    subUnitId,
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 },
    direction: Direction.UP,
  });
const setName = (change: object) =>
  sent('sheet.command.set-defined-name', { ...budget, ...change });
const removeName = () => sent('sheet.command.remove-defined-name', budget);
const write = sent('sheet.command.set-range-values', {
  subUnitId: 's1',
  range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
  value: { v: 'x' },
});
const namesAfter = (a: Mutation[], b: Mutation[], side: 'left' | 'right') =>
  converges(a, b, { side, setup, document }).names;

test('a row insert moves the names it shifts, past a concurrent cell write', () => {
  for (const side of ['left', 'right'] as const) {
    expect(namesAfter(insertRow('s1'), write, side).N.formulaOrRefString).toBe('One!$A$4:$B$6');
  }
});

// Decision (owner, chat 2026-10-22): see names.racesName.
describe('a name edit and a concurrent edit that rewrites names', () => {
  const peers: [string, Mutation[]][] = [
    ['a row insert on its sheet', insertRow('s1')],
    ['a row insert on another sheet', insertRow('s2')],
    [
      'a sheet rename',
      sent('sheet.command.set-worksheet-name', { subUnitId: 's1', name: 'First' }),
    ],
    [
      'a column insert',
      sent('sheet.command.insert-col-by-range', {
        subUnitId: 's1',
        range: cols(0),
        direction: Direction.LEFT,
      }),
    ],
    [
      'a row remove',
      sent('sheet.command.remove-row-by-range', { subUnitId: 's1', range: rows(0) }),
    ],
    [
      'a row move',
      sent('sheet.command.move-rows', {
        subUnitId: 's1',
        fromRange: rows(0),
        toRange: rows(8),
        range: { ...rows(0), rangeType: RANGE_TYPE.ROW },
      }),
    ],
    [
      'a column remove',
      sent('sheet.command.remove-col-by-range', { subUnitId: 's1', range: cols(0) }),
    ],
    [
      'a column move',
      sent('sheet.command.move-cols', {
        subUnitId: 's1',
        fromRange: cols(0),
        toRange: cols(4),
        range: { ...cols(0), rangeType: RANGE_TYPE.COLUMN },
      }),
    ],
    ['a workbook rename', sent('sheet.command.set-workbook-name', { name: 'Budgets' })],
    [
      'a sheet removal',
      // RemoveSheetMutation carries no index; the sender adds the one the transform needs.
      sent('sheet.command.remove-sheet', { subUnitId: 's2' }).map((m) =>
        m.id === structureIds.removeSheet ? { ...m, params: { ...m.params, index: 1 } } : m,
      ),
    ],
    [
      'a range move',
      [
        {
          id: cellIds.moveRange,
          params: {
            unitId,
            fromRange: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
            toRange: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
            from: { subUnitId: 's1', value: { 0: { 0: null } } },
            to: { subUnitId: 's2', value: { 0: { 0: { v: 's1:0:0' } } } },
          },
        },
      ],
    ],
  ];
  test.each(peers)('are refused: %s', (_name, peer) => {
    refusedBothWays(setName({ name: 'total' }), peer, 'name-race');
  });
});

test('of two edits of one name, the first accepted stands', () => {
  const moved = setName({ formulaOrRefString: 'Two!$A$1:$A$2' });
  const widened = setName({ formulaOrRefString: 'One!$A$3:$C$5' });
  expect(namesAfter(moved, widened, 'left').N.formulaOrRefString).toBe('Two!$A$1:$A$2');
  expect(namesAfter(moved, widened, 'right').N.formulaOrRefString).toBe('One!$A$3:$C$5');
  const renamed = setName({ name: 'total' });
  expect(namesAfter(removeName(), renamed, 'left')).toEqual({});
  expect(namesAfter(removeName(), renamed, 'right').N.name).toBe('total');
});

describe('a rename and a concurrent edit of the same name, with a cell that uses it', () => {
  // Two!A1 holds =SUM(budget), so a rename's command rewrites it too.
  const used: Mutation[] = [
    ...setup,
    {
      id: cellIds.setRangeValues,
      params: { unitId, subUnitId: 's2', cellValue: { 0: { 0: { f: '=SUM(budget)' } } } },
    },
  ];
  const edit = (change: object) =>
    sent('sheet.command.set-defined-name', { ...budget, ...change }, used);
  const renamed = edit({ name: 'total' });
  // The peer, and the name it leaves when it wins (none for a removal).
  const peers: [string, Mutation[], string | undefined][] = [
    ['a rename', edit({ name: 'spend' }), 'spend'],
    ['a repoint', edit({ formulaOrRefString: 'Two!$A$1:$A$2' }), 'budget'],
    ['a removal', sent('sheet.command.remove-defined-name', budget, used), undefined],
  ];
  test.each(peers)('%s: the first accepted stands, and the cell names it', (_n, peer, name) => {
    for (const [side, winner] of [
      ['left', 'total'],
      ['right', name],
    ] as const) {
      const after = converges(renamed, peer, { side, setup: used, document });
      expect(after.names.N?.name, side).toBe(winner);
      expect(after.workbook.sheets.s2.cellData[0][0].f, side).toBe(
        winner ? `=SUM(${winner})` : '=SUM(#REF!)',
      );
    }
  });
});

// Decision (agent, chat 2026-10-22): see names.racesName.
describe('two names added with the same text', () => {
  const add = (id: string, name: string, localSheetId?: string) =>
    sent('sheet.command.insert-defined-name', {
      id,
      name,
      formulaOrRefString: 'Two!$A$1',
      ...(localSheetId !== undefined && { localSheetId }),
    });

  test('are refused, whatever their case or scope', () => {
    refusedBothWays(add('M', 'total'), add('K', 'Total'), 'name-race');
    refusedBothWays(add('M', 'total', ''), add('K', 'total'), 'name-race');
    refusedBothWays(add('M', 'total', 's1'), add('K', 'TOTAL', 's1'), 'name-race');
    refusedBothWays(add('M', 'total', 's1'), add('K', 'total'), 'name-race');
  });
});

// README "Known limits": a shift at the content's edge sends no MoveRange, so
// it does not race a name set. Row 12 is s1's last row with content.
test("a delete of the content's last row and a name added on it converge", () => {
  const deleted = sent('sheet.command.delete-range-move-up', {
    subUnitId: 's1',
    range: { startRow: 11, endRow: 11, startColumn: 0, endColumn: 1 },
  });
  expect(deleted.map((m) => m.id)).not.toContain(cellIds.moveRange);
  const added = sent('sheet.command.insert-defined-name', {
    id: 'M',
    name: 'total',
    formulaOrRefString: 'One!$A$12:$B$12',
  });
  for (const side of ['left', 'right'] as const) {
    expect(namesAfter(deleted, added, side).M.formulaOrRefString).toBe('One!$A$12:$B$12');
  }
});

test('a removal and a row insert that moves the name: the first accepted stands', () => {
  expect(namesAfter(removeName(), insertRow('s1'), 'left')).toEqual({});
  expect(namesAfter(removeName(), insertRow('s1'), 'right').N.formulaOrRefString).toBe(
    'One!$A$4:$B$6',
  );
});

test('edits of different names both land', () => {
  const added = sent('sheet.command.insert-defined-name', {
    id: 'M',
    name: 'total',
    formulaOrRefString: 'Two!$A$1',
  });
  for (const side of ['left', 'right'] as const) {
    const names = namesAfter(added, setName({ name: 'spend' }), side);
    expect([names.M.name, names.N.name]).toEqual(['total', 'spend']);
  }
});

// Every name edit runs Univer's own commands, which is slow, so the clock is
// off (a timeout of 0), as in cells.test.ts.
test('names converge with row, column, sheet and sheet-name edits', () => {
  convergesOver(withStructure(nameEdit), { seeds: 20 });
  convergesOver(withStructure(nameEdit, settingEdit), { seeds: 10 });
}, 0);
