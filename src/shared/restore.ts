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
