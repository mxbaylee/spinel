import {
  CommandType,
  DrawingTypeEnum,
  ICommandService,
  IUndoRedoService,
  IUniverInstanceService,
  JSONX,
  LocaleService,
  LocaleType,
  PRESERVE_INSERTED_PARAGRAPH_IDS,
  TextX,
  UniverInstanceType,
} from '@univerjs/core';
import type { DocumentDataModel, Workbook } from '@univerjs/core';
import {
  ClearSheetDrawingTransformerOperation,
  ISheetDrawingService,
} from '@univerjs/sheets-drawing';
import { ClearDocDrawingTransformerOperation } from '@univerjs/docs-drawing-ui';
import type { IDrawingJsonUndo1 } from '@univerjs/drawing';
import { expect, test, vi } from 'vitest';
import { transform } from '@spinel/sync-transform';
import type { Mutation } from '@spinel/sync-transform';
import { captureNative, createNativeSyncClient, NativeReplica } from '../index.ts';
import type { ClientFailure, OutgoingFrame, SubmitFrame } from '../index.ts';
import { book, comparable, doc, fixture, turns, wire, write } from './fixture.ts';

function capture(replica: NativeReplica, unitId: string) {
  const mutations: Mutation[] = [];
  const failures: ClientFailure[] = [];
  const handle = captureNative({
    univer: replica.univer,
    unitId,
    onMutation: (mutation) => mutations.push(mutation),
    onFailure: (reason) => failures.push(reason),
  });
  return { mutations, failures, dispose: () => handle.dispose() };
}

test('capture retains syncOnly, ignores local/remote flags, and refuses an unknown operation-shaped mutation', () => {
  const replica = new NativeReplica(book(), 'sheet');
  const commands = replica.univer.__getInjector().get(ICommandService);
  const sink = capture(replica, 'book');
  let unknownApplied = false;
  const unknown = commands.registerCommand({
    id: 'sheet.operation.unknown-write',
    type: CommandType.MUTATION,
    handler() {
      unknownApplied = true;
      return true;
    },
  });
  try {
    for (const options of [{ onlyLocal: true }, { fromCollab: true }, { fromChangeset: true }]) {
      const mutation = write({ v: 'local' });
      commands.syncExecuteCommand(mutation.id, mutation.params, options);
    }
    const sent = write({ v: 'sync-only' });
    commands.syncExecuteCommand(sent.id, sent.params, { syncOnly: true });
    expect(sink.mutations).toEqual([sent]);
    expect(commands.syncExecuteCommand('sheet.operation.unknown-write', { unitId: 'book' })).toBe(
      false,
    );
    expect(unknownApplied).toBe(false);
    expect(sink.failures).toEqual(['unsupported']);
  } finally {
    unknown.dispose();
    sink.dispose();
    replica.dispose();
  }
});

test('worksheet removal records its exact pre-removal position, including native undo', async () => {
  const snapshot = book();
  snapshot.sheetOrder = ['two', 'one'];
  const replica = new NativeReplica(snapshot, 'sheet');
  const sink = capture(replica, 'book');
  const injector = replica.univer.__getInjector();
  const commands = injector.get(ICommandService);
  injector.get(IUniverInstanceService).focusUnit('book');
  injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
  try {
    expect(
      await commands.executeCommand('sheet.command.remove-sheet', {
        unitId: 'book',
        subUnitId: 'one',
      }),
    ).toBe(true);
    expect(
      sink.mutations.find((mutation) => mutation.id === 'sheet.mutation.remove-sheet')?.params
        .index,
    ).toBe(1);
    expect(await commands.executeCommand('univer.command.undo', { unitId: 'book' })).toBe(true);
    expect(sink.mutations.some((mutation) => mutation.id === 'sheet.mutation.insert-sheet')).toBe(
      true,
    );
    expect(sink.failures).toEqual([]);
    expect((replica.snapshot() as ReturnType<typeof book>).sheetOrder).toEqual(['two', 'one']);
  } finally {
    sink.dispose();
    replica.dispose();
  }
});

test('styles are inlined in native slots while custom metadata stays opaque', () => {
  const snapshot = book();
  snapshot.styles = { shared: { bl: 1, bg: { rgb: '#123456' } } };
  const replica = new NativeReplica(snapshot, 'sheet');
  const sink = capture(replica, 'book');
  try {
    const mutation = write({ s: 'shared', custom: { s: 'literal-custom-value' } });
    replica.univer
      .__getInjector()
      .get(ICommandService)
      .syncExecuteCommand(mutation.id, mutation.params);
    expect(sink.mutations[0].params.cellValue[0][0]).toMatchObject({
      s: { bl: 1, bg: { rgb: '#123456' } },
      custom: { s: 'literal-custom-value' },
    });
    expect(sink.failures).toEqual([]);
  } finally {
    sink.dispose();
    replica.dispose();
  }
});

test.each([
  ['sheet.command.insert-range-move-down', 'row', 'insert'],
  ['sheet.command.insert-range-move-right', 'column', 'insert'],
  ['sheet.command.delete-range-move-up', 'row', 'remove'],
  ['sheet.command.delete-range-move-left', 'column', 'remove'],
] as const)('native shift command %s carries its exact range mark', async (command, axis, kind) => {
  const snapshot = book();
  snapshot.sheets.one.cellData = Object.fromEntries(
    Array.from({ length: 6 }, (_, row) => [
      row,
      Object.fromEntries(
        Array.from({ length: 5 }, (_, column) => [column, { v: `${row}:${column}` }]),
      ),
    ]),
  );
  const authoritative = fixture(snapshot);
  const replica = new NativeReplica(authoritative.storage.unit.snapshot, 'sheet');
  const sink = capture(replica, 'book');
  const injector = replica.univer.__getInjector();
  injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
  try {
    expect(
      await injector.get(ICommandService).executeCommand(command, {
        unitId: 'book',
        subUnitId: 'one',
        range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 },
      }),
    ).toBe(true);
    const moved = sink.mutations.find((mutation) => mutation.id === 'sheet.mutation.move-range');
    expect(moved?.params.shift).toEqual({ axis, kind, at: 1, count: 2 });
    expect(moved?.params.trigger).toBe(command);
    expect(sink.failures).toEqual([]);
    const base = new NativeReplica(snapshot, 'sheet');
    try {
      expect(() => transform(sink.mutations, [], 'right', { cells: base.cells() })).not.toThrow();
      await authoritative.accept({
        type: 'submit',
        mutationId: '00000000-0000-4000-8000-000000000001',
        baseRevision: 1,
        mutations: sink.mutations,
      });
      expect(comparable(authoritative.storage.unit.snapshot)).toEqual(
        comparable(replica.snapshot()),
      );
    } finally {
      base.dispose();
      authoritative.close();
    }
  } finally {
    sink.dispose();
    replica.dispose();
  }
});

test('empty source MoveRange remains unmarked', async () => {
  const replica = new NativeReplica(book(), 'sheet');
  const sink = capture(replica, 'book');
  const commands = replica.univer.__getInjector().get(ICommandService);
  try {
    commands.syncExecuteCommand('sheet.mutation.move-range', {
      unitId: 'book',
      from: { subUnitId: 'one', value: {} },
      to: { subUnitId: 'one', value: {} },
      fromRange: { startRow: 5, endRow: 5, startColumn: 0, endColumn: 0 },
      toRange: { startRow: 6, endRow: 6, startColumn: 0, endColumn: 0 },
      trigger: 'sheet.command.insert-range-move-down',
    });
    expect(sink.mutations[0].params.shift).toBeUndefined();
    expect(sink.failures).toEqual([]);
  } finally {
    sink.dispose();
    replica.dispose();
  }
});

test('actual Sheet drawing writes cross capture while its real renderer refresh does not', () => {
  const replica = new NativeReplica(book(), 'sheet');
  const sink = capture(replica, 'book');
  const injector = replica.univer.__getInjector();
  const commands = injector.get(ICommandService);
  try {
    const result = injector.get(ISheetDrawingService).getBatchAddOp([
      {
        unitId: 'book',
        subUnitId: 'one',
        drawingId: 'image',
        drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        imageSourceType: 'URL',
        source: '/images/example.png',
        transform: { left: 0, top: 0, width: 20, height: 20 },
      } as never,
    ]) as IDrawingJsonUndo1;
    commands.syncExecuteCommand('sheet.mutation.set-drawing-apply', {
      unitId: 'book',
      subUnitId: 'one',
      op: result.redo,
      objects: result.objects,
      type: 0,
    });
    const sent = sink.mutations.length;
    const before = replica.snapshot();
    commands.syncExecuteCommand(ClearSheetDrawingTransformerOperation.id, ['book']);
    expect(sent).toBeGreaterThan(0);
    expect(sink.mutations).toHaveLength(sent);
    expect(replica.snapshot()).toEqual(before);
    expect(sink.failures).toEqual([]);
    expect(() =>
      transform([{ id: ClearSheetDrawingTransformerOperation.id, params: {} }], [], 'right'),
    ).toThrow();
  } finally {
    sink.dispose();
    replica.dispose();
  }
});

// The UI story separately exercises actual image insertion/selection. This is
// deliberately the registered public handler boundary, not claimed UI emission.
test('the real registered Doc drawing refresh is excluded by exact ID', () => {
  const replica = new NativeReplica(doc(), 'doc');
  const sink = capture(replica, 'doc');
  const commands = replica.univer.__getInjector().get(ICommandService);
  const registered = commands.registerCommand(ClearDocDrawingTransformerOperation);
  const observed: string[] = [];
  const observation = commands.onMutationExecutedForCollab((info) => observed.push(info.id));
  try {
    const before = replica.snapshot();
    expect(commands.syncExecuteCommand(ClearDocDrawingTransformerOperation.id, ['doc'])).toBe(true);
    expect(observed).toContain(ClearDocDrawingTransformerOperation.id);
    expect(sink.mutations).toEqual([]);
    expect(sink.failures).toEqual([]);
    expect(replica.snapshot()).toEqual(before);
    expect(() =>
      transform([{ id: ClearDocDrawingTransformerOperation.id, params: {} }], [], 'right'),
    ).toThrow();
  } finally {
    observation.dispose();
    registered.dispose();
    sink.dispose();
    replica.dispose();
  }
});

test('native Doc paragraph inserts and undo replay preserve IDs without echo or parameter mutation', async () => {
  const snapshot = doc();
  const local = new NativeReplica(snapshot, 'doc');
  const peer = new NativeReplica(snapshot, 'doc');
  const sink = capture(local, 'doc');
  const echoed = capture(peer, 'doc');
  const injector = local.univer.__getInjector();
  const commands = injector.get(ICommandService);
  injector.get(IUniverInstanceService).focusUnit('doc');
  let applied = 0;
  const replay = () => {
    const outgoing = structuredClone(sink.mutations.slice(applied));
    const immutable = structuredClone(outgoing);
    peer.apply(outgoing);
    expect(outgoing).toEqual(immutable);
    applied = sink.mutations.length;
    expect(comparable(peer.snapshot())).toEqual(comparable(local.snapshot()));
  };
  try {
    expect(
      await commands.executeCommand('doc.command.insert-text', {
        unitId: 'doc',
        segmentId: '',
        range: { startOffset: 2, endOffset: 2, collapsed: true },
        body: { dataStream: 'new\r', paragraphs: [{ startIndex: 3 }] },
        debounce: false,
      }),
    ).toBe(true);
    expect(JSON.stringify(sink.mutations)).toContain(PRESERVE_INSERTED_PARAGRAPH_IDS);
    replay();
    expect(await commands.executeCommand('univer.command.undo', { unitId: 'doc' })).toBe(true);
    replay();
    expect(await commands.executeCommand('univer.command.redo', { unitId: 'doc' })).toBe(true);
    replay();
    const body = injector
      .get(IUniverInstanceService)
      .getUnit<DocumentDataModel>('doc', UniverInstanceType.UNIVER_DOC)!
      .getBody();
    expect(body?.dataStream).toContain('new\r');
    expect(echoed.mutations).toEqual([]);
    expect(sink.failures).toEqual([]);
    expect(echoed.failures).toEqual([]);
  } finally {
    sink.dispose();
    echoed.dispose();
    local.dispose();
    peer.dispose();
  }
});

test('native Sheet cell undo uses the local public history service', async () => {
  const local = new NativeReplica(book(), 'sheet');
  const sink = capture(local, 'book');
  const injector = local.univer.__getInjector();
  const commands = injector.get(ICommandService);
  injector.get(IUniverInstanceService).focusUnit('book');
  injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
  try {
    expect(
      await commands.executeCommand('sheet.command.set-range-values', {
        unitId: 'book',
        subUnitId: 'one',
        range: { startRow: 3, endRow: 3, startColumn: 2, endColumn: 2 },
        value: { v: 42 },
      }),
    ).toBe(true);
    expect(await commands.executeCommand('univer.command.undo', { unitId: 'book' })).toBe(true);
    const workbook = injector
      .get(IUniverInstanceService)
      .getUnit<Workbook>('book', UniverInstanceType.UNIVER_SHEET)!;
    expect(workbook.getSheetBySheetId('one')!.getCellRaw(3, 2)?.v ?? null).toBeNull();
    expect(sink.mutations.length).toBeGreaterThanOrEqual(2);
    expect(sink.mutations.at(-1)?.params.trigger).toBe('univer.command.undo');
    expect(sink.failures).toEqual([]);
  } finally {
    sink.dispose();
    local.dispose();
  }
});

test.each(['sheet', 'doc'] as const)(
  'a remote %s edit invalidates stale native undo, including delayed Doc history',
  async (kind) => {
    const f = fixture(kind === 'sheet' ? book() : doc(), kind);
    const snapshot = f.storage.unit.snapshot;
    const local = new NativeReplica(snapshot, kind);
    const injector = local.univer.__getInjector();
    const commands = injector.get(ICommandService);
    injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
    injector.get(IUniverInstanceService).focusUnit(snapshot.id);
    const outgoing: OutgoingFrame[] = [];
    const failures: ClientFailure[] = [];
    const sync = createNativeSyncClient({
      univer: local.univer,
      unitId: snapshot.id,
      kind,
      snapshot,
      revision: 1,
      send: (frame) => outgoing.push(frame),
      onState() {},
      onResync: (reason) => failures.push(reason),
      batchDelayMs: 100_000,
    });
    vi.useFakeTimers();
    try {
      sync.setConnected(true);
      sync.receive({
        type: 'resume',
        version: 1,
        unitId: snapshot.id,
        fromRevision: 1,
        revision: 1,
        edits: [],
      });
      await turns();
      const command =
        kind === 'sheet' ? 'sheet.command.set-range-values' : 'doc.command.insert-text';
      const params =
        kind === 'sheet'
          ? {
              unitId: 'book',
              subUnitId: 'one',
              range: { startRow: 3, endRow: 3, startColumn: 2, endColumn: 2 },
              value: { v: 42 },
            }
          : {
              unitId: 'doc',
              segmentId: '',
              range: { startOffset: 2, endOffset: 2, collapsed: true },
              body: { dataStream: 'local' },
              debounce: true,
            };
      expect(await commands.executeCommand(command, params)).toBe(true);
      sync.retry();
      await turns();
      const request = outgoing.find((frame): frame is SubmitFrame => frame.type === 'submit')!;
      expect(request).toBeDefined();
      const localEdit = await f.accept(request);
      sync.receive({
        type: 'ack',
        mutationId: request.mutationId,
        duplicate: false,
        ...wire(localEdit.edit),
      });
      const remote: Mutation =
        kind === 'sheet'
          ? {
              id: 'sheet.mutation.insert-row',
              params: {
                unitId: 'book',
                subUnitId: 'one',
                range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 },
                rowInfo: {},
                trigger: 'sheet.command.insert-row',
              },
            }
          : {
              id: 'doc.mutation.rich-text-editing',
              params: {
                unitId: 'doc',
                actions: JSONX.getInstance().editOp(
                  new TextX().insert(4, { dataStream: 'peer' }).serialize(),
                ),
                textRanges: null,
              },
            };
      const peer = await f.accept(
        {
          type: 'submit',
          mutationId: '00000000-0000-4000-8000-000000000099',
          baseRevision: 2,
          mutations: [remote],
        },
        'peer',
      );
      sync.receive({ type: 'edit', ...wire(peer.edit) });
      await vi.advanceTimersByTimeAsync(350);
      const before = comparable(local.snapshot());
      expect(await commands.executeCommand('univer.command.undo', { unitId: snapshot.id })).toBe(
        false,
      );
      expect(comparable(local.snapshot())).toEqual(before);
      expect(before).toEqual(comparable(f.storage.unit.snapshot));
      expect(failures).toEqual([]);
    } finally {
      sync.dispose();
      local.dispose();
      f.close();
      vi.useRealTimers();
    }
  },
);

test.each([false, true])(
  'native row-deletion undo after reconnect accounts for a peer edit in the removed row: %s',
  async (withPeer) => {
    const f = fixture();
    const snapshot = f.storage.unit.snapshot;
    const local = new NativeReplica(snapshot, 'sheet');
    const injector = local.univer.__getInjector();
    const commands = injector.get(ICommandService);
    const history = injector.get(IUndoRedoService);
    const workbook = injector
      .get(IUniverInstanceService)
      .getUnit<Workbook>('book', UniverInstanceType.UNIVER_SHEET)!;
    injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
    injector.get(IUniverInstanceService).focusUnit('book');
    const outgoing: OutgoingFrame[] = [];
    const failures: ClientFailure[] = [];
    const visibleRemote: string[] = [];
    const observed = commands.beforeCommandExecuted((info, options) => {
      if (options?.fromCollab) visibleRemote.push(info.id);
    });
    const sync = createNativeSyncClient({
      univer: local.univer,
      unitId: 'book',
      kind: 'sheet',
      snapshot,
      revision: 1,
      send: (frame) => outgoing.push(frame),
      onState() {},
      onResync: (reason) => failures.push(reason),
      batchDelayMs: 100_000,
    });
    try {
      sync.setConnected(true);
      sync.receive({
        type: 'resume',
        version: 1,
        unitId: 'book',
        fromRevision: 1,
        revision: 1,
        edits: [],
      });
      await turns();
      expect(
        await commands.executeCommand('sheet.command.remove-row', {
          unitId: 'book',
          subUnitId: 'one',
          range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 5 },
        }),
      ).toBe(true);
      expect(history.getUndoRedoStatus('book').undos).toBeGreaterThan(0);
      sync.retry();
      await turns();
      const request = outgoing.find((frame): frame is SubmitFrame => frame.type === 'submit')!;
      expect(request).toBeDefined();
      if (withPeer) {
        const peer = await f.accept(
          {
            type: 'submit',
            mutationId: '00000000-0000-4000-8000-000000000099',
            baseRevision: 1,
            mutations: [write({ v: 'peer-new-value' }, 1)],
          },
          'peer',
        );
        expect(peer.edit.mutations).toHaveLength(1);
      }
      await f.accept(request);
      // Lose both edit and ack, then replay the peer and our accepted deletion.
      sync.setConnected(false);
      sync.setConnected(true);
      sync.receive({
        type: 'resume',
        version: 1,
        unitId: 'book',
        fromRevision: 1,
        revision: f.storage.unit.revision,
        edits: f.storage.history.map(wire),
      });
      await turns();
      const retry = outgoing
        .filter((frame): frame is SubmitFrame => frame.type === 'submit')
        .at(-1)!;
      expect(retry).toEqual(request);
      const acknowledged = await f.accept(retry);
      expect(acknowledged.duplicate).toBe(true);
      sync.receive({
        type: 'ack',
        mutationId: request.mutationId,
        duplicate: true,
        ...wire(acknowledged.edit),
      });
      expect(sync.state.pending).toBe(false);
      expect(failures).toEqual([]);
      expect(comparable(local.snapshot())).toEqual(comparable(f.storage.unit.snapshot));
      // The peer's nonempty edit rebases to nothing behind our row deletion.
      expect(visibleRemote).toEqual([]);
      const undone = await commands.executeCommand('univer.command.undo', { unitId: 'book' });
      const sheet = workbook.getSheetBySheetId('one')!;
      expect({
        undone,
        rowCount: sheet.getRowCount(),
        value: sheet.getCellRaw(1, 0)?.v ?? null,
      }).toEqual(
        withPeer
          ? { undone: false, rowCount: 11, value: null }
          : { undone: true, rowCount: 12, value: 'below' },
      );
      if (withPeer)
        expect(comparable(local.snapshot())).toEqual(comparable(f.storage.unit.snapshot));
    } finally {
      observed.dispose();
      sync.dispose();
      local.dispose();
      f.close();
    }
  },
);
