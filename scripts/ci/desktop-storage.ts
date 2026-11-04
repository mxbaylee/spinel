import type { DesktopBrowser } from './desktop-browser.ts';
import assert from 'node:assert/strict';

export function validateStorageLossHandles(before: unknown, after: unknown) {
  for (const handles of [before, after]) {
    assert.ok(Array.isArray(handles) && handles.length > 0);
    assert.ok(handles.every((handle) => typeof handle === 'string' && handle.length > 0));
    assert.equal(new Set(handles).size, handles.length, 'Duplicate window handles are ambiguous.');
  }
  assert.deepEqual(
    new Set(after as string[]),
    new Set(before as string[]),
    'Browser tabs changed during storage preparation.',
  );
}

export function validateStorageLossTabs(preparationURL: string, tabs: string[]) {
  assert.ok(tabs.length > 0, 'Storage preparation requires an observed browser tab.');
  const origin = new URL(preparationURL).origin;
  for (const url of tabs) {
    assert.equal(typeof url, 'string');
    assert.ok(url, 'An unreadable tab cannot establish storage quiescence.');
    if (new URL(url).origin === origin)
      assert.equal(url, preparationURL, 'Another fixture tab can still produce offline storage.');
  }
  assert.ok(tabs.includes(preparationURL), 'The inert fixture tab is missing.');
  return tabs;
}

// Serialized native Safari tab inventory. Only the owned fixture origin may be
// navigated, once per tab; subsequent observations never repeat navigation.
export const safariStorageLossTabsScript = String.raw`
function run(argv) {
  var app = Application(Number(argv[0]));
  var preparationURL = argv[1];
  var originPrefix = argv[2];
  function tabs() {
    var result = [];
    app.windows().forEach(function(window) {
      window.tabs().forEach(function(tab) { result.push(tab); });
    });
    return result;
  }
  var before = tabs().map(function(tab) { return tab.url(); });
  if (argv[3] === 'prepare') {
    tabs().forEach(function(tab) {
      var url = tab.url();
      if (url.indexOf(originPrefix) === 0 && url !== preparationURL) tab.url = preparationURL;
    });
  }
  var deadline = Date.now() + 2000;
  var after;
  do {
    after = tabs().map(function(tab) { return tab.url(); });
    if (after.every(function(url) { return url.indexOf(originPrefix) !== 0 || url === preparationURL; }))
      return JSON.stringify({ before: before, after: after });
    if (argv[3] !== 'prepare') break;
    delay(0.05);
  } while (Date.now() < deadline);
  throw new Error('Another fixture tab remains active: ' + JSON.stringify({ before: before, after: after }));
}`;

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
