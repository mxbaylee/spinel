import type { DatabaseSync } from '../../../server/database.ts';

// These identities outlive both their documents and generation purge. An empty
// table changes no ordinary behavior; only supervised recovery populates it.
export const restoreFenceSchema = `CREATE TABLE IF NOT EXISTS spinel_restore_fences (
  kind TEXT NOT NULL CHECK(kind IN ('identity','request')),
  id TEXT NOT NULL,
  PRIMARY KEY(kind,id)
) STRICT;`;

export function restoreFenced(db: DatabaseSync, kind: 'identity' | 'request', id: string) {
  return Boolean(
    db.prepare('SELECT 1 FROM spinel_restore_fences WHERE kind=? AND id=?').get(kind, id),
  );
}
