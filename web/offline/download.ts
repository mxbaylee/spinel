import type { OfflineBundle } from '../../src/shared/offlineBundle.ts';
import { offlineScope } from './OfflineAccess.ts';
import { checkImageList, verifyImages } from './PreparedImages.ts';
import type { OfflineStore } from './offlineStore.ts';
import { prepareShell } from './shell.ts';

/** A download failure; `status` is the HTTP status when the server answered. */
export class DownloadError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function get(path: string) {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new DownloadError('Could not download. Check your connection and try again.');
  }
  if (response.status === 401) location.assign('/sign-in');
  return response;
}

/**
 * Throws unless the bundle is the one this account asked for, from this SDK,
 * with an image list that is safe to fetch.
 */
export function checkBundle(bundle: OfflineBundle, accountId: string, itemId: string) {
  if (
    bundle?.version !== 1 ||
    bundle.accountId !== accountId ||
    bundle.itemId !== itemId ||
    !['sheet', 'doc'].includes(bundle.kind) ||
    !bundle.snapshot ||
    typeof bundle.snapshot !== 'object' ||
    !Number.isSafeInteger(bundle.revision) ||
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
 * Downloads one Sheet or Doc for offline use (docs/offline.md): keep the app
 * shell, fetch the bundle and every image, verify each image's hash, then store
 * it all in one IndexedDB transaction. Until that commits nothing counts as
 * downloaded, and a failed refresh leaves the previous complete copy.
 */
export async function downloadForOffline(store: OfflineStore, itemId: string) {
  await prepareShell();
  const response = await get(`/api/items/${encodeURIComponent(itemId)}/offline-bundle`);
  const bundle = (await response.json().catch(() => ({}))) as OfflineBundle & { error?: string };
  if (!response.ok)
    throw new DownloadError(bundle.error ?? 'Could not download. Try again.', response.status);
  checkBundle(bundle, store.accountId, itemId);
  const bytes = new Map<string, Uint8Array>();
  for (const image of bundle.images) {
    const file = await get(image.source);
    if (!file.ok) throw new DownloadError('An image could not be downloaded. Try again.');
    bytes.set(image.source, new Uint8Array(await file.arrayBuffer()));
  }
  await verifyImages(itemId, bundle.images, bytes);
  try {
    return await store.saveDownload(bundle, bytes);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError')
      throw new DownloadError('This device is out of space for offline documents.');
    throw new DownloadError('Could not save this document on this device. Try again.');
  }
}
