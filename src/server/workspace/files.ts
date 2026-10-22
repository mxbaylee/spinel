import { AuthError } from '../auth/store.ts';
import type {
  FileItem,
  ItemAccess,
  SharePerson,
  SpaceFile,
  WorkspaceItem,
} from '../../shared/workspace.ts';
import { parseSearch, searchCatalog, searchItems } from '../../shared/search.ts';
import type { WorkspaceStore } from './store.ts';
import { SpaceStore } from './spaces.ts';
import { resolveSpaceScope } from './space-scope.ts';
import type { SpaceScope } from './space-scope.ts';

/** Account-only outer metadata. Native services deliberately never use this facade. */
export class WorkspaceFiles {
  readonly workspace: WorkspaceStore;
  private readonly spaces: SpaceStore;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
    this.spaces = new SpaceStore(workspace);
  }

  private root(id: string) {
    return (
      this.workspace.auth.database.prepare('SELECT kind FROM workspace_items WHERE id=?').get(id)
        ?.kind === 'space'
    );
  }

  private enabled() {
    if (!this.workspace.spacesEnabled) throw new AuthError(404, 'This item is not available.');
  }

  private project(user: string, scope: SpaceScope): SpaceFile {
    const { space, access, ownerId } = scope;
    if (space.kind !== 'space' || space.spaceId !== null || space.position !== null)
      throw new AuthError(404, 'This item is not available.');
    return {
      id: space.id,
      parentId: space.parentId,
      kind: 'space',
      name: space.name,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
      access,
      tags: this.workspace.spaceRootTags(user, space.id),
      ...(access === 'owner' ? {} : { ownerName: this.workspace.auth.user(ownerId)!.name }),
    };
  }

  get(user: string, id: string, needed: 'read' | 'edit' | 'owner' = 'read'): FileItem {
    this.workspace.owner(user);
    if (!this.root(id)) return this.workspace.get(user, id, needed);
    this.enabled();
    return this.project(user, resolveSpaceScope(this.workspace.auth, user, id, id, needed));
  }

  list(user: string): FileItem[] {
    return this.workspace.auth.transaction(() => {
      const ordinary = this.workspace.list(user);
      if (!this.workspace.spacesEnabled) return ordinary;
      const roots = this.spaces.roots(user).filter((scope) => scope.access === 'owner');
      return [...ordinary, ...roots.map((scope) => this.project(user, scope))].sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );
    });
  }

  private sharedAt(user: string, scope: SpaceScope) {
    const db = this.workspace.auth.database;
    const row = db.prepare(
      'SELECT parent_id,created_at FROM workspace_items WHERE id=? AND owner_id=?',
    );
    const grant = db.prepare(
      'SELECT shared_at FROM workspace_grants WHERE item_id=? AND user_id=?',
    );
    let cursor: string | null = scope.space.id;
    let created = 0;
    let shared = 0;
    let reads = 0;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (seen.has(cursor) || ++reads > 10_000)
        throw new AuthError(413, 'This file list is too large.');
      seen.add(cursor);
      const current = row.get(cursor, scope.ownerId) as
        { parent_id: string | null; created_at: number } | undefined;
      if (!current) throw new AuthError(404, 'This item is not available.');
      const access = grant.get(cursor, user) as { shared_at: number } | undefined;
      if (access)
        shared = Math.max(shared, access.shared_at === 0 ? 0 : Math.max(access.shared_at, created));
      created = Math.max(created, current.created_at);
      cursor = current.parent_id;
    }
    return shared;
  }

  shared(user: string): FileItem[] {
    return this.workspace.auth.transaction(() => {
      const ordinary = this.workspace.shared(user);
      if (!this.workspace.spacesEnabled) return ordinary;
      const placement = this.workspace.auth.database.prepare(
        'SELECT parent_id AS parentId FROM workspace_placements WHERE user_id=? AND item_id=?',
      );
      const roots = this.spaces
        .roots(user)
        .filter((scope) => scope.access !== 'owner')
        .map((scope) => {
          const filed = placement.get(user, scope.space.id) as
            { parentId: string | null } | undefined;
          return {
            ...this.project(user, scope),
            sharedAt: this.sharedAt(user, scope),
            ...(filed ? { placementParentId: filed.parentId } : {}),
          };
        });
      return [...ordinary, ...roots].sort(
        (a, b) => (b.sharedAt ?? 0) - (a.sharedAt ?? 0) || a.id.localeCompare(b.id),
      );
    });
  }

  children(user: string, id: string): FileItem[] {
    return this.workspace.auth.transaction(() => {
      const parent = this.get(user, id);
      if (parent.kind !== 'folder') return [];
      const ordinary = this.workspace.children(user, id);
      const roots = this.workspace.spacesEnabled
        ? this.spaces
            .roots(user)
            .filter((scope) => scope.space.parentId === id)
            .map((scope) => this.project(user, scope))
        : [];
      return [...ordinary, ...roots].sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );
    });
  }

  ancestors(user: string, id: string): WorkspaceItem[] {
    const item = this.get(user, id);
    if (item.kind !== 'space') return this.workspace.ancestors(user, id);
    if (!item.parentId) return [];
    const parent = this.workspace.get(user, item.parentId);
    return [...this.workspace.ancestors(user, parent.id), parent];
  }

  create(user: string, input: { name?: unknown; kind?: unknown; parentId?: unknown }): FileItem {
    if (input.kind !== 'space') return this.workspace.create(user, input);
    this.enabled();
    return this.workspace.auth.transaction(() =>
      this.project(user, this.spaces.createRoot(user, input)),
    );
  }

  update(user: string, id: string, input: { name?: unknown; parentId?: unknown }): FileItem {
    if (!this.root(id)) return this.workspace.update(user, id, input);
    this.enabled();
    return this.workspace.auth.transaction(() => {
      const result = this.project(user, this.spaces.updateRoot(user, id, input));
      this.workspace.cleanPlacements();
      return result;
    });
  }

  sharing(user: string, id: string): SharePerson[] {
    if (!this.root(id)) return this.workspace.sharing(user, id);
    this.get(user, id, 'owner');
    const rows = this.workspace.auth.database
      .prepare(
        `SELECT u.id,u.name,u.disabled,g.role AS directRole
      FROM auth_users u LEFT JOIN workspace_grants g ON g.user_id=u.id AND g.item_id=?
      WHERE u.is_admin=0 AND u.id<>? AND (u.disabled=0 OR g.role IS NOT NULL)
      ORDER BY u.name COLLATE NOCASE,u.id`,
      )
      .all(id, user) as unknown as Omit<SharePerson, 'effectiveRole'>[];
    return rows.map((person) => {
      let access: ItemAccess | null = null;
      if (!person.disabled) {
        try {
          access = resolveSpaceScope(this.workspace.auth, person.id, id, id).access;
        } catch (error) {
          if (!(error instanceof AuthError) || error.status !== 404) throw error;
        }
      }
      return { ...person, effectiveRole: access === 'owner' ? null : access };
    });
  }

  share(user: string, id: string, recipient: unknown, role: unknown): SharePerson[] {
    if (!this.root(id)) return this.workspace.share(user, id, recipient, role);
    this.enabled();
    return this.workspace.auth.transaction(() => {
      this.spaces.share(user, id, recipient, role);
      this.workspace.cleanPlacements();
      return this.sharing(user, id);
    });
  }

  place(user: string, id: string, destination: unknown, remove = false): FileItem[] {
    if (!this.root(id)) {
      this.workspace.place(user, id, destination, remove);
      return this.shared(user);
    }
    this.enabled();
    return this.workspace.auth.transaction(() => {
      const item = this.get(user, id);
      this.workspace.cleanPlacements();
      if (item.access === 'owner')
        throw new AuthError(400, 'File a shared item; use Move for your own items.');
      const db = this.workspace.auth.database;
      if (remove)
        db.prepare('DELETE FROM workspace_placements WHERE user_id=? AND item_id=?').run(user, id);
      else
        db.prepare(
          `INSERT INTO workspace_placements(user_id,item_id,parent_id) VALUES(?,?,?)
        ON CONFLICT(user_id,item_id) DO UPDATE SET parent_id=excluded.parent_id`,
        ).run(user, id, this.workspace.parent(user, destination));
      return this.shared(user);
    });
  }

  changeTag(user: string, id: string, value: unknown, remove = false): FileItem {
    if (!this.root(id)) return this.workspace.changeTag(user, id, value, remove);
    return this.workspace.auth.transaction(() => {
      this.workspace.changeSpaceRootTag(user, id, value, remove);
      return this.get(user, id);
    });
  }

  tagSuggestions(user: string): string[] {
    return this.workspace.auth.transaction(() => {
      const names = this.workspace.tagSuggestions(user);
      if (this.workspace.spacesEnabled)
        for (const scope of this.spaces.roots(user))
          names.push(...this.workspace.spaceRootTags(user, scope.space.id));
      return [...new Set(names)].sort();
    });
  }

  find(user: string, input: Record<string, unknown>) {
    this.workspace.owner(user);
    let query;
    try {
      query = parseSearch(input);
    } catch {
      throw new AuthError(400, 'Invalid search filters.');
    }
    return this.workspace.auth.transaction(() =>
      searchItems(
        searchCatalog([...this.list(user), ...this.shared(user)]),
        query,
        this.workspace.auth.now(),
      ),
    );
  }
}
