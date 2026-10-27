import {
  offlineAccountRead,
  claimOnlineAccount,
  offlinePreparation,
  openExistingOfflineStore,
  preparedAccount,
  setPreparedAccount,
  withOfflineCatalogLock,
} from './offlineStore.ts';
import { ensureAccountRuntime, isRuntimeCompatible } from './runtime.ts';
import type { AccountRuntimeRequirement } from './runtime.ts';
import { readDeviceInventory } from './deviceStorage.ts';
import type {
  OfflineCatalog,
  OfflineDownload,
  OfflinePreparation,
  OfflineUser,
} from './offlineStore.ts';

/** What local mode starts from: the prepared account's last-synced catalog. */
export type LocalStart = {
  user: OfflineUser;
  catalog: OfflineCatalog;
  downloads: OfflineDownload[];
};

/**
 * Only a failed network round trip enters local mode. A 401 or any other
 * answer from the server is not an outage, so it never opens local data.
 */
export function isNetworkFailure(error: unknown) {
  return error instanceof TypeError;
}

/** Reads local mode's starting point; null when this device was not prepared. */
export async function ensureDeviceRuntime(accountId: string, verifyCurrent: () => void) {
  return withOfflineCatalogLock(accountId, async () => {
    verifyCurrent();
    let requirement: AccountRuntimeRequirement = { kind: 'unknown' };
    let store;
    try {
      store = await openExistingOfflineStore(accountId);
      verifyCurrent();
      requirement = store ? await store.runtimeRequirement() : { kind: 'empty' };
      verifyCurrent();
    } catch {
      verifyCurrent();
      // Failure cannot be interpreted as permission to retire retained runtimes.
    } finally {
      store?.close();
    }
    return ensureAccountRuntime(accountId, requirement, verifyCurrent);
  });
}

export async function openLocalStart(
  current: () => boolean = () => true,
): Promise<(LocalStart & { isCurrent(): boolean }) | null> {
  const accountId = preparedAccount();
  if (!accountId) return null;
  const isCurrent = offlineAccountRead(accountId);
  const verify = () => {
    if (!current() || !isCurrent())
      throw new DOMException('This offline startup is no longer current.', 'AbortError');
  };
  if (!current() || !isCurrent()) return null;
  try {
    if ((await ensureDeviceRuntime(accountId, verify)).kind !== 'ready') return null;
    verify();
  } catch {
    return null;
  }
  const store = await openExistingOfflineStore(accountId);
  if (!store) return null;
  try {
    if (!current() || !isCurrent()) return null;
    const [user, catalog, inventory] = await Promise.all([
      store.user(),
      store.catalog(),
      readDeviceInventory(accountId, verify),
    ]);
    if (
      !current() ||
      !isCurrent() ||
      !user ||
      user.id !== accountId ||
      typeof user.name !== 'string' ||
      !catalog ||
      inventory.state === 'unavailable' ||
      inventory.state === 'missing'
    )
      return null;
    // The short admission lifetime ends at publication. Local mode thereafter
    // retains only the durable account fence, never that retired startup flag.
    return { user, catalog, downloads: inventory.items, isCurrent };
  } finally {
    store.close();
  }
}

/**
 * After an online sign-in: this device stays prepared only for the signed-in
 * account, and only when it holds that account's downloads. Another account's
 * local data is never opened in its place.
 */
export async function claimDevice(
  user: OfflineUser & { isAdmin: boolean },
  current: () => boolean = () => true,
) {
  let scope: OfflinePreparation;
  try {
    if (!current()) return;
    claimOnlineAccount(user.id);
    if (user.isAdmin) return;
    // Startup may outlive its timeout or another tab's sign-out. Capture the
    // same persisted fence as downloads before any database work can wait.
    scope = offlinePreparation(user.id, current);
  } catch {
    // Preparing local access is best effort; blocked storage must not stop sign-in.
    return;
  }
  if (!scope.isCurrent()) return;
  const store = await openExistingOfflineStore(user.id);
  if (!store) return;
  try {
    if (!scope.isCurrent()) return;
    const requirement = await store.runtimeRequirement();
    if (
      requirement.kind === 'retained' &&
      isRuntimeCompatible(requirement.compatibility) &&
      scope.isCurrent()
    )
      setPreparedAccount(user.id);
  } finally {
    store.close();
  }
}
