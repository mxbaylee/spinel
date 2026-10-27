import type { OfflineBundle, OfflineBundleImage } from '../../src/shared/offlineBundle.ts';
import { FILE_KINDS } from '../../src/shared/workspace.ts';
import type { FileItem, SpaceFile } from '../../src/shared/workspace.ts';
import { offlineScope } from './OfflineAccess.ts';
import type { ClientCheckpoint } from '@spinel/sync-client';

/**
 * Account-scoped IndexedDB storage for documents downloaded on this device
 * (docs/offline.md). One database per account, so another account on the same
 * browser never opens it. CacheStorage holds only the public app shell; private
 * data lives here and nowhere else.
 */
export type OfflineUser = { id: string; name: string };
export type OfflineCatalog = {
  syncedAt: number;
  items: FileItem[];
  shared: FileItem[];
  /** The last-loaded ancestors, item and children for each opened folder or item. */
  views: Record<string, FileItem[]>;
};
export type OfflineDownload = {
  itemId: string;
  spaceId?: string;
  name: string;
  kind: 'sheet' | 'doc';
  readOnly: boolean;
  revision: number;
  downloadedAt: number;
};
export type OfflineOutbox = {
  version: 1;
  account: string;
  item: string;
  spaceId?: string;
  unitId: string;
  revisionOffset: number;
  /** The native client's sole queue, including its immutable retry envelope. */
  checkpoint: ClientCheckpoint;
};
type StoredItem = OfflineDownload & { bundle: OfflineBundle; outbox?: OfflineOutbox };
type StoredImage = { itemId: string; source: string; bytes: Uint8Array };

export function hasOfflineEdits(outbox: OfflineOutbox | undefined) {
  return Boolean(
    outbox &&
    (outbox.checkpoint.sent ||
      outbox.checkpoint.inflight.length ||
      outbox.checkpoint.buffer.length ||
      outbox.checkpoint.failure ||
      outbox.checkpoint.recoverySnapshot ||
      outbox.checkpoint.recoveryMissing),
  );
}

export const offlineChanged = (accountId: string, itemId: string) => {
  window.dispatchEvent(
    new CustomEvent('spinel-offline-changed', { detail: { accountId, itemId } }),
  );
};

const summary = (item: StoredItem): OfflineDownload => ({
  itemId: item.itemId,
  ...(item.bundle.spaceId === undefined ? {} : { spaceId: item.bundle.spaceId }),
  name: item.name,
  kind: item.kind,
  readOnly: item.readOnly,
  revision: item.revision,
  downloadedAt: item.downloadedAt,
});

/** Keep only outer-file metadata here; prepared native children live in downloads. */
export function isOfflineCatalog(value: unknown): value is OfflineCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const catalog = value as Partial<OfflineCatalog>;
  const files = (rows: unknown): rows is FileItem[] =>
    Array.isArray(rows) &&
    rows.every(
      (row: FileItem) =>
        row &&
        typeof row === 'object' &&
        typeof row.id === 'string' &&
        Boolean(row.id) &&
        FILE_KINDS.includes(row.kind) &&
        typeof row.name === 'string' &&
        (row.parentId === null || typeof row.parentId === 'string') &&
        ['owner', 'admin', 'editor', 'viewer'].includes(row.access) &&
        Number.isFinite(row.createdAt) &&
        Number.isFinite(row.updatedAt) &&
        Array.isArray(row.tags) &&
        row.tags.every((tag) => typeof tag === 'string'),
    );
  return (
    typeof catalog.syncedAt === 'number' &&
    Number.isFinite(catalog.syncedAt) &&
    catalog.syncedAt >= 0 &&
    files(catalog.items) &&
    files(catalog.shared) &&
    Boolean(catalog.views) &&
    typeof catalog.views === 'object' &&
    !Array.isArray(catalog.views) &&
    Object.values(catalog.views!).every(files)
  );
}

/** A first Space download can prepare local launch without an earlier Dashboard visit. */
export function spaceOfflineCatalog(root: SpaceFile, existing?: OfflineCatalog): OfflineCatalog {
  const catalog = existing ?? { syncedAt: Date.now(), items: [], shared: [], views: {} };
  const items = catalog.items.filter((item) => item.id !== root.id);
  const shared = catalog.shared.filter((item) => item.id !== root.id);
  (root.access === 'owner' ? items : shared).push(root);
  return { ...catalog, items, shared, views: { ...catalog.views, [root.id]: [root] } };
}

const ACCOUNT_KEY = 'spinel.offline.account';
const ONLINE_ACCOUNT_KEY = 'spinel.offline.online-account';
const SIGN_OUT_KEY = 'spinel.offline.sign-out';
const CANCELLATION_KEY = 'spinel.offline.cancellation';
const EXPIRED_SESSION_KEY = 'spinel.offline.expired-session';
const databaseName = (accountId: string) => `spinel-offline-${accountId}`;
let preparationEpoch = 0;

function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
/** The account this device was prepared for; cleared on sign-out. Not a credential. */
export function preparedAccount() {
  return storage()?.getItem(ACCOUNT_KEY) ?? null;
}
/** Read-only startup also observes cancellation; it never prepares or claims a device. */
export function offlineAccountRead(accountId: string) {
  const epoch = preparationEpoch;
  const cancellation = storage()?.getItem(CANCELLATION_KEY);
  return () => {
    try {
      return (
        epoch === preparationEpoch &&
        cancellation === storage()?.getItem(CANCELLATION_KEY) &&
        preparedAccount() === accountId
      );
    } catch {
      return false;
    }
  };
}
export function setPreparedAccount(accountId: string | null) {
  // Clearing an already-empty pointer still cancels a first preparation that
  // was in flight when sign-out began, before its component can unmount.
  const previous = preparedAccount();
  if (accountId === null || (previous !== null && previous !== accountId)) {
    preparationEpoch++;
    // removeItem on an absent account emits no storage event. A fresh nonce
    // also cancels another tab's first download, before any marker exists.
    try {
      storage()?.setItem(CANCELLATION_KEY, crypto.randomUUID());
    } catch {
      // Removing the old token invalidates other tabs synchronously, even when
      // their storage event is delayed and removing the account frees quota.
      storage()?.removeItem(CANCELLATION_KEY);
    }
  }
  if (accountId) storage()?.setItem(ACCOUNT_KEY, accountId);
  else storage()?.removeItem(ACCOUNT_KEY);
  // Same-tab readers need the same immediate fence as other tabs. In
  // particular, removing the final clean download must never leave its old
  // editor accepting input after its account preparation was cancelled.
  window.dispatchEvent(new Event('spinel-offline-account-changed'));
}

/** Repeated answers about the same ended sign-in must not close a recovery tab. */
export function expirePreparedAccount() {
  const local = storage();
  const before = local?.getItem(CANCELLATION_KEY);
  if (!preparedAccount() && before && local?.getItem(EXPIRED_SESSION_KEY) === before) return;
  // The first 401 also cancels a download that has not written its account
  // marker yet. An absent marker alone is not proof that expiry was handled.
  setPreparedAccount(null);
  const cancellation = local?.getItem(CANCELLATION_KEY);
  if (cancellation) {
    try {
      local?.setItem(EXPIRED_SESSION_KEY, cancellation);
    } catch {
      // Losing this optimization cannot leave offline access enabled.
    }
  }
}

/** Online identity is independent of whether this account has any downloads. */
export function claimOnlineAccount(accountId: string) {
  const local = storage();
  if (!local) throw new Error('Storage unavailable.');
  const previous = local.getItem(ONLINE_ACCOUNT_KEY) ?? preparedAccount();
  if (previous && previous !== accountId) setPreparedAccount(null);
  // Reopening the same signed-in account must not rotate its cancellation
  // token: ordinary live editors may still hold memory-only pending work.
  if (local.getItem(ONLINE_ACCOUNT_KEY) !== accountId) local.setItem(ONLINE_ACCOUNT_KEY, accountId);
  // A newly verified sign-in needs its own first-expiry fence, even for the
  // same account. This does not invalidate a frozen tab's pending local write.
  local.removeItem(EXPIRED_SESSION_KEY);
}

/** Serialize download insertion against the final empty-catalog marker check. */
async function catalogLock<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks) return operation();
  return navigator.locks.request(`spinel-offline-catalog:${accountId}`, operation);
}

function preparationCancellation() {
  try {
    const local = storage();
    if (!local) throw new Error('Storage unavailable.');
    let value = local.getItem(CANCELLATION_KEY);
    if (!value) {
      value = crypto.randomUUID();
      local.setItem(CANCELLATION_KEY, value);
    }
    if (local.getItem(CANCELLATION_KEY) !== value) throw new Error('Storage write failed.');
    return value;
  } catch {
    throw new Error(
      'Offline downloads need browser storage. Allow storage or free up space, then try again.',
    );
  }
}

/** Fence authentication headers and bodies before they can claim local data. */
export function offlineEpoch() {
  const epoch = preparationEpoch;
  const cancellation = preparationCancellation();
  const account = storage()?.getItem(ONLINE_ACCOUNT_KEY);
  return () => {
    if (
      epoch !== preparationEpoch ||
      storage()?.getItem(CANCELLATION_KEY) !== cancellation ||
      storage()?.getItem(ONLINE_ACCOUNT_KEY) !== account
    )
      throw new DOMException('The account changed while signing in.', 'AbortError');
  };
}

/** One mounted account's asynchronous preparation, never a reusable sign-in. */
export function offlinePreparation(accountId: string, isMounted: () => boolean) {
  const epoch = preparationEpoch;
  // Never admit a scope with an absent token: a full legacy store may be unable
  // to create one at sign-out, and storage events are not a synchronous fence.
  const cancellation: string | null = preparationCancellation();
  const isCurrent = () => {
    if (!isMounted() || epoch !== preparationEpoch || !cancellation) return false;
    try {
      const local = storage();
      if (!local || local.getItem(CANCELLATION_KEY) !== cancellation) return false;
      const account = local.getItem(ACCOUNT_KEY);
      return account === null || account === accountId;
    } catch {
      return false;
    }
  };
  return {
    isMounted,
    isCurrent,
    async finish(
      store: Pick<OfflineStore, 'accountId' | 'saveCatalog'>,
      user: OfflineUser,
      catalog: OfflineCatalog,
    ) {
      if (store.accountId !== accountId || user.id !== accountId)
        throw new Error('This preparation belongs to another account.');
      if (!isCurrent()) return false;
      await store.saveCatalog(user, catalog);
      if (!isCurrent()) return false;
      setPreparedAccount(accountId);
      // Activate already-open editors only after the first preparation commits
      // its account marker, even if no further mutation or acknowledgement occurs.
      window.dispatchEvent(new CustomEvent('spinel-offline-prepared', { detail: { accountId } }));
      return true;
    },
    async clearIfEmpty(store: Pick<OfflineStore, 'accountId' | 'downloads'>) {
      if (store.accountId !== accountId)
        throw new Error('This preparation belongs to another account.');
      await catalogLock(accountId, async () => {
        if (!isCurrent()) return;
        const remaining = await store.downloads();
        if (!remaining.length && isCurrent() && preparedAccount() === accountId) {
          // Removing a clean download is not sign-out. Keep the cancellation
          // nonce so unrelated live editors retain their memory-only queues.
          storage()?.removeItem(ACCOUNT_KEY);
          window.dispatchEvent(new Event('spinel-offline-account-changed'));
        }
      });
    },
  };
}
export type OfflinePreparation = ReturnType<typeof offlinePreparation>;

/** A sign-out/account change in another tab also cancels pending completions. */
export function watchOfflineAccount() {
  const changed = (event: StorageEvent) => {
    if (
      (event.key === ACCOUNT_KEY &&
        event.newValue !== null &&
        !(event.oldValue === null && typeof event.newValue === 'string')) ||
      event.key === CANCELLATION_KEY ||
      event.key === null
    )
      preparationEpoch++;
  };
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
}
/** A sign-out made offline; the server session is revoked on the next online start. */
export function signOutPending() {
  return storage()?.getItem(SIGN_OUT_KEY) === '1';
}
export function setSignOutPending(pending: boolean) {
  if (pending) storage()?.setItem(SIGN_OUT_KEY, '1');
  else storage()?.removeItem(SIGN_OUT_KEY);
}

function request<T>(operation: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}
function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    // While a request's error event dispatches, transaction.error is still null.
    transaction.onerror = (event) =>
      reject((event.target as IDBRequest | null)?.error ?? transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Storage write cancelled.'));
  });
}

export async function openOfflineStore(accountId: string) {
  if (!accountId) throw new Error('An account is required.');
  const opening = indexedDB.open(databaseName(accountId), 1);
  opening.onupgradeneeded = () => {
    const database = opening.result;
    database.createObjectStore('meta');
    database.createObjectStore('items', { keyPath: 'itemId' });
    database.createObjectStore('images', { keyPath: ['itemId', 'source'] });
  };
  const database = await request(opening);
  // Another tab's schema upgrade must not wait on this connection.
  database.onversionchange = () => database.close();
  return new OfflineStore(accountId, database);
}

export class OfflineStore {
  readonly accountId: string;
  private database: IDBDatabase;
  constructor(accountId: string, database: IDBDatabase) {
    this.accountId = accountId;
    this.database = database;
  }
  close() {
    this.database.close();
  }
  async user() {
    const transaction = this.database.transaction('meta');
    return (await request(transaction.objectStore('meta').get('user'))) as OfflineUser | undefined;
  }
  async catalog() {
    const transaction = this.database.transaction('meta');
    const catalog: unknown = await request(transaction.objectStore('meta').get('catalog'));
    return isOfflineCatalog(catalog) ? catalog : undefined;
  }
  async saveCatalog(user: OfflineUser, catalog: OfflineCatalog) {
    if (user.id !== this.accountId) throw new Error('This catalog belongs to another account.');
    if (!isOfflineCatalog(catalog)) throw new Error('This file list is incomplete. Try again.');
    const transaction = this.database.transaction('meta', 'readwrite');
    const meta = transaction.objectStore('meta');
    meta.put(user, 'user');
    meta.put(catalog, 'catalog');
    await done(transaction);
  }
  async downloads() {
    const transaction = this.database.transaction('items');
    const items = (await request(transaction.objectStore('items').getAll())) as StoredItem[];
    return items.map(summary);
  }
  async bundle(itemId: string) {
    const transaction = this.database.transaction(['items', 'images']);
    const item = (await request(transaction.objectStore('items').get(itemId))) as
      StoredItem | undefined;
    if (!item) return undefined;
    const images = (await request(
      transaction.objectStore('images').getAll(IDBKeyRange.bound([itemId, ''], [itemId, '\uffff'])),
    )) as StoredImage[];
    return {
      bundle: item.bundle,
      bytes: new Map(images.map((image) => [image.source, image.bytes])),
      outbox: item.outbox,
    };
  }
  /**
   * Replaces an item's download in one transaction, so a failed or interrupted
   * write leaves the previous complete copy (or nothing), never a partial one.
   */
  async saveDownload(
    bundle: OfflineBundle,
    bytes: ReadonlyMap<string, Uint8Array>,
    verifyCurrent: () => void = () => {},
  ) {
    verifyCurrent();
    return catalogLock(this.accountId, () =>
      this.saveDownloadUnlocked(bundle, bytes, verifyCurrent),
    );
  }
  private async saveDownloadUnlocked(
    bundle: OfflineBundle,
    bytes: ReadonlyMap<string, Uint8Array>,
    verifyCurrent: () => void,
  ) {
    verifyCurrent();
    if (bundle.accountId !== this.accountId)
      throw new Error('This download belongs to another account.');
    offlineScope(bundle);
    // Check before opening the transaction: a throw inside it would still commit
    // the writes already queued.
    const stored = bundle.images.map((image) => {
      const data = bytes.get(image.source);
      if (!data) throw new Error('An image is missing or incomplete.');
      return { itemId: bundle.itemId, source: image.source, bytes: data };
    });
    const transaction = this.database.transaction(['items', 'images'], 'readwrite');
    const completion = done(transaction);
    const items = transaction.objectStore('items');
    const item: StoredItem = {
      itemId: bundle.itemId,
      ...(bundle.spaceId === undefined ? {} : { spaceId: bundle.spaceId }),
      name: bundle.name,
      kind: bundle.kind,
      readOnly: bundle.readOnly,
      revision: bundle.revision,
      downloadedAt: Date.now(),
      bundle,
    };
    try {
      const previous = (await request(items.get(bundle.itemId))) as StoredItem | undefined;
      verifyCurrent();
      if (hasOfflineEdits(previous?.outbox))
        throw new Error(
          'This document has changes on this device. Sync them before replacing its download.',
        );
      if (
        previous?.outbox &&
        previous.bundle.unitId === bundle.unitId &&
        previous.outbox.checkpoint.revision + previous.bundle.revisionOffset > bundle.revision
      ) {
        await completion;
        return summary(previous);
      }
      const images = transaction.objectStore('images');
      images.delete(IDBKeyRange.bound([bundle.itemId, ''], [bundle.itemId, '\uffff']));
      for (const image of stored) images.put(image);
      items.put(item);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* A failed request may already have aborted it. */
      }
      await completion.catch(() => {});
      throw error;
    }
    await completion;
    verifyCurrent();
    offlineChanged(this.accountId, bundle.itemId);
    return summary(item);
  }
  /** Snapshot, queue, retry identity and image bytes commit as one durable unit. */
  async saveCheckpoint(
    scope: Pick<OfflineOutbox, 'account' | 'item' | 'spaceId' | 'unitId' | 'revisionOffset'>,
    checkpoint: ClientCheckpoint,
    verifyCurrent: () => void,
    imageFiles?: { images: OfflineBundleImage[]; bytes: ReadonlyMap<string, Uint8Array> },
  ) {
    verifyCurrent();
    if (scope.account !== this.accountId || checkpoint.unitId !== scope.unitId)
      throw new Error('This outbox belongs to another account or document.');
    const transaction = this.database.transaction(['items', 'images'], 'readwrite');
    const completion = done(transaction);
    const items = transaction.objectStore('items');
    try {
      const item = (await request(items.get(scope.item))) as StoredItem | undefined;
      verifyCurrent();
      if (
        !item ||
        item.bundle.accountId !== scope.account ||
        item.bundle.spaceId !== scope.spaceId ||
        item.bundle.unitId !== scope.unitId ||
        item.bundle.revisionOffset !== scope.revisionOffset
      )
        throw new Error('This download changed. Keep this tab open to preserve your changes.');
      item.outbox = { version: 1, ...scope, checkpoint };
      if (imageFiles) {
        item.bundle.images = imageFiles.images;
        const images = transaction.objectStore('images');
        for (const image of imageFiles.images) {
          const bytes = imageFiles.bytes.get(image.source);
          if (!bytes) throw new Error('An offline image is incomplete.');
          images.put({ itemId: scope.item, source: image.source, bytes });
        }
      }
      items.put(item);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* A failed request may already have aborted it. */
      }
      await completion.catch(() => {});
      throw error;
    }
    await completion;
    verifyCurrent();
  }
  async remove(itemId: string) {
    if (!navigator.locks)
      throw new Error(
        'This browser cannot safely remove an offline copy. Use a browser with Web Locks.',
      );
    await navigator.locks.request(
      `spinel-offline:${this.accountId}:${itemId}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw new Error('Close this document in every tab before removing its device copy.');
        await this.removeUnlocked(itemId);
      },
    );
  }
  /** The caller holds this item's writer lock and has frozen native input. */
  async removeClean(
    scope: Pick<OfflineOutbox, 'account' | 'item' | 'spaceId' | 'unitId' | 'revisionOffset'>,
    verifyCurrent: () => void,
  ) {
    if (scope.account !== this.accountId)
      throw new Error('This download belongs to another account.');
    verifyCurrent();
    await this.removeUnlocked(scope.item, (existing) => {
      verifyCurrent();
      if (
        existing &&
        (existing.bundle.accountId !== scope.account ||
          existing.bundle.itemId !== scope.item ||
          existing.bundle.spaceId !== scope.spaceId ||
          existing.bundle.unitId !== scope.unitId ||
          existing.bundle.revisionOffset !== scope.revisionOffset)
      )
        throw new Error('This download changed before its access could be checked.');
    });
  }
  private async removeUnlocked(itemId: string, verify?: (existing?: StoredItem) => void) {
    const transaction = this.database.transaction(['items', 'images'], 'readwrite');
    const completion = done(transaction);
    const items = transaction.objectStore('items');
    try {
      const existing = (await request(items.get(itemId))) as StoredItem | undefined;
      verify?.(existing);
      if (hasOfflineEdits(existing?.outbox))
        throw new Error(
          'Changes are saved on this device. Sync or recover them before removing this copy.',
        );
      items.delete(itemId);
      transaction.objectStore('images').delete(IDBKeyRange.bound([itemId, ''], [itemId, '\uffff']));
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* A failed request may already have aborted it. */
      }
      await completion.catch(() => {});
      throw error;
    }
    await completion;
    offlineChanged(this.accountId, itemId);
  }
}
