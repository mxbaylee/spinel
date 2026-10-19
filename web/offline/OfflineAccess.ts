import { BehaviorSubject, filter } from 'rxjs';
import type { ItemAccess } from '../../src/shared/workspace.ts';

export type OfflineScope = Readonly<{
  origin: string;
  accountId: string;
  itemId: string;
  unitId: string;
  kind: 'doc' | 'sheet';
  access: ItemAccess;
  sdkVersion: '1.1.0';
  schema: 1;
  revisionOffset: number;
}>;
export type AccessProof = {
  accountId: string;
  itemId: string;
  unitId: string;
  kind: 'doc' | 'sheet';
  access: ItemAccess;
  restoring: boolean;
  revisionOffset: number;
  sdkVersion: string;
};
export type OfflineAccessState = Readonly<{
  phase: 'local' | 'checking' | 'recovering' | 'online' | 'attention' | 'locked' | 'disposed';
  epoch: number;
  recovered: boolean;
  reason?: string;
}>;

/** Only the control-plane adapter may classify a failure as a network outage. */
export class OfflineConnectionError extends Error {}

/**
 * Access state for one prepared editor. This does not itself intercept traffic:
 * each transport must check its captured epoch immediately before sending and
 * cancel active work when state changes. No transition deletes pending work.
 */
export class OfflineAccess {
  readonly scope: OfflineScope;
  private changes = new BehaviorSubject<OfflineAccessState>({
    phase: 'local',
    epoch: 0,
    recovered: false,
  });
  // A listener can synchronously lock while handling an online notification.
  // Later listeners must not receive that superseded online value afterward.
  readonly state$ = this.changes.asObservable().pipe(filter((state) => state === this.state));
  private controller?: AbortController;
  private approved = false;
  private verify: (scope: OfflineScope, signal: AbortSignal) => Promise<AccessProof>;

  constructor(
    scope: OfflineScope,
    verify: (scope: OfflineScope, signal: AbortSignal) => Promise<AccessProof>,
  ) {
    if (
      new URL(scope.origin).origin !== scope.origin ||
      !scope.accountId ||
      !scope.itemId ||
      !scope.unitId ||
      !['owner', 'editor', 'viewer'].includes(scope.access) ||
      !['doc', 'sheet'].includes(scope.kind) ||
      scope.sdkVersion !== '1.1.0' ||
      scope.schema !== 1 ||
      !Number.isSafeInteger(scope.revisionOffset) ||
      scope.revisionOffset < 0
    )
      throw new Error('Invalid prepared offline scope.');
    this.scope = Object.freeze({ ...scope });
    this.verify = verify;
  }
  get state() {
    return this.changes.value;
  }
  private get terminal() {
    return ['attention', 'locked', 'disposed'].includes(this.state.phase);
  }
  private transition(phase: OfflineAccessState['phase'], reason?: string) {
    this.changes.next(Object.freeze({ ...this.state, phase, reason }));
  }
  private invalidate(phase: OfflineAccessState['phase'], reason?: string) {
    // Close the gate before abort callbacks or subscribers can run.
    this.approved = false;
    const prior = this.controller;
    this.controller = undefined;
    this.changes.next(Object.freeze({ ...this.state, phase, reason, epoch: this.state.epoch + 1 }));
    prior?.abort();
  }
  get mayReadLocal() {
    return !this.terminal;
  }
  get mayEditLocal() {
    return (
      this.state.recovered &&
      this.scope.access !== 'viewer' &&
      ['local', 'online'].includes(this.state.phase)
    );
  }
  assertRemote(epoch: number, mode: 'read' | 'write') {
    if (
      !this.approved ||
      epoch !== this.state.epoch ||
      this.state.phase !== 'online' ||
      (mode === 'write' && this.scope.access === 'viewer')
    )
      throw new Error('Offline editor traffic is locked until access and recovery are verified.');
  }
  completeRecovery() {
    if (this.terminal) throw new Error('This offline editor is locked.');
    this.changes.next(
      Object.freeze({
        ...this.state,
        recovered: true,
        phase: this.approved ? 'online' : this.state.phase,
      }),
    );
  }
  failRecovery(reason: string) {
    if (this.terminal) return;
    this.invalidate('attention', reason);
  }
  networkLost() {
    if (this.terminal) return;
    this.invalidate('local');
  }
  lock(reason: string) {
    if (this.state.phase === 'disposed') return;
    this.invalidate('locked', reason);
  }
  dispose() {
    if (this.state.phase === 'disposed') return;
    this.invalidate('disposed');
    this.changes.complete();
  }
  async validate() {
    if (this.terminal) return false;
    const epoch = this.state.epoch + 1;
    this.invalidate('checking');
    if (epoch !== this.state.epoch || this.terminal) return false;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const proof = await this.verify(this.scope, controller.signal);
      if (epoch !== this.state.epoch || this.terminal) return false;
      if (
        proof.accountId !== this.scope.accountId ||
        proof.itemId !== this.scope.itemId ||
        proof.unitId !== this.scope.unitId ||
        proof.kind !== this.scope.kind ||
        proof.access !== this.scope.access ||
        proof.sdkVersion !== this.scope.sdkVersion ||
        proof.restoring !== false ||
        proof.revisionOffset !== this.scope.revisionOffset
      ) {
        this.failRecovery(
          'Account, access or document generation changed. Preserve pending work for recovery.',
        );
        return false;
      }
      this.approved = true;
      this.transition(this.state.recovered ? 'online' : 'recovering');
      return this.approved && epoch === this.state.epoch && !this.terminal;
    } catch (error) {
      if (epoch !== this.state.epoch || this.terminal) return false;
      if (error instanceof OfflineConnectionError) this.networkLost();
      else this.failRecovery('Could not verify access. Preserve pending work and sign in again.');
      return false;
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
}
