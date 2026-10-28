import { IUndoRedoService, IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import type { DocumentDataModel, Univer } from '@univerjs/core';
import {
  DocSelectionManagerService,
  DocStateChangeManagerService,
  DocStateEmitService,
} from '@univerjs/docs';
import { DocSelectionRenderService } from '@univerjs/docs-ui';
import { IRenderManagerService } from '@univerjs/engine-render';

import type { DocFlushObservation } from '../src/ui/boundedDocHistory.ts';

type CacheCounts = { history: number; collaboration: number };
type HistoryCounts = { undos: number; redos: number };
export type DocDrainWakeup = 'terminal-state' | 'history-status' | 'collaboration-emission';
export interface DocDrainSnapshot {
  observedAt: number;
  pending: CacheCounts;
  highWater: CacheCounts;
  history: HistoryCounts;
}
export interface DocDrainArm {
  epoch: string;
  unitId: string;
  timeOrigin: number;
  expectedCompletedStates: number;
}
export interface DocDrainSeal {
  epoch: string;
  unitId: string;
  timeOrigin: number;
  generation: string;
}
export type DocDrainRequest =
  ({ action: 'arm' } & DocDrainArm) | ({ action: 'seal' } & DocDrainSeal);
export interface DocDrainWitness {
  epoch: string;
  generation: string;
  unitId: string;
  timeOrigin: number;
  installedAt: number;
  armedAt: number;
  expectedCompletedStates: number;
  completedStates: number;
  lastCompletedStateAt: number | null;
  initial: DocDrainSnapshot;
  firstEmpty: (DocDrainSnapshot & { completedStates: number; wakeups: DocDrainWakeup[] }) | null;
  sealedAt: number | null;
  invalidated: boolean;
  invalidations: Array<{ reason: string; observedAt: number }>;
}

let nextObserverGeneration = 0;

/** Opt-in benchmark observations. No commands, timers, or per-edit snapshot copies. */
export function observeDocResponsiveness(univer: Univer, unitId: string, mobile: boolean) {
  const injector = univer.__getInjector();
  // Instantiate the native subscriber before ours so these are post-capture counts.
  const manager = injector.get(DocStateChangeManagerService);
  const highWater = { history: 0, collaboration: 0 };
  const flushes: DocFlushObservation[] = [];
  const undoRedo = injector.get(IUndoRedoService);
  const timeOrigin = performance.timeOrigin;
  const installedAt = performance.now();
  const generation = `${unitId}:${timeOrigin}:${installedAt}:${++nextObserverGeneration}`;
  let disposed = false;
  let drain: DocDrainWitness | null = null;
  let queued = false;
  const wakeups = new Set<DocDrainWakeup>();
  const active = () => drain !== null && drain.sealedAt === null && !disposed;
  const snapshot = (): DocDrainSnapshot => {
    const pending = manager.getStateCache(unitId);
    return {
      pending: { history: pending.history.length, collaboration: pending.collaboration.length },
      highWater: { ...highWater },
      history: { ...undoRedo.getUndoRedoStatus(unitId) },
      observedAt: performance.now(),
    };
  };
  const invalidate = (reason: string) => {
    if (!drain || drain.sealedAt !== null) return;
    drain.invalidated = true;
    // Preserve the first causes without permitting an unbounded diagnostic log.
    if (
      drain.invalidations.length < 32 &&
      !drain.invalidations.some((entry) => entry.reason === reason)
    )
      drain.invalidations.push({ reason, observedAt: performance.now() });
  };
  const coherentAfterEmpty = (value: DocDrainSnapshot) => {
    if (!drain?.firstEmpty || !active()) return;
    if (value.pending.history !== 0 || value.pending.collaboration !== 0)
      invalidate('refilled-after-empty');
    if (
      value.history.undos !== drain.firstEmpty.history.undos ||
      value.history.redos !== drain.firstEmpty.history.redos
    )
      invalidate('history-changed-after-empty');
    if (
      value.highWater.history !== drain.firstEmpty.highWater.history ||
      value.highWater.collaboration !== drain.firstEmpty.highWater.collaboration
    )
      invalidate('high-water-changed-after-empty');
  };
  const scheduleCheck = (source: DocDrainWakeup) => {
    if (!active() || !drain || drain.completedStates < drain.expectedCompletedStates) return;
    wakeups.add(source);
    if (queued) return;
    queued = true;
    const epoch = drain.epoch;
    queueMicrotask(() => {
      queued = false;
      const sources = [...wakeups];
      wakeups.clear();
      if (!active() || !drain) return;
      if (drain.epoch !== epoch || drain.generation !== generation) {
        invalidate('stale-generation');
        return;
      }
      try {
        const value = snapshot();
        coherentAfterEmpty(value);
        if (
          !drain.invalidated &&
          !drain.firstEmpty &&
          drain.completedStates === drain.expectedCompletedStates &&
          value.pending.history === 0 &&
          value.pending.collaboration === 0
        )
          drain.firstEmpty = { ...value, completedStates: drain.completedStates, wakeups: sources };
      } catch {
        invalidate('native-read-failed');
      }
    });
  };
  const readDrain = () => {
    if (active() && drain?.firstEmpty) {
      try {
        coherentAfterEmpty(snapshot());
      } catch {
        invalidate('native-read-failed');
      }
    }
    return drain ? structuredClone(drain) : null;
  };
  const armDrain = (request: DocDrainArm): DocDrainWitness => {
    if (drain) {
      invalidate('rearmed');
      return structuredClone(drain);
    }
    const initial = snapshot();
    drain = {
      epoch: request.epoch,
      generation,
      unitId,
      timeOrigin,
      installedAt,
      armedAt: initial.observedAt,
      expectedCompletedStates: request.expectedCompletedStates,
      completedStates: 0,
      lastCompletedStateAt: null,
      initial,
      firstEmpty: null,
      sealedAt: null,
      invalidated: false,
      invalidations: [],
    };
    if (disposed) invalidate('disposed-before-arm');
    if (request.unitId !== unitId || request.timeOrigin !== timeOrigin)
      invalidate('arm-identity-mismatch');
    if (!request.epoch || request.epoch.length > 128) invalidate('invalid-epoch');
    if (
      !Number.isInteger(request.expectedCompletedStates) ||
      request.expectedCompletedStates < 1 ||
      request.expectedCompletedStates > 10_000
    )
      invalidate('invalid-expected-state-count');
    if (
      initial.pending.history !== 0 ||
      initial.pending.collaboration !== 0 ||
      initial.history.undos !== 0 ||
      initial.history.redos !== 0
    )
      invalidate('nonempty-arm');
    return structuredClone(drain);
  };
  const sealDrain = (request: DocDrainSeal): DocDrainWitness | null => {
    if (!drain) return null;
    if (drain.sealedAt !== null) return structuredClone(drain);
    if (
      request.epoch !== drain.epoch ||
      request.unitId !== unitId ||
      request.timeOrigin !== timeOrigin ||
      request.generation !== generation
    )
      invalidate('seal-identity-mismatch');
    readDrain();
    if (drain.completedStates !== drain.expectedCompletedStates)
      invalidate('incomplete-state-count');
    if (!drain.firstEmpty) invalidate('missing-empty-witness');
    drain.sealedAt = performance.now();
    return structuredClone(drain);
  };
  const subscription = injector
    .get(DocStateEmitService)
    .docStateChangeParams$.subscribe((state) => {
      if (!state || state.unitId !== unitId) return;
      const pending = manager.getStateCache(unitId);
      highWater.history = Math.max(highWater.history, pending.history.length);
      highWater.collaboration = Math.max(highWater.collaboration, pending.collaboration.length);
      if (active() && drain && !state.isSync && !state.noHistory) {
        drain.completedStates++;
        drain.lastCompletedStateAt = performance.now();
        if (drain.completedStates > drain.expectedCompletedStates)
          invalidate('extra-completed-state');
        if (drain.completedStates === drain.expectedCompletedStates)
          scheduleCheck('terminal-state');
      }
    });
  const collaborationSubscription = manager.docStateChange$.subscribe((state) => {
    if (state?.unitId === unitId) scheduleCheck('collaboration-emission');
  });
  // The status payload is global. It is only a wake-up; the microtask reads the
  // armed unit after native _pushHistory has cleared its cache and returned.
  const historySubscription = undoRedo.undoRedoStatus$.subscribe(() =>
    scheduleCheck('history-status'),
  );
  const reloaded = (event: Event) => {
    if (active() && (event as CustomEvent<{ unitId?: string }>).detail?.unitId === unitId)
      invalidate('reloaded-before-seal');
  };
  window.addEventListener('spinel-doc-responsiveness-reload', reloaded);
  const read = (event: Event) => {
    const request = (
      event as CustomEvent<{ includeText?: boolean; drainRequest?: DocDrainRequest }>
    ).detail;
    if (request?.drainRequest?.action === 'arm') armDrain(request.drainRequest);
    else if (request?.drainRequest?.action === 'seal') sealDrain(request.drainRequest);
    const pending = manager.getStateCache(unitId);
    const selection = injector
      .get(DocSelectionManagerService)
      .getTextRanges({ unitId, subUnitId: unitId })?.[0];
    const includeText = request?.includeText;
    window.dispatchEvent(
      new CustomEvent('spinel-doc-responsiveness-evidence', {
        detail: {
          unitId,
          mobile,
          observedAt: performance.now(),
          pending: { history: pending.history.length, collaboration: pending.collaboration.length },
          highWater: { ...highWater },
          flushes: [...flushes],
          history: { ...injector.get(IUndoRedoService).getUndoRedoStatus(unitId) },
          drainWitness: readDrain(),
          selection: selection
            ? {
                start: selection.startOffset,
                end: selection.endOffset,
                segmentId: selection.segmentId,
              }
            : null,
          ...(includeText
            ? {
                text: injector
                  .get(IUniverInstanceService)
                  .getUnit<DocumentDataModel>(unitId, UniverInstanceType.UNIVER_DOC)
                  ?.getBody()?.dataStream,
              }
            : {}),
        },
      }),
    );
  };
  window.addEventListener('spinel-doc-responsiveness-read', read);
  // Separate idle-frame observation avoids copying history/snapshots on each
  // caret sample. The public graphic is read only after real native input.
  const readCursor = () => {
    const anchor = injector
      .get(IRenderManagerService)
      .getRenderUnitById(unitId)
      ?.with(DocSelectionRenderService)
      .getActiveTextRange()
      ?.getAnchor();
    window.dispatchEvent(
      new CustomEvent('spinel-doc-cursor-evidence', {
        detail: {
          unitId,
          anchor: anchor
            ? {
                visible: anchor.visible,
                stroke: typeof anchor.stroke === 'string' ? anchor.stroke : null,
              }
            : null,
        },
      }),
    );
  };
  window.addEventListener('spinel-doc-cursor-read', readCursor);
  return {
    armDrain,
    sealDrain,
    readDrain,
    flushed(value: DocFlushObservation) {
      // Bounded even when a benchmark tab is accidentally left open.
      if (flushes.length < 4096) flushes.push({ ...value });
    },
    dispose() {
      invalidate('disposed-before-seal');
      disposed = true;
      subscription.unsubscribe();
      collaborationSubscription.unsubscribe();
      historySubscription.unsubscribe();
      window.removeEventListener('spinel-doc-responsiveness-reload', reloaded);
      window.removeEventListener('spinel-doc-responsiveness-read', read);
      window.removeEventListener('spinel-doc-cursor-read', readCursor);
    },
  };
}
