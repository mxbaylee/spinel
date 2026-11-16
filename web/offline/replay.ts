import {
  offlinePreparation,
  openExistingOfflineStore,
  preparedAccount,
  watchOfflineChanges,
} from './offlineStore.ts';
import type { OfflineDownload } from './offlineStore.ts';
import type { DiagnosticSource } from '@spinel/diagnostics';

type Job = { stop(): Promise<void>; done: Promise<void> };
type Owner = ReturnType<typeof createReplayOwner>;
type ReplayDiagnostics = (download: OfflineDownload) => DiagnosticSource;
const owners = new Map<string, Owner>();
const retiring = new Map<string, Promise<void>>();

/** Multiple file-list surfaces share one account-scoped, event-driven owner. */
export function watchOfflineReplay(
  accountId: string,
  foregroundItem: string | null,
  diagnostics?: ReplayDiagnostics,
) {
  let owner = owners.get(accountId);
  if (!owner) {
    owner = createReplayOwner(accountId);
    owners.set(accountId, owner);
  }
  return owner.subscribe(foregroundItem, diagnostics);
}

function createReplayOwner(accountId: string) {
  const previous = retiring.get(accountId);
  const views = new Map<symbol, { item: string | null; diagnostics?: ReplayDiagnostics }>();
  let disposed = false;
  let running = false;
  let requested = false;
  let draining = Promise.resolve();
  let job: Job | undefined;
  let activeItem: string | undefined;
  const foreground = (itemId: string) => [...views.values()].some((view) => view.item === itemId);
  const visible = () => document.visibilityState !== 'hidden' && navigator.onLine;
  const current = () => !disposed && views.size > 0;
  const admitted = () => current() && preparedAccount() === accountId && visible();
  const wake = () => {
    if (!admitted()) {
      void job?.stop();
      return;
    }
    requested = true;
    if (!running) draining = run();
  };
  async function run() {
    running = true;
    let acquired = false;
    try {
      await previous;
      if (!navigator.locks) return;
      await navigator.locks.request(
        `spinel-offline-replay:${accountId}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          acquired = true;
          await replayQueue();
        },
      );
    } catch {
      // Missing/denied storage never creates an empty replacement. A later
      // reconnect/foreground or independent durable change can retry admission.
    } finally {
      running = false;
      // A durable change may arrive after the queue's final check but before
      // Web Locks completes release. Preserve that wake without polling a lock
      // held by another tab: only the owner of the completed run may restart.
      if (acquired && requested && admitted()) draining = run();
    }
  }
  async function replayQueue() {
    while (requested && admitted()) {
      requested = false;
      const scope = offlinePreparation(accountId, current);
      const store = await openExistingOfflineStore(accountId);
      if (!store) return;
      const downloads = await store.downloads().finally(() => store.close());
      for (const download of downloads) {
        if (!admitted() || !scope.isCurrent()) return;
        if (
          !download.pending ||
          download.readOnly ||
          download.creation ||
          download.problem ||
          download.uncertain ||
          foreground(download.itemId)
        )
          continue;
        // Keep native packages out of the initial file-list load. Recheck the
        // lifetime and selected item after the asynchronous module boundary.
        const { replayOfflineItem } = await import('./replayHost.ts');
        if (!admitted() || !scope.isCurrent()) return;
        if (foreground(download.itemId)) continue;
        const observer = [...views].find(([, view]) => view.diagnostics);
        // Capture through one initiating subscription. A retiring job must not
        // bind observations to a replacement account or another mounted view.
        // Keep factory calls inside the optional observer's exception boundary.
        const diagnostics: DiagnosticSource | undefined = observer
          ? () => {
              if (!admitted() || !scope.isCurrent() || !views.has(observer[0])) return;
              return observer[1].diagnostics?.(download)?.();
            }
          : undefined;
        activeItem = download.itemId;
        job = replayOfflineItem(accountId, download, scope.isCurrent, diagnostics);
        try {
          await job.done;
        } catch {
          /* The existing durable recovery entry owns failures. */
        } finally {
          job = undefined;
          activeItem = undefined;
        }
      }
    }
  }
  const changes = watchOfflineChanges(accountId, (change) => {
    // The job's own checkpoint notifications cannot create an idle retry loop.
    if (change.itemId !== activeItem) wake();
  });
  const events = [
    'online',
    'offline',
    'focus',
    'pageshow',
    'storage',
    'spinel-offline-account-changed',
    'spinel-offline-prepared',
  ] as const;
  for (const event of events) window.addEventListener(event, wake);
  document.addEventListener('visibilitychange', wake);
  const owner = {
    subscribe(itemId: string | null, diagnostics?: ReplayDiagnostics) {
      const key = Symbol();
      let detached = false;
      views.set(key, { item: itemId, diagnostics });
      wake();
      return {
        foreground(item: string | null) {
          if (detached) return;
          views.set(key, { item, diagnostics });
          if (item && activeItem === item) void job?.stop();
          wake();
        },
        dispose() {
          if (detached) return;
          detached = true;
          views.delete(key);
          if (views.size) return;
          disposed = true;
          changes();
          for (const event of events) window.removeEventListener(event, wake);
          document.removeEventListener('visibilitychange', wake);
          void job?.stop();
          const drained = draining;
          retiring.set(accountId, drained);
          void drained.then(() => {
            if (retiring.get(accountId) === drained) retiring.delete(accountId);
          });
          if (owners.get(accountId) === owner) owners.delete(accountId);
        },
      };
    },
  };
  return owner;
}
