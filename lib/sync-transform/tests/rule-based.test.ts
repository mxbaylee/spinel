import { expect, test } from 'vitest';
import type { IWorkbookData } from '@univerjs/core';
import type { Mutation } from '../index.ts';
import { cellIds } from '../src/writes.ts';
import { richDoc } from './generate-cells.ts';
import { schemaBook } from './generate-schema.ts';
import { snapshotCells } from './harness.ts';
import { simulate } from './simulate.ts';
import type { Step } from './simulate.ts';

// The rule-based merge's tests (branch proto/spn-056-stateless,
// lib/sync-transform/tests/schema.test.ts and cells.test.ts) and the final
// comparison's probes, ported as convergence tests: each case it refused
// (`'format-race'`), or diverged on, must converge here through real Univer
// with the intent checks on, and no refusal or resync. A small case pins the
// cell the server ends with. The two trees number their findings apart, so
// each name says which tree's finding it is.

const unclocked = 0;
const document = { workbook: schemaBook() };

const write = (row: number, col: number, value: unknown, extra = {}): Mutation => ({
  id: cellIds.setRangeValues,
  params: { unitId: 'wb', subUnitId: 's1', cellValue: { [row]: { [col]: value } }, ...extra },
});
const one = (row: number, col: number) => [
  { startRow: row, startColumn: col, endRow: row, endColumn: col },
];
const numfmt = (row: number, col: number, pattern: string, endRow = row): Mutation => ({
  id: cellIds.setNumfmt,
  params: {
    unitId: 'wb',
    subUnitId: 's1',
    values: { k1: { ranges: [{ startRow: row, startColumn: col, endRow, endColumn: col }] } },
    refMap: { k1: { pattern } },
  },
});
const removed = (row: number, col: number): Mutation => ({
  id: cellIds.removeNumfmt,
  params: { unitId: 'wb', subUnitId: 's1', ranges: one(row, col) },
});
/** Client 0 edits `a` and client 1 `b`, unsent, so each lands past the other. */
const pair = (a: Mutation, b: Mutation): Step[] => [
  { client: 0, edit: [a] },
  { client: 1, edit: [b] },
];
/** Client 0's `edits`, accepted, and both clients caught up. */
const held = (...edits: Mutation[]): Step[] => [
  { client: 0, edit: edits },
  { client: 0, take: 'send' },
  { client: 0, take: 'server' },
  { client: 1, take: 'client' },
  { client: 0, take: 'client' },
];
const rich = held(write(2, 0, { p: richDoc('rich') }));

/**
 * Runs `steps` with the intent checks on and returns the server's cell at
 * `row`, `col` (style inline), or null, once every client agrees with it,
 * or why not: a refusal or resync fails here as a divergence would.
 */
function landed(steps: Step[], row: number, col: number): unknown {
  const run = simulate({
    seed: 1,
    document,
    mutations: 0,
    generate: () => null,
    script: steps,
    budget: 50,
    intent: true,
  });
  try {
    const expected = run.server.snapshot() as { workbook: IWorkbookData };
    for (const client of run.clients) expect(client.snapshot()).toEqual(expected);
    expect({ refused: run.stats.refused, resynced: run.stats.resynced }).toEqual({
      refused: 0,
      resynced: 0,
    });
    return snapshotCells(expected.workbook)('wb', 's1', row, col) ?? null;
  } finally {
    for (const replica of [run.server, ...run.clients]) replica.univer.dispose();
  }
}
/** Whether `steps` converge with intent and no refusal, as `landed` checks. */
const converges = (steps: Step[]) => {
  try {
    landed(steps, 0, 0);
    return true;
  } catch {
    return false;
  }
};

type Case = [name: string, steps: Step[], row: number, col: number];
const cases: Case[] = [];
const both = (
  name: string,
  a: Mutation,
  b: Mutation,
  row: number,
  col: number,
  pre: Step[] = [],
) => {
  cases.push([`${name}, its write first`, [...pre, ...pair(a, b)], row, col]);
  cases.push([`${name}, the other first`, [...pre, ...pair(b, a)], row, col]);
};

// Rule-based F5 (decision 26, superseded): a value written with its format
// cleared, refused against a write of no value and then against any write.
both(
  'rule-based F5: "7" with a format clear against fd',
  write(2, 1, { v: '7', s: { n: null } }),
  write(2, 1, { fd: 1 }),
  2,
  1,
);
const f5Others: [string, () => Mutation][] = [
  ['itself', () => write(2, 1, { v: 5, s: { n: null } })],
  ['a text with a format clear', () => write(2, 1, { v: '5', s: { n: null } })],
  ['a value with a style', () => write(2, 1, { v: 'x', s: { bl: 1 } })],
  ['a formula commit', () => write(2, 1, { f: '=1+2', si: null, v: null, p: null })],
  ['a rich-text commit', () => write(2, 1, { p: richDoc('q'), v: null, f: null, si: null })],
  ['a percent format', () => numfmt(2, 1, '0%')],
  ['a removed format', () => removed(2, 1)],
];
for (const v of [5, '5']) {
  for (const [name, other] of f5Others) {
    both(
      `rule-based F5: ${JSON.stringify(v)} with a format clear against ${name}`,
      write(2, 1, { v, s: { n: null } }),
      other(),
      2,
      1,
    );
  }
}

// Rule-based F6 (decision 28, superseded): forced text against a text
// format, then a value; and seed 13,888's format written with a value.
cases.push([
  'rule-based F6: forced text, a text format, then a value',
  [
    { client: 1, edit: [write(3, 1, { v: 1, t: 4 })] },
    { client: 0, edit: [numfmt(2, 1, '@', 3)] },
    { client: 1, edit: [write(3, 1, { v: true })] },
  ],
  3,
  1,
]);
for (const valued of [
  { v: true, s: { n: null } },
  { v: 5, s: { n: { pattern: '0%' } } },
]) {
  for (const [row, col] of [
    [2, 1],
    [3, 1],
  ]) {
    both(
      `rule-based F6: ${JSON.stringify(valued)} against forced '' at ${row},${col}`,
      write(row, col, valued),
      write(row, col, { v: '', t: 4 }),
      row,
      col,
    );
  }
}

// Rule-based F12 (its numbering, not this tree's): forced text, then a value
// in its sender's next edit, against a concurrent text, refused there.
for (const [name, forced, next] of [
  ["'123", { v: '123', t: 4, f: null, si: null, p: null }, { v: true }],
  ["'123", { v: '123', t: 4, f: null, si: null, p: null }, { v: 5 }],
  ['a forced number', { v: 1, t: 4 }, { v: true }],
  ['a forced number', { v: 1, t: 4 }, { v: 5 }],
  ['a forced empty text', { v: '', t: 4 }, { v: true }],
  ['a forced empty text', { v: '', t: 4 }, { v: 5 }],
] as [string, object, object][]) {
  cases.push([
    `rule-based F12: ${name}, then ${JSON.stringify(next)}, past a concurrent text`,
    [
      { client: 1, edit: [write(3, 1, forced)] },
      { client: 0, edit: [write(3, 1, { v: 'abc' })] },
      { client: 1, edit: [write(3, 1, next)] },
    ],
    3,
    1,
  ]);
}

// The rule-based merge's format races in its cells.test.ts (decisions 5 and
// 12, superseded): dense seed 627, a bold against '0%' on a boolean under
// '@', and the cuts' seed 13, '0%' as a style against a style clear.
const booleanUnderText = held(
  write(2, 1, { s: { n: { pattern: '0.00' } }, v: 'TRUE' }, { isOverrideStyle: true }),
  numfmt(2, 1, '@', 3),
);
both(
  'rule-based format race: a bold against a percent format',
  write(2, 1, { s: { bl: 0 } }),
  numfmt(2, 1, '0%', 3),
  2,
  1,
  booleanUnderText,
);
both(
  'rule-based format race: a percent style against a style clear',
  write(2, 1, { s: { n: { pattern: '0%' } } }),
  write(2, 1, { s: null }),
  2,
  1,
  booleanUnderText,
);

// Rule-based F13 to F16, which diverge there (that branch left F13 to F15
// to a later ticket).
cases.push([
  'rule-based F13: a text format past a value over accepted forced text',
  [
    { client: 1, edit: [write(3, 1, { v: 7, t: 4 })] },
    { client: 1, take: 'send' },
    {
      client: 1,
      edit: [
        {
          ...numfmt(3, 1, '@'),
          params: { ...numfmt(3, 1, '@').params, trigger: 'sheet.command.numfmt.set.numfmt' },
        },
      ],
    },
    { client: 1, take: 'server' },
    { client: 0, take: 'client' },
    { client: 0, edit: [write(3, 1, { v: 0 })] },
  ],
  3,
  1,
]);
cases.push([
  'rule-based F14: a deletion past a value over accepted forced text',
  [
    { client: 1, edit: [write(3, 0, { v: true, t: 4 })] },
    { client: 1, take: 'send' },
    { client: 1, take: 'server' },
    { client: 0, take: 'client' },
    { client: 1, edit: [write(3, 0, { v: null })] },
    { client: 0, edit: [write(3, 0, { v: 'TRUE' })] },
  ],
  3,
  0,
]);
const commit = (v: unknown) => write(3, 1, { v, f: null, si: null, p: null });
cases.push([
  'rule-based F15: two values past accepted forced text',
  [
    { client: 1, edit: [write(3, 1, { v: '00123', t: 4, f: null, si: null, p: null })] },
    { client: 1, take: 'send' },
    { client: 1, take: 'server' },
    { client: 0, take: 'client' },
    { client: 1, take: 'client' },
    { client: 1, edit: [commit(5)] },
    { client: 0, edit: [commit('abc')] },
  ],
  3,
  1,
]);
for (const key of ['st', 'ul', 'ol']) {
  cases.push([
    `rule-based F16: a null font colour past a style override with a coloured ${key}`,
    [
      { client: 1, edit: [write(3, 0, { s: { cl: null } })] },
      { client: 1, take: 'send' },
      { client: 1, take: 'server' },
      {
        client: 0,
        edit: [
          write(
            3,
            0,
            { s: { [key]: { s: 1, t: 10, cl: { rgb: '#0000ff' } } } },
            { isOverrideStyle: true },
          ),
        ],
      },
    ],
    3,
    0,
  ]);
}

// The final comparison's rr20 matrix: the 11 pairs that diverge on the
// rule-based merge, client 0's write first, on B4 (plain), B3 (7 under '@')
// and A3 (rich text).
const rr20: Record<string, object> = {
  t1: { t: 1 },
  t2: { t: 2 },
  pnull: { p: null },
  fclr: { f: '' },
  fd1: { fd: 1 },
  si: { si: 'id', f: null },
  custom: { custom: { k: 1 } },
};
for (const [where, row, col, pre, a, b] of [
  ['B4', 3, 1, [], 't1', 't2'],
  ['B3', 2, 1, [], 'pnull', 't2'],
  ['B3', 2, 1, [], 'fclr', 't2'],
  ['B3', 2, 1, [], 'fd1', 't2'],
  ['B3', 2, 1, [], 't2', 'pnull'],
  ['B3', 2, 1, [], 't2', 'fclr'],
  ['B3', 2, 1, [], 't2', 'fd1'],
  ['B3', 2, 1, [], 't2', 'si'],
  ['B3', 2, 1, [], 'custom', 't2'],
  ['B3', 2, 1, [], 'si', 't2'],
  ['A3', 2, 0, rich, 't1', 't2'],
] as [string, number, number, Step[], string, string][]) {
  cases.push([
    `rule-based rr20 divergence: ${a} against ${b} on ${where}`,
    [...pre, ...pair(write(row, col, rr20[a]), write(row, col, rr20[b]))],
    row,
    col,
  ]);
}

const pins: Record<string, unknown> = {
  'rule-based F5: "7" with a format clear against fd, its write first': { v: '7', t: 1, fd: 1 },
  'rule-based F5: "7" with a format clear against fd, the other first': { v: 7, t: 2, fd: 1 },
  'rule-based F5: 5 with a format clear against itself, its write first': { v: 5, t: 2 },
  'rule-based F5: 5 with a format clear against itself, the other first': { v: 5, t: 2 },
  'rule-based F5: 5 with a format clear against a text with a format clear, its write first': {
    v: 5,
    t: 2,
  },
  'rule-based F5: 5 with a format clear against a text with a format clear, the other first': {
    v: 5,
    t: 2,
  },
  'rule-based F5: 5 with a format clear against a value with a style, its write first': {
    v: '5',
    t: 1,
    s: { bl: 1 },
  },
  'rule-based F5: 5 with a format clear against a value with a style, the other first': {
    v: 'x',
    t: 1,
    s: { bl: 1 },
  },
  'rule-based F5: 5 with a format clear against a formula commit, its write first': {
    v: '5',
    t: 1,
    f: '=1+2',
  },
  'rule-based F5: 5 with a format clear against a formula commit, the other first': { f: '=1+2' },
  'rule-based F5: 5 with a format clear against a rich-text commit, its write first': {
    v: '5',
    t: 1,
  },
  'rule-based F5: 5 with a format clear against a rich-text commit, the other first': {
    p: richDoc('q'),
  },
  'rule-based F5: 5 with a format clear against a percent format, its write first': { v: 5, t: 2 },
  'rule-based F5: 5 with a format clear against a percent format, the other first': {
    v: '5',
    t: 1,
    s: { n: { pattern: '0%' } },
  },
  'rule-based F5: 5 with a format clear against a removed format, its write first': { v: 5, t: 2 },
  'rule-based F5: 5 with a format clear against a removed format, the other first': {
    v: '5',
    t: 1,
  },
  'rule-based F5: "5" with a format clear against itself, its write first': { v: 5, t: 2 },
  'rule-based F5: "5" with a format clear against itself, the other first': { v: 5, t: 2 },
  'rule-based F5: "5" with a format clear against a text with a format clear, its write first': {
    v: 5,
    t: 2,
  },
  'rule-based F5: "5" with a format clear against a text with a format clear, the other first': {
    v: 5,
    t: 2,
  },
  'rule-based F5: "5" with a format clear against a value with a style, its write first': {
    v: '5',
    t: 1,
    s: { bl: 1 },
  },
  'rule-based F5: "5" with a format clear against a value with a style, the other first': {
    v: 'x',
    t: 1,
    s: { bl: 1 },
  },
  'rule-based F5: "5" with a format clear against a formula commit, its write first': {
    v: '5',
    t: 1,
    f: '=1+2',
  },
  'rule-based F5: "5" with a format clear against a formula commit, the other first': { f: '=1+2' },
  'rule-based F5: "5" with a format clear against a rich-text commit, its write first': {
    v: '5',
    t: 1,
  },
  'rule-based F5: "5" with a format clear against a rich-text commit, the other first': {
    p: richDoc('q'),
  },
  'rule-based F5: "5" with a format clear against a percent format, its write first': {
    v: 5,
    t: 2,
  },
  'rule-based F5: "5" with a format clear against a percent format, the other first': {
    v: '5',
    t: 1,
    s: { n: { pattern: '0%' } },
  },
  'rule-based F5: "5" with a format clear against a removed format, its write first': {
    v: 5,
    t: 2,
  },
  'rule-based F5: "5" with a format clear against a removed format, the other first': {
    v: '5',
    t: 1,
  },
  'rule-based F6: forced text, a text format, then a value': {
    v: 1,
    s: { n: { pattern: '@' } },
    t: 3,
  },
  'rule-based F6: {"v":true,"s":{"n":null}} against forced \'\' at 2,1, its write first': {
    v: 'true',
    t: 4,
  },
  'rule-based F6: {"v":true,"s":{"n":null}} against forced \'\' at 2,1, the other first': {
    v: '',
    t: 4,
  },
  'rule-based F6: {"v":true,"s":{"n":null}} against forced \'\' at 3,1, its write first': {
    v: 1,
    t: 3,
  },
  'rule-based F6: {"v":true,"s":{"n":null}} against forced \'\' at 3,1, the other first': {
    v: '',
    t: 4,
  },
  'rule-based F6: {"v":5,"s":{"n":{"pattern":"0%"}}} against forced \'\' at 2,1, its write first': {
    v: '5',
    t: 4,
    s: { n: { pattern: '0%' } },
  },
  'rule-based F6: {"v":5,"s":{"n":{"pattern":"0%"}}} against forced \'\' at 2,1, the other first': {
    v: '',
    t: 4,
    s: { n: { pattern: '0%' } },
  },
  'rule-based F6: {"v":5,"s":{"n":{"pattern":"0%"}}} against forced \'\' at 3,1, its write first': {
    v: 5,
    s: { n: { pattern: '0%' } },
    t: 2,
  },
  'rule-based F6: {"v":5,"s":{"n":{"pattern":"0%"}}} against forced \'\' at 3,1, the other first': {
    v: '',
    t: 4,
    s: { n: { pattern: '0%' } },
  },
  'rule-based F12: \'123, then {"v":true}, past a concurrent text': { v: 'abc', t: 1 },
  'rule-based F12: \'123, then {"v":5}, past a concurrent text': { v: 'abc', t: 1 },
  'rule-based F12: a forced number, then {"v":true}, past a concurrent text': { v: 'abc', t: 1 },
  'rule-based F12: a forced number, then {"v":5}, past a concurrent text': { v: 'abc', t: 1 },
  'rule-based F12: a forced empty text, then {"v":true}, past a concurrent text': {
    v: 'abc',
    t: 1,
  },
  'rule-based F12: a forced empty text, then {"v":5}, past a concurrent text': { v: 'abc', t: 1 },
  'rule-based format race: a bold against a percent format, its write first': {
    v: 1,
    t: 3,
    s: { bl: 0, n: { pattern: '0%' } },
  },
  'rule-based format race: a bold against a percent format, the other first': {
    v: '1',
    t: 1,
    s: { bl: 0, n: { pattern: '0%' } },
  },
  'rule-based format race: a percent style against a style clear, its write first': {
    v: 1,
    t: 2,
    s: { n: { pattern: '0%' } },
  },
  'rule-based format race: a percent style against a style clear, the other first': { v: 1, t: 3 },
  'rule-based F13: a text format past a value over accepted forced text': {
    v: '0',
    t: 4,
    s: { n: { pattern: '@' } },
  },
  'rule-based F14: a deletion past a value over accepted forced text': {
    v: 'TRUE',
    t: 1,
    s: { n: { pattern: '@' } },
  },
  'rule-based F15: two values past accepted forced text': { v: 'abc', t: 1 },
  'rule-based F16: a null font colour past a style override with a coloured st': {
    v: 7,
    t: 2,
    s: { st: { s: 1, t: 10 } },
  },
  'rule-based F16: a null font colour past a style override with a coloured ul': {
    v: 7,
    t: 2,
    s: { ul: { s: 1, t: 10 } },
  },
  'rule-based F16: a null font colour past a style override with a coloured ol': {
    v: 7,
    t: 2,
    s: { ol: { s: 1, t: 10 } },
  },
  'rule-based rr20 divergence: t1 against t2 on B4': { v: 'NaN', t: 1 },
  'rule-based rr20 divergence: pnull against t2 on B3': {
    v: '7',
    t: 1,
    s: { n: { pattern: '@' } },
  },
  'rule-based rr20 divergence: fclr against t2 on B3': {
    v: '7',
    t: 1,
    s: { n: { pattern: '@' } },
    f: '',
  },
  'rule-based rr20 divergence: fd1 against t2 on B3': {
    v: '7',
    t: 1,
    s: { n: { pattern: '@' } },
    fd: 1,
  },
  'rule-based rr20 divergence: t2 against pnull on B3': { v: 7, t: 2, s: { n: { pattern: '@' } } },
  'rule-based rr20 divergence: t2 against fclr on B3': {
    v: 7,
    t: 2,
    s: { n: { pattern: '@' } },
    f: '',
  },
  'rule-based rr20 divergence: t2 against fd1 on B3': {
    v: 7,
    t: 2,
    s: { n: { pattern: '@' } },
    fd: 1,
  },
  'rule-based rr20 divergence: t2 against si on B3': {
    v: 7,
    t: 2,
    s: { n: { pattern: '@' } },
    si: 'id',
  },
  'rule-based rr20 divergence: custom against t2 on B3': {
    v: '7',
    t: 1,
    s: { n: { pattern: '@' } },
    custom: { k: 1 },
  },
  'rule-based rr20 divergence: si against t2 on B3': {
    v: '7',
    t: 1,
    s: { n: { pattern: '@' } },
    si: 'id',
  },
  'rule-based rr20 divergence: t1 against t2 on A3': { v: 'NaN', p: richDoc('rich'), t: 1 },
};

test.each(cases)('%s converges', (name, steps, row, col) => {
  expect(landed(steps, row, col)).toEqual(pins[name]);
});

const forced = [
  { v: 1, t: 4 },
  { v: '', t: 4 },
  { v: 'abc', t: 4 },
  { v: 'TRUE', t: 4 },
  { v: '123', t: 4, f: null, si: null, p: null },
];

// The rule-based merge's class test (its schema.test.ts, round 20A's and
// 21's reviews): forced text, a concurrent value, then a value or the text
// format in the forced text's sender's next edit, on B3 under '@' and on two
// cells off it, either client's edits accepted first. That tree refused
// 1,776 of the 1,920 cases; here every one converges with no refusal.
test(
  'rule-based class test: forced text, a concurrent value and a next value keep one type',
  () => {
    const concurrent = [
      { v: 'abc' },
      { v: 'abc', s: { bl: 1 } },
      { v: 'abc', p: null },
      { v: 'abc', f: null, si: null, p: null },
      { v: 'abc', t: 1 },
      { v: 5 },
      { v: true },
      { v: '7' },
    ];
    const next: ((row: number, col: number) => Mutation)[] = [
      ...[
        { v: true },
        { v: 5 },
        { v: '7' },
        { v: false },
        { v: 'TRUE' },
        { v: 5, s: { bl: 1 } },
        { v: 0 },
      ].map((n) => (row: number, col: number) => write(row, col, n)),
      (row, col) => numfmt(row, col, '@'),
    ];
    const drains: Step[][] = [
      [],
      [
        { client: 1, take: 'send' },
        { client: 1, take: 'server' },
      ],
    ];
    const failing: unknown[] = [];
    let runs = 0;
    for (const [row, col] of [
      [2, 1],
      [3, 1],
      [0, 2],
    ]) {
      for (const f of forced) {
        for (const x of concurrent) {
          for (const [n, nextEdit] of next.entries()) {
            for (const [d, last] of drains.entries()) {
              runs++;
              const steps: Step[] = [
                { client: 1, edit: [write(row, col, f)] },
                { client: 0, edit: [write(row, col, x)] },
                { client: 1, edit: [nextEdit(row, col)] },
                ...last,
              ];
              if (!converges(steps)) failing.push({ cell: [row, col], f, x, n, d });
            }
          }
        }
      }
    }
    expect([runs, failing]).toEqual([1920, []]);
  },
  unclocked,
);

// The forced-text three-edit matrix (the final comparison's probe, from
// round 21's description): forced text both screens hold, then client 1
// writes one shape and client 0 another at once, either accepted first. The
// full matrix (FORCED_MATRIX=1) is 3 cells x 7 x 14 x 14 x 2 = 8,232 runs,
// about a minute; the rule-based merge diverged in 1,064 and refused 252.
// The reduced form keeps every forced text and a shape of each kind, on B3
// under '@' and B4 off it: 1,372 runs.
const matrixForced = [
  ...forced,
  { v: '00123', t: 4, f: null, si: null, p: null },
  { v: 'abc', t: 4, f: null, si: null, p: null },
];
type Shape = (row: number, col: number) => Mutation;
const shape =
  (value: unknown): Shape =>
  (row, col) =>
    write(row, col, value);
const matrixShapes: Record<string, Shape> = {
  abc: shape({ v: 'abc' }),
  num5: shape({ v: 5 }),
  true: shape({ v: true }),
  null: shape({ v: null }),
  str7: shape({ v: '7' }),
  commit: shape({ v: 'abc', f: null, si: null, p: null }),
  commit5: shape({ v: 5, f: null, si: null, p: null }),
  pct: shape({ v: 0.5, s: { n: { pattern: '0%' } } }),
  bold: shape({ s: { bl: 1 } }),
  fmt0: (row, col) => numfmt(row, col, '0.00'),
  'fmt@': (row, col) => numfmt(row, col, '@'),
  rm: (row, col) => removed(row, col),
  rich: shape({ p: richDoc('q'), v: null, f: null, si: null }),
  formula: shape({ f: '=1+2', si: null, v: null, p: null }),
};
const reduced = ['abc', 'null', 'commit5', 'pct', 'fmt@', 'rm', 'rich'];
function threeEdits(cells: number[][], shapes: string[]) {
  const failing: unknown[] = [];
  let runs = 0;
  for (const [row, col] of cells) {
    for (const a of matrixForced) {
      for (const b of shapes) {
        for (const c of shapes) {
          for (const first of [0, 1]) {
            runs++;
            const steps: Step[] = [
              ...held(write(row, col, a)).map((step) => ({ ...step, client: 1 - step.client })),
              { client: 1, edit: [matrixShapes[b](row, col)] },
              { client: 0, edit: [matrixShapes[c](row, col)] },
              { client: first, take: 'send' },
              { client: first, take: 'server' },
            ];
            if (!converges(steps)) failing.push({ cell: [row, col], a, b, c, first });
          }
        }
      }
    }
  }
  return { runs, failing };
}

test(
  'rule-based forced-text three-edit matrix, reduced, keeps one type',
  () => {
    expect(
      threeEdits(
        [
          [2, 1],
          [3, 1],
        ],
        reduced,
      ),
    ).toEqual({ runs: 1372, failing: [] });
  },
  unclocked,
);

test.runIf(process.env.FORCED_MATRIX)(
  'rule-based forced-text three-edit matrix, full, keeps one type',
  () => {
    const all = Object.keys(matrixShapes);
    expect(
      threeEdits(
        [
          [2, 1],
          [3, 1],
          [0, 2],
        ],
        all,
      ),
    ).toEqual({ runs: 8232, failing: [] });
  },
  unclocked,
);
