import { expect, test } from 'vitest';
import { supportedMutationIds, transform, UnsupportedMutationError } from '../index.ts';
import type { Mutation } from '../index.ts';
import { cellIds, ghostId, halfKey, rewriteKey } from '../src/cells.ts';
import { settingIds } from '../src/settings.ts';
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
  [
    'a ghost, which exists only inside one transform',
    { id: ghostId, params: { ...target, cellValue: { 0: { 0: null } } } },
    UnsupportedMutationError,
  ],
  [
    "a cut's half, which exists only inside one transform",
    { ...move('s1'), params: { ...move('s1').params, [halfKey]: { kind: 'source' } } },
    TypeError,
  ],
  [
    "a formula rewrite's mark, which exists only inside one transform",
    {
      id: cellIds.setRangeValues,
      params: { ...target, cellValue: { 0: { 0: { f: '=A2' } } }, [rewriteKey]: true },
    },
    TypeError,
  ],
  [
    'a shift to another sheet',
    {
      ...move('s2'),
      params: { ...move('s2').params, shift: { axis: 'row', kind: 'insert', at: 0, count: 1 } },
    },
    TypeError,
  ],
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
  [
    "a sheet's default style id",
    { id: settingIds.defaultStyle, params: { ...target, defaultStyle: 'a1' } },
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

test('no ghost is a supported id', () => {
  expect(supportedMutationIds).not.toContain(ghostId);
});

// A ghost was once marked in a SetRangeValues's params, so a sender's mutation
// carrying the mark was dropped from what `transform` returned.
test("a SetRangeValues with `ghost` in its params is the sender's edit, not dropped", () => {
  const marked = {
    id: cellIds.setRangeValues,
    params: { ...target, cellValue: { 0: { 0: { v: 1 } } }, ghost: true },
  };
  const other = {
    id: cellIds.setRangeValues,
    params: { ...target, cellValue: { 5: { 5: { v: 2 } } } },
  };
  for (const side of ['left', 'right'] as const) {
    expect(transform([marked], [], side)).toEqual([marked]);
    expect(transform([marked], [other], side)).toEqual([marked]);
  }
});
