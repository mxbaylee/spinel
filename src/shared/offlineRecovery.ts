import type { NativeSnapshot } from '@spinel/sync-client';

/** Persisted before publication; every retry sends this exact request. */
export interface OfflineRecoveryRequest {
  recoveryId: string;
  filename: string;
  snapshot: NativeSnapshot;
  possibleReplayCrash: boolean;
}

export interface OfflineRecoveryState {
  phase: 'ready' | 'creating' | 'failed' | 'created' | 'discarded';
  originalHref: string;
  copyHref?: string;
  copyName?: string;
  message?: string;
}
