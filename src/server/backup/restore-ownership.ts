import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import type { DatabaseSync } from '../../../server/database.ts';
import { readSpaceStructure } from '../workspace/space-structure.ts';
import { holdRestoredTrash } from '../workspace/recovery-holds.ts';
import { readRestoreRows, requireCompatibleRestoreSchema } from './restore-credentials.ts';

const refused = () => new Error('This backup needs compatible ownership reconciliation.');
type Item = {
  id: string;
  owner_id: string;
  parent_id: string | null;
  kind: string;
  space_id: string | null;
  space_position: number | null;
  trashed_at: number | null;
  trash_batch: string | null;
};
const columns = [
  'id',
  'owner_id',
  'parent_id',
  'kind',
  'space_id',
  'space_position',
  'trashed_at',
  'trash_batch',
  // readSpaceStructure also materializes these fields; bound them up front.
  'name',
  'created_at',
  'updated_at',
];
function items(db: DatabaseSync) {
  return new Map(
    (readRestoreRows(db, 'workspace_items', 10_000, columns) as unknown as Item[]).map((item) => [
      item.id,
      item,
    ]),
  );
}

function validateTree(db: DatabaseSync, rows: Map<string, Item>) {
  const visited = new Set<string>();
  // A foreign-key-valid record may still point at an ordinary document. Every
  // recovery record must be covered by the complete Space validation below.
  for (const record of readRestoreRows(db, 'workspace_space_trash', 10_000)) {
    const item = rows.get(String(record.item_id)),
      root = rows.get(String(record.space_id));
    if (
      !item ||
      !root ||
      root.kind !== 'space' ||
      root.space_id !== null ||
      item.space_id !== root.id
    )
      throw refused();
  }
  for (const item of rows.values()) {
    if (
      !['doc', 'sheet', 'folder', 'space'].includes(item.kind) ||
      (item.trashed_at === null) !== (item.trash_batch === null) ||
      (item.trashed_at !== null &&
        (!Number.isSafeInteger(item.trashed_at) ||
          item.trashed_at < 0 ||
          typeof item.trash_batch !== 'string' ||
          !item.trash_batch.length))
    )
      throw refused();
    if (item.space_id !== null) {
      const root = rows.get(item.space_id);
      if (
        !root ||
        root.kind !== 'space' ||
        root.space_id !== null ||
        root.owner_id !== item.owner_id
      )
        throw refused();
      continue; // The complete internal graph and recovery records are checked at its root.
    }
    if (item.space_position !== null) throw refused();
    const path: string[] = [],
      seen = new Set<string>();
    let cursor: Item | undefined = item;
    while (cursor && !visited.has(cursor.id)) {
      if (seen.has(cursor.id)) throw refused();
      seen.add(cursor.id);
      path.push(cursor.id);
      if (cursor.parent_id === null) break;
      const parent = rows.get(cursor.parent_id);
      if (
        !parent ||
        parent.kind !== 'folder' ||
        parent.space_id !== null ||
        parent.owner_id !== cursor.owner_id
      )
        throw refused();
      cursor = parent;
    }
    for (const id of path) visited.add(id);
    if (item.kind === 'space') readSpaceStructure(db, item.id, item.owner_id);
  }
}

/** One preparation step on a fresh disposable candidate after credential overlay.
 * On uncertain completion, the controller must rebuild its working copy from
 * immutable verified input rather than repeat identity allocation on this copy.
 * Current ownership is authority; an archive-only component is retained without
 * assigning it to a current person. Sharing/native fencing still follow this step.
 */
export function reconcileRestoreOwnership(current: DatabaseSync, candidate: DatabaseSync) {
  const sourceFile = statSync(current.path, { bigint: true }),
    targetFile = statSync(candidate.path, { bigint: true });
  if (sourceFile.dev === targetFile.dev && sourceFile.ino === targetFile.ino) throw refused();
  requireCompatibleRestoreSchema(current, candidate);
  const before = items(current),
    archived = items(candidate);
  validateTree(current, before);
  validateTree(candidate, archived);
  const users = readRestoreRows(candidate, 'auth_users', 1024, ['id', 'disabled', 'is_admin']);
  const accounts = new Map(users.map((user) => [String(user.id), user]));
  const finalOwners = new Map<string, string>();
  const parents = new Map<string, string | null>();
  let currentItems = 0,
    detachedRoots = 0;
  for (const item of archived.values()) {
    const known = before.get(item.id);
    if (known) {
      const owner = accounts.get(known.owner_id);
      const currentOwner = current
        .prepare('SELECT is_admin,disabled FROM auth_users WHERE id=?')
        .get(known.owner_id);
      if (
        known.kind !== item.kind ||
        known.space_id !== item.space_id ||
        !owner ||
        !currentOwner ||
        currentOwner.is_admin !== 0 ||
        owner.is_admin !== 0 ||
        owner.disabled !== currentOwner.disabled
      )
        throw refused();
      finalOwners.set(item.id, known.owner_id);
      currentItems++;
    }
    if (item.space_id !== null) {
      if (before.has(item.id) !== before.has(item.space_id)) throw refused();
    }
    let parent = item.parent_id;
    if (item.space_id === null && parent !== null) {
      const knownParent = before.get(parent);
      if (
        Boolean(known) !== Boolean(knownParent) ||
        (known && knownParent && known.owner_id !== knownParent.owner_id)
      ) {
        parent = null;
        detachedRoots++;
      }
    }
    parents.set(item.id, parent);
  }
  const children = new Map<string, string[]>();
  for (const [id, parent] of parents)
    if (parent !== null) {
      const siblings = children.get(parent) ?? [];
      siblings.push(id);
      children.set(parent, siblings);
    }
  const groups: { owner: string; ids: string[] }[] = [];
  for (const item of archived.values()) {
    if (before.has(item.id) || parents.get(item.id) !== null) continue;
    if (users.length + groups.length >= 1024) throw refused();
    const owner = randomUUID(),
      ids: string[] = [],
      pending = [item.id];
    // Never overwrite an existing account even on an identity collision.
    if (
      accounts.has(owner) ||
      current.prepare('SELECT 1 FROM auth_users WHERE id=?').get(owner) ||
      groups.some((group) => group.owner === owner)
    )
      throw refused();
    while (pending.length) {
      const id = pending.pop()!;
      if (before.has(id) || finalOwners.has(id)) throw refused();
      finalOwners.set(id, owner);
      ids.push(id);
      if (ids.length > 9999) throw refused(); // Admin handover adds one containing folder.
      pending.push(...(children.get(id) ?? []));
    }
    groups.push({ owner, ids });
  }
  if (finalOwners.size !== archived.size || users.length + groups.length > 1024) throw refused();
  candidate.exec('BEGIN IMMEDIATE');
  try {
    const create = candidate.prepare(
      'INSERT INTO auth_users(id,name,is_admin,disabled) VALUES(?,?,0,1)',
    );
    const revoke = candidate.prepare('DELETE FROM workspace_grants WHERE item_id=?');
    const placements = candidate.prepare(
      'DELETE FROM workspace_placements WHERE item_id=? OR parent_id=?',
    );
    const guests = candidate.prepare('DELETE FROM workspace_guest_sessions WHERE item_id=?');
    const links = candidate.prepare(
      "UPDATE workspace_links SET state='off',token_hash=NULL,preview_hash=NULL,enabled_at=NULL,expires_at=NULL WHERE item_id=?",
    );
    for (const [index, group] of groups.entries()) {
      create.run(group.owner, `Recovered files ${index + 1}`);
      for (const id of group.ids) {
        revoke.run(id);
        placements.run(id, id);
        guests.run(id);
        links.run(id);
      }
    }
    const update = candidate.prepare(
      'UPDATE workspace_items SET owner_id=?,parent_id=? WHERE id=?',
    );
    for (const item of archived.values())
      update.run(finalOwners.get(item.id)!, parents.get(item.id)!, item.id);
    validateTree(candidate, items(candidate));
    for (const row of candidate.iterate('PRAGMA foreign_key_check')) if (row) throw refused();
    // Every restored deletion identity survives until an authorized explicit
    // recovery/deletion, including known-owner trash and split batches.
    holdRestoredTrash(candidate);
    const heldTrashBatches = Number(
      candidate.prepare('SELECT count(*) AS n FROM workspace_recovery_holds').get()!.n,
    );
    candidate.exec('COMMIT');
    return {
      currentItems,
      isolatedItems: archived.size - currentItems,
      isolatedGroups: groups.length,
      detachedRoots,
      heldTrashBatches,
    };
  } catch (error) {
    candidate.exec('ROLLBACK');
    throw error;
  }
}
