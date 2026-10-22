import type { DocStateChangeManagerService, DocStateEmitService } from '@univerjs/docs';

export interface DocPendingChanges {
  pending(): boolean;
  subscribe(changed: () => void): () => void;
}

/** The public Doc queue precedes collaboration's debounce and acknowledgement. */
export function docPendingChanges(
  unitId: string,
  states: Pick<DocStateEmitService, 'docStateChangeParams$'>,
  batches: Pick<DocStateChangeManagerService, 'docStateChange$' | 'getStateCache'>,
): DocPendingChanges {
  let handingOff = false;
  return {
    pending: () => handingOff || batches.getStateCache(unitId).collaboration.length > 0,
    subscribe(changed) {
      let disposed = false;
      let batchGeneration = 0;
      const raw = states.docStateChangeParams$.subscribe((change) => {
        if (change?.unitId === unitId && !change.isSync && !change.noHistory) changed();
      });
      const submitted = batches.docStateChange$.subscribe((change) => {
        if (change?.unitId !== unitId || change.noHistory) return;
        const generation = ++batchGeneration;
        // The native queue is cleared before this synchronous observable sends
        // the batch to collaboration. Empty alone does not establish a save.
        handingOff = true;
        changed();
        queueMicrotask(() => {
          if (disposed || generation !== batchGeneration) return;
          handingOff = false;
          // All batch subscribers have run. The save watcher must now use the
          // current collaboration acknowledgement and recovery-cache barrier.
          changed();
        });
      });
      return () => {
        disposed = true;
        raw.unsubscribe();
        submitted.unsubscribe();
      };
    },
  };
}
