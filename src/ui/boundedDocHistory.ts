import type { Univer } from '@univerjs/core';
import { DocStateChangeManagerService, DocStateEmitService } from '@univerjs/docs';

// A long uninterrupted burst must not become one quadratic composition task.
// Both 64- and 44-state candidates missed the paired-flush p95 budget. Smaller
// native groups keep composition bounded; the public constructor retention
// option leaves room for the original fixture's 66 capacity-only groups plus
// additional idle boundaries. Verification replays every actual observed group.
// Native segment/IME boundaries and finite eviction remain intact. An owned
// frame checks the same 300 ms quiet interval when SDK timers are delayed.
export const DOC_HISTORY_GROUP_LIMIT = 32;
export const DOC_HISTORY_RETENTION_LIMIT = 100;
// Match the pinned SDK's quiet interval without joining its deferred timer queue.
export const DOC_HISTORY_IDLE_MS = 300;

export interface DocFlushObservation {
  reason: 'capacity' | 'idle';
  startedAt: number;
  durationMs: number;
  history: number;
  collaboration: number;
  quietForMs?: number;
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
  let disposed = false;
  let lastChangeAt = 0;
  let frame: number | undefined;
  const ownerDocument = typeof document === 'undefined' ? undefined : document;
  const hasFrames =
    typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';
  const visible = () => !ownerDocument || ownerDocument.visibilityState === 'visible';
  const hasPending = () => {
    const pending = manager.getStateCache(unitId);
    return pending.history.length > 0 || pending.collaboration.length > 0;
  };
  const cancelFrame = () => {
    if (frame === undefined) return;
    cancelAnimationFrame(frame);
    frame = undefined;
  };
  const flush = (
    reason: DocFlushObservation['reason'],
    pending: ReturnType<DocStateChangeManagerService['getStateCache']>,
    quietForMs?: number,
  ) => {
    cancelFrame();
    const history = pending.history.length;
    const collaboration = pending.collaboration.length;
    flushing = true;
    const startedAt = performance.now();
    try {
      manager.flushPendingChanges(unitId);
    } finally {
      flushing = false;
    }
    try {
      observe?.({
        reason,
        startedAt,
        durationMs: performance.now() - startedAt,
        history,
        collaboration,
        ...(reason === 'idle' ? { quietForMs } : {}),
      });
    } catch {
      // Optional measurements cannot change native input or synchronization.
    }
  };
  function scheduleFrame() {
    if (disposed || !hasFrames || frame !== undefined || !visible() || !hasPending()) return;
    frame = requestAnimationFrame(checkIdle);
  }
  function checkIdle() {
    frame = undefined;
    if (disposed || flushing || !visible()) return;
    const pending = manager.getStateCache(unitId);
    if (pending.history.length === 0 && pending.collaboration.length === 0) return;
    const quietForMs = performance.now() - lastChangeAt;
    if (quietForMs >= DOC_HISTORY_IDLE_MS) flush('idle', pending, quietForMs);
    scheduleFrame();
  }
  const visibilityChanged = () => {
    if (visible()) scheduleFrame();
    else cancelFrame();
  };
  if (hasFrames) ownerDocument?.addEventListener('visibilitychange', visibilityChanged);
  const subscription = injector
    .get(DocStateEmitService)
    .docStateChangeParams$.subscribe((state) => {
      if (
        disposed ||
        !state ||
        state.unitId !== unitId ||
        state.isSync ||
        state.noHistory ||
        flushing
      )
        return;
      lastChangeAt = performance.now();
      const pending = manager.getStateCache(unitId);
      const history = pending.history.length;
      const collaboration = pending.collaboration.length;
      if (Math.max(history, collaboration) >= DOC_HISTORY_GROUP_LIMIT) flush('capacity', pending);
      scheduleFrame();
    });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelFrame();
      if (hasFrames) ownerDocument?.removeEventListener('visibilitychange', visibilityChanged);
      subscription.unsubscribe();
    },
  };
}
