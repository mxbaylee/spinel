import {
  getDocsEmptySnapshot,
  ICommandService,
  IUndoRedoService,
  IUniverInstanceService,
  UniverInstanceType,
} from '@univerjs/core';
import type { DocumentDataModel } from '@univerjs/core';
import { DocStateChangeManagerService, DocStateEmitService } from '@univerjs/docs';
import { NativeReplica } from '@spinel/sync-client';
import { afterEach, expect, test, vi } from 'vitest';
import { observeDocResponsiveness } from '../../web/docResponsivenessEvidence.ts';
import { boundDocHistory } from './boundedDocHistory.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture(expectedCompletedStates = 3, bounded = false) {
  const replica = new NativeReplica(getDocsEmptySnapshot('doc'), 'doc');
  const injector = replica.univer.__getInjector();
  injector.get(IUniverInstanceService).focusUnit('doc');
  const model = injector
    .get(IUniverInstanceService)
    .getUnit<DocumentDataModel>('doc', UniverInstanceType.UNIVER_DOC)!;
  const commands = injector.get(ICommandService);
  const manager = injector.get(DocStateChangeManagerService);
  vi.stubGlobal('window', new EventTarget());
  const observer = observeDocResponsiveness(replica.univer, 'doc', false);
  const policy = bounded ? boundDocHistory(replica.univer, 'doc') : undefined;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const request = {
    epoch: 'native-test-epoch',
    unitId: 'doc',
    timeOrigin: performance.timeOrigin,
    expectedCompletedStates,
  };
  const arm = () => observer.armDrain(request);
  const seal = () => {
    const witness = observer.readDrain()!;
    return observer.sealDrain({
      epoch: witness.epoch,
      generation: witness.generation,
      unitId: witness.unitId,
      timeOrigin: witness.timeOrigin,
    });
  };
  const text = () => model.getBody()!.dataStream;
  return {
    replica,
    injector,
    commands,
    manager,
    observer,
    request,
    arm,
    seal,
    text,
    async type(value: string) {
      for (const character of value) {
        const at = text().length - 2;
        expect(
          await commands.executeCommand('doc.command.insert-text', {
            unitId: 'doc',
            segmentId: '',
            range: { startOffset: at, endOffset: at, collapsed: true },
            body: { dataStream: character },
            textRanges: [{ startOffset: at + 1, endOffset: at + 1, collapsed: true }],
            debounce: true,
          }),
        ).toBe(true);
      }
    },
    close() {
      observer.dispose();
      policy?.dispose();
      replica.dispose();
    },
  };
}

test('native timer completion records an actual empty observation and sealing preserves it across Undo', async () => {
  const f = fixture();
  try {
    const armed = f.arm();
    expect(armed.invalidated).toBe(false);
    expect(armed.firstEmpty).toBeNull();
    await f.type('abc');
    expect(f.observer.readDrain()?.firstEmpty).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    const read = f.observer.readDrain()!;
    expect(read.completedStates).toBe(3);
    expect(read.invalidated).toBe(false);
    expect(read.firstEmpty).toMatchObject({
      completedStates: 3,
      pending: { history: 0, collaboration: 0 },
      history: { undos: 1, redos: 0 },
      highWater: { history: 3, collaboration: 3 },
    });
    expect(read.firstEmpty!.observedAt).toBeGreaterThanOrEqual(read.lastCompletedStateAt!);
    const sealed = f.seal();
    expect(sealed?.invalidated).toBe(false);
    expect(sealed?.sealedAt).toBeGreaterThanOrEqual(read.firstEmpty!.observedAt);
    expect(await f.commands.executeCommand('univer.command.undo', { unitId: 'doc' })).toBe(true);
    expect(f.text()).toBe('\r\n');
    expect(f.observer.readDrain()).toEqual(sealed);
  } finally {
    f.close();
  }
});

test('terminal capacity completion is observed after synchronous subscribers, never at an earlier group', async () => {
  const f = fixture(64, true);
  try {
    f.arm();
    await f.type('a'.repeat(32));
    expect(f.manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });
    expect(f.observer.readDrain()?.firstEmpty).toBeNull();
    await f.type('b'.repeat(32));
    await Promise.resolve();
    const witness = f.seal();
    expect(witness?.invalidated).toBe(false);
    expect(witness?.completedStates).toBe(64);
    expect(witness?.firstEmpty).toMatchObject({
      completedStates: 64,
      pending: { history: 0, collaboration: 0 },
      history: { undos: 2, redos: 0 },
      highWater: { history: 32, collaboration: 32 },
    });
    expect(f.text()).toBe('a'.repeat(32) + 'b'.repeat(32) + '\r\n');
  } finally {
    f.close();
  }
});

test('an extra completed edit after the first empty witness invalidates the unsealed observation', async () => {
  const f = fixture(2);
  try {
    f.arm();
    await f.type('ab');
    await vi.advanceTimersByTimeAsync(300);
    const firstEmpty = f.observer.readDrain()!.firstEmpty;
    expect(firstEmpty).not.toBeNull();
    await f.type('c');
    const witness = f.seal();
    expect(witness?.invalidated).toBe(true);
    expect(witness?.completedStates).toBe(3);
    expect(witness?.firstEmpty).toEqual(firstEmpty);
    expect(f.text()).toBe('abc\r\n');
  } finally {
    f.close();
  }
});

test('nonempty initial state and duplicate arming cannot erase an invalid measurement epoch', async () => {
  const f = fixture(2);
  try {
    await f.type('a');
    expect(f.arm().invalidated).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.observer.armDrain({ ...f.request, epoch: 'replacement' }).invalidated).toBe(true);
  } finally {
    f.close();
  }
});

test.each(['epoch', 'generation', 'unitId', 'timeOrigin'] as const)(
  'a mismatched %s cannot seal a valid observation',
  async (field) => {
    const f = fixture(1);
    try {
      f.arm();
      await f.type('a');
      await vi.advanceTimersByTimeAsync(300);
      const witness = f.observer.readDrain()!;
      const request = {
        epoch: witness.epoch,
        generation: witness.generation,
        unitId: witness.unitId,
        timeOrigin: witness.timeOrigin,
      };
      expect(
        f.observer.sealDrain({
          ...request,
          [field]: field === 'timeOrigin' ? witness.timeOrigin + 1 : 'wrong',
        })?.invalidated,
      ).toBe(true);
    } finally {
      f.close();
    }
  },
);

test('remote, intermediate and other-unit native notifications cannot satisfy the terminal count', async () => {
  const f = fixture(2);
  try {
    f.arm();
    await f.type('a');
    const sample = f.manager.getStateCache('doc').history[0]!;
    const states = f.injector.get(DocStateEmitService);
    states.emitStateChangeInfo({ ...sample, noHistory: true });
    states.emitStateChangeInfo({ ...sample, isSync: true });
    states.emitStateChangeInfo({ ...sample, unitId: 'other', isSync: true });
    expect(f.observer.readDrain()?.completedStates).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.observer.readDrain()?.firstEmpty).toBeNull();
    await f.type('b');
    await vi.advanceTimersByTimeAsync(300);
    expect(f.seal()?.firstEmpty?.completedStates).toBe(2);
  } finally {
    f.close();
  }
});

test('disposal invalidates an unsealed epoch and a queued microtask cannot fabricate completion', async () => {
  const f = fixture(1);
  try {
    f.arm();
    await f.type('a');
    f.manager.flushPendingChanges('doc');
    f.observer.dispose();
    await Promise.resolve();
    expect(f.observer.readDrain()?.invalidated).toBe(true);
    expect(f.observer.readDrain()?.firstEmpty).toBeNull();
    expect(f.manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });
    expect(f.injector.get(IUndoRedoService).getUndoRedoStatus('doc').undos).toBe(1);
  } finally {
    f.close();
  }
});

test('read and premature seal cannot manufacture a terminal empty observation', () => {
  const f = fixture(1);
  try {
    f.arm();
    const read = f.observer.readDrain()!;
    read.initial.pending.history = 999;
    expect(f.observer.readDrain()?.initial.pending.history).toBe(0);
    expect(f.seal()?.invalidated).toBe(true);
    expect(f.observer.readDrain()?.firstEmpty).toBeNull();
    expect(f.text()).toBe('\r\n');
  } finally {
    f.close();
  }
});

test('a same-unit reload invalidates the active witness while another unit cannot', async () => {
  const f = fixture(1);
  try {
    f.arm();
    await f.type('a');
    await vi.advanceTimersByTimeAsync(300);
    window.dispatchEvent(
      new CustomEvent('spinel-doc-responsiveness-reload', { detail: { unitId: 'other' } }),
    );
    expect(f.observer.readDrain()?.invalidated).toBe(false);
    window.dispatchEvent(
      new CustomEvent('spinel-doc-responsiveness-reload', { detail: { unitId: 'doc' } }),
    );
    expect(f.seal()?.invalidated).toBe(true);
    expect(f.text()).toBe('a\r\n');
  } finally {
    f.close();
  }
});
