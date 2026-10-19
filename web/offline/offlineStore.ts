import type { OfflineBundle } from '../../src/shared/offlineBundle.ts';
import type { WorkspaceItem } from '../../src/shared/workspace.ts';

/**
 * Account-scoped IndexedDB storage for documents downloaded on this device
 * (docs/offline.md). One database per account, so another account on the same
 * browser never opens it. CacheStorage holds only the public app shell; private
 * data lives here and nowhere else.
 */
export type OfflineUser = { id: string; name: string };
export type OfflineCatalog = {
  syncedAt: number;
  items: WorkspaceItem[];
  shared: WorkspaceItem[];
  pins: WorkspaceItem[];
  /** The last-loaded ancestors, item and children for each opened folder or item. */
  views: Record<string, WorkspaceItem[]>;
};
export type OfflineDownload = {
  itemId: string;
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
  name: item.name,
  kind: item.kind,
  readOnly: item.readOnly,
  revision: item.revision,
  downloadedAt: item.downloadedAt,
});

const ACCOUNT_KEY = 'spinel.offline.account';
const SIGN_OUT_KEY = 'spinel.offline.sign-out';
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
    transaction.onerror = () => reject(transaction.error);
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
    return (await request(transaction.objectStore('meta').get('catalog'))) as
      OfflineCatalog | undefined;
  }
  async saveCatalog(user: OfflineUser, catalog: OfflineCatalog) {
    if (user.id !== this.accountId) throw new Error('This catalog belongs to another account.');
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
