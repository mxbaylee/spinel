import {
  offlinePreparation,
  openOfflineStore,
  preparedAccount,
  setPreparedAccount,
} from './offlineStore.ts';
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
export async function openLocalStart(): Promise<LocalStart | null> {
  const accountId = preparedAccount();
  if (!accountId) return null;
  const store = await openOfflineStore(accountId);
  try {
    const [user, catalog, downloads] = await Promise.all([
      store.user(),
      store.catalog(),
      store.downloads(),
    ]);
    if (!user || user.id !== accountId || !catalog) return null;
    return { user, catalog, downloads };
  } finally {
    store.close();
  }
}

async function hasDatabase(accountId: string) {
  // Avoid creating an empty database for every account that signs in here.
  if (!indexedDB.databases) return true;
  return (await indexedDB.databases()).some(
    (database) => database.name === `spinel-offline-${accountId}`,
  );
}

/**
 * After an online sign-in: this device stays prepared only for the signed-in
 * account, and only when it holds that account's downloads. Another account's
 * local data is never opened in its place.
 */
export async function claimDevice(user: OfflineUser & { isAdmin: boolean }) {
  if (preparedAccount() !== user.id) setPreparedAccount(null);
  if (user.isAdmin) return;
  let scope: OfflinePreparation;
  try {
    // Startup may outlive its timeout or another tab's sign-out. Capture the
    // same persisted fence as downloads before any database work can wait.
    scope = offlinePreparation(user.id, () => true);
  } catch {
    // Preparing local access is best effort; blocked storage must not stop sign-in.
    return;
  }
  if (!(await hasDatabase(user.id)) || !scope.isCurrent()) return;
  const store = await openOfflineStore(user.id);
  try {
    if (!scope.isCurrent()) return;
    const downloads = await store.downloads();
    if (downloads.length && scope.isCurrent()) setPreparedAccount(user.id);
  } finally {
    store.close();
  }
}
