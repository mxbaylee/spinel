import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { claimDevice } from '../../web/offline/localStart.ts';
import {
  OfflineStore,
  offlinePreparation,
  preparedAccount,
  setPreparedAccount,
} from '../../web/offline/offlineStore.ts';
import type { OfflineDownload } from '../../web/offline/offlineStore.ts';

const user = { id: 'owner', name: 'Owner', isAdmin: false };
const download: OfflineDownload = {
  itemId: 'notes',
  name: 'Notes',
  kind: 'doc',
  readOnly: false,
  revision: 1,
  downloadedAt: 1,
};
const databases: IDBDatabaseInfo[] = [{ name: 'spinel-offline-owner', version: 1 }];
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  setPreparedAccount(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

/** Only the IndexedDB boundary is simulated; claimDevice and its fence are real. */
function fixture() {
  const close = vi.fn();
  const database = { close } as unknown as IDBDatabase;
  const open = vi.fn(() => {
    const request: { result: IDBDatabase; onsuccess?: () => void } = { result: database };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  });
  const discovery = vi.fn(async () => databases);
  vi.stubGlobal('indexedDB', { databases: discovery, open });
  const downloads = vi.spyOn(OfflineStore.prototype, 'downloads').mockResolvedValue([download]);
  const saveCatalog = vi.spyOn(OfflineStore.prototype, 'saveCatalog').mockResolvedValue(undefined);
  return { open, close, discovery, downloads, saveCatalog };
}

test('startup claims existing downloads without rewriting their catalog', async () => {
  const f = fixture();
  await claimDevice(user);
  expect(preparedAccount()).toBe(user.id);
  expect(f.open).toHaveBeenCalledWith('spinel-offline-owner', 1);
  expect(f.downloads).toHaveBeenCalledTimes(1);
  expect(f.saveCatalog).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(1);
});

test.each([
  ['database discovery', 'sign-out'],
  ['database discovery', 'account switch'],
  ['download lookup', 'sign-out'],
  ['download lookup', 'account switch'],
] as const)(
  'startup held during %s cannot publish after another tab performs %s',
  async (boundary, change) => {
    vi.resetModules();
    const otherTab = await import('../../web/offline/offlineStore.ts');
    expect(otherTab.offlinePreparation).not.toBe(offlinePreparation);
    setPreparedAccount(user.id);
    const f = fixture();
    const entered = deferred();
    const held = deferred();
    if (boundary === 'database discovery')
      f.discovery.mockImplementationOnce(async () => {
        entered.resolve();
        await held.promise;
        return databases;
      });
    else
      f.downloads.mockImplementationOnce(async () => {
        entered.resolve();
        await held.promise;
        return [download];
      });
    const pending = claimDevice(user);
    await entered.promise;
    // Separate module epochs and no storage event: publication must inspect the
    // durable token before it can reclaim a marker after startup's async work.
    const expectedAccount = change === 'sign-out' ? null : 'another-account';
    otherTab.setPreparedAccount(expectedAccount);
    held.resolve();
    await pending;
    expect(preparedAccount()).toBe(expectedAccount);
    expect(f.saveCatalog).not.toHaveBeenCalled();
    if (boundary === 'database discovery') {
      expect(f.open).not.toHaveBeenCalled();
      expect(f.downloads).not.toHaveBeenCalled();
    } else expect(f.close).toHaveBeenCalledTimes(1);
  },
);

test('blocked offline storage does not prevent online startup or begin database work', async () => {
  const f = fixture();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Storage blocked', 'SecurityError');
    },
  });
  await expect(claimDevice(user)).resolves.toBeUndefined();
  expect(f.discovery).not.toHaveBeenCalled();
  expect(f.open).not.toHaveBeenCalled();
  expect(f.saveCatalog).not.toHaveBeenCalled();
  expect(values.has('spinel.offline.account')).toBe(false);
});
