import type { IUnitCacheData } from '@univerjs-pro/collaboration-client';
import { OfflineAccess } from './OfflineAccess.ts';
import type { OfflineScope } from './OfflineAccess.ts';
import { RecoveryLedger, sameRecoveryValue } from './RecoveryLedger.ts';

/** Synthetic loopback experiment; not an offline download/access implementation. */
export class RecoveryLedgerProbe {
  readonly access: OfflineAccess;
  ledger?: RecoveryLedger;
  original?: IUnitCacheData;
  recovering = false;
  reads = 0;
  writes = 0;
  facadeLoaded = false;
  collaborationReady = false;
  private holdMode?: 'read' | 'write';
  private held?: 'read' | 'write';
  private deferred?: ReturnType<typeof Promise.withResolvers<void>>;
  private released = false;
  status: 'unused' | 'recovering' | 'verified' | 'failed' = 'unused';
  constructor(scope: OfflineScope, holdMode?: 'read' | 'write') {
    this.holdMode = holdMode;
    // No network approval is granted by this experiment. Browser routes supply
    // the synthetic base; the separate transport fixture tests the remote gate.
    this.access = new OfflineAccess(scope, async () => {
      throw new Error('The ledger fixture cannot grant remote access.');
    });
    this.access.state$.subscribe((state) => {
      if (['attention', 'locked', 'disposed'].includes(state.phase)) {
        this.status = 'failed';
        // Even after a provisional verification, a late replay failure cannot
        // let subsequent SDK cleanup replace the retained pending record.
        this.recovering = true;
        this.deferred?.reject(new Error('Recovery ended while a fixture operation was held.'));
      }
    });
  }
  async hold(mode: 'read' | 'write') {
    if (!this.access.mayReadLocal) throw new Error('Recovery ended before a fixture operation.');
    if (this.holdMode !== mode || this.released) return;
    this.deferred ??= Promise.withResolvers<void>();
    this.held = mode;
    await this.deferred.promise;
    if (!this.access.mayReadLocal) throw new Error('Recovery lost access during a held operation.');
  }
  release() {
    if (!this.deferred || !this.held) throw new Error('No held recovery operation.');
    this.released = true;
    this.held = undefined;
    this.deferred.resolve();
  }
  begin(record: IUnitCacheData | undefined, currentAccount: () => string | null) {
    if (!record || (!record.mutations.length && !record.awaitingChangeset)) return;
    this.original = structuredClone(record);
    this.ledger = new RecoveryLedger(this.access, 1, record, currentAccount);
    this.recovering = true;
    this.status = 'recovering';
  }
  read() {
    this.reads++;
    return this.ledger!.readForSDK();
  }
  verify(staged: IUnitCacheData | null | undefined) {
    if (!this.recovering) return;
    try {
      this.ledger!.assertComplete();
      // Actual public save/update arguments must account for the whole queue,
      // including awaiting SID/reqId and revision. No content deduplication.
      if (!this.writes || !sameRecoveryValue(this.original, staged))
        throw new Error('No identical final public cache queue after SDK recovery readiness.');
      this.status = 'verified';
      this.recovering = false;
    } catch (error) {
      this.status = 'failed';
      this.access.failRecovery('Recovery probe could not verify the original pending queue.');
      throw error;
    }
  }
  evidence() {
    return {
      status: this.status,
      reads: this.reads,
      writes: this.writes,
      held: this.held,
      facadeLoaded: this.facadeLoaded,
      collaborationReady: this.collaborationReady,
      accounting: this.ledger?.accounting(),
    };
  }
}

export async function prepareRecoveryLedgerProbe(itemId: string) {
  if (
    !import.meta.env.SPINEL_RECOVERY_PROBE ||
    location.origin !== 'https://localhost:3103' ||
    new URLSearchParams(location.search).get('recovery-ledger') !== '1'
  )
    return undefined;
  const response = await fetch(`/api/items/${encodeURIComponent(itemId)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Ledger fixture metadata unavailable.');
  const data = await response.json();
  const hold = localStorage.getItem('spinel-synthetic-recovery-hold');
  localStorage.removeItem('spinel-synthetic-recovery-hold');
  return new RecoveryLedgerProbe(
    {
      origin: location.origin,
      accountId: data.accountId,
      itemId,
      unitId: data.live.unitId,
      kind: data.item.kind,
      access: data.item.access,
      sdkVersion: data.live.sdkVersion,
      schema: 1,
      revisionOffset: data.live.revisionOffset,
    },
    hold === 'read' || hold === 'write' ? hold : undefined,
  );
}
