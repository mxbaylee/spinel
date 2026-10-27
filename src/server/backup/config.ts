import { isAbsolute, resolve } from 'node:path';
import { privateFile } from './archive.ts';

export interface RecoveryConfig {
  prefix: string;
  keyFile: string;
  runtimeEnvironmentFile: string;
  keyId?: string;
  retainedKeyFiles?: Record<string, string>;
  backupHourUtc?: number;
  verificationDayUtc?: number;
  verificationHourUtc?: number;
}
export interface SpacesConfig extends RecoveryConfig {
  // Omission retains the original DigitalOcean configuration format.
  type?: 'spaces';
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}
export interface FilesystemConfig extends RecoveryConfig {
  type: 'filesystem';
  root: string;
  rootDevice: string;
  rootInode: string;
}
export type BackupConfig = SpacesConfig | FilesystemConfig;

const identifier = /^[a-zA-Z0-9_-]{1,80}$/;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
function optionalInteger(value: unknown, maximum: number) {
  return (
    value === undefined ||
    (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum)
  );
}

export async function loadConfig(path: string): Promise<BackupConfig> {
  const value: unknown = JSON.parse((await privateFile(path)).toString());
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid backup configuration.');
  const c = value as Record<string, unknown>;
  if (
    typeof c.prefix !== 'string' ||
    !identifier.test(c.prefix) ||
    !nonempty(c.keyFile) ||
    !nonempty(c.runtimeEnvironmentFile) ||
    (c.keyId !== undefined && (typeof c.keyId !== 'string' || !identifier.test(c.keyId))) ||
    !optionalInteger(c.backupHourUtc, 23) ||
    !optionalInteger(c.verificationDayUtc, 6) ||
    !optionalInteger(c.verificationHourUtc, 23)
  )
    throw new Error('Invalid backup configuration.');
  if (
    c.retainedKeyFiles !== undefined &&
    (!c.retainedKeyFiles ||
      typeof c.retainedKeyFiles !== 'object' ||
      Array.isArray(c.retainedKeyFiles) ||
      Object.keys(c.retainedKeyFiles).length > 16 ||
      Object.entries(c.retainedKeyFiles).some(
        ([id, file]) => !identifier.test(id) || !nonempty(file),
      ))
  )
    throw new Error('Invalid retained recovery keys.');
  if (c.retainedKeyFiles && Object.hasOwn(c.retainedKeyFiles, String(c.keyId ?? 'default')))
    throw new Error('The active recovery key must not also be a retained key.');
  const shared = {
    prefix: c.prefix,
    keyFile: c.keyFile,
    runtimeEnvironmentFile: c.runtimeEnvironmentFile,
    keyId: (c.keyId as string | undefined) ?? 'default',
    retainedKeyFiles: c.retainedKeyFiles as Record<string, string> | undefined,
    backupHourUtc: (c.backupHourUtc as number | undefined) ?? 2,
    verificationDayUtc: (c.verificationDayUtc as number | undefined) ?? 0,
    verificationHourUtc: (c.verificationHourUtc as number | undefined) ?? 3,
  };
  if (c.type === 'filesystem') {
    if (
      typeof c.root !== 'string' ||
      !isAbsolute(c.root) ||
      c.root === '/' ||
      resolve(c.root) !== c.root ||
      typeof c.rootDevice !== 'string' ||
      !/^\d{1,30}$/.test(c.rootDevice) ||
      typeof c.rootInode !== 'string' ||
      !/^\d{1,30}$/.test(c.rootInode)
    )
      throw new Error('Invalid filesystem backup configuration.');
    return {
      ...shared,
      type: 'filesystem',
      root: c.root,
      rootDevice: c.rootDevice,
      rootInode: c.rootInode,
    };
  }
  if (
    (c.type !== undefined && c.type !== 'spaces') ||
    typeof c.region !== 'string' ||
    !/^[a-z]{3}[0-9]+$/.test(c.region) ||
    typeof c.bucket !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(c.bucket) ||
    !nonempty(c.accessKeyId) ||
    !nonempty(c.secretAccessKey)
  )
    throw new Error('Invalid Spaces backup configuration.');
  return {
    ...shared,
    type: 'spaces',
    region: c.region,
    bucket: c.bucket,
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
  };
}
