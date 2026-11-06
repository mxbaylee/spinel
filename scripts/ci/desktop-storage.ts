import type { DesktopBrowser } from './desktop-browser.ts';

export async function clearDesktopStorage(
  browser: Pick<DesktopBrowser, 'goto' | 'evaluate'>,
  database: string,
  page: string,
) {
  // Unload the application before deleting its stores: a live page can write
  // between localStorage.clear() and the asynchronous IndexedDB verification.
  await browser.goto(page);
  // One driver request only: an unresponsive/crashed page must not consume a
  // second script budget trying to recover diagnostic state.
  return browser.evaluate<StorageDeletion>(
    `(${deleteDesktopStorage.toString()})(${JSON.stringify(database)},${JSON.stringify(page)})`,
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
export async function deleteDesktopStorage(
  database: string,
  page: string,
): Promise<StorageDeletion> {
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
    await step('verify-inert-page', () => {
      const state = {
        url: location.href,
        marked: document.documentElement.hasAttribute('data-desktop-storage-clear'),
        scripts: document.scripts.length,
      };
      if (state.url !== page || !state.marked || state.scripts)
        throw new Error(
          `Storage deletion requires the inert fixture page: ${JSON.stringify(state)}`,
        );
      return state;
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
      const state = { workers, cacheNames, databases, localStorageEntries: localStorage.length };
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
