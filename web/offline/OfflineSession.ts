import type { ClientCheckpoint, NativeSnapshot } from '@spinel/sync-client';
import type { IURLImageService } from '@univerjs/core';
import type { OfflineBundleImage } from '../../src/shared/offlineBundle.ts';
import { snapshotIdentity } from '../../src/shared/snapshotIdentity.ts';
import { documentPath } from '../documentAccess.ts';
import { OfflineAccess, offlineScope } from './OfflineAccess.ts';
import { PreparedImages, checkImageList, sha256 } from './PreparedImages.ts';
import { ScopedHTTP } from './ScopedHTTP.ts';
import {
  hasOfflineEdits,
  offlineAccountRead,
  offlinePreparation,
  openOfflineStore,
  preparedAccount,
} from './offlineStore.ts';
import type { OfflineStore } from './offlineStore.ts';

type Download = NonNullable<Awaited<ReturnType<OfflineStore['bundle']>>>;
const closed = () => new DOMException('This offline session is no longer current.', 'AbortError');

/** One account/item writer. Web Locks release automatically after a crash/reload. */
async function writerLock(account: string, item: string) {
  if (!navigator.locks) return undefined;
  let release!: () => void;
  const lifetime = new Promise<void>((resolve) => {
    release = resolve;
  });
  return new Promise<(() => void) | undefined>((resolve, reject) => {
    void navigator.locks
      .request(`spinel-offline:${account}:${item}`, { ifAvailable: true }, async (lock) => {
        resolve(lock ? release : undefined);
        if (lock) await lifetime;
      })
      .catch(reject);
  });
}

/**
 * Holds authorization epoch, verified images and the native client's storage
 * adapter. It owns no mutation queue; the native checkpoint is authoritative.
 */
export class OfflineSession implements IURLImageService {
  readonly accountId: string;
  readonly itemId: string;
  readonly spaceId?: string;
  private readonly mounted: () => boolean;
  private readonly preparationCurrent: () => boolean;
  private readCurrent?: () => boolean;
  private access?: OfflineAccess;
  private http?: ScopedHTTP;
  private images?: PreparedImages;
  private store?: OfflineStore;
  private releaseWriter?: () => void;
  private activation?: Promise<void>;
  private disposed = false;
  private download?: Download;
  private attention = '';
  onChange?: () => void;
  onLock?: () => void;
  online = false;

  constructor(
    accountId: string,
    itemId: string,
    spaceId: string | undefined,
    mounted: () => boolean,
  ) {
    this.accountId = accountId;
    this.itemId = itemId;
    this.spaceId = spaceId;
    this.mounted = mounted;
    this.preparationCurrent = offlinePreparation(accountId, mounted).isCurrent;
    window.addEventListener('storage', this.accountChanged);
  }
  get enabled() {
    return Boolean(this.download);
  }
  get bundle() {
    return this.download?.bundle;
  }
  get checkpoint() {
    return this.download?.outbox?.checkpoint;
  }
  get problem() {
    return this.attention;
  }
  get readOnly() {
    return Boolean(
      this.bundle?.readOnly ||
      (this.enabled && !this.releaseWriter) ||
      this.attention ||
      this.checkpoint?.failure,
    );
  }
  get pending() {
    return hasOfflineEdits(this.download?.outbox);
  }
  get current() {
    return (
      !this.disposed &&
      this.mounted() &&
      this.preparationCurrent() &&
      (!this.readCurrent || this.readCurrent())
    );
  }
  verify = () => {
    if (!this.current) throw closed();
  };
  private accountChanged = () => {
    if (!this.current) {
      this.access?.lock('You signed out or changed accounts on this device.');
      this.onLock?.();
    }
  };
  stopRemote(reason: string) {
    this.online = false;
    this.attention = reason;
    this.onChange?.();
  }
  async activate() {
    if (this.enabled || preparedAccount() !== this.accountId) return;
    if (this.activation) return this.activation;
    this.activation = this.open().finally(() => {
      this.activation = undefined;
    });
    return this.activation;
  }
  private async open() {
    this.verify();
    const current = offlineAccountRead(this.accountId);
    let release = await writerLock(this.accountId, this.itemId);
    let store: OfflineStore;
    try {
      store = await openOfflineStore(this.accountId);
    } catch (error) {
      release?.();
      throw error;
    }
    let keep = false;
    try {
      const download = await store.bundle(this.itemId);
      this.verify();
      if (!current()) throw closed();
      if (!download) return;
      const { bundle, outbox, bytes } = download;
      if (
        bundle.accountId !== this.accountId ||
        bundle.itemId !== this.itemId ||
        bundle.spaceId !== this.spaceId
      )
        throw new Error('This copy belongs to another document or Space.');
      if (
        outbox &&
        (outbox.version !== 1 ||
          outbox.account !== this.accountId ||
          outbox.item !== this.itemId ||
          outbox.spaceId !== this.spaceId ||
          outbox.unitId !== bundle.unitId ||
          outbox.revisionOffset !== bundle.revisionOffset)
      )
        throw new Error(
          'This device copy needs attention. Its original document cannot be verified.',
        );
      const access = new OfflineAccess(offlineScope(bundle));
      access.subscribe((state) => {
        if (state.phase === 'attention')
          this.stopRemote(state.reason ?? 'The downloaded images need attention.');
      });
      const images = await PreparedImages.prepare(access, bundle.images, bytes, () =>
        current() && this.current ? this.accountId : null,
      );
      if (bundle.readOnly) {
        release?.();
        release = undefined;
      }
      if (!current() || !this.current) {
        release?.();
        images.dispose();
        access.dispose();
        throw closed();
      }
      this.readCurrent = current;
      this.access = access;
      this.images = images;
      this.http = new ScopedHTTP(access, () => this.current);
      this.releaseWriter = release;
      this.download = download;
      this.store = store;
      keep = true;
      if (!bundle.readOnly && !release)
        this.attention =
          'This downloaded document is open in another tab, or this browser cannot protect its offline edits. Close the other tab and reopen it here.';
      this.onChange?.();
    } finally {
      if (!keep) {
        release?.();
        store.close();
      }
    }
  }
  initial() {
    if (!this.bundle) return undefined;
    return {
      snapshot:
        this.checkpoint?.snapshot ?? snapshotIdentity(this.bundle.snapshot, this.bundle.unitId),
      revision: this.checkpoint?.revision ?? this.bundle.revision - this.bundle.revisionOffset,
    };
  }
  async fetch(path: string, init: RequestInit = {}) {
    this.verify();
    if (this.http) return this.http.fetch(path, init);
    const headers = new Headers(init.headers);
    headers.set('X-Spinel-Offline-Account', this.accountId);
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    this.verify();
    return response;
  }
  toCanonical = <T>(value: T): T =>
    this.images ? this.images.canonicalize(value) : structuredClone(value);
  toVisible = <T>(value: T): T =>
    this.images ? this.images.localize(value) : structuredClone(value);

  /** Fetch new live images before applying/persisting a native frame. */
  async prepareImages(value: unknown) {
    if (!this.download || !this.images) return;
    this.verify();
    const prefix = `/api/items/${this.itemId}/images/`;
    const sources = new Set<string>();
    const visit = (entry: unknown, key?: string) => {
      if (typeof entry === 'string') {
        if (entry.startsWith(prefix) && /^[a-f\d]{64}$/.test(entry.slice(prefix.length)))
          sources.add(entry);
        if (key === 'data') {
          try {
            visit(JSON.parse(entry));
          } catch {
            /* Non-JSON resources are opaque. */
          }
        }
      } else if (Array.isArray(entry)) for (const child of entry) visit(child);
      else if (entry && typeof entry === 'object')
        for (const [name, child] of Object.entries(entry)) visit(child, name);
    };
    visit(value);
    for (const source of sources) {
      if (this.download.bytes.has(source)) continue;
      const hash = source.slice(prefix.length);
      const response = await this.fetch(
        `${documentPath(this.itemId, this.spaceId)}/images/${hash}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok)
        throw new Error('An image could not be saved on this device. Keep this tab open.');
      const size = Number(response.headers.get('Content-Length'));
      if (size > 5 * 1024 * 1024) throw new Error('This image exceeds the offline image budget.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      this.verify();
      const image: OfflineBundleImage = {
        source,
        sha256: hash,
        mime: response.headers.get('Content-Type')?.split(';')[0] ?? '',
        byteLength: bytes.byteLength,
      };
      const images = [...this.download.bundle.images, image];
      checkImageList(this.itemId, images);
      if ((await sha256(bytes)) !== hash) throw new Error('An image failed its integrity check.');
      this.verify();
      await this.images.add([image], new Map([[source, bytes]]));
      this.download.bytes.set(source, bytes);
      this.download.bundle.images = images;
    }
  }
  async persist(checkpoint: ClientCheckpoint) {
    const wasEnabled = this.enabled;
    await this.activate();
    if (!this.download) return;
    if (!wasEnabled && this.pending) {
      this.stopRemote(
        'Another editing session left changes on this device. Keep this tab open and reopen the downloaded copy to recover them.',
      );
      this.releaseWriter?.();
      this.releaseWriter = undefined;
      throw new Error(this.problem);
    }
    this.verify();
    if (!this.releaseWriter || this.bundle!.readOnly) {
      if (checkpoint.sent || checkpoint.buffer.length)
        throw new Error('This offline copy is read-only.');
      return;
    }
    const bundle = this.bundle!;
    if (checkpoint.unitId !== bundle.unitId) throw new Error('The document generation changed.');
    await this.prepareImages(checkpoint);
    this.verify();
    const scope = {
      account: this.accountId,
      item: this.itemId,
      spaceId: this.spaceId,
      unitId: bundle.unitId,
      revisionOffset: bundle.revisionOffset,
    };
    await this.store!.saveCheckpoint(scope, checkpoint, this.verify, {
      images: bundle.images,
      bytes: this.download.bytes,
    });
    this.download.outbox = { version: 1, ...scope, checkpoint: structuredClone(checkpoint) };
  }
  async reconcileAvailability(checkpoint: ClientCheckpoint) {
    if (!this.download || !this.store) return;
    const stored = await this.store.bundle(this.itemId);
    this.verify();
    if (stored) return;
    if (checkpoint.sent || checkpoint.buffer.length || checkpoint.failure)
      throw new Error(
        'The device copy was removed before these changes were saved. Keep this tab open.',
      );
    this.download = undefined;
    this.store.close();
    this.store = undefined;
    this.releaseWriter?.();
    this.releaseWriter = undefined;
    this.attention = '';
    this.onChange?.();
  }
  async getImage(url: string) {
    if (this.enabled) {
      await this.prepareImages(url).catch(() => {});
      return this.images!.getImage(url);
    }
    this.verify();
    return url;
  }
  async downloadImage(url: string) {
    if (this.images) return this.images.downloadImage(url);
    const response = await this.fetch(url);
    if (!response.ok) throw new Error('The image could not be opened.');
    return response.blob();
  }
  registerURLImageDownloader(): never {
    throw new Error('Offline images cannot install a fallback downloader.');
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('storage', this.accountChanged);
    this.images?.dispose();
    this.access?.dispose();
    this.store?.close();
    this.releaseWriter?.();
  }
}

export type OfflineInitial = { snapshot: NativeSnapshot; revision: number };
