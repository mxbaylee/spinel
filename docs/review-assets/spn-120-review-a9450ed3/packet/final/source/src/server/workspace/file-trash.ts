import { createHash, randomUUID } from 'node:crypto';
import { AuthError } from '../auth/store.ts';
import type { FileItem, FileKind, TrashListing, TrashedItem } from '../../shared/workspace.ts';
import type { WorkspaceStore } from './store.ts';
import { WorkspaceFiles } from './files.ts';
import { classifyOrdinaryItems } from './ordinary-scope.ts';
import { readSpaceStructure } from './space-structure.ts';
import type { SpaceStructure } from './space-structure.ts';
import { SpaceLifecycleStore } from './space-lifecycle.ts';
import { cleanRecoveryHolds, recoveryProtected, recoveryProtectedItems } from './recovery-holds.ts';

const MAX_ITEMS = 10_001; // A full retained Space has at most 10,000 members plus its root.
const overBudget = () =>
  new AuthError(413, 'This trash operation is too large to process at once.');
const unavailable = () => new AuthError(404, 'This item is not in your trash.');
type Row = {
  id: string;
  ownerId: string;
  parentId: string | null;
  kind: FileKind;
  name: string;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
  trashBatch: string | null;
  spaceId: string | null;
  position: number | null;
};
const fields = `i.id,i.owner_id AS ownerId,i.parent_id AS parentId,i.kind,i.name,
  i.created_at AS createdAt,i.updated_at AS updatedAt,i.trashed_at AS trashedAt,
  i.trash_batch AS trashBatch,i.space_id AS spaceId,i.space_position AS position`;
type Graph = { rows: Row[]; spaces: Map<string, SpaceStructure> };

/** Account-only outer lifecycle. Traversal stops at a Space for trash/restore,
 * while explicit permanent deletion validates its complete retained graph. */
export class FileTrash {
  private readonly workspace: WorkspaceStore;
  private readonly retention: number;
  private readonly files: WorkspaceFiles;
  constructor(workspace: WorkspaceStore, retention: number) {
    this.workspace = workspace;
    this.retention = retention;
    this.files = new WorkspaceFiles(workspace);
    workspace.auth.database.exec(`CREATE TABLE IF NOT EXISTS workspace_retained_trash_batches (
      batch TEXT PRIMARY KEY
    ) STRICT`);
  }

  private actor(user: string) {
    this.workspace.owner(user);
    if (!this.workspace.spacesEnabled) throw new AuthError(404, 'This item is not available.');
  }

  private graph(user: string, ids: string[]): Graph {
    if (ids.length > MAX_ITEMS) throw overBudget();
    const db = this.workspace.auth.database;
    if (!ids.length) return { rows: [], spaces: new Map() };
    const rows = db
      .prepare(
        `WITH RECURSIVE graph(id) AS (
      SELECT id FROM workspace_items WHERE id IN (${ids.map(() => '?').join(',')})
      UNION SELECT c.id FROM workspace_items c JOIN graph p ON c.parent_id=p.id LIMIT ?
    ) SELECT ${fields} FROM workspace_items i JOIN graph g ON g.id=i.id ORDER BY i.id`,
      )
      .all(...ids, MAX_ITEMS + 1) as unknown as Row[];
    if (rows.length > MAX_ITEMS) throw overBudget();
    if (rows.some((row) => row.ownerId !== user)) throw unavailable();
    const ordinaryRows = rows.filter((row) => row.kind !== 'space' && row.spaceId === null);
    const ordinary = classifyOrdinaryItems(
      db,
      ordinaryRows.map((row) => row.id),
    );
    if (!ordinary) throw overBudget();
    if (ordinaryRows.some((row) => !ordinary.has(row.id) || row.position !== null))
      throw unavailable();
    const spaces = new Map<string, SpaceStructure>();
    const all = new Set(rows.map((row) => row.id));
    const members = new Set<string>();
    for (const row of rows.filter((row) => row.kind === 'space')) {
      if (row.spaceId !== null || row.position !== null) throw unavailable();
      const structure = readSpaceStructure(db, row.id, user);
      if (structure.items.some((item) => !all.has(item.id))) throw unavailable();
      spaces.set(row.id, structure);
      for (const item of structure.items) members.add(item.id);
    }
    if (rows.some((row) => row.spaceId !== null && !members.has(row.id))) throw unavailable();
    return { rows, spaces };
  }

  private view(user: string) {
    this.actor(user);
    const db = this.workspace.auth.database;
    const candidates = db
      .prepare(
        `SELECT ${fields} FROM workspace_items i
      WHERE i.owner_id=? AND i.trashed_at IS NOT NULL AND i.space_id IS NULL
        AND i.space_position IS NULL ORDER BY i.trashed_at DESC,i.id LIMIT ?`,
      )
      .all(user, MAX_ITEMS + 1) as unknown as Row[];
    if (candidates.length > MAX_ITEMS) throw overBudget();
    const graph = this.graph(
      user,
      candidates.map((row) => row.id),
    );
    const recovery = [...graph.spaces.entries()].map(([id, structure]) => [
      id,
      [...structure.recovery.values()].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    ]);
    const version = createHash('sha256')
      .update(JSON.stringify({ rows: graph.rows, recovery }))
      .digest('hex');
    return { ...graph, candidates, version };
  }

  list(user: string): TrashListing {
    return this.workspace.auth.transaction(() => {
      const view = this.view(user);
      const protectedItems = recoveryProtectedItems(
        this.workspace.auth.database,
        view.candidates.map((row) => row.id),
      );
      const tags = this.workspace.auth.database.prepare(
        'SELECT name FROM workspace_tag_assignments WHERE user_id=? AND item_id=? ORDER BY name LIMIT ?',
      );
      let tagCount = 0;
      const items: TrashedItem[] = view.candidates.map((row) => {
        const names = tags.all(user, row.id, MAX_ITEMS - tagCount + 1);
        tagCount += names.length;
        if (tagCount > MAX_ITEMS) throw overBudget();
        return {
          id: row.id,
          parentId: row.parentId,
          kind: row.kind,
          name: row.name,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          access: 'owner',
          tags: names.map((tag) => String(tag.name)),
          trashedAt: row.trashedAt!,
          expiresAt: row.trashedAt! + this.retention,
          ...(protectedItems.has(row.id) ? { heldAfterRecovery: true as const } : {}),
        };
      });
      return {
        items,
        version: view.version,
        deletion: {
          count: view.rows.length,
          items: view.rows.map(({ id, name, kind }) => ({ id, name, kind })),
        },
      };
    });
  }

  private children(rows: Row[]) {
    const children = new Map<string, Row[]>();
    for (const row of rows) {
      if (row.parentId === null) continue;
      const siblings = children.get(row.parentId) ?? [];
      siblings.push(row);
      children.set(row.parentId, siblings);
    }
    return children;
  }

  trash(user: string, id: string) {
    return this.workspace.auth.transaction(() => {
      this.actor(user);
      this.files.get(user, id, 'admin');
      const owner = this.workspace.fileOwner(id);
      const graph = this.graph(owner, [id]);
      const root = graph.rows.find((row) => row.id === id)!;
      const children = this.children(graph.rows);
      const pending = [root];
      const change: Row[] = [];
      while (pending.length) {
        const row = pending.pop()!;
        if (row.trashedAt !== null) continue;
        change.push(row);
        if (row.kind !== 'space') pending.push(...(children.get(row.id) ?? []));
      }
      const batch = randomUUID();
      const now = this.workspace.auth.now();
      const db = this.workspace.auth.database;
      const update = db.prepare(`UPDATE workspace_items SET trashed_at=?,trash_batch=?,updated_at=?
        WHERE id=? AND owner_id=? AND trashed_at IS NULL AND space_id IS NULL AND space_position IS NULL`);
      let count = 0;
      for (const row of change) {
        if (update.run(now, batch, now, row.id, owner).changes !== 1) throw unavailable();
        count += row.kind === 'space' ? graph.spaces.get(row.id)!.items.length + 1 : 1;
      }
      this.workspace.cleanPlacements();
      return { id, count, trashedAt: now };
    });
  }

  restore(user: string, id: string): FileItem {
    return this.workspace.auth.transaction(() => {
      this.actor(user);
      const db = this.workspace.auth.database;
      const graph = this.graph(user, [id]);
      const root = graph.rows.find((row) => row.id === id);
      if (
        !root ||
        root.spaceId !== null ||
        root.position !== null ||
        root.trashedAt === null ||
        !root.trashBatch
      )
        throw unavailable();
      if (root.kind === 'space') {
        new SpaceLifecycleStore(this.workspace).restore(user, id);
        this.cleanGroups();
        return this.files.get(user, id);
      }
      if (
        root.trashedAt + this.retention <= this.workspace.auth.now() &&
        !recoveryProtected(db, id)
      )
        throw new AuthError(409, 'The 30-day recovery period has ended.');
      let parentId = root.parentId;
      if (parentId) {
        try {
          if (this.workspace.get(user, parentId, 'owner').kind !== 'folder') parentId = null;
        } catch (error) {
          if (!(error instanceof AuthError) || ![403, 404, 410].includes(error.status)) throw error;
          parentId = null;
        }
      }
      const children = this.children(graph.rows);
      const pending = [root];
      const change: Row[] = [];
      while (pending.length) {
        const row = pending.pop()!;
        if (row.trashBatch !== root.trashBatch) continue;
        if (row.trashedAt === null || row.trashedAt !== root.trashedAt) throw unavailable();
        change.push(row);
        if (row.kind !== 'space') pending.push(...(children.get(row.id) ?? []));
      }
      db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=? AND owner_id=?').run(
        parentId,
        id,
        user,
      );
      const update =
        db.prepare(`UPDATE workspace_items SET trashed_at=NULL,trash_batch=NULL,updated_at=?
        WHERE id=? AND owner_id=? AND trash_batch=? AND space_id IS NULL AND space_position IS NULL`);
      for (const row of change)
        if (update.run(this.workspace.auth.now(), row.id, user, root.trashBatch).changes !== 1)
          throw unavailable();
      // The restored group now resolves through the normal live boundaries.
      for (const row of change.filter((row) => row.kind === 'space'))
        this.files.get(user, row.id, 'owner');
      this.cleanGroups();
      return this.files.get(user, id);
    });
  }

  empty(user: string, version: unknown) {
    return this.workspace.auth.transaction(() => {
      const view = this.view(user);
      if (typeof version !== 'string' || version !== view.version)
        throw new AuthError(
          409,
          'Your trash changed. Review the complete contents before deleting.',
        );
      const children = this.children(view.rows);
      const byId = new Map(view.rows.map((row) => [row.id, row]));
      const counts = new Map(view.rows.map((row) => [row.id, children.get(row.id)?.length ?? 0]));
      const leaves = view.rows.filter((row) => counts.get(row.id) === 0);
      const order: Row[] = [];
      while (leaves.length) {
        const row = leaves.pop()!;
        order.push(row);
        if (row.parentId && byId.has(row.parentId)) {
          const remaining = counts.get(row.parentId)! - 1;
          counts.set(row.parentId, remaining);
          if (remaining === 0) leaves.push(byId.get(row.parentId)!);
        }
      }
      if (order.length !== view.rows.length) throw unavailable();
      const remove = this.workspace.auth.database.prepare(`DELETE FROM workspace_items
        WHERE id=? AND owner_id=? AND NOT EXISTS(SELECT 1 FROM workspace_items child WHERE child.parent_id=workspace_items.id)`);
      for (const row of order) if (remove.run(row.id, user).changes !== 1) throw unavailable();
      this.cleanGroups();
      return { count: order.length };
    });
  }

  private cleanGroups() {
    cleanRecoveryHolds(this.workspace.auth.database);
    this.workspace.auth.database.exec(`DELETE FROM workspace_retained_trash_batches
      WHERE NOT EXISTS(SELECT 1 FROM workspace_items i WHERE i.trash_batch=workspace_retained_trash_batches.batch)`);
  }
}
