import type { DatabaseSync } from '../../../server/database.ts';

export function recoveryHoldSchema(db: DatabaseSync) {
  // A deletion batch can span components/owners after supervised recovery.
  // Never attach this hold to just one account, root or recipient.
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_recovery_holds (
    batch TEXT PRIMARY KEY
  ) STRICT;
  CREATE INDEX IF NOT EXISTS workspace_items_recovery_batch
    ON workspace_items(trash_batch) WHERE trashed_at IS NOT NULL`);
}

// UNION terminates even for malformed cycles. Callers still validate complete
// authorized trees; this identifies retention protection, never access rights.
export const recoveryHoldAncestorsSql = `WITH RECURSIVE recovery_hold_ancestors(id,parent_id) AS (
  SELECT i.id,i.parent_id FROM workspace_recovery_holds h JOIN workspace_items i
    ON i.trash_batch=h.batch WHERE i.trashed_at IS NOT NULL
  UNION
  SELECT p.id,p.parent_id FROM workspace_items p JOIN recovery_hold_ancestors c ON p.id=c.parent_id
)`;

/** Resolve a whole listing in one query rather than rewalking every subtree. */
export function recoveryProtectedItems(db: DatabaseSync, ids: readonly string[]) {
  if (!ids.length) return new Set<string>();
  if (ids.length > 10_001) throw new Error('Recovery hold listing exceeds its item budget.');
  return new Set(
    db
      .prepare(
        `${recoveryHoldAncestorsSql} SELECT id FROM recovery_hold_ancestors
    WHERE id IN (${ids.map(() => '?').join(',')})`,
      )
      .all(...ids)
      .map((row) => String(row.id)),
  );
}

export function recoveryProtected(db: DatabaseSync, id: string) {
  return recoveryProtectedItems(db, [id]).has(id);
}

export function recoveryHeld(db: DatabaseSync, batch: string | null | undefined): boolean {
  return Boolean(
    batch && db.prepare('SELECT 1 FROM workspace_recovery_holds WHERE batch=?').get(batch),
  );
}

function hasSpaceRecovery(db: DatabaseSync) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='workspace_space_trash'")
      .get(),
  );
}

/** Internal supervised-restore preparation only; never an ordinary user mutation.
 * Caller validates the complete archived graph before preserving its trash.
 */
export function holdRestoredTrash(db: DatabaseSync) {
  db.exec(`INSERT OR IGNORE INTO workspace_recovery_holds
    SELECT DISTINCT trash_batch FROM workspace_items WHERE trashed_at IS NOT NULL AND trash_batch IS NOT NULL
    ${hasSpaceRecovery(db) ? 'UNION SELECT trash_batch FROM workspace_space_trash' : ''}`);
}

/** Call inside the explicit restore/deletion transaction. Transferring ownership
 * does not release a hold; partial batch restoration must preserve the remainder.
 */
export function cleanRecoveryHolds(db: DatabaseSync) {
  db.exec(`DELETE FROM workspace_recovery_holds
    WHERE NOT EXISTS(SELECT 1 FROM workspace_items i
      WHERE i.trash_batch=workspace_recovery_holds.batch AND i.trashed_at IS NOT NULL)
    ${hasSpaceRecovery(db) ? 'AND NOT EXISTS(SELECT 1 FROM workspace_space_trash r WHERE r.trash_batch=workspace_recovery_holds.batch)' : ''}`);
}
