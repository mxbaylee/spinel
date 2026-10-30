import type { DatabaseSync } from '../../../server/database.ts';
import { RESTORE_NOTICE_MS, validRestoreNotice } from '../../shared/restore.ts';
import type { RestoreNotice } from '../../shared/restore.ts';

/** Forward reconciliation stamps the archived metadata it activates. The rest of
 * that row (origin, image, runtime environment) never leaves this function. */
export function markRestoredWorkspace(candidate: DatabaseSync, now: number) {
  const row = candidate.prepare('SELECT metadata FROM spinel_recovery WHERE id=1').get();
  const metadata: unknown = JSON.parse(String(row?.metadata));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new Error('Restore metadata is unavailable.');
  candidate
    .prepare('UPDATE spinel_recovery SET metadata=? WHERE id=1')
    .run(JSON.stringify({ ...metadata, restoredAt: now }));
}

/** The latest backup restore, for 30 days. A database that was never restored,
 * or whose metadata is unreadable, has no notice rather than an error. */
export function restoreNotice(db: DatabaseSync, now: number): RestoreNotice | null {
  try {
    if (
      !db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='spinel_recovery'").get()
    )
      return null;
    const row = db.prepare('SELECT metadata FROM spinel_recovery WHERE id=1').get();
    const metadata = JSON.parse(String(row?.metadata ?? 'null')) as {
      restoredAt?: unknown;
      createdAt?: unknown;
    } | null;
    const notice = { restoredAt: metadata?.restoredAt, backupCreatedAt: metadata?.createdAt };
    return validRestoreNotice(notice) &&
      notice.restoredAt <= now &&
      now - notice.restoredAt < RESTORE_NOTICE_MS
      ? notice
      : null;
  } catch {
    return null;
  }
}
