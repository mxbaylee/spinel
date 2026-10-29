import type { ItemAccess } from '../../src/shared/workspace.ts';
import type { OfflineBundle } from '../../src/shared/offlineBundle.ts';

/** The pinned `@univerjs/core` version; a bundle from another SDK is not opened. */
export const OFFLINE_SDK_VERSION = '1.1.0';

export type OfflineScope = Readonly<{
  origin: string;
  accountId: string;
  itemId: string;
  spaceId?: string;
  unitId: string;
  kind: 'doc' | 'sheet';
  access: ItemAccess;
  sdkVersion: typeof OFFLINE_SDK_VERSION;
  schema: 1;
  revisionOffset: number;
  maintenanceEpoch?: string;
}>;
export type OfflineAccessState = Readonly<{
  phase: 'local' | 'attention' | 'locked' | 'disposed';
  epoch: number;
  reason?: string;
}>;

export function offlineScope(bundle: OfflineBundle, origin = location.origin): OfflineScope {
  if (bundle.sdkVersion !== OFFLINE_SDK_VERSION)
    throw new Error('This download was made by another version of Spinel.');
  const scope: OfflineScope = {
    origin,
    accountId: bundle.accountId,
    itemId: bundle.itemId,
    ...(bundle.spaceId === undefined ? {} : { spaceId: bundle.spaceId }),
    unitId: bundle.unitId,
    kind: bundle.kind,
    access: bundle.access,
    sdkVersion: OFFLINE_SDK_VERSION,
    schema: 1,
    revisionOffset: bundle.revisionOffset,
    maintenanceEpoch: bundle.maintenanceEpoch,
  };
  validateScope(scope);
  return scope;
}

function validateScope(scope: OfflineScope) {
  if (
    new URL(scope.origin).origin !== scope.origin ||
    typeof scope.accountId !== 'string' ||
    !scope.accountId ||
    typeof scope.itemId !== 'string' ||
    !scope.itemId ||
    (scope.spaceId !== undefined &&
      (typeof scope.spaceId !== 'string' || !scope.spaceId || scope.spaceId === scope.itemId)) ||
    typeof scope.unitId !== 'string' ||
    !scope.unitId ||
    !['owner', 'admin', 'editor', 'viewer'].includes(scope.access) ||
    !['doc', 'sheet'].includes(scope.kind) ||
    scope.sdkVersion !== OFFLINE_SDK_VERSION ||
    scope.schema !== 1 ||
    !Number.isSafeInteger(scope.revisionOffset) ||
    scope.revisionOffset < 0
  )
    throw new Error('Invalid offline scope.');
}

/**
 * Access state for one downloaded document opened on this device. Local reads
 * stop for good once the state leaves `local`; each reader checks `mayReadLocal`
 * immediately before handing out data. Remote requests capture the same epoch
 * and independently require current server authorization before replay.
 */
export class OfflineAccess {
  readonly scope: OfflineScope;
  private current: OfflineAccessState = { phase: 'local', epoch: 0 };
  private listeners = new Set<(state: OfflineAccessState) => void>();

  constructor(scope: OfflineScope) {
    validateScope(scope);
    this.scope = Object.freeze({ ...scope });
  }
  get state() {
    return this.current;
  }
  subscribe(listener: (state: OfflineAccessState) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  get mayReadLocal() {
    return this.state.phase === 'local';
  }
  /** Every remote callback must still belong to this local account epoch. */
  remoteGate(isCurrent: () => boolean) {
    const epoch = this.state.epoch;
    const check = () => {
      if (!isCurrent() || !this.mayReadLocal || this.state.epoch !== epoch)
        throw new DOMException('This offline session is no longer current.', 'AbortError');
    };
    check();
    return check;
  }
  private end(phase: Exclude<OfflineAccessState['phase'], 'local'>, reason?: string) {
    if (this.state.phase === 'disposed') return;
    const next = Object.freeze({ phase, reason, epoch: this.state.epoch + 1 });
    this.current = next;
    for (const listener of this.listeners) {
      // A listener can synchronously lock while handling a notification. Later
      // listeners must not receive that superseded value afterward.
      if (this.current !== next) return;
      listener(next);
    }
  }
  /** Local data is incomplete or damaged; the person must download it again. */
  needsAttention(reason: string) {
    if (this.mayReadLocal) this.end('attention', reason);
  }
  /** The account changed or signed out on this device. */
  lock(reason: string) {
    if (this.state.phase !== 'locked') this.end('locked', reason);
  }
  dispose() {
    if (this.state.phase === 'disposed') return;
    this.end('disposed');
    this.listeners.clear();
  }
}
