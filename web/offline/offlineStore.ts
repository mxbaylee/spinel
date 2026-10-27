import type { OfflineBundle, OfflineBundleImage } from '../../src/shared/offlineBundle.ts';
import { FILE_KINDS } from '../../src/shared/workspace.ts';
import type { FileItem, SpaceFile, WorkspaceItem } from '../../src/shared/workspace.ts';
import { OFFLINE_SDK_VERSION, offlineScope } from './OfflineAccess.ts';
import type { ClientCheckpoint } from '@spinel/sync-client';
import { validateNativeSnapshot, validateCheckpoint } from '@spinel/sync-client/validation';
import type { OfflineRecoveryRequest } from '../../src/shared/offlineRecovery.ts';
import { isOfflineCreationRequest } from '../../src/shared/offlineCreation.ts';
import type { OfflineCreationRequest } from '../../src/shared/offlineCreation.ts';
import { openExistingDatabase } from './existingDatabase.ts';
import { releaseAccountRuntime } from './runtime.ts';
import type { AccountRuntimeRequirement } from './runtime.ts';

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
  pending?: boolean;
  /** A record alone is not proof that its images and public runtime still exist. */
  available?: boolean;
  problem?: string;
  uncertain?: boolean;
  /** A durable new file which has not yet been acknowledged by the server. */
  creation?: {
    parentId: string | null;
    createdAt: number;
    problem?: string;
    canRelocate?: boolean;
  };
  /** Last acknowledged metadata for a locally created file, independent of stale catalogs. */
  createdFile?: WorkspaceItem;
};
export type OfflineCreation = {
  request: OfflineCreationRequest;
  createdAt: number;
  problem?: string;
  canRelocate?: boolean;
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
  /** Older runtimes reject unknown queue fields and therefore retain this draft. */
  creation?: true;
};
export type StoredItem = Omit<OfflineDownload, 'creation'> & {
  bundle: OfflineBundle;
  outbox?: OfflineOutbox;
  recovery?: OfflineRecoveryRequest;
  creation?: OfflineCreation;
};
export type StoredImage = { itemId: string; source: string; bytes: Uint8Array };

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Minimum native-kind shape required before the editor can admit a stored base. */
function storedSnapshotShape(value: unknown, kind: unknown, unitId: unknown) {
  if (
    !object(value) ||
    typeof unitId !== 'string' ||
    !unitId ||
    value.id !== unitId ||
    (kind !== 'doc' && kind !== 'sheet') ||
    (kind === 'doc' ? 'sheets' in value : !object(value.sheets))
  )
    return false;
  try {
    validateNativeSnapshot(value as unknown as ClientCheckpoint['snapshot'], kind);
    return true;
  } catch {
    return false;
  }
}

function storedBaseKnown(item: Record<string, unknown>, bundle: Record<string, unknown>) {
  const outbox = object(item.outbox) ? item.outbox : undefined;
  const checkpoint = outbox && object(outbox.checkpoint) ? outbox.checkpoint : undefined;
  return (
    bundle.version === 1 &&
    bundle.sdkVersion === OFFLINE_SDK_VERSION &&
    typeof bundle.accountId === 'string' &&
    Boolean(bundle.accountId) &&
    typeof bundle.unitId === 'string' &&
    Boolean(bundle.unitId) &&
    (bundle.spaceId === undefined ||
      (typeof bundle.spaceId === 'string' &&
        Boolean(bundle.spaceId) &&
        bundle.spaceId !== bundle.itemId)) &&
    typeof bundle.access === 'string' &&
    ['owner', 'admin', 'editor', 'viewer'].includes(bundle.access) &&
    typeof bundle.readOnly === 'boolean' &&
    (bundle.access !== 'viewer' || bundle.readOnly) &&
    storedSnapshotShape(bundle.snapshot, bundle.kind, bundle.itemId) &&
    Number.isSafeInteger(bundle.revision) &&
    Number.isSafeInteger(bundle.revisionOffset) &&
    Number(bundle.revisionOffset) >= 0 &&
    Number(bundle.revision) > Number(bundle.revisionOffset) &&
    Array.isArray(bundle.images) &&
    (!checkpoint ||
      (storedSnapshotShape(checkpoint.snapshot, bundle.kind, outbox!.unitId) &&
        (checkpoint.recoverySnapshot === undefined ||
          storedSnapshotShape(checkpoint.recoverySnapshot, bundle.kind, outbox!.unitId))))
  );
}

function storedCreationKnown(item: Record<string, unknown>, bundle: Record<string, unknown>) {
  if (
    item.createdFile !== undefined &&
    (!object(item.createdFile) ||
      item.createdFile.id !== bundle.itemId ||
      item.createdFile.kind !== bundle.kind ||
      item.createdFile.access !== 'owner' ||
      !isOfflineCatalog({ syncedAt: 0, items: [item.createdFile], shared: [], views: {} }))
  )
    return false;
  if (item.creation === undefined)
    return !object(item.outbox) || item.outbox.creation === undefined;
  const creation = item.creation;
  if (!object(creation) || !isOfflineCreationRequest(creation.request)) return false;
  const request = creation.request;
  return (
    request.itemId === bundle.itemId &&
    request.unitId === bundle.unitId &&
    request.name === bundle.name &&
    request.kind === bundle.kind &&
    bundle.spaceId === undefined &&
    bundle.access === 'owner' &&
    bundle.readOnly === false &&
    bundle.revision === 1 &&
    bundle.revisionOffset === 0 &&
    Number.isFinite(creation.createdAt) &&
    Number(creation.createdAt) > 0 &&
    (creation.problem === undefined || typeof creation.problem === 'string') &&
    (creation.canRelocate === undefined || typeof creation.canRelocate === 'boolean') &&
    object(item.outbox) &&
    item.outbox.creation === true
  );
}

export function isKnownOfflineOutbox(value: unknown): value is OfflineOutbox {
  if (!object(value) || value.version !== 1 || !object(value.checkpoint)) return false;
  const checkpoint = value.checkpoint;
  // Use the same pure admission as the editor, without loading the SDK here.
  try {
    validateCheckpoint(
      checkpoint as unknown as ClientCheckpoint,
      value.unitId as string,
      checkpoint.revision as number,
    );
  } catch {
    return false;
  }
  const mutation = (entry: unknown) =>
    object(entry) && typeof entry.id === 'string' && object(entry.params);
  return (
    typeof value.account === 'string' &&
    Boolean(value.account) &&
    typeof value.item === 'string' &&
    Boolean(value.item) &&
    (value.spaceId === undefined ||
      (typeof value.spaceId === 'string' && Boolean(value.spaceId))) &&
    typeof value.unitId === 'string' &&
    Boolean(value.unitId) &&
    Number.isSafeInteger(value.revisionOffset) &&
    Number(value.revisionOffset) >= 0 &&
    checkpoint.version === 1 &&
    checkpoint.unitId === value.unitId &&
    (value.creation === undefined || value.creation === true) &&
    Number.isSafeInteger(checkpoint.revision) &&
    Number(checkpoint.revision) >= 1 &&
    object(checkpoint.snapshot) &&
    checkpoint.snapshot.id === value.unitId &&
    Array.isArray(checkpoint.inflight) &&
    checkpoint.inflight.every(mutation) &&
    Array.isArray(checkpoint.buffer) &&
    checkpoint.buffer.every(
      (group) => Array.isArray(group) && group.length > 0 && group.every(mutation),
    ) &&
    (checkpoint.sent === null ||
      (object(checkpoint.sent) &&
        checkpoint.sent.type === 'submit' &&
        typeof checkpoint.sent.mutationId === 'string' &&
        Number.isSafeInteger(checkpoint.sent.baseRevision) &&
        Array.isArray(checkpoint.sent.mutations) &&
        checkpoint.sent.mutations.length > 0 &&
        checkpoint.sent.mutations.every(mutation))) &&
    (checkpoint.recoveryMissing === undefined || typeof checkpoint.recoveryMissing === 'boolean') &&
    (checkpoint.failure === undefined ||
      [
        'unsupported',
        'refused',
        'stale',
        'divergence',
        'unavailable',
        'malformed',
        'capacity',
        'retry-conflict',
        'invariant',
      ].includes(String(checkpoint.failure))) &&
    (checkpoint.recoverySnapshot === undefined || object(checkpoint.recoverySnapshot)) &&
    Object.keys(value).every((key) =>
      [
        'version',
        'account',
        'item',
        'spaceId',
        'unitId',
        'revisionOffset',
        'checkpoint',
        'creation',
      ].includes(key),
    ) &&
    Object.keys(checkpoint).every((key) =>
      [
        'version',
        'unitId',
        'revision',
        'snapshot',
        'sent',
        'inflight',
        'buffer',
        'failure',
        'recoverySnapshot',
        'recoveryMissing',
      ].includes(key),
    )
  );
}

/** The caller has already admitted this checkpoint. */
function checkpointHasEdits(checkpoint: ClientCheckpoint) {
  return Boolean(
    checkpoint.sent ||
    checkpoint.inflight.length ||
    checkpoint.buffer.length ||
    checkpoint.failure !== undefined ||
    checkpoint.recoverySnapshot !== undefined ||
    checkpoint.recoveryMissing,
  );
}

/** Unknown persisted queue data is retained, never treated as an empty queue. */
export function hasOfflineEdits(outbox: unknown) {
  if (outbox === undefined) return false;
  return (
    !isKnownOfflineOutbox(outbox) ||
    outbox.creation === true ||
    checkpointHasEdits(outbox.checkpoint)
  );
}

export function hasStoredEdits(item: unknown) {
  if (
    !object(item) ||
    !object(item.bundle) ||
    !storedBaseKnown(item, item.bundle) ||
    typeof item.bundle.accountId !== 'string' ||
    typeof item.bundle.itemId !== 'string' ||
    typeof item.bundle.unitId !== 'string' ||
    !object(item.bundle.snapshot) ||
    !Array.isArray(item.bundle.images) ||
    item.recovery !== undefined ||
    item.creation !== undefined ||
    hasOfflineEdits(item.outbox)
  )
    return true;
  if (object(item.outbox))
    return (
      item.outbox.account !== item.bundle.accountId ||
      item.outbox.item !== item.bundle.itemId ||
      item.outbox.spaceId !== item.bundle.spaceId ||
      item.outbox.unitId !== item.bundle.unitId ||
      item.outbox.revisionOffset !== item.bundle.revisionOffset
    );
  return false;
}

const CHANGE_KEY = 'spinel.offline.changed';

export type OfflineChange = { itemId: string; pending?: boolean };
type AccountOfflineChange = OfflineChange & { accountId: string };
const itemWriterChanges = new Map<string, AccountOfflineChange[]>();
const itemWriterKey = (accountId: string, itemId: string) => JSON.stringify([accountId, itemId]);

function publishOfflineChange(detail: AccountOfflineChange) {
  window.dispatchEvent(new CustomEvent('spinel-offline-changed', { detail }));
  try {
    storage()?.setItem(CHANGE_KEY, JSON.stringify({ ...detail, change: crypto.randomUUID() }));
  } catch {
    // A notification failure must not turn a completed private write into a failure.
  }
}

export const offlineChanged = (accountId: string, itemId: string, pending?: boolean) => {
  const detail = { accountId, itemId, ...(pending === undefined ? {} : { pending }) };
  const deferred = itemWriterChanges.get(itemWriterKey(accountId, itemId));
  if (deferred) deferred.push(detail);
  else publishOfflineChange(detail);
};

export function watchOfflineChanges(accountId: string, changed: (change: OfflineChange) => void) {
  const local = (event: Event) => {
    const detail = (event as CustomEvent<{ accountId?: string } & OfflineChange>).detail;
    if (detail?.accountId === accountId && typeof detail.itemId === 'string') changed(detail);
  };
  const remote = (event: StorageEvent) => {
    if (event.key !== CHANGE_KEY || !event.newValue) return;
    try {
      const detail = JSON.parse(event.newValue);
      if (detail.accountId === accountId && typeof detail.itemId === 'string') changed(detail);
    } catch {
      /* Invalid notice. */
    }
  };
  window.addEventListener('spinel-offline-changed', local);
  window.addEventListener('storage', remote);
  return () => {
    window.removeEventListener('spinel-offline-changed', local);
    window.removeEventListener('storage', remote);
  };
}

/** Validate identity before exposing a stored title; damaged records stay visible generically. */
export function downloadSummary(
  value: unknown,
  accountId: string,
  itemId: string,
): OfflineDownload {
  const item = object(value) ? value : {};
  const bundle = object(item.bundle) ? item.bundle : {};
  const valid =
    item.itemId === itemId &&
    bundle.accountId === accountId &&
    bundle.itemId === itemId &&
    ['sheet', 'doc'].includes(String(bundle.kind)) &&
    typeof bundle.name === 'string' &&
    bundle.name.length > 0 &&
    (bundle.spaceId === undefined ||
      (typeof bundle.spaceId === 'string' && Boolean(bundle.spaceId)));
  const outbox = object(item.outbox) ? item.outbox : undefined;
  const scopeMismatch =
    outbox &&
    (outbox.account !== bundle.accountId ||
      outbox.item !== bundle.itemId ||
      outbox.spaceId !== bundle.spaceId ||
      outbox.unitId !== bundle.unitId ||
      outbox.revisionOffset !== bundle.revisionOffset);
  const uncertain =
    !valid ||
    !storedBaseKnown(item, bundle) ||
    !storedCreationKnown(item, bundle) ||
    Boolean(scopeMismatch) ||
    (item.outbox !== undefined && !isKnownOfflineOutbox(item.outbox)) ||
    (item.recovery !== undefined && item.outbox === undefined);
  return {
    itemId,
    ...(valid && typeof bundle.spaceId === 'string' ? { spaceId: bundle.spaceId } : {}),
    name: valid ? (bundle.name as string) : 'Unavailable device copy',
    kind: valid ? (bundle.kind as 'sheet' | 'doc') : 'doc',
    readOnly: valid ? bundle.readOnly !== false : true,
    revision: Number.isSafeInteger(bundle.revision) ? (bundle.revision as number) : 0,
    downloadedAt: Number.isFinite(item.downloadedAt) ? (item.downloadedAt as number) : 0,
    // Reuse this summary's admission; encoding the same stored snapshots again
    // for the pending flag would add avoidable work to every checkpoint save.
    pending:
      uncertain ||
      item.recovery !== undefined ||
      item.creation !== undefined ||
      Boolean(outbox && checkpointHasEdits(outbox.checkpoint as ClientCheckpoint)),
    ...(!uncertain && item.creation !== undefined
      ? {
          creation: {
            parentId: (item.creation as OfflineCreation).request.parentId,
            createdAt: (item.creation as OfflineCreation).createdAt,
            problem: (item.creation as OfflineCreation).problem,
            canRelocate: (item.creation as OfflineCreation).canRelocate,
          },
        }
      : {}),
    ...(!uncertain && item.createdFile !== undefined
      ? { createdFile: item.createdFile as WorkspaceItem }
      : {}),
    ...(uncertain
      ? {
          available: false,
          uncertain: true,
          problem: valid
            ? 'The saved offline changes could not be verified. Keep this copy until you choose how to handle them.'
            : 'This saved copy is incomplete or belongs to a different account.',
        }
      : {}),
  };
}

/** Destructive paths use the same scoped uncertainty boundary as the inventory. */
function hasProtectedStoredCopy(value: unknown, accountId: string, itemId: string) {
  const valueSummary = downloadSummary(value, accountId, itemId);
  return Boolean(valueSummary.pending || valueSummary.uncertain);
}

const summary = (item: StoredItem) => downloadSummary(item, item.bundle.accountId, item.itemId);

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

/** Cached permission is provisional; the server rechecks it before creating anything. */
export function creationFolderAllowed(catalog: OfflineCatalog, parentId: string | null) {
  return (
    parentId === null ||
    [...catalog.items, ...Object.values(catalog.views).flat()].some(
      (item) => item.id === parentId && item.kind === 'folder' && item.access === 'owner',
    )
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
export function offlineCancellation() {
  return storage()?.getItem(CANCELLATION_KEY) ?? null;
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

/** Shells close for identity changes, not unrelated preferences after local expiry. */
export function offlineAccountEvent(
  event: Pick<StorageEvent, 'key' | 'newValue'>,
  accountId: string,
) {
  return (
    event.key === null ||
    event.key === CANCELLATION_KEY ||
    (event.key === SIGN_OUT_KEY && event.newValue !== null) ||
    ((event.key === ACCOUNT_KEY || event.key === ONLINE_ACCOUNT_KEY) &&
      event.newValue !== accountId)
  );
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
export async function withOfflineCatalogLock<T>(
  accountId: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!globalThis.navigator?.locks) return operation();
  return navigator.locks.request(`spinel-offline-catalog:${accountId}`, operation);
}

/** Never wait on a live editor: its unfinished memory input has not reached IDB yet. */
export async function withOfflineItemWriter<T>(
  accountId: string,
  itemId: string,
  operation: () => Promise<T>,
) {
  if (!navigator.locks)
    throw new Error('This browser cannot safely change device data. Use a browser with Web Locks.');
  const key = itemWriterKey(accountId, itemId);
  let changes: AccountOfflineChange[] | undefined;
  try {
    return await navigator.locks.request(
      `spinel-offline:${accountId}:${itemId}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw new Error('Close this document in every tab before changing its device copy.');
        changes = [];
        itemWriterChanges.set(key, changes);
        return operation();
      },
    );
  } finally {
    if (changes) {
      if (itemWriterChanges.get(key) === changes) itemWriterChanges.delete(key);
      // An open editor reacts by acquiring its own item writer. Announce a
      // committed change only after this temporary Web Lock actually releases,
      // including when later work fails. Native editors hold a separate lifetime
      // lock, so their pending-checkpoint notices are never delayed here.
      for (const change of changes) publishOfflineChange(change);
    }
  }
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
      await withOfflineCatalogLock(accountId, async () => {
        if (!isCurrent()) return;
        const remaining = await store.downloads();
        if (!remaining.length && isCurrent()) {
          // Keep the catalog lock until release settles, so a new reservation
          // cannot be removed by this earlier empty observation.
          await releaseAccountRuntime(accountId, () => {
            if (!isCurrent()) throw new DOMException('The account changed.', 'AbortError');
          }).catch(() => {});
        }
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
  return storage()?.getItem(SIGN_OUT_KEY) != null;
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
    transaction.onerror = (event) => {
      const error = (event.target as IDBRequest | null)?.error ?? transaction.error;
      if (error) reject(error);
    };
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

/** Observation must not create or migrate a private store, even without databases(). */
export async function openExistingOfflineStore(accountId: string) {
  if (!accountId) throw new Error('An account is required.');
  const database = await openExistingDatabase(databaseName(accountId));
  if (!database) return null;
  if (
    database.version !== 1 ||
    !['meta', 'items', 'images'].every((name) => database.objectStoreNames.contains(name))
  ) {
    database.close();
    throw new Error(
      'This device store needs a compatible version of Spinel. Its data is retained.',
    );
  }
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
    const result: OfflineDownload[] = [];
    for (const itemId of await this.itemIds()) {
      const transaction = this.database.transaction('items');
      const value: unknown = await request(transaction.objectStore('items').get(itemId));
      if (value !== undefined) result.push(downloadSummary(value, this.accountId, itemId));
    }
    return result;
  }
  async itemIds() {
    const keys = await this.itemKeys();
    if (keys.some((key) => typeof key !== 'string' || !key))
      throw new Error('This device store contains unrecognized data. Its contents are retained.');
    return keys as string[];
  }
  async itemKeys() {
    const transaction = this.database.transaction('items');
    return request(transaction.objectStore('items').getAllKeys());
  }
  async inspect(itemId: string) {
    const transaction = this.database.transaction(['items', 'images']);
    const item: unknown = await request(transaction.objectStore('items').get(itemId));
    if (item === undefined) return undefined;
    const images = (await request(
      transaction.objectStore('images').getAll(IDBKeyRange.bound([itemId, ''], [itemId, '\uffff'])),
    )) as StoredImage[];
    return { item, images };
  }
  /** No native parser is needed to choose the reader for retained bytes. */
  async runtimeRequirement(): Promise<AccountRuntimeRequirement> {
    let compatibility: { format: number; sdkVersion: string } | undefined;
    const keys = await this.itemIds();
    if (!keys.length) return { kind: 'empty' };
    for (const itemId of keys) {
      const transaction = this.database.transaction('items');
      const item: unknown = await request(transaction.objectStore('items').get(itemId));
      if (!object(item) || !object(item.bundle)) return { kind: 'unknown' };
      const bundle = item.bundle;
      if (
        bundle.accountId !== this.accountId ||
        bundle.itemId !== itemId ||
        !Number.isSafeInteger(bundle.version) ||
        Number(bundle.version) < 1 ||
        typeof bundle.sdkVersion !== 'string' ||
        !bundle.sdkVersion
      )
        return { kind: 'unknown' };
      const next = { format: bundle.version as number, sdkVersion: bundle.sdkVersion };
      if (
        compatibility &&
        (compatibility.format !== next.format || compatibility.sdkVersion !== next.sdkVersion)
      )
        return { kind: 'unknown' };
      compatibility = next;
    }
    return { kind: 'retained', compatibility: compatibility! };
  }
  async bundle(itemId: string) {
    const saved = await this.inspect(itemId);
    if (!saved) return undefined;
    const { item: raw, images } = saved;
    if (downloadSummary(raw, this.accountId, itemId).uncertain)
      throw new Error('This saved copy is incomplete or belongs to a different account.');
    const item = raw as StoredItem;
    return {
      bundle: item.bundle,
      bytes: new Map(images.map((image) => [image.source, image.bytes])),
      outbox: item.outbox,
      recovery: item.recovery,
      creation: item.creation,
    };
  }
  /** A new file and its old-reader-visible pending marker commit together. */
  async saveCreation(bundle: OfflineBundle, creation: OfflineCreation, verifyCurrent: () => void) {
    verifyCurrent();
    // Storage inspection stays independent of native rendering/formula modules.
    const { snapshotIdentity } = await import('../../src/shared/snapshotIdentity.ts');
    verifyCurrent();
    const outbox: OfflineOutbox = {
      version: 1,
      account: this.accountId,
      item: bundle.itemId,
      unitId: bundle.unitId,
      revisionOffset: 0,
      creation: true,
      checkpoint: {
        version: 1,
        unitId: bundle.unitId,
        revision: 1,
        snapshot: snapshotIdentity(bundle.snapshot, bundle.unitId),
        sent: null,
        inflight: [],
        buffer: [],
      },
    };
    const item: StoredItem = {
      itemId: bundle.itemId,
      name: bundle.name,
      kind: bundle.kind,
      readOnly: false,
      revision: 1,
      downloadedAt: creation.createdAt,
      bundle,
      outbox,
      creation,
    };
    if (downloadSummary(item, this.accountId, bundle.itemId).uncertain || bundle.images.length)
      throw new Error('This new document could not be verified.');
    return withOfflineCatalogLock(this.accountId, async () => {
      verifyCurrent();
      const transaction = this.database.transaction(['items', 'meta'], 'readwrite');
      const completion = done(transaction);
      try {
        const items = transaction.objectStore('items');
        const existing = await request(items.get(bundle.itemId));
        const catalog = await request(transaction.objectStore('meta').get('catalog'));
        const user = await request(transaction.objectStore('meta').get('user'));
        verifyCurrent();
        if (existing !== undefined) throw new Error('This document already exists on this device.');
        if (!isOfflineCatalog(catalog) || !object(user) || user.id !== this.accountId)
          throw new Error('Prepare this account online before creating documents offline.');
        if (!creationFolderAllowed(catalog, creation.request.parentId))
          throw new Error('Choose one of your own prepared folders for this document.');
        items.add(item);
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          /* Already aborted. */
        }
        await completion.catch(() => {});
        throw error;
      }
      await completion;
      verifyCurrent();
      offlineChanged(this.accountId, bundle.itemId);
      return summary(item);
    });
  }
  /** Caller owns the item writer. Failure never clears the creation or its edits. */
  async updateCreation(
    itemId: string,
    expected: OfflineCreation,
    next: OfflineCreation | undefined,
    verifyCurrent: () => void,
    accepted?: WorkspaceItem,
  ) {
    verifyCurrent();
    const transaction = this.database.transaction(['items', 'meta'], 'readwrite');
    const completion = done(transaction);
    try {
      const items = transaction.objectStore('items');
      const item = (await request(items.get(itemId))) as StoredItem | undefined;
      verifyCurrent();
      if (
        !item ||
        downloadSummary(item, this.accountId, itemId).uncertain ||
        JSON.stringify(item.creation) !== JSON.stringify(expected)
      )
        throw new Error('This new document changed. Reopen its device copy before trying again.');
      if (next) {
        item.creation = next;
        if (downloadSummary(item, this.accountId, itemId).uncertain)
          throw new Error('The new document destination could not be verified.');
      } else {
        if (
          !accepted ||
          accepted.id !== itemId ||
          accepted.kind !== item.kind ||
          accepted.access !== 'owner'
        )
          throw new Error('The uploaded document could not be verified.');
        const meta = transaction.objectStore('meta');
        const catalog = await request(meta.get('catalog'));
        verifyCurrent();
        if (!isOfflineCatalog(catalog))
          throw new Error('The saved file list could not be updated.');
        // Preserve an acknowledged file in a cold local catalog as well as the
        // native queue; a later online refresh may replace this metadata normally.
        catalog.items = [...catalog.items.filter((row) => row.id !== itemId), accepted];
        for (const [key, rows] of Object.entries(catalog.views))
          catalog.views[key] = rows.filter((row) => row.id !== itemId);
        catalog.views[itemId] = [accepted];
        if (accepted.parentId && catalog.views[accepted.parentId])
          catalog.views[accepted.parentId].push(accepted);
        meta.put(catalog, 'catalog');
        item.createdFile = accepted;
        delete item.creation;
        if (item.outbox) delete item.outbox.creation;
      }
      items.put(item);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* Already aborted. */
      }
      await completion.catch(() => {});
      throw error;
    }
    await completion;
    verifyCurrent();
    offlineChanged(this.accountId, itemId);
  }
  /**
   * Replaces an item's download in one transaction, so a failed or interrupted
   * write leaves the previous complete copy (or nothing), never a partial one.
   */
  async saveDownload(
    bundle: OfflineBundle,
    bytes: ReadonlyMap<string, Uint8Array>,
    verifyCurrent: () => void = () => {},
    beforeCommit?: () => Promise<unknown>,
  ) {
    verifyCurrent();
    return withOfflineCatalogLock(this.accountId, async () => {
      verifyCurrent();
      if (beforeCommit) await beforeCommit();
      verifyCurrent();
      return this.saveDownloadUnlocked(bundle, bytes, verifyCurrent);
    });
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
      if (previous !== undefined && hasProtectedStoredCopy(previous, this.accountId, bundle.itemId))
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
    let pendingChanged = false;
    let pending = false;
    try {
      const item = (await request(items.get(scope.item))) as StoredItem | undefined;
      verifyCurrent();
      const previous = downloadSummary(item, this.accountId, scope.item);
      if (
        !item ||
        previous.uncertain ||
        item.bundle.accountId !== scope.account ||
        item.bundle.itemId !== scope.item ||
        item.bundle.spaceId !== scope.spaceId ||
        item.bundle.unitId !== scope.unitId ||
        item.bundle.revisionOffset !== scope.revisionOffset
      )
        throw new Error('This download changed. Keep this tab open to preserve your changes.');
      if (item.recovery && JSON.stringify(item.outbox?.checkpoint) !== JSON.stringify(checkpoint))
        throw new Error('This offline copy is already being recovered. Keep its original changes.');
      item.outbox = {
        version: 1,
        ...scope,
        checkpoint,
        ...(item.creation ? { creation: true as const } : {}),
      };
      // The unchanged base and scope were admitted above. Inspect only the new
      // checkpoint, retaining malformed input as pending rather than losing it.
      pending =
        item.recovery !== undefined ||
        item.creation !== undefined ||
        !storedSnapshotShape(checkpoint.snapshot, item.bundle.kind, scope.unitId) ||
        hasOfflineEdits(item.outbox);
      pendingChanged = Boolean(previous.pending) !== pending;
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
    if (pendingChanged) offlineChanged(this.accountId, scope.item, pending);
  }
  /** Fix retry identity, title and bytes before any request can publish a copy. */
  async beginRecovery(
    scope: Pick<OfflineOutbox, 'account' | 'item' | 'spaceId' | 'unitId' | 'revisionOffset'>,
    checkpoint: ClientCheckpoint,
    recovery: OfflineRecoveryRequest,
    verifyCurrent: () => void,
  ) {
    verifyCurrent();
    const transaction = this.database.transaction('items', 'readwrite');
    const completion = done(transaction);
    let result: OfflineRecoveryRequest;
    try {
      const items = transaction.objectStore('items');
      const item = (await request(items.get(scope.item))) as StoredItem | undefined;
      verifyCurrent();
      this.verifyRecoveryScope(item, scope);
      if (
        !hasOfflineEdits(item!.outbox) ||
        JSON.stringify(item!.outbox!.checkpoint) !== JSON.stringify(checkpoint)
      )
        throw new Error('The saved offline changes changed. Retry saving before recovery.');
      if (item!.recovery && JSON.stringify(item!.recovery) !== JSON.stringify(recovery))
        throw new Error('This offline recovery changed. Keep its saved work.');
      result = item!.recovery ?? recovery;
      item!.recovery = result;
      items.put(item);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* The request may already have aborted. */
      }
      await completion.catch(() => {});
      throw error;
    }
    await completion;
    verifyCurrent();
    return structuredClone(result!);
  }
  private verifyRecoveryScope(
    item: StoredItem | undefined,
    scope: Pick<OfflineOutbox, 'account' | 'item' | 'spaceId' | 'unitId' | 'revisionOffset'>,
  ) {
    if (
      scope.account !== this.accountId ||
      !item ||
      item.bundle.accountId !== scope.account ||
      item.bundle.itemId !== scope.item ||
      item.bundle.spaceId !== scope.spaceId ||
      item.bundle.unitId !== scope.unitId ||
      item.bundle.revisionOffset !== scope.revisionOffset
    )
      throw new Error('This device copy changed before recovery could finish.');
  }
  /** Caller owns the frozen writer. Undefined recoveryId means explicit discard. */
  async finishRecovery(
    scope: Pick<OfflineOutbox, 'account' | 'item' | 'spaceId' | 'unitId' | 'revisionOffset'>,
    recoveryId: string | undefined,
    verifyCurrent: () => void,
    expected?: { recovery: OfflineRecoveryRequest; checkpoint: ClientCheckpoint },
  ) {
    verifyCurrent();
    const transaction = this.database.transaction(['items', 'images'], 'readwrite');
    const completion = done(transaction);
    try {
      const items = transaction.objectStore('items');
      const item = (await request(items.get(scope.item))) as StoredItem | undefined;
      verifyCurrent();
      this.verifyRecoveryScope(item, scope);
      if (recoveryId !== undefined && item!.recovery?.recoveryId !== recoveryId)
        throw new Error('This offline recovery changed. Keep its saved work.');
      if (
        expected &&
        (JSON.stringify(item!.recovery) !== JSON.stringify(expected.recovery) ||
          JSON.stringify(item!.outbox?.checkpoint) !== JSON.stringify(expected.checkpoint))
      )
        throw new Error('This offline recovery changed. Keep its saved work.');
      items.delete(scope.item);
      transaction
        .objectStore('images')
        .delete(IDBKeyRange.bound([scope.item, ''], [scope.item, '\uffff']));
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* The request may already have aborted. */
      }
      await completion.catch(() => {});
      throw error;
    }
    await completion;
    verifyCurrent();
    offlineChanged(this.accountId, scope.item);
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
  /** The item writer lock is held by the device-management caller. */
  async removeDeviceItem(itemId: string, verifyCurrent: () => void, discardPending = false) {
    let needsRecovery = false;
    await this.removeUnlocked(
      itemId,
      (existing) => {
        verifyCurrent();
        if (
          existing !== undefined &&
          hasProtectedStoredCopy(existing, this.accountId, itemId) &&
          !discardPending
        )
          needsRecovery = true;
      },
      discardPending,
      () => needsRecovery,
    );
    return needsRecovery
      ? { status: 'needs-recovery' as const, itemId }
      : { status: 'removed' as const };
  }
  /** Catalog and every item writer lock are held; deletion is one abortable transaction. */
  async clearAccount(verifyCurrent: () => void) {
    verifyCurrent();
    const transaction = this.database.transaction(['meta', 'items', 'images'], 'readwrite');
    const completion = done(transaction);
    try {
      // This read keeps the cancellation check inside the transaction, before any write.
      await request(transaction.objectStore('items').count());
      verifyCurrent();
      for (const name of ['meta', 'items', 'images']) transaction.objectStore(name).clear();
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* Already aborted. */
      }
      await completion.catch(() => {});
      throw error;
    }
    await completion;
    offlineChanged(this.accountId, '');
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
  private async removeUnlocked(
    itemId: string,
    verify?: (existing?: StoredItem) => void,
    discardPending = false,
    keep?: () => boolean,
  ) {
    const transaction = this.database.transaction(['items', 'images'], 'readwrite');
    const completion = done(transaction);
    const items = transaction.objectStore('items');
    try {
      const existing = (await request(items.get(itemId))) as StoredItem | undefined;
      verify?.(existing);
      if (keep?.()) {
        await completion;
        return;
      }
      if (
        existing !== undefined &&
        hasProtectedStoredCopy(existing, this.accountId, itemId) &&
        !discardPending
      )
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
