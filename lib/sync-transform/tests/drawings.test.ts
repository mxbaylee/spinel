import { DrawingTypeEnum } from '@univerjs/core';
import { ISheetDrawingService } from '@univerjs/sheets-drawing';
import { expect, test } from 'vitest';
import { transform } from '../index.ts';
import type { Mutation } from '../index.ts';
import { drawingIds } from '../src/drawings.ts';
import { seededWorkbook, withStructure } from './generate.ts';
import { drawingEdit } from './generate-drawings.ts';
import { removeSheet } from './edits.ts';
import { converges, Replica } from './harness.ts';
import { convergesOver } from './simulate.ts';

const target = { unitId: 'wb', subUnitId: 's1' };
const image = (drawingId: string, left = 0) => ({
  ...target,
  drawingId,
  drawingType: DrawingTypeEnum.DRAWING_IMAGE,
  imageSourceType: 'URL',
  source: `https://example.com/${drawingId}.png`,
  transform: { left, top: 0, width: 50, height: 50 },
});

const service = (replica: Replica) => replica.injector.get(ISheetDrawingService);
const mutation = (type: number, result: unknown): Mutation => {
  const { redo, objects } = result as { redo: unknown; objects: unknown };
  return { id: drawingIds.apply, params: { ...target, op: redo, objects, type } };
};
const insert = (replica: Replica, id: string) =>
  mutation(0, service(replica).getBatchAddOp([image(id) as never]));
const remove = (replica: Replica, id: string) =>
  mutation(1, service(replica).getBatchRemoveOp([{ ...target, drawingId: id }]));
const move = (replica: Replica, id: string, left: number) =>
  mutation(2, service(replica).getBatchUpdateOp([image(id, left) as never]));
const toFront = (replica: Replica, id: string) =>
  mutation(3, service(replica).getFrontDrawingsOp({ ...target, drawingIds: [id] }));

/** A replica whose sheet s1 holds drawings `a` and `b`. */
function start() {
  const replica = new Replica({ workbook: seededWorkbook() });
  replica.apply([insert(replica, 'a')]);
  replica.apply([insert(replica, 'b')]);
  return replica;
}

/** Builds both edits from one state, then merges them in both orders. */
function merge(make: (replica: Replica) => [Mutation, Mutation]) {
  const [a, b] = make(start());
  const replay = (first: Mutation, second: Mutation[]) => {
    const replica = start();
    replica.apply([first, ...second]);
    return replica.snapshot();
  };
  const left = replay(b, transform([a], [b], 'left'));
  expect(replay(a, transform([b], [a], 'right'))).toEqual(left);
  return (left as { drawings: Record<string, { data: Record<string, any>; order: string[] }> })
    .drawings.s1;
}

test('concurrent inserts both land, the winner first', () => {
  const sheet = merge((r) => [insert(r, 'x'), insert(r, 'y')]);
  expect(sheet.order).toEqual(['a', 'b', 'x', 'y']);
});

test('a move of a concurrently removed drawing vanishes', () => {
  const sheet = merge((r) => [move(r, 'a', 99), remove(r, 'a')]);
  expect(sheet.order).toEqual(['b']);
  expect(sheet.data.a).toBeUndefined();
});

test('removing the same drawing twice removes it once', () => {
  const removal = remove(start(), 'a');
  expect(transform([removal], [removal], 'right')).toEqual([]);
  expect(merge((r) => [remove(r, 'a'), remove(r, 'a')]).order).toEqual(['b']);
});

test('a sheet removal and a concurrent removal of a drawing on it converge', () => {
  const replica = new Replica({ workbook: seededWorkbook() });
  const setup = ['a', 'b'].map((id) => {
    const add = insert(replica, id);
    replica.apply([add]);
    return add;
  });
  // As RemoveSheetCommand sends it: the sheet, then the drawings on it.
  const drawingsOf = [
    { ...target, drawingId: 'a' },
    { ...target, drawingId: 'b' },
  ];
  const sheetRemoval = [
    removeSheet('s1', 'One', 0),
    mutation(1, service(replica).getBatchRemoveOp(drawingsOf)),
  ];
  for (const side of ['left', 'right'] as const) {
    const result = converges(sheetRemoval, remove(replica, 'a'), { side, setup });
    expect(result.workbook.sheetOrder).toEqual(['s2']);
  }
});

test('two moves of one drawing: the winner places it', () => {
  expect(merge((r) => [move(r, 'a', 10), move(r, 'a', 20)]).data.a.transform.left).toBe(10);
});

test('z-order changes and removals merge', () => {
  expect(merge((r) => [toFront(r, 'a'), remove(r, 'b')]).order).toEqual(['a']);
  expect(merge((r) => [toFront(r, 'a'), insert(r, 'x')]).order).toEqual(['b', 'a', 'x']);
});

test('concurrent background images: the winner stands', () => {
  const set = (source: string): Mutation[] => [
    {
      id: drawingIds.backgroundImage,
      params: { ...target, backgroundImage: { source, imageSourceType: 'URL' } },
    },
  ];
  expect(transform(set('a'), set('b'), 'left')).toEqual(set('a'));
  expect(transform(set('a'), set('b'), 'right')).toEqual([]);
});

test('a row insert leaves drawing edits unchanged', () => {
  const replica = new Replica({ workbook: seededWorkbook() });
  const drawing = insert(replica, 'a');
  const row: Mutation = {
    id: 'sheet.mutation.insert-row',
    params: { ...target, range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 } },
  };
  expect(transform([drawing], [row], 'right')).toEqual([drawing]);
});

test('sheet drawings converge with concurrent structure edits', () => {
  convergesOver(withStructure(drawingEdit), { seeds: 30 });
}, 300_000);
