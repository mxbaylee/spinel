import { validIdentityIcon } from '../../shared/appearance.ts';
import { AuthError } from '../auth/store.ts';
import type { DatabaseSync } from '../../../server/database.ts';
import { emptyAppearance } from '../../shared/appearance.ts';
import type { ItemAppearance } from '../../shared/appearance.ts';
export function appearanceSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS item_appearance (
    item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, value TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS cover_assets (
    item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
    id TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(item_id,id)
  ) STRICT;`);
}
/** Call only after the caller has established exact item/root access. */
export function readAppearance(db: DatabaseSync, id: string): ItemAppearance {
  const row = db.prepare('SELECT value,revision FROM item_appearance WHERE item_id=?').get(id) as
    { value: string; revision: number } | undefined;
  return row ? { ...JSON.parse(row.value), revision: row.revision } : emptyAppearance();
}

/** Creation calls this inside the same transaction as the new item. */
export function initialIcon(db: DatabaseSync, id: string, icon: unknown) {
  if (icon === undefined || icon === null) return;
  if (!validIdentityIcon(icon)) throw new AuthError(400, 'Choose an icon or one emoji.');
  db.prepare('INSERT INTO item_appearance(item_id,revision,value) VALUES(?,1,?)').run(
    id,
    JSON.stringify({ ...emptyAppearance(), revision: 1, icon }),
  );
}
