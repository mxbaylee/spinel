import type { IUnitCacheData } from '@univerjs-pro/collaboration-client';
import type { IExecutionOptions, IMutationInfo } from '@univerjs/core';
import type { OfflineAccess } from './OfflineAccess.ts';

type Entry = { id: string; mutation: IMutationInfo; state: 'waiting' | 'executing' | 'done' };
export type ReplayClaim = Readonly<{ entry: string; options: IExecutionOptions }>;
const textMutation = 'doc.mutation.rich-text-editing';

// Integrity comparison only, never provenance matching. Reject unsupported
// object types rather than silently normalizing mutation bytes through JSON.
export function sameRecoveryValue(
  a: unknown,
  b: unknown,
  seen = new WeakMap<object, object>(),
): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof ArrayBuffer && b instanceof ArrayBuffer)
    return sameRecoveryValue(new Uint8Array(a), new Uint8Array(b), seen);
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const first = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const second = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return first.length === second.length && first.every((value, index) => value === second[index]);
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
  } else if (![Object.prototype, null].includes(Object.getPrototypeOf(a))) return false;
  if (seen.has(a)) return seen.get(a) === b;
  seen.set(a, b);
  const keys = Object.keys(a),
    other = Object.keys(b);
  return (
    keys.length === other.length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        sameRecoveryValue(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          seen,
        ),
    )
  );
}

/**
 * Accounts for original entries, not how many times the SDK reads its cache.
 * Completion here proves only local execution. The coordinator must separately
 * verify loader/queue state and durable staged writes before opening access.
 */
export class RecoveryLedger {
  private original: IUnitCacheData;
  private entries: Entry[];
  private markers = new WeakMap<object, Entry>();
  private claims = new WeakMap<ReplayClaim, Entry>();
  private phase: 'recovering' | 'complete' | 'failed' = 'recovering';
  private access: OfflineAccess;
  private currentAccount: () => string | null;

  constructor(
    access: OfflineAccess,
    recordVersion: number,
    original: IUnitCacheData,
    currentAccount: () => string | null,
  ) {
    this.access = access;
    this.currentAccount = currentAccount;
    try {
      this.original = structuredClone(original);
    } catch {
      this.fail('Pending record cannot be safely copied for recovery.');
    }
    const record = this.original;
    if (!record || typeof record !== 'object' || Array.isArray(record))
      this.fail('Pending record is malformed.');
    const scope = access.scope;
    const type = scope.kind === 'doc' ? 1 : 2;
    const awaiting = this.original.awaitingChangeset;
    if (
      !Number.isSafeInteger(recordVersion) ||
      recordVersion < 1 ||
      record.unitID !== scope.unitId ||
      record.userId !== scope.accountId ||
      record.type !== type ||
      !Number.isSafeInteger(record.rev) ||
      record.rev < 0 ||
      !Array.isArray(record.mutations) ||
      (awaiting != null &&
        (typeof awaiting !== 'object' ||
          Array.isArray(awaiting) ||
          awaiting.unitID !== scope.unitId ||
          awaiting.userID !== scope.accountId ||
          awaiting.type !== type ||
          !Array.isArray(awaiting.mutations)))
    )
      this.fail('Pending record does not match its prepared account and document.');
    for (const list of [record.mutations, awaiting?.mutations ?? []]) {
      for (let index = 0; index < list.length; index++) {
        const mutation = list[index];
        if (
          !Object.hasOwn(list, index) ||
          !mutation ||
          typeof mutation !== 'object' ||
          typeof mutation.id !== 'string' ||
          !mutation.id ||
          !mutation.params ||
          typeof mutation.params !== 'object' ||
          Array.isArray(mutation.params) ||
          (mutation.params as { unitId?: string }).unitId !== scope.unitId
        )
          this.fail('Pending mutation does not identify the prepared document.');
      }
    }
    this.entries = [
      ...this.original.mutations.map((mutation, index) => ({
        id: `${recordVersion}:pending:${index}`,
        mutation,
        state: 'waiting' as const,
      })),
      ...(awaiting?.mutations ?? []).map((mutation, index) => ({
        id: `${recordVersion}:awaiting:${index}`,
        mutation,
        state: 'waiting' as const,
      })),
    ];
    if (scope.access === 'viewer' && this.entries.length)
      this.fail('View-only pending work requires explicit recovery.');
    this.assertScope();
  }
  private fail(reason: string): never {
    this.phase = 'failed';
    this.access.failRecovery(reason);
    throw new Error(reason);
  }
  private assertScope() {
    let account: string | null;
    try {
      account = this.currentAccount();
    } catch {
      return this.fail('Recovery could not verify its current account.');
    }
    if (
      this.phase === 'failed' ||
      !this.access.mayReadLocal ||
      account !== this.access.scope.accountId
    )
      this.fail('Recovery lost its original account or access.');
  }
  /** Return fresh, registered objects; never return the retained original. */
  readForSDK() {
    this.assertScope();
    if (this.phase !== 'recovering') return this.fail('Recovery reads arrived after completion.');
    const copy = structuredClone(this.original);
    const mutations = [...copy.mutations, ...(copy.awaitingChangeset?.mutations ?? [])];
    mutations.forEach((mutation, index) => {
      const params = mutation.params as object;
      if (this.markers.has(params)) this.fail('Ambiguous parameter alias in pending work.');
      this.markers.set(params, this.entries[index]);
    });
    return copy;
  }
  /** Passive fixture diagnostics; never registers or authorizes an execution. */
  inspectIdentity(params: object | undefined) {
    const entry = params && this.markers.get(params);
    return (
      entry && {
        entry: entry.id,
        state: entry.state,
        unchanged: sameRecoveryValue(params, entry.mutation.params),
      }
    );
  }
  claim(
    id: string,
    params: object | undefined,
    options?: IExecutionOptions,
  ): ReplayClaim | undefined {
    this.assertScope();
    // A notification-only command is not evidence that an edit was applied.
    if (options?.syncOnly) return undefined;
    const entry = params && this.markers.get(params);
    if (!entry) {
      if (
        this.phase === 'recovering' &&
        params &&
        (params as { unitId?: string }).unitId === this.access.scope.unitId &&
        !options?.fromChangeset &&
        this.entries.some((value) => value.mutation.id === id)
      )
        this.fail('Unrecognized replay parameters; preserve the original pending record.');
      return undefined;
    }
    if (this.phase !== 'recovering' || entry.state !== 'waiting')
      return this.fail('An original pending entry was replayed more than once or too late.');
    if (id !== entry.mutation.id || !sameRecoveryValue(params, entry.mutation.params))
      return this.fail('Registered replay parameters changed before execution.');
    entry.state = 'executing';
    const execution = id === textMutation ? { ...options, fromChangeset: true } : { ...options };
    const claim = Object.freeze({ entry: entry.id, options: execution });
    this.claims.set(claim, entry);
    return claim;
  }
  succeed(claim: ReplayClaim, result: unknown) {
    this.assertScope();
    const entry = this.claims.get(claim);
    if (this.phase !== 'recovering' || !entry || entry.state !== 'executing' || result === false)
      this.fail('Pending replay execution did not succeed exactly once.');
    entry.state = 'done';
  }
  reject(_claim: ReplayClaim, _error: unknown): never {
    return this.fail('Pending replay execution failed; preserve original work.');
  }
  assertComplete() {
    this.assertScope();
    if (this.phase !== 'recovering' || this.entries.some((entry) => entry.state !== 'done'))
      this.fail('Pending replay is incomplete; do not open editing or synchronization.');
    this.phase = 'complete';
  }
  accounting() {
    return {
      expected: this.entries.length,
      applied: this.entries.filter((entry) => entry.state === 'done').length,
      phase: this.phase,
    };
  }
}
