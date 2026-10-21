import { JSONX, TextXActionType } from '@univerjs/core';
import type { TextXAction } from '@univerjs/core';
import { expect, test } from 'vitest';
import { transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { docIds } from '../src/docs.ts';
import { docDrawingInsert, docEdit, seededDoc } from './generate-docs.ts';
import { Replica } from './harness.ts';
import { random } from './random.ts';
import { convergesOver } from './simulate.ts';

const document = { doc: seededDoc() };

/** Applies `b` then `a` past it on one replica, `a` then `b` past it on another. */
function merge(a: Mutation[], b: Mutation[]) {
  const left = new Replica(document);
  left.apply(b);
  left.apply(transform(a, b, 'left'));
  const right = new Replica(document);
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

const bold = (at: number, len: number) =>
  edit(
    JSONX.getInstance().editOp([
      ...retain(at),
      {
        t: TextXActionType.RETAIN,
        len,
        body: { dataStream: '', textRuns: [{ st: 0, ed: len, ts: { bl: 1 } }] },
        coverType: 0,
      },
    ]),
  );

test('one style applied to overlapping ranges covers their union on both sides', () => {
  const { doc } = merge(bold(6, 4), bold(8, 5));
  expect(doc.body.textRuns).toContainEqual({ st: 6, ed: 13, ts: { bl: 1 } });
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

test('docs converge across two clients', () => {
  convergesOver(docEdit, { seeds: 30, document });
});
