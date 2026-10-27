import { mapNativeImageSources } from '../../src/shared/nativeImageSources.ts';
import { checkBundle } from './download.ts';
import { verifyImages } from './PreparedImages.ts';
import {
  downloadSummary,
  hasStoredEdits,
  isOfflineCatalog,
  offlinePreparation,
  openExistingOfflineStore,
  preparedAccount,
  withOfflineCatalogLock,
  withOfflineItemWriter,
} from './offlineStore.ts';
import type { OfflineDownload, OfflineStore, StoredItem } from './offlineStore.ts';
import { accountRuntimeReadiness, releaseAccountRuntime } from './runtime.ts';

export type PersistenceState = 'granted' | 'denied' | 'unsupported' | 'error' | 'not-requested';
export type DeviceInventory = {
  state: 'ready' | 'empty' | 'missing' | 'unavailable';
  items: (OfflineDownload & {
    available: boolean;
    bytes: number | null;
    problem?: string;
    uncertain?: boolean;
  })[];
  bytes: number | null;
  origin: { usage?: number; quota?: number };
  persistence: PersistenceState;
  problem?: string;
};

const PERSISTENCE_KEY = 'spinel.offline.persistence-result';
let lastPersistence: PersistenceState | undefined;
const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

function rememberPersistence(state: PersistenceState) {
  lastPersistence = state;
  try {
    window.localStorage.setItem(PERSISTENCE_KEY, state);
  } catch {
    /* Report the actual browser result. */
  }
  return state;
}

/** Asking is an explicit action; inventory reads never invoke persist(). */
export async function requestPersistence(): Promise<PersistenceState> {
  if (!navigator.storage?.persist) return rememberPersistence('unsupported');
  try {
    return rememberPersistence((await navigator.storage.persist()) ? 'granted' : 'denied');
  } catch {
    return rememberPersistence('error');
  }
}

async function persistence(): Promise<PersistenceState> {
  if (!navigator.storage?.persisted || !navigator.storage.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    let previous = lastPersistence;
    try {
      previous ??= window.localStorage.getItem(PERSISTENCE_KEY) as PersistenceState | undefined;
    } catch {
      /* Optional remembered result. */
    }
    return previous === 'denied' || previous === 'error' ? previous : 'not-requested';
  } catch {
    return 'error';
  }
}

async function originEstimate() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return {
      ...(typeof estimate?.usage === 'number' &&
      Number.isFinite(estimate.usage) &&
      estimate.usage >= 0
        ? { usage: estimate.usage }
        : {}),
      ...(typeof estimate?.quota === 'number' &&
      Number.isFinite(estimate.quota) &&
      estimate.quota >= 0
        ? { quota: estimate.quota }
        : {}),
    };
  } catch {
    return {};
  }
}

/** JSON is the logical estimate, not an assertion about the browser's disk allocation. */
export function storedItemBytes(item: unknown, images: readonly { bytes: Uint8Array }[]) {
  try {
    const json = JSON.stringify(item);
    if (json === undefined || images.some((image) => !(image.bytes instanceof Uint8Array)))
      return null;
    const total =
      new TextEncoder().encode(json).byteLength +
      images.reduce((sum, image) => sum + image.bytes.byteLength, 0);
    return Number.isSafeInteger(total) ? total : null;
  } catch {
    return null;
  }
}

/** The manifest must cover every native image in the saved bundle and queue. */
export function checkStoredImageReferences(item: StoredItem) {
  const sources = new Set(item.bundle.images.map((image) => image.source));
  const check = (source: string) => {
    const path = source.startsWith(location.origin + '/')
      ? source.slice(location.origin.length)
      : source;
    if (!path.startsWith('data:image/') && !sources.has(path))
      throw new Error('An image required by this device copy is missing from its download.');
    return source;
  };
  mapNativeImageSources(item.bundle.snapshot, check);
  if (item.outbox) mapNativeImageSources(item.outbox.checkpoint, check);
}

export async function readDeviceInventory(
  accountId: string,
  verifyCurrent: () => void,
): Promise<DeviceInventory> {
  verifyCurrent();
  const [origin, protection] = await Promise.all([originEstimate(), persistence()]);
  verifyCurrent();
  const base = {
    items: [] as DeviceInventory['items'],
    bytes: 0 as number | null,
    origin,
    persistence: protection,
  };
  let store: OfflineStore | null = null;
  try {
    store = await openExistingOfflineStore(accountId);
    verifyCurrent();
    if (!store) return { ...base, state: preparedAccount() === accountId ? 'missing' : 'empty' };
    const keys = await store.itemIds();
    verifyCurrent();
    if (!keys.length) return { ...base, state: 'empty' };
    // Cold startup also needs this account's saved identity and file list. A
    // failed metadata read must still leave inspectable document data visible.
    const [user, catalog] = await Promise.allSettled([store.user(), store.catalog()]);
    verifyCurrent();
    const metadataUnavailable =
      user.status !== 'fulfilled' ||
      !user.value ||
      user.value.id !== accountId ||
      typeof user.value.name !== 'string' ||
      catalog.status !== 'fulfilled' ||
      !isOfflineCatalog(catalog.value);
    const runtime = await accountRuntimeReadiness(accountId, verifyCurrent);
    verifyCurrent();
    for (const itemId of keys) {
      const saved = await store.inspect(itemId);
      verifyCurrent();
      if (!saved) continue;
      const summary = downloadSummary(saved.item, accountId, itemId);
      const bytes = storedItemBytes(saved.item, saved.images);
      const entry: DeviceInventory['items'][number] = { ...summary, bytes, available: false };
      try {
        if (summary.uncertain) throw new Error(summary.problem);
        const item = saved.item as StoredItem;
        checkBundle(item.bundle, accountId, itemId, summary.spaceId);
        checkStoredImageReferences(item);
        await verifyImages(
          itemId,
          item.bundle.images,
          new Map(saved.images.map((image) => [image.source, image.bytes])),
          verifyCurrent,
        );
        verifyCurrent();
        if (bytes === null) throw new Error('The size of this saved copy could not be checked.');
        if (runtime.kind !== 'ready')
          throw new Error(
            'The offline app is missing or incomplete. Connect and download this copy again.',
          );
        if (
          runtime.compatibility.format !== item.bundle.version ||
          runtime.compatibility.sdkVersion !== item.bundle.sdkVersion
        )
          throw new Error(
            'This saved copy needs a compatible version of Spinel. Its data is retained.',
          );
        if (metadataUnavailable)
          throw new Error(
            'The saved account or file list is missing or incomplete. Connect to prepare this device again. Saved document data is retained.',
          );
        entry.available = true;
      } catch (error) {
        verifyCurrent();
        entry.problem = message(
          error,
          'This device copy could not be checked. Its data is retained.',
        );
        if (hasStoredEdits(saved.item)) entry.pending = true;
      }
      base.items.push(entry);
      base.bytes = base.bytes === null || bytes === null ? null : base.bytes + bytes;
    }
    verifyCurrent();
    return { ...base, state: base.items.length ? 'ready' : 'empty' };
  } catch (error) {
    verifyCurrent();
    return {
      ...base,
      state: 'unavailable',
      items: [],
      bytes: null,
      problem: message(error, 'Device storage could not be read. Its data is retained.'),
    };
  } finally {
    store?.close();
  }
}

export async function removeDeviceCopy(
  accountId: string,
  itemId: string,
  verifyCurrent: () => void,
  options: { discardPending?: boolean } = {},
) {
  verifyCurrent();
  const store = await openExistingOfflineStore(accountId);
  try {
    verifyCurrent();
    if (!store) return { status: 'removed' as const };
    const result = await withOfflineItemWriter(accountId, itemId, () =>
      store.removeDeviceItem(itemId, verifyCurrent, options.discardPending),
    );
    verifyCurrent();
    if (result.status === 'removed') {
      const scope = offlinePreparation(accountId, () => {
        try {
          verifyCurrent();
          return true;
        } catch {
          return false;
        }
      });
      await scope.clearIfEmpty(store);
    }
    return result;
  } finally {
    store?.close();
  }
}

/** Counts only; a locked exit never receives document names or contents. */
export async function readOfflineExitCounts(accountId: string, verifyCurrent: () => void) {
  verifyCurrent();
  const store = await openExistingOfflineStore(accountId);
  try {
    verifyCurrent();
    if (!store) return { downloads: 0, pending: 0, uncertain: 0 };
    const downloads = await store.downloads();
    verifyCurrent();
    return {
      downloads: downloads.length,
      pending: downloads.filter((item) => item.pending && !item.uncertain).length,
      uncertain: downloads.filter((item) => item.uncertain).length,
    };
  } finally {
    store?.close();
  }
}

/** Local-only deletion: catalog first, nonblocking writers next, then one clear. */
export async function deleteOfflineExitData(accountId: string, verifyCurrent: () => void) {
  verifyCurrent();
  if (!navigator.locks)
    throw new Error('This browser cannot safely remove device data. Use a browser with Web Locks.');
  await withOfflineCatalogLock(accountId, async () => {
    verifyCurrent();
    const store = await openExistingOfflineStore(accountId);
    try {
      verifyCurrent();
      if (store) {
        const keys = await store.itemKeys();
        verifyCurrent();
        // Unknown keys cannot have a native writer; explicit all-account deletion
        // can clear them without pretending their bytes were a clean document.
        const ids = keys.filter((key): key is string => typeof key === 'string').sort();
        const remove = async (index: number): Promise<void> => {
          verifyCurrent();
          if (index < ids.length)
            return withOfflineItemWriter(accountId, ids[index], () => remove(index + 1));
          await store.clearAccount(verifyCurrent);
        };
        await remove(0);
        verifyCurrent();
        if ((await store.itemKeys()).length)
          throw new Error('Device data changed while it was being removed.');
      }
      verifyCurrent();
      // Private bytes are already durably cleared. Public-cache bookkeeping
      // failures retain a conservative hold, never claim private deletion failed.
      await releaseAccountRuntime(accountId, verifyCurrent).catch(() => {});
    } finally {
      store?.close();
    }
  });
}
