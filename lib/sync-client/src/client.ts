import {
  canonical,
  atomicMutationGroups,
  cellsAfter,
  RefusedEditError,
  transform,
  UnsupportedMutationError,
} from '@spinel/sync-transform';
import type { Mutation } from '@spinel/sync-transform';
import { byteBudget, encodedBytes, hashTouched } from './hash.ts';
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
const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 1;
const failures = new Set<ClientFailure>([
  'unsupported',
  'refused',
  'stale',
  'divergence',
  'unavailable',
  'malformed',
  'capacity',
  'retry-conflict',
  'invariant',
]);
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

  constructor(options: SyncClientOptions) {
    if (!validRevision(options.revision)) throw new ClientError('malformed');
    this.options = options;
    this.revision = options.revision;
    this.publish();
  }

  get confirmedRevision() {
    return this.revision;
  }
  get accepting() {
    return !this.disposed && !this.reason;
  }
  get state(): ClientState {
    return {
      revision: this.revision,
      pending: Boolean(
        this.sent || this.buffer.length || this.pendingPersistence || this.persistenceFailed,
      ),
      pendingMutations: this.inflight.length + this.buffer.flat().length,
      connected: this.connected,
      resyncing: Boolean(this.reason),
      ...((this.reason || this.persistenceFailed) && { failure: this.reason ?? 'unavailable' }),
    };
  }

  /** A local group has already been applied to the visible editor. */
  enqueue(mutations: readonly Mutation[]): void {
    if (this.disposed || !mutations.length) return;
    if (this.reason) return;
    try {
      if (mutations.length > MAX_BATCH_MUTATIONS || this.envelopeBytes(mutations) > MAX_WIRE_BYTES)
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
      if (this.envelopeBytes(copied) > MAX_WIRE_BYTES) throw new ClientError('capacity');
      this.buffer.push(copied);
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
    if (this.disposed || !this.connected || this.pendingPersistence) return;
    if (this.persistenceFailed) {
      void this.changed().then(() => {
        if (!this.persistenceFailed) this.retry();
      });
      return;
    }
    if (this.sent) this.write(this.sent);
    else if (!this.awaitingResume && !this.reason) this.pump();
  }

  receive(frame: IncomingFrame): void {
    if (this.disposed) return;
    try {
      if (!frame || typeof frame !== 'object') throw new ClientError('malformed');
      if (frame.type === 'resync') {
        if (!failures.has(frame.reason)) throw new ClientError('malformed');
        if (frame.mutationId !== undefined) {
          if (frame.mutationId !== this.sent?.mutationId) return;
          this.sent = null;
          this.inflight = [];
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
        this.hold(frame);
        if (!this.sent && !this.awaitingResume) this.drain();
        void this.changed();
      } else throw new ClientError('malformed');
    } catch (error) {
      this.refuse(failureOf(error));
    }
  }

  /** An unrelated resync cannot answer a write that may already be durable. */
  refuse(reason: ClientFailure): void {
    if (this.disposed) return;
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
    return {
      version: 1,
      unitId: this.options.unitId,
      revision: this.revision,
      snapshot: clone(this.options.confirmed.snapshot()),
      sent: clone(this.sent),
      inflight: clone(this.inflight),
      buffer: clone(this.buffer),
    };
  }

  addCleanup(cleanup: () => void): void {
    if (this.disposed) cleanup();
    else this.cleanups.push(cleanup);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.inbox.clear();
    this.options.confirmed.dispose();
  }

  private envelopeBytes(mutations: readonly Mutation[]): number {
    return encodedBytes({
      type: 'submit',
      mutationId: '00000000-0000-4000-8000-000000000000',
      baseRevision: Number.MAX_SAFE_INTEGER,
      mutations,
    });
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
      if (next.length > MAX_BATCH_MUTATIONS || this.envelopeBytes(next) > MAX_WIRE_BYTES) break;
      mutations.push(...group);
      groups++;
    }
    if (!groups) {
      this.refuse('capacity');
      return;
    }
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
    try {
      this.options.send(clone(frame));
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
      groups.some((group) => this.envelopeBytes(group) > MAX_WIRE_BYTES)
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
      this.sent = null;
      this.inflight = [];
      void this.changed();
      this.finishResync();
      return;
    }
    try {
      if (ack.revision <= this.revision) throw new ClientError('stale');
      while (this.revision + 1 < ack.revision) {
        const edit = this.take(this.revision + 1);
        if (!edit) throw new ClientError('stale');
        this.remote(edit);
      }
      const own = this.take(ack.revision);
      if (own && canonical(own) !== canonical(this.editOnly(ack)))
        throw new ClientError('malformed');
      // The visible unit already includes this optimistic edit and transformed
      // remote edits. The exact durable output advances only the confirmed copy.
      this.options.confirmed.apply(ack.mutations);
      this.revision = ack.revision;
      this.lastEdit = this.editOnly(clone(ack));
      this.sent = null;
      this.inflight = [];
      this.drain();
      void this.changed();
      this.schedule();
    } catch (error) {
      // This ack answers the sent request even when a later buffered edit cannot
      // be rebased. Reload can now retain the accepted request safely.
      this.sent = null;
      this.inflight = [];
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
    const saved = this.persistence.then(() => {
      // Materialize only when this serialized write starts. A slow store keeps
      // one snapshot alive, rather than one whole snapshot per queued keystroke.
      if (!this.disposed) return this.options.persist!(this.checkpoint());
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
    if (!this.disposed) this.options.onState(this.state);
  }

  private finishResync(): void {
    if (
      this.notified ||
      this.disposed ||
      this.sent ||
      this.pendingPersistence ||
      this.persistenceFailed ||
      !this.reason
    )
      return;
    this.notified = true;
    this.options.onResync(this.reason);
  }
}
