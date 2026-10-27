import type { OfflineBundle } from '../../src/shared/offlineBundle.ts';
import { offlineScope } from './OfflineAccess.ts';
import { checkImageList, verifyImages } from './PreparedImages.ts';
import type { OfflineStore } from './offlineStore.ts';
import { prepareShell } from './shell.ts';
import { documentPath } from '../documentAccess.ts';

/** A download failure; `status` is the HTTP status when the server answered. */
export class DownloadError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function get(path: string, accountId: string, verifyCurrent: () => void) {
  let response: Response;
  try {
    verifyCurrent();
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Spinel-Offline-Account': accountId },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new DownloadError('Could not download. Check your connection and try again.');
  }
  verifyCurrent();
  if (response.status === 401) location.assign('/sign-in');
  return response;
}

/**
 * Throws unless the bundle is the one this account asked for, from this SDK,
 * with an image list that is safe to fetch.
 */
export function checkBundle(
  bundle: OfflineBundle,
  accountId: string,
  itemId: string,
  spaceId?: string,
) {
  if (
    bundle?.version !== 1 ||
    bundle.accountId !== accountId ||
    bundle.itemId !== itemId ||
    bundle.spaceId !== spaceId ||
    !['sheet', 'doc'].includes(bundle.kind) ||
    !bundle.snapshot ||
    typeof bundle.snapshot !== 'object' ||
    Array.isArray(bundle.snapshot) ||
    // Materialized native data keeps the stable item ID. A restore's live
    // generation is separate and remains bound in unitId/revisionOffset.
    bundle.snapshot.id !== bundle.itemId ||
    !Number.isSafeInteger(bundle.revision) ||
    bundle.revision < 1 ||
    typeof bundle.readOnly !== 'boolean' ||
    (bundle.access === 'viewer' && !bundle.readOnly)
  )
    throw new DownloadError('This download does not match your account. Try again.');
  offlineScope(bundle);
  // Only this item's own image routes are ever fetched.
  try {
    checkImageList(itemId, bundle.images);
  } catch (error) {
    throw new DownloadError(
      error instanceof Error ? error.message : 'The image list is malformed.',
    );
  }
}

/**
 * Downloads one Sheet or Doc for offline use (docs/offline.md): fetch the
 * bundle and every image, verify each image's hash, keep the app shell, then
 * store it all in one IndexedDB transaction. Until that commits nothing counts as
 * downloaded, and a failed refresh leaves the previous complete copy.
 */
export async function downloadForOffline(
  store: OfflineStore,
  itemId: string,
  spaceId?: string,
  verifyCurrent: () => void = () => {},
) {
  verifyCurrent();
  const path = documentPath(itemId, spaceId);
  const response = await get(`${path}/offline-bundle`, store.accountId, verifyCurrent);
  const bundle = (await response.json().catch(() => ({}))) as OfflineBundle & { error?: string };
  verifyCurrent();
  if (!response.ok)
    throw new DownloadError(bundle.error ?? 'Could not download. Try again.', response.status);
  checkBundle(bundle, store.accountId, itemId, spaceId);
  const bytes = new Map<string, Uint8Array>();
  for (const image of bundle.images) {
    // Native snapshots and local image keys remain canonical. The HTTP read
    // independently carries the requested root and child on every image.
    const file = await get(
      spaceId ? `${path}/images/${image.sha256}` : image.source,
      store.accountId,
      verifyCurrent,
    );
    if (!file.ok) throw new DownloadError('An image could not be downloaded. Try again.');
    bytes.set(image.source, new Uint8Array(await file.arrayBuffer()));
    verifyCurrent();
  }
  await verifyImages(itemId, bundle.images, bytes);
  verifyCurrent();
  // Only a download known to be good prepares the device (fills CacheStorage).
  await prepareShell();
  verifyCurrent();
  try {
    return await store.saveDownload(bundle, bytes);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError')
      throw new DownloadError('This device is out of space for offline documents.');
    throw new DownloadError('Could not save this document on this device. Try again.');
  }
}
