import { admitSnapshot } from './admission.ts';
import { ClientError } from './types.ts';
import type { ClientCheckpoint } from './types.ts';

/** Call before constructing a visible unit from untrusted persisted recovery data. */
export function validateRecoverySnapshot(checkpoint: ClientCheckpoint): void {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint))
    throw new ClientError('malformed');
  const recovery = checkpoint.recoverySnapshot;
  if (
    (checkpoint.recoveryMissing !== undefined && typeof checkpoint.recoveryMissing !== 'boolean') ||
    ((recovery !== undefined || checkpoint.recoveryMissing) && !checkpoint.failure) ||
    (recovery !== undefined && checkpoint.recoveryMissing)
  )
    throw new ClientError('malformed');
  if (recovery === undefined) return;
  if (
    !recovery ||
    typeof recovery !== 'object' ||
    Array.isArray(recovery) ||
    !checkpoint.snapshot ||
    typeof checkpoint.snapshot !== 'object' ||
    Array.isArray(checkpoint.snapshot) ||
    typeof checkpoint.unitId !== 'string' ||
    !checkpoint.unitId ||
    recovery.id !== checkpoint.unitId ||
    checkpoint.snapshot.id !== checkpoint.unitId ||
    'sheets' in recovery !== 'sheets' in checkpoint.snapshot
  )
    throw new ClientError('malformed');
  if ('sheets' in recovery) {
    admitSnapshot(recovery, 'sheet');
    if (
      !Array.isArray(recovery.sheetOrder) ||
      recovery.sheetOrder.some((id) => typeof id !== 'string')
    )
      throw new ClientError('malformed');
  } else {
    if (!recovery.body || typeof recovery.body.dataStream !== 'string')
      throw new ClientError('malformed');
    admitSnapshot(recovery, 'doc');
  }
}
