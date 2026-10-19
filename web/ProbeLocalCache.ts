import type { IMutationInfo, Nullable, UniverInstanceType } from '@univerjs/core';
import type { IChangeset } from '@univerjs-pro/collaboration';
import type { ILocalCacheService, IUnitCacheData } from '@univerjs-pro/collaboration-client';
import { markRecoveredParams } from './ProbeReplayCommands.ts';
import type { RecoveryLedgerProbe } from './offline/RecoveryLedgerProbe.ts';

/** Synthetic CI probe only: a host implementation of the public cache contract.
 * This stores pending records, not complete offline downloads or user-visible save guarantees.
 */
export class ProbeLocalCache implements ILocalCacheService {
  readonly saveTaskMap = new Map<string, number>();
  private enabled = true;
  private sequence = 0;
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown;
  private database: Promise<IDBDatabase>;
  private unit: string;
  private currentUser: () => string | null;
  private currentRevision: () => number;
  readonly recovery?: RecoveryLedgerProbe;
  private stageId = crypto.randomUUID();
  constructor(
    unit: string,
    currentUser: () => string | null,
    currentRevision: () => number,
    recovery?: RecoveryLedgerProbe,
  ) {
    this.unit = unit;
    this.currentUser = currentUser;
    this.currentRevision = currentRevision;
    this.recovery = recovery;
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open('spinel-synthetic-recovery-probe-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('pending');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Probe database upgrade is blocked.'));
    });
  }
  async prepareRecovery() {
    if (!this.recovery) return;
    const record = await this.inspectOfflineData(this.unit, this.recovery.access.scope.accountId);
    this.recovery.begin(record ?? undefined, this.currentUser);
  }
  async inspectOfflineData(unit: string, user?: string | null) {
    const key = this.key(unit, user);
    await this.exhaustSavingTask();
    return this.transaction(
      'readonly',
      (store) => store.get(key) as IDBRequest<IUnitCacheData | undefined>,
    );
  }
  async finishRecovery() {
    if (!this.recovery?.recovering) return;
    const key = this.key(this.unit, this.recovery.access.scope.accountId);
    let staged: IUnitCacheData | null | undefined;
    let sequence: number;
    do {
      await this.exhaustSavingTask();
      sequence = this.sequence;
      staged = await this.transaction(
        'readonly',
        (store) =>
          store.get(`stage:${this.stageId}:${key}`) as IDBRequest<
            IUnitCacheData | null | undefined
          >,
      );
      // A write can arrive during the IndexedDB read. Drain its transaction and
      // repeat the read rather than validating an earlier staged version.
      await this.exhaustSavingTask();
    } while (sequence !== this.sequence);
    this.trace('ledger ready', { ...this.recovery.evidence(), staged });
    this.recovery.verify(staged);
    // The verified staged record equals the retained original; no activation
    // write is needed for this experiment. Production still needs a journal.
  }
  private persist(key: string, record: IUnitCacheData | null) {
    const stage = this.recovery?.recovering;
    const target = stage ? `stage:${this.stageId}:${key}` : key;
    if (stage && key === this.key(this.unit, this.recovery!.access.scope.accountId))
      this.recovery!.writes++;
    return this.enqueue(key, async () => {
      if (stage) await this.recovery!.hold('write');
      return record || stage
        ? this.transaction('readwrite', (store) => store.put(record, target))
        : this.transaction('readwrite', (store) => store.delete(target));
    });
  }
  private key(unit: string, user?: string | null) {
    if (unit !== this.unit) throw new Error('Probe cache received a different unit.');
    return JSON.stringify([unit, (user === undefined ? this.currentUser() : user) || null]);
  }
  private trace(method: string, data: unknown) {
    console.log(
      JSON.stringify({
        recoveryCacheCall: method,
        sequence: this.sequence,
        staged: this.recovery?.recovering ?? false,
        serverConfirmation: window.__spinelRecoveryProbe?.serverConfirmation,
        data: structuredClone(data),
      }),
    );
  }
  private async transaction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending', mode);
      const request = action(tx.objectStore('pending'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? request.error ?? new Error('Probe storage aborted.'));
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Probe storage failed.'));
    });
  }
  private enqueue(key: string, action: () => Promise<unknown>) {
    const sequence = ++this.sequence;
    this.saveTaskMap.set(key, sequence);
    const queued = this.tail.then(async () => {
      try {
        await action();
      } catch (error) {
        this.failure ??= error;
        this.trace('storage failure', String(error));
        throw error;
      } finally {
        if (this.saveTaskMap.get(key) === sequence) this.saveTaskMap.delete(key);
      }
    });
    this.tail = queued.catch(() => {});
    return queued;
  }
  async loadOfflineData(unit: string, user?: string | null) {
    const key = this.key(unit, user);
    await this.exhaustSavingTask();
    if (
      this.recovery?.recovering &&
      key === this.key(this.unit, this.recovery.access.scope.accountId)
    ) {
      await this.recovery.hold('read');
      const copy = this.recovery.read();
      this.trace('load', copy);
      return copy;
    }
    const data = await this.transaction(
      'readonly',
      (store) => store.get(key) as IDBRequest<IUnitCacheData | undefined>,
    );
    const copy = data ? structuredClone(data) : null;
    if (
      copy &&
      !this.recovery &&
      new URLSearchParams(location.search).get('replay-identity') === '1'
    ) {
      const userId = this.currentUser();
      if (!userId || copy.userId !== userId || copy.unitID !== this.unit)
        throw new Error('Recovered record is outside the synthetic probe scope.');
      for (const mutation of [...copy.mutations, ...(copy.awaitingChangeset?.mutations ?? [])])
        markRecoveredParams(mutation.id, mutation.params, this.unit, userId);
    }
    this.trace('load', copy);
    return copy;
  }
  async saveOfflineData(unit: string, data: IUnitCacheData, user?: string | null) {
    const key = this.key(unit, user);
    const copy = structuredClone({
      ...data,
      userId: (user === undefined ? this.currentUser() : user) || null,
    });
    this.trace('save', { enabled: this.enabled, record: copy });
    if (!this.enabled) return false;
    await this.persist(key, copy);
    return true;
  }
  updateOfflineData(
    unit: string,
    type: UniverInstanceType,
    awaitingChangeset: Nullable<IChangeset>,
    pendingMutations: IMutationInfo[],
    user?: string | null,
  ) {
    const key = this.key(unit, user);
    const record: IUnitCacheData = structuredClone({
      unitID: unit,
      userId: (user === undefined ? this.currentUser() : user) || null,
      type,
      rev: this.currentRevision(),
      awaitingChangeset,
      mutations: pendingMutations,
    });
    this.trace('update', { enabled: this.enabled, record });
    if (!this.enabled) return;
    // Snapshot arguments synchronously; never retain SDK-owned arrays between tasks.
    void this.persist(key, record).catch(() => {});
  }
  async clearOfflineData(unit: string, user?: string | null) {
    const key = this.key(unit, user);
    this.trace('clear', key);
    await this.persist(key, null);
  }
  async backupOfflineData(unit: string, reason: string, user?: string | null) {
    const key = this.key(unit, user);
    this.trace('backup', { key, reason });
    await this.enqueue(key, async () => {
      const data = await this.transaction('readonly', (store) => store.get(key));
      if (data)
        await this.transaction('readwrite', (store) =>
          store.put(structuredClone(data), `backup:${key}:${crypto.randomUUID()}`),
        );
    });
  }
  disableLocalCache() {
    this.enabled = false;
    this.trace('disable', null);
  }
  enableLocalCache() {
    this.enabled = true;
    this.trace('enable', null);
  }
  async exhaustSavingTask() {
    let observed;
    do {
      observed = this.tail;
      await observed;
    } while (observed !== this.tail);
    if (this.failure) throw this.failure;
  }
}
