import { IUndoRedoService, IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import type { DocumentDataModel, Univer } from '@univerjs/core';
import {
  DocSelectionManagerService,
  DocStateChangeManagerService,
  DocStateEmitService,
} from '@univerjs/docs';

import type { DocFlushObservation } from '../src/ui/boundedDocHistory.ts';

/** Opt-in benchmark observations. No commands, timers, or per-edit snapshot copies. */
export function observeDocResponsiveness(univer: Univer, unitId: string, mobile: boolean) {
  const injector = univer.__getInjector();
  // Instantiate the native subscriber before ours so these are post-capture counts.
  const manager = injector.get(DocStateChangeManagerService);
  const highWater = { history: 0, collaboration: 0 };
  const flushes: DocFlushObservation[] = [];
  const subscription = injector
    .get(DocStateEmitService)
    .docStateChangeParams$.subscribe((state) => {
      if (!state || state.unitId !== unitId) return;
      const pending = manager.getStateCache(unitId);
      highWater.history = Math.max(highWater.history, pending.history.length);
      highWater.collaboration = Math.max(highWater.collaboration, pending.collaboration.length);
    });
  const read = (event: Event) => {
    const pending = manager.getStateCache(unitId);
    const selection = injector
      .get(DocSelectionManagerService)
      .getTextRanges({ unitId, subUnitId: unitId })?.[0];
    const includeText = (event as CustomEvent<{ includeText?: boolean }>).detail?.includeText;
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
  return {
    flushed(value: DocFlushObservation) {
      // Bounded even when a benchmark tab is accidentally left open.
      if (flushes.length < 4096) flushes.push({ ...value });
    },
    dispose() {
      subscription.unsubscribe();
      window.removeEventListener('spinel-doc-responsiveness-read', read);
    },
  };
}
