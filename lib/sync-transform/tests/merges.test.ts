import type { IRange } from '@univerjs/core';
import { describe, expect, test } from 'vitest';
import { transformMutation } from '../index.ts';
import type { Mutation, Side } from '../index.ts';
import { mergeIds } from '../src/merges.ts';
import { insertCols, insertRows, moveRows, removeRows, target } from './edits.ts';
import { seededWorkbook, withStructure } from './generate.ts';
import { commands, shiftCommand } from './generate-cells.ts';
import { mergeEdit } from './generate-sheet.ts';
import { converges, Replica } from './harness.ts';
import { convergesOver } from './simulate.ts';

const box = (startRow: number, startColumn: number, endRow: number, endColumn: number) => ({
  startRow,
  endRow,
  startColumn,
  endColumn,
});
const add = (...ranges: object[]): Mutation => ({
  id: mergeIds.add,
  params: { ...target, ranges },
});
const remove = (...ranges: object[]): Mutation => ({
  id: mergeIds.remove,
  params: { ...target, ranges },
});

/** The merges on s1, top to bottom, once `a` and `b` meet, after checking both orders agree. */
const converged = (a: Mutation, b: Mutation, setup: Mutation[] = [], side: Side = 'left') =>
  converges(a, b, { setup, side })
    .workbook.sheets.s1.mergeData.map((json: string) => JSON.parse(json))
    .sort((x: IRange, y: IRange) => x.startRow - y.startRow || x.startColumn - y.startColumn);

describe('remap', () => {
  test('a merge after an insert moves down; one it cuts through is dropped on both sides', () => {
    const cut = add(box(4, 0, 5, 1), box(1, 2, 3, 3));
    expect(converged(cut, insertRows(2, 2))).toEqual([box(6, 0, 7, 1)]);
    expect(transformMutation(insertRows(2, 2), cut, 'left')).toEqual([
      remove(box(1, 2, 3, 3)),
      insertRows(2, 2),
    ]);
  });

  test('a merge after a remove moves up; one the remove overlaps is dropped', () => {
    expect(converged(add(box(6, 0, 7, 1), box(2, 2, 2, 3)), removeRows(1, 2))).toEqual([
      box(4, 0, 5, 1),
    ]);
  });

  test('a move that jumps a merge shifts it; one that takes its rows drops it', () => {
    expect(converged(add(box(3, 0, 4, 1)), moveRows(0, 2, 8))).toEqual([box(1, 0, 2, 1)]);
    expect(converged(add(box(3, 0, 4, 1)), moveRows(4, 1, 0))).toEqual([]);
  });

  test('a row move past a column insert still spans every column', () => {
    // The merge overlaps the moved rows, so the listener keeps it, but only if it
    // still sees the merge, pushed into a new column, inside the move.
    const setup = [add(box(1, 5, 2, 5))];
    expect(converged(moveRows(0, 2, 8), insertCols(2, 2), setup)).toEqual([box(1, 7, 2, 7)]);
  });

  test('removing a merge follows it the same way', () => {
    expect(converged(remove(box(4, 0, 5, 1)), insertRows(0, 1), [add(box(4, 0, 5, 1))])).toEqual(
      [],
    );
  });

  test('a removal range keeps hitting what it did: widened by an insert, trimmed by a remove or move', () => {
    const removal = remove(box(2, 0, 4, 1));
    expect(transformMutation(removal, insertRows(3, 2), 'left')).toEqual([remove(box(2, 0, 6, 1))]);
    expect(transformMutation(removal, removeRows(3, 3), 'left')).toEqual([remove(box(2, 0, 2, 1))]);
    expect(transformMutation(removal, removeRows(1, 5), 'left')).toEqual([]);
    // The merge below the removed rows moves up into the removal's place, and survives.
    const setup = [add(box(2, 0, 4, 1), box(6, 0, 6, 1))];
    expect(converged(removal, removeRows(3, 2), setup)).toEqual([box(4, 0, 4, 1)]);
  });

  test('a merge squeezed to one cell is not added, as the listener drops it', () => {
    const squeezed = box(2, 0, 2, 0);
    expect(transformMutation(add(squeezed), insertRows(0, 1), 'left')).toEqual([]);
  });
});

describe('transform', () => {
  for (const side of ['left', 'right'] as const) {
    test(`adding against removing an intersecting merge (${side} wins)`, () => {
      const setup = [add(box(1, 1, 2, 2))];
      const result = converged(add(box(2, 2, 3, 3)), remove(box(1, 1, 2, 2)), setup, side);
      expect(result).toEqual(side === 'left' ? [box(2, 2, 3, 3)] : []);
    });

    test(`only the intersecting ranges of an add conflict (${side} wins)`, () => {
      const setup = [add(box(1, 1, 2, 2))];
      const a = add(box(2, 2, 3, 3), box(8, 0, 9, 0));
      const result = converged(remove(box(1, 1, 2, 2)), a, setup, side);
      expect(result).toEqual(
        side === 'left' ? [box(8, 0, 9, 0)] : [box(2, 2, 3, 3), box(8, 0, 9, 0)],
      );
    });

    test(`two adds that intersect keep the winner's merge (${side} wins)`, () => {
      const result = converged(
        add(box(0, 0, 1, 1)),
        add(box(1, 1, 2, 2), box(8, 0, 9, 0)),
        [],
        side,
      );
      expect(result).toEqual(
        side === 'left' ? [box(0, 0, 1, 1), box(8, 0, 9, 0)] : [box(1, 1, 2, 2), box(8, 0, 9, 0)],
      );
    });
  }

  test('disjoint adds and removes, and two removes, pass through', () => {
    const a = add(box(0, 0, 1, 1));
    expect(transformMutation(a, remove(box(5, 5, 6, 5)), 'right')).toEqual([a]);
    expect(transformMutation(a, add(box(3, 3, 4, 4)), 'right')).toEqual([a]);
    const r = remove(box(0, 0, 1, 1));
    expect(transformMutation(r, remove(box(0, 0, 2, 2)), 'right')).toEqual([r]);
  });
});

test('merges converge with structural edits', () => {
  convergesOver(withStructure(mergeEdit), { seeds: 100 });
}, 300_000);

describe('a merge and a shift', () => {
  // Inserting B3 down shifts column B from row 2 by one, on the seeded sheet.
  const insertDown = () =>
    shiftCommand(new Replica({ workbook: seededWorkbook() }), commands.insertMoveDown, {
      ...target,
      range: box(2, 1, 2, 1),
    })!;
  const mergesAfter = (a: Mutation[], b: Mutation[], side: Side) =>
    converges(a, b, { side }).workbook.sheets.s1.mergeData.map((json: string) => JSON.parse(json));

  for (const side of ['left', 'right'] as const) {
    test(`a merge the shift moves whole moves with it (${side})`, () => {
      expect(mergesAfter(insertDown(), [add(box(5, 1, 6, 1))], side)).toEqual([box(6, 1, 7, 1)]);
    });

    test(`a merge outside the shifted cells stays (${side})`, () => {
      expect(mergesAfter(insertDown(), [add(box(0, 3, 1, 4))], side)).toEqual([box(0, 3, 1, 4)]);
    });

    test(`removing a merge the shift moves removes it where it went (${side})`, () => {
      // B6:C6 exists; inserting B3:C3 down moves it to B7:C7, clear of where it was.
      const setup = [add(box(5, 1, 5, 2))];
      const replica = new Replica({ workbook: seededWorkbook() });
      replica.apply(setup);
      const shift = shiftCommand(replica, commands.insertMoveDown, {
        ...target,
        range: box(2, 1, 2, 2),
      })!;
      const merges = converges(shift, [remove(box(5, 1, 5, 2))], { side, setup }).workbook.sheets.s1
        .mergeData;
      // The removal stands where it wins; where the shift wins, its own re-add does.
      expect(merges.map((json: string) => JSON.parse(json))).toEqual(
        side === 'left' ? [box(6, 1, 6, 2)] : [],
      );
    });

    test(`a merge across where two shifts' bands split is dropped on both screens (${side})`, () => {
      // Deleting B2:C3 up and inserting C3:D3 down split at column C; B7:C7
      // crosses the insert's band edge, so its command removes the merge.
      const setup = [add(box(6, 1, 6, 2))];
      const command = (name: string, range: IRange) => {
        const replica = new Replica({ workbook: seededWorkbook() });
        replica.apply(setup);
        return shiftCommand(replica, name, { ...target, range })!;
      };
      const removal = command(commands.deleteMoveUp, box(1, 1, 2, 2));
      const insert = command(commands.insertMoveDown, box(2, 2, 2, 3));
      expect(converges(removal, insert, { side, setup }).workbook.sheets.s1.mergeData).toEqual([]);
    });

    test(`a merge across where a column insert splits the shift is dropped (${side})`, () => {
      // B6:C6 exists; inserting B3:C3 down moves it to B7:C7, and a column
      // inserted at C splits the shift there and cuts through the merge.
      const setup = [add(box(5, 1, 5, 2))];
      const replica = new Replica({ workbook: seededWorkbook() });
      replica.apply(setup);
      const shift = shiftCommand(replica, commands.insertMoveDown, {
        ...target,
        range: box(2, 1, 2, 2),
      })!;
      expect(
        converges(shift, [insertCols(2, 1)], { side, setup }).workbook.sheets.s1.mergeData,
      ).toEqual([]);
    });

    test(`a merge across the band's edge or the shift's start is dropped (${side})`, () => {
      for (const merge of [box(5, 0, 5, 1), box(1, 1, 2, 1)]) {
        expect(mergesAfter(insertDown(), [add(merge)], side)).toEqual([]);
      }
    });
  }
});
