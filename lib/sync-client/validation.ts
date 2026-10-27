// Pure admission entry for hosts that must inspect retained data before loading
// the native editor. Keep this graph free of runtime SDK and transform imports.
export { admitSnapshot as validateNativeSnapshot } from './src/admission.ts';
export { validateRecoverySnapshot } from './src/recovery.ts';
export { validateCheckpoint } from './src/checkpoint.ts';
