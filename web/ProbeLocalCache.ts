import type { IMutationInfo, Nullable, UniverInstanceType } from '@univerjs/core';
import type { IChangeset } from '@univerjs-pro/collaboration';
import type { ILocalCacheService, IUnitCacheData } from '@univerjs-pro/collaboration-client';

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
  constructor(unit: string, currentUser: () => string | null, currentRevision: () => number) {
    this.unit = unit;
    this.currentUser = currentUser;
    this.currentRevision = currentRevision;
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open('spinel-synthetic-recovery-probe-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('pending');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Probe database upgrade is blocked.'));
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
    const data = await this.transaction(
      'readonly',
      (store) => store.get(key) as IDBRequest<IUnitCacheData | undefined>,
    );
    const copy = data ? structuredClone(data) : null;
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
    await this.enqueue(key, () => this.transaction('readwrite', (store) => store.put(copy, key)));
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
    void this.enqueue(key, () =>
      this.transaction('readwrite', (store) => store.put(record, key)),
    ).catch(() => {});
  }
  async clearOfflineData(unit: string, user?: string | null) {
    const key = this.key(unit, user);
    this.trace('clear', key);
    await this.enqueue(key, () => this.transaction('readwrite', (store) => store.delete(key)));
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
