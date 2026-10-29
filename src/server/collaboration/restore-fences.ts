import type { DatabaseSync } from '../../../server/database.ts';

// Retired identities and the observed revision ceiling outlive documents/purge.
// Recovery populates identity fences; accepted writes also advance the clock.
export const restoreFenceSchema = `CREATE TABLE IF NOT EXISTS spinel_restore_fences (
  kind TEXT NOT NULL CHECK(kind IN ('identity','request')),
  id TEXT NOT NULL,
  PRIMARY KEY(kind,id)
) STRICT;
CREATE TABLE IF NOT EXISTS spinel_restore_revision (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991)
) STRICT;
INSERT OR IGNORE INTO spinel_restore_revision VALUES(1,0);`;

/** Write inside the transaction accepting/retiring the revision. Unlike native
 * rows, this ceiling has no document FK and survives every deletion and purge.
 * Standalone storage fixtures without the workspace generation schema omit it. */
export function retainRestoreRevision(db: DatabaseSync, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Invalid retained recovery revision.');
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='spinel_restore_revision'")
      .get()
  )
    return;
  db.prepare(
    'INSERT INTO spinel_restore_revision VALUES(1,?) ON CONFLICT(id) DO UPDATE SET revision=max(revision,excluded.revision)',
  ).run(revision);
}

/** Existing pre-feature heads may never receive another edit before deletion.
 * Capture their logical revision before FK cascades erase the active mapping.
 * Install only after all native and legacy content stores have been initialized. */
export function restoreRevisionDeletionSchema(db: DatabaseSync) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all()
      .map((row) => row.name),
  );
  if (
    ![
      'spinel_restore_revision',
      'workspace_items',
      'spinel_live_units',
      'spinel_sync_units',
      'doc_snapshots',
      'sheet_snapshots',
    ].every((table) => tables.has(table))
  )
    return;
  db.exec(`CREATE TRIGGER IF NOT EXISTS spinel_retain_deleted_revision BEFORE DELETE ON workspace_items
    BEGIN
      INSERT INTO spinel_restore_revision VALUES(1,max(
        coalesce((SELECT revision + coalesce((SELECT revision_offset FROM spinel_live_units WHERE item_id=OLD.id),0)
          FROM spinel_sync_units WHERE unit_id=coalesce((SELECT unit_id FROM spinel_live_units WHERE item_id=OLD.id),OLD.id)),0),
        coalesce((SELECT revision FROM doc_snapshots WHERE item_id=OLD.id),0),
        coalesce((SELECT revision FROM sheet_snapshots WHERE item_id=OLD.id),0)
      )) ON CONFLICT(id) DO UPDATE SET revision=max(revision,excluded.revision);
    END`);
}

export function restoreFenced(db: DatabaseSync, kind: 'identity' | 'request', id: string) {
  return Boolean(
    db.prepare('SELECT 1 FROM spinel_restore_fences WHERE kind=? AND id=?').get(kind, id),
  );
}
