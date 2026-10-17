import { randomUUID } from 'node:crypto';
import { AuthError, AuthStore } from '../auth/store.ts';
import { ITEM_KINDS } from '../../shared/workspace.ts';
import type { ItemKind, WorkspaceItem } from '../../shared/workspace.ts';

const columns =
  'id,parent_id AS parentId,kind,name,created_at AS createdAt,updated_at AS updatedAt';
export class WorkspaceStore {
  auth: AuthStore;
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
    `);
  }
  owner(ownerId: string) {
    const user = this.auth.user(ownerId);
    if (!user) throw new AuthError(401, 'Sign in to continue.');
    if (user.is_admin) throw new AuthError(403, 'Use your everyday account for documents.');
  }
  list(ownerId: string): WorkspaceItem[] {
    this.owner(ownerId);
    return this.auth.database
      .prepare(
        `SELECT ${columns} FROM workspace_items WHERE owner_id=? ORDER BY name COLLATE NOCASE,id`,
      )
      .all(ownerId) as unknown as WorkspaceItem[];
  }
  get(ownerId: string, id: string): WorkspaceItem {
    this.owner(ownerId);
    const item = this.auth.database
      .prepare(`SELECT ${columns} FROM workspace_items WHERE owner_id=? AND id=?`)
      .get(ownerId, id) as unknown as WorkspaceItem | undefined;
    if (!item) throw new AuthError(404, 'This item is not available.');
    return item;
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
      const folder = this.get(ownerId, cursor);
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
        .prepare('INSERT INTO workspace_items VALUES(?,?,?,?,?,?,?)')
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
      const item = this.get(ownerId, id);
      const name = input.name === undefined ? item.name : this.name(input.name);
      const parentId =
        input.parentId === undefined ? item.parentId : this.parent(ownerId, input.parentId, id);
      this.auth.database
        .prepare(
          'UPDATE workspace_items SET name=?,parent_id=?,updated_at=? WHERE id=? AND owner_id=?',
        )
        .run(name, parentId, this.auth.now(), id, ownerId);
      return this.get(ownerId, id);
    });
  }
}
