import { isAbsolute, resolve } from 'node:path';
import { privateFile } from './archive.ts';

export interface RecoveryConfig {
  version?: 1;
  dataset?: 'workspace';
  prefix: string;
  keyFile: string;
  runtimeEnvironmentFile: string;
  keyId?: string;
  retainedKeyFiles?: Record<string, string>;
  backupHourUtc?: number;
  verificationDayUtc?: number;
  verificationHourUtc?: number;
  automatic?: boolean;
  manualDownload?: boolean;
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
export interface ManualConfig extends RecoveryConfig {
  type: 'manual';
}
export type DestinationConfig = SpacesConfig | FilesystemConfig;
export type BackupConfig = DestinationConfig | ManualConfig;

export function hasDestination(config: BackupConfig): config is DestinationConfig {
  return config.type !== 'manual';
}

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
    (c.version !== undefined && c.version !== 1) ||
    (c.dataset !== undefined && c.dataset !== 'workspace') ||
    typeof c.prefix !== 'string' ||
    !identifier.test(c.prefix) ||
    !nonempty(c.keyFile) ||
    !nonempty(c.runtimeEnvironmentFile) ||
    (c.keyId !== undefined && (typeof c.keyId !== 'string' || !identifier.test(c.keyId))) ||
    !optionalInteger(c.backupHourUtc, 23) ||
    !optionalInteger(c.verificationDayUtc, 6) ||
    !optionalInteger(c.verificationHourUtc, 23) ||
    (c.automatic !== undefined && typeof c.automatic !== 'boolean') ||
    (c.manualDownload !== undefined && typeof c.manualDownload !== 'boolean')
  )
    throw new Error('Invalid backup configuration.');
  // New policy is deliberately closed: misspelled controls must not silently
  // enable jobs, select another dataset, or accept an arbitrary storage endpoint.
  const sharedKeys = [
    'version',
    'dataset',
    'type',
    'prefix',
    'keyFile',
    'runtimeEnvironmentFile',
    'keyId',
    'retainedKeyFiles',
    'backupHourUtc',
    'verificationDayUtc',
    'verificationHourUtc',
    'automatic',
    'manualDownload',
  ];
  const destinationKeys =
    c.type === 'filesystem'
      ? ['root', 'rootDevice', 'rootInode']
      : c.type === 'manual'
        ? []
        : ['region', 'bucket', 'accessKeyId', 'secretAccessKey'];
  if (
    ['endpoint', 'signingRegion', 'forcePathStyle', 'datasets', 'retention'].some((key) =>
      Object.hasOwn(c, key),
    ) ||
    ((c.version === 1 || c.type === 'manual') &&
      Object.keys(c).some((key) => !sharedKeys.includes(key) && !destinationKeys.includes(key)))
  )
    throw new Error('Unsupported backup policy or destination setting.');
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
    ...(c.version === 1 && { version: 1 as const }),
    dataset: 'workspace' as const,
    prefix: c.prefix,
    keyFile: c.keyFile,
    runtimeEnvironmentFile: c.runtimeEnvironmentFile,
    keyId: (c.keyId as string | undefined) ?? 'default',
    retainedKeyFiles: c.retainedKeyFiles as Record<string, string> | undefined,
    backupHourUtc: (c.backupHourUtc as number | undefined) ?? 2,
    verificationDayUtc: (c.verificationDayUtc as number | undefined) ?? 0,
    verificationHourUtc: (c.verificationHourUtc as number | undefined) ?? 3,
    // Existing installed destinations retain their schedule. New versioned
    // policy requires an explicit automatic opt-in.
    automatic: (c.automatic as boolean | undefined) ?? (c.version !== 1 && c.type !== 'manual'),
    manualDownload: (c.manualDownload as boolean | undefined) ?? true,
  };
  if (c.type === 'manual') {
    if (c.automatic === true) throw new Error('Manual backups cannot run automatically.');
    return { ...shared, type: 'manual', automatic: false };
  }
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
