import type { ClientCheckpoint, NativeSnapshot } from '@spinel/sync-client';
import { validateRecoverySnapshot } from '@spinel/sync-client';
import type { IURLImageService } from '@univerjs/core';
import type { OfflineBundleImage } from '../../src/shared/offlineBundle.ts';
import type { OfflineRecoveryRequest } from '../../src/shared/offlineRecovery.ts';
import type { WorkspaceItem } from '../../src/shared/workspace.ts';
import { PORTABLE_LIMIT } from '../../src/shared/portable.ts';
import { mapNativeImageSources } from '../../src/shared/nativeImageSources.ts';
import { snapshotIdentity } from '../../src/shared/snapshotIdentity.ts';
import { documentPath } from '../documentAccess.ts';
import { OfflineAccess, offlineScope } from './OfflineAccess.ts';
import { PreparedImages, checkImageList, sha256 } from './PreparedImages.ts';
import { ScopedHTTP } from './ScopedHTTP.ts';
import { checkBundle, downloadForOffline } from './download.ts';
import { isRuntimeCompatible } from './runtime.ts';
import { offlineCopyName, portableOfflineSnapshot, verifyRecoveryRequest } from './recovery.ts';
import { CreationUploadError, uploadOfflineCreation } from './creation.ts';
import {
  hasOfflineEdits,
  expirePreparedAccount,
  offlineAccountRead,
  offlineEpoch,
  offlinePreparation,
  openExistingOfflineStore,
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
  private endingAuthentication = false;
  private authenticationHTTPStopped = false;
  private recoveryCurrent?: () => boolean;
  private recoveryResolved = false;
  private verifiedRecovery?: { recovery: OfflineRecoveryRequest; checkpoint: ClientCheckpoint };
  private creationUpload?: Promise<boolean>;
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
    window.addEventListener('spinel-offline-account-changed', this.accountChanged);
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
  get creation() {
    return this.download?.creation;
  }
  get problem() {
    return this.attention || this.creation?.problem || '';
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
    return (
      !this.recoveryResolved && (Boolean(this.creation) || hasOfflineEdits(this.download?.outbox))
    );
  }
  get canRecover() {
    return Boolean(
      this.current && this.releaseWriter && !this.bundle?.readOnly && !this.recoveryResolved,
    );
  }
  get current() {
    return (
      !this.disposed &&
      this.mounted() &&
      (this.recoveryCurrent
        ? this.recoveryCurrent()
        : this.preparationCurrent() && (!this.readCurrent || this.readCurrent()))
    );
  }
  verify = () => {
    if (!this.current) throw closed();
  };
  verifyRemote = () => {
    this.verify();
    if (this.authenticationHTTPStopped || this.recoveryCurrent) throw closed();
  };
  private accountChanged = () => {
    if (this.endingAuthentication) return;
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
  /** End remote access immediately, before the bounded local save can yield. */
  stopAuthenticationHTTP() {
    this.authenticationHTTPStopped = true;
    this.online = false;
  }
  /**
   * A verified ended sign-in disables every offline launch. Only this mounted,
   * frozen tab may finish its existing local write; the next account epoch
   * invalidates that exception. It cannot prepare data or make HTTP requests.
   */
  endAuthentication() {
    this.verify();
    this.stopAuthenticationHTTP();
    if (this.recoveryCurrent) return;
    this.endingAuthentication = true;
    try {
      expirePreparedAccount();
      const verify = offlineEpoch();
      this.recoveryCurrent = () => {
        try {
          verify();
          const account = preparedAccount();
          return account === null || account === this.accountId;
        } catch {
          return false;
        }
      };
    } finally {
      this.endingAuthentication = false;
    }
  }
  async activate() {
    if (this.recoveryCurrent) return;
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
    let store: OfflineStore | null;
    try {
      store = await openExistingOfflineStore(this.accountId);
    } catch (error) {
      release?.();
      throw error;
    }
    if (!store) {
      release?.();
      return;
    }
    let keep = false;
    try {
      const download = await store.bundle(this.itemId);
      this.verify();
      if (!current()) throw closed();
      if (!download) return;
      const { bundle, outbox, bytes } = download;
      if (!isRuntimeCompatible({ format: bundle.version, sdkVersion: bundle.sdkVersion }))
        throw new Error(
          'This saved copy needs a compatible version of Spinel. Its data is retained.',
        );
      checkBundle(bundle, this.accountId, this.itemId, this.spaceId);
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
        this.current && (this.recoveryCurrent || current()) ? this.accountId : null,
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
    if (this.checkpoint) validateRecoverySnapshot(this.checkpoint);
    return {
      snapshot:
        this.checkpoint?.recoverySnapshot ??
        this.checkpoint?.snapshot ??
        snapshotIdentity(this.bundle.snapshot, this.bundle.unitId),
      revision: this.checkpoint?.revision ?? this.bundle.revision - this.bundle.revisionOffset,
    };
  }
  /** Frozen clean transitions keep exclusive ownership through the disk commit. */
  private async withCleanWriter(
    verifyClean: () => void,
    operation: (verify: () => void) => Promise<void>,
  ) {
    if (this.authenticationHTTPStopped || this.recoveryCurrent) throw closed();
    if (!this.store || !this.download || this.pending)
      throw new Error('This device copy cannot be changed while it has local changes.');
    // Editable sessions already hold this lock. Viewer copies acquire it for
    // the transition, so another tab cannot begin writing during replacement.
    const release = this.releaseWriter ? undefined : await writerLock(this.accountId, this.itemId);
    if (!this.releaseWriter && !release)
      throw new Error('Close this document in every other tab before updating its device copy.');
    const verify = () => {
      this.verify();
      if (this.authenticationHTTPStopped || this.recoveryCurrent) throw closed();
      verifyClean();
      if (this.pending) throw new Error('Local changes must be retained.');
    };
    try {
      verify();
      await operation(verify);
      verify();
    } finally {
      release?.();
    }
  }
  /** Only a frozen, clean native client may replace an expired replay base. */
  async refreshClean(verifyClean: () => void) {
    await this.withCleanWriter(verifyClean, async (verify) => {
      await downloadForOffline(this.store!, this.itemId, this.spaceId, verify);
    });
  }
  /** A verified access denial can remove a clean copy without releasing its writer. */
  async removeClean(verifyClean: () => void) {
    const store = this.store;
    await this.withCleanWriter(verifyClean, async (verify) => {
      await this.store!.removeClean(
        {
          account: this.accountId,
          item: this.itemId,
          spaceId: this.spaceId,
          unitId: this.bundle!.unitId,
          revisionOffset: this.bundle!.revisionOffset,
        },
        verify,
      );
    });
    // Finish scoped deletion and its post-commit check before clearing the
    // last preparation marker: clearing it intentionally locks local readers.
    await offlinePreparation(this.accountId, this.mounted).clearIfEmpty(store!);
  }
  async fetch(path: string, init: RequestInit = {}) {
    this.verifyRemote();
    if (this.http) {
      const response = await this.http.fetch(path, init);
      this.verifyRemote();
      return response;
    }
    const headers = new Headers(init.headers);
    headers.set('X-Spinel-Offline-Account', this.accountId);
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    this.verifyRemote();
    return response;
  }
  /** Admit the immutable empty base before access checks or native edit replay. */
  async ensureCreated(signal: AbortSignal) {
    if (!this.creation) return true;
    if (this.creation.problem || !this.releaseWriter) return false;
    if (this.creationUpload) return this.creationUpload;
    const creation = this.creation;
    this.creationUpload = (async () => {
      this.verifyRemote();
      try {
        const result = await uploadOfflineCreation(
          this.accountId,
          creation.request,
          signal,
          this.verifyRemote,
        );
        await this.store!.updateCreation(
          this.itemId,
          creation,
          undefined,
          this.verifyRemote,
          result.item,
        );
        this.verifyRemote();
        this.download!.creation = undefined;
        if (this.download!.outbox) delete this.download!.outbox.creation;
        this.onChange?.();
        return true;
      } catch (error) {
        this.verifyRemote();
        if (
          error instanceof CreationUploadError &&
          (error.code === 'folder-unavailable' || error.code === 'creation-conflict')
        ) {
          const next = {
            ...creation,
            problem:
              error.code === 'folder-unavailable'
                ? 'The chosen folder is no longer available. Use Back to files, then choose another folder from this document’s menu.'
                : 'The original upload could not be confirmed. Keep this device copy and export your work before removing it.',
            canRelocate: error.code === 'folder-unavailable',
          };
          await this.store!.updateCreation(this.itemId, creation, next, this.verifyRemote);
          this.download!.creation = next;
          this.onChange?.();
          return false;
        }
        throw error;
      }
    })().finally(() => {
      this.creationUpload = undefined;
    });
    return this.creationUpload;
  }
  toCanonical = <T>(value: T): T =>
    this.images ? this.images.canonicalize(value) : structuredClone(value);
  toVisible = <T>(value: T): T =>
    this.images ? this.images.localize(value) : structuredClone(value);

  /** Fetch new live images before applying/persisting a native frame. */
  async prepareImages(value: unknown, signal?: AbortSignal) {
    if (!this.download || !this.images) return;
    this.verify();
    signal?.throwIfAborted();
    const prefix = `/api/items/${this.itemId}/images/`;
    const sources = new Set<string>();
    const origin = this.access?.scope.origin;
    mapNativeImageSources(value, (source) => {
      const path = origin && source.startsWith(origin + '/') ? source.slice(origin.length) : source;
      if (path.startsWith(prefix) && /^[a-f\d]{64}$/.test(path.slice(prefix.length)))
        sources.add(path);
      return source;
    });
    for (const source of sources) {
      signal?.throwIfAborted();
      if (this.download.bytes.has(source)) continue;
      const hash = source.slice(prefix.length);
      const response = await this.fetch(
        `${documentPath(this.itemId, this.spaceId)}/images/${hash}`,
        {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok)
        throw new Error('An image could not be saved on this device. Keep this tab open.');
      const size = Number(response.headers.get('Content-Length'));
      if (size > 5 * 1024 * 1024) throw new Error('This image exceeds the offline image budget.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      signal?.throwIfAborted();
      this.verifyRemote();
      const image: OfflineBundleImage = {
        source,
        sha256: hash,
        mime: response.headers.get('Content-Type')?.split(';')[0] ?? '',
        byteLength: bytes.byteLength,
      };
      const images = [...this.download.bundle.images, image];
      checkImageList(this.itemId, images);
      if ((await sha256(bytes)) !== hash) throw new Error('An image failed its integrity check.');
      signal?.throwIfAborted();
      this.verifyRemote();
      await this.images.add([image], new Map([[source, bytes]]), () => {
        signal?.throwIfAborted();
        this.verifyRemote();
      });
      signal?.throwIfAborted();
      this.verifyRemote();
      this.download.bytes.set(source, bytes);
      this.download.bundle.images = images;
    }
  }
  async persist(checkpoint: ClientCheckpoint) {
    if (this.recoveryResolved) throw new Error('These offline changes have already been resolved.');
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
    this.download.outbox = {
      version: 1,
      ...scope,
      checkpoint: structuredClone(checkpoint),
      ...(this.creation ? { creation: true as const } : {}),
    };
  }
  async reconcileAvailability(checkpoint: ClientCheckpoint) {
    if (this.recoveryResolved) return;
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
  private recoveryScope() {
    this.verify();
    if (!this.canRecover || !this.bundle || !this.store)
      throw new Error('Close other tabs and reopen this downloaded document to recover it.');
    return {
      account: this.accountId,
      item: this.itemId,
      spaceId: this.spaceId,
      unitId: this.bundle.unitId,
      revisionOffset: this.bundle.revisionOffset,
    };
  }
  async exportSnapshot(checkpoint: ClientCheckpoint) {
    this.recoveryScope();
    return portableOfflineSnapshot(this.bundle!, checkpoint, this.download!.bytes, this.verify);
  }
  async prepareRecovery(checkpoint: ClientCheckpoint) {
    const scope = this.recoveryScope();
    const snapshot = await this.exportSnapshot(checkpoint);
    this.verify();
    if (this.download!.recovery) {
      const recovery = this.download!.recovery;
      verifyRecoveryRequest(this.bundle!, checkpoint, recovery, snapshot);
      this.verifiedRecovery = {
        recovery: structuredClone(recovery),
        checkpoint: structuredClone(checkpoint),
      };
      return structuredClone(recovery);
    }
    const name = offlineCopyName(this.bundle!.name);
    if ('sheets' in snapshot) snapshot.name = name;
    else snapshot.title = name;
    const recovery: OfflineRecoveryRequest = {
      recoveryId: crypto.randomUUID(),
      filename: `${name}.univer.json`,
      snapshot,
      possibleReplayCrash: Boolean(checkpoint.sent),
    };
    if (new TextEncoder().encode(JSON.stringify(recovery)).byteLength > PORTABLE_LIMIT)
      throw new Error(
        'This offline copy exceeds the import size limit. Export it as a Univer file to keep it.',
      );
    const saved = await this.store!.beginRecovery(scope, checkpoint, recovery, this.verify);
    this.verify();
    this.download!.recovery = saved;
    this.verifiedRecovery = {
      recovery: structuredClone(saved),
      checkpoint: structuredClone(checkpoint),
    };
    return structuredClone(saved);
  }
  /** Recovery is a new account file; never broaden the original scoped HTTP adapter. */
  async publishRecovery(recovery: OfflineRecoveryRequest, signal: AbortSignal) {
    this.recoveryScope();
    this.verifyRemote();
    if (JSON.stringify(this.verifiedRecovery?.recovery) !== JSON.stringify(recovery))
      throw new Error('This recovery request has not been verified. Keep this device copy.');
    const response = await fetch('/api/items/offline-recovery', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Spinel-Offline-Account': this.accountId },
      body: JSON.stringify(recovery),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    this.verifyRemote();
    const data = await response.json();
    this.verifyRemote();
    if (!response.ok)
      throw Object.assign(
        new Error(
          data.error ?? 'The copy could not be created. Your offline changes stay on this device.',
        ),
        { status: response.status },
      );
    const item = data.item as WorkspaceItem | undefined;
    if (
      !item ||
      !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(item.id) ||
      item.id === this.itemId ||
      item.access !== 'owner' ||
      item.parentId !== null ||
      item.kind !== this.bundle!.kind ||
      typeof item.name !== 'string'
    )
      throw new Error(
        'The recovery copy could not be verified. Your offline changes stay on this device.',
      );
    return item;
  }
  async finishRecovery(recoveryId?: string) {
    const scope = this.recoveryScope();
    if (recoveryId !== undefined && this.verifiedRecovery?.recovery.recoveryId !== recoveryId)
      throw new Error('This recovery request has not been verified. Keep this device copy.');
    await this.store!.finishRecovery(
      scope,
      recoveryId,
      this.verify,
      recoveryId === undefined ? undefined : this.verifiedRecovery,
    );
    this.recoveryResolved = true;
    this.download!.outbox = undefined;
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
    const blob = await response.blob();
    this.verifyRemote();
    return blob;
  }
  registerURLImageDownloader(): never {
    throw new Error('Offline images cannot install a fallback downloader.');
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('storage', this.accountChanged);
    window.removeEventListener('spinel-offline-account-changed', this.accountChanged);
    this.images?.dispose();
    this.access?.dispose();
    this.store?.close();
    this.releaseWriter?.();
  }
}

export type OfflineInitial = { snapshot: NativeSnapshot; revision: number };
