import { maintenanceFetch as fetch } from '../maintenanceFetch.ts';
import { capturedMaintenanceEpoch } from '../maintenanceFetch.ts';
import {
  blankOfflineSnapshot,
  isOfflineCreationRequest,
} from '../../src/shared/offlineCreation.ts';
import type {
  OfflineCreationRequest,
  OfflineCreationResponse,
} from '../../src/shared/offlineCreation.ts';
import type { OfflineBundle } from '../../src/shared/offlineBundle.ts';
import type { WorkspaceItem } from '../../src/shared/workspace.ts';
import { emptyAppearance } from '../../src/shared/appearance.ts';
import { OFFLINE_SDK_VERSION } from './OfflineAccess.ts';
import { accountRuntimeReadiness } from './runtime.ts';
import { creationFolderAllowed, preparedAccount } from './offlineStore.ts';
import type { OfflineCreation, OfflineStore } from './offlineStore.ts';

export function creationFile(creation: OfflineCreation): WorkspaceItem {
  const { request, createdAt } = creation;
  return {
    id: request.itemId,
    parentId: request.parentId,
    kind: request.kind,
    name: request.name,
    access: creation.access ?? 'owner',
    ...(creation.ownerName === undefined ? {} : { ownerName: creation.ownerName }),
    ...(creation.createdByName === undefined ? {} : { createdByName: creation.createdByName }),
    tags: [],
    appearance: {
      ...emptyAppearance(),
      revision: request.icon != null || request.iconColor != null ? 1 : 0,
      icon: request.icon ?? null,
      iconColor: request.iconColor ?? null,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

/** No server call and no editor until the complete initial record is durable. */
export async function createOfflineDocument(
  store: OfflineStore,
  name: string,
  kind: 'sheet' | 'doc',
  parentId: string | null,
  verifyCurrent: () => void,
  identity: Pick<OfflineCreationRequest, 'icon' | 'iconColor'> = {},
) {
  verifyCurrent();
  if (preparedAccount() !== store.accountId || !navigator.locks)
    throw new Error(
      'Prepare this account online in a browser that supports offline editing first.',
    );
  const readiness = await accountRuntimeReadiness(store.accountId, verifyCurrent);
  verifyCurrent();
  if (
    readiness.kind !== 'ready' ||
    readiness.compatibility.format !== 1 ||
    readiness.compatibility.sdkVersion !== OFFLINE_SDK_VERSION
  )
    throw new Error(
      'The offline app is incomplete. Connect and prepare a document before trying again.',
    );
  const request: OfflineCreationRequest = {
    version: 1,
    itemId: crypto.randomUUID(),
    unitId: crypto.randomUUID(),
    name: name.trim(),
    kind,
    parentId,
    icon: identity.icon ?? null,
    iconColor: identity.iconColor ?? null,
  };
  if (!isOfflineCreationRequest(request))
    throw new Error('Choose a name of 1–120 characters without slashes or control characters.');
  const creation: OfflineCreation = { request, createdAt: Date.now() };
  const bundle = {
    maintenanceEpoch: capturedMaintenanceEpoch(),
    version: 1,
    accountId: store.accountId,
    itemId: request.itemId,
    unitId: request.unitId,
    name: request.name,
    kind,
    revision: 1,
    revisionOffset: 0,
    access: 'owner',
    readOnly: false,
    sdkVersion: OFFLINE_SDK_VERSION,
    images: [],
    appearance: creationFile(creation).appearance,
    snapshot: blankOfflineSnapshot(request),
  } as OfflineBundle;
  const saved = await store.saveCreation(bundle, creation, verifyCurrent);
  verifyCurrent();
  return creationFile({ ...creation, ...saved.creation });
}

/** A definitive target rejection is the only permission to change the saved request. */
export async function relocateOfflineCreation(
  store: OfflineStore,
  itemId: string,
  parentId: string | null,
  verifyCurrent: () => void,
) {
  verifyCurrent();
  const saved = await store.bundle(itemId);
  const catalog = await store.catalog();
  verifyCurrent();
  if (!saved?.creation?.canRelocate)
    throw new Error(
      'Open the document to check its original upload before choosing another folder.',
    );
  if (!catalog || !creationFolderAllowed(catalog, parentId))
    throw new Error('Choose a prepared folder where you can create documents.');
  const creation: OfflineCreation = {
    request: { ...saved.creation.request, parentId },
    createdAt: saved.creation.createdAt,
  };
  const updated = await store.updateCreation(itemId, saved.creation, creation, verifyCurrent);
  return creationFile({ ...creation, ...updated.creation });
}

export class CreationUploadError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Explicit account route: never broaden the original document's scoped HTTP adapter. */
export async function uploadOfflineCreation(
  accountId: string,
  request: OfflineCreationRequest,
  signal: AbortSignal,
  verifyCurrent: () => void,
  maintenanceEpoch?: string,
): Promise<OfflineCreationResponse> {
  verifyCurrent();
  const response = await fetch('/api/items/offline-create', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'X-Spinel-Offline-Account': accountId,
      'X-Spinel-Epoch': maintenanceEpoch ?? '',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  verifyCurrent();
  const data = await response.json();
  verifyCurrent();
  if (!response.ok)
    throw new CreationUploadError(
      typeof data.error === 'string'
        ? data.error
        : 'The document could not be uploaded. Its saved work stays on this device.',
      response.status,
      data.code,
    );
  const item = data.item;
  if (
    !item ||
    item.id !== request.itemId ||
    item.kind !== request.kind ||
    !['owner', 'admin', 'editor'].includes(item.access) ||
    typeof item.name !== 'string' ||
    !item.name ||
    (item.parentId !== null && typeof item.parentId !== 'string') ||
    !Number.isFinite(item.createdAt) ||
    !Number.isFinite(item.updatedAt) ||
    !Array.isArray(item.tags) ||
    data.unitId !== request.unitId ||
    data.revision !== 1 ||
    data.revisionOffset !== 0 ||
    data.syncVersion !== 1
  )
    throw new Error(
      'The uploaded document could not be verified. Its saved work stays on this device.',
    );
  return data as OfflineCreationResponse;
}
