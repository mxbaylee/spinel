import { AuthError } from '../auth/store.ts';
import type { AuthStore } from '../auth/store.ts';
import type { ItemAccess, ItemKind } from '../../shared/workspace.ts';
import { currentGuestSession } from './guest-session.ts';

export type SpaceCapability = 'read' | 'edit' | 'owner';

export interface SpaceScopeItem {
  readonly id: string;
  readonly parentId: string | null;
  readonly spaceId: string | null;
  readonly kind: ItemKind | 'space';
  readonly position: number | null;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Server-only result of one live authorization check, not a reusable access token. */
export interface SpaceScope {
  readonly space: SpaceScopeItem;
  readonly item: SpaceScopeItem;
  readonly ownerId: string;
  readonly access: ItemAccess;
}

interface ScopeRow {
  id: string;
  owner_id: string;
  parent_id: string | null;
  space_id: string | null;
  space_position: number | null;
  kind: ItemKind | 'space';
  name: string;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
  trash_batch: string | null;
}

const unavailable = () => new AuthError(404, 'This Space is not available.');
// Bound one request's database work without truncating an ancestry into a valid grant.
// This is a refusal budget, not the mockup's eight-level tree as a product depth limit.
const MAX_ANCESTOR_READS = 10_000;

/**
 * Internal Space foundation: ordinary WorkspaceStore.get() refuses Space scope.
 * Call again inside the mutation transaction and after any await before returning
 * content. Only live trees are admitted here; internal recovery requires a separate
 * explicit policy, rather than an includeTrashed flag available to ordinary reads.
 * `owner` is reserved for the outer Space's owner-only operations.
 */
export function resolveSpaceScope(
  auth: AuthStore,
  actorId: string,
  spaceId: string,
  targetId = spaceId,
  capability: SpaceCapability = 'read',
): SpaceScope {
  return auth.transaction(() => {
    const isGuest = actorId.startsWith('guest:');
    const guest = isGuest ? currentGuestSession(auth, actorId) : undefined;
    if (isGuest) {
      if (!guest || guest.itemId !== spaceId) throw unavailable();
    } else {
      const actor = auth.user(actorId);
      if (!actor) throw new AuthError(401, 'Sign in to continue.');
      if (actor.is_admin) throw new AuthError(403, 'Use your everyday account for Spaces.');
    }
    if (!['read', 'edit', 'owner'].includes(capability))
      throw new AuthError(400, 'Unsupported Space action.');

    const statement = auth.database.prepare(`
      SELECT id,owner_id,parent_id,space_id,space_position,kind,name,created_at,updated_at,
        trashed_at,trash_batch FROM workspace_items WHERE id=?
    `);
    let reads = 0;
    const load = (id: string): ScopeRow => {
      if (++reads > MAX_ANCESTOR_READS) throw unavailable();
      const row = statement.get(id) as unknown as ScopeRow | undefined;
      if (!row || row.trashed_at !== null || row.trash_batch !== null) throw unavailable();
      return row;
    };
    const space = load(spaceId);
    if (space.kind !== 'space' || space.space_id !== null || space.space_position !== null)
      throw unavailable();
    const owner = auth.user(space.owner_id);
    // Disabled-owner denial belongs to Spaces; standalone collaborator policy is unchanged.
    if (!owner || owner.is_admin) throw unavailable();

    const grants = auth.database.prepare(
      'SELECT role FROM workspace_grants WHERE item_id=? AND user_id=?',
    );
    const strength = (id: string) => {
      const role = grants.get(id, actorId)?.role;
      return role === 'editor' ? 2 : role === 'viewer' ? 1 : 0;
    };
    let inherited = 0;
    let cursor = space.parent_id;
    const outerSeen = new Set([space.id]);
    while (cursor !== null) {
      if (outerSeen.has(cursor)) throw unavailable();
      outerSeen.add(cursor);
      const ancestor = load(cursor);
      if (
        ancestor.owner_id !== space.owner_id ||
        ancestor.kind !== 'folder' ||
        ancestor.space_id !== null ||
        ancestor.space_position !== null
      )
        throw unavailable();
      if (!isGuest) inherited = Math.max(inherited, strength(ancestor.id));
      cursor = ancestor.parent_id;
    }

    const level = guest
      ? guest.role === 'editor'
        ? 2
        : 1
      : actorId === space.owner_id
        ? 3
        : Math.max(strength(space.id), inherited);
    if (level === 0) throw unavailable();
    const access: ItemAccess = level === 3 ? 'owner' : level === 2 ? 'editor' : 'viewer';

    let item = space;
    if (targetId !== space.id) {
      item = load(targetId);
      let child = item;
      const seen = new Set<string>();
      while (true) {
        if (
          seen.has(child.id) ||
          child.owner_id !== space.owner_id ||
          child.space_id !== space.id ||
          !['doc', 'sheet', 'folder'].includes(child.kind) ||
          typeof child.space_position !== 'number' ||
          !Number.isSafeInteger(child.space_position) ||
          child.space_position < 0 ||
          child.parent_id === null
        )
          throw unavailable();
        seen.add(child.id);
        if (child.parent_id === space.id) break;
        child = load(child.parent_id);
      }
    }
    // An owner's internal rename is an edit; this capability never lends outer
    // sharing/move/trash powers to a child or to a Space editor.
    if (capability === 'owner' && item.id !== space.id) throw unavailable();
    if (capability === 'owner' && access !== 'owner')
      throw new AuthError(403, 'Only the owner can manage this Space.');
    if (capability === 'edit' && access === 'viewer')
      throw new AuthError(403, 'You can view this Space, but cannot edit its contents.');

    const project = (row: ScopeRow): SpaceScopeItem => ({
      id: row.id,
      // A direct Space grant does not disclose its owner's private outer folder.
      parentId:
        row.id === space.id && (isGuest || (access !== 'owner' && inherited === 0))
          ? null
          : row.parent_id,
      spaceId: row.space_id,
      kind: row.kind,
      position: row.space_position,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return { space: project(space), item: project(item), ownerId: owner.id, access };
  });
}
