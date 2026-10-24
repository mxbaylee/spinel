import { describe, expect, test } from 'vitest';
import { supportedMutationIds, transform, UnsupportedMutationError } from '../index.ts';
import type { Mutation } from '../index.ts';
import { halfKey, rewriteKey } from '../src/cells.ts';
import { settingIds } from '../src/settings.ts';
import { Cells, claimKey } from '../src/state.ts';
import { structureIds } from '../src/structure.ts';
import { cellIds, ghostId } from '../src/writes.ts';

const target = { unitId: 'wb', subUnitId: 's1' };
const claimed = (cell: object, extra = {}): Mutation => ({
  id: cellIds.setRangeValues,
  params: { ...target, cellValue: { 0: { 0: cell } }, ...extra },
});
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
    'a claim without an override, which every absolute write has',
    claimed({ v: 1, [claimKey]: { v: 1 } }),
    TypeError,
  ],
  [
    'a claim of a value the cell does not write',
    claimed({ v: 1, [claimKey]: { v: 2 } }, { isOverrideStyle: true }),
    TypeError,
  ],
  [
    'a claim of a style key the cell does not write',
    claimed({ v: 1, s: { bl: 1 }, [claimKey]: { s: { it: 1 } } }, { isOverrideStyle: true }),
    TypeError,
  ],
  [
    'a claim in a range move',
    {
      ...move('s1'),
      params: {
        ...move('s1').params,
        to: { subUnitId: 's1', value: { 0: { 0: { v: 1, [claimKey]: { v: 1 } } } } },
      },
    },
    TypeError,
  ],
  [
    'a cell key of the transform other than its claims',
    claimed({ v: 1, 'sync-transform.cells.other': true }, { isOverrideStyle: true }),
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
  [
    // So Cells.after never looks a style id up (state.ts).
    "a style id in an inserted sheet's cells",
    {
      id: structureIds.insertSheet,
      params: {
        unitId: 'wb',
        index: 0,
        styles: { a1: { bl: 1 } },
        sheet: { id: 'n', name: 'New', cellData: { 0: { 0: { v: 1, s: 'a1' } } } },
      },
    },
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

// A client sends its pending edits as it rebased them past an incoming edit
// (SPN-058), and the server stores what it returns (SPN-057), so an absolute
// write must pass the check again, and with it its claims.
test("the transform's own absolute writes pass the check again", () => {
  const cells = () => ({ v: 'base' });
  const [a, b] = [claimed({ v: 'a' }), claimed({ s: { bl: 1 } })];
  // Its base is the cell after `b`.
  const after = Cells.of(cells).after(b);
  for (const side of ['left', 'right'] as const) {
    const out = transform([a], [b], side, { cells });
    expect(() => transform(out, [], side, { cells: (...at) => after.get(...at) })).not.toThrow();
  }
  expect(transform([a], [b], 'right', { cells })).toEqual([
    {
      id: cellIds.setRangeValues,
      params: {
        ...target,
        isOverrideStyle: true,
        cellValue: {
          0: {
            0: {
              v: 'a',
              t: 1,
              f: null,
              si: null,
              p: null,
              s: { bl: 1 },
              custom: null,
              ft: null,
              fd: null,
              ref: null,
              xf: null,
              [claimKey]: { v: 'a', t: 1 },
            },
          },
        },
      },
    },
  ]);
});

// Decision 33: a claim picks which of the keys a write sets are its own edit,
// so a key it does not claim must hold what its base cell holds. Otherwise a
// forged claim could carry a formula past `'formula-race'`, which reads the
// claims (names.test.ts).
describe('an absolute write and its base cell', () => {
  const none = { v: null, t: null, f: null, si: null, p: null, s: null };
  const rest = { custom: null, ft: null, fd: null, ref: null, xf: null };
  const base = { v: 'base', t: 1, s: { bl: 1, bd: { t: { s: 1 }, b: { s: 2 } } } };
  const cells = () => base;
  const absolute = (cell: object, claims: object) =>
    claimed({ ...none, ...rest, ...cell, [claimKey]: claims }, { isOverrideStyle: true });

  test.each<[string, Mutation]>([
    ['a formula it does not claim', absolute({ ...base, f: '=1+1' }, {})],
    ['a value it does not claim', absolute({ ...base, v: 'z' }, {})],
    ['a deletion of the value it does not claim', absolute({ s: base.s }, {})],
    ['a style key it does not claim', absolute({ ...base, s: { ...base.s, bl: 0 } }, {})],
    ['a style key it drops without claiming it', absolute({ ...base, s: { bd: base.s.bd } }, {})],
    [
      'a border edge it does not claim',
      absolute({ ...base, s: { bl: 1, bd: { t: { s: 1 } } } }, { s: { it: null } }),
    ],
    [
      'a format with a formula it does not claim',
      absolute({ ...base, f: '=1', ft: 0 }, { f: '=1' }),
    ],
    [
      'a key of a write that names only some',
      claimed({ v: 'w', [claimKey]: {} }, { isOverrideStyle: true }),
    ],
  ])('rejects one that changes %s', (_name, mutation) => {
    expect(() => transform([mutation], [], 'left', { cells })).toThrow(TypeError);
    expect(() => transform([], [mutation], 'left', { cells })).toThrow(TypeError);
  });

  test.each<[string, Mutation]>([
    ['restates its base', absolute(base, {})],
    ['claims a value, with its type', absolute({ ...base, v: 'z', t: 1 }, { v: 'z', t: 1 })],
    ['claims a deletion of the value, and with it its type', absolute({ s: base.s }, { v: null })],
    ['claims a style key', absolute({ ...base, s: { ...base.s, it: 1 } }, { s: { it: 1 } })],
    [
      'claims a border edge it drops',
      absolute({ ...base, s: { bl: 1, bd: { t: { s: 1 } } } }, { s: { bd: { b: null } } }),
    ],
    ['claims its whole style', absolute({ v: 'base', t: 1 }, { s: null })],
  ])('accepts one that %s', (_name, mutation) => {
    expect(() => transform([mutation], [], 'left', { cells })).not.toThrow();
  });

  // Univer types every value it writes, so the transform's own absolute
  // writes restate a type that can differ from the base's; no refusal reads
  // `t` (state.baseError).
  test('accepts a type it does not claim', () => {
    const typed = absolute({ v: 'base', t: 1 }, {});
    expect(() => transform([typed], [], 'left', { cells: () => ({ v: 'base' }) })).not.toThrow();
    const untyped = absolute({ v: 'base', s: base.s }, {});
    expect(() => transform([untyped], [], 'left', { cells })).not.toThrow();
  });

  // Univer's merge drops the ft and fd of a write that clears `f` with no
  // formula id in `si`, so they change nothing there (schema seed 90,082).
  test('accepts a format it does not claim where Univer drops it', () => {
    for (const cleared of [{}, { f: '', si: '' }]) {
      const format = absolute({ ...base, ...cleared, ft: 0, fd: 1 }, {});
      const at = () => ({ ...base, ...cleared });
      expect(() => transform([format], [], 'left', { cells: at })).not.toThrow();
    }
  });

  test('reads its base after the earlier mutations of its own list', () => {
    const typed = claimed({ v: 'z' });
    const restated = absolute({ ...base, v: 'z', t: 1 }, {});
    expect(() => transform([typed, restated], [], 'left', { cells })).not.toThrow();
    expect(() => transform([restated], [], 'left', { cells })).toThrow(TypeError);
  });

  // Without the base no claim can be checked, so none is taken on trust.
  test('needs the base cells, even with nothing to transform against', () => {
    expect(() => transform([absolute(base, {})], [], 'left')).toThrow(TypeError);
    expect(() => transform([], [absolute(base, {})], 'left')).toThrow(TypeError);
  });
});
