import type { ItemAccessDetails } from '../../shared/workspace.ts';
import { AuthError } from '../auth/store.ts';
import { MAX_ANCESTOR_READS } from './ordinary-scope.ts';
import { resolveSpaceScope } from './space-scope.ts';
import type { WorkspaceStore } from './store.ts';

/** Resolve the effective grant, not a breadcrumb or another person's access. */
export function resolveAccessDetails(
  workspace: WorkspaceStore,
  userId: string,
  itemId: string,
  spaceId?: string,
): ItemAccessDetails {
  return workspace.auth.transaction(() => {
    workspace.owner(userId);
    const db = workspace.auth.database;
    const unavailable = () => new AuthError(404, 'This item is not available.');
    const root =
      spaceId ??
      (db.prepare('SELECT kind FROM workspace_items WHERE id=?').get(itemId)?.kind === 'space'
        ? itemId
        : undefined);
    if (root && !workspace.spacesEnabled) throw unavailable();
    // Explicit Space scope never falls back to an ordinary item or another Space.
    const scope = root ? resolveSpaceScope(workspace.auth, userId, root, itemId) : undefined;
    const access = scope?.access ?? workspace.get(userId, itemId).access;
    const boundary = scope ? { space: { id: scope.space.id, name: scope.space.name } } : {};
    if (access === 'owner') return { access, source: { kind: 'owner' }, ...boundary };

    const target = scope?.space.id ?? itemId;
    const load = db.prepare(
      `SELECT i.parent_id AS parentId,g.role FROM workspace_items i
       LEFT JOIN workspace_grants g ON g.item_id=i.id AND g.user_id=? WHERE i.id=?`,
    );
    const seen = new Set<string>();
    let cursor: string | null = target;
    while (cursor !== null) {
      if (seen.has(cursor) || seen.size === MAX_ANCESTOR_READS) throw unavailable();
      seen.add(cursor);
      const row = load.get(userId, cursor) as
        { parentId: string | null; role: string | null } | undefined;
      if (!row) throw unavailable();
      // Nearest equal-strength grant wins, so direct access is never described
      // as inherited merely because a weaker or duplicate ancestor grant exists.
      if (row.role === access) {
        if (cursor === target)
          return {
            access,
            source:
              scope && itemId !== target
                ? { kind: 'space', id: scope.space.id, name: scope.space.name }
                : { kind: 'direct' },
            ...boundary,
          };
        // Authorization precedes metadata. Do not expose a private parent path,
        // even when the requested document itself has a readable direct grant.
        const ancestor = workspace.get(userId, cursor);
        if (ancestor.kind !== 'folder') throw unavailable();
        return {
          access,
          source: { kind: 'folder', id: ancestor.id, name: ancestor.name },
          ...boundary,
        };
      }
      cursor = row.parentId;
    }
    throw unavailable();
  });
}
