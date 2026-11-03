import type { DesktopBrowser } from './desktop-browser.ts';

export function clearDesktopStorage(browser: Pick<DesktopBrowser, 'evaluate'>, database: string) {
  // One driver request only: an unresponsive/crashed page must not consume a
  // second script budget trying to recover diagnostic state.
  return browser.evaluate<StorageDeletion>(
    `(${deleteDesktopStorage.toString()})(${JSON.stringify(database)})`,
  );
}

export type StorageDeletion = {
  status: 'running' | 'passed' | 'failed';
  database: string;
  timeoutMs: number;
  operations: Array<{
    name: string;
    startedAt: string;
    elapsedMs?: number;
    status: 'pending' | 'passed' | 'failed';
    value?: unknown;
    error?: string;
  }>;
  error?: string;
};

// Serialized into the real browser page. Keep this function self-contained.
// Leave two seconds within the existing 30-second driver bound to return evidence.
export async function deleteDesktopStorage(database: string): Promise<StorageDeletion> {
  const report: StorageDeletion = {
    status: 'running',
    database,
    timeoutMs: 28_000,
    operations: [],
  };
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Storage deletion deadline exceeded')),
      report.timeoutMs,
    );
  });
  async function step<T>(name: string, action: () => T | Promise<T>): Promise<T> {
    const operation: StorageDeletion['operations'][number] = {
      name,
      startedAt: new Date().toISOString(),
      status: 'pending',
    };
    report.operations.push(operation);
    const started = performance.now();
    try {
      const value = await Promise.race([action(), deadline]);
      operation.value = value;
      operation.status = 'passed';
      return value;
    } catch (error) {
      operation.status = 'failed';
      operation.error = String(error);
      throw new Error(`${name}: ${String(error)}`, { cause: error });
    } finally {
      operation.elapsedMs = Math.round(performance.now() - started);
    }
  }
  try {
    // A loaded app page rewrites its localStorage keys, which raced the empty-storage
    // check (Firefox, run 41684932652), so deletion only runs on a script-free page.
    await step('verify-no-page-scripts', () => {
      if (document.scripts.length) throw new Error('A page with scripts is still loaded');
      return location.pathname;
    });
    const registrations = await step('serviceWorker.getRegistrations', () =>
      navigator.serviceWorker.getRegistrations(),
    );
    // Native objects are not serializable evidence; record their stable identities.
    report.operations.at(-1)!.value = registrations.map((registration) => registration.scope);
    for (const registration of registrations) {
      await step(`serviceWorker.unregister:${registration.scope}`, async () => {
        if (!(await registration.unregister())) throw new Error('Worker was not unregistered');
        return true;
      });
    }
    const keys = await step('caches.keys', () => caches.keys());
    for (const key of keys) {
      await step(`caches.delete:${key}`, async () => {
        if (!(await caches.delete(key))) throw new Error('Cache was not deleted');
        return true;
      });
    }
    await step('localStorage.clear', () => {
      localStorage.clear();
      return localStorage.length;
    });
    await step(
      `indexedDB.deleteDatabase:${database}`,
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(database);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('Private database is still open'));
        }),
    );
    const workers = await step('verify-service-workers', async () =>
      (await navigator.serviceWorker.getRegistrations()).map((entry) => entry.scope),
    );
    const cacheNames = await step('verify-cache-names', () => caches.keys());
    const databases = await step('verify-database-names', async () =>
      (await indexedDB.databases()).map((entry) => entry.name),
    );
    await step('verify-storage-empty', () => {
      const state = {
        workers,
        cacheNames,
        databases,
        localStorageEntries: localStorage.length,
        // Names only, so a leftover entry can be attributed without retaining values.
        localStorageKeys: Array.from({ length: localStorage.length }, (_, index) =>
          localStorage.key(index),
        ),
      };
      if (
        workers.length ||
        cacheNames.length ||
        databases.includes(database) ||
        localStorage.length
      )
        throw new Error(`Storage remains after deletion: ${JSON.stringify(state)}`);
      return state;
    });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error);
  } finally {
    clearTimeout(timer!);
  }
  return report;
}
