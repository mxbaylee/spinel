import type { ICellData, IDocumentData, IWorkbookData } from '@univerjs/core';
import type { Mutation } from '@spinel/sync-transform';
import type { DiagnosticContext, DiagnosticSink } from '@spinel/diagnostics';

export type NativeSnapshot = IWorkbookData | IDocumentData;
export type DocumentKind = 'sheet' | 'doc';
export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_RETAINED_REVISIONS = 128;
export const MAX_RETAINED_BYTES = 16 * 1024 * 1024;
export const MAX_BATCH_MUTATIONS = 1024;
export const MAX_WORKSHEETS = 1024;
export const MAX_MERGE_CELLS = 250_000;

export interface CellAddress {
  sheetId: string;
  row: number;
  column: number;
}
export interface CellBeforeImage extends CellAddress {
  /** The exact native cell at the preceding revision, with its style inline. */
  value: ICellData | null;
}
export type Touched = { kind: 'sheet'; cells: CellAddress[] } | { kind: 'doc' };
export interface SyncUnit {
  unitId: string;
  kind: DocumentKind;
  revision: number;
  snapshot: NativeSnapshot;
  /** Oldest base revision for which every subsequent before-image is retained. */
  retainedFrom: number;
}
export interface SyncRevision {
  unitId: string;
  revision: number;
  baseRevision: number;
  actorId: string;
  mutationId: string;
  requestHash: string;
  /** Exact transform output, including params and trigger. */
  mutations: Mutation[];
  /** Null once outside the bounded transform retention window. */
  beforeCells: CellBeforeImage[] | null;
  touched: Touched;
  hash: string;
}
export interface SyncCommit {
  expectedRevision: number;
  unit: SyncUnit;
  edit: SyncRevision;
}
/**
 * Adapter contract: every method is synchronous. commit must call guard inside
 * the same transaction that checks expectedRevision, appends edit and replaces
 * the single live snapshot. A failure must leave every row unchanged. Retention
 * may null old beforeCells, but never discard retry receipts or accepted edits.
 */
export interface SyncStorage {
  load(unitId: string): SyncUnit | undefined;
  revisions(unitId: string, after: number, through: number): SyncRevision[];
  receipt(unitId: string, actorId: string, mutationId: string): SyncRevision | undefined;
  commit(input: SyncCommit, guard: () => void): void;
}
export interface SubmitRequest {
  unitId: string;
  actorId: string;
  mutationId: string;
  baseRevision: number;
  mutations: Mutation[];
  /** Assistant writes require an exact revision, never a transform. */
  exactRevision?: boolean;
}
export interface SubmitResult {
  duplicate: boolean;
  edit: SyncRevision;
  /** Revisions after the caller's base through this receipt, in durable order. */
  missing: SyncRevision[];
}
export interface SyncOptions<Context> {
  authorize(unitId: string, context: Context, edit: boolean): void;
  /** Async history preparation and recipient eviction run before the final synchronous boundary. */
  beforeSubmit?(unitId: string, context: Context): Promise<void>;
  validateSnapshot?(unitId: string, snapshot: NativeSnapshot, context: Context): void;
  diagnostics?: DiagnosticSink;
  diagnosticsFor?(context: Context): DiagnosticSink | undefined;
  diagnosticContext?(unitId: string, context: Context): DiagnosticContext;
  maxLoadedUnits?: number;
  idleTimeoutMs?: number;
  now?: () => number;
}
export type SyncErrorCode =
  | 'unavailable'
  | 'malformed'
  | 'unsupported'
  | 'refused'
  | 'invariant'
  | 'stale'
  | 'retry-conflict'
  | 'capacity';
export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly resync = true;
  constructor(code: SyncErrorCode) {
    super(`Sync request ${code}. Reload the document.`);
    this.name = 'SyncError';
    this.code = code;
  }
}
