import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { claimDevice, openLocalStart } from '../../web/offline/localStart.ts';
import { api } from '../../web/api.ts';
import {
  OfflineStore,
  claimOnlineAccount,
  offlinePreparation,
  offlineEpoch,
  preparedAccount,
  setPreparedAccount,
} from '../../web/offline/offlineStore.ts';
import { readDeviceInventory } from '../../web/offline/deviceStorage.ts';
import type { OfflineDownload } from '../../web/offline/offlineStore.ts';

vi.mock('../../web/maintenanceState.ts', () => import('./fixtures/unsupervisedMaintenance.ts'));

vi.mock('../../web/offline/deviceStorage.ts', () => ({ readDeviceInventory: vi.fn() }));
const user = { id: 'owner', name: 'Owner', isAdmin: false };
const download: OfflineDownload = {
  itemId: 'notes',
  name: 'Notes',
  kind: 'doc',
  readOnly: false,
  revision: 1,
  downloadedAt: 1,
};
const retained = { kind: 'retained' as const, compatibility: { format: 1, sdkVersion: '1.1.0' } };
const catalog = { items: [], shared: [], views: {}, syncedAt: 1 };
let values: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://spinel.test', pathname: '/' });
  values = new Map();
  vi.stubGlobal('navigator', {});
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
  vi.mocked(readDeviceInventory).mockReset();
  vi.mocked(readDeviceInventory).mockResolvedValue({
    state: 'ready',
    items: [{ ...download, available: true, bytes: 10 }],
    bytes: 10,
    origin: {},
    persistence: 'not-requested',
  });
  setPreparedAccount(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Only storage boundaries are simulated. The noncreating open and account fences are real. */
function fixture() {
  const close = vi.fn();
  const database = {
    close,
    version: 1,
    objectStoreNames: { contains: (name: string) => ['meta', 'items', 'images'].includes(name) },
  } as unknown as IDBDatabase;
  const open = vi.fn(() => {
    const request: { result: IDBDatabase; onsuccess?: () => void } = { result: database };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  });
  const discovery = vi.fn();
  vi.stubGlobal('indexedDB', { databases: discovery, open });
  const requirement = vi
    .spyOn(OfflineStore.prototype, 'runtimeRequirement')
    .mockResolvedValue(retained);
  const saveCatalog = vi.spyOn(OfflineStore.prototype, 'saveCatalog').mockResolvedValue(undefined);
  const holdOpen = (entered: ReturnType<typeof deferred>, held: ReturnType<typeof deferred>) => {
    open.mockImplementationOnce(() => {
      const request: { result: IDBDatabase; onsuccess?: () => void } = { result: database };
      entered.resolve();
      void held.promise.then(() => request.onsuccess?.());
      return request;
    });
  };
  return { open, close, database, discovery, requirement, saveCatalog, holdOpen };
}

test('startup claims compatible existing downloads without creating or rewriting a catalog', async () => {
  const f = fixture();
  await claimDevice(user);
  expect(preparedAccount()).toBe(user.id);
  expect(f.open).toHaveBeenCalledWith('spinel-offline-owner');
  expect(f.discovery).not.toHaveBeenCalled();
  expect(f.requirement).toHaveBeenCalledTimes(1);
  expect(f.saveCatalog).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(1);
});

test('an obsolete sign-in attempt cannot prepare the device after a delayed database read', async () => {
  const f = fixture();
  const entered = deferred(),
    held = deferred();
  let current = true;
  f.requirement.mockImplementationOnce(async () => {
    entered.resolve();
    await held.promise;
    return retained;
  });
  const claim = claimDevice(user, () => current);
  await entered.promise;
  current = false;
  held.resolve();
  await claim;
  expect(preparedAccount()).toBeNull();
  expect(f.close).toHaveBeenCalledTimes(1);
});

test('same-account startup with no downloads preserves an existing live editor fence', async () => {
  const f = fixture();
  f.requirement.mockResolvedValue({ kind: 'empty' });
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
  f.requirement.mockResolvedValue({ kind: 'empty' });
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
  ['database open', 'sign-out'],
  ['database open', 'account switch'],
  ['download lookup', 'sign-out'],
  ['download lookup', 'account switch'],
] as const)(
  'startup held during %s cannot publish after another tab performs %s',
  async (boundary, change) => {
    vi.resetModules();
    const otherTab = await import('../../web/offline/offlineStore.ts');
    expect(otherTab.offlinePreparation).not.toBe(offlinePreparation);
    setPreparedAccount(user.id);
    const f = fixture(),
      entered = deferred(),
      held = deferred();
    if (boundary === 'database open') f.holdOpen(entered, held);
    else
      f.requirement.mockImplementationOnce(async () => {
        entered.resolve();
        await held.promise;
        return retained;
      });
    const pending = claimDevice(user);
    await entered.promise;
    // No storage event: publication must inspect the persisted nonce.
    const expectedAccount = change === 'sign-out' ? null : 'another-account';
    otherTab.setPreparedAccount(expectedAccount);
    held.resolve();
    await pending;
    expect(preparedAccount()).toBe(expectedAccount);
    expect(f.saveCatalog).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledTimes(1);
    if (boundary === 'database open') expect(f.requirement).not.toHaveBeenCalled();
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

function localFixture() {
  const f = fixture();
  vi.spyOn(OfflineStore.prototype, 'user').mockResolvedValue(user);
  vi.spyOn(OfflineStore.prototype, 'catalog').mockResolvedValue(catalog);
  return f;
}

test('local startup reads a legacy prepared catalog without writing localStorage', async () => {
  values.clear();
  values.set('spinel.offline.account', user.id);
  const f = localFixture();
  const write = vi.spyOn(window.localStorage, 'setItem');
  const start = await openLocalStart();
  expect(start).toMatchObject({ user, catalog, downloads: [download] });
  expect(start?.isCurrent()).toBe(true);
  expect(write).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(f.open.mock.calls.length);
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
  const f = localFixture(),
    entered = deferred(),
    held = deferred();
  if (boundary === 'database open') f.holdOpen(entered, held);
  else
    vi.mocked(readDeviceInventory).mockImplementationOnce(async () => {
      entered.resolve();
      await held.promise;
      return {
        state: 'ready',
        items: [{ ...download, available: true, bytes: 10 }],
        bytes: 10,
        origin: {},
        persistence: 'not-requested',
      };
    });
  const pending = openLocalStart();
  await entered.promise;
  otherTab.setPreparedAccount(change === 'account switch' ? 'another-account' : null);
  if (change === 'sign-out and same-account return') otherTab.setPreparedAccount(user.id);
  held.resolve();
  await expect(pending).resolves.toBeNull();
  expect(f.close).toHaveBeenCalledTimes(f.open.mock.calls.length);
  if (boundary === 'database open') expect(readDeviceInventory).not.toHaveBeenCalled();
});

test('a local catalog retains its cancellation check after the read completes', async () => {
  vi.resetModules();
  const otherTab = await import('../../web/offline/offlineStore.ts');
  setPreparedAccount(user.id);
  localFixture();
  const start = await openLocalStart();
  expect(start?.isCurrent()).toBe(true);
  otherTab.setPreparedAccount(null);
  otherTab.setPreparedAccount(user.id);
  expect(start?.isCurrent()).toBe(false);
});

test('retiring the pre-exposure admission lifetime does not retire the published local session', async () => {
  setPreparedAccount(user.id);
  localFixture();
  let admitting = true;
  const start = await openLocalStart(() => admitting);
  expect(start?.isCurrent()).toBe(true);
  admitting = false;
  expect(start?.isCurrent()).toBe(true);
  setPreparedAccount(null);
  expect(start?.isCurrent()).toBe(false);
});

test('a late catalog cannot publish after the host permits online fallback', async () => {
  setPreparedAccount(user.id);
  const f = localFixture(),
    entered = deferred(),
    held = deferred();
  let admitting = true;
  vi.mocked(readDeviceInventory).mockImplementationOnce(async () => {
    entered.resolve();
    await held.promise;
    return { state: 'ready', items: [], bytes: 0, origin: {}, persistence: 'not-requested' };
  });
  const pending = openLocalStart(() => admitting);
  await entered.promise;
  admitting = false;
  held.resolve();
  expect(await pending).toBeNull();
  expect(f.close).toHaveBeenCalledTimes(f.open.mock.calls.length);
  expect(preparedAccount()).toBe(user.id);
});

test('an incompatible same-account runtime cannot claim data or cancel a compatible old tab', async () => {
  setPreparedAccount(user.id);
  const f = fixture();
  f.requirement.mockResolvedValue({
    kind: 'retained',
    compatibility: { format: 2, sdkVersion: '2.0.0' },
  });
  const oldTab = offlinePreparation(user.id, () => true);
  const nonce = values.get('spinel.offline.cancellation');
  await claimDevice(user);
  expect(preparedAccount()).toBe(user.id);
  expect(values.get('spinel.offline.cancellation')).toBe(nonce);
  expect(oldTab.isCurrent()).toBe(true);
  expect(f.saveCatalog).not.toHaveBeenCalled();
});

test('unknown retained data cannot expose a local catalog', async () => {
  setPreparedAccount(user.id);
  const f = localFixture();
  f.requirement.mockResolvedValue({ kind: 'unknown' });
  expect(await openLocalStart()).toBeNull();
  expect(readDeviceInventory).not.toHaveBeenCalled();
  expect(preparedAccount()).toBe(user.id);
});

test('an account-bound security action checks its epoch before sending', async () => {
  claimOnlineAccount(user.id);
  const check = offlineEpoch();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  claimOnlineAccount('another-account');
  await expect(api('sign-out-others', {}, check, { accountId: user.id })).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(fetch).not.toHaveBeenCalled();
});

test('a retired passkey read cannot redirect a newer sign-in when its headers arrive', async () => {
  const held = deferred();
  const assign = vi.fn();
  vi.stubGlobal('location', {
    origin: 'https://spinel.test',
    pathname: '/profile',
    search: '',
    assign,
  });
  let current = true;
  const check = () => {
    if (!current) throw new DOMException('Retired profile read.', 'AbortError');
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    await held.promise;
    return Response.json({ error: 'Expired' }, { status: 401 });
  });
  vi.stubGlobal('fetch', fetch);
  const pending = api('passkeys', undefined, check, { accountId: user.id });
  current = false;
  held.resolve();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(assign).not.toHaveBeenCalled();
  expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('X-Spinel-Account')).toBe(user.id);
});

test('a passkey response body cannot publish after the account changes', async () => {
  const held = deferred();
  claimOnlineAccount(user.id);
  const check = offlineEpoch();
  const publish = vi.fn();
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => {
      await held.promise;
      return { passkeys: [{ name: 'Old account key' }] };
    },
  }));
  const pending = api('passkeys', undefined, check, { accountId: user.id }).then(publish);
  await Promise.resolve();
  claimOnlineAccount('another-account');
  held.resolve();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(publish).not.toHaveBeenCalled();
});
