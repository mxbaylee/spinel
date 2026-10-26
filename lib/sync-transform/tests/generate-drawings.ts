import { DrawingTypeEnum } from '@univerjs/core';
import { DrawingApplyType, ISheetDrawingService } from '@univerjs/sheets-drawing';
import type { Mutation } from '../index.ts';
import { drawingIds } from '../src/drawings.ts';
import { pick, randomSheet } from './generate.ts';
import type { Generate } from './simulate.ts';

const cell = (row: number, column: number) => ({ row, rowOffset: 0, column, columnOffset: 0 });

function placement(row: number, column: number) {
  const anchor = { from: cell(row, column), to: cell(row + 2, column + 1) };
  return {
    transform: { left: column * 88, top: row * 20, width: 88, height: 40, angle: 0 },
    sheetTransform: anchor,
    axisAlignSheetTransform: anchor,
  };
}

/**
 * Sheet drawing inserts, removes, moves and z-order changes, with ops from
 * the drawing service's own builders as Univer's drawing commands make them,
 * and background image changes.
 */
export const drawingEdit: Generate = (replica, next) => {
  const unitId = replica.workbook()!.getUnitId();
  const sheet = randomSheet(replica, next);
  const subUnitId = sheet.getSheetId();
  const service = replica.injector.get(ISheetDrawingService);
  const ids = service.getDrawingOrder(unitId, subUnitId);
  // The service interface types its op builders' results as `unknown`.
  const apply = (type: number, result: unknown): Mutation[] | null => {
    const { redo, objects } = result as { redo: unknown; objects: unknown };
    return redo
      ? [{ id: drawingIds.apply, params: { unitId, subUnitId, op: redo, objects, type } }]
      : null;
  };
  const kind = next() % 10;
  if (kind === 0) {
    const image =
      next() % 3 === 0
        ? null
        : { source: `https://example.com/bg${next() % 9}.png`, imageSourceType: 'URL' };
    return [
      { id: drawingIds.backgroundImage, params: { unitId, subUnitId, backgroundImage: image } },
    ];
  }
  if (kind <= 3 || ids.length === 0) {
    const drawingId = `g${next() % 1e9}`;
    const row = next() % Math.max(1, sheet.getRowCount() - 2);
    const column = next() % Math.max(1, sheet.getColumnCount() - 1);
    const drawing = {
      unitId,
      subUnitId,
      drawingId,
      drawingType: DrawingTypeEnum.DRAWING_IMAGE,
      imageSourceType: 'URL',
      source: `https://example.com/${drawingId}.png`,
      ...placement(row, column),
    };
    return apply(DrawingApplyType.INSERT, service.getBatchAddOp([drawing as never]));
  }
  const drawingId = pick(next, ids);
  const target = { unitId, subUnitId, drawingId };
  if (kind === 4) return apply(DrawingApplyType.REMOVE, service.getBatchRemoveOp([target]));
  if (kind <= 7) {
    // As SetSheetDrawingCommand after a drag: new pixel and cell placement.
    const update = { ...target, ...placement(next() % 10, next() % 5) };
    return apply(DrawingApplyType.UPDATE, service.getBatchUpdateOp([update as never]));
  }
  const order = { unitId, subUnitId, drawingIds: [drawingId] };
  const arrange = pick(next, [
    () => service.getForwardDrawingsOp(order),
    () => service.getBackwardDrawingOp(order),
    () => service.getFrontDrawingsOp(order),
    () => service.getBackDrawingsOp(order),
  ]);
  return apply(DrawingApplyType.ARRANGE, arrange());
};
