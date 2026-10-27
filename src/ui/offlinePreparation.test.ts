import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  offlinePreparation,
  offlineAccountRead,
  offlineEpoch,
  claimOnlineAccount,
  expirePreparedAccount,
  preparedAccount,
  setPreparedAccount,
  watchOfflineAccount,
} from '../../web/offline/offlineStore.ts';
import type {
  OfflineCatalog,
  OfflineDownload,
  OfflineUser,
} from '../../web/offline/offlineStore.ts';

const catalog: OfflineCatalog = { syncedAt: 1, items: [], shared: [], views: {} };
const user = { id: 'owner', name: 'Owner' };
let values: Map<string, string>;
let surface: EventTarget;

beforeEach(() => {
  values = new Map();
  surface = new EventTarget();
  vi.stubGlobal(
    'window',
    Object.assign(surface, {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function delayedCatalog(accountId = user.id) {
  const committed = deferred<void>();
  const saved: OfflineCatalog[] = [];
  const saveCatalog = vi.fn(async (_user: OfflineUser, value: OfflineCatalog) => {
    await committed.promise;
    saved.push(value);
  });
  return { committed, saved, store: { accountId, saveCatalog } };
}

const storageSize = (entries: Map<string, string> = values) =>
  [...entries].reduce((size, [key, value]) => size + key.length + value.length, 0);

/** Existing data remains readable; shrinking/deleting it frees quota for later writes. */
function limitStorage(maximum: number) {
  vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
    const next = new Map(values).set(key, value);
    if (storageSize(next) > maximum) throw new DOMException('Storage full', 'QuotaExceededError');
    values.set(key, value);
  });
}

test('preparation publishes its account only after its catalog durably completes', async () => {
  const fixture = delayedCatalog();
  const completion = offlinePreparation(user.id, () => true).finish(fixture.store, user, catalog);
  expect(fixture.store.saveCatalog).toHaveBeenCalledWith(user, catalog);
  expect(fixture.saved).toEqual([]);
  expect(preparedAccount()).toBeNull();
  fixture.committed.resolve();
  await expect(completion).resolves.toBe(true);
  expect(fixture.saved).toEqual([catalog]);
  expect(preparedAccount()).toBe(user.id);
});

test.each(['unmount', 'other account', 'same account remount'] as const)(
  'a delayed catalog completion after %s cannot activate an obsolete preparation',
  async (change) => {
    const lifetime = { accountId: user.id };
    let mounted: typeof lifetime | null = lifetime;
    let currentAccount = user.id;
    const scope = offlinePreparation(
      user.id,
      () => mounted === lifetime && currentAccount === user.id,
    );
    const fixture = delayedCatalog();
    const completion = scope.finish(fixture.store, user, catalog);
    if (change === 'unmount') mounted = null;
    else if (change === 'other account') {
      currentAccount = 'another-account';
      mounted = { accountId: currentAccount };
      setPreparedAccount(currentAccount);
    } else mounted = { accountId: user.id };
    fixture.committed.resolve();
    await expect(completion).resolves.toBe(false);
    expect(preparedAccount()).toBe(change === 'other account' ? currentAccount : null);
    expect(fixture.saved).toEqual([catalog]); // The prior account's already-started write may finish.
  },
);

test('sign-out cancels a first delayed preparation even before the still-mounted component has a marker', async () => {
  const scope = offlinePreparation(user.id, () => true);
  const fixture = delayedCatalog();
  const completion = scope.finish(fixture.store, user, catalog);
  expect(preparedAccount()).toBeNull();
  setPreparedAccount(null); // App.signOut runs before awaiting the HTTP response/unmount.
  fixture.committed.resolve();
  await expect(completion).resolves.toBe(false);
  expect(preparedAccount()).toBeNull();
});

test('a delayed old preparation cannot replace a newer account, even if its component is still present', async () => {
  const fixture = delayedCatalog();
  const completion = offlinePreparation(user.id, () => true).finish(fixture.store, user, catalog);
  setPreparedAccount('new-account');
  fixture.committed.resolve();
  await expect(completion).resolves.toBe(false);
  expect(preparedAccount()).toBe('new-account');
});

test('an empty-store result from before an account switch cannot clear the new account marker', async () => {
  setPreparedAccount(user.id);
  const remaining = deferred<OfflineDownload[]>();
  const scope = offlinePreparation(user.id, () => true);
  const cleared = scope.clearIfEmpty({ accountId: user.id, downloads: () => remaining.promise });
  setPreparedAccount('new-account');
  remaining.resolve([]);
  await cleared;
  expect(preparedAccount()).toBe('new-account');
});

test('an old same-account mount cannot clear a newly prepared copy after its delayed removal check', async () => {
  setPreparedAccount(user.id);
  let mounted = true;
  const remaining = deferred<OfflineDownload[]>();
  const cleared = offlinePreparation(user.id, () => mounted).clearIfEmpty({
    accountId: user.id,
    downloads: () => remaining.promise,
  });
  mounted = false;
  const next = delayedCatalog();
  const prepared = offlinePreparation(user.id, () => true).finish(next.store, user, catalog);
  next.committed.resolve();
  await prepared;
  remaining.resolve([]);
  await cleared;
  expect(preparedAccount()).toBe(user.id);
});

test('removing the final current-account copy clears only its own marker and allows its status to complete', async () => {
  setPreparedAccount(user.id);
  const scope = offlinePreparation(user.id, () => true);
  await scope.clearIfEmpty({ accountId: user.id, downloads: async () => [] });
  expect(preparedAccount()).toBeNull();
  expect(scope.isCurrent()).toBe(true);
});

test('removing the final download does not cancel unrelated live editor queues in either tab', async () => {
  setPreparedAccount(user.id);
  const live = offlinePreparation(user.id, () => true);
  const local = offlineAccountRead(user.id);
  const stop = watchOfflineAccount();
  try {
    await offlinePreparation(user.id, () => true).clearIfEmpty({
      accountId: user.id,
      downloads: async () => [],
    });
    expect(preparedAccount()).toBeNull();
    expect(live.isCurrent()).toBe(true);
    expect(local()).toBe(false);
    // The other tab observes only a clean-marker removal, not a sign-out nonce.
    surface.dispatchEvent(
      Object.assign(new Event('storage'), {
        key: 'spinel.offline.account',
        oldValue: user.id,
        newValue: null,
      }),
    );
    expect(live.isCurrent()).toBe(true);
    setPreparedAccount(null); // Actual sign-out still invalidates every editor.
    expect(live.isCurrent()).toBe(false);
  } finally {
    stop();
  }
});

test('failed catalog persistence never marks a device prepared', async () => {
  const fixture = delayedCatalog();
  const completion = offlinePreparation(user.id, () => true).finish(fixture.store, user, catalog);
  fixture.committed.reject(new Error('Storage full'));
  await expect(completion).rejects.toThrow('Storage full');
  expect(preparedAccount()).toBeNull();
});

test('a cancelled queued preparation never starts a catalog write', async () => {
  const fixture = delayedCatalog();
  const scope = offlinePreparation(user.id, () => false);
  await expect(scope.finish(fixture.store, user, catalog)).resolves.toBe(false);
  expect(fixture.store.saveCatalog).not.toHaveBeenCalled();
});

test('a sign-out storage event from another tab cancels an in-flight catalog completion', async () => {
  setPreparedAccount(user.id);
  const stop = watchOfflineAccount();
  try {
    const fixture = delayedCatalog();
    const completion = offlinePreparation(user.id, () => true).finish(fixture.store, user, catalog);
    values.delete('spinel.offline.account'); // Another tab bypasses this module's setter.
    surface.dispatchEvent(Object.assign(new Event('storage'), { key: 'spinel.offline.account' }));
    fixture.committed.resolve();
    await expect(completion).resolves.toBe(false);
    expect(preparedAccount()).toBeNull();
  } finally {
    stop();
  }
});

test('completion refuses mismatched catalog and storage accounts before either can be written', async () => {
  const fixture = delayedCatalog('another-account');
  const scope = offlinePreparation(user.id, () => true);
  await expect(scope.finish(fixture.store, user, catalog)).rejects.toThrow('another account');
  await expect(
    scope.finish(delayedCatalog().store, { ...user, id: 'another-account' }, catalog),
  ).rejects.toThrow('another account');
  expect(fixture.store.saveCatalog).not.toHaveBeenCalled();
  expect(preparedAccount()).toBeNull();
});

test('a legacy prepared account persists a cancellation token before starting a new preparation', async () => {
  values.clear();
  values.set('spinel.offline.account', user.id);
  const fixture = delayedCatalog();
  const scope = offlinePreparation(user.id, () => true);
  expect(values.get('spinel.offline.cancellation')).toBeTypeOf('string');
  const completion = scope.finish(fixture.store, user, catalog);
  fixture.committed.resolve();
  await expect(completion).resolves.toBe(true);
  expect(preparedAccount()).toBe(user.id);
});

test('a full legacy store with an account but no cancellation token refuses preparation before a catalog write', async () => {
  values.clear();
  values.set('spinel.offline.account', user.id);
  limitStorage(storageSize());
  const fixture = delayedCatalog();
  const start = async () =>
    offlinePreparation(user.id, () => true).finish(fixture.store, user, catalog);
  await expect(start()).rejects.toThrow('Offline downloads need browser storage.');
  expect(fixture.store.saveCatalog).not.toHaveBeenCalled();
  expect(values.has('spinel.offline.cancellation')).toBe(false);
  expect(preparedAccount()).toBe(user.id);
});

test('blocked browser storage reports a preparation failure before a catalog write', async () => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Storage blocked', 'SecurityError');
    },
  });
  const fixture = delayedCatalog();
  const start = async () =>
    offlinePreparation(user.id, () => true).finish(fixture.store, user, catalog);
  await expect(start()).rejects.toThrow('Offline downloads need browser storage.');
  expect(fixture.store.saveCatalog).not.toHaveBeenCalled();
});

// Separate module instances have separate epochs, like independent tabs. Storage
// events deliberately run only after finish(), so only the persisted fence can win.
test.each(['first preparation', 'full quota', 'reduced quota after preparation'] as const)(
  'another tab signing out with %s cannot be undone before its storage event arrives',
  async (condition) => {
    vi.resetModules();
    const otherTab = await import('../../web/offline/offlineStore.ts');
    expect(otherTab.offlinePreparation).not.toBe(offlinePreparation);
    if (condition !== 'first preparation') setPreparedAccount(user.id);
    const stop = watchOfflineAccount();
    try {
      const fixture = delayedCatalog();
      const scope = offlinePreparation(user.id, () => true);
      const token = values.get('spinel.offline.cancellation');
      const completion = scope.finish(fixture.store, user, catalog);
      expect(fixture.store.saveCatalog).toHaveBeenCalledWith(user, catalog);
      if (condition !== 'first preparation')
        limitStorage(storageSize() - (condition === 'reduced quota after preparation' ? 1 : 0));
      expect(() => otherTab.setPreparedAccount(null)).not.toThrow();
      expect(preparedAccount()).toBeNull();
      if (condition === 'reduced quota after preparation')
        expect(values.has('spinel.offline.cancellation')).toBe(false);
      else {
        expect(values.get('spinel.offline.cancellation')).toBeTypeOf('string');
        expect(values.get('spinel.offline.cancellation')).not.toBe(token);
      }
      expect(scope.isMounted()).toBe(true);
      fixture.committed.resolve();
      await expect(completion).resolves.toBe(false);
      expect(fixture.saved).toEqual([catalog]);
      expect(preparedAccount()).toBeNull();
      surface.dispatchEvent(
        Object.assign(new Event('storage'), { key: 'spinel.offline.cancellation' }),
      );
      surface.dispatchEvent(Object.assign(new Event('storage'), { key: 'spinel.offline.account' }));
      expect(preparedAccount()).toBeNull();
    } finally {
      stop();
    }
  },
);

test('every sign-out publishes a new cancellation even with no prepared account', () => {
  const before = values.get('spinel.offline.cancellation');
  setPreparedAccount(null);
  const first = values.get('spinel.offline.cancellation');
  expect(first).toBeTypeOf('string');
  expect(first).not.toBe(before);
  setPreparedAccount(null);
  expect(values.get('spinel.offline.cancellation')).not.toBe(first);
  expect(preparedAccount()).toBeNull();
});

test('a full localStorage cannot stop sign-out from clearing the prepared account', () => {
  setPreparedAccount(user.id);
  const scope = offlinePreparation(user.id, () => true);
  const storage = window.localStorage;
  vi.spyOn(storage, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage full', 'QuotaExceededError');
  });
  expect(() => setPreparedAccount(null)).not.toThrow();
  expect(preparedAccount()).toBeNull();
  expect(scope.isCurrent()).toBe(false);
});

test('the first verified 401 cancels an unfinished first download before its account marker exists', async () => {
  const scope = offlinePreparation(user.id, () => true);
  const fixture = delayedCatalog();
  const completion = scope.finish(fixture.store, user, catalog);
  const before = values.get('spinel.offline.cancellation');
  expect(preparedAccount()).toBeNull();
  expirePreparedAccount();
  expect(values.get('spinel.offline.cancellation')).not.toBe(before);
  expect(scope.isCurrent()).toBe(false);
  fixture.committed.resolve();
  expect(await completion).toBe(false);
  expect(preparedAccount()).toBeNull();
});

test('repeated verified 401 responses preserve the first expiry recovery epoch', () => {
  claimOnlineAccount(user.id);
  setPreparedAccount(user.id);
  expirePreparedAccount();
  const verifyRecovery = offlineEpoch();
  const nonce = values.get('spinel.offline.cancellation');
  expirePreparedAccount();
  expirePreparedAccount();
  expect(preparedAccount()).toBeNull();
  expect(values.get('spinel.offline.cancellation')).toBe(nonce);
  expect(verifyRecovery).not.toThrow();
});

test('a successful same-account sign-in preserves the held tab and permits a fresh first expiry', () => {
  claimOnlineAccount(user.id);
  expirePreparedAccount();
  const verifyRecovery = offlineEpoch();
  const nonce = values.get('spinel.offline.cancellation');
  claimOnlineAccount(user.id);
  expect(verifyRecovery).not.toThrow();
  const newDownload = offlinePreparation(user.id, () => true);
  expirePreparedAccount();
  expect(values.get('spinel.offline.cancellation')).not.toBe(nonce);
  expect(newDownload.isCurrent()).toBe(false);
});

test.each(['sign-out', 'different account'] as const)(
  '%s still invalidates a recovery epoch after a verified expiry',
  (change) => {
    claimOnlineAccount(user.id);
    expirePreparedAccount();
    const verifyRecovery = offlineEpoch();
    if (change === 'sign-out') setPreparedAccount(null);
    else claimOnlineAccount('other-account');
    expect(verifyRecovery).toThrow('account changed');
    expect(preparedAccount()).toBeNull();
  },
);

test('an expiry marker for an older nonce cannot admit a first download after sign-out', () => {
  expirePreparedAccount();
  setPreparedAccount(null);
  const newDownload = offlinePreparation(user.id, () => true);
  expirePreparedAccount();
  expect(newDownload.isCurrent()).toBe(false);
  expect(preparedAccount()).toBeNull();
});
