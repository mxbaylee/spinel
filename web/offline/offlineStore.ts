import type { OfflineBundle } from '../../src/shared/offlineBundle.ts';
import { FILE_KINDS } from '../../src/shared/workspace.ts';
import type { FileItem, SpaceFile } from '../../src/shared/workspace.ts';
import { offlineScope } from './OfflineAccess.ts';

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
type StoredItem = OfflineDownload & { bundle: OfflineBundle };
type StoredImage = { itemId: string; source: string; bytes: Uint8Array };

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
        ['owner', 'editor', 'viewer'].includes(row.access) &&
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
const SIGN_OUT_KEY = 'spinel.offline.sign-out';
let accountGeneration = 0;
/** Cancels already-admitted work as soon as this tab starts signing out. */
export const offlineAccountGeneration = () => accountGeneration;
export function lockOfflineAccount() {
  accountGeneration++;
  setPreparedAccount(null);
}
const databaseName = (accountId: string) => `spinel-offline-${accountId}`;

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
export function setPreparedAccount(accountId: string | null) {
  if (accountId) storage()?.setItem(ACCOUNT_KEY, accountId);
  else storage()?.removeItem(ACCOUNT_KEY);
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
    };
  }
  /**
   * Replaces an item's download in one transaction, so a failed or interrupted
   * write leaves the previous complete copy (or nothing), never a partial one.
   */
  async saveDownload(bundle: OfflineBundle, bytes: ReadonlyMap<string, Uint8Array>) {
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
    const images = transaction.objectStore('images');
    images.delete(IDBKeyRange.bound([bundle.itemId, ''], [bundle.itemId, '\uffff']));
    for (const image of stored) images.put(image);
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
    transaction.objectStore('items').put(item);
    await done(transaction);
    return summary(item);
  }
  async remove(itemId: string) {
    const transaction = this.database.transaction(['items', 'images'], 'readwrite');
    transaction.objectStore('items').delete(itemId);
    transaction.objectStore('images').delete(IDBKeyRange.bound([itemId, ''], [itemId, '\uffff']));
    await done(transaction);
  }
}
