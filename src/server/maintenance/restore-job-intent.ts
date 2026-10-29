import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { validRestorePreview } from '../../shared/restore.ts';
import type { RestorePreview } from '../../shared/restore.ts';
import type { FileIdentity } from './journal.ts';
import { validRestoreAuthority } from './restore-authority.ts';
import type { RestoreAuthority } from './restore-authority.ts';
import { validRestoreSourceManifest } from './restore-files.ts';
import type { RestoreSourceManifest } from './restore-files.ts';

/** Immutable browser-confirmed intent. Only the trusted supervisor supplies the
 * deployment target/policy and continuation hash; browser paths are never used.
 * Host recovery requires its own separately recorded authorization, not a forged
 * browser proof or an extended expiry on this record.
 */
export interface RestoreJobIntent {
  version: 1;
  id: string;
  target: {
    instanceId: string;
    generationId: string;
    epoch: string;
    databasePath: string;
    identity: FileIdentity;
  };
  source: RestoreSourceManifest;
  policy: {
    origin: string;
    image: string;
    spacesEnabled: boolean;
    staticDirectory: string;
    /** The full loss/sign-out/sharing/ownership consequence envelope, not counts. */
    consequencesVersion: 1;
  };
  authority: RestoreAuthority;
  continuationHash: string;
  confirmedAt: number;
  /** Provisional counts shown at confirmation, retained without later rewriting. */
  preview: RestorePreview;
  /** Confirmation covers the complete consequence envelope despite provisional counts. */
  consequenceEnvelope: 1;
}
const MAX_INTENT_BYTES = 24 * 1024;
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const shape = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export function validRestoreJobIntent(value: unknown): value is RestoreJobIntent {
  if (
    !shape(value, [
      'version',
      'id',
      'target',
      'source',
      'policy',
      'authority',
      'continuationHash',
      'confirmedAt',
      'preview',
      'consequenceEnvelope',
    ]) ||
    value.version !== 1 ||
    !uuid(value.id) ||
    !validRestorePreview(value.preview) ||
    value.consequenceEnvelope !== 1 ||
    !validRestoreSourceManifest(value.source) ||
    value.source.id !== value.id ||
    !validRestoreAuthority(value.authority) ||
    typeof value.continuationHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.continuationHash) ||
    !Number.isSafeInteger(value.confirmedAt) ||
    Number(value.confirmedAt) < value.authority.verifiedAt ||
    Number(value.confirmedAt) >= value.authority.expiresAt
  )
    return false;
  const target = value.target;
  const policy = value.policy;
  if (
    !shape(target, ['instanceId', 'generationId', 'epoch', 'databasePath', 'identity']) ||
    ![target.instanceId, target.generationId, target.epoch].every(uuid) ||
    typeof target.databasePath !== 'string' ||
    target.databasePath.includes('\0') ||
    Buffer.byteLength(target.databasePath) > 4096 ||
    !isAbsolute(target.databasePath) ||
    resolve(target.databasePath) !== target.databasePath ||
    !shape(target.identity, ['device', 'inode']) ||
    ![target.identity.device, target.identity.inode].every(
      (n) => typeof n === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(n),
    ) ||
    !shape(policy, [
      'origin',
      'image',
      'spacesEnabled',
      'staticDirectory',
      'consequencesVersion',
    ]) ||
    policy.origin !== value.source.recovery.origin ||
    policy.image !== value.source.recovery.image ||
    typeof policy.staticDirectory !== 'string' ||
    policy.staticDirectory.includes('\0') ||
    Buffer.byteLength(policy.staticDirectory) > 4096 ||
    !isAbsolute(policy.staticDirectory) ||
    resolve(policy.staticDirectory) !== policy.staticDirectory ||
    typeof policy.spacesEnabled !== 'boolean' ||
    policy.consequencesVersion !== 1
  )
    return false;
  return Buffer.byteLength(JSON.stringify(value)) <= MAX_INTENT_BYTES;
}

function canonical(value: unknown): string {
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

/** Stable identity across serialization order. Hash equality never grants fresh
 * authority: expired retries may only inspect the already-recorded outcome.
 */
export function restoreIntentHash(intent: RestoreJobIntent): string {
  if (!validRestoreJobIntent(intent)) throw new Error('Invalid restore job intent.');
  return createHash('sha256').update(canonical(intent)).digest('hex');
}
