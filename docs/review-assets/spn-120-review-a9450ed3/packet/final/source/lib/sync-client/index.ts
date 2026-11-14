export { SyncClient } from './src/client.ts';
export {
  NativeReplica,
  applyNative,
  nativeSnapshot,
  createNativeSyncClient,
} from './src/native.ts';
export { captureNative } from './src/capture.ts';
export type { NativeCaptureOptions } from './src/capture.ts';
export { hashTouched } from './src/hash.ts';
export { admitSnapshot as validateNativeSnapshot } from './src/admission.ts';
export { validateRecoverySnapshot } from './src/recovery.ts';
export { validateCheckpoint } from './src/checkpoint.ts';
export { ClientError } from './src/types.ts';
export type {
  AckFrame,
  CellAddress,
  ClientCheckpoint,
  ClientCheckpointFactory,
  ClientFailure,
  ClientState,
  DocumentKind,
  EditFrame,
  IncomingFrame,
  NativeSnapshot,
  NativeSyncOptions,
  OutgoingFrame,
  ResumeFrame,
  ResyncFrame,
  SubmitFrame,
  SyncClientOptions,
  SyncReplica,
  Touched,
  VerifyFrame,
  WireRevision,
} from './src/types.ts';
