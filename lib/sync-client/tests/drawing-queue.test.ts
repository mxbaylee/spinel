import {
  DrawingTypeEnum,
  ICommandService,
  IUniverInstanceService,
  LocaleService,
  LocaleType,
} from '@univerjs/core';
import { SetColWidthCommand, SetRowHeightCommand } from '@univerjs/sheets';
import {
  applySheetDrawingPlacement,
  ISheetDrawingService,
  SetSheetDrawingPlacementCommand,
  SheetDrawingAnchorType,
} from '@univerjs/sheets-drawing';
import type { IDrawingJsonUndo1 } from '@univerjs/drawing';
import { expect, test } from 'vitest';
import { captureNative, NativeReplica } from '../index.ts';
import type { NativeSnapshot } from '../index.ts';
import type { Mutation } from '@spinel/sync-transform';
import { book, comparable, fixture, turns, wire } from './fixture.ts';

function drawingSnapshot(snapshot: NativeSnapshot) {
  const value = comparable(snapshot) as NativeSnapshot;
  return {
    ...value,
    resources: value.resources?.map((resource) => ({
      ...resource,
      // The resource is native JSON; compare all fields without treating
      // equivalent object-key order as different drawing content.
      data: resource.name === 'SHEET_DRAWING_PLUGIN' ? JSON.parse(resource.data) : resource.data,
    })),
  };
}

test.each([0, 20])(
  'a retained collapsed drawing survives later native row and column edits (%s offset)',
  async (offset) => {
    const source = book();
    source.sheets.one.defaultColumnWidth = 88;
    source.sheets.one.defaultRowHeight = 20;
    const seed = new NativeReplica(source, 'sheet');
    const service = seed.univer.__getInjector().get(ISheetDrawingService);
    const anchor = {
      from: { row: 0, column: 0, rowOffset: 0, columnOffset: offset },
      to: { row: 2, column: 1, rowOffset: 0, columnOffset: 0 },
    };
    const added = service.getBatchAddOp([
      {
        unitId: 'book',
        subUnitId: 'one',
        drawingId: 'image',
        drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        imageSourceType: 'URL',
        source: '/images/example.png',
        anchorType: SheetDrawingAnchorType.Position,
        sheetTransform: anchor,
        axisAlignSheetTransform: anchor,
        // Pin the retained state explicitly; this fixture proves subsequent
        // native edits and remote delivery, not the command that collapsed it.
        transform: {
          left: offset,
          top: 0,
          width: offset === 0 ? 0 : -offset,
          height: 40,
          angle: 0,
        },
      } as never,
    ]) as IDrawingJsonUndo1;
    seed.apply([
      {
        id: 'sheet.mutation.set-drawing-apply',
        params: {
          unitId: 'book',
          subUnitId: 'one',
          op: added.redo,
          objects: added.objects,
          type: 0,
        },
      },
    ]);
    const f = fixture(seed.snapshot(), 'sheet');
    seed.dispose();
    const sender = new NativeReplica(f.storage.unit.snapshot, 'sheet');
    const receiver = f.client();
    receiver.resume();
    await turns();
    const mutations: Mutation[] = [];
    const capture = captureNative({
      univer: sender.univer,
      unitId: 'book',
      onMutation: (mutation) => mutations.push(mutation),
      onFailure: (failure) => {
        throw new Error(failure);
      },
    });
    const commands = sender.univer.__getInjector().get(ICommandService);
    sender.univer
      .__getInjector()
      .get(LocaleService)
      .load({ [LocaleType.EN_US]: {} });
    sender.univer.__getInjector().get(IUniverInstanceService).focusUnit('book');
    commands.syncExecuteCommand('sheet.operation.set-worksheet-active', {
      unitId: 'book',
      subUnitId: 'one',
    });
    let ordinal = 0;
    const edits: ReturnType<typeof wire>[] = [];
    async function send(command: string, params: object) {
      mutations.length = 0;
      expect(
        await commands.executeCommand(command, { unitId: 'book', subUnitId: 'one', ...params }),
      ).toBe(true);
      expect(mutations.length).toBeGreaterThan(0);
      const result = await f.accept({
        type: 'submit',
        mutationId: `00000000-0000-4000-8000-${String(++ordinal).padStart(12, '0')}`,
        baseRevision: f.storage.unit.revision,
        mutations: structuredClone(mutations),
      });
      edits.push(wire(result.edit));
    }
    try {
      await send('sheet.command.remove-col-by-range', {
        range: { startRow: 0, endRow: 11, startColumn: 0, endColumn: 0 },
      });
      const drawing = sender.univer
        .__getInjector()
        .get(ISheetDrawingService)
        .getDrawingData('book', 'one').image;
      expect(drawing.transform?.width).toBe(offset === 0 ? 0 : -offset);
      const placement = {
        kind: SheetDrawingAnchorType.Position as const,
        from: drawing.sheetTransform.from,
        width: offset === 0 ? 0 : -offset,
        height: 40,
      };
      expect(() => applySheetDrawingPlacement(drawing, placement)).toThrow(
        'SHEET_DRAWING_PLACEMENT_EXTENT_INVALID',
      );
      const beforeInvalidPlacement = drawingSnapshot(sender.snapshot());
      const capturedCount = mutations.length;
      await expect(
        commands.executeCommand(SetSheetDrawingPlacementCommand.id, {
          unitId: 'book',
          subUnitId: 'one',
          drawings: [{ drawingId: 'image', placement }],
        }),
      ).rejects.toThrow('SHEET_DRAWING_PLACEMENT_EXTENT_INVALID');
      expect(mutations).toHaveLength(capturedCount);
      expect(drawingSnapshot(sender.snapshot())).toEqual(beforeInvalidPlacement);
      // Existing finite collapsed geometry must survive native layout refreshes;
      // the explicit placement command still rejects newly requested invalid sizes.
      await send(SetRowHeightCommand.id, {
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 }],
        value: 35,
      });
      await send(SetColWidthCommand.id, {
        ranges: [{ startRow: 0, endRow: 11, startColumn: 0, endColumn: 0 }],
        value: 100,
      });
      await send('sheet.command.insert-row-by-range', {
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 },
        direction: 0,
      });
      await send('sheet.command.set-range-values', {
        range: { startRow: 4, endRow: 4, startColumn: 2, endColumn: 2 },
        value: { v: 'after-collapse' },
      });
      // Deliver the whole remote burst before the asynchronous client queue
      // drains, including a cell write after every structural drawing refresh.
      expect(edits).toHaveLength(5);
      for (const edit of edits) receiver.sync.receive({ type: 'edit', ...edit });
      for (let index = 0; index < edits.length; index++) await turns();
      expect(receiver.failures).toEqual([]);
      expect(receiver.sync.confirmedRevision).toBe(f.storage.unit.revision);
      expect(drawingSnapshot(sender.snapshot())).toEqual(drawingSnapshot(f.storage.unit.snapshot));
      expect(drawingSnapshot(receiver.live.snapshot())).toEqual(
        drawingSnapshot(f.storage.unit.snapshot),
      );
      const reopened = new NativeReplica(
        JSON.parse(JSON.stringify(f.storage.unit.snapshot)),
        'sheet',
      );
      try {
        expect(drawingSnapshot(reopened.snapshot())).toEqual(
          drawingSnapshot(receiver.live.snapshot()),
        );
        expect(
          (reopened.snapshot() as ReturnType<typeof book>).sheets.one.cellData?.[4]?.[2]?.v,
        ).toBe('after-collapse');
        const reopenedDrawing = reopened.univer
          .__getInjector()
          .get(ISheetDrawingService)
          .getDrawingData('book', 'one').image;
        expect(reopenedDrawing.drawingId).toBe('image');
        expect(reopenedDrawing.transform?.width).toBe(offset === 0 ? 0 : -offset);
        expect(reopenedDrawing.transform?.height).toBe(40);
      } finally {
        reopened.dispose();
      }
    } finally {
      capture.dispose();
      sender.dispose();
      f.close();
    }
  },
);
