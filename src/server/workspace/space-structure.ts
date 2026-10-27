import type { DatabaseSync } from '../../../server/database.ts';
import { ITEM_KINDS } from '../../shared/workspace.ts';
import type { ItemKind } from '../../shared/workspace.ts';
import { AuthError } from '../auth/store.ts';
import type { SpaceScopeItem } from './space-scope.ts';

// One refusal budget includes live members, tombstones and recovery metadata.
// It is not a presentation depth limit or permission to truncate a valid tree.
export const MAX_SPACE_ITEMS = 10_000;

export interface SpaceStructureItem extends SpaceScopeItem {
  readonly kind: ItemKind;
  readonly parentId: string;
  readonly spaceId: string;
  readonly position: number;
  readonly trashedAt: number | null;
  readonly trashBatch: string | null;
}

export interface SpaceRecoveryRecord {
  readonly itemId: string;
  readonly spaceId: string;
  readonly originalParentId: string;
  readonly originalPosition: number;
  readonly trashedAt: number;
  readonly trashedBy: string;
  readonly trashBatch: string;
}

export interface SpaceStructure {
  /** All members in depth-first sibling order, including detached recovery roots. */
  readonly items: SpaceStructureItem[];
  readonly byId: Map<string, SpaceStructureItem>;
  readonly children: Map<string, SpaceStructureItem[]>;
  readonly recovery: Map<string, SpaceRecoveryRecord>;
}

interface MemberRow extends SpaceStructureItem {
  ownerId: string;
}

const unavailable = () => new AuthError(404, 'This Space is not available.');
const overBudget = () => new AuthError(413, 'This Space is too large to process in one request.');
const position = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Internal structural validation, not authorization. The caller must authorize
 * the live Space, its owner's explicit outer recovery action, or a system
 * expiry candidate first. Keep this read and subsequent writes in the same
 * AuthStore transaction.
 * Never expose this all-status result through an ordinary/live collection.
 */
export function readSpaceStructure(
  database: DatabaseSync,
  spaceId: string,
  ownerId: string,
): SpaceStructure {
  const rows = database
    .prepare(
      `
    SELECT id,owner_id AS ownerId,parent_id AS parentId,space_id AS spaceId,
      space_position AS position,kind,name,created_at AS createdAt,updated_at AS updatedAt,
      trashed_at AS trashedAt,trash_batch AS trashBatch
    FROM workspace_items WHERE space_id=? LIMIT ?
  `,
    )
    .all(spaceId, MAX_SPACE_ITEMS + 1) as unknown as MemberRow[];
  if (rows.length > MAX_SPACE_ITEMS) throw overBudget();
  const byId = new Map<string, SpaceStructureItem>();
  const children = new Map<string, SpaceStructureItem[]>();
  for (const row of rows) {
    if (
      row.ownerId !== ownerId ||
      row.spaceId !== spaceId ||
      row.id === spaceId ||
      !ITEM_KINDS.includes(row.kind) ||
      typeof row.parentId !== 'string' ||
      !position(row.position) ||
      (row.trashedAt === null
        ? row.trashBatch !== null
        : !position(row.trashedAt) || typeof row.trashBatch !== 'string' || !row.trashBatch)
    )
      throw unavailable();
    const { ownerId: _owner, ...item } = row;
    byId.set(item.id, item);
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  // Each indexed parent lookup examines its own children, never the whole
  // workspace. All matching members are in the bounded set above; any foreign
  // attachment stops the request at the first unexpected row. Include tombstone
  // parents so corruption cannot hide beneath a deleted node.
  const attachment = database.prepare(`
    SELECT 1 FROM workspace_items WHERE parent_id=?
      AND (space_id IS NOT ? OR owner_id<>?) LIMIT 1
  `);
  const foreignRecovery = database.prepare(`
    SELECT 1 FROM workspace_space_trash WHERE item_id=? AND space_id<>?
  `);
  for (const parentId of [spaceId, ...byId.keys()]) {
    if (attachment.get(parentId, spaceId, ownerId)) throw unavailable();
    // A record scoped elsewhere must not disappear unseen through item_id's
    // deletion cascade, including a spurious record attached to the Space root.
    if (foreignRecovery.get(parentId, spaceId)) throw unavailable();
  }

  const records = database
    .prepare(
      `
    SELECT item_id AS itemId,space_id AS spaceId,original_parent_id AS originalParentId,
      original_position AS originalPosition,trashed_at AS trashedAt,
      trashed_by AS trashedBy,trash_batch AS trashBatch
    FROM workspace_space_trash WHERE space_id=? LIMIT ?
  `,
    )
    .all(spaceId, MAX_SPACE_ITEMS + 1) as unknown as SpaceRecoveryRecord[];
  if (records.length > MAX_SPACE_ITEMS) throw overBudget();
  const recovery = new Map<string, SpaceRecoveryRecord>();
  const batches = new Set<string>();
  for (const record of records) {
    const root = byId.get(record.itemId);
    if (
      record.spaceId !== spaceId ||
      !root ||
      root.parentId !== spaceId ||
      root.trashedAt === null ||
      root.trashedAt !== record.trashedAt ||
      root.trashBatch !== record.trashBatch ||
      batches.has(record.trashBatch) ||
      typeof record.originalParentId !== 'string' ||
      !record.originalParentId ||
      !position(record.originalPosition) ||
      typeof record.trashedBy !== 'string' ||
      !record.trashedBy ||
      recovery.has(record.itemId)
    )
      throw unavailable();
    recovery.set(record.itemId, record);
    batches.add(record.trashBatch);
  }
  for (const item of byId.values()) {
    if (item.parentId === spaceId) {
      if ((item.trashedAt !== null) !== recovery.has(item.id)) throw unavailable();
      continue;
    }
    const parent = byId.get(item.parentId);
    if (
      !parent ||
      recovery.has(item.id) ||
      item.trashBatch !== parent.trashBatch ||
      item.trashedAt !== parent.trashedAt
    )
      throw unavailable();
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const items: SpaceStructureItem[] = [];
  const pending = [...(children.get(spaceId) ?? [])].reverse();
  const visited = new Set<string>();
  while (pending.length) {
    const item = pending.pop()!;
    if (visited.has(item.id)) throw unavailable();
    visited.add(item.id);
    items.push(item);
    const nested = children.get(item.id) ?? [];
    for (let index = nested.length - 1; index >= 0; index--) pending.push(nested[index]);
  }
  if (items.length !== rows.length) throw unavailable();
  return { items, byId, children, recovery };
}

/** Delete a complete validated subtree in reverse DFS order, in its read transaction.
 * Identity guards and restrictive FKs keep both manual and scheduled purges atomic.
 */
export function deleteSpaceItems(
  database: DatabaseSync,
  spaceId: string,
  ownerId: string,
  items: readonly SpaceStructureItem[],
) {
  const remove = database.prepare(`DELETE FROM workspace_items
    WHERE id=? AND space_id=? AND owner_id=? AND trash_batch IS ? AND trashed_at IS ?
      AND NOT EXISTS(SELECT 1 FROM workspace_items child WHERE child.parent_id=workspace_items.id)`);
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (remove.run(item.id, spaceId, ownerId, item.trashBatch, item.trashedAt).changes !== 1)
      throw unavailable();
  }
}
