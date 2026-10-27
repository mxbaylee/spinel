import type { IDocumentData, IWorkbookData, Univer } from '@univerjs/core';
import type { BaseCells, Mutation } from '@spinel/sync-transform';

export type NativeSnapshot = IWorkbookData | IDocumentData;
export type DocumentKind = 'sheet' | 'doc';
export interface CellAddress {
  sheetId: string;
  row: number;
  column: number;
}
export type Touched = { kind: 'sheet'; cells: CellAddress[] } | { kind: 'doc' };
export interface WireRevision {
  revision: number;
  mutations: Mutation[];
  touched: Touched;
  hash: string;
}
export interface EditFrame extends WireRevision {
  type: 'edit';
}
export interface AckFrame extends WireRevision {
  type: 'ack';
  mutationId: string;
  duplicate: boolean;
}
export interface ResumeFrame {
  type: 'resume';
  version: 1;
  unitId: string;
  fromRevision: number;
  revision: number;
  edits: WireRevision[];
}
export type ClientFailure =
  | 'unsupported'
  | 'refused'
  | 'stale'
  | 'divergence'
  | 'unavailable'
  | 'malformed'
  | 'capacity'
  | 'retry-conflict'
  | 'invariant';
export interface ResyncFrame {
  type: 'resync';
  reason: ClientFailure;
  mutationId?: string;
}
export type IncomingFrame = EditFrame | AckFrame | ResumeFrame | ResyncFrame;
export interface SubmitFrame {
  type: 'submit';
  mutationId: string;
  baseRevision: number;
  mutations: Mutation[];
  /** Admission-only reconnect fence; it is not part of the immutable retry identity. */
  expectedRevision?: number;
}
export interface VerifyFrame {
  type: 'verify';
  revision: number;
  hash: string;
}
export type OutgoingFrame = SubmitFrame | VerifyFrame;
export interface ClientState {
  revision: number;
  pending: boolean;
  pendingMutations: number;
  /** Transport availability; the application separately establishes room readiness. */
  connected: boolean;
  resyncing: boolean;
  failure?: ClientFailure;
  /** Present only with persistence; `saved` means its transaction completed. */
  localPersistence?: 'saving' | 'saved' | 'failed';
}

export interface ClientCheckpoint {
  version: 1;
  unitId: string;
  revision: number;
  snapshot: NativeSnapshot;
  /** Exact original wire request, never the subsequently rebased local copy. */
  sent: SubmitFrame | null;
  inflight: Mutation[];
  buffer: Mutation[][];
  /** A retained queue needs explicit recovery, never an automatic replay. */
  failure?: ClientFailure;
}
export interface SyncReplica {
  cells(): BaseCells;
  apply(mutations: readonly Mutation[]): void;
  snapshot(): NativeSnapshot;
  dispose(): void;
}
export interface SyncClientOptions {
  unitId: string;
  revision: number;
  confirmed: SyncReplica;
  /** Every accepted remote revision, even when rebasing removes all visible edits. */
  applyRemote(mutations: readonly Mutation[]): void;
  visibleSnapshot(): NativeSnapshot;
  send(frame: OutgoingFrame): void;
  onState(state: ClientState): void;
  onResync(reason: ClientFailure): void;
  persist?(checkpoint: ClientCheckpoint): void | Promise<void>;
  checkpoint?: ClientCheckpoint;
  /** Offline hosts retain a recoverable queue when ordinary clients would reload. */
  preservePendingOnFailure?: boolean | (() => boolean);
  /** First pending replay requires an unchanged server base, including send races. */
  requireUnchangedResume?: boolean | (() => boolean);
  /** Injectable UUID source and batching delay keep queue tests deterministic. */
  mutationId?(): string;
  batchDelayMs?: number;
  hash?(snapshot: NativeSnapshot, touched: Touched): Promise<string>;
}
export interface NativeSyncOptions extends Omit<
  SyncClientOptions,
  'confirmed' | 'applyRemote' | 'visibleSnapshot'
> {
  univer: Univer;
  kind: DocumentKind;
  snapshot: NativeSnapshot;
  /** The visible editor may use local image URLs; storage and wire remain canonical. */
  toCanonical?<T>(value: T): T;
  toVisible?<T>(value: T): T;
}

export const MAX_WIRE_BYTES = 64 * 1024;
export const MAX_BATCH_MUTATIONS = 1024;
export const MAX_PENDING_BYTES = 10 * 1024 * 1024;
export const MAX_INCOMING_BYTES = 16 * 1024 * 1024;
export const MAX_INCOMING_REVISIONS = 128;

export class ClientError extends Error {
  readonly reason: ClientFailure;
  constructor(reason: ClientFailure) {
    super(`Sync ${reason}. Reload the document.`);
    this.name = 'ClientError';
    this.reason = reason;
  }
}
