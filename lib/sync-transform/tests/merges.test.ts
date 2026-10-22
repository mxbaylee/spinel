import type { IRange } from '@univerjs/core';
import { describe, expect, test } from 'vitest';
import { transform, transformMutation } from '../index.ts';
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

// A merge edit in a shift's area is an edit there, so it is refused (see
// shifts.movesMeet).
describe('a merge and a shift', () => {
  // Inserting B3 down shifts column B from row 2 by one, on the seeded sheet;
  // its area is column B from row 2 to the sheet's edge.
  const insertDown = () =>
    shiftCommand(new Replica({ workbook: seededWorkbook() }), commands.insertMoveDown, {
      ...target,
      range: box(2, 1, 2, 1),
    })!;

  for (const side of ['left', 'right'] as const) {
    test(`a merge outside the shift's area stays (${side})`, () => {
      const mergesAfter = (merge: Mutation) =>
        converges(insertDown(), [merge], { side }).workbook.sheets.s1.mergeData.map(
          (json: string) => JSON.parse(json),
        );
      expect(mergesAfter(add(box(0, 3, 1, 4)))).toEqual([box(0, 3, 1, 4)]);
    });
  }

  test("a merge edit in the shift's area is refused, both ways and on either side", () => {
    // In the cells it moves, below them, across its start and across its band's edge.
    for (const merge of [
      add(box(5, 1, 6, 1)),
      remove(box(5, 1, 6, 1)),
      add(box(10, 1, 11, 1)),
      add(box(1, 1, 2, 1)),
      add(box(5, 0, 5, 1)),
    ]) {
      for (const side of ['left', 'right'] as const) {
        for (const [a, b] of [
          [insertDown(), [merge]],
          [[merge], insertDown()],
        ]) {
          expect(() => transform(a, b, side)).toThrow(
            expect.objectContaining({ reason: 'moved-cells' }),
          );
        }
      }
    }
  });
});
