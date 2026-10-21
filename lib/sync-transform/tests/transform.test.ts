import { expect, test } from 'vitest';
import { transform, UnsupportedMutationError } from '../index.ts';
import type { Mutation } from '../index.ts';
import { cellIds } from '../src/cells.ts';
import { structureIds } from '../src/structure.ts';

const target = { unitId: 'wb', subUnitId: 's1' };
const move = (to: string): Mutation => ({
  id: cellIds.moveRange,
  params: {
    unitId: 'wb',
    from: { subUnitId: 's1', value: { 0: { 0: null } } },
    to: { subUnitId: to, value: { 0: { 0: { v: 1 } } } },
  },
});

// Each is refused even with nothing to transform against, so a sender learns
// before two people's edits happen to collide.
test.each<[string, Mutation, new (...args: never[]) => Error]>([
  [
    'an id without a transform',
    { id: 'sheet.mutation.add-range-protection', params: target },
    UnsupportedMutationError,
  ],
  ['a range move to another sheet', move('s2'), UnsupportedMutationError],
  [
    'a formula result',
    { id: cellIds.setRangeValues, params: { ...target, cellValue: {}, sourceFormulaData: {} } },
    UnsupportedMutationError,
  ],
  [
    'a sheet removal without its index',
    { id: structureIds.removeSheet, params: { ...target, subUnitName: 'One' } },
    TypeError,
  ],
  [
    'a style id',
    { id: cellIds.setRangeValues, params: { ...target, cellValue: { 0: { 0: { s: 'a1' } } } } },
    TypeError,
  ],
])('refuses %s up front', (_name, mutation, error) => {
  expect(() => transform([mutation], [], 'left')).toThrow(error);
  expect(() => transform([], [mutation], 'left')).toThrow(error);
});

test('a range move within a sheet, with inline styles, is accepted', () => {
  const styled = move('s1');
  styled.params.to.value = { 0: { 0: { v: 1, s: { bl: 1 } } } };
  expect(transform([styled], [], 'left')).toEqual([styled]);
});
