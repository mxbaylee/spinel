import type { DesktopBrowser } from './desktop-browser.ts';

export function unregisterDesktopStorageWorkers(
  browser: Pick<DesktopBrowser, 'evaluate'>,
  database: string,
  preparationURL: string,
) {
  return browser.evaluate<StorageDeletion>(
    `(${deleteDesktopStorage.toString()})(${JSON.stringify(database)}, ${JSON.stringify(preparationURL)}, "unregister")`,
  );
}

export function clearDesktopStorage(
  browser: Pick<DesktopBrowser, 'evaluate'>,
  database: string,
  preparationURL: string,
) {
  // One driver request only: an unresponsive/crashed page must not consume a
  // second script budget trying to recover diagnostic state.
  return browser.evaluate<StorageDeletion>(
    `(${deleteDesktopStorage.toString()})(${JSON.stringify(database)}, ${JSON.stringify(preparationURL)}, "delete")`,
  );
}

export type StorageDeletion = {
  status: 'running' | 'passed' | 'failed';
  database: string;
  phase: 'unregister' | 'delete';
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
  preparationURL: string,
  phase: 'unregister' | 'delete',
): Promise<StorageDeletion> {
  const report: StorageDeletion = {
    status: 'running',
    database,
    phase,
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
    await step('verify-preparation-document', () => {
      const state = {
        url: location.href,
        marker: document.body.dataset.spinelStorageLoss,
        scripts: document.scripts.length,
      };
      if (state.url !== preparationURL || state.marker !== 'inert' || state.scripts !== 0)
        throw new Error(
          `Storage preparation requires the inert fixture document: ${JSON.stringify(state)}`,
        );
      return state;
    });
    const registrations = await step('serviceWorker.getRegistrations', () =>
      navigator.serviceWorker.getRegistrations(),
    );
    // Native objects are not serializable evidence; record their stable identities.
    report.operations.at(-1)!.value = registrations.map((registration) => registration.scope);
    if (phase === 'unregister') {
      for (const registration of registrations) {
        await step(`serviceWorker.unregister:${registration.scope}`, async () => {
          if (!(await registration.unregister())) throw new Error('Worker was not unregistered');
          return true;
        });
      }
      await step('verify-unregistered', async () => {
        const workers = (await navigator.serviceWorker.getRegistrations()).map(
          (entry) => entry.scope,
        );
        if (workers.length)
          throw new Error(`Workers remain registered: ${JSON.stringify(workers)}`);
        return { workers, controller: navigator.serviceWorker.controller?.scriptURL ?? null };
      });
      // The old controlled document/worker may still execute. The caller must
      // witness browser shutdown and reopen this inert URL before deletion.
      report.status = 'passed';
      return report;
    }
    await step('verify-uncontrolled', () => {
      const state = {
        workers: registrations.map((entry) => entry.scope),
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      };
      if (state.workers.length || state.controller !== null)
        throw new Error(`Storage producers are still present: ${JSON.stringify(state)}`);
      return state;
    });
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
