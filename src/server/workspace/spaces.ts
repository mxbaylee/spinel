import { randomUUID } from 'node:crypto';
import { ITEM_KINDS } from '../../shared/workspace.ts';
import type { ItemKind } from '../../shared/workspace.ts';
import { AuthError } from '../auth/store.ts';
import { resolveSpaceScope } from './space-scope.ts';
import type { SpaceCapability, SpaceScope, SpaceScopeItem } from './space-scope.ts';
import { MAX_SPACE_ITEMS, readSpaceStructure } from './space-structure.ts';
import type { WorkspaceStore } from './store.ts';

export interface SpaceTree extends Omit<SpaceScope, 'item'> {
  /** Live members in depth-first sibling order; the Space root is separate. */
  readonly items: SpaceScopeItem[];
}

interface LiveMember extends SpaceScopeItem {
  readonly parentId: string;
  readonly position: number;
  readonly kind: ItemKind;
}

interface LiveTree {
  scope: SpaceScope;
  totalItems: number;
  items: LiveMember[];
  byId: Map<string, LiveMember>;
  children: Map<string, LiveMember[]>;
}

const unavailable = () => new AuthError(404, 'This Space is not available.');

/**
 * Internal live-tree operations. Callers explicitly prepare the Space schema;
 * this service neither migrates storage nor registers routes or guest access.
 * Native snapshots and formula bindings remain attached to their existing IDs.
 */
export class SpaceStore {
  private readonly workspace: WorkspaceStore;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
  }

  get(actorId: string, spaceId: string, itemId = spaceId): SpaceScope {
    return resolveSpaceScope(this.workspace.auth, actorId, spaceId, itemId);
  }

  /** Account review discovery only; ordinary catalogs continue to exclude Spaces. */
  roots(actorId: string): SpaceScope[] {
    return this.workspace.auth.transaction(() => {
      this.workspace.owner(actorId);
      const { database } = this.workspace.auth;
      let work = 0;
      const spend = (count: number) => {
        work += count;
        if (work > MAX_SPACE_ITEMS)
          throw new AuthError(413, 'This Space list is too large to process at once.');
      };
      const candidates = new Set<string>();
      const owned = database
        .prepare(
          `SELECT id FROM workspace_items WHERE owner_id=? AND kind='space'
          AND space_id IS NULL AND trashed_at IS NULL LIMIT ?`,
        )
        .all(actorId, MAX_SPACE_ITEMS + 1) as { id: string }[];
      spend(owned.length);
      for (const row of owned) candidates.add(row.id);
      interface Candidate {
        id: string;
        owner_id: string;
        kind: string;
      }
      // Count raw grants before filtering. Otherwise arbitrarily many stale or
      // internal grants could trigger PK lookups without spending the budget.
      const grants = database
        .prepare('SELECT item_id FROM workspace_grants WHERE user_id=? LIMIT ?')
        .all(actorId, MAX_SPACE_ITEMS - work + 1) as { item_id: string }[];
      spend(grants.length);
      const eligibleGrant = database.prepare(`SELECT id,owner_id,kind FROM workspace_items
        WHERE id=? AND owner_id<>? AND space_id IS NULL AND space_position IS NULL
          AND trashed_at IS NULL AND trash_batch IS NULL`);
      const children = database.prepare(`SELECT id,owner_id,kind FROM workspace_items
        WHERE owner_id=? AND parent_id=? AND space_id IS NULL AND space_position IS NULL
          AND trashed_at IS NULL AND trash_batch IS NULL AND kind IN ('folder','space')
        LIMIT ?`);
      const pending = grants.flatMap(({ item_id }) => {
        const row = eligibleGrant.get(item_id, actorId) as unknown as Candidate | undefined;
        return row ? [row] : [];
      });
      const visited = new Set<string>();
      while (pending.length) {
        const row = pending.pop()!;
        if (visited.has(row.id)) continue;
        visited.add(row.id);
        if (row.kind === 'space') candidates.add(row.id);
        else if (row.kind === 'folder') {
          const nested = children.all(
            row.owner_id,
            row.id,
            MAX_SPACE_ITEMS - work + 1,
          ) as unknown as Candidate[];
          spend(nested.length);
          pending.push(...nested);
        }
      }

      // Count every root/ancestor pair before resolving any roots. Many roots
      // under a deep shared folder must not cause unbounded repeated role walks.
      // The same fixed budget includes candidate discovery; no partial catalog
      // escapes on refusal, and an internal Space tree is never traversed here.
      const parent = database.prepare('SELECT parent_id FROM workspace_items WHERE id=?');
      for (const id of candidates) {
        let cursor: string | null = id;
        const seen = new Set<string>();
        while (cursor !== null && !seen.has(cursor)) {
          spend(1);
          seen.add(cursor);
          const row = parent.get(cursor) as { parent_id: string | null } | undefined;
          cursor = row?.parent_id ?? null;
        }
      }
      const roots: SpaceScope[] = [];
      for (const id of candidates) {
        try {
          roots.push(this.get(actorId, id));
        } catch (error) {
          // A stale grant, malformed/trashed ancestor or disabled owner is
          // unavailable. Authentication, capacity and database errors propagate.
          if (!(error instanceof AuthError) || error.status !== 404) throw error;
        }
      }
      return roots.sort(
        (a, b) => a.space.name.localeCompare(b.space.name) || a.space.id.localeCompare(b.space.id),
      );
    });
  }

  list(actorId: string, spaceId: string): SpaceTree {
    return this.workspace.auth.transaction(() => {
      const { scope, items } = this.tree(actorId, spaceId, 'read');
      return { space: scope.space, ownerId: scope.ownerId, access: scope.access, items };
    });
  }

  createRoot(actorId: string, input: { name?: unknown; parentId?: unknown }): SpaceScope {
    return this.workspace.auth.transaction(() => {
      this.workspace.owner(actorId);
      const name = this.workspace.name(input.name);
      const parentId = this.outerParent(actorId, input.parentId);
      const id = randomUUID();
      const now = this.workspace.auth.now();
      this.workspace.auth.database
        .prepare(
          `INSERT INTO workspace_items
          (id,owner_id,parent_id,kind,name,created_at,updated_at)
          VALUES(?,?,?,'space',?,?,?)`,
        )
        .run(id, actorId, parentId, name, now, now);
      return resolveSpaceScope(this.workspace.auth, actorId, id, id, 'owner');
    });
  }

  createChild(
    actorId: string,
    spaceId: string,
    input: { name?: unknown; kind?: unknown; parentId?: unknown; position?: unknown },
  ): SpaceScope {
    return this.workspace.auth.transaction(() => {
      const tree = this.tree(actorId, spaceId, 'edit');
      if (tree.totalItems >= MAX_SPACE_ITEMS)
        throw new AuthError(413, 'This Space is too large to process in one request.');
      const name = this.workspace.name(input.name);
      if (!ITEM_KINDS.includes(input.kind as ItemKind))
        throw new AuthError(400, 'Choose Folder, Sheet or Doc.');
      const parentId = this.parent(tree, input.parentId);
      const siblings = (tree.children.get(parentId) ?? []).map((item) => item.id);
      const position = this.position(input.position, siblings.length);
      const id = randomUUID();
      const now = this.workspace.auth.now();
      this.workspace.auth.database
        .prepare(
          `INSERT INTO workspace_items
          (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
          VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          tree.scope.ownerId,
          parentId,
          input.kind as string,
          name,
          now,
          now,
          spaceId,
          position,
        );
      siblings.splice(position, 0, id);
      this.order(spaceId, parentId, siblings, now);
      return resolveSpaceScope(this.workspace.auth, actorId, spaceId, id, 'edit');
    });
  }

  /** Rename, reparent and reorder together; positions refer to the final sibling list. */
  updateChild(
    actorId: string,
    spaceId: string,
    itemId: string,
    input: { name?: unknown; parentId?: unknown; position?: unknown },
  ): SpaceScope {
    return this.workspace.auth.transaction(() => {
      const tree = this.tree(actorId, spaceId, 'edit');
      const item = tree.byId.get(itemId);
      if (!item) throw unavailable();
      const name = input.name === undefined ? item.name : this.workspace.name(input.name);
      const parentId = this.parent(
        tree,
        input.parentId === undefined ? item.parentId : input.parentId,
      );
      let cursor = parentId;
      while (cursor !== spaceId) {
        if (cursor === itemId)
          throw new AuthError(
            409,
            'An item cannot be moved into itself or one of its descendants.',
          );
        cursor = tree.byId.get(cursor)!.parentId;
      }
      const previous = tree.children.get(item.parentId)!.map((sibling) => sibling.id);
      const destination = (tree.children.get(parentId) ?? [])
        .filter((sibling) => sibling.id !== itemId)
        .map((sibling) => sibling.id);
      const fallback = parentId === item.parentId ? previous.indexOf(itemId) : destination.length;
      const position = this.position(input.position, destination.length, fallback);
      destination.splice(position, 0, itemId);
      const now = this.workspace.auth.now();
      this.workspace.auth.database
        .prepare(
          'UPDATE workspace_items SET name=?,parent_id=?,updated_at=? WHERE id=? AND space_id=?',
        )
        .run(name, parentId, now, itemId, spaceId);
      if (parentId !== item.parentId)
        this.order(
          spaceId,
          item.parentId,
          previous.filter((id) => id !== itemId),
          now,
        );
      this.order(spaceId, parentId, destination, now);
      return resolveSpaceScope(this.workspace.auth, actorId, spaceId, itemId, 'edit');
    });
  }

  updateRoot(
    actorId: string,
    spaceId: string,
    input: { name?: unknown; parentId?: unknown },
  ): SpaceScope {
    return this.workspace.auth.transaction(() => {
      const { scope } = this.tree(actorId, spaceId, 'owner');
      const name = input.name === undefined ? scope.space.name : this.workspace.name(input.name);
      const parentId =
        input.parentId === undefined
          ? scope.space.parentId
          : this.outerParent(actorId, input.parentId);
      this.workspace.auth.database
        .prepare('UPDATE workspace_items SET name=?,parent_id=?,updated_at=? WHERE id=?')
        .run(name, parentId, this.workspace.auth.now(), spaceId);
      return resolveSpaceScope(this.workspace.auth, actorId, spaceId, spaceId, 'owner');
    });
  }

  /** Only the root accepts account grants. Children always inherit the effective role. */
  share(actorId: string, spaceId: string, recipient: unknown, role: unknown): SpaceScope {
    return this.workspace.auth.transaction(() => {
      resolveSpaceScope(this.workspace.auth, actorId, spaceId, spaceId, 'owner');
      if (
        typeof recipient !== 'string' ||
        recipient === actorId ||
        !['viewer', 'editor', null].includes(role as string | null)
      )
        throw new AuthError(400, 'Choose a person and Viewer, Editor or No direct access.');
      if (role === null)
        this.workspace.auth.database
          .prepare('DELETE FROM workspace_grants WHERE item_id=? AND user_id=?')
          .run(spaceId, recipient);
      else {
        const user = this.workspace.auth.user(recipient);
        if (!user || user.is_admin) throw new AuthError(400, 'Choose an active everyday account.');
        this.workspace.auth.database
          .prepare(
            `INSERT INTO workspace_grants(item_id,user_id,role,shared_at) VALUES(?,?,?,?)
            ON CONFLICT(item_id,user_id) DO UPDATE SET role=excluded.role`,
          )
          .run(spaceId, recipient, role as string, this.workspace.auth.now());
      }
      return resolveSpaceScope(this.workspace.auth, actorId, spaceId, spaceId, 'owner');
    });
  }

  private tree(actorId: string, spaceId: string, capability: SpaceCapability): LiveTree {
    const scope = resolveSpaceScope(this.workspace.auth, actorId, spaceId, spaceId, capability);
    const structure = readSpaceStructure(this.workspace.auth.database, spaceId, scope.ownerId);
    const items: LiveMember[] = structure.items
      .filter((item) => item.trashedAt === null)
      .map(({ trashedAt: _trashedAt, trashBatch: _trashBatch, ...item }) => item);
    const byId = new Map(items.map((item) => [item.id, item]));
    const children = new Map<string, LiveMember[]>();
    for (const item of items) {
      const siblings = children.get(item.parentId) ?? [];
      siblings.push(item);
      children.set(item.parentId, siblings);
    }
    return { scope, totalItems: structure.items.length, items, byId, children };
  }

  private outerParent(actorId: string, value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== 'string') throw new AuthError(400, 'Choose a destination folder.');
    // One ordinary-owner read already validates the complete live folder chain.
    // It cannot contain any Space, so the destination cannot be below this root.
    // Rechecking every ancestor with get() would make deep outer moves quadratic.
    const parent = this.workspace.get(actorId, value, 'owner');
    if (parent.kind !== 'folder') throw new AuthError(400, 'The destination must be a folder.');
    return parent.id;
  }

  private parent(tree: LiveTree, value: unknown): string {
    if (typeof value !== 'string') throw new AuthError(400, 'Choose a parent inside this Space.');
    if (value !== tree.scope.space.id && !tree.byId.has(value)) throw unavailable();
    return value;
  }

  private position(value: unknown, maximum: number, fallback = maximum): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
      throw new AuthError(400, 'Choose a position within the destination children.');
    return value;
  }

  private order(spaceId: string, parentId: string, ids: string[], now: number) {
    const update = this.workspace.auth.database.prepare(`
      UPDATE workspace_items SET space_position=?,updated_at=?
      WHERE id=? AND space_id=? AND parent_id=? AND trashed_at IS NULL AND trash_batch IS NULL
        AND space_position<>?
    `);
    ids.forEach((id, position) => update.run(position, now, id, spaceId, parentId, position));
  }
}
