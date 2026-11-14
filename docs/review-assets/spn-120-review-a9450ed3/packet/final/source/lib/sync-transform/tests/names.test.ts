import { CellValueType, Direction, RANGE_TYPE } from '@univerjs/core';
import { describe, expect, test } from 'vitest';
import { transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { mergeIds } from '../src/merges.ts';
import { nameIds } from '../src/names.ts';
import { propertyIds } from '../src/properties.ts';
import { claimKey } from '../src/state.ts';
import { structureIds } from '../src/structure.ts';
import { cellIds } from '../src/writes.ts';
import { cols, rows } from './edits.ts';
import { capture, seededWorkbook, withStructure } from './generate.ts';
import { realBook } from './generate-cells.ts';
import { nameEdit } from './generate-names.ts';
import { settingEdit } from './generate-sheet.ts';
import { converges, liveCells, refusedBothWays, Replica } from './harness.ts';
import { convergesOver } from './simulate.ts';

const unitId = 'wb';
const document = { workbook: seededWorkbook() };
// "budget" names rows 3 to 5 of the first two columns of sheet One (s1).
const budget = { unitId, id: 'N', name: 'budget', formulaOrRefString: 'One!$A$3:$B$5' };
const setup: Mutation[] = [{ id: nameIds.set, params: budget }];

/** The cells of `on` after `before`, for a transform called directly. */
/** An absolute write of s1's A1 (see state.absolute), as `transform` returns one. */
function absoluteWrite(cell: object, claims: object, trigger: string): Mutation {
  const keys = ['v', 't', 'f', 'si', 'p', 's', 'custom', 'ft', 'fd', 'ref', 'xf'];
  const value = Object.fromEntries(keys.map((key) => [key, (cell as any)[key] ?? null]));
  return {
    id: cellIds.setRangeValues,
    params: {
      unitId,
      subUnitId: 's1',
      trigger,
      isOverrideStyle: true,
      cellValue: { 0: { 0: { ...value, [claimKey]: claims } } },
    },
  };
}

function cellsAfter(before = setup, on = document) {
  const replica = new Replica(on);
  replica.apply(before);
  return { cells: liveCells(replica) };
}

/** What Univer's `command` sends after `before`, by default "budget" defined. */
function sent(command: string, params: object, before = setup, on = document): Mutation[] {
  const replica = new Replica(on);
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
// Two!A1 holds =SUM(budget), so a rename's or removal's command rewrites it too.
const used: Mutation[] = [
  ...setup,
  {
    id: cellIds.setRangeValues,
    params: { unitId, subUnitId: 's2', cellValue: { 0: { 0: { f: '=SUM(budget)' } } } },
  },
];
const namesAfter = (a: Mutation[], b: Mutation[], side: 'left' | 'right') =>
  converges(a, b, { side, setup, document }).names;
/** A formula typed at `row`, `col` of `subUnitId`. */
const formula = (subUnitId: string, row: number, col: number, f: string): Mutation[] => [
  {
    id: cellIds.setRangeValues,
    params: { unitId, subUnitId, cellValue: { [row]: { [col]: { f } } } },
  },
];

test('a row insert moves the names it shifts, past a concurrent cell write', () => {
  for (const side of ['left', 'right'] as const) {
    expect(namesAfter(insertRow('s1'), write, side).N.formulaOrRefString).toBe('One!$A$4:$B$6');
  }
});

/** Edits whose commands make Univer rewrite names and formulas. */
const rewriters: [string, Mutation[]][] = [
  ['a row insert on its sheet', insertRow('s1')],
  ['a row insert on another sheet', insertRow('s2')],
  ['a sheet rename', sent('sheet.command.set-worksheet-name', { subUnitId: 's1', name: 'First' })],
  [
    'a column insert',
    sent('sheet.command.insert-col-by-range', {
      subUnitId: 's1',
      range: cols(0),
      direction: Direction.LEFT,
    }),
  ],
  ['a row remove', sent('sheet.command.remove-row-by-range', { subUnitId: 's1', range: rows(0) })],
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

// Decision (owner, chat 2026-10-22): see names.racesName, for a set.
// Decision (agent, chat 2026-10-22): see names.racesName, for a removal.
describe('a name set or removal and a concurrent edit that rewrites names', () => {
  test.each(rewriters)('are refused: %s', (_name, peer) => {
    refusedBothWays(setName({ name: 'total' }), peer, 'name-race');
    refusedBothWays(removeName(), peer, 'name-race');
  });

  // A removal's own rewrite of Two!A1 to #REF! would stand if the first
  // accepted row insert's name set dropped the removal.
  test('a removal of a name a cell uses and a row insert that moves the name are refused', () => {
    const removal = sent('sheet.command.remove-defined-name', budget, used);
    expect(removal.map(({ id }) => id)).toContain(cellIds.setRangeValues);
    refusedBothWays(removal, insertRow('s1'), 'name-race');
  });
});

// Decision (owner, chat 2026-10-22): see names.transform.
test('of two edits of one name, the first accepted stands', () => {
  const moved = setName({ formulaOrRefString: 'Two!$A$1:$A$2' });
  const widened = setName({ formulaOrRefString: 'One!$A$3:$C$5' });
  expect(namesAfter(moved, widened, 'left').N.formulaOrRefString).toBe('Two!$A$1:$A$2');
  expect(namesAfter(moved, widened, 'right').N.formulaOrRefString).toBe('One!$A$3:$C$5');
  const renamed = setName({ name: 'total' });
  expect(namesAfter(removeName(), renamed, 'left')).toEqual({});
  expect(namesAfter(removeName(), renamed, 'right').N.name).toBe('total');
});

// Decision (owner, chat 2026-10-22): see names.transform.
describe('a rename and a concurrent edit of the same name, with a cell that uses it', () => {
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

// Decision (owner, chat 2026-10-22): see names.refuseFormulaRaces.
describe('a formula write and a concurrent edit that rewrites formulas', () => {
  test.each(rewriters)('a formula typed against %s is refused', (_name, peer) => {
    refusedBothWays(formula('s2', 0, 0, '=One!A8'), peer, 'formula-race');
  });

  // Replay round 20: a sender's absolute write of a formula that claims none
  // of it. `'formula-race'` reads the claims, so it passed in all four orders
  // and kept the stale =One!A8. A claim picks which of a write's keys are its
  // own edit, so every key it does not claim must be its base cell's
  // (decision 33): Two!A1 holds no formula, and the write is rejected.
  test('an absolute write of a formula it does not claim is rejected, not merged', () => {
    const keys = ['v', 't', 'f', 'si', 'p', 's', 'custom', 'ft', 'fd', 'ref', 'xf'];
    const all = Object.fromEntries(keys.map((key) => [key, null]));
    const forged: Mutation[] = [
      {
        id: cellIds.setRangeValues,
        params: {
          unitId,
          subUnitId: 's2',
          isOverrideStyle: true,
          cellValue: { 0: { 0: { ...all, f: '=One!A8', [claimKey]: {} } } },
        },
      },
    ];
    const peer = insertRow('s1');
    for (const side of ['left', 'right'] as const) {
      for (const [x, y] of [
        [forged, peer],
        [peer, forged],
      ]) {
        expect(() => transform(x, y, side, cellsAfter()), side).toThrow(TypeError);
      }
    }
    // Claimed, it is a formula write, and refused as one.
    const claimed = structuredClone(forged);
    claimed[0].params.cellValue[0][0][claimKey] = { f: '=One!A8', v: null };
    refusedBothWays(claimed, peer, 'formula-race', cellsAfter().cells);
  });

  /** A row inserted above row 1 of sheet One, after `before`, with no name defined. */
  const insertAbove = (before: Mutation[]) =>
    sent(
      'sheet.command.insert-row-by-range',
      {
        subUnitId: 's1',
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 },
        direction: Direction.UP,
      },
      before,
    );

  // Each command rewrites the formula to =One!A9 for its own insert, while two
  // inserts in turn leave A8's value at A10.
  test('two row inserts that each move a formula on another sheet are refused', () => {
    const insert = insertAbove(formula('s2', 0, 0, '=One!A8'));
    const rewrite = insert.find(({ id }) => id === cellIds.setRangeValues);
    expect(rewrite?.params.cellValue[0][0].f).toBe('=One!A9');
    refusedBothWays(insert, insert, 'formula-race');
  });

  test('two row inserts that each move a formula on their own sheet are refused', () => {
    const insert = insertAbove(formula('s1', 11, 5, '=A8'));
    expect(insert.map(({ id }) => id)).toContain(cellIds.setRangeValues);
    refusedBothWays(insert, insert, 'formula-race');
  });

  // Decision (owner, chat 2026-10-22): see names.refuseFormulaRaces, and
  // SPN-056 decision 22. A row command re-sends each formula that reads its
  // sheet, moved or not, so even inserts that move no formula race.
  test('two row inserts below all content, on a sheet with one formula, are refused', () => {
    const before = formula('s1', 5, 5, '=A1');
    const below = (row: number) =>
      sent(
        'sheet.command.insert-row-by-range',
        {
          subUnitId: 's1',
          range: { startRow: row, endRow: row, startColumn: 0, endColumn: 25 },
          direction: Direction.UP,
        },
        before,
        { workbook: realBook() },
      );
    const [first, second] = [below(40), below(50)];
    for (const insert of [first, second]) {
      const rewrite = insert.find(({ id }) => id === cellIds.setRangeValues);
      expect(rewrite?.params.cellValue[5][5].f).toBe('=A1');
    }
    refusedBothWays(first, second, 'formula-race');
  });

  test('a formula typed while a row is inserted is refused', () => {
    const typed = sent(
      'sheet.command.set-range-values',
      {
        subUnitId: 's2',
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
        value: { f: '=One!A8' },
      },
      [],
    );
    refusedBothWays(typed, insertAbove([]), 'formula-race');
  });

  // Two!A1 holds =One!A8, which the insert's command rewrites to =One!A9.
  // Accepted first, that rewrite would put the formula back over the value.
  describe('a value typed over a formula a row insert rewrites', () => {
    const before = formula('s2', 0, 0, '=One!A8');
    const typed = (row: number, col: number) =>
      sent(
        'sheet.command.set-range-values',
        {
          subUnitId: 's2',
          range: { startRow: row, endRow: row, startColumn: col, endColumn: col },
          value: { v: 3, f: null, si: null, p: null },
        },
        before,
      );

    test('is refused', () => {
      refusedBothWays(typed(0, 0), insertAbove(before), 'formula-race');
    });

    // A style writes no key the rewrite writes, so the two merge.
    test('a bold on it merges', () => {
      const bold: Mutation[] = [
        {
          id: cellIds.setRangeValues,
          params: { unitId, subUnitId: 's2', cellValue: { 0: { 0: { s: { bl: 1 } } } } },
        },
      ];
      for (const side of ['left', 'right'] as const) {
        const after = converges(bold, insertAbove(before), { side, setup: before, document });
        expect(after.workbook.sheets.s2.cellData[0][0]).toMatchObject({
          f: '=One!A9',
          s: { bl: 1 },
        });
      }
    });

    // The rewrite writes no value, so a number format on it was once refused
    // as a format race; resolved on the cell, both land.
    test('a number format on it lands with the rewrite', () => {
      const numfmt: Mutation[] = [
        {
          id: cellIds.setNumfmt,
          params: {
            unitId,
            subUnitId: 's2',
            values: { k: { ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }] } },
            refMap: { k: { pattern: '0%' } },
          },
        },
      ];
      const rewritten = insertAbove(before);
      const expected = {
        v: 's2:0:0',
        t: CellValueType.STRING,
        f: '=One!A9',
        s: { n: { pattern: '0%' } },
      };
      // The outbound rewrite leaves v untouched. Only the local formula
      // normalizer clears v/t, and capture no longer forwards local work.
      // Pin native replay without any transform before checking the merge.
      for (const mutations of [
        [...numfmt, ...rewritten],
        [...rewritten, ...numfmt],
      ]) {
        const native = new Replica(document);
        try {
          native.apply([...before, ...mutations]);
          const workbook = native.workbook()!;
          const cell = workbook.getSheetBySheetId('s2')!.getCellRaw(0, 0)!;
          const s = typeof cell.s === 'string' ? workbook.getStyles().get(cell.s) : cell.s;
          expect({ ...cell, s }).toEqual(expected);
        } finally {
          native.univer.dispose();
        }
      }
      for (const side of ['left', 'right'] as const) {
        const after = converges(numfmt, rewritten, { side, setup: before, document });
        expect(after.workbook.sheets.s2.cellData[0][0]).toEqual(expected);
      }
    });

    test('a value typed in another cell passes', () => {
      for (const side of ['left', 'right'] as const) {
        expect(transform(typed(1, 1), insertAbove(before), side)).toEqual(typed(1, 1));
        const after = converges(typed(1, 1), insertAbove(before), {
          side,
          setup: before,
          document,
        });
        expect(after.workbook.sheets.s2.cellData[0][0].f).toBe('=One!A9');
        expect(after.workbook.sheets.s2.cellData[1][1].v).toBe(3);
      }
    });
  });

  // Each rename's command rewrites Two!A1 for its own name only, so the first
  // accepted rewrite would leave the other name's old text, #NAME?, on both screens.
  test('renames of two names that one formula uses are refused', () => {
    const spend = { unitId, id: 'K', name: 'spend', formulaOrRefString: 'One!$C$3:$C$5' };
    const both = [
      ...setup,
      { id: nameIds.set, params: spend },
      ...formula('s2', 0, 0, '=SUM(budget)+SUM(spend)'),
    ];
    const total = sent('sheet.command.set-defined-name', { ...budget, name: 'total' }, both);
    const cost = sent('sheet.command.set-defined-name', { ...spend, name: 'cost' }, both);
    refusedBothWays(total, cost, 'formula-race');
  });

  // B types =SUM(budget) at Two!B6, then renames budget to spend, so its
  // command rewrites B6 to =SUM(spend). Were A's rename to total accepted
  // first, B's rename would be dropped and B6 would read #NAME? on both screens.
  test('a rename against a rename of the same name with a formula only one side had is refused', () => {
    const typed = formula('s2', 5, 1, '=SUM(budget)');
    const spend = sent('sheet.command.set-defined-name', { ...budget, name: 'spend' }, [
      ...setup,
      ...typed,
    ]);
    const rewrite = spend.find(({ id }) => id === cellIds.setRangeValues);
    expect(rewrite?.params.cellValue[5][1].f).toBe('=SUM(spend)');
    refusedBothWays(setName({ name: 'total' }), [...typed, ...spend], 'formula-race');
  });

  // Two!A1 holds =SUM(budget), so both renames, and the removal, rewrite it.
  // Were the peer accepted first, A1 would read the peer's rewrite on both
  // screens and the formula typed in the batch would be lost.
  describe('a rename in a batch that also types a formula over a cell it rewrites', () => {
    const a1 = { subUnitId: 's2', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } };
    const type = (f: string, before: Mutation[]) =>
      sent('sheet.command.set-range-values', { ...a1, value: { f } }, before);
    const rename = (before: Mutation[]) =>
      sent('sheet.command.set-defined-name', { ...budget, name: 'spend' }, before);
    const before = (f: string) => {
      const typed = type(f, used);
      return [...typed, ...rename([...used, ...typed])];
    };
    const after = (f: string) => {
      const renamed = rename(used);
      return [...renamed, ...type(f, [...used, ...renamed])];
    };
    const batches: [string, Mutation[]][] = [
      ['=SUM(budget)*2 typed before it', before('=SUM(budget)*2')],
      ['=SUM(spend)*2 typed after it', after('=SUM(spend)*2')],
      ['=5 typed before it', before('=5')],
      ['=5 typed after it', after('=5')],
    ];
    const peers = [
      sent('sheet.command.set-defined-name', { ...budget, name: 'total' }, used),
      sent('sheet.command.remove-defined-name', budget, used),
    ];
    test.each(batches)('%s, against a rename or a removal, is refused', (_name, batch) => {
      for (const peer of peers) refusedBothWays(batch, peer, 'formula-race');
    });
  });

  // CopySheetCommand sends a sheet under its split threshold as one
  // InsertSheet, its formulas in `sheet.cellData`, as undo of a sheet removal does.
  describe('a sheet copy', () => {
    const copy = (before: Mutation[]) =>
      sent('sheet.command.copy-sheet', { subUnitId: 's1' }, [...setup, ...before]);
    const insertOnTwo = (before: Mutation[]) =>
      sent(
        'sheet.command.insert-row-by-range',
        {
          subUnitId: 's2',
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 },
          direction: Direction.UP,
        },
        [...setup, ...before],
      );

    test('with a formula that reads Two, against a row insert on Two, is refused', () => {
      const before = formula('s1', 0, 0, '=Two!A8');
      const copied = copy(before);
      expect(copied.map(({ id }) => id)).toEqual([structureIds.insertSheet]);
      expect(copied[0].params.sheet.cellData[0][0].f).toBe('=Two!A8');
      refusedBothWays(copied, insertOnTwo(before), 'formula-race');
    });

    test('with a formula that uses a name, against a rename of the name, is refused', () => {
      const before = formula('s1', 0, 0, '=SUM(budget)');
      const renamed = sent('sheet.command.set-defined-name', { ...budget, name: 'total' }, [
        ...setup,
        ...before,
      ]);
      refusedBothWays(copy(before), renamed, 'formula-race');
    });

    test('with no formulas, against a row insert on Two, passes', () => {
      const copied = copy([]);
      for (const side of ['left', 'right'] as const) {
        expect(transform(copied, insertOnTwo([]), side)).toEqual(copied);
        converges(copied, insertOnTwo([]), { side, setup, document });
      }
    });
  });

  const at = { unitId, subUnitId: 's2' };
  const ranges = [{ startRow: 2, endRow: 4, startColumn: 0, endColumn: 1 }];
  const peers: [string, Mutation[]][] = [
    ['a cell write', write],
    ['a merge', [{ id: mergeIds.add, params: { ...at, ranges } }]],
    ['a row height', [{ id: propertyIds.rowHeight, params: { ...at, ranges, rowHeight: 40 } }]],
    [
      'a style',
      [
        {
          id: cellIds.setRangeValues,
          params: { ...at, cellValue: { 3: { 1: { s: { bl: 1 } } } } },
        },
      ],
    ],
  ];
  test.each(peers)('a formula write passes unchanged: %s', (_name, peer) => {
    const typed = formula('s2', 0, 0, '=One!A8');
    for (const side of ['left', 'right'] as const) {
      expect(transform(typed, peer, side)).toEqual(typed);
      converges(typed, peer, { side, document });
    }
  });
});

// Decision (agent, chat 2026-10-22): see names.racesName.
describe('two names given the same text', () => {
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

  test('a rename onto the text of a name added at once is refused', () => {
    refusedBothWays(setName({ name: 'total' }), add('M', 'Total'), 'name-race');
  });
});

describe('a name set or removal and a concurrent edit that rewrites no names', () => {
  const at = { unitId, subUnitId: 's1' };
  const ranges = [{ startRow: 2, endRow: 4, startColumn: 0, endColumn: 1 }];
  const peers: [string, Mutation[]][] = [
    ['a merge', [{ id: mergeIds.add, params: { ...at, ranges } }]],
    ['a row height', [{ id: propertyIds.rowHeight, params: { ...at, ranges, rowHeight: 40 } }]],
    ['a cell write', write],
  ];
  const renamed = setName({ name: 'total' });
  test.each(peers)('a rename passes unchanged and keeps the name: %s', (_name, peer) => {
    for (const side of ['left', 'right'] as const) {
      expect(transform(renamed, peer, side)).toEqual(renamed);
      expect(namesAfter(renamed, peer, side).N).toMatchObject({
        name: 'total',
        formulaOrRefString: 'One!$A$3:$B$5',
      });
    }
  });
  test.each(peers)('a removal passes unchanged and goes: %s', (_name, peer) => {
    for (const side of ['left', 'right'] as const) {
      expect(transform(removeName(), peer, side)).toEqual(removeName());
      expect(namesAfter(removeName(), peer, side)).toEqual({});
    }
  });
});

// Decision (owner, chat 2026-10-22): see names.rewrites. A shift at the
// content's edge races name edits and formula writes as one inside it does.
describe("a shift at the content's edge", () => {
  // Row 12 is s1's last row with content.
  test("a delete of the content's last row and a name added on it are refused", () => {
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
    refusedBothWays(deleted, added, 'name-race');
  });

  // realBook's content is rows 1 to 30 and columns A to J of One.
  const real = { workbook: realBook() };
  const named = (formulaOrRefString: string): Mutation[] => [
    { id: nameIds.set, params: { ...budget, formulaOrRefString } },
  ];
  const onReal = (command: string, params: object, before: Mutation[]) =>
    sent(command, { subUnitId: 's1', ...params }, before, real);
  const renamed = (before: Mutation[]) =>
    onReal('sheet.command.set-defined-name', { ...before[0].params, name: 'total' }, before);
  const deleteLast = (before: Mutation[]) =>
    onReal(
      'sheet.command.delete-range-move-up',
      { range: { startRow: 29, endRow: 29, startColumn: 0, endColumn: 1 } },
      before,
    );

  // Accepted first, the delete's own set of budget, to A30:B32, dropped the
  // rename; accepted second, it was dropped and budget stayed a row low.
  test('a delete of its last row, against a rename of a name it moves, is refused', () => {
    const before = named('One!$A$31:$B$33');
    const deleted = deleteLast(before);
    expect(deleted.map((m) => m.id)).not.toContain(cellIds.moveRange);
    const moved = deleted.find(({ id }) => id === nameIds.set);
    expect(moved?.params.formulaOrRefString).toBe('One!$A$30:$B$32');
    refusedBothWays(deleted, renamed(before), 'name-race');
  });

  // Columns L and M hold no content, so the MoveRange moves nothing.
  test('an insert in a band with no content, against a rename of a name it moves, is refused', () => {
    const before = named('One!$L$5:$M$7');
    const inserted = onReal(
      'sheet.command.insert-range-move-down',
      { range: { startRow: 1, endRow: 1, startColumn: 11, endColumn: 12 } },
      before,
    );
    const move = inserted.find(({ id }) => id === cellIds.moveRange);
    expect(move?.params.from.value).toEqual({});
    refusedBothWays(inserted, renamed(before), 'name-race');
  });

  // One!F6 holds =A31, which the delete rewrites to =A30 with a plain cell write.
  describe('a delete of its last row that rewrites a formula', () => {
    const before = formula('s1', 5, 5, '=A31');
    const typed = (row: number, col: number, value: object) =>
      onReal(
        'sheet.command.set-range-values',
        { range: { startRow: row, endRow: row, startColumn: col, endColumn: col }, value },
        before,
      );
    test('is sent with no MoveRange', () => {
      const deleted = deleteLast(before);
      expect(deleted.map((m) => m.id)).not.toContain(cellIds.moveRange);
      const rewrite = deleted.find(({ params }) => params.cellValue?.[5]?.[5]?.f);
      expect(rewrite?.params.cellValue[5][5].f).toBe('=A30');
    });
    test('against a formula typed elsewhere, is refused', () => {
      refusedBothWays(typed(7, 6, { f: '=A31' }), deleteLast(before), 'formula-race');
    });
    test('against a value typed over the formula, is refused', () => {
      const value = { v: 3, f: null, si: null, p: null };
      refusedBothWays(typed(5, 5, value), deleteLast(before), 'formula-race');
    });
  });
});

// Univer sets `trigger` on each mutation a command sends, to that command's id.
describe("a command's `trigger`", () => {
  const renamed = setName({ name: 'total' });
  const spend = setName({ name: 'spend' });

  // Decision (agent, chat 2026-10-22): see names.rewrites. An undo's name sets
  // carry the undo's `trigger`, so they count as a command's rewrite, and an
  // undone rename is refused against a rename of the same name, which the
  // first-accepted rule would otherwise settle.
  test('a rename and its undo, against a rename of the same name, are refused', () => {
    const replica = new Replica(document);
    replica.apply(setup);
    const undone = capture(replica, 'univer.command.undo', { unitId }, [
      ['sheet.command.set-defined-name', { ...budget, name: 'total' }],
    ])!;
    expect(undone.map(({ params }) => params.trigger)).toEqual([
      'univer.command.undo',
      'univer.command.undo',
    ]);
    expect(undone.find(({ id }) => id === nameIds.set)?.params.name).toBe('budget');
    refusedBothWays([...renamed, ...undone], spend, 'name-race');
  });

  // Decision (agent, chat 2026-10-22): see names.rewrites. With no `trigger`
  // the transform cannot tell a person's rename from another command's
  // rewrite of the name, so it refuses rather than let the first accepted
  // drop one silently.
  test('a name set with no trigger, against a rename of the same name, is refused', () => {
    const untriggered: Mutation[] = [{ id: nameIds.set, params: { ...budget, name: 'total' } }];
    refusedBothWays(untriggered, spend, 'name-race');
  });

  // realBook's content is rows 1 to 30 and columns A to J of One.
  const real = { workbook: realBook() };
  const style = (row: number, col: number, s: object): Mutation[] => [
    {
      id: cellIds.setRangeValues,
      params: { unitId, subUnitId: 's1', cellValue: { [row]: { [col]: { s } } } },
    },
  ];

  // Decision (owner, chat 2026-10-22): see names.rewrites. The delete of
  // One's last row sends no MoveRange, only cell writes and its own set of
  // budget, so only their `trigger` marks it as a shift. Stored past the bold,
  // which won A30, it keeps that `trigger`, so it still races a rename that saw
  // neither.
  test("a delete at the content's edge, stored past a bold, still races a rename", () => {
    const deleted = sent(
      'sheet.command.delete-range-move-up',
      { subUnitId: 's1', range: { startRow: 29, endRow: 29, startColumn: 0, endColumn: 1 } },
      setup,
      real,
    );
    expect(deleted.map(({ id }) => id)).not.toContain(cellIds.moveRange);
    for (const side of ['left', 'right'] as const) {
      const stored = transform(deleted, style(29, 0, { bl: 1 }), side, cellsAfter(setup, real));
      expect(new Set(stored.map(({ params }) => params.trigger))).toEqual(
        new Set([deleted[0].params.trigger]),
      );
      // A rename that saw neither meets the stored edit once it is past the
      // bold, so on the cells after it, which the stored edit's absolute
      // writes are checked against (decision 33).
      const bolded = cellsAfter([...setup, ...style(29, 0, { bl: 1 })], real).cells;
      refusedBothWays(stored, setName({ name: 'total' }), 'name-race', bolded);
    }
  });

  // Decision (owner, chat 2026-10-22): see names.rewrites. A shift's write
  // that a concurrent write merges into keeps the shift's `trigger`, so a
  // formula typed by someone who saw neither is still refused.
  test("a shift's style write, merged with a bold, still races a formula", () => {
    const shifted: Mutation[] = [
      {
        ...style(0, 0, { it: 1 })[0],
        params: {
          ...style(0, 0, { it: 1 })[0].params,
          trigger: 'sheet.command.delete-range-move-up',
        },
      },
    ];
    // The stored write is an absolute write of the cell, claiming the italic.
    const stored = transform(shifted, style(0, 0, { bl: 1 }), 'right', cellsAfter());
    expect(stored).toEqual([
      absoluteWrite(
        { v: 's1:0:0', t: 1, s: { it: 1, bl: 1 } },
        { s: { it: 1 } },
        'sheet.command.delete-range-move-up',
      ),
    ]);
    const after = converges(shifted, style(0, 0, { bl: 1 }), { side: 'right', setup, document });
    expect(after.workbook.sheets.s1.cellData[0][0].s).toMatchObject({ it: 1, bl: 1 });
    const bolded = cellsAfter([...setup, ...style(0, 0, { bl: 1 })]).cells;
    refusedBothWays(stored, formula('s2', 0, 0, '=1+1'), 'formula-race', bolded);
  });

  // Decision (owner, chat 2026-10-22): see names.rewrites. A shift's write
  // that loses its cell to a number format becomes an absolute write of the
  // cell, which is the shift's output too, so it keeps the shift's `trigger`.
  test("a shift's write that loses to a number format keeps its `trigger`", () => {
    const trigger = 'sheet.command.delete-range-move-up';
    const shifted: Mutation[] = [
      {
        id: cellIds.setRangeValues,
        params: { unitId, subUnitId: 's1', trigger, cellValue: { 0: { 0: { v: 7, t: 2 } } } },
      },
    ];
    const percent = style(0, 0, { n: { pattern: '0%' } });
    const stored = transform(shifted, percent, 'right', cellsAfter());
    const s = { n: { pattern: '0%' } };
    expect(stored).toEqual([absoluteWrite({ v: 7, t: 2, s }, { v: 7, t: 2 }, trigger)]);
    const after = converges(shifted, percent, { side: 'right', setup, document });
    expect(after.workbook.sheets.s1.cellData[0][0]).toEqual({ v: 7, t: 2, s });
  });

  // A typed value with a forced type loses A1 to a shift's write accepted
  // first, so its output replays that write after it. The replay is the typed
  // edit's output: were it to keep the shift's `trigger`, the stored edit
  // would count as a shift, and a formula or a rename made by someone who had
  // seen the shift, but not the typed value, would be refused.
  test("a write that replays a shift's write is no shift", () => {
    const shift: Mutation[] = [
      {
        id: cellIds.setRangeValues,
        params: {
          unitId,
          subUnitId: 's1',
          trigger: 'sheet.command.delete-range-move-up',
          cellValue: { 0: { 0: { v: 'moved' } } },
        },
      },
    ];
    const typed: Mutation[] = [
      {
        id: cellIds.setRangeValues,
        params: {
          unitId,
          subUnitId: 's1',
          trigger: 'sheet.command.set-range-values',
          cellValue: { 0: { 0: { v: 1, t: 1 } } },
        },
      },
    ];
    // Resolved on the cell there is no replay: the typed write goes, since
    // the cell it would leave is the cell the shift left (Univer keeps a
    // forced string under a later plain value), so nothing carries the
    // shift's `trigger`.
    const stored = transform(typed, shift, 'right', cellsAfter());
    expect(stored).toEqual([]);
    const seen = [...setup, ...shift];
    for (const later of [formula('s2', 0, 0, '=1+1'), setName({ name: 'total' })]) {
      for (const side of ['left', 'right'] as const) {
        converges(later, stored, { side, setup: seen, document });
      }
    }
  });
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
