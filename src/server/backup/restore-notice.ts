import type { DatabaseSync } from '../../../server/database.ts';
import { RESTORE_NOTICE_MS, validRestoreNotice } from '../../shared/restore.ts';
import type { RestoreNotice } from '../../shared/restore.ts';

/** Reconciliation stamps the outcome into the metadata of the copy it activates:
 * `restored` for a backup, `recovered` for original-content rollback. The rest of
 * that row (origin, image, runtime environment) never leaves this module. */
export function markRestoreOutcome(
  candidate: DatabaseSync,
  outcome: RestoreNotice['outcome'],
  now: number,
) {
  const row = candidate.prepare('SELECT metadata FROM spinel_recovery WHERE id=1').get();
  const metadata: unknown = JSON.parse(String(row?.metadata));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new Error('Restore metadata is unavailable.');
  candidate
    .prepare('UPDATE spinel_recovery SET metadata=? WHERE id=1')
    .run(JSON.stringify({ ...metadata, restoreOutcome: { outcome, at: now } }));
}

/** The latest restore outcome, for 30 days. A database that was never restored,
 * or whose metadata is unreadable, has no notice rather than an error. */
export function restoreNotice(db: DatabaseSync, now: number): RestoreNotice | null {
  try {
    if (
      !db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='spinel_recovery'").get()
    )
      return null;
    const row = db.prepare('SELECT metadata FROM spinel_recovery WHERE id=1').get();
    const metadata = JSON.parse(String(row?.metadata ?? 'null')) as {
      restoreOutcome?: { outcome?: unknown; at?: unknown };
      createdAt?: unknown;
    } | null;
    const { outcome, at } = metadata?.restoreOutcome ?? {};
    const notice =
      outcome === 'restored'
        ? { outcome, at, backupCreatedAt: metadata?.createdAt }
        : { outcome, at };
    return validRestoreNotice(notice) && notice.at <= now && now - notice.at < RESTORE_NOTICE_MS
      ? notice
      : null;
  } catch {
    return null;
  }
}
