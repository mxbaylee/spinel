import { createHash } from 'node:crypto';
import { AUTHORITY_MS, uuidPattern } from './journal.ts';
import { validRestoreJobRecord } from './restore-jobs.ts';
import type { RestoreController } from '../backup/restore-control.ts';

export type RestoreRpcAction = 'restore-admit' | 'restore-begin' | 'restore-observe';
export type RestoreRpcResult =
  | Awaited<ReturnType<RestoreController['admit']>>
  | Awaited<ReturnType<RestoreController['begin']>>
  | Awaited<ReturnType<RestoreController['observe']>>;

// Admission itself cannot outlive its original authority. A lost IPC reply is
// uncertain custody, never permission for the registry to discard its source.
export const RESTORE_RPC_MS = AUTHORITY_MS + 30_000;
export const RESTORE_RPC_PENDING = 8;
export const RESTORE_RPC_BYTES = 128 * 1024;
export const RESTORE_RPC_ERROR =
  'Restore control could not confirm this operation. Retain the preparation and check its status.';

export function boundedRestoreRpc(value: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value)) <= RESTORE_RPC_BYTES;
  } catch {
    return false;
  }
}

/** Validate private transport evidence before the registry checks its own exact
 * source/confirmation contract. This is not public outcome or opening authority. */
export function validRestoreRpcResult(
  value: unknown,
  action: RestoreRpcAction,
  id?: string,
  intentHash?: string,
): value is RestoreRpcResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !boundedRestoreRpc(value))
    return false;
  const result = value as Record<string, unknown>;
  if (action === 'restore-observe') {
    const target = result.target as { generationId?: unknown; epoch?: unknown } | undefined;
    if (
      Object.keys(result).length !== 3 ||
      typeof result.pending !== 'boolean' ||
      !target ||
      typeof target !== 'object' ||
      Object.keys(target).length !== 2 ||
      typeof target.generationId !== 'string' ||
      !uuidPattern.test(target.generationId) ||
      typeof target.epoch !== 'string' ||
      !uuidPattern.test(target.epoch)
    )
      return false;
    if (result.record === null) return true;
    const record = result.record as { intent?: { id?: unknown } } | undefined;
    return (
      typeof record?.intent?.id === 'string' &&
      (id === undefined || record.intent.id === id) &&
      validRestoreJobRecord(record, record.intent.id)
    );
  }
  if (!id || !validRestoreJobRecord(result.record, id)) return false;
  if (action === 'restore-begin')
    return (
      Object.keys(result).length === 1 &&
      !!result.record.execution &&
      result.record.intentHash === intentHash
    );
  return (
    Object.keys(result).every((key) => ['record', 'custody', 'continuationToken'].includes(key)) &&
    typeof result.custody === 'boolean' &&
    (result.custody
      ? result.record.phase === 'source-retained'
      : result.record.phase === 'failed' && result.continuationToken === undefined) &&
    (result.continuationToken === undefined ||
      (typeof result.continuationToken === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(result.continuationToken) &&
        createHash('sha256').update(result.continuationToken).digest('hex') ===
          result.record.intent.continuationHash))
  );
}
