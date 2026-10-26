export { SyncServer } from './src/server.ts';
export { materialize, validateSnapshot } from './src/native.ts';
export { hashTouched, snapshotCells } from './src/cells.ts';
export {
  SyncError,
  MAX_SNAPSHOT_BYTES,
  MAX_RETAINED_REVISIONS,
  MAX_RETAINED_BYTES,
  MAX_BATCH_MUTATIONS,
  MAX_WORKSHEETS,
  MAX_MERGE_CELLS,
  MAX_CELL_WORK_BYTES,
} from './src/types.ts';
export type {
  CellAddress,
  CellBeforeImage,
  DocumentKind,
  NativeSnapshot,
  ReplayResult,
  SubmitRequest,
  SubmitResult,
  SyncCommit,
  SyncErrorCode,
  SyncOptions,
  SyncRevision,
  SyncStorage,
  SyncUnit,
  Touched,
} from './src/types.ts';
