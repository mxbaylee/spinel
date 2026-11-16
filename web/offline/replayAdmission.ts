const STOP_KEY = 'spinel.offline.replay-stop';
const gateName = (account: string, item: string) =>
  `spinel-offline-replay-admission:${JSON.stringify([account, item])}`;
const busy = () => new Error('Close this document in every tab before changing its device copy.');

/** The item writer remains authoritative; this gate only lets replay yield to it. */
export function createReplayAdmission(
  target: Pick<Window, 'addEventListener' | 'removeEventListener' | 'localStorage'>,
  locks: LockManager,
) {
  return {
    async replay<T>(
      account: string,
      item: string,
      stop: () => Promise<void>,
      work: () => Promise<T>,
    ) {
      const name = gateName(account, item);
      return locks.request(name, { mode: 'shared', ifAvailable: true }, async (lock) => {
        if (!lock) return;
        let active = true;
        const requested = async (event: Event) => {
          const { key, newValue } = event as StorageEvent;
          if (key !== STOP_KEY || !newValue) return;
          try {
            const request = JSON.parse(newValue);
            if (request.account !== account || request.item !== item) return;
            // Storage events can arrive late. Only a presently queued exclusive
            // reservation can interrupt this exact active replay lifetime.
            const state = await locks.query();
            if (
              active &&
              state.pending?.some((entry) => entry.name === name && entry.mode === 'exclusive')
            )
              await stop();
          } catch {
            // Failed delivery never authorizes another writer. Its bounded
            // admission aborts while this holder keeps the existing item lock.
          }
        };
        target.addEventListener('storage', requested);
        try {
          return await work();
        } finally {
          active = false;
          target.removeEventListener('storage', requested);
        }
      });
    },
    async foreground<T>(
      account: string,
      item: string,
      verify: () => void,
      stopLocal: () => Promise<void>,
      work: () => Promise<T>,
      kind: 'editor' | 'maintenance' = 'maintenance',
    ): Promise<T> {
      const name = gateName(account, item);
      const admitted = async () => {
        verify();
        await stopLocal();
        verify();
        return work();
      };
      const immediate = await locks.request(name, { ifAvailable: true }, async (lock) =>
        lock ? { value: await admitted() } : undefined,
      );
      if (immediate) return immediate.value;
      // Maintenance cannot interrupt another foreground operation. Editors may
      // join its bounded admission queue, then ask the real item writer for the
      // usual writable/read-only result without awaiting a live editor lifetime.
      const state = await locks.query();
      if (
        kind === 'maintenance' &&
        state.held?.some((entry) => entry.name === name && entry.mode === 'exclusive')
      )
        throw busy();
      verify();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(busy()), 5_000);
      const changed = () => {
        try {
          verify();
        } catch (error) {
          controller.abort(error);
        }
      };
      target.addEventListener('storage', changed);
      target.addEventListener('spinel-offline-account-changed', changed);
      // Enqueue BEFORE notifying. Awaiting the gate here would deadlock on the
      // replay whose stop message has not yet been sent. FIFO admission also
      // prevents a new shared replay from slipping into this handoff.
      const delivered = Promise.withResolvers<void>();
      const queued = locks.request(name, { signal: controller.signal }, async () => {
        await delivered.promise;
        controller.signal.throwIfAborted();
        return admitted();
      });
      // Observe rejection immediately, including synchronous transport denial.
      const result = queued.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      try {
        target.localStorage.setItem(
          STOP_KEY,
          JSON.stringify({ account, item, request: crypto.randomUUID() }),
        );
        delivered.resolve();
        void stopLocal().catch((error: unknown) => controller.abort(error));
        const outcome = await result;
        if ('error' in outcome) throw outcome.error;
        return outcome.value;
      } catch (error) {
        controller.abort(error);
        delivered.resolve();
        await result;
        throw error;
      } finally {
        clearTimeout(timeout);
        target.removeEventListener('storage', changed);
        target.removeEventListener('spinel-offline-account-changed', changed);
      }
    },
  };
}

export function offlineReplayAdmission() {
  return createReplayAdmission(window, navigator.locks);
}
