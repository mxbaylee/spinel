import {
  DrawingTypeEnum,
  ICommandService,
  IUniverInstanceService,
  LocaleService,
  LocaleType,
} from '@univerjs/core';
import {
  convertPositionCellToSheetOverGrid,
  RemoveColByRangeCommand,
  SetColWidthCommand,
  SetRowHeightCommand,
  SheetSkeletonService,
} from '@univerjs/sheets';
import {
  applySheetDrawingPlacement,
  InsertSheetDrawingCommand,
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
import { nativeSession } from './native-session.ts';
import type { NativePeer } from './native-session.ts';

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

test.each([0, 1].flatMap((first) => [0, 20].map((offset) => ({ first, offset }))))(
  'concurrent insertion and removal produce native collapsed geometry ($first first, $offset offset)',
  async ({ first, offset }) => {
    const source = book();
    source.sheets.one.columnCount = 4;
    source.sheets.one.defaultColumnWidth = 88;
    source.sheets.one.defaultRowHeight = 20;
    const f = nativeSession(source, 'sheet');
    const target = { unitId: 'book', subUnitId: 'one' };
    const remove = { ...target, range: { startRow: 0, endRow: 11, startColumn: 0, endColumn: 0 } };
    const drawing = (peer: NativePeer) =>
      peer.live.univer.__getInjector().get(ISheetDrawingService).getDrawingData('book', 'one')
        .image;
    try {
      const peers = [f.client('image-author'), f.client('column-author')];
      const [sender, receiver] = peers;
      await turns();
      for (const peer of peers)
        peer.commands.syncExecuteCommand('sheet.operation.set-worksheet-active', target);
      const skeleton = sender.live.univer
        .__getInjector()
        .get(SheetSkeletonService)
        .ensureSkeleton('book', 'one')!;
      skeleton.calculate();
      // Keep both endpoints one pixel inside their cells so the native
      // conversion has unambiguous, initially in-bounds cell indices.
      const geometry = convertPositionCellToSheetOverGrid(
        'book',
        'one',
        { row: 0, column: 2, rowOffset: 1, columnOffset: 1 + offset },
        88 - offset,
        40,
        skeleton,
      );
      expect(geometry.sheetTransform.from.column).toBe(2);
      expect(geometry.sheetTransform.to.column).toBe(3);
      expect(geometry.transform.width).toBeGreaterThan(0);
      expect(
        await sender.commands.executeCommand(InsertSheetDrawingCommand.id, {
          drawings: [
            {
              ...geometry,
              drawingId: 'image',
              drawingType: DrawingTypeEnum.DRAWING_IMAGE,
              imageSourceType: 'URL',
              source: '/images/example.png',
              anchorType: SheetDrawingAnchorType.Position,
              axisAlignSheetTransform: geometry.sheetTransform,
            },
          ],
        }),
      ).toBe(true);
      expect(await receiver.commands.executeCommand(RemoveColByRangeCommand.id, remove)).toBe(true);
      const requests = [await f.request(sender), await f.request(receiver)];
      expect(requests[0].baseRevision).toBe(requests[1].baseRevision);
      expect(
        requests[0].mutations.some(
          (mutation) => mutation.id === 'sheet.mutation.set-drawing-apply',
        ),
      ).toBe(true);
      expect(
        requests[1].mutations.some(
          (mutation) => mutation.id === 'sheet.mutation.set-drawing-apply',
        ),
      ).toBe(false);
      const second = 1 - first;
      const acceptedFirst = await f.submit(peers[first], requests[first]);
      await f.acknowledge(peers[first], acceptedFirst);
      const acceptedSecond = await f.submit(peers[second], requests[second]);
      await f.acknowledge(peers[second], acceptedSecond);
      peers[first].sync.receive({ type: 'edit', ...wire(acceptedSecond.edit) });
      await turns();
      for (const peer of peers) {
        expect(peer.failures).toEqual([]);
        expect(peer.sync.state).toMatchObject({ pending: false, resyncing: false, revision: 3 });
        expect((peer.live.snapshot() as ReturnType<typeof book>).sheets.one.columnCount).toBe(3);
        expect(drawing(peer).transform?.width).toBe(88 - offset);
        expect(drawing(peer).sheetTransform.from.column).toBe(2);
        expect(drawing(peer).sheetTransform.to.column).toBe(3);
      }

      // Concurrently created drawings retain their sender's anchors. The first
      // deletion therefore leaves a positive drawing beyond the shortened
      // sheet. The next native deletion maps its endpoints to columns 1 and 2;
      // native geometry clamps both to the final existing column, producing
      // width 0 or -20 without a hand-authored collapsed drawing mutation.
      const queued: ReturnType<typeof wire>[] = [];
      async function send(command: string, params: object) {
        expect(await sender.commands.executeCommand(command, { ...target, ...params })).toBe(true);
        const request = await f.request(sender);
        const accepted = await f.submit(sender, request);
        await f.acknowledge(sender, accepted);
        queued.push(wire(accepted.edit));
        return request;
      }
      const collapsing = await send(RemoveColByRangeCommand.id, remove);
      expect(
        collapsing.mutations.some((mutation) => mutation.id === 'sheet.mutation.set-drawing-apply'),
      ).toBe(true);
      const width = offset === 0 ? 0 : -offset;
      expect(drawing(sender).transform?.width).toBe(width);
      expect(drawing(sender).drawingId).toBe('image');
      expect(drawing(receiver).transform?.width).toBe(88 - offset);
      await send(SetRowHeightCommand.id, {
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }],
        value: 35,
      });
      await send(SetColWidthCommand.id, {
        ranges: [{ startRow: 0, endRow: 11, startColumn: 1, endColumn: 1 }],
        value: 100,
      });
      await send('sheet.command.insert-row-by-range', {
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
        direction: 0,
      });
      await send('sheet.command.set-range-values', {
        range: { startRow: 4, endRow: 4, startColumn: 1, endColumn: 1 },
        value: { v: 'after-native-collapse' },
      });
      expect(queued).toHaveLength(5);
      for (const edit of queued) receiver.sync.receive({ type: 'edit', ...edit });
      for (let index = 0; index < queued.length; index++) await turns();
      for (const peer of peers) {
        expect(peer.failures).toEqual([]);
        expect(peer.sync.state).toMatchObject({
          pending: false,
          resyncing: false,
          revision: f.storage.unit.revision,
        });
        expect(drawing(peer).transform?.width).toBe(width);
        expect(drawingSnapshot(peer.live.snapshot())).toEqual(
          drawingSnapshot(f.storage.unit.snapshot),
        );
      }
      const reopened = new NativeReplica(
        JSON.parse(JSON.stringify(f.storage.unit.snapshot)),
        'sheet',
      );
      try {
        expect(drawingSnapshot(reopened.snapshot())).toEqual(
          drawingSnapshot(receiver.live.snapshot()),
        );
        const saved = reopened.univer
          .__getInjector()
          .get(ISheetDrawingService)
          .getDrawingData('book', 'one').image;
        expect(saved).toMatchObject({ drawingId: 'image', transform: { width, height: 40 } });
        expect(
          (reopened.snapshot() as ReturnType<typeof book>).sheets.one.cellData?.[4]?.[1]?.v,
        ).toBe('after-native-collapse');
      } finally {
        reopened.dispose();
      }
    } finally {
      f.close();
    }
  },
);
