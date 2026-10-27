import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { claimDevice, openLocalStart } from '../../web/offline/localStart.ts';
import { api } from '../../web/api.ts';
import {
  OfflineStore,
  offlinePreparation,
  offlineEpoch,
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
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    }),
  );
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

test('same-account startup with no downloads preserves an existing live editor fence', async () => {
  const f = fixture();
  f.downloads.mockResolvedValue([]);
  await claimDevice(user);
  const live = offlinePreparation(user.id, () => true);
  const token = values.get('spinel.offline.cancellation');
  await claimDevice(user);
  expect(preparedAccount()).toBeNull();
  expect(values.get('spinel.offline.cancellation')).toBe(token);
  expect(live.isCurrent()).toBe(true);
});

test('another online account cancels live editors even when there are no downloads', async () => {
  const f = fixture();
  f.downloads.mockResolvedValue([]);
  await claimDevice(user);
  const live = offlinePreparation(user.id, () => true);
  await claimDevice({ id: 'another-account', name: 'Other', isAdmin: false });
  expect(preparedAccount()).toBeNull();
  expect(live.isCurrent()).toBe(false);
});

test.each(['headers', 'body'] as const)(
  'a session response held at %s cannot reclaim an earlier account after another tab switches',
  async (boundary) => {
    fixture();
    const held = deferred();
    const verify = offlineEpoch();
    vi.stubGlobal('fetch', async () => {
      if (boundary === 'headers') await held.promise;
      return {
        ok: true,
        status: 200,
        json: async () => {
          if (boundary === 'body') await held.promise;
          return { user };
        },
      };
    });
    const pending = api<{ user: typeof user }>('session', undefined, verify).then(({ user }) =>
      claimDevice(user),
    );
    await Promise.resolve();
    vi.resetModules();
    const otherTab = await import('../../web/offline/offlineStore.ts');
    otherTab.claimOnlineAccount('another-account');
    otherTab.setPreparedAccount('another-account');
    held.resolve();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(preparedAccount()).toBe('another-account');
  },
);

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

const catalog = { items: [], shared: [], views: {}, syncedAt: 1 };
function localFixture() {
  const f = fixture();
  vi.spyOn(OfflineStore.prototype, 'user').mockResolvedValue(user);
  vi.spyOn(OfflineStore.prototype, 'catalog').mockResolvedValue(catalog);
  return f;
}

test('local startup reads a legacy prepared catalog without writing storage', async () => {
  values.clear();
  values.set('spinel.offline.account', user.id);
  const f = localFixture();
  const write = vi.spyOn(window.localStorage, 'setItem');
  const start = await openLocalStart();
  expect(start).toMatchObject({ user, catalog, downloads: [download] });
  expect(start?.isCurrent()).toBe(true);
  expect(write).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(1);
  setPreparedAccount(null);
  expect(start?.isCurrent()).toBe(false);
});

test.each([
  ['database open', 'sign-out'],
  ['database open', 'account switch'],
  ['catalog reads', 'sign-out'],
  ['catalog reads', 'account switch'],
  ['catalog reads', 'sign-out and same-account return'],
] as const)('local startup held during %s discards titles after %s', async (boundary, change) => {
  vi.resetModules();
  const otherTab = await import('../../web/offline/offlineStore.ts');
  setPreparedAccount(user.id);
  const f = localFixture();
  const entered = deferred();
  const held = deferred();
  if (boundary === 'database open')
    f.open.mockImplementationOnce(() => {
      const request: { result: IDBDatabase; onsuccess?: () => void } = {
        result: { close: f.close } as unknown as IDBDatabase,
      };
      entered.resolve();
      void held.promise.then(() => request.onsuccess?.());
      return request;
    });
  else
    f.downloads.mockImplementationOnce(async () => {
      entered.resolve();
      await held.promise;
      return [download];
    });
  const pending = openLocalStart();
  await entered.promise;
  // No storage event is delivered: the read must inspect the persisted fence.
  otherTab.setPreparedAccount(change === 'account switch' ? 'another-account' : null);
  if (change === 'sign-out and same-account return') otherTab.setPreparedAccount(user.id);
  held.resolve();
  await expect(pending).resolves.toBeNull();
  expect(f.close).toHaveBeenCalledTimes(1);
  if (boundary === 'database open') expect(f.downloads).not.toHaveBeenCalled();
});

test('a local catalog retains its cancellation check after the read completes', async () => {
  vi.resetModules();
  const otherTab = await import('../../web/offline/offlineStore.ts');
  setPreparedAccount(user.id);
  localFixture();
  const start = await openLocalStart();
  expect(start?.isCurrent()).toBe(true);
  // App checks this again at publication and immediately after subscribing.
  otherTab.setPreparedAccount(null);
  otherTab.setPreparedAccount(user.id);
  expect(start?.isCurrent()).toBe(false);
});
