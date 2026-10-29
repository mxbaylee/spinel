import {
  canonical,
  atomicMutationGroups,
  cellsAfter,
  RefusedEditError,
  transform,
  UnsupportedMutationError,
} from '@spinel/sync-transform';
import type { Mutation } from '@spinel/sync-transform';
import { captureDiagnostic, observe, observeOperation, observeSync } from '@spinel/diagnostics';
import type {
  ClientDiagnosticOutcome,
  ClientQueueObservation,
  DiagnosticScope,
} from '@spinel/diagnostics';
import { byteBudget, encodedBytes, envelopeBytes } from './budget.ts';
import { clientFailures as failures, validateCheckpoint, validRevision } from './checkpoint.ts';
import { hashTouched } from './hash.ts';
import { validateRecoverySnapshot } from './recovery.ts';
import {
  ClientError,
  MAX_BATCH_MUTATIONS,
  MAX_INCOMING_BYTES,
  MAX_INCOMING_REVISIONS,
  MAX_PENDING_BYTES,
  MAX_WIRE_BYTES,
} from './types.ts';
import type {
  AckFrame,
  ClientCheckpoint,
  ClientFailure,
  ClientState,
  IncomingFrame,
  ResumeFrame,
  SubmitFrame,
  SyncClientOptions,
  WireRevision,
} from './types.ts';

const clone = <T>(value: T): T => structuredClone(value);
const enabled = (value: boolean | (() => boolean) | undefined) =>
  typeof value === 'function' ? value() : Boolean(value);
function failureOf(error: unknown): ClientFailure {
  if (error instanceof ClientError) return error.reason;
  if (error instanceof UnsupportedMutationError) return 'unsupported';
  if (error instanceof RefusedEditError) return 'refused';
  return 'malformed';
}

/**
 * One durable order, one immutable request awaiting acknowledgment, and unsent
 * optimistic edits. No sockets, account identity, DOM or application imports.
 */
export class SyncClient {
  private readonly options: SyncClientOptions;
  private revision: number;
  private connected = false;
  private awaitingResume = true;
  private sent: SubmitFrame | null = null;
  private inflight: Mutation[] = [];
  private buffer: Mutation[][] = [];
  private readonly inbox = new Map<number, WireRevision>();
  private incomingBytes = 0;
  private lastEdit?: WireRevision;
  private reason?: ClientFailure;
  private notified = false;
  private disposed = false;
  private generation = 0;
  private pendingPersistence = 0;
  private persistenceFailed = false;
  private persistence = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private readonly cleanups: (() => void)[] = [];
  private replayBase?: number;
  private processingCheckpoint?: ClientCheckpoint;
  private retainedCheckpoint?: ClientCheckpoint;
  /** Only this live renderer can retry a failed capture of its latest edit. */
  private recoveryCapturePending = false;
  private readonly queuedObservations = new WeakMap<
    Mutation[],
    { at: number; scope?: DiagnosticScope }
  >();
  private sentObservation?: { at: number; scope?: DiagnosticScope; unknownAge?: boolean };
  private resyncObservation?: {
    at: number;
    scope?: DiagnosticScope;
    queue: ClientQueueObservation;
  };
  private queueObservedAt = -Infinity;
  private queueObservedCount = 0;

  private diagnosticNow(): number {
    try {
      const value = this.options.diagnosticNow?.() ?? performance.now();
      return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  }
  /** Unknown age is preferable to inventing timestamps for persisted/rebased work. */
  diagnosticQueue(): ClientQueueObservation {
    const pendingCount =
      this.inflight.length + this.buffer.reduce((count, group) => count + group.length, 0);
    if (!pendingCount) return { pendingCount, oldestPendingAgeMs: 0 };
    const times = [
      ...(this.inflight.length
        ? [this.sentObservation?.unknownAge ? undefined : this.sentObservation?.at]
        : []),
      ...this.buffer.map((group) => this.queuedObservations.get(group)?.at),
    ];
    return {
      pendingCount,
      oldestPendingAgeMs: times.some((at) => at === undefined)
        ? null
        : Math.max(0, this.diagnosticNow() - Math.min(...(times as number[]))),
    };
  }
  private observeQueue(force = false): void {
    if (!this.options.diagnostics) return;
    const at = this.diagnosticNow();
    const queue = this.diagnosticQueue();
    // Sample active queues at most once/second, with an immediate final empty state.
    if (
      !force &&
      at - this.queueObservedAt < 1000 &&
      !(this.queueObservedCount && !queue.pendingCount)
    )
      return;
    this.queueObservedAt = at;
    this.queueObservedCount = queue.pendingCount;
    const scope = captureDiagnostic(this.options.diagnostics);
    if (scope) observe(scope.sink, { name: 'sync.client.queue', details: queue }, scope.context);
  }
  private finishSave(outcome: ClientDiagnosticOutcome, duplicate?: boolean): void {
    const observation = this.sentObservation;
    this.sentObservation = undefined;
    if (!observation?.scope) return;
    const { sink, context } = observation.scope;
    observeOperation(
      sink,
      context,
      'document-save-server-ack',
      outcome,
      Math.max(0, this.diagnosticNow() - observation.at),
    );
    if (outcome === 'success')
      observe(
        sink,
        { name: 'sync.client.acknowledged', details: { duplicate: duplicate === true } },
        context,
      );
  }

  constructor(options: SyncClientOptions) {
    if (!validRevision(options.revision)) throw new ClientError('malformed');
    this.options = options;
    this.revision = options.revision;
    if (options.checkpoint) this.restore(options.checkpoint);
    this.publish();
    if (this.reason) queueMicrotask(() => this.finishResync());
  }

  get confirmedRevision() {
    return this.revision;
  }
  get accepting() {
    return !this.disposed && !this.reason;
  }
  private preserving(): boolean {
    // A persisted failure is terminal even if the caller later disables the
    // opt-in policy. Changing policy cannot authorize replay of retained work.
    return Boolean(this.retainedCheckpoint) || enabled(this.options.preservePendingOnFailure);
  }
  get state(): ClientState {
    return {
      revision: this.revision,
      pending: Boolean(
        this.sent ||
        this.buffer.length ||
        this.pendingPersistence ||
        this.persistenceFailed ||
        this.retainedCheckpoint?.recoverySnapshot ||
        this.retainedCheckpoint?.recoveryMissing,
      ),
      pendingMutations: this.inflight.length + this.buffer.flat().length,
      connected: this.connected,
      resyncing: Boolean(this.reason),
      ...((this.reason || this.persistenceFailed) && { failure: this.reason ?? 'unavailable' }),
      ...(this.options.persist && {
        localPersistence:
          this.persistenceFailed || this.retainedCheckpoint?.recoveryMissing
            ? ('failed' as const)
            : this.pendingPersistence
              ? ('saving' as const)
              : ('saved' as const),
      }),
      ...(this.retainedCheckpoint?.recoveryMissing && { recoveryMissing: true }),
    };
  }

  /** A local group has already been applied to the visible editor. */
  enqueue(mutations: readonly Mutation[]): void {
    if (this.disposed || !mutations.length) return;
    if (this.reason) return;
    try {
      if (mutations.length > MAX_BATCH_MUTATIONS || envelopeBytes(mutations) > MAX_WIRE_BYTES)
        throw new ClientError('capacity');
      const copied = clone([...mutations]);
      const pending = [...this.inflight, ...this.buffer.flat()];
      if (pending.length + copied.length > 8192) throw new ClientError('capacity');
      const cells = cellsAfter(this.options.confirmed.cells(), pending, byteBudget());
      // Strict admission, including when there is no concurrent edit.
      transform(copied, [], 'right', { cells });
      if (encodedBytes([...this.buffer, copied]) > MAX_PENDING_BYTES)
        throw new ClientError('capacity');
      // One group is never cut in two, including an absolute write and its tail.
      if (envelopeBytes(copied) > MAX_WIRE_BYTES) throw new ClientError('capacity');
      this.buffer.push(copied);
      if (this.options.diagnostics)
        this.queuedObservations.set(copied, {
          at: this.diagnosticNow(),
          scope: captureDiagnostic(this.options.diagnostics),
        });
      void this.changed();
      this.schedule();
    } catch (error) {
      this.refuse(failureOf(error));
    }
  }

  setConnected(connected: boolean): void {
    if (this.disposed) return;
    this.connected = connected;
    this.generation++;
    if (!connected) {
      this.awaitingResume = true;
      this.inbox.clear();
      this.incomingBytes = 0;
      clearTimeout(this.timer);
      this.timer = undefined;
    } else if (this.reason && this.sent) this.retry();
    this.publish();
  }

  retry(): void {
    if (this.disposed || this.pendingPersistence) return;
    if (this.recoveryCapturePending) {
      this.captureRecovery();
      void this.changed();
      return;
    }
    if (this.persistenceFailed) {
      void this.changed().then(() => {
        if (!this.persistenceFailed) this.retry();
      });
      return;
    }
    if (!this.connected || (this.reason && this.preserving())) return;
    if (this.awaitingResume && enabled(this.options.requireUnchangedResume)) return;
    if (this.sent) this.write(this.sent);
    else if (!this.awaitingResume && !this.reason) this.pump();
  }

  receive(frame: IncomingFrame): void {
    if (this.disposed) return;
    if (this.reason && this.preserving()) return;
    try {
      if (this.preserving()) this.processingCheckpoint = this.checkpoint();
      if (!frame || typeof frame !== 'object') throw new ClientError('malformed');
      if (frame.type === 'resync') {
        if (!failures.has(frame.reason)) throw new ClientError('malformed');
        if (frame.mutationId !== undefined) {
          if (frame.mutationId !== this.sent?.mutationId) return;
          if (!this.preserving()) {
            this.finishSave('failure');
            this.sent = null;
            this.inflight = [];
          }
        }
        this.refuse(frame.reason);
        return;
      }
      if (frame.type === 'ack') {
        this.acknowledge(frame);
        return;
      }
      if (this.reason) return;
      if (frame.type === 'resume') this.resume(frame);
      else if (frame.type === 'edit') {
        // An equal resume is not a lock: a peer may commit before the first
        // replay request is built. Do not rebase that offline intent silently.
        if (this.replayBase !== undefined && !this.sent && frame.revision > this.replayBase)
          throw new ClientError('stale');
        this.hold(frame);
        if (!this.sent && !this.awaitingResume) this.drain();
        void this.changed();
      } else throw new ClientError('malformed');
    } catch (error) {
      this.refuse(failureOf(error));
    } finally {
      this.processingCheckpoint = undefined;
    }
  }

  /** An unrelated resync cannot answer a write that may already be durable. */
  refuse(reason: ClientFailure): void {
    if (this.disposed) return;
    if (!this.reason && this.options.diagnostics)
      this.resyncObservation = {
        at: this.diagnosticNow(),
        scope: captureDiagnostic(this.options.diagnostics),
        queue: this.diagnosticQueue(),
      };
    if (this.preserving()) {
      if (this.reason) return;
      // Incoming application can fail after an earlier native handler ran.
      // Keep the coherent pre-frame base+queue, not a partially rebased model.
      this.retainedCheckpoint = clone(this.processingCheckpoint ?? this.checkpoint());
      this.reason = reason;
      this.retainedCheckpoint.failure = reason;
      if (!this.processingCheckpoint) this.captureRecovery();
      this.sent = clone(this.retainedCheckpoint.sent);
      this.inflight = clone(this.retainedCheckpoint.inflight);
      this.buffer = clone(this.retainedCheckpoint.buffer);
      this.revision = this.retainedCheckpoint.revision;
      this.connected = false;
      // A retained request may already be committed with its receipt still in
      // flight. End this client's wait without claiming that durable save failed.
      this.finishSave('cancelled');
      this.awaitingResume = true;
      this.inbox.clear();
      this.incomingBytes = 0;
      clearTimeout(this.timer);
      this.timer = undefined;
      void this.changed().then(() => this.finishResync());
      return;
    }
    const first = !this.reason;
    this.reason ??= reason;
    this.buffer = [];
    this.inbox.clear();
    this.incomingBytes = 0;
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.changed().then(() => {
      if (first && this.options.persist && this.sent) this.retry();
    });
    if (this.sent) {
      if (first && !this.options.persist) this.retry();
      return;
    }
    this.finishResync();
  }

  checkpoint(): ClientCheckpoint {
    const scope = captureDiagnostic(this.options.diagnostics);
    const at = this.diagnosticNow();
    let outcome: 'captured' | 'failure' = 'failure';
    try {
      if (this.retainedCheckpoint) {
        const result = clone(this.retainedCheckpoint);
        outcome = 'captured';
        return result;
      }
      const result: ClientCheckpoint = {
        version: 1,
        unitId: this.options.unitId,
        revision: this.revision,
        snapshot: clone(this.options.confirmed.snapshot()),
        sent: clone(this.sent),
        inflight: clone(this.inflight),
        buffer: clone(this.buffer),
      };
      outcome = 'captured';
      return result;
    } finally {
      if (scope)
        observe(
          scope.sink,
          {
            name: 'native.checkpoint',
            details: {
              outcome,
              durationMs: Math.max(0, this.diagnosticNow() - at),
            },
          },
          scope.context,
        );
    }
  }

  /** Checkpoint an editor newly opted into storage; also usable while offline. */
  async persistNow(): Promise<void> {
    if (this.disposed) throw new ClientError('unavailable');
    if (this.recoveryCapturePending) this.captureRecovery();
    await this.changed();
    if (this.disposed || this.persistenceFailed || this.retainedCheckpoint?.recoveryMissing)
      throw new ClientError('unavailable');
  }

  private captureRecovery(): void {
    const checkpoint = this.retainedCheckpoint!;
    try {
      const recoverySnapshot = this.options.visibleSnapshot();
      // Native capture happens after the edit applied. A bounded supported
      // edit can exceed the wire envelope, so the queue alone is insufficient.
      const candidate = { ...checkpoint, recoverySnapshot, recoveryMissing: false };
      validateRecoverySnapshot(candidate);
      checkpoint.recoverySnapshot = clone(recoverySnapshot);
      delete checkpoint.recoveryMissing;
      this.recoveryCapturePending = false;
    } catch {
      delete checkpoint.recoverySnapshot;
      checkpoint.recoveryMissing = true;
      this.recoveryCapturePending = true;
    }
  }

  private restore(checkpoint: ClientCheckpoint): void {
    validateCheckpoint(checkpoint, this.options.unitId, this.revision);
    const pending = [...checkpoint.inflight, ...checkpoint.buffer.flat()];
    const sent = checkpoint.sent;
    transform(pending, [], 'right', { cells: this.options.confirmed.cells() });
    this.sent = clone(sent);
    this.inflight = clone(checkpoint.inflight);
    this.buffer = clone(checkpoint.buffer);
    if (checkpoint.failure) {
      this.reason = checkpoint.failure;
      this.retainedCheckpoint = clone(checkpoint);
    }
  }

  addCleanup(cleanup: () => void): void {
    if (this.disposed) cleanup();
    else this.cleanups.push(cleanup);
  }

  dispose(): void {
    if (this.disposed) return;
    this.finishSave('cancelled');
    this.finishResyncObservation('cancelled');
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.inbox.clear();
    this.options.confirmed.dispose();
  }

  private schedule(): void {
    if (this.timer || this.sent || this.reason || !this.connected || this.awaitingResume) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pump();
    }, this.options.batchDelayMs ?? 25);
  }

  private pump(): void {
    if (
      this.disposed ||
      this.reason ||
      this.sent ||
      !this.connected ||
      this.awaitingResume ||
      this.pendingPersistence ||
      this.persistenceFailed ||
      !this.buffer.length
    )
      return;
    const mutations: Mutation[] = [];
    let groups = 0;
    for (const group of this.buffer) {
      const next = [...mutations, ...group];
      if (next.length > MAX_BATCH_MUTATIONS || envelopeBytes(next) > MAX_WIRE_BYTES) break;
      mutations.push(...group);
      groups++;
    }
    if (!groups) {
      this.refuse('capacity');
      return;
    }
    const firstObservation = this.queuedObservations.get(this.buffer[0]);
    this.buffer.splice(0, groups);
    const request: SubmitFrame = {
      type: 'submit',
      mutationId: this.options.mutationId?.() ?? crypto.randomUUID(),
      baseRevision: this.revision,
      mutations: clone(mutations),
    };
    if (encodedBytes(request) > MAX_WIRE_BYTES) {
      this.refuse('capacity');
      return;
    }
    this.sent = request;
    this.sentObservation =
      firstObservation ??
      (this.options.diagnostics
        ? {
            at: this.diagnosticNow(),
            scope: captureDiagnostic(this.options.diagnostics),
            unknownAge: true,
          }
        : undefined);
    this.inflight = mutations;
    // With persistence installed, the immutable retry identity reaches storage
    // before the first network send. Later completions cannot clear newer work.
    void this.changed().then(() => {
      if (
        !this.disposed &&
        !this.reason &&
        !this.persistenceFailed &&
        this.sent === request &&
        this.connected &&
        !this.awaitingResume
      )
        this.write(request);
    });
  }

  private write(frame: SubmitFrame | { type: 'verify'; revision: number; hash: string }): void {
    // A recovered immutable request has no persisted monotonic timing. Observe
    // its first send in this client lifetime, keeping age explicitly unknown.
    if (frame.type === 'submit' && !this.sentObservation && this.options.diagnostics)
      this.sentObservation = {
        at: this.diagnosticNow(),
        scope: captureDiagnostic(this.options.diagnostics),
        unknownAge: true,
      };
    try {
      this.options.send(
        frame.type === 'submit' && this.replayBase !== undefined
          ? { ...clone(frame), expectedRevision: this.replayBase }
          : clone(frame),
      );
    } catch {
      this.setConnected(false);
    }
  }

  private validate(edit: WireRevision): void {
    if (
      !validRevision(edit.revision) ||
      edit.revision < 2 ||
      !Array.isArray(edit.mutations) ||
      edit.mutations.length > MAX_BATCH_MUTATIONS ||
      typeof edit.hash !== 'string' ||
      !/^[a-f\d]{64}$/.test(edit.hash) ||
      !edit.touched ||
      !['sheet', 'doc'].includes(edit.touched.kind)
    )
      throw new ClientError('malformed');
    if (
      edit.touched.kind === 'sheet' &&
      (!Array.isArray(edit.touched.cells) ||
        edit.touched.cells.length > 250_000 ||
        edit.touched.cells.some(
          (cell) =>
            typeof cell.sheetId !== 'string' ||
            !Number.isSafeInteger(cell.row) ||
            !Number.isSafeInteger(cell.column) ||
            cell.row < 0 ||
            cell.column < 0,
        ))
    )
      throw new ClientError('malformed');
  }

  private hold(edit: WireRevision): void {
    this.validate(edit);
    if (edit.revision <= this.revision) return;
    const existing = this.inbox.get(edit.revision);
    if (existing) {
      if (canonical(existing) !== canonical(this.editOnly(edit)))
        throw new ClientError('malformed');
      return;
    }
    const value = this.editOnly(edit);
    const bytes = encodedBytes(value);
    if (
      this.inbox.size >= MAX_INCOMING_REVISIONS ||
      this.incomingBytes + bytes > MAX_INCOMING_BYTES
    )
      throw new ClientError('capacity');
    this.inbox.set(edit.revision, clone(value));
    this.incomingBytes += bytes;
  }

  private editOnly(edit: WireRevision): WireRevision {
    return {
      revision: edit.revision,
      mutations: edit.mutations,
      touched: edit.touched,
      hash: edit.hash,
    };
  }

  private take(revision: number): WireRevision | undefined {
    const edit = this.inbox.get(revision);
    if (edit) {
      this.incomingBytes -= encodedBytes(edit);
      this.inbox.delete(revision);
    }
    return edit;
  }

  private resume(frame: ResumeFrame): void {
    if (
      frame.version !== 1 ||
      frame.unitId !== this.options.unitId ||
      frame.fromRevision !== this.revision ||
      !validRevision(frame.revision) ||
      !Array.isArray(frame.edits) ||
      frame.edits.length > MAX_INCOMING_REVISIONS ||
      frame.revision - frame.fromRevision !== frame.edits.length
    )
      throw new ClientError('stale');
    if (enabled(this.options.requireUnchangedResume) && (this.sent || this.buffer.length)) {
      if (frame.revision !== this.revision) throw new ClientError('stale');
      this.replayBase = this.revision;
    } else this.replayBase = undefined;
    for (const [index, edit] of frame.edits.entries()) {
      if (edit.revision !== frame.fromRevision + index + 1) throw new ClientError('stale');
      this.hold(edit);
    }
    this.awaitingResume = false;
    if (!this.sent) this.drain();
    void this.changed().then(() => this.retry());
  }

  private drain(): void {
    while (this.inbox.size) {
      const edit = this.take(this.revision + 1);
      if (!edit) throw new ClientError('stale');
      this.remote(edit);
    }
  }

  private remote(edit: WireRevision): void {
    if (edit.revision !== this.revision + 1) throw new ClientError('stale');
    const base = this.options.confirmed.cells();
    const oldInflight = this.inflight;
    const oldBuffer = this.buffer.flat();
    let incoming = edit.mutations;
    let inflight = oldInflight;
    if (oldInflight.length) {
      inflight = transform(oldInflight, incoming, 'right', { cells: base });
      incoming = transform(incoming, oldInflight, 'left', { cells: base });
    }
    // The buffer was made on confirmed + OLD inflight, before this edit arrived.
    const bufferBase = cellsAfter(base, oldInflight, byteBudget());
    const buffer = oldBuffer.length
      ? transform(oldBuffer, incoming, 'right', { cells: bufferBase })
      : [];
    if (oldBuffer.length) incoming = transform(incoming, oldBuffer, 'left', { cells: bufferBase });
    const groups = atomicMutationGroups(buffer);
    if (
      buffer.length + inflight.length > 8192 ||
      encodedBytes([inflight, buffer]) > MAX_PENDING_BYTES ||
      groups.some((group) => envelopeBytes(group) > MAX_WIRE_BYTES)
    )
      throw new ClientError('capacity');
    this.options.confirmed.apply(edit.mutations);
    this.options.applyRemote(incoming);
    this.inflight = inflight;
    // Split only at the transform's own boundaries; an absolute write and its
    // required tail are one group, so large buffers can drain in safe batches.
    this.buffer = groups;
    this.revision = edit.revision;
    this.lastEdit = clone(edit);
  }

  private acknowledge(ack: AckFrame): void {
    if (!this.sent || ack.mutationId !== this.sent.mutationId) return;
    this.validate(ack);
    if (this.reason) {
      this.finishSave('success', ack.duplicate);
      this.sent = null;
      this.inflight = [];
      void this.changed();
      this.finishResync();
      return;
    }
    try {
      if (this.replayBase !== undefined && ack.revision !== this.replayBase + 1)
        throw new ClientError('stale');
      if (ack.revision <= this.revision) throw new ClientError('stale');
      while (this.revision + 1 < ack.revision) {
        const edit = this.take(this.revision + 1);
        if (!edit) throw new ClientError('stale');
        this.remote(edit);
      }
      const own = this.take(ack.revision);
      if (own && canonical(own) !== canonical(this.editOnly(ack)))
        throw new ClientError('malformed');
      // This validated receipt proves server durability even if applying it to
      // the local confirmed replica fails. Observe it before native replay.
      this.finishSave('success', ack.duplicate);
      // The visible unit already includes this optimistic edit and transformed
      // remote edits. The exact durable output advances only the confirmed copy.
      this.options.confirmed.apply(ack.mutations);
      this.revision = ack.revision;
      this.lastEdit = this.editOnly(clone(ack));
      this.sent = null;
      this.inflight = [];
      this.replayBase = undefined;
      this.drain();
      void this.changed();
      this.schedule();
    } catch (error) {
      if (this.preserving()) throw error;
      // This ack answers the sent request even when a later buffered edit cannot
      // be rebased. Reload can now retain the accepted request safely.
      this.sent = null;
      this.inflight = [];
      // Before receipt validation, a replay/order failure leaves durability
      // unknown. After validation, finishSave is already settled as success.
      this.finishSave('cancelled');
      this.refuse(failureOf(error));
    }
  }

  private changed(): Promise<void> {
    this.generation++;
    if (!this.options.persist || this.disposed) {
      this.publish();
      this.settle();
      return Promise.resolve();
    }
    this.pendingPersistence++;
    this.publish();
    const scope = captureDiagnostic(this.options.diagnostics);
    const at = this.diagnosticNow();
    const saved = this.persistence.then(async () => {
      if (this.disposed) {
        if (scope)
          observe(
            scope.sink,
            {
              name: 'native.checkpoint',
              details: { outcome: 'cancelled', durationMs: Math.max(0, this.diagnosticNow() - at) },
            },
            scope.context,
          );
        return;
      }
      let checkpoint: ClientCheckpoint | undefined;
      let requested = false;
      let active = true;
      try {
        // A host may discover asynchronously that no local copy needs a write.
        // Once requested, one coherent snapshot serves this serialized write.
        await this.options.persist!(() => {
          if (!active || this.disposed) throw new ClientError('unavailable');
          requested = true;
          return (checkpoint ??= this.checkpoint());
        });
      } finally {
        active = false;
        if (!requested && scope)
          observe(
            scope.sink,
            {
              name: 'native.checkpoint',
              details: {
                outcome: 'skipped',
                durationMs: Math.max(0, this.diagnosticNow() - at),
              },
            },
            scope.context,
          );
      }
    });
    this.persistence = saved.catch(() => {});
    return saved.then(
      () => {
        this.pendingPersistence--;
        this.persistenceFailed = false;
        if (!this.disposed) {
          this.publish();
          this.settle();
          this.schedule();
          this.finishResync();
        }
      },
      () => {
        this.pendingPersistence--;
        if (!this.disposed) {
          // A broken store does not silently discard edits or declare them saved.
          this.persistenceFailed = true;
          this.publish();
        }
      },
    );
  }

  private settle(): void {
    if (
      this.disposed ||
      this.reason ||
      !this.connected ||
      this.awaitingResume ||
      this.state.pending ||
      !this.lastEdit
    )
      return;
    const generation = this.generation;
    const revision = this.revision;
    const touched = clone(this.lastEdit.touched);
    let snapshot;
    try {
      snapshot = this.options.visibleSnapshot();
    } catch (error) {
      this.refuse(failureOf(error));
      return;
    }
    void (this.options.hash ?? hashTouched)(snapshot, touched).then(
      (hash) => {
        if (
          !this.disposed &&
          !this.reason &&
          generation === this.generation &&
          this.connected &&
          !this.awaitingResume &&
          !this.state.pending &&
          revision === this.revision
        )
          this.write({ type: 'verify', revision, hash });
      },
      (error) => {
        if (!this.disposed && generation === this.generation) this.refuse(failureOf(error));
      },
    );
  }

  private publish(): void {
    this.observeQueue();
    if (!this.disposed) this.options.onState(this.state);
  }

  private finishResync(): void {
    if (
      this.notified ||
      this.disposed ||
      (this.sent && !this.preserving()) ||
      this.pendingPersistence ||
      this.persistenceFailed ||
      !this.reason
    )
      return;
    this.notified = true;
    this.finishResyncObservation('success');
    this.options.onResync(this.reason);
  }

  private finishResyncObservation(outcome: ClientDiagnosticOutcome): void {
    const observation = this.resyncObservation;
    this.resyncObservation = undefined;
    if (!observation?.scope || !this.reason) return;
    const { sink, context } = observation.scope;
    observe(
      sink,
      {
        name: 'sync.client.resync',
        details: {
          reason: this.reason,
          outcome: outcome === 'success' ? 'handed-off' : 'cancelled',
          durationMs: Math.max(0, this.diagnosticNow() - observation.at),
          ...observation.queue,
        },
      },
      context,
    );
    if (outcome === 'success') {
      observeSync(sink, context, {
        name: 'sync.edit.resync',
        reason: this.reason === 'stale' ? 'retention' : this.reason,
      });
      observeSync(sink, context, {
        name: 'sync.resync.pending',
        value: observation.queue.pendingCount,
      });
    }
  }
}
