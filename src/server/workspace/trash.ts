import { createHash, randomUUID } from 'node:crypto';
import { AuthError } from '../auth/store.ts';
import type { TrashListing, TrashedItem } from '../../shared/workspace.ts';
import type { WorkspaceStore } from './store.ts';
import { classifyOrdinaryItems, isOrdinaryItem } from './ordinary-scope.ts';
import { FileTrash } from './file-trash.ts';
import { SpaceExpiry } from './space-expiry.ts';
import { DAY_MS, TRASH_RETENTION_MS } from './trash-retention.ts';
import { observeJob } from '../health/jobs.ts';
import type { ObserveJob } from '../health/jobs.ts';

export { DAY_MS, TRASH_RETENTION_MS } from './trash-retention.ts';
type TrashRow = { id: string; parent_id: string | null; trash_batch: string; trashed_at: number };
type TreeRow = { id: string; parentId: string | null };
const MAX_TRASH_ITEMS = 10_000;
const overBudget = () =>
  new AuthError(413, 'This trash operation is too large to process at once.');

export class TrashStore {
  workspace: WorkspaceStore;
  private readonly files: FileTrash;
  private readonly spaces: SpaceExpiry;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
    this.files = new FileTrash(workspace, TRASH_RETENTION_MS);
    this.spaces = new SpaceExpiry(workspace);
  }
  list(owner: string): TrashListing {
    if (this.workspace.spacesEnabled) return this.files.list(owner);
    this.workspace.owner(owner);
    const database = this.workspace.auth.database;
    const found = database
      .prepare(
        `SELECT id,parent_id AS parentId,kind,name,created_at AS createdAt,
        updated_at AS updatedAt,trashed_at AS trashedAt,trash_batch AS batch,
        'owner' AS access FROM workspace_items WHERE owner_id=? AND trashed_at IS NOT NULL
        ORDER BY trashed_at DESC,id LIMIT ?`,
      )
      .all(owner, MAX_TRASH_ITEMS + 1) as unknown as (TrashedItem & { batch: string })[];
    const ordinary = this.ordinary(found.map((row) => row.id));
    // Internal recovery has its own boundary. Filter before names, tags, counts
    // or confirmation generations can escape through ordinary My files Trash.
    const rows = found.filter((item) => ordinary.has(item.id));
    const tags = database.prepare(
      'SELECT name FROM workspace_tag_assignments WHERE user_id=? AND item_id=? ORDER BY name LIMIT ?',
    );
    let tagCount = 0;
    return {
      items: rows.map(({ batch: _batch, ...item }) => {
        // The owner and entire structural batch were checked above. Repeating
        // ownTags' single-item ancestry check here makes a deep list quadratic.
        const names = tags.all(owner, item.id, MAX_TRASH_ITEMS - tagCount + 1);
        tagCount += names.length;
        if (tagCount > MAX_TRASH_ITEMS) throw overBudget();
        return {
          ...item,
          tags: names.map((tag) => String(tag.name)),
          expiresAt: item.trashedAt + TRASH_RETENTION_MS,
        };
      }),
      // Bind confirmation to the exact set, including deletion generations, not just its count.
      version: createHash('sha256')
        .update(JSON.stringify(rows.map((row) => [row.id, row.batch])))
        .digest('hex'),
    };
  }
  trash(owner: string, id: string) {
    if (this.workspace.spacesEnabled) return this.files.trash(owner, id);
    const { auth } = this.workspace;
    return auth.transaction(() => {
      this.workspace.get(owner, id, 'admin');
      const actualOwner = this.workspace.fileOwner(id);
      this.requireOrdinarySubtree(id);
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
        .run(id, actualOwner, actualOwner, auth.now(), randomUUID());
      this.workspace.cleanPlacements();
      return { count: Number(result.changes) };
    });
  }
  restore(owner: string, id: string) {
    if (this.workspace.spacesEnabled) return this.files.restore(owner, id);
    const { auth } = this.workspace;
    return auth.transaction(() => {
      this.workspace.owner(owner);
      const item = auth.database
        .prepare(
          `SELECT id,parent_id,trash_batch,trashed_at FROM workspace_items
        WHERE id=? AND owner_id=? AND trashed_at IS NOT NULL`,
        )
        .get(id, owner) as TrashRow | undefined;
      if (!item || !isOrdinaryItem(auth.database, id))
        throw new AuthError(404, 'This item is not in your trash.');
      this.requireOrdinarySubtree(id);
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
    if (this.workspace.spacesEnabled) return this.files.empty(owner, version);
    return this.workspace.auth.transaction(() => {
      const listing = this.list(owner);
      if (typeof version !== 'string' || version !== listing.version)
        throw new AuthError(409, 'Your trash changed. Review the new count before emptying it.');
      return { count: this.deleteRows(listing.items.map((item) => item.id)) };
    });
  }
  purgeExpired(observeSpaces?: ObserveJob) {
    const { auth } = this.workspace;
    const spaces = this.spaces.purgeExpired(observeSpaces);
    const ordinary = auth.transaction(() => {
      // Explicit Space members never consume ordinary cleanup's candidate limit.
      // Complete subtree validation still protects malformed/unmarked members.
      const membership = this.membership('workspace_items');
      const expired = auth.database
        .prepare(
          `SELECT id FROM workspace_items WHERE trashed_at<=? AND kind<>'space' ${membership}
          ${this.workspace.spacesEnabled ? '' : 'AND NOT EXISTS(SELECT 1 FROM workspace_retained_trash_batches b WHERE b.batch=workspace_items.trash_batch)'} LIMIT ?`,
        )
        .all(auth.now() - TRASH_RETENTION_MS, MAX_TRASH_ITEMS + 1) as { id: string }[];
      return this.deleteRows(expired.map((item) => item.id));
    });
    if (spaces.failed)
      throw new Error(`Trash cleanup retained ${spaces.failed} invalid Space groups.`);
    return ordinary + spaces.count;
  }
  private deleteRows(ids: string[]) {
    const db = this.workspace.auth.database;
    if (!ids.length) return 0;
    const graph = this.subtree(ids);
    const ordinary = this.ordinary(graph.map((row) => row.id));
    const parents = new Map(graph.map((row) => [row.id, row.parentId]));
    const children = new Map<string, string[]>();
    for (const { id, parentId } of graph) {
      if (parentId === null) continue;
      const siblings = children.get(parentId) ?? [];
      siblings.push(id);
      children.set(parentId, siblings);
    }
    // Propagate hidden descendants to their ancestors once, then retain every
    // node of each affected requested subtree. No ancestry is re-read per leaf.
    const unsafe = new Set(graph.filter((row) => !ordinary.has(row.id)).map((row) => row.id));
    const ancestors = [...unsafe];
    while (ancestors.length) {
      const parent = parents.get(ancestors.pop()!);
      if (parent && parents.has(parent) && !unsafe.has(parent)) {
        unsafe.add(parent);
        ancestors.push(parent);
      }
    }
    const blocked = new Set<string>();
    const descendants = ids.filter((id) => ordinary.has(id) && unsafe.has(id));
    while (descendants.length) {
      const id = descendants.pop()!;
      if (blocked.has(id)) continue;
      blocked.add(id);
      for (const child of children.get(id) ?? []) descendants.push(child);
    }
    // Retain the entire requested outer subtree if it contains a hidden Space.
    // Unrelated ordinary trash can still expire or be emptied. In particular,
    // internal tombstones are handled only by the dedicated Space cleanup.
    const eligible = new Set(ids.filter((id) => ordinary.has(id) && !blocked.has(id)));
    const childCounts = new Map([...eligible].map((id) => [id, children.get(id)?.length ?? 0]));
    const leaves = [...eligible].filter((id) => childCounts.get(id) === 0);
    const order: string[] = [];
    while (leaves.length) {
      const id = leaves.pop()!;
      order.push(id);
      const parent = parents.get(id);
      if (parent && eligible.has(parent)) {
        const remaining = childCounts.get(parent)! - 1;
        childCounts.set(parent, remaining);
        if (remaining === 0) leaves.push(parent);
      }
    }
    if (order.length !== eligible.size)
      throw new Error('Trash hierarchy could not be purged safely.');
    const remove = db.prepare(`DELETE FROM workspace_items WHERE id=? AND trashed_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM workspace_items child WHERE child.parent_id=workspace_items.id)`);
    // The complete leaf-first plan is validated before deletion. Each item is
    // deleted once instead of retrying every ancestor after each removed leaf.
    for (const id of order)
      if (remove.run(id).changes !== 1)
        throw new Error('Trash hierarchy could not be purged safely.');
    return order.length;
  }
  private subtree(ids: readonly string[]): TreeRow[] {
    if (ids.length > MAX_TRASH_ITEMS) throw overBudget();
    if (!ids.length) return [];
    const rows = this.workspace.auth.database
      .prepare(
        `WITH RECURSIVE subtree(id) AS (
          SELECT id FROM workspace_items WHERE id IN (${ids.map(() => '?').join(',')})
          UNION
          SELECT c.id FROM workspace_items c JOIN subtree p ON c.parent_id=p.id
          JOIN workspace_items parent ON parent.id=p.id
          WHERE parent.kind<>'space' ${this.membership('parent')}
          LIMIT ?
        ) SELECT i.id,i.parent_id AS parentId FROM subtree JOIN workspace_items i ON i.id=subtree.id`,
      )
      .all(...ids, MAX_TRASH_ITEMS + 1) as unknown as TreeRow[];
    if (rows.length > MAX_TRASH_ITEMS) throw overBudget();
    return rows;
  }
  private ordinary(ids: readonly string[]): Set<string> {
    const ordinary = classifyOrdinaryItems(this.workspace.auth.database, ids);
    if (!ordinary) throw overBudget();
    return ordinary;
  }
  private membership(alias: string) {
    const columns = this.workspace.auth.database
      .prepare("SELECT 1 FROM pragma_table_info('workspace_items') WHERE name='space_id'")
      .get();
    return columns ? `AND ${alias}.space_id IS NULL AND ${alias}.space_position IS NULL` : '';
  }
  private requireOrdinarySubtree(id: string) {
    const subtree = this.subtree([id]);
    if (this.ordinary(subtree.map((row) => row.id)).size !== subtree.length)
      throw new AuthError(409, 'This item cannot be changed here.');
  }
}

export function startTrashCleanup(
  store: TrashStore,
  observe?: ObserveJob,
  observeSpaces?: ObserveJob,
) {
  const run = () => {
    const finish = observeJob(observe);
    try {
      store.purgeExpired(observeSpaces);
      finish(true);
    } catch {
      finish(false);
      console.error('Trash cleanup failed; retained items will be retried on the next daily run.');
    }
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
