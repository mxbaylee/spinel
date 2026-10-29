/** Safe Admin restore DTOs. No source paths, secret keys or private authority. */
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
