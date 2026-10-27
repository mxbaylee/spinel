import { validIdentityIcon, validColor, normalizeAppearance } from '../../shared/appearance.ts';
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
  return row
    ? normalizeAppearance({ ...JSON.parse(row.value), revision: row.revision })
    : emptyAppearance();
}

/** Creation calls this inside the same transaction as the new item. */
export function initialIcon(db: DatabaseSync, id: string, icon: unknown, iconColor?: unknown) {
  if (iconColor != null && !validColor(iconColor))
    throw new AuthError(400, 'Choose an icon color.');
  if (icon != null && !validIdentityIcon(icon))
    throw new AuthError(400, 'Choose an icon or one emoji.');
  if (icon == null && iconColor == null) return;
  db.prepare('INSERT INTO item_appearance(item_id,revision,value) VALUES(?,1,?)').run(
    id,
    JSON.stringify({
      ...emptyAppearance(),
      revision: 1,
      icon: icon ?? null,
      iconColor: iconColor ?? null,
    }),
  );
}
/** Authorized catalogs batch metadata so deep lists keep their existing query budget. */
export function readAppearances(db: DatabaseSync, ids: readonly string[]) {
  const rows = db
    .prepare(
      'SELECT item_id,value,revision FROM item_appearance WHERE item_id IN (SELECT value FROM json_each(?))',
    )
    .all(JSON.stringify(ids)) as { item_id: string; value: string; revision: number }[];
  const result = new Map(ids.map((id) => [id, emptyAppearance()]));
  for (const row of rows)
    result.set(
      row.item_id,
      normalizeAppearance({ ...JSON.parse(row.value), revision: row.revision }),
    );
  return result;
}
