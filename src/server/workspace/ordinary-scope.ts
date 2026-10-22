import type { DatabaseSync } from '../../../server/database.ts';
import { ITEM_KINDS } from '../../shared/workspace.ts';
import type { ItemKind } from '../../shared/workspace.ts';

interface OrdinaryRow {
  id: string;
  owner_id: string;
  parent_id: string | null;
  kind: string;
  space_id?: string | null;
  space_position?: number | null;
}

// Refuse excessive work rather than truncating an ancestry into a valid item.
// Shared by an entire batch, not renewed for every leaf. This is a request-work
// budget, not a product nesting limit.
const MAX_ANCESTOR_READS = 10_000;

/**
 * Structural boundary for ordinary file APIs, including raw SQL callers.
 * It grants no access and deliberately leaves live/trash policy to its caller.
 * SELECT * also supports existing databases before the Space migration: absent
 * nullable membership columns have the same meaning as legacy null values.
 * Undefined means the whole batch exceeded its work budget; never publish a
 * partial result. The cache lasts only for this call and cannot retain a grant.
 */
export function classifyOrdinaryItems(
  database: DatabaseSync,
  ids: readonly string[],
): Set<string> | undefined {
  if (ids.length > MAX_ANCESTOR_READS) return undefined;
  const lookup = database.prepare('SELECT * FROM workspace_items WHERE id=?');
  const rows = new Map<string, OrdinaryRow | undefined>();
  const ordinary = new Map<string, boolean>();
  for (const id of ids) {
    let cursor = id;
    const path: OrdinaryRow[] = [];
    const seen = new Set<string>();
    while (!ordinary.has(cursor)) {
      if (seen.has(cursor)) {
        ordinary.set(cursor, false);
        break;
      }
      if (!rows.has(cursor)) {
        // No partially classified batch can escape when the shared budget ends.
        if (rows.size === MAX_ANCESTOR_READS) return undefined;
        rows.set(cursor, lookup.get(cursor) as unknown as OrdinaryRow | undefined);
      }
      const row = rows.get(cursor);
      if (
        !row ||
        !ITEM_KINDS.includes(row.kind as ItemKind) ||
        (row.space_id ?? null) !== null ||
        (row.space_position ?? null) !== null ||
        (row.parent_id !== null && typeof row.parent_id !== 'string')
      ) {
        ordinary.set(cursor, false);
        break;
      }
      path.push(row);
      seen.add(cursor);
      if (row.parent_id === null) {
        ordinary.set(cursor, true);
        break;
      }
      cursor = row.parent_id;
    }
    for (let index = path.length - 1; index >= 0; index--) {
      const row = path[index];
      if (ordinary.has(row.id)) continue;
      const parent = rows.get(row.parent_id!);
      ordinary.set(
        row.id,
        Boolean(
          parent &&
          ordinary.get(parent.id) &&
          parent.kind === 'folder' &&
          parent.owner_id === row.owner_id,
        ),
      );
    }
  }
  return new Set(ids.filter((id) => ordinary.get(id)));
}

/** A fresh one-item check; a budget refusal never admits an incomplete ancestry. */
export function isOrdinaryItem(database: DatabaseSync, id: string): boolean {
  return classifyOrdinaryItems(database, [id])?.has(id) ?? false;
}
