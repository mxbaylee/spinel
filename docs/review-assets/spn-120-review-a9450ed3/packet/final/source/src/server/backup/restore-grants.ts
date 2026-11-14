import { statSync } from 'node:fs';
import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { resolveSpaceScope } from '../workspace/space-scope.ts';
import { readRestoreRows, requireCompatibleRestoreSchema } from './restore-credentials.ts';

const refused = () =>
  new Error('This backup needs compatible ownership and sharing reconciliation.');
const strength = { viewer: 1, editor: 2, admin: 3, owner: 4 } as const;
const roles = ['viewer', 'editor', 'admin'] as const;
type Item = {
  id: string;
  owner_id: string;
  parent_id: string | null;
  space_id: string | null;
  kind: string;
};
type Grant = { item_id: string; user_id: string; role: (typeof roles)[number]; shared_at: number };

function ancestryDepths(items: Map<string, Item>) {
  const depths = new Map<string, number>();
  for (const item of items.values()) {
    const path: string[] = [],
      seen = new Set<string>();
    let cursor: string | null = item.id;
    while (cursor !== null && !depths.has(cursor)) {
      if (seen.has(cursor)) throw refused();
      const row = items.get(cursor);
      if (!row) throw refused();
      seen.add(cursor);
      path.push(cursor);
      cursor = row.parent_id;
    }
    let depth = cursor === null ? 0 : depths.get(cursor)!;
    for (const id of path.reverse()) depths.set(id, ++depth);
  }
  return depths;
}

function access(workspace: WorkspaceStore, user: string, item: Item | undefined) {
  if (!item) return 0;
  try {
    // Use the application's actual ordinary/Space resolvers, including trash,
    // disabled owners, ignored member grants and inaccessible outer ancestry.
    const scope = item.space_id ?? (item.kind === 'space' ? item.id : null);
    const permission = scope
      ? resolveSpaceScope(workspace.auth, user, scope, item.id).access
      : workspace.accountAccess(user, item.id);
    return permission === null ? 0 : strength[permission];
  } catch (error) {
    if (error instanceof AuthError && [401, 403, 404].includes(error.status)) return 0;
    throw error;
  }
}

/** Internal reconciliation of frozen disposable copies, AFTER credential and
 * ownership reconciliation. Both stores must be initialized before this call.
 * This does not authorize cutover, certify ownership quarantine, or fence retries.
 * No archived grant or personal placement is an authority source.
 */
export function reconcileRestoreGrants(current: WorkspaceStore, candidate: WorkspaceStore) {
  const source = current.auth.database,
    target = candidate.auth.database;
  const sourceFile = statSync(source.path, { bigint: true });
  const targetFile = statSync(target.path, { bigint: true });
  if (sourceFile.dev === targetFile.dev && sourceFile.ino === targetFile.ino) throw refused();
  requireCompatibleRestoreSchema(source, target);
  const columns = ['id', 'owner_id', 'parent_id', 'space_id', 'kind'];
  const loadItems = (workspace: WorkspaceStore) =>
    new Map(
      (
        readRestoreRows(
          workspace.auth.database,
          'workspace_items',
          10_000,
          columns,
        ) as unknown as Item[]
      ).map((item) => [item.id, item]),
    );
  const before = loadItems(current),
    after = loadItems(candidate);
  for (const item of after.values()) {
    const known = before.get(item.id);
    if (known) {
      // A common ID keeps its current owner and capability namespace. Parent
      // moves are handled below; crossing ordinary/Space boundaries is refused.
      if (
        known.owner_id !== item.owner_id ||
        known.kind !== item.kind ||
        known.space_id !== item.space_id
      )
        throw refused();
    } else {
      const person = target
        .prepare('SELECT disabled,is_admin FROM auth_users WHERE id=?')
        .get(item.owner_id);
      if (
        !person ||
        person.disabled !== 1 ||
        person.is_admin !== 0 ||
        source.prepare('SELECT 1 FROM auth_users WHERE id=?').get(item.owner_id) ||
        target.prepare('SELECT 1 FROM auth_passkeys WHERE user_id=?').get(item.owner_id)
      )
        throw refused();
    }
  }
  const grants = (
    readRestoreRows(source, 'workspace_grants', 8192, [
      'item_id',
      'user_id',
      'role',
      'shared_at',
    ]) as unknown as Grant[]
  ).filter((grant) => {
    const item = after.get(grant.item_id),
      person = current.auth.user(grant.user_id);
    return (
      item &&
      item.space_id === null &&
      person &&
      !person.is_admin &&
      item.owner_id !== grant.user_id
    );
  });
  const actors = new Set(grants.map((grant) => grant.user_id));
  // This is an explicit refusal budget, never a truncated permission proof.
  if (actors.size * after.size * 4 > 100_000) throw refused();
  const oldDepths = ancestryDepths(before),
    newDepths = ancestryDepths(after);
  let work = 0;
  for (const item of after.values()) {
    // Both proof passes traverse ancestry in the real service resolvers. Count
    // ancestor work, not just public calls; include capping and fixed row reads.
    work += actors.size * (32 + 8 * (newDepths.get(item.id)! + (oldDepths.get(item.id) ?? 0)));
    if (work > 1_000_000) throw refused();
  }
  const unchangedAncestry = new Map<string, boolean>();
  for (const item of [...after.values()].sort(
    (a, b) => newDepths.get(a.id)! - newDepths.get(b.id)!,
  )) {
    unchangedAncestry.set(
      item.id,
      before.get(item.id)?.parent_id === item.parent_id &&
        (item.parent_id === null || unchangedAncestry.get(item.parent_id) === true),
    );
  }
  const byActor = new Map<string, Map<string, { grant: Grant; level: number }>>();
  for (const grant of grants) {
    if (!roles.includes(grant.role)) throw refused();
    const entries = byActor.get(grant.user_id) ?? new Map();
    entries.set(grant.item_id, { grant, level: strength[grant.role] });
    byActor.set(grant.user_id, entries);
  }
  return candidate.auth.transaction(() => {
    target.exec('DELETE FROM workspace_grants; DELETE FROM workspace_placements');
    const insert = target.prepare(
      'INSERT INTO workspace_grants(item_id,user_id,role,shared_at) VALUES(?,?,?,?)',
    );
    for (const grant of grants)
      insert.run(grant.item_id, grant.user_id, grant.role, grant.shared_at);
    let reads = 0;
    for (const [actor, entries] of byActor) {
      for (const item of after.values()) {
        // Ownership is separately reconciled. The Operator deliberately restores
        // an owner's own data, including their trashed data; grants cannot cap it.
        if (item.owner_id === actor) continue;
        const limit = access(current, actor, before.get(item.id));
        // Trash or a disabled Space owner can mask an inherited grant until a
        // later untrash/reactivation. Changed ancestry must be capped even while
        // the candidate is unreadable, so that later action cannot revive it.
        if (access(candidate, actor, item) <= limit && unchangedAncestry.get(item.id)) continue;
        let cursor: Item | undefined = item;
        const seen = new Set<string>();
        while (cursor) {
          if (++reads > 100_000 || seen.has(cursor.id)) throw refused();
          seen.add(cursor.id);
          // Member-level grants are ignored by Space authorization and never copied.
          const entry = entries.get(cursor.id);
          if (entry) entry.level = Math.min(entry.level, limit);
          if (cursor.parent_id === null) break;
          cursor = after.get(cursor.parent_id);
          if (!cursor) throw refused();
        }
      }
    }
    let removed = 0,
      downgraded = 0;
    const remove = target.prepare('DELETE FROM workspace_grants WHERE item_id=? AND user_id=?');
    const update = target.prepare(
      'UPDATE workspace_grants SET role=? WHERE item_id=? AND user_id=?',
    );
    for (const entries of byActor.values())
      for (const { grant, level } of entries.values()) {
        if (level === 0) {
          remove.run(grant.item_id, grant.user_id);
          removed++;
        } else if (level < strength[grant.role]) {
          update.run(roles[level - 1], grant.item_id, grant.user_id);
          downgraded++;
        }
      }
    // Verify the result using the same service paths used by real readers. Fail
    // and roll back every grant/placement change if any excess access remains.
    for (const actor of actors)
      for (const item of after.values()) {
        if (
          item.owner_id !== actor &&
          access(candidate, actor, item) > access(current, actor, before.get(item.id))
        )
          throw refused();
      }
    return { copied: grants.length, removed, downgraded };
  });
}
