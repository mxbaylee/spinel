import type { IURLImageService } from '@univerjs/core';
import type { Subscription } from 'rxjs';
import type { OfflineReplay } from '../../src/shared/offlineReplay.ts';
import type { OfflineAccess, OfflineScope } from './OfflineAccess.ts';

type Manifest = { scope: OfflineScope; images: OfflineReplay['images'] };

/** Local public image-service replacement. The OSS downloader hook falls back
 * to remote URLs on rejection; the drawing caller also catches getImage errors.
 * A failed render read therefore returns a local invalid image URL AND latches
 * recovery attention. The coordinator must remove the editor on that state.
 * URLs/resources in snapshots and pending operations remain unchanged.
 */
export class PreparedImages implements IURLImageService {
  private access: OfflineAccess;
  private currentAccount: () => string | null;
  private blobs: Map<string, Blob>;
  private urls = new Map<string, string>();
  private stop: Subscription;
  private disposed = false;
  private constructor(
    access: OfflineAccess,
    currentAccount: () => string | null,
    blobs: Map<string, Blob>,
  ) {
    this.access = access;
    this.currentAccount = currentAccount;
    this.blobs = blobs;
    this.stop = access.state$.subscribe(() => {
      if (!access.mayReadLocal) this.clear();
    });
  }
  static async prepare(
    access: OfflineAccess,
    source: Manifest,
    bytes: ReadonlyMap<string, Uint8Array>,
    currentAccount: () => string | null,
  ) {
    const assert = () => {
      const account = currentAccount();
      if (account !== access.scope.accountId || !access.mayReadLocal)
        throw new Error('Prepared images lost their account or access.');
    };
    assert();
    const manifest = structuredClone(source);
    if (
      (Object.keys(access.scope) as (keyof OfflineScope)[]).some(
        (key) => manifest.scope[key] !== access.scope[key],
      ) ||
      !Array.isArray(manifest.images)
    )
      throw new Error('Prepared image scope is inconsistent.');
    const blobs = new Map<string, Blob>();
    let total = 0;
    for (const image of manifest.images) {
      if (
        !image ||
        typeof image.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(image.sha256) ||
        image.source !== `/api/items/${access.scope.itemId}/images/${image.sha256}` ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime) ||
        !Number.isSafeInteger(image.byteLength) ||
        image.byteLength <= 0 ||
        image.byteLength > 5 * 1024 * 1024 ||
        blobs.has(image.source)
      )
        throw new Error('Prepared image manifest is malformed.');
      // Match the existing upload/document image budgets; prepare serially.
      total += image.byteLength;
      if (total > 50 * 1024 * 1024)
        throw new Error('Prepared images exceed the document image budget.');
      const stored = bytes.get(image.source);
      if (!(stored instanceof Uint8Array) || stored.byteLength !== image.byteLength)
        throw new Error('A prepared image is missing or incomplete.');
      const copy = new Uint8Array(stored);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      assert();
      if (hash !== image.sha256)
        throw new Error('Prepared image bytes failed integrity verification.');
      blobs.set(image.source, new Blob([copy], { type: image.mime }));
    }
    assert();
    return new PreparedImages(access, currentAccount, blobs);
  }
  private clear() {
    this.disposed = true;
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.blobs.clear();
  }
  private resolve(url: string) {
    let account: string | null;
    try {
      account = this.currentAccount();
    } catch (error) {
      this.clear();
      throw error;
    }
    if (this.disposed || account !== this.access.scope.accountId || !this.access.mayReadLocal) {
      this.clear();
      throw new Error('Prepared images lost their account or access.');
    }
    const source = url.startsWith(this.access.scope.origin + '/')
      ? url.slice(this.access.scope.origin.length)
      : url;
    const blob = this.blobs.get(source);
    if (!blob) throw new Error('This image was not prepared; no remote fallback is allowed.');
    return { source, blob };
  }
  async getImage(url: string) {
    try {
      const { source, blob } = this.resolve(url);
      let local = this.urls.get(source);
      if (!local) {
        local = URL.createObjectURL(blob);
        this.urls.set(source, local);
      }
      return local;
    } catch {
      this.access.failRecovery(
        'An image is unavailable locally. Preserve pending work and reopen after checking access.',
      );
      this.clear();
      // Rejecting here lets the public OSS drawing caller use the original URL.
      // This cannot make a network request or claim a successful image decode.
      return 'data:image/png;base64,';
    }
  }
  async downloadImage(url: string) {
    return this.resolve(url).blob;
  }
  registerURLImageDownloader(): never {
    throw new Error('Prepared image resolution cannot install a fallback downloader.');
  }
  dispose() {
    this.clear();
    this.stop.unsubscribe();
  }
}
