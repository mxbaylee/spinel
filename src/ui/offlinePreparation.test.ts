import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  offlinePreparation,
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
afterEach(() => vi.unstubAllGlobals());

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

// An initially absent marker has no removeItem event; the durable nonce fences
// completion even before the receiving tab's storage-event task is dispatched.
test('another tab signing out before the first preparation publishes cannot revive its account', async () => {
  const fixture = delayedCatalog();
  const scope = offlinePreparation(user.id, () => true);
  const completion = scope.finish(fixture.store, user, catalog);
  expect(preparedAccount()).toBeNull();
  values.set('spinel.offline.cancellation', crypto.randomUUID());
  fixture.committed.resolve();
  await expect(completion).resolves.toBe(false);
  expect(preparedAccount()).toBeNull();
});

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
