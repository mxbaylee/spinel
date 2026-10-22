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
      const parentId = this.workspace.parent(actorId, input.parentId);
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
          : this.workspace.parent(actorId, input.parentId, spaceId);
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
