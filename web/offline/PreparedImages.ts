import type { IURLImageService } from '@univerjs/core';
import { mapNativeImageSources } from '../../src/shared/nativeImageSources.ts';
import type { OfflineBundleImage } from '../../src/shared/offlineBundle.ts';
import type { OfflineAccess } from './OfflineAccess.ts';

// Match the existing upload and document image budgets.
const IMAGE_LIMIT = 5 * 1024 * 1024;
const DOCUMENT_LIMIT = 50 * 1024 * 1024;
const MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// Draws nothing and makes no request.
const EMPTY_IMAGE = 'data:image/png;base64,';

export async function sha256(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Checks a bundle's image list before anything is fetched or hashed: every
 * source is a stored image of this item, of an allowed type and within budget.
 */
export function checkImageList(itemId: string, images: readonly OfflineBundleImage[]) {
  if (!Array.isArray(images)) throw new Error('The image list is malformed.');
  const sources = new Set<string>();
  let total = 0;
  for (const image of images) {
    if (
      !image ||
      typeof image.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(image.sha256) ||
      image.source !== `/api/items/${itemId}/images/${image.sha256}` ||
      !MIME_TYPES.includes(image.mime) ||
      !Number.isSafeInteger(image.byteLength) ||
      image.byteLength <= 0 ||
      image.byteLength > IMAGE_LIMIT ||
      sources.has(image.source)
    )
      throw new Error('The image list is malformed.');
    sources.add(image.source);
    total += image.byteLength;
  }
  if (total > DOCUMENT_LIMIT) throw new Error('The images exceed the document image budget.');
}

/**
 * Checks a bundle's image list against the bytes this device holds: the list
 * passes `checkImageList`, and every image is complete and matches its
 * SHA-256. Throws on the first problem; never returns a partial set.
 */
export async function verifyImages(
  itemId: string,
  images: readonly OfflineBundleImage[],
  bytes: ReadonlyMap<string, Uint8Array>,
  stillAllowed: () => void = () => {},
) {
  checkImageList(itemId, images);
  const blobs = new Map<string, Blob>();
  for (const image of images) {
    const stored = bytes.get(image.source);
    if (!(stored instanceof Uint8Array) || stored.byteLength !== image.byteLength)
      throw new Error('An image is missing or incomplete.');
    const copy = new Uint8Array(stored);
    const hash = await sha256(copy);
    stillAllowed();
    if (hash !== image.sha256) throw new Error('An image failed its integrity check.');
    blobs.set(image.source, new Blob([copy], { type: image.mime }));
  }
  return blobs;
}

/**
 * Local replacement for Univer's public image service. Every image comes from
 * bytes verified on this device; nothing falls back to a network URL. A failed
 * read returns an empty local image and puts the access into attention, so the
 * viewer can ask for a fresh download. Snapshots are only rewritten in memory
 * (`localize`); stored snapshots keep their original sources.
 */
export class PreparedImages implements IURLImageService {
  private access: OfflineAccess;
  private currentAccount: () => string | null;
  private blobs: Map<string, Blob>;
  private urls = new Map<string, string>();
  private issued = new Map<string, Blob>();
  private stop: () => void;
  private disposed = false;
  private constructor(
    access: OfflineAccess,
    currentAccount: () => string | null,
    blobs: Map<string, Blob>,
  ) {
    this.access = access;
    this.currentAccount = currentAccount;
    this.blobs = blobs;
    this.stop = access.subscribe(() => {
      if (!access.mayReadLocal) this.clear();
    });
  }
  static async prepare(
    access: OfflineAccess,
    images: readonly OfflineBundleImage[],
    bytes: ReadonlyMap<string, Uint8Array>,
    currentAccount: () => string | null,
  ) {
    const assert = () => {
      if (currentAccount() !== access.scope.accountId || !access.mayReadLocal)
        throw new Error('Offline images lost their account or access.');
    };
    assert();
    const blobs = await verifyImages(access.scope.itemId, structuredClone(images), bytes, assert);
    assert();
    return new PreparedImages(access, currentAccount, blobs);
  }
  private clear() {
    this.disposed = true;
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.issued.clear();
    this.blobs.clear();
  }
  private assertAllowed() {
    let account: string | null;
    try {
      account = this.currentAccount();
    } catch (error) {
      this.clear();
      throw error;
    }
    if (this.disposed || account !== this.access.scope.accountId || !this.access.mayReadLocal) {
      this.clear();
      throw new Error('Offline images lost their account or access.');
    }
  }
  private local(url: string) {
    this.assertAllowed();
    const known = this.issued.get(url);
    if (known) return { url, blob: known };
    const source = url.startsWith(this.access.scope.origin + '/')
      ? url.slice(this.access.scope.origin.length)
      : url;
    const blob = this.blobs.get(source);
    if (!blob) throw new Error('This image is not on this device; no remote fallback is allowed.');
    let local = this.urls.get(source);
    if (!local) {
      local = URL.createObjectURL(blob);
      this.urls.set(source, local);
      this.issued.set(local, blob);
    }
    return { url: local, blob };
  }
  /**
   * Returns a copy of a snapshot with every verified image source replaced by
   * its local object URL. Univer's document renderer loads drawing sources
   * directly rather than through this service, so this covers Doc and cell images.
   * Known drawing resource JSON is rewritten only when an image changes. Other
   * resource bytes and authored text remain intact. An unavailable native image
   * becomes an empty local image, so nothing falls back to the network.
   */
  localize<T>(snapshot: T): T {
    this.assertAllowed();
    return mapNativeImageSources(structuredClone(snapshot), (value) => {
      if (this.issued.has(value)) return value;
      const source = value.startsWith(this.access.scope.origin + '/')
        ? value.slice(this.access.scope.origin.length)
        : value;
      if (this.blobs.has(source)) return this.local(source).url;
      return value.startsWith('data:') ? value : EMPTY_IMAGE;
    });
  }
  /** Only URLs issued by this adapter are reversed; authored text stays intact. */
  canonicalize<T>(value: T): T {
    this.assertAllowed();
    const originals = new Map([...this.urls].map(([source, url]) => [url, source]));
    return mapNativeImageSources(
      structuredClone(value),
      (source) => originals.get(source) ?? source,
    );
  }
  async add(images: readonly OfflineBundleImage[], bytes: ReadonlyMap<string, Uint8Array>) {
    this.assertAllowed();
    const blobs = await verifyImages(this.access.scope.itemId, images, bytes, () =>
      this.assertAllowed(),
    );
    for (const [source, blob] of blobs) this.blobs.set(source, blob);
  }
  async getImage(url: string) {
    try {
      return this.local(url).url;
    } catch {
      this.access.needsAttention('An image is missing on this device. Download it again.');
      this.clear();
      // Rejecting would let the public drawing caller fall back to the original
      // URL. An empty local image cannot make a network request.
      return EMPTY_IMAGE;
    }
  }
  async downloadImage(url: string) {
    return this.local(url).blob;
  }
  registerURLImageDownloader(): never {
    throw new Error('Offline images cannot install a fallback downloader.');
  }
  dispose() {
    this.clear();
    this.stop();
  }
}
