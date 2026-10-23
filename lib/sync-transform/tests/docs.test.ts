import { CustomRangeType, JSONX, TextXActionType } from '@univerjs/core';
import type { IParagraph, TextXAction } from '@univerjs/core';
import { expect, test } from 'vitest';
import { docFormulas } from '@spinel/doc-formulas';
import { transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { docIds } from '../src/docs.ts';
import { docDrawingInsert, docEdit, docFormulaInsert, seededDoc } from './generate-docs.ts';
import { Replica } from './harness.ts';
import { random } from './random.ts';
import { convergesOver } from './simulate.ts';

const document = { doc: seededDoc() };

/**
 * After `setup`, applies `b` then `a` past it on one replica, `a` then `b`
 * past it on another: `a` is the edit the server accepted first.
 */
function merge(a: Mutation[], b: Mutation[], setup: Mutation[] = []) {
  const left = new Replica(document);
  left.apply(setup);
  left.apply(b);
  left.apply(transform(a, b, 'left'));
  const right = new Replica(document);
  right.apply(setup);
  right.apply(a);
  right.apply(transform(b, a, 'right'));
  expect(right.snapshot()).toEqual(left.snapshot());
  return left.snapshot() as { doc: any };
}

const edit = (actions: unknown): Mutation[] => [
  { id: docIds.richText, params: { unitId: 'doc', actions, textRanges: [] } },
];
// Univer's commands never emit a zero-length retain, and TextX mishandles one.
const retain = (len: number): TextXAction[] =>
  len > 0 ? [{ t: TextXActionType.RETAIN, len }] : [];
const insert = (at: number, text: string) =>
  edit(
    JSONX.getInstance().editOp([
      ...retain(at),
      { t: TextXActionType.INSERT, body: { dataStream: text }, len: text.length },
    ]),
  );
const remove = (at: number, len: number) =>
  edit(JSONX.getInstance().editOp([...retain(at), { t: TextXActionType.DELETE, len }]));
const rename = (name: string): Mutation[] => [
  { id: docIds.rename, params: { unitId: 'doc', name } },
];

test('inserts at the same offset keep both, winner first', () => {
  const { doc } = merge(insert(6, 'A'), insert(6, 'B'));
  expect(doc.body.dataStream.startsWith('Alpha AB')).toBe(true);
});

test('an insert inside a concurrently deleted range survives', () => {
  const { doc } = merge(insert(8, 'X'), remove(6, 5));
  expect(doc.body.dataStream.startsWith('Alpha Xgamma')).toBe(true);
});

test('overlapping deletes remove the union once', () => {
  const { doc } = merge(remove(0, 6), remove(3, 8));
  expect(doc.body.dataStream.startsWith('gamma')).toBe(true);
});

test('an edit made obsolete by the peer vanishes', () => {
  expect(transform(remove(0, 6), remove(0, 6), 'right')).toEqual([]);
});

const style = (at: number, len: number, ts: Record<string, number>, coverType = 0) =>
  edit(
    JSONX.getInstance().editOp([
      ...retain(at),
      {
        t: TextXActionType.RETAIN,
        len,
        body: { dataStream: '', textRuns: [{ st: 0, ed: len, ts }] },
        coverType,
      },
    ]),
  );
const bold = (at: number, len: number) => style(at, len, { bl: 1 });
const italic = (at: number, len: number) => style(at, len, { it: 1 });

test('one style applied to overlapping ranges covers their union on both sides', () => {
  const { doc } = merge(bold(6, 4), bold(8, 5));
  expect(doc.body.textRuns).toContainEqual({ st: 6, ed: 13, ts: { bl: 1 } });
});

test('a style edit after one the peer overrode keeps its styles', () => {
  // Past the peer's italic, the first edit is left `ts: {}` on character 22,
  // where the second edit's bold then went missing on one side only.
  const { doc } = merge([...italic(21, 2), ...bold(22, 2)], italic(22, 4));
  expect(doc.body.textRuns).toContainEqual({ st: 22, ed: 24, ts: { bl: 1, it: 1 } });
});

// The format painter replaces a run's style (coverType 1, REPLACE), with its
// unset keys as 0.
test('a replaced style with falsy keys converges with a concurrent style over it', () => {
  const painted = style(6, 4, { bl: 0, it: 0 }, 1);
  const bolded = bold(8, 5);
  // Accepted first, the painter's `bl: 0` stands over 8–10.
  expect(merge(painted, bolded).doc.body.textRuns).toContainEqual({
    st: 6,
    ed: 10,
    ts: { bl: 0, it: 0 },
  });
  // Accepted first, the bold's `bl: 1` stands there, beside the painter's `it: 0`.
  expect(merge(bolded, painted).doc.body.textRuns).toContainEqual({
    st: 8,
    ed: 10,
    ts: { bl: 1, it: 0 },
  });
});

// As BuildTextUtils.customRange.add builds a link, and DeleteDocHyperLinkCommand
// (deleteCustomRangeTextX) an unlink: an empty list clears the range's links.
const link = (at: number, len: number, rangeId: string) =>
  edit(
    JSONX.getInstance().editOp([
      ...retain(at),
      {
        t: TextXActionType.RETAIN,
        len,
        body: {
          dataStream: '',
          customRanges: [
            {
              rangeId,
              rangeType: CustomRangeType.HYPERLINK,
              startIndex: 0,
              endIndex: len - 1,
              properties: { url: `https://${rangeId}.test` },
            },
          ],
        },
        coverType: 0,
      },
    ]),
  );
const cleared = (at: number, len: number, key: string) =>
  edit(
    JSONX.getInstance().editOp([
      ...retain(at),
      { t: TextXActionType.RETAIN, len, body: { dataStream: '', [key]: [] } },
    ]),
  );

test('an unlink survives a concurrent edit before, inside or over the link', () => {
  const setup = link(6, 4, 'L');
  for (const peer of [insert(0, 'Z'), insert(8, 'Q'), bold(4, 8)]) {
    expect(merge(cleared(6, 4, 'customRanges'), peer, setup).doc.body.customRanges).toBeUndefined();
    expect(merge(peer, cleared(6, 4, 'customRanges'), setup).doc.body.customRanges).toBeUndefined();
  }
  // A link over the text a peer unlinks: either order converges.
  merge(link(6, 4, 'N'), cleared(6, 4, 'customRanges'), setup);
  merge(cleared(6, 4, 'customRanges'), link(6, 4, 'N'), setup);
});

test('a list the sender sent empty survives the transform', () => {
  // Univer's apply reads each of these as "clear the range", but for
  // customDecorations, which it reads as no change.
  for (const key of ['textRuns', 'customRanges', 'customDecorations']) {
    for (const peer of [insert(0, 'Z'), insert(8, 'Q'), bold(4, 8)]) {
      for (const side of ['left', 'right'] as const) {
        const [moved] = transform(cleared(6, 4, key), peer, side);
        const [, { e }] = moved.params.actions as [string, { e: TextXAction[] }];
        const bodies = e.flatMap(({ body }) => (body ? [body] : []));
        expect(bodies.length).toBeGreaterThan(0);
        for (const body of bodies) expect(body).toHaveProperty(key, []);
      }
      merge(cleared(6, 4, key), peer, link(6, 4, 'L'));
    }
  }
});

// Univer's apply splits a link at a style's edges, and its pieces share an id;
// the core patch (scripts/dependencies/patch-univer-core.ts) joins them again.
test('a style inside a concurrent link leaves the link whole on both screens', () => {
  const whole = [
    {
      rangeId: 'A',
      rangeType: CustomRangeType.HYPERLINK,
      startIndex: 11,
      endIndex: 15,
      properties: { url: 'https://A.test' },
    },
  ];
  expect(merge(link(11, 5, 'A'), bold(12, 6)).doc.body.customRanges).toEqual(whole);
  expect(merge(bold(12, 6), link(11, 5, 'A')).doc.body.customRanges).toEqual(whole);
});

// A paragraph cover: `coverType` 1 replaces the paragraph, 0 merges into it.
type Cover = Omit<IParagraph, 'startIndex'>;
const cover = (paragraph: Cover, coverType: number): TextXAction => ({
  t: TextXActionType.RETAIN,
  len: 1,
  body: { dataStream: '', paragraphs: [{ startIndex: 0, ...paragraph }] },
  coverType,
});
const covers = (at: number, paragraph: Cover, coverType: number) =>
  edit(JSONX.getInstance().editOp([...retain(at), cover(paragraph, coverType)]));
const list = (listId: string) => ({ nestingLevel: 0, listType: 'ORDER_LIST', listId });

test('the first accepted edit names a paragraph that a delete merges into', () => {
  // "Alpha beta gamma\r\r\n", where p1 (break at 16) is a list item.
  const setup = [
    ...remove(17, 13),
    ...covers(16, { paragraphId: 'p1', paragraphStyle: {}, bullet: list('l1') }, 1),
  ];
  // DeleteTextCommand over 10 to 17, past p1's break: Univer's merging cover
  // gives p2's break p1's bullet and its id too.
  const deletion = edit(
    JSONX.getInstance().editOp([
      ...retain(10),
      { t: TextXActionType.DELETE, len: 7 },
      cover({ paragraphId: 'p1', paragraphStyle: {}, bullet: list('l1') }, 0),
    ]),
  );
  // A concurrent bullet on p2, as BuildTextUtils.paragraph.bullet.set builds it.
  const bullet = covers(17, { paragraphId: 'p2', paragraphStyle: {}, bullet: list('l2') }, 1);
  const idOf = (doc: any) =>
    doc.body.paragraphs.find(({ startIndex }: any) => startIndex === 10).paragraphId;
  expect(idOf(merge(bullet, deletion, setup).doc)).toBe('p2');
  expect(idOf(merge(deletion, bullet, setup).doc)).toBe('p1');
});

// SPN-033's formulas: "=Budget.Summary.A1" under one whole-entity range, at 6 to 24.
const formulaSetup = () => docFormulaInsert(new Replica(document), 6, 6, 'F', 'A1');
const formulaEdit = (cell: string) => {
  const replica = new Replica(document);
  replica.apply(formulaSetup());
  return docFormulaInsert(replica, 6, 24, 'F', cell);
};
const formulas = (doc: any) =>
  docFormulas(doc.body).map(({ id, definition }) => [id, definition.expression]);

test('a formula stays whole past a style in or over it and text typed beside it', () => {
  const setup = formulaSetup();
  for (const styled of [bold(8, 4), bold(4, 24)]) {
    for (const typed of [insert(0, 'Z'), insert(6, 'Z'), insert(24, 'Q')]) {
      for (const [a, b] of [
        [styled, typed],
        [typed, styled],
      ]) {
        expect(formulas(merge(a!, b!, setup).doc)).toEqual([['F', '=Budget.Summary.A1']]);
      }
    }
  }
});

test('an edited formula survives concurrent typing, deletes and styles in it', () => {
  const setup = formulaSetup();
  const edited = formulaEdit('B2');
  for (const peer of [insert(10, 'Q'), remove(8, 3), remove(6, 18), bold(8, 4), insert(6, 'Z')]) {
    for (const [a, b] of [
      [edited, peer],
      [peer, edited],
    ]) {
      expect(formulas(merge(a!, b!, setup).doc)).toEqual([['F', '=Budget.Summary.B2']]);
    }
  }
});

test('formulas inserted at the same offset keep both, winner first', () => {
  const at = (id: string) => docFormulaInsert(new Replica(document), 6, 6, id, 'A1');
  expect(formulas(merge(at('A'), at('B')).doc).map(([id]) => id)).toEqual(['A', 'B']);
});

test('of two edits of one formula, the first accepted stands', () => {
  const setup = formulaSetup();
  expect(formulas(merge(formulaEdit('B2'), formulaEdit('C3'), setup).doc)).toEqual([
    ['F', '=Budget.Summary.B2'],
  ]);
  expect(formulas(merge(formulaEdit('C3'), formulaEdit('B2'), setup).doc)).toEqual([
    ['F', '=Budget.Summary.C3'],
  ]);
});

test('the transform drops the layout state captured for the original document', () => {
  const [a] = insert(1, 'x');
  const withLayout = { ...a, params: { ...a.params, layoutState: { pages: 1 } } };
  const [moved] = transform([withLayout], insert(0, 'y'), 'right');
  expect(moved.params.layoutState).toBeUndefined();
});

test('concurrent renames: the winner names the doc', () => {
  expect(merge(rename('A'), rename('B')).doc.title).toBe('A');
  expect(transform(rename('A'), rename('B'), 'right')).toEqual([]);
});

test('a rename and a text edit are independent', () => {
  expect(transform(rename('A'), insert(0, 'x'), 'right')).toEqual(rename('A'));
  merge(rename('A'), insert(0, 'x'));
});

test('a drawing inserted beside a concurrent delete keeps its anchor and data', () => {
  const drawing = docDrawingInsert(new Replica(document), 4, random(7));
  const { doc } = merge(drawing, remove(0, 3));
  expect(doc.drawingsOrder).toHaveLength(1);
});

// Bounded by its seeds, not by time, so the clock is off (a timeout of 0), as
// in cells.test.ts: it took 6.9 s on CI (2026-10-23).
test('docs converge across two clients', () => {
  convergesOver(docEdit, { seeds: 30, document });
}, 0);
