import { randomUUID } from 'node:crypto';
import { AuthError, AuthStore } from '../auth/store.ts';
import { ITEM_KINDS } from '../../shared/workspace.ts';
import type { ItemKind, WorkspaceItem, ItemAccess, SharePerson } from '../../shared/workspace.ts';
import type { SnapshotSaved } from './snapshots.ts';

const columns =
  'id,parent_id AS parentId,kind,name,created_at AS createdAt,updated_at AS updatedAt';
export class WorkspaceStore {
  auth: AuthStore;
  private readonly snapshotListeners = new Set<(event: SnapshotSaved) => void>();
  onSnapshotSaved(listener: (event: SnapshotSaved) => void) {
    this.snapshotListeners.add(listener);
    return {
      dispose: () => {
        this.snapshotListeners.delete(listener);
      },
    };
  }
  snapshotSaved(event: SnapshotSaved) {
    for (const listener of this.snapshotListeners) listener(event);
  }
  constructor(auth: AuthStore) {
    this.auth = auth;
    auth.database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_items (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES workspace_items(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL CHECK(kind IN ('folder','sheet','doc','slides')),
        name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workspace_items_owner_parent ON workspace_items(owner_id,parent_id);
      CREATE TABLE IF NOT EXISTS workspace_pins (
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY(user_id,item_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workspace_pins_item ON workspace_pins(item_id);
      CREATE TABLE IF NOT EXISTS workspace_tags (
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        PRIMARY KEY(user_id,name)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workspace_tag_assignments (
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        PRIMARY KEY(user_id,item_id,name),
        FOREIGN KEY(user_id,name) REFERENCES workspace_tags(user_id,name) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workspace_tag_assignments_item ON workspace_tag_assignments(item_id);
      CREATE TABLE IF NOT EXISTS workspace_grants (
        item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
        PRIMARY KEY(item_id,user_id)
      ) STRICT;
    `);
    const fields = auth.database.prepare('PRAGMA table_info(workspace_items)').all();
    // Additive migration preserves existing native snapshots and image foreign keys.
    if (!fields.some((field) => field.name === 'trashed_at'))
      auth.database.exec('ALTER TABLE workspace_items ADD COLUMN trashed_at INTEGER');
    if (!fields.some((field) => field.name === 'trash_batch'))
      auth.database.exec('ALTER TABLE workspace_items ADD COLUMN trash_batch TEXT');
    auth.database.exec(
      'CREATE INDEX IF NOT EXISTS workspace_items_trash ON workspace_items(trashed_at)',
    );
  }
  cleanPins() {
    // Access can change through a parent grant, a move, or a trash batch.
    // Remove references at that transition, so a later regrant cannot revive them.
    const rows = this.auth.database.prepare('SELECT user_id,item_id FROM workspace_pins').all() as {
      user_id: string;
      item_id: string;
    }[];
    const remove = this.auth.database.prepare(
      'DELETE FROM workspace_pins WHERE user_id=? AND item_id=?',
    );
    for (const row of rows)
      if (!this.role(row.user_id, row.item_id)) remove.run(row.user_id, row.item_id);
  }
  private readPins(userId: string): WorkspaceItem[] {
    this.cleanPins();
    const rows = this.auth.database
      .prepare('SELECT item_id FROM workspace_pins WHERE user_id=? ORDER BY position,item_id')
      .all(userId) as { item_id: string }[];
    return rows.map((row) => this.get(userId, row.item_id));
  }
  pins(userId: string): WorkspaceItem[] {
    this.owner(userId);
    return this.auth.transaction(() => this.readPins(userId));
  }
  pin(userId: string, id: unknown, remove = false): WorkspaceItem[] {
    this.owner(userId);
    if (typeof id !== 'string' || !id) throw new AuthError(400, 'Choose an item to pin.');
    return this.auth.transaction(() => {
      if (remove)
        this.auth.database
          .prepare('DELETE FROM workspace_pins WHERE user_id=? AND item_id=?')
          .run(userId, id);
      else {
        this.get(userId, id);
        this.auth.database
          .prepare(
            `INSERT OR IGNORE INTO workspace_pins(user_id,item_id,position)
          SELECT ?,?,coalesce(max(position),-1)+1 FROM workspace_pins WHERE user_id=?`,
          )
          .run(userId, id, userId);
      }
      return this.readPins(userId);
    });
  }
  orderPins(userId: string, ids: unknown): WorkspaceItem[] {
    this.owner(userId);
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== 'string') ||
      new Set(ids).size !== ids.length
    )
      throw new AuthError(400, 'Choose each pinned item once.');
    return this.auth.transaction(() => {
      const current = this.readPins(userId);
      const set = new Set(current.map((item) => item.id));
      // A stale tab must not drop a pin added elsewhere or add a foreign reference.
      if (ids.length !== set.size || ids.some((id) => !set.has(id)))
        throw new AuthError(409, 'Your pins changed. Refresh them and try again.');
      const update = this.auth.database.prepare(
        'UPDATE workspace_pins SET position=? WHERE user_id=? AND item_id=?',
      );
      ids.forEach((id, position) => update.run(position, userId, id));
      return this.readPins(userId);
    });
  }
  ownTags(userId: string, id: string): string[] {
    // Item/trash callers establish document access first; only this person's
    // labels are returned. Suggestions may retain names after access is revoked.
    this.owner(userId);
    return (
      this.auth.database
        .prepare(
          'SELECT name FROM workspace_tag_assignments WHERE user_id=? AND item_id=? ORDER BY name',
        )
        .all(userId, id) as { name: string }[]
    ).map((row) => row.name);
  }
  tagSuggestions(userId: string): string[] {
    this.owner(userId);
    return (
      this.auth.database
        .prepare('SELECT name FROM workspace_tags WHERE user_id=? ORDER BY name')
        .all(userId) as { name: string }[]
    ).map((row) => row.name);
  }
  changeTag(userId: string, id: string, value: unknown, remove = false): WorkspaceItem {
    return this.auth.transaction(() => {
      const item = this.get(userId, id);
      if (item.kind === 'folder') throw new AuthError(400, 'Choose a document to tag.');
      if (typeof value !== 'string' || /[\p{Cc}\p{Cs}]/u.test(value))
        throw new AuthError(400, 'Use a tag of 1–64 characters without control characters.');
      const name = value
        .trim()
        .replace(/^#/, '')
        .trim()
        .normalize('NFC')
        .toLowerCase()
        .normalize('NFC');
      if (name.startsWith('#')) throw new AuthError(400, 'Use at most one leading # in a tag.');
      if (!name || name.length > 64)
        throw new AuthError(400, 'Use a tag of 1–64 characters without control characters.');
      if (remove)
        this.auth.database
          .prepare('DELETE FROM workspace_tag_assignments WHERE user_id=? AND item_id=? AND name=?')
          .run(userId, id, name);
      else {
        this.auth.database
          .prepare('INSERT OR IGNORE INTO workspace_tags(user_id,name) VALUES(?,?)')
          .run(userId, name);
        this.auth.database
          .prepare(
            'INSERT OR IGNORE INTO workspace_tag_assignments(user_id,item_id,name) VALUES(?,?,?)',
          )
          .run(userId, id, name);
      }
      return this.get(userId, id);
    });
  }
  owner(ownerId: string) {
    const user = this.auth.user(ownerId);
    if (!user) throw new AuthError(401, 'Sign in to continue.');
    if (user.is_admin) throw new AuthError(403, 'Use your everyday account for documents.');
  }
  list(ownerId: string): WorkspaceItem[] {
    this.owner(ownerId);
    const items = this.auth.database
      .prepare(
        `SELECT ${columns}, 'owner' AS access FROM workspace_items WHERE owner_id=? AND trashed_at IS NULL ORDER BY name COLLATE NOCASE,id`,
      )
      .all(ownerId) as unknown as WorkspaceItem[];
    return items.map((item) => ({ ...item, tags: this.ownTags(ownerId, item.id) }));
  }
  // All callers use this resolver, including content, metadata and image access.
  // UNION makes malformed ancestor cycles finite; inherited grants cannot cross owners.
  private role(userId: string, id: string): ItemAccess | null {
    const row = this.auth.database
      .prepare(
        `
      WITH RECURSIVE ancestors(id,parent_id,owner_id,trashed_at) AS (
        SELECT id,parent_id,owner_id,trashed_at FROM workspace_items WHERE id=?
        UNION
        SELECT p.id,p.parent_id,p.owner_id,p.trashed_at FROM workspace_items p
        JOIN ancestors a ON p.id=a.parent_id AND p.owner_id=a.owner_id
      )
      SELECT CASE WHEN count(a.trashed_at)>0 THEN 0 ELSE max(CASE WHEN a.owner_id=? THEN 3 WHEN g.role='editor' THEN 2
        WHEN g.role='viewer' THEN 1 ELSE 0 END) END AS strength
      FROM ancestors a LEFT JOIN workspace_grants g ON g.item_id=a.id AND g.user_id=?
    `,
      )
      .get(id, userId, userId) as { strength: number | null };
    return row.strength === 3
      ? 'owner'
      : row.strength === 2
        ? 'editor'
        : row.strength === 1
          ? 'viewer'
          : null;
  }
  get(userId: string, id: string, needed: 'read' | 'edit' | 'owner' = 'read'): WorkspaceItem {
    this.owner(userId);
    const access = this.role(userId, id);
    if (!access) throw new AuthError(404, 'This item is not available.');
    if ((needed === 'owner' && access !== 'owner') || (needed === 'edit' && access === 'viewer'))
      throw new AuthError(
        403,
        needed === 'owner'
          ? 'Only the owner can change this item or its sharing.'
          : 'You can view this document, but cannot edit it.',
      );
    const item = this.auth.database
      .prepare(`SELECT ${columns} FROM workspace_items WHERE id=?`)
      .get(id) as unknown as WorkspaceItem;
    // A direct share must not disclose the owner's private parent chain.
    return {
      ...item,
      access,
      tags: this.ownTags(userId, id),
      parentId: item.parentId && this.role(userId, item.parentId) ? item.parentId : null,
    };
  }
  children(userId: string, id: string): WorkspaceItem[] {
    const parent = this.get(userId, id);
    if (parent.kind !== 'folder') return [];
    return (
      this.auth.database
        .prepare(
          'SELECT id FROM workspace_items WHERE parent_id=? AND trashed_at IS NULL ORDER BY name COLLATE NOCASE,id',
        )
        .all(id) as { id: string }[]
    ).map((row) => this.get(userId, row.id));
  }
  ancestors(userId: string, id: string): WorkspaceItem[] {
    let item = this.get(userId, id);
    const result: WorkspaceItem[] = [];
    const seen = new Set([id]);
    // get() stops at the first inaccessible parent, so breadcrumbs cannot reveal
    // private folder names or bridge a gap in the recipient's access.
    while (item.parentId && !seen.has(item.parentId)) {
      seen.add(item.parentId);
      item = this.get(userId, item.parentId);
      result.unshift(item);
    }
    return result;
  }
  sharing(userId: string, id: string): SharePerson[] {
    this.get(userId, id, 'owner');
    return (
      this.auth.database
        .prepare(
          `SELECT u.id,u.name,u.disabled,g.role AS directRole
      FROM auth_users u LEFT JOIN workspace_grants g ON g.user_id=u.id AND g.item_id=?
      WHERE u.is_admin=0 AND u.id<>? AND (u.disabled=0 OR g.role IS NOT NULL)
      ORDER BY u.name COLLATE NOCASE,u.id`,
        )
        .all(id, userId) as unknown as Omit<SharePerson, 'effectiveRole'>[]
    ).map((person) => ({
      ...person,
      effectiveRole: person.disabled
        ? null
        : (this.role(person.id, id) as SharePerson['effectiveRole']),
    }));
  }
  share(userId: string, id: string, recipient: unknown, role: unknown) {
    return this.auth.transaction(() => {
      this.get(userId, id, 'owner');
      if (
        typeof recipient !== 'string' ||
        recipient === userId ||
        !['viewer', 'editor', null].includes(role as string | null)
      )
        throw new AuthError(400, 'Choose a person and Viewer, Editor or No direct access.');
      if (role === null)
        this.auth.database
          .prepare('DELETE FROM workspace_grants WHERE item_id=? AND user_id=?')
          .run(id, recipient);
      else {
        const user = this.auth.user(recipient);
        if (!user || user.is_admin) throw new AuthError(400, 'Choose an active everyday account.');
        this.auth.database
          .prepare(
            `INSERT INTO workspace_grants VALUES(?,?,?)
          ON CONFLICT(item_id,user_id) DO UPDATE SET role=excluded.role`,
          )
          .run(id, recipient, role as string);
      }
      this.cleanPins();
      return this.sharing(userId, id);
    });
  }
  name(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > 120 ||
      /[\p{Cc}/\\]/u.test(value)
    )
      throw new AuthError(
        400,
        'Use a name of 1–120 characters without slashes or control characters.',
      );
    return value.trim();
  }
  parent(ownerId: string, value: unknown, movingId?: string): string | null {
    if (value === null) return null;
    if (typeof value !== 'string') throw new AuthError(400, 'Choose a destination folder.');
    let cursor: string | null = value;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (cursor === movingId || seen.has(cursor))
        throw new AuthError(409, 'A folder cannot be moved into itself or one of its subfolders.');
      seen.add(cursor);
      const folder = this.get(ownerId, cursor, 'owner');
      if (folder.kind !== 'folder') throw new AuthError(400, 'The destination must be a folder.');
      cursor = folder.parentId;
    }
    return value;
  }
  create(
    ownerId: string,
    input: { name?: unknown; kind?: unknown; parentId?: unknown },
  ): WorkspaceItem {
    this.owner(ownerId);
    const name = this.name(input.name);
    if (!ITEM_KINDS.includes(input.kind as ItemKind))
      throw new AuthError(400, 'Choose Folder, Sheet, Doc or Slides.');
    return this.auth.transaction(() => {
      const parentId = this.parent(ownerId, input.parentId);
      const id = randomUUID();
      const now = this.auth.now();
      this.auth.database
        .prepare(
          'INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run(id, ownerId, parentId, input.kind as string, name, now, now);
      return this.get(ownerId, id);
    });
  }
  update(
    ownerId: string,
    id: string,
    input: { name?: unknown; parentId?: unknown },
  ): WorkspaceItem {
    return this.auth.transaction(() => {
      const item = this.get(ownerId, id, 'owner');
      const name = input.name === undefined ? item.name : this.name(input.name);
      const parentId =
        input.parentId === undefined ? item.parentId : this.parent(ownerId, input.parentId, id);
      this.auth.database
        .prepare(
          'UPDATE workspace_items SET name=?,parent_id=?,updated_at=? WHERE id=? AND owner_id=?',
        )
        .run(name, parentId, this.auth.now(), id, ownerId);
      this.cleanPins();
      return this.get(ownerId, id);
    });
  }
}
