import {
  getDocsEmptySnapshot,
  ICommandService,
  IUndoRedoService,
  IUniverInstanceService,
  JSONX,
  TextX,
  UniverInstanceType,
} from '@univerjs/core';
import type { DocumentDataModel, IDocumentData } from '@univerjs/core';
import {
  DocSelectionManagerService,
  DocStateChangeManagerService,
  DocStateEmitService,
} from '@univerjs/docs';
import { NativeReplica, captureNative } from '@spinel/sync-client';
import { NORMAL_TEXT_SELECTION_PLUGIN_STYLE } from '@univerjs/engine-render';
import { afterEach, expect, test, vi } from 'vitest';
import { boundDocHistory, DOC_HISTORY_GROUP_LIMIT } from './boundedDocHistory.ts';
import type { DocFlushObservation } from './boundedDocHistory.ts';
import { nativeSession } from '../../lib/sync-client/tests/native-session.ts';
import { turns, wire } from '../../lib/sync-client/tests/fixture.ts';

const limit = DOC_HISTORY_GROUP_LIMIT;

afterEach(() => vi.useRealTimers());

function fixture(snapshot = getDocsEmptySnapshot('doc'), throws = false) {
  const replica = new NativeReplica(snapshot, 'doc');
  const injector = replica.univer.__getInjector();
  injector.get(IUniverInstanceService).focusUnit('doc');
  const commands = injector.get(ICommandService);
  const history = injector.get(IUndoRedoService);
  const manager = injector.get(DocStateChangeManagerService);
  const selections = injector.get(DocSelectionManagerService);
  const model = injector
    .get(IUniverInstanceService)
    .getUnit<DocumentDataModel>('doc', UniverInstanceType.UNIVER_DOC)!;
  const observations: DocFlushObservation[] = [];
  const policy = boundDocHistory(replica.univer, 'doc', (value) => {
    observations.push(value);
    if (throws) throw new Error('Optional diagnostics failed');
  });
  const range = (at: number, segmentId = '') => ({
    startOffset: at,
    endOffset: at,
    collapsed: true,
    segmentId,
  });
  const text = (segment = '') => model.getSelfOrHeaderFooterModel(segment)!.getBody()!.dataStream;
  // A mounted renderer initializes this state. Supply the same public logical
  // selection in the headless fixture; native mutations update it from here.
  const select = (at: number, segmentId = '') =>
    selections.replaceSelectionInfoWithoutRefresh(
      {
        textRanges: [{ ...range(at, segmentId), isActive: true }],
        rectRanges: [],
        segmentId,
        segmentPage: 0,
        isEditing: true,
        style: NORMAL_TEXT_SELECTION_PLUGIN_STYLE,
      },
      { unitId: 'doc', subUnitId: 'doc' },
    );
  select(0);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return {
    replica,
    commands,
    history,
    manager,
    model,
    policy,
    observations,
    text,
    select,
    selection: () => selections.getTextRanges({ unitId: 'doc', subUnitId: 'doc' })?.[0],
    async type(value: string, segmentId = '', debounce = true) {
      for (const character of value) {
        const at = text(segmentId).length - 2;
        expect(
          await commands.executeCommand('doc.command.insert-text', {
            unitId: 'doc',
            segmentId,
            range: range(at, segmentId),
            body: { dataStream: character },
            textRanges: [range(at + 1, segmentId)],
            debounce,
          }),
        ).toBe(true);
      }
    },
    async historyCommand(kind: 'undo' | 'redo') {
      expect(await commands.executeCommand(`univer.command.${kind}`, { unitId: 'doc' })).toBe(true);
      await Promise.resolve();
    },
    close() {
      policy.dispose();
      replica.dispose();
    },
  };
}

test('real native edits bound both caches and undo/redo exact ordered groups and selections', async () => {
  const f = fixture();
  const value = Array.from({ length: 3 * DOC_HISTORY_GROUP_LIMIT + 7 }, (_, i) =>
    String.fromCharCode(97 + (i % 26)),
  ).join('');
  const emitted: unknown[] = [];
  const subscription = f.manager.docStateChange$.subscribe((state) => {
    if (state) emitted.push(state);
  });
  try {
    await f.type(value);
    expect(f.text()).toBe(value + '\r\n');
    expect(f.manager.getStateCache('doc').history).toHaveLength(7);
    expect(f.manager.getStateCache('doc').collaboration).toHaveLength(7);
    expect(f.observations).toHaveLength(3);
    for (const observed of f.observations)
      expect(observed).toMatchObject({ history: limit, collaboration: limit, reason: 'capacity' });
    expect(emitted).toHaveLength(3);
    // Undo before the idle timer fires must first include the seven pending keys.
    for (const length of [3 * limit, 2 * limit, limit, 0]) {
      await f.historyCommand('undo');
      expect(f.text()).toBe(value.slice(0, length) + '\r\n');
      expect(f.selection()).toMatchObject({ startOffset: length, endOffset: length });
    }
    for (const length of [limit, 2 * limit, 3 * limit, value.length]) {
      await f.historyCommand('redo');
      expect(f.text()).toBe(value.slice(0, length) + '\r\n');
      expect(f.selection()).toMatchObject({ startOffset: length, endOffset: length });
    }
    await vi.advanceTimersByTimeAsync(350);
    expect(f.manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });
    expect(f.text()).toBe(value + '\r\n');
  } finally {
    subscription.unsubscribe();
    f.close();
  }
});

test('native idle grouping remains a useful whole phrase and broken observations cannot affect edits', async () => {
  const f = fixture(undefined, true);
  try {
    await f.type('a useful phrase');
    await vi.advanceTimersByTimeAsync(299);
    expect(f.history.getUndoRedoStatus('doc').undos).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.history.getUndoRedoStatus('doc').undos).toBe(1);
    await f.historyCommand('undo');
    expect(f.text()).toBe('\r\n');
    await f.historyCommand('redo');
    expect(f.text()).toBe('a useful phrase\r\n');
    await f.type('x'.repeat(limit));
    expect(f.observations).toHaveLength(1);
    expect(f.text()).toBe('a useful phrase' + 'x'.repeat(limit) + '\r\n');
    await f.historyCommand('undo');
    expect(f.text()).toBe('a useful phrase\r\n');
  } finally {
    f.close();
  }
});

test('the collaboration cache remains bounded even when mutations have no undo trigger', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < limit + 6; i++)
      f.commands.syncExecuteCommand('doc.mutation.rich-text-editing', {
        unitId: 'doc',
        segmentId: '',
        actions: JSONX.getInstance().editOp(
          new TextX().retain(i).insert(1, { dataStream: 'x' }).serialize(),
        ),
        textRanges: null,
        debounce: true,
      });
    expect(f.text()).toBe('x'.repeat(limit + 6) + '\r\n');
    expect(f.observations).toEqual([expect.objectContaining({ history: 0, collaboration: limit })]);
    expect(f.manager.getStateCache('doc').history).toHaveLength(0);
    expect(f.manager.getStateCache('doc').collaboration).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });
  } finally {
    f.close();
  }
});

test('body, header and footer changes keep native segment boundaries and exact undo selections', async () => {
  const snapshot = getDocsEmptySnapshot('doc');
  snapshot.headers = { top: { headerId: 'top', body: { dataStream: '\r\n' } } };
  snapshot.footers = { bottom: { footerId: 'bottom', body: { dataStream: '\r\n' } } };
  const f = fixture(snapshot);
  try {
    await f.type('b'.repeat(limit - 1));
    f.select(0, 'top');
    await f.type('h'.repeat(limit + 1), 'top');
    f.select(0, 'bottom');
    await f.type('foot', 'bottom');
    for (const [segment, length] of [
      ['bottom', 0],
      ['top', limit],
      ['top', 0],
      ['', 0],
    ] as const) {
      await f.historyCommand('undo');
      expect(f.text(segment).length - 2).toBe(length);
      expect(f.selection()).toMatchObject({
        startOffset: length,
        endOffset: length,
        segmentId: segment,
      });
    }
    for (let i = 0; i < 4; i++) await f.historyCommand('redo');
    expect(f.text()).toBe('b'.repeat(limit - 1) + '\r\n');
    expect(f.text('top')).toBe('h'.repeat(limit + 1) + '\r\n');
    expect(f.text('bottom')).toBe('foot\r\n');
  } finally {
    f.close();
  }
});

test('composition intermediates, remote emissions and other units cannot force a local history boundary', async () => {
  const f = fixture();
  const states = f.replica.univer.__getInjector().get(DocStateEmitService);
  try {
    await f.type('x'.repeat(limit - 1));
    const sample = f.manager.getStateCache('doc').history[0]!;
    // These are native state notifications only: simulated intermediates carry
    // noHistory like the real IME; mounted browser tests verify the actual IME.
    for (let i = 0; i < 100; i++) {
      states.emitStateChangeInfo({ ...sample, noHistory: true });
      states.emitStateChangeInfo({ ...sample, isSync: true });
      states.emitStateChangeInfo({ ...sample, unitId: 'other', isSync: true });
    }
    expect(f.observations).toEqual([]);
    expect(f.manager.getStateCache('doc').history).toHaveLength(limit - 1);
    await f.type('z');
    expect(f.observations).toHaveLength(1);
    await f.historyCommand('undo');
    expect(f.text()).toBe('\r\n');
  } finally {
    f.close();
  }
});

test('disposal removes the cap listener without flushing, clearing or dropping pending native edits', async () => {
  const f = fixture();
  try {
    await f.type('x'.repeat(limit - 1));
    f.policy.dispose();
    await f.type('yz');
    expect(f.observations).toEqual([]);
    expect(f.manager.getStateCache('doc').history).toHaveLength(limit + 1);
    expect(f.manager.getStateCache('doc').collaboration).toHaveLength(limit + 1);
    await f.historyCommand('undo');
    expect(f.text()).toBe('\r\n');
  } finally {
    f.close();
  }
});

test('a permission fence denies new native input while bounded maintenance retains earlier work', async () => {
  const f = fixture();
  let allowed = true;
  const captured: unknown[] = [],
    failures: unknown[] = [];
  const capture = captureNative({
    univer: f.replica.univer,
    unitId: 'doc',
    canEdit: () => allowed,
    onMutation: (mutation) => captured.push(mutation),
    onFailure: (reason) => failures.push(reason),
  });
  try {
    await f.type('x'.repeat(limit - 1));
    allowed = false;
    expect(
      await f.commands.executeCommand('doc.command.insert-text', {
        unitId: 'doc',
        segmentId: '',
        range: { startOffset: limit - 1, endOffset: limit - 1, collapsed: true },
        body: { dataStream: 'forbidden' },
        debounce: true,
      }),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(350);
    expect(f.text()).toBe('x'.repeat(limit - 1) + '\r\n');
    expect(captured).toHaveLength(limit - 1);
    expect(failures).toEqual(['unavailable']);
    expect(f.observations).toEqual([]);
    expect(f.history.getUndoRedoStatus('doc').undos).toBe(1);
  } finally {
    capture.dispose();
    f.close();
  }
});

test('bounded groups retain exact lost-ack replay and local undo until a real peer edit invalidates it', async () => {
  const f = nativeSession(getDocsEmptySnapshot('doc'), 'doc');
  const a = f.client('owner'),
    b = f.client('collaborator');
  const cap = boundDocHistory(a.live.univer, 'doc');
  const manager = a.live.univer.__getInjector().get(DocStateChangeManagerService);
  try {
    await turns();
    for (let i = 0; i < 70; i++)
      expect(
        await a.commands.executeCommand('doc.command.insert-text', {
          unitId: 'doc',
          segmentId: '',
          range: { startOffset: i, endOffset: i, collapsed: true },
          body: { dataStream: String(i % 10) },
          debounce: true,
        }),
      ).toBe(true);
    manager.flushPendingChanges('doc');
    const request = await f.request(a);
    const accepted = await f.submit(a, request);
    b.sync.receive({ type: 'edit', ...wire(accepted.edit) });
    a.sync.setConnected(false);
    f.resume(a);
    expect(await f.request(a)).toEqual(request);
    const duplicate = await f.submit(a, request);
    expect(duplicate.duplicate).toBe(true);
    await f.acknowledge(a, duplicate);
    expect(f.storage.history).toHaveLength(1);
    expect(a.live.snapshot()).toEqual(b.live.snapshot());
    expect((f.reopen() as IDocumentData).body!.dataStream).toBe('0123456789'.repeat(7) + '\r\n');
    const history = a.live.univer.__getInjector().get(IUndoRedoService);
    expect(history.getUndoRedoStatus('doc').undos).toBe(2);
    expect(
      await b.commands.executeCommand('doc.command.insert-text', {
        unitId: 'doc',
        segmentId: '',
        range: { startOffset: 0, endOffset: 0, collapsed: true },
        body: { dataStream: 'peer' },
        debounce: false,
      }),
    ).toBe(true);
    const peerRequest = await f.request(b);
    const peerEdit = await f.submit(b, peerRequest);
    await f.acknowledge(b, peerEdit);
    a.sync.receive({ type: 'edit', ...wire(peerEdit.edit) });
    expect(history.getUndoRedoStatus('doc').undos).toBe(0);
    expect(await a.commands.executeCommand('univer.command.undo', { unitId: 'doc' })).toBe(false);
    expect((a.live.snapshot() as IDocumentData).body!.dataStream).toBe(
      'peer' + '0123456789'.repeat(7) + '\r\n',
    );
    expect(a.failures).toEqual([]);
    expect(b.failures).toEqual([]);
  } finally {
    cap.dispose();
    f.close();
  }
});
