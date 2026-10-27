import type { Univer } from '@univerjs/core';
import { DocStateChangeManagerService, DocStateEmitService } from '@univerjs/docs';

// A long uninterrupted burst must not become one quadratic composition task.
// The measured 64-state candidate missed the paired-flush p95 budget. Forty-four
// keeps the 2,086-input reproducer at 48 groups inside native 50-group retention.
// Idle/segment/IME boundaries remain native.
export const DOC_HISTORY_GROUP_LIMIT = 44;

export interface DocFlushObservation {
  reason: 'capacity';
  startedAt: number;
  durationMs: number;
  history: number;
  collaboration: number;
}

/** Bound both native caches through public APIs; never edit or clear their contents. */
export function boundDocHistory(
  univer: Univer,
  unitId: string,
  observe?: (flush: DocFlushObservation) => void,
) {
  const injector = univer.__getInjector();
  // Resolving first registers the SDK's capture/IME subscriber before ours.
  const manager = injector.get(DocStateChangeManagerService);
  let flushing = false;
  const subscription = injector
    .get(DocStateEmitService)
    .docStateChangeParams$.subscribe((state) => {
      if (!state || state.unitId !== unitId || state.isSync || state.noHistory || flushing) return;
      const pending = manager.getStateCache(unitId);
      const history = pending.history.length;
      const collaboration = pending.collaboration.length;
      if (Math.max(history, collaboration) < DOC_HISTORY_GROUP_LIMIT) return;
      flushing = true;
      const startedAt = performance.now();
      try {
        manager.flushPendingChanges(unitId);
      } finally {
        flushing = false;
      }
      try {
        observe?.({
          reason: 'capacity',
          startedAt,
          durationMs: performance.now() - startedAt,
          history,
          collaboration,
        });
      } catch {
        // Optional measurements cannot change native input or synchronization.
      }
    });
  return { dispose: () => subscription.unsubscribe() };
}
