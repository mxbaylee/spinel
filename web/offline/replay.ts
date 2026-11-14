import {
  offlinePreparation,
  openExistingOfflineStore,
  preparedAccount,
  watchOfflineChanges,
} from './offlineStore.ts';

type Job = { stop(): Promise<void>; done: Promise<void> };
type Owner = ReturnType<typeof createReplayOwner>;
const owners = new Map<string, Owner>();
const retiring = new Map<string, Promise<void>>();

/** Multiple file-list surfaces share one account-scoped, event-driven owner. */
export function watchOfflineReplay(accountId: string, foregroundItem: string | null) {
  let owner = owners.get(accountId);
  if (!owner) {
    owner = createReplayOwner(accountId);
    owners.set(accountId, owner);
  }
  return owner.subscribe(foregroundItem);
}

function createReplayOwner(accountId: string) {
  const previous = retiring.get(accountId);
  const views = new Map<symbol, string | null>();
  let disposed = false;
  let running = false;
  let requested = false;
  let draining = Promise.resolve();
  let job: Job | undefined;
  let activeItem: string | undefined;
  const foreground = (itemId: string) => [...views.values()].includes(itemId);
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
    try {
      await previous;
      if (!navigator.locks) return;
      await navigator.locks.request(
        `spinel-offline-replay:${accountId}`,
        { ifAvailable: true },
        async (lock) => {
          if (lock) await replayQueue();
        },
      );
    } catch {
      // Missing/denied storage never creates an empty replacement. A later
      // reconnect/foreground or independent durable change can retry admission.
    } finally {
      running = false;
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
        activeItem = download.itemId;
        job = replayOfflineItem(accountId, download, scope.isCurrent);
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
    subscribe(itemId: string | null) {
      const key = Symbol();
      let detached = false;
      views.set(key, itemId);
      wake();
      return {
        foreground(item: string | null) {
          if (detached) return;
          views.set(key, item);
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
