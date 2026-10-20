import type { ItemAccess } from '../../src/shared/workspace.ts';
import type { OfflineBundle } from '../../src/shared/offlineBundle.ts';

/** The pinned `@univerjs/core` version; a bundle from another SDK is not opened. */
export const OFFLINE_SDK_VERSION = '1.1.0';

export type OfflineScope = Readonly<{
  origin: string;
  accountId: string;
  itemId: string;
  unitId: string;
  kind: 'doc' | 'sheet';
  access: ItemAccess;
  sdkVersion: typeof OFFLINE_SDK_VERSION;
  schema: 1;
  revisionOffset: number;
}>;
export type OfflineAccessState = Readonly<{
  phase: 'local' | 'attention' | 'locked' | 'disposed';
  epoch: number;
  reason?: string;
}>;

export function offlineScope(bundle: OfflineBundle, origin = location.origin): OfflineScope {
  if (bundle.sdkVersion !== OFFLINE_SDK_VERSION)
    throw new Error('This download was made by another version of Spinel.');
  return {
    origin,
    accountId: bundle.accountId,
    itemId: bundle.itemId,
    unitId: bundle.unitId,
    kind: bundle.kind,
    access: bundle.access,
    sdkVersion: OFFLINE_SDK_VERSION,
    schema: 1,
    revisionOffset: bundle.revisionOffset,
  };
}

/**
 * Access state for one downloaded document opened on this device. Local reads
 * stop for good once the state leaves `local`; each reader checks `mayReadLocal`
 * immediately before handing out data. SPN-039 opens downloads read-only, so
 * this adapter has no remote gate yet: the offline-editing follow-up adds
 * server revalidation alongside #86's scoped HTTP and socket adapters.
 */
export class OfflineAccess {
  readonly scope: OfflineScope;
  private current: OfflineAccessState = { phase: 'local', epoch: 0 };
  private listeners = new Set<(state: OfflineAccessState) => void>();

  constructor(scope: OfflineScope) {
    if (
      new URL(scope.origin).origin !== scope.origin ||
      !scope.accountId ||
      !scope.itemId ||
      !scope.unitId ||
      !['owner', 'editor', 'viewer'].includes(scope.access) ||
      !['doc', 'sheet'].includes(scope.kind) ||
      scope.sdkVersion !== OFFLINE_SDK_VERSION ||
      scope.schema !== 1 ||
      !Number.isSafeInteger(scope.revisionOffset) ||
      scope.revisionOffset < 0
    )
      throw new Error('Invalid offline scope.');
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
