import { expect, test } from 'vitest';
import type { IWorkbookData } from '@univerjs/core';
import { transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { absolute, claimKey } from '../src/state.ts';
import { cellIds } from '../src/writes.ts';
import { lineEdit, structuralEdit, withStructure } from './generate.ts';
import { richDoc } from './generate-cells.ts';
import { schemaBook, schemaEdit, schemaEdits } from './generate-schema.ts';
import { liveCells, Replica, snapshotCells } from './harness.ts';
import { classify, replay, shrinkSeed } from './shrink.ts';
import type { Failure } from './shrink.ts';
import { convergesOver, newStats, simulate } from './simulate.ts';
import type { Step, Transform } from './simulate.ts';

const unclocked = 0;
const document = { workbook: schemaBook() };
/** The seeded book's cells, for a transform called directly. */
const options = { cells: liveCells(new Replica(document)) };

/**
 * Seeds that fail by a known finding, skipped until it is fixed. An open
 * finding's minimal case is a `test.fails` below. None is open, and none is
 * skipped.
 */
const known: Record<string, number[]> = {};
const seeds = (count: number, skip: number[]) =>
  Array.from({ length: count }, (_, i) => i + 1).filter((seed) => !skip.includes(seed));

// Writes built from Univer's own cell and style types, each key left out,
// null, falsy or set, among editor commits, commands and cuts, meet the
// seeded formula, shared formula, `custom` and bordered rich text. The
// longer run leaves out `ft` and `fd`, which most of the fuller run's
// failures wrote before F1 was fixed. The two runs take about 35 s.
test(
  'schema cell edits converge, as the edits meant',
  () => {
    const skip = Object.values(known).flat();
    const checks = { mutations: 40, document, budget: 50, intent: true };
    convergesOver(schemaEdit, { seeds: seeds(200, skip), ...checks });
    convergesOver(schemaEdits(['ft', 'fd']), { seeds: seeds(1000, skip), ...checks });
  },
  unclocked,
);

// The same writes among row and column edits and moves, so a client's model
// of its buffer's base cells is carried through every line edit and must
// agree with the server's snapshot for the base check to pass. Sheet edits
// join without intent, which the follower doesn't track across a removal.
test(
  'schema cell edits converge among row, column and sheet edits',
  () => {
    const checks = { mutations: 40, document, budget: 50 };
    convergesOver(withStructure(schemaEdit, lineEdit), {
      seeds: 100,
      ...checks,
      intent: true,
    });
    convergesOver(withStructure(schemaEdit, structuralEdit), { seeds: 100, ...checks });
  },
  unclocked,
);

const write = (row: number, col: number, value: unknown, extra = {}): Mutation => ({
  id: cellIds.setRangeValues,
  params: { unitId: 'wb', subUnitId: 's1', cellValue: { [row]: { [col]: value } }, ...extra },
});
/** Client 0 edits `a` and client 1 `b`, unsent, so each lands past the other. */
const pair = (a: Mutation, b: Mutation): Step[] => [
  { client: 0, edit: [a] },
  { client: 1, edit: [b] },
];
/**
 * The absolute write `transform` makes of s1's cell at `row` and `col` (see
 * state.absolute): every cell key, null where `cell` has none, and `claims`.
 */
const absoluteWrite = (row: number, col: number, cell: object, claims: object): Mutation => {
  const keys = ['v', 't', 'f', 'si', 'p', 's', 'custom', 'ft', 'fd', 'ref', 'xf'];
  const value = Object.fromEntries(keys.map((key) => [key, (cell as any)[key] ?? null]));
  return write(row, col, { ...value, [claimKey]: claims }, { isOverrideStyle: true });
};
/** The write of ft and fd an absolute write leaves after itself (see state.absolute). */
const tail = (row: number, col: number, cell: object, t: unknown): Mutation =>
  write(row, col, { ...cell, [claimKey]: cell, t }, { isOverrideStyle: true });
const passes = (steps: Step[]) =>
  expect(replay(document, steps, { budget: 50, intent: true })).toBeNull();
/**
 * How `steps` fail with the intent checks on, as `replay` reports it, or null
 * once every client agrees with the server; with `broken`, a planted fault,
 * in place of `transform`.
 */
function flagged(steps: Step[], broken?: Transform): Failure | null {
  return run(steps, broken, () => null);
}
/**
 * Runs `steps` with the intent checks on, and returns the server's cell at
 * `row`, `col`, style inline, once every client agrees with it and nothing
 * was refused.
 */
function landed(steps: Step[], row: number, col: number): unknown {
  let cell: unknown;
  const failure = run(steps, undefined, ({ server, stats }) => {
    expect({ refused: stats.refused, resynced: stats.resynced }).toEqual({
      refused: 0,
      resynced: 0,
    });
    const { workbook } = server.snapshot() as { workbook: IWorkbookData };
    cell = snapshotCells(workbook)('wb', 's1', row, col) ?? null;
  });
  expect(failure).toBeNull();
  return cell;
}
function run(
  steps: Step[],
  broken: Transform | undefined,
  then: (run: ReturnType<typeof simulate>) => void,
): Failure | null {
  let result: ReturnType<typeof simulate>;
  try {
    const script = { seed: 1, document, mutations: 0, generate: () => null, script: steps };
    result = simulate({ ...script, budget: 50, intent: true, transform: broken });
  } catch (error) {
    return classify(error);
  }
  try {
    const expected = result.server.snapshot();
    for (const client of result.clients) expect(client.snapshot()).toEqual(expected);
    then(result);
    return null;
  } catch (error) {
    return classify(error);
  } finally {
    for (const replica of [result.server, ...result.clients]) replica.univer.dispose();
  }
}
/** Each cell value of each SetRangeValues `transform` returns, through `change`; undefined drops it. */
const rewriting =
  (change: (value: any, mutation: Mutation) => unknown): Transform =>
  (a, b, side, options) =>
    transform(a, b, side, options).flatMap((mutation) => {
      if (mutation.id !== cellIds.setRangeValues) return [mutation];
      const cellValue: Record<string, Record<string, unknown>> = {};
      for (const [row, columns] of Object.entries(mutation.params.cellValue ?? {})) {
        for (const [col, value] of Object.entries(columns as object)) {
          const changed = change(value, mutation);
          if (changed !== undefined) (cellValue[row] ??= {})[col] = changed;
        }
      }
      if (Object.keys(cellValue).length === 0) return [];
      return [{ ...mutation, params: { ...mutation.params, cellValue } }];
    });
/** A planted fault: every write of `t` alone the transform returns is lost. */
const dropsRetype = rewriting((value) =>
  value && Object.keys(value).join() === 't' ? undefined : value,
);
/** A planted fault: every value with a style and no rich text it returns deletes the rich text. */
const deletesRestyled = rewriting((value, { params }) =>
  value &&
  !(claimKey in value) &&
  !params.isOverrideStyle &&
  value.s !== undefined &&
  value.v &&
  value.p === undefined
    ? { ...value, p: null }
    : value,
);

const both = (a: Mutation, b: Mutation) => {
  passes(pair(a, b));
  passes(pair(b, a));
};

// The findings' minimal cases, as round 16's schema fuzz shrank them, each
// in both orders where the other order differs.
test('F1: a formula clear and a write of ft or fd keep what the first accepted wrote', () => {
  for (const key of ['ft', 'fd']) {
    both(write(3, 2, { f: '' }), write(3, 2, { [key]: 0 }));
    both(write(2, 1, { f: '' }), write(2, 1, { [key]: 1 }));
  }
});

/** Rich text both clients hold. */
const rich: Step[] = [
  { client: 0, edit: [write(2, 0, { p: richDoc('rich') })] },
  { client: 0, take: 'send' },
  { client: 0, take: 'server' },
  { client: 1, take: 'client' },
  { client: 0, take: 'client' },
];

test('F2: a value written with a style and rich text keep what the first accepted wrote', () => {
  both(write(2, 0, { v: 1, s: { vt: 0 } }), write(2, 0, { p: richDoc('rich') }));
  both(write(1, 2, { v: '7', s: null }), write(1, 2, { p: richDoc('rich') }));
  // Over rich text, of another text and of the value's own, which Univer
  // restyles instead (F8, below, pins the deletion past the restyle).
  for (const text of ['other', 'rich']) {
    const valued = write(2, 0, { v: text, s: { vt: 0 } });
    for (const other of [{ v: 'x' }, { s: { vt: 1 } }, { s: null }, { p: null }]) {
      passes([...rich, ...pair(valued, write(2, 0, other))]);
      passes([...rich, ...pair(write(2, 0, other), valued)]);
    }
  }
});

// A value of the held text with a style keeps that text and restyles it, and
// deletes rich text of another text, so a winner's drop covers only a drop of
// its own text: losing rich text of another text past it is a deletion. With
// the value first, the rich text of another text lands first and the value
// deletes it: the value and its style, and no `p` (F8, decision 32).
test('F2: rich text past a value of the held text with a style converges', () => {
  const other = richDoc('x');
  for (const [valued, written, cell] of [
    [{ v: 'rich', s: { bl: 1 } }, { p: other }, { v: 'rich', t: 1, s: { bl: 1 } }],
    [
      { v: 'rich', s: { bl: 1 } },
      { v: 'x', p: other },
      { v: 'rich', t: 1, s: { bl: 1 } },
    ],
    [
      { v: 'rich', s: { bl: 1 } },
      { v: 'x', s: { vt: 1 }, p: other },
      { v: 'rich', t: 1, s: { bl: 1, vt: 1 } },
    ],
    [{ v: 'rich', s: null }, { p: other }, { v: 'rich', t: 1 }],
  ]) {
    const steps = [...rich, ...pair(write(2, 0, valued), write(2, 0, written))];
    expect(landed(steps, 2, 0)).toEqual(cell);
    passes([...rich, ...pair(write(2, 0, written), write(2, 0, valued))]);
  }
});

// Each value with a style deletes rich text of another text, so a loser's
// deletion past a winner's of another text is a plain deletion, and past one
// of its own text it goes: the loser stays one write past any number of
// winners, where it once doubled at each.
// Resolved on the cell, the winners leave nothing of the loser, so it goes.
test('F2: a value with a style past many values with a style goes', () => {
  const bold = (v: string) => write(2, 0, { v, s: { bl: 1 } });
  for (const n of [1, 2, 4, 8, 10]) {
    const winners = Array.from({ length: n }, () => bold('x'));
    expect(transform([bold('L')], winners, 'right', options)).toEqual([]);
  }
  expect(transform([bold('x')], [bold('x')], 'right', options)).toEqual([]);
  passes([
    { client: 0, edit: [bold('L')] },
    { client: 1, edit: Array.from({ length: 4 }, () => bold('x')) },
  ]);
});

test('F3: a retype past a forced type keeps the type', () => {
  both(write(4, 1, { custom: null }), write(4, 1, { v: 0, t: 4 }));
  both(write(2, 2, { f: null }), write(2, 2, { v: '7', t: 1 }));
});

test('F4: a style override past a null font colour clears the lines’ colour', () => {
  const line = { ol: { s: 1, t: 10, cl: { rgb: '#0000ff' } }, cl: null };
  passes([
    { client: 1, edit: [write(1, 2, { s: line })] },
    { client: 1, take: 'send' },
    { client: 1, take: 'server' },
    { client: 0, edit: [write(1, 2, { s: { td: 0 } }, { isOverrideStyle: true })] },
  ]);
});

// Once refused as a format race; resolved on the cell (under '@'), both land
// in either order, the loser then the winner, and keep what each wrote.
test('F5: a value written with a format clear and a write of no value both land', () => {
  const [a, b] = [write(2, 1, { v: '7', s: { n: null } }), write(2, 1, { fd: 1 })];
  expect(transform([a], [b], 'left', options)).toEqual([a]);
  expect(transform([b], [a], 'left', options)).toEqual([b]);
  expect(transform([a], [b], 'right', options)).toEqual([
    absoluteWrite(2, 1, { v: 7, t: 2, fd: 1 }, { v: 7, t: 2, s: { n: null } }),
    tail(2, 1, { fd: 1 }, 2),
  ]);
  expect(transform([b], [a], 'right', options)).toEqual([
    absoluteWrite(2, 1, { v: '7', t: 1, fd: 1 }, { fd: 1 }),
    tail(2, 1, { fd: 1 }, 1),
  ]);
  both(a, b);
});

// F6: forced text sticks to the next value only where it lands first, so
// the rule-based merge would have needed the sequence's later writes to
// retype it. Resolved on the cell, neither order is refused, and the later
// value keeps one type.
test('F6: forced text and a number format both land', () => {
  const format = {
    id: cellIds.setNumfmt,
    params: {
      unitId: 'wb',
      subUnitId: 's1',
      values: { k1: { ranges: [{ startRow: 2, startColumn: 1, endRow: 3, endColumn: 1 }] } },
      refMap: { k1: { pattern: '@' } },
    },
  };
  const forced = write(3, 1, { v: 1, t: 4 });
  const text = { n: { pattern: '@' } };
  expect(transform([forced], [format], 'left', options)).toEqual([forced]);
  expect(transform([format], [forced], 'left', options)).toEqual([format]);
  expect(transform([forced], [format], 'right', options)).toEqual([
    absoluteWrite(3, 1, { v: '1', t: 4, s: text }, { v: '1', t: 4 }),
  ]);
  const rest = { startRow: 2, endRow: 2, startColumn: 1, endColumn: 1 };
  expect(transform([format], [forced], 'right', options)).toEqual([
    { id: format.id, params: { ...format.params, values: { k1: { ranges: [rest] } } } },
    absoluteWrite(3, 1, { v: '1', t: 4, s: text }, { s: text }),
  ]);
  passes([
    { client: 1, edit: [forced] },
    { client: 0, edit: [format] },
    { client: 1, edit: [write(3, 1, { v: true })] },
  ]);
  // A value written after forced text is typed from it, so a format written
  // with a value races it too (seed 13,888, shrunk), on a cell under '@' or not.
  for (const valued of [
    { v: true, s: { n: null } },
    { v: 5, s: { n: { pattern: '0%' } } },
  ]) {
    for (const [row, col] of [
      [2, 1],
      [3, 1],
    ]) {
      const [a, b] = [write(row, col, valued), write(row, col, { v: '', t: 4 })];
      expect(transform([a], [b], 'left', options)).toEqual([a]);
      // The value loses; what it leaves is its format, unless the cell holds it.
      const { s } = valued;
      const unchanged = row === 3 && s.n === null;
      expect(transform([a], [b], 'right', options)).toEqual(
        unchanged ? [] : [absoluteWrite(row, col, { v: '', t: 4, s: s.n && s }, { s })],
      );
      both(a, b);
    }
  }
});

// Forced text sticks only under the text format, so against any other format
// change, or a removed format, it converges in either order.
test('F6: forced text passes a format other than the text format', () => {
  const ranges = [{ startRow: 3, startColumn: 1, endRow: 3, endColumn: 1 }];
  const numfmt = (pattern: string) => ({
    id: cellIds.setNumfmt,
    params: {
      unitId: 'wb',
      subUnitId: 's1',
      values: { k1: { ranges } },
      refMap: { k1: { pattern } },
    },
  });
  const removed = {
    id: cellIds.removeNumfmt,
    params: { unitId: 'wb', subUnitId: 's1', ranges },
  };
  const forced = write(3, 1, { v: 1, t: 4 });
  for (const format of [
    numfmt('0%'),
    numfmt('0.00'),
    removed,
    write(3, 1, { s: { n: { pattern: '0%' } } }),
  ]) {
    expect(() => transform([forced], [format], 'left', options)).not.toThrow();
    expect(() => transform([format], [forced], 'left', options)).not.toThrow();
    for (const [first, second] of [
      [forced, format],
      [format, forced],
    ]) {
      passes([
        { client: 1, edit: [first] },
        { client: 0, edit: [second] },
        { client: 1, edit: [write(3, 1, { v: true })] },
      ]);
    }
  }
});

test('F7: a null font colour past lines with a colour leaves the lines’ colour', () => {
  const line = { ol: { s: 1, t: 10, cl: { rgb: '#00ff00' } } };
  passes([
    { client: 1, edit: [write(2, 1, { p: richDoc('rich'), s: line })] },
    { client: 1, take: 'send' },
    { client: 1, take: 'server' },
    { client: 0, edit: [write(2, 1, { s: { cl: null } })] },
  ]);
});

// F8 (decision 32): only Univer, with the cell's state, sees that a value's
// text matches the rich text, so it restyles the rich text rather than
// deleting it. Past a concurrent deletion of the rich text, named or derived
// (a value of another text with a style), the loser lands first and then the
// winner, whose value then has no rich text to restyle: both screens end with
// the value, its style and no `p`, as one person doing both edits in that
// order would. That is the rule, and the intent checks accept it.
test('F8: rich text deleted past a value of its own text with a style ends without it', () => {
  const bold = (v: string) => write(2, 0, { v, s: { bl: 1 } });
  const restyled = write(2, 0, { v: 'rich', s: { vt: 0 } });
  expect(landed([...rich, ...pair(restyled, write(2, 0, { p: null }))], 2, 0)).toEqual({
    v: 'rich',
    t: 1,
    s: { vt: 0 },
  });
  const other = write(2, 0, { v: 'other', s: { vt: 0 } });
  expect(landed([...rich, ...pair(bold('rich'), other)], 2, 0)).toEqual({
    v: 'rich',
    t: 1,
    s: { bl: 1, vt: 0 },
  });
  expect(landed([...rich, ...pair(restyled, bold('y'))], 2, 0)).toEqual({
    v: 'rich',
    t: 1,
    s: { bl: 1, vt: 0 },
  });
});

// The check accepts F8's rule only where a concurrent edit deleted the rich
// text. A transform that loses the restyle past a style alone is flagged.
test('F8: a restyle lost with no concurrent deletion of the rich text is flagged', () => {
  const restyled = write(2, 0, { v: 'rich', s: { vt: 0 } });
  expect(
    flagged([...rich, ...pair(restyled, write(2, 0, { s: { it: 1 } }))], deletesRestyled),
  ).toMatchObject({ message: expect.stringMatching(/s1:2:0: p is undefined, and rich\s/) });
  // The same transform past a deletion makes the cell the rule makes.
  expect(flagged([...rich, ...pair(restyled, write(2, 0, { p: null }))], deletesRestyled)).toBe(
    null,
  );
});

// F12 (decision 35, found by replay round 20's pairwise matrix): a write of
// `t` alone that the server accepts first yields to a concurrent value
// (decision 31), so its sender's value stays on that client's screen while
// the server, at that revision, holds the value `t` made NaN. Both screens
// end with the value. That is the rule, and the intent checks accept it.
test('F12: a write of `t` alone accepted first, past a value, ends with the value', () => {
  for (const [value, cell] of [
    [{ v: 'abc' }, { v: 'abc', t: 1 }],
    [{ v: 1 }, { v: 1, t: 2 }],
  ]) {
    expect(landed(pair(write(3, 1, { t: 2 }), write(3, 1, value)), 3, 1)).toEqual(cell);
  }
});

// The check accepts F12's rule only against a write of the value. A
// transform that loses the retype past a style alone is flagged.
test('F12: a write of `t` alone lost against a write of no value is flagged', () => {
  const retype = write(3, 1, { t: 2 });
  expect(flagged(pair(retype, write(3, 1, { s: { bl: 1 } })), dropsRetype)).toMatchObject({
    message: expect.stringMatching(/s1:3:1: v is .*, and NaN on the server/),
  });
  // The same transform past a value makes the cell the rule makes.
  expect(flagged(pair(retype, write(3, 1, { v: 'abc' })), dropsRetype)).toBe(null);
});

test('F9: a shared formula id cleared past a replayed forced type keeps fd', () => {
  const at = (value: unknown) => write(2, 2, value);
  passes([
    { client: 1, edit: [at({ p: null, fd: 0 })] },
    { client: 1, take: 'send' },
    { client: 1, take: 'server' },
    { client: 1, take: 'client' },
    { client: 1, edit: [at({ v: null, si: null, t: 1 })] },
    { client: 1, take: 'send' },
    { client: 0, edit: [at({ s: { pd: { t: 0 } } })] },
    { client: 1, take: 'server' },
    { client: 1, edit: [at({ f: '', si: 'siw#8' })] },
  ]);
});

// A retype writes no formula clear, so one that loses its formula id to a
// winner loses its `f` too (seed 13,707, shrunk; F9's fix met it unforced).
test('F9: a retype whose formula id a winner overwrites keeps fd', () => {
  for (const extra of [{}, { isOverrideStyle: true }]) {
    passes([
      { client: 1, edit: [write(2, 1, { s: null, si: null, fd: 1 }, extra)] },
      { client: 0, edit: [write(2, 1, { ref: '' })] },
      { client: 0, edit: [write(2, 1, { s: null, f: null, si: 'siw#10' })] },
      { client: 1, take: 'send' },
      { client: 1, take: 'server' },
    ]);
  }
});

// F10 and F11: as F6, forced text sticks to the next value only where it
// lands first, and the write after it is in its own sequence: a text format
// (F10), or a deletion of the value the rule-based merge dropped as
// overwritten (F11). Open under the rule-based merge; resolved on the cell,
// both keep one type.
test('F10: forced text and a text format past a value keep one type', () => {
  const format = {
    id: cellIds.setNumfmt,
    params: {
      unitId: 'wb',
      subUnitId: 's1',
      refMap: { 0: { pattern: '@' } },
      values: { 0: { ranges: [{ startRow: 3, endRow: 3, startColumn: 1, endColumn: 1 }] } },
      trigger: 'sheet.command.numfmt.set.numfmt',
    },
  };
  passes([
    { client: 1, edit: [write(3, 1, { v: 7, t: 4 })] },
    { client: 1, edit: [format] },
    { client: 0, edit: [write(3, 1, { v: 0 })] },
  ]);
});

test('F11: forced text and a deletion past a value keep one type', () => {
  passes([
    { client: 0, edit: [write(3, 1, { v: 2.5, t: 4 })] },
    { client: 1, edit: [write(3, 1, { v: 'aw#11' })] },
    { client: 1, take: 'send' },
    { client: 1, take: 'server' },
    { client: 0, edit: [write(3, 1, { v: null })] },
  ]);
});

// Seeds 1557 and 9522 of the replay merge's sweep, shrunk: an absolute write of a
// cell with ft and no formula has a tail writing ft back, typed as the cell
// was. Met as a plain write, the tail's `t` retyped a later empty value to 0.
test('an absolute write’s ft tail retypes no value written past it', () => {
  passes([
    { client: 0, edit: [write(1, 2, { ft: 0 })] },
    { client: 1, edit: [write(1, 2, { v: 0 })] },
    { client: 1, take: 'send' },
    { client: 1, edit: [write(1, 2, { v: '' })] },
    { client: 1, take: 'server' },
  ]);
  passes([
    { client: 1, edit: [write(0, 1, { ft: 0 })] },
    { client: 0, edit: [write(0, 1, { fd: null })] },
    { client: 0, take: 'send' },
    { client: 1, take: 'send' },
    { client: 0, edit: [write(0, 1, { v: 7, f: null, si: null })] },
    { client: 0, edit: [write(0, 1, { v: '' })] },
    { client: 0, take: 'server' },
    { client: 1, take: 'server' },
  ]);
});

// Round 19's Major, found by its review: on a cell under '@', a value
// written with its format cleared is typed under the format it clears, which
// the rule-based merge retyped against any concurrent value write. Resolved
// on the cell, each pair converges in both orders, as the edits meant.
test('a value written with its format cleared on a text cell, against any write', () => {
  const at = (value: unknown) => write(2, 1, value);
  const range = [{ startRow: 2, startColumn: 1, endRow: 2, endColumn: 1 }];
  const others: Mutation[] = [
    at({ v: 'x', s: { bl: 1 } }),
    at({ f: '=1+2', si: null, v: null, p: null }),
    at({ p: richDoc('q'), v: null, f: null, si: null }),
    at({ v: '9', t: 1, f: null, si: null, p: richDoc('9'), s: { n: { pattern: '@' } } }),
    {
      id: cellIds.setNumfmt,
      params: {
        unitId: 'wb',
        subUnitId: 's1',
        values: { k1: { ranges: range } },
        refMap: { k1: { pattern: '0%' } },
      },
    },
    { id: cellIds.removeNumfmt, params: { unitId: 'wb', subUnitId: 's1', ranges: range } },
  ];
  const cleared = [at({ v: 5, s: { n: null } }), at({ v: '5', s: { n: null } })];
  for (const value of cleared) {
    for (const other of [...cleared, ...others]) both(value, other);
  }
});

// Typing 'abc sends forced text, as does a value typed under '@'; against a
// concurrent forced text, with a value written after it (found by round
// 19's review), the rule-based merge typed that value apart.
test("'abc and forced text, with a value written after, keep one type", () => {
  const at = (value: unknown) => write(3, 1, value);
  const forced = [
    { v: '', t: 4 },
    { v: 1, t: 4 },
    { v: '123', t: 4, f: null, si: null, p: null },
  ];
  for (const typed of [{ v: 'abc' }, { v: 'abc', t: 4, f: null, si: null, p: null }]) {
    for (const value of forced) {
      both(at(typed), at(value));
      for (const later of [{ v: true }, { v: 5 }, { v: 'z' }]) {
        passes([
          { client: 1, edit: [at(value)] },
          { client: 0, edit: [at(typed)] },
          { client: 1, edit: [at(later)] },
        ]);
      }
    }
  }
});

// Schema seed 134, shrunk. An absolute write's claims are what the edit it
// resolves changed; read off the cells instead, a winner's deletion of a
// value claimed nothing once its sender's own deletion of the cell landed
// under it, so the sender's later value beat it.
test('an absolute write keeps its claims past a loser that lands the same value', () => {
  const at = (value: unknown, extra = {}) => write(1, 1, value, { subUnitId: 's2', ...extra });
  passes([
    { client: 0, edit: [at({ s: { bl: 0 } }, { trigger: 'sheet.command.set-style' })] },
    { client: 0, take: 'send' },
    { client: 1, edit: [at({ v: null })] },
    { client: 0, edit: [at(null)] },
    { client: 0, edit: [at({ v: 'bw#12' })] },
    { client: 0, take: 'server' },
    { client: 1, take: 'send' },
    { client: 1, take: 'server' },
  ]);
});

// A claim is checked against its cell and its base cell, not refused (see
// state.claimError and state.baseError), so a sender can send one. Claiming
// what it changes, it converges; claiming less, it is rejected, since the
// keys it leaves out would count as no edit of its sender's (decision 33).
test('a sender’s absolute write converges where it claims what it changes', () => {
  const content = { v: 'mine', t: 1, s: { bl: 1 } };
  const others = [write(3, 1, { v: 'x' }), write(3, 1, { s: { it: 1 } }), write(3, 1, null)];
  for (const claims of [{}, { s: { bl: 1 } }, { v: 'mine', t: 1, s: { bl: 1 } }]) {
    const { value } = absolute(content, claims);
    const forged = write(3, 1, value, { isOverrideStyle: true });
    for (const other of others) {
      for (const steps of [pair(forged, other), pair(other, forged)]) {
        const failure = replay(document, steps, { budget: 50, intent: false });
        if (Object.keys(claims).length === 3) expect(failure).toBeNull();
        else expect(failure?.message).toMatch(/and does not claim it/);
      }
    }
  }
});

// Seed 50,205 of the round 20 sweep, shrunk: the seeded cell holds a value
// with no type. Read as it is, Univer's typing of it under a losing `fd`
// counted as that write's edit, so it claimed the value, the format command's
// retype yielded to it, and the sender's later `fd` was lost (state.inferred).
// With a value between, the retype read the value's absolute write without
// its tail, so it claimed the `fd` that tail puts back (state.lands).
test('a value read with no type is no edit of a write that types it', () => {
  const removal = {
    id: cellIds.removeNumfmt,
    params: {
      unitId: 'wb',
      subUnitId: 's1',
      ranges: [{ startRow: 2, endRow: 3, startColumn: 2, endColumn: 2 }],
      trigger: 'sheet.command.numfmt.set.numfmt',
    },
  };
  const retype = write(3, 2, { t: 4 }, { trigger: 'sheet.command.numfmt.set.numfmt' });
  passes([
    { client: 1, edit: [write(3, 2, { fd: 1 })] },
    { client: 0, edit: [removal, retype] },
    { client: 1, edit: [write(3, 2, { fd: 0 })] },
  ]);
  passes([
    { client: 1, edit: [write(3, 2, { fd: 1 })] },
    { client: 0, edit: [removal, retype] },
    { client: 1, edit: [write(3, 2, { v: 1 })] },
    { client: 1, edit: [write(3, 2, { fd: 0 })] },
  ]);
});

// Seed 90,082 of the round 21 sweep, shrunk: an absolute write of a cell
// with ft and no formula names ft, which Univer drops and its tail writes
// back. Rebased past the sender's deletion of the cell, the ft it named
// differed from its base, and the base check rejected an honest write.
test('an absolute write’s ft that Univer drops is no change of its base', () => {
  passes([
    { client: 1, edit: [write(1, 0, { ft: 0 })] },
    { client: 0, edit: [write(1, 0, { s: null })] },
    { client: 1, take: 'send' },
    { client: 1, edit: [write(1, 0, null)] },
    { client: 1, take: 'server' },
  ]);
});

// Seed 100,646 of the final comparison's sweep, shrunk: client 0 sends a
// style clear with `fd` on A2 (7 under the text format, which the clear
// leaves the text '7'), then writes `ft` unsent, while client 1 writes a
// `custom` there. Univer types '7' as a number under the `ft` write. The
// incoming write's tail was landed with a tail of its own, which retyped
// '7' too, so the rebased `ft` dropped its retype and the base check
// rejected the write that followed (state.lands). The judge's variants,
// paste-shaped ones included, against each partner, converge too.
test('seed 100646: ft rebased past a custom on a cell its fd and style clear left', () => {
  const at = (value: unknown) => write(1, 0, value);
  const paste = { f: '=D1', si: null, ft: 2, fd: 1, v: null };
  const cases = [
    [{ s: null, fd: 1 }, { ft: 2 }],
    [{ s: null, fd: 1 }],
    [{ ft: 2 }],
    [paste],
    [paste, { s: { bl: 1 } }],
    [{ v: 5, f: null, si: null, ft: null, fd: null }],
    [{ s: { bl: 1 } }, paste],
  ];
  for (const [first, then] of cases) {
    for (const other of [{ custom: { note: 'nw#3' } }, { v: 'x' }, { s: { it: 1 } }]) {
      passes([
        { client: 0, edit: [at(first)] },
        { client: 0, take: 'send' },
        { client: 1, edit: [at(other)] },
        { client: 1, take: 'send' },
        ...(then ? [{ client: 0, edit: [at(then)] }] : []),
        { client: 0, take: 'server' },
        { client: 1, take: 'server' },
      ]);
    }
  }
});

// F13 (decision 36; schema seed 141,057 of replay round 24's sweep, shrunk):
// client 0's `custom: null`, accepted past client 1's `fd`, is an absolute
// write with a tail that puts the `fd` back. Past client 1's `ft: 2` the
// tail, transformed apart from its absolute write, kept that `ft` and as the
// winner landed it over client 1's later `ft: 0`, on the server and on
// client 1. The transform now reads a write and its tail as one and rebuilds
// the tail from the cell it resolves (cells.withoutTails), so the cell ends
// as one person's edits in that order make it, with the first `ft` sent
// before the second or not.
test('F13: a tail keeps no stale ft over its sender’s later ft', () => {
  const at = (value: unknown) => write(1, 2, value);
  const cell = (ft: number) => ({ v: 's1:1:2', t: 1, ft, fd: 1 });
  const steps = (first: number, then: number, sendFirst: boolean): Step[] => [
    { client: 1, edit: [at({ fd: 1 })] },
    { client: 1, take: 'send' },
    { client: 0, edit: [at({ custom: null })] },
    { client: 1, edit: [at({ ft: first })] },
    { client: 1, take: 'server' },
    // The acknowledgement sends the first `ft` before the second is made.
    ...(sendFirst ? [{ client: 1, take: 'client' } as const] : []),
    { client: 1, edit: [at({ ft: then })] },
  ];
  expect(landed(steps(2, 0, false), 1, 2)).toEqual(cell(0));
  expect(landed(steps(0, 2, false), 1, 2)).toEqual(cell(2));
  expect(landed(steps(2, 0, true), 1, 2)).toEqual(cell(0));
});

// SHRINK_SEED=n (and SHRINK_SKIP=ft,fd for the longer run) prints seed n's
// smallest failing steps as plain JSON mutations.
test.runIf(process.env.SHRINK_SEED)(
  'shrinks a failing seed',
  () => {
    const skip = (process.env.SHRINK_SKIP ?? '').split(',').filter(Boolean);
    const result = shrinkSeed({
      seed: Number(process.env.SHRINK_SEED),
      document,
      mutations: 40,
      generate: schemaEdits(skip),
      budget: 50,
      intent: true,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  },
  unclocked,
);

// SWEEP=first-last (and SWEEP_SKIP=ft,fd) runs the schema sweep over those
// seeds without stopping at a failure, and prints each failure, its kind, and
// the counts: what the brief's sweeps run.
test.runIf(process.env.SWEEP)(
  'sweeps seeds',
  () => {
    const [first, last] = process.env.SWEEP!.split('-').map(Number);
    const skip = (process.env.SWEEP_SKIP ?? '').split(',').filter(Boolean);
    const generate = skip.length > 0 ? schemaEdits(skip) : schemaEdit;
    const stats = newStats();
    const failures: { seed: number; kind: string; message: string }[] = [];
    let largest = 0;
    const started = performance.now();
    for (let seed = first; seed <= last; seed++) {
      try {
        const run = simulate({ seed, document, mutations: 40, generate, budget: 50, intent: true });
        largest = Math.max(largest, run.largest);
        for (const key of Object.keys(stats) as (keyof typeof stats)[])
          stats[key] += run.stats[key];
        try {
          const expected = run.server.snapshot();
          for (const client of run.clients) expect(client.snapshot()).toEqual(expected);
        } finally {
          for (const replica of [run.server, ...run.clients]) replica.univer.dispose();
        }
      } catch (error) {
        const failure = classify(error);
        failures.push({
          seed,
          kind: failure.kind,
          message: failure.message.split('\n')[0].slice(0, 200),
        });
      }
    }
    const kinds: Record<string, number> = {};
    for (const { kind } of failures) kinds[kind] = (kinds[kind] ?? 0) + 1;
    const ms = Math.round(performance.now() - started);
    process.stdout.write(
      `${JSON.stringify({ first, last, skip, ms, largest, kinds, stats, failures }, null, 1)}\n`,
    );
  },
  unclocked,
);
