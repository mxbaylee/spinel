import {
  BuildTextUtils,
  CustomRangeType,
  DocumentDataModel,
  JSON1,
  JSONX,
  TextX,
  TextXActionType,
} from '@univerjs/core';
import type { IDocumentBody, IParagraph, TextXAction } from '@univerjs/core';
import { expect, test } from 'vitest';
import { docFormulas } from '@spinel/doc-formulas';
import { transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { docIds } from '../src/docs.ts';
import {
  docDrawingInsert,
  docEdit,
  docFormulaInsert,
  seededDoc,
  textStyleEdit,
} from './generate-docs.ts';
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

const style = (at: number, len: number, ts: Record<string, unknown>, coverType = 0) =>
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

test('replacement ownership includes false, empty strings, null and zero without clearing peer keys', () => {
  for (const [key, value, competing] of [
    ['hidden', false, true],
    ['ff', '', 'Arial'],
    ['fs', 0, 14],
    ['bl', null, 1],
  ] as const) {
    const replaced = style(6, 4, { [key]: value }, 1);
    const covered = style(8, 5, { [key]: competing, it: 1 });
    const first = merge(replaced, covered).doc.body.textRuns;
    expect(first).toContainEqual({ st: 8, ed: 10, ts: { [key]: value, it: 1 } });
    expect(first).toContainEqual({ st: 10, ed: 13, ts: { [key]: competing, it: 1 } });
    expect(merge(covered, replaced).doc.body.textRuns).toContainEqual({
      st: 8,
      ed: 13,
      ts: { [key]: competing, it: 1 },
    });
  }
});

test('replacement style ownership follows text positions after peer inserts and deletes', () => {
  const replacement = edit(
    JSONX.getInstance().editOp([
      { t: TextXActionType.INSERT, len: 2, body: { dataStream: 'zz' } },
      { t: TextXActionType.DELETE, len: 1 },
      { t: TextXActionType.RETAIN, len: 5 },
      {
        t: TextXActionType.RETAIN,
        len: 4,
        body: { dataStream: '', textRuns: [{ st: 0, ed: 4, ts: { bl: 0 } }] },
        coverType: 1,
      },
    ]),
  );
  const { doc } = merge(replacement, style(8, 5, { bl: 1, it: 1 }));
  expect(doc.body.textRuns).toContainEqual({ st: 9, ed: 11, ts: { bl: 0, it: 1 } });
  expect(doc.body.dataStream.startsWith('zzlpha ')).toBe(true);
});

test('an explicit paragraph replacement clear survives slices around a concurrent insert', () => {
  const clear = edit(
    JSONX.getInstance().editOp([
      {
        t: TextXActionType.RETAIN,
        len: 4,
        body: { dataStream: '', paragraphs: [] },
        coverType: 1,
      },
    ]),
  );
  const inserted = insert(2, 'x');
  const initial: IDocumentBody = {
    dataStream: 'a\rb\r\n',
    paragraphs: [
      { startIndex: 1, paragraphId: 'first' },
      { startIndex: 3, paragraphId: 'second' },
    ],
  };
  const apply = (steps: Mutation[]) =>
    steps.reduce((body, step) => {
      const [, component] = step.params.actions as [string, { e: TextXAction[] }];
      return TextX.apply(body, structuredClone(component.e));
    }, structuredClone(initial));
  const transformedClear = transform(clear, inserted, 'left');
  for (const step of transformedClear) {
    const [, component] = step.params.actions as [string, { e: TextXAction[] }];
    for (const action of component.e)
      if (action.body) expect(action.body).not.toHaveProperty('customDecorations');
  }
  const afterInsert = apply([...inserted, ...transformedClear]);
  const afterClear = apply([...clear, ...transform(inserted, clear, 'right')]);
  expect(afterInsert).toEqual(afterClear);
  expect(afterInsert.dataStream).toBe('a\rxb\r\n');
  expect(afterInsert.paragraphs).toEqual([]);
  expect(transform(clear, clear, 'left')).toEqual([]);
  expect(transform(clear, clear, 'right')).toEqual([]);
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

// The native compatibility adapter keeps link ranges canonical after stock
// mutations, including a style whose edges fall inside the link.
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

test('paragraph slicing markers preserve real decoration writes and sender-authored clears', () => {
  const decoration = (at: number, id: string) =>
    edit(
      JSONX.getInstance().editOp([
        ...retain(at),
        {
          t: TextXActionType.RETAIN,
          len: 1,
          body: {
            dataStream: '',
            customDecorations: [{ id, type: 0, startIndex: 0, endIndex: 0 }],
          },
        },
      ]),
    );
  const paragraph = covers(16, { paragraphId: 'p1', paragraphStyle: {} }, 1);
  for (const [a, b] of [
    [[...paragraph, ...decoration(1, 'first')], decoration(8, 'second')],
    [decoration(8, 'second'), [...paragraph, ...decoration(1, 'first')]],
  ]) {
    expect(merge(a!, b!).doc.body.customDecorations).toEqual([
      { id: 'first', type: 0, startIndex: 1, endIndex: 1 },
      { id: 'second', type: 0, startIndex: 8, endIndex: 8 },
    ]);
  }

  // A sender's actual empty decoration list is not an internal marker.
  const authoredClear = edit(
    JSONX.getInstance().editOp([
      {
        t: TextXActionType.RETAIN,
        len: 4,
        coverType: 1,
        body: { dataStream: '', paragraphs: [], customDecorations: [] },
      },
    ]),
  );
  for (const step of transform(authoredClear, insert(2, 'x'), 'left')) {
    const [, component] = step.params.actions as [string, { e: TextXAction[] }];
    for (const action of component.e)
      if (action.body) expect(action.body.customDecorations).toEqual([]);
  }
});

test('an uncaptured combined paragraph and decoration replacement retains stock per-order behavior', () => {
  // Spinel has no comment plugin or captured producer for this combined
  // REPLACE. Stock apply implicitly clears decorations even when the field is
  // absent, while stock transform treats absence as no write. The retired core
  // patch did not change either rule. Preserve this negative control without
  // claiming convergence, and prove the paragraph marker does not alter it.
  const decorated = edit(
    JSONX.getInstance().editOp([
      ...retain(16),
      {
        ...cover({ paragraphId: 'p1', paragraphStyle: {} }, 1),
        body: {
          dataStream: '',
          paragraphs: [{ startIndex: 0, paragraphId: 'p1', paragraphStyle: {} }],
          customDecorations: [{ id: 'first', type: 0, startIndex: 0, endIndex: 0 }],
        },
      },
    ]),
  );
  const plain = covers(16, { paragraphId: 'p1', paragraphStyle: {} }, 1);
  type Actions = Parameters<DocumentDataModel['apply']>[0];
  type Op = Parameters<typeof JSON1.type.transformNoConflict>[0];
  const apply = (first: unknown, second: unknown) => {
    const model = new DocumentDataModel(structuredClone(document.doc));
    model.apply(first as Actions);
    model.apply(second as Actions);
    return model.getSnapshot().body!;
  };
  const comment = [{ id: 'first', type: 0, startIndex: 16, endIndex: 16 }];
  for (const [a, b] of [
    [decorated, plain],
    [plain, decorated],
  ]) {
    const own = a![0].params.actions;
    const peer = b![0].params.actions;
    const stockLeft = JSON1.type.transformNoConflict(own as Op, peer as Op, 'left');
    const stockRight = JSON1.type.transformNoConflict(peer as Op, own as Op, 'right');
    const adaptedLeft = transform(a!, b!, 'left')[0].params.actions;
    const adaptedRight = transform(b!, a!, 'right')[0].params.actions;
    expect(adaptedLeft).toEqual(stockLeft);
    expect(adaptedRight).toEqual(stockRight);
    const left = apply(peer, stockLeft);
    const right = apply(own, stockRight);
    expect(left.customDecorations).toEqual(a === decorated ? comment : []);
    expect(right.customDecorations).toEqual(a === decorated ? [] : comment);
    expect(apply(peer, adaptedLeft)).toEqual(left);
    expect(apply(own, adaptedRight)).toEqual(right);
  }
});

test('native paragraph style replacements retain the first-accepted style without inventing a bullet', () => {
  const nativeStyle = (style: NonNullable<IParagraph['paragraphStyle']>) => {
    const model = new DocumentDataModel(structuredClone(document.doc));
    const textX = BuildTextUtils.paragraph.style.set({
      document: model,
      textRanges: [{ startOffset: 0, endOffset: 16, collapsed: false }],
      style,
    });
    return edit(JSONX.getInstance().editOp(textX.serialize()));
  };
  // Native paragraph style producers replace a whole paragraph style. A
  // paragraph COVER only comes from deleting a list item and carries its
  // bullet; a hand-written COVER without that bullet invents a default list
  // in stock apply and is not a paragraph style command's output. Arbitrary
  // COVER/COVER paragraph-style truthiness remains an upstream limitation.
  const clearedStyle = { outlineLevel: 0 };
  const styledStyle = { outlineLevel: 1, indentStart: { v: 10 } };
  const cleared = nativeStyle(clearedStyle);
  const styled = nativeStyle(styledStyle);
  const cases: [Mutation[], Mutation[], IParagraph['paragraphStyle']][] = [
    [cleared, styled, clearedStyle],
    [styled, cleared, styledStyle],
  ];
  for (const [a, b, paragraphStyle] of cases) {
    const { doc } = merge(a, b);
    expect(doc.body.paragraphs.find((entry: IParagraph) => entry.startIndex === 16)).toEqual({
      startIndex: 16,
      paragraphId: 'p1',
      paragraphStyle,
    });
  }
});

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

// Text-run styles with every ITextStyle key left out, null, falsy or set,
// merged in or replacing, among the edits above. Unclocked, as above.
test('docs converge with schema text styles across two clients', () => {
  convergesOver(textStyleEdit, { seeds: 30, document });
}, 0);
