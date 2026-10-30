/** Safe Admin restore DTOs. No source paths, secret keys or private authority. */
export const RESTORE_RESOURCE_MESSAGES = {
  'memory-headroom':
    'Recovery verification has insufficient memory headroom. Free memory or use a larger recovery host, then retry.',
  'memory-limit':
    'Recovery verification exceeded its memory limit. Use a recovery host with a larger verification budget.',
  'time-limit':
    'Recovery verification exceeded its time limit. Use a recovery host with a larger verification budget.',
  'archive-size':
    'The backup exceeds the encrypted archive size limit. Keep the source backup and use a larger recovery budget.',
  'database-size':
    'The restored database exceeds the recovery size limit. Keep the source backup and use a larger recovery budget.',
  'disk-space':
    'Recovery has insufficient disk space. Free space on the private backup, application or recovery volume, then retry.',
} as const;

export interface RestoreResources {
  provisional: true;
  checkedAt: number;
  requiredAdditionalBytes: number;
  availableBytes: number;
  sufficient: boolean;
  filesystems: Array<{
    purposes: Array<'application' | 'recovery' | 'preparation'>;
    requiredAdditionalBytes: number;
    availableBytes: number;
    sufficient: boolean;
  }>;
}

export function validRestoreResources(value: unknown): value is RestoreResources {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as RestoreResources;
  const bytes = (size: unknown) => Number.isSafeInteger(size) && Number(size) >= 0;
  if (
    Object.keys(report).length !== 6 ||
    report.provisional !== true ||
    !bytes(report.checkedAt) ||
    report.checkedAt > 8.64e15 ||
    !bytes(report.requiredAdditionalBytes) ||
    !bytes(report.availableBytes) ||
    typeof report.sufficient !== 'boolean' ||
    !Array.isArray(report.filesystems) ||
    report.filesystems.length < 1 ||
    report.filesystems.length > 2
  )
    return false;
  const purposes: string[] = [];
  let required = 0,
    available = 0;
  for (const filesystem of report.filesystems) {
    if (
      !filesystem ||
      typeof filesystem !== 'object' ||
      Array.isArray(filesystem) ||
      Object.keys(filesystem).length !== 4 ||
      !Array.isArray(filesystem.purposes) ||
      filesystem.purposes.length < 1 ||
      filesystem.purposes.length > 3 ||
      !filesystem.purposes.every((purpose) =>
        ['application', 'recovery', 'preparation'].includes(purpose),
      ) ||
      !bytes(filesystem.requiredAdditionalBytes) ||
      !bytes(filesystem.availableBytes) ||
      filesystem.sufficient !== filesystem.availableBytes >= filesystem.requiredAdditionalBytes
    )
      return false;
    purposes.push(...filesystem.purposes);
    required += filesystem.requiredAdditionalBytes;
    available += filesystem.availableBytes;
  }
  return (
    purposes.length === 3 &&
    new Set(purposes).size === 3 &&
    Number.isSafeInteger(required) &&
    Number.isSafeInteger(available) &&
    required === report.requiredAdditionalBytes &&
    available === report.availableBytes &&
    report.sufficient === report.filesystems.every((filesystem) => filesystem.sufficient)
  );
}

export interface RestoreVerification {
  applicationCompatible: true;
  sourceCompatible: true;
  databaseVerified: true;
  tables: number;
  rows: number;
  snapshots: number;
  images: number;
}

export function validRestoreVerification(value: unknown): value is RestoreVerification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as RestoreVerification;
  return (
    Object.keys(report).length === 7 &&
    report.applicationCompatible === true &&
    report.sourceCompatible === true &&
    report.databaseVerified === true &&
    (['tables', 'rows', 'snapshots', 'images'] as const).every(
      (key) => Number.isSafeInteger(report[key]) && report[key] >= 0,
    )
  );
}

export interface RestorePreview {
  provisional: true;
  currentAccounts: number;
  currentPasskeys: number;
  sharingRemoved: number;
  sharingDowngraded: number;
  isolatedItems: number;
  isolatedGroups: number;
  detachedRoots: number;
  heldTrashBatches: number;
}

export function validRestorePreview(value: unknown): value is RestorePreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const counts = [
    'currentAccounts',
    'currentPasskeys',
    'sharingRemoved',
    'sharingDowngraded',
    'isolatedItems',
    'isolatedGroups',
    'detachedRoots',
    'heldTrashBatches',
  ];
  return (
    record.provisional === true &&
    Object.keys(record).length === counts.length + 1 &&
    counts.every((key) => Number.isSafeInteger(record[key]) && Number(record[key]) >= 0)
  );
}

export const RESTORE_CONSEQUENCES_VERSION = 1;
export const RESTORE_CONSEQUENCES = [
  'Newer work, including work accepted before maintenance drains, will be lost.',
  'Sharing may be removed or downgraded, including access to unchanged siblings.',
  'All personal filing will be removed.',
  'Everyone will be signed out. Guest access and other retained capabilities will be revoked.',
  'Archive-only ownership will be isolated and affected deleted work held for recovery.',
  'Current accounts, passkeys and account status remain authoritative; current access is not guaranteed.',
  'A retained backup remains historical evidence and is not a new backup.',
] as const;

export interface RestorePreparation {
  id: string;
  state:
    | 'uploading'
    | 'preparing'
    | 'ready'
    | 'admitting'
    | 'accepted'
    | 'started'
    | 'cancelled'
    | 'expired'
    | 'failed';
  source: 'upload' | 'catalog';
  createdAt: number;
  expiresAt: number;
  bytes: number | null;
  sourceSha256: string | null;
  sourceCreatedAt: string | null;
  target: { generationId: string; epoch: string };
  preview: RestorePreview | null;
  verification: RestoreVerification | null;
  resources: RestoreResources | null;
  confirmation: string | null;
  consequencesVersion: 1;
  error: string | null;
}

/** Historical outcome only: not a claim about the workspace's current contents. */
export interface RestoreOutcome {
  id: string;
  state: 'backup-restored' | 'original-recovered' | 'did-not-start' | 'unresolved';
  updatedAt: number;
  source: { bytes: number; sha256: string };
}

export interface RestoreStatus {
  available: boolean;
  job: RestorePreparation | null;
  outcome: RestoreOutcome | null;
  /** Null means supervision is unavailable, not that no restore is pending. */
  pending: boolean | null;
}

export function validRestoreOutcome(value: unknown): value is RestoreOutcome {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as RestoreOutcome;
  return (
    Object.keys(record).length === 4 &&
    typeof record.id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.id) &&
    ['backup-restored', 'original-recovered', 'did-not-start', 'unresolved'].includes(
      record.state,
    ) &&
    Number.isSafeInteger(record.updatedAt) &&
    record.updatedAt >= 0 &&
    record.updatedAt <= 8.64e15 &&
    !!record.source &&
    typeof record.source === 'object' &&
    !Array.isArray(record.source) &&
    Object.keys(record.source).length === 2 &&
    Number.isSafeInteger(record.source.bytes) &&
    record.source.bytes > 0 &&
    typeof record.source.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(record.source.sha256)
  );
}
