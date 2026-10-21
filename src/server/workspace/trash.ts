import { createHash, randomUUID } from 'node:crypto';
import { AuthError } from '../auth/store.ts';
import type { TrashListing, TrashedItem } from '../../shared/workspace.ts';
import type { WorkspaceStore } from './store.ts';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const TRASH_RETENTION_MS = 30 * DAY_MS;
type TrashRow = { id: string; parent_id: string | null; trash_batch: string; trashed_at: number };

export class TrashStore {
  workspace: WorkspaceStore;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
  }
  list(owner: string): TrashListing {
    this.workspace.owner(owner);
    const rows = this.workspace.auth.database
      .prepare(
        `SELECT id,parent_id AS parentId,kind,name,created_at AS createdAt,
        updated_at AS updatedAt,trashed_at AS trashedAt,trash_batch AS batch,
        'owner' AS access FROM workspace_items WHERE owner_id=? AND trashed_at IS NOT NULL
        ORDER BY trashed_at DESC,id`,
      )
      .all(owner) as unknown as (TrashedItem & { batch: string })[];
    return {
      items: rows.map(({ batch: _batch, ...item }) => ({
        ...item,
        tags: this.workspace.ownTags(owner, item.id),
        expiresAt: item.trashedAt + TRASH_RETENTION_MS,
      })),
      // Bind confirmation to the exact set, including deletion generations, not just its count.
      version: createHash('sha256')
        .update(JSON.stringify(rows.map((row) => [row.id, row.batch])))
        .digest('hex'),
    };
  }
  trash(owner: string, id: string) {
    const { auth } = this.workspace;
    return auth.transaction(() => {
      this.workspace.get(owner, id, 'owner');
      const result = auth.database
        .prepare(
          `
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM workspace_items WHERE id=? AND owner_id=? AND trashed_at IS NULL
          UNION
          SELECT c.id FROM workspace_items c JOIN subtree p ON c.parent_id=p.id
          WHERE c.owner_id=? AND c.trashed_at IS NULL
        )
        UPDATE workspace_items SET trashed_at=?,trash_batch=? WHERE id IN (SELECT id FROM subtree)
      `,
        )
        .run(id, owner, owner, auth.now(), randomUUID());
      this.workspace.cleanPlacements();
      return { count: Number(result.changes) };
    });
  }
  restore(owner: string, id: string) {
    const { auth } = this.workspace;
    return auth.transaction(() => {
      this.workspace.owner(owner);
      const item = auth.database
        .prepare(
          `SELECT id,parent_id,trash_batch,trashed_at FROM workspace_items
        WHERE id=? AND owner_id=? AND trashed_at IS NOT NULL`,
        )
        .get(id, owner) as TrashRow | undefined;
      if (!item) throw new AuthError(404, 'This item is not in your trash.');
      if (item.trashed_at + TRASH_RETENTION_MS <= auth.now())
        throw new AuthError(409, 'The 30-day recovery period has ended.');
      const parent =
        item.parent_id &&
        auth.database
          .prepare(
            `SELECT id FROM workspace_items
        WHERE id=? AND owner_id=? AND kind='folder' AND trashed_at IS NULL`,
          )
          .get(item.parent_id, owner);
      auth.database
        .prepare('UPDATE workspace_items SET parent_id=? WHERE id=?')
        .run(parent ? item.parent_id : null, id);
      // Only this deletion batch is restored: earlier independently deleted children stay in trash.
      auth.database
        .prepare(
          `WITH RECURSIVE subtree(id) AS (
        SELECT id FROM workspace_items WHERE id=?
        UNION
        SELECT c.id FROM workspace_items c JOIN subtree p ON c.parent_id=p.id
        WHERE c.owner_id=? AND c.trash_batch=?
      ) UPDATE workspace_items SET trashed_at=NULL,trash_batch=NULL WHERE id IN (SELECT id FROM subtree)`,
        )
        .run(id, owner, item.trash_batch);
      return this.workspace.get(owner, id);
    });
  }
  empty(owner: string, version: unknown) {
    return this.workspace.auth.transaction(() => {
      const listing = this.list(owner);
      if (typeof version !== 'string' || version !== listing.version)
        throw new AuthError(409, 'Your trash changed. Review the new count before emptying it.');
      return { count: this.deleteRows(listing.items.map((item) => item.id)) };
    });
  }
  purgeExpired() {
    const { auth } = this.workspace;
    return auth.transaction(() => {
      const expired = auth.database
        .prepare('SELECT id FROM workspace_items WHERE trashed_at<=?')
        .all(auth.now() - TRASH_RETENTION_MS) as { id: string }[];
      return this.deleteRows(expired.map((item) => item.id));
    });
  }
  private deleteRows(ids: string[]) {
    const db = this.workspace.auth.database;
    const remove = db.prepare(`DELETE FROM workspace_items WHERE id=? AND trashed_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM workspace_items child WHERE child.parent_id=workspace_items.id)`);
    let remaining = ids;
    // Parent references are restrictive; delete leaves first. All callers hold one transaction.
    while (remaining.length) {
      const next = remaining.filter((id) => !remove.run(id).changes);
      if (next.length === remaining.length)
        throw new Error('Trash hierarchy could not be purged safely.');
      remaining = next;
    }
    return ids.length;
  }
}

export function startTrashCleanup(store: TrashStore) {
  const run = () => {
    try {
      store.purgeExpired();
    } catch (error) {
      console.error(
        'Trash cleanup failed; retained items will be retried on the next daily run.',
        error,
      );
    }
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
