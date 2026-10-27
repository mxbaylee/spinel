import { deleteSpaceItems, readSpaceStructure } from './space-structure.ts';
import type { WorkspaceStore } from './store.ts';
import { TRASH_RETENTION_MS } from './trash-retention.ts';
import { observeJob } from '../health/jobs.ts';
import type { ObserveJob } from '../health/jobs.ts';

// Scan one indexed page of roots and validate at most 10,000 members per Space.
// Yield between Spaces after one second or 16 eligible roots; the cursor also
// advances past live roots and malformed retained trees.
export const MAX_SPACE_EXPIRY_ROOTS = 16;
export const MAX_SPACE_EXPIRY_CANDIDATES = 256;
const MAX_RUN_MS = 1_000;
type Candidate = {
  id: string;
  ownerId: string;
  trashedAt: number | null;
  trashBatch: string | null;
};
const fields = 'id,owner_id AS ownerId,trashed_at AS trashedAt,trash_batch AS trashBatch';

/** System-only cleanup; it never grants an account access to deleted content. */
export class SpaceExpiry {
  private readonly workspace: WorkspaceStore;
  private after = '';
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
  }

  purgeExpired(observe?: ObserveJob): { count: number; failed: number } {
    if (!this.workspace.spacesEnabled) return { count: 0, failed: 0 };
    const finish = observeJob(observe);
    try {
      const result = this.sweep();
      finish(result.failed === 0);
      return result;
    } catch (error) {
      finish(false);
      throw error;
    }
  }

  private sweep() {
    const { auth } = this.workspace;
    const db = auth.database;
    const cutoff = auth.now() - TRASH_RETENTION_MS;
    const started = performance.now();
    const candidates = db
      .prepare(
        `SELECT ${fields} FROM workspace_items INDEXED BY workspace_space_expiry_roots
      WHERE kind='space' AND space_id IS NULL AND space_position IS NULL AND id>?
      ORDER BY id LIMIT ?`,
      )
      .all(this.after, MAX_SPACE_EXPIRY_CANDIDATES) as Candidate[];
    const internal = db.prepare(
      'SELECT 1 FROM workspace_space_trash WHERE space_id=? AND trashed_at<=? LIMIT 1',
    );
    let count = 0,
      failed = 0,
      checked = 0,
      visited = 0;
    for (const candidate of candidates) {
      if (
        checked === MAX_SPACE_EXPIRY_ROOTS ||
        (visited && performance.now() - started >= MAX_RUN_MS)
      )
        break;
      this.after = candidate.id;
      visited++;
      if (
        !(candidate.trashedAt !== null && candidate.trashedAt <= cutoff) &&
        !internal.get(candidate.id, cutoff)
      )
        continue;
      checked++;
      try {
        count += auth.transaction(() => {
          // A handover, restore, or restore/retrash since candidate selection is
          // a different deletion identity. The next sweep reconsiders it.
          const root = db
            .prepare(
              `SELECT ${fields} FROM workspace_items
            WHERE id=? AND owner_id=? AND kind='space' AND space_id IS NULL
              AND space_position IS NULL AND trashed_at IS ? AND trash_batch IS ?`,
            )
            .get(candidate.id, candidate.ownerId, candidate.trashedAt, candidate.trashBatch) as
            Candidate | undefined;
          if (!root) return 0;
          if (
            root.trashedAt === null
              ? root.trashBatch !== null
              : !Number.isSafeInteger(root.trashedAt) || root.trashedAt < 0 || !root.trashBatch
          )
            throw new Error('Invalid Space deletion identity.');
          const owner = db.prepare('SELECT is_admin FROM auth_users WHERE id=?').get(root.ownerId);
          if (!owner || owner.is_admin) throw new Error('Invalid Space ownership.');
          // Disabled owners keep the original retention window. This is storage
          // validation only; no disabled account or Operator is impersonated.
          const structure = readSpaceStructure(db, root.id, root.ownerId);
          const expired = auth.now() - TRASH_RETENTION_MS;
          const whole = root.trashedAt !== null && root.trashedAt <= expired;
          const items = whole
            ? structure.items
            : structure.items.filter(
                (item) => item.trashedAt !== null && item.trashedAt <= expired,
              );
          // Validated internal batches have identical timestamps throughout and
          // detached roots. Filtering cannot include part of a retained batch.
          deleteSpaceItems(db, root.id, root.ownerId, items);
          if (whole) {
            const removed = db
              .prepare(
                `DELETE FROM workspace_items
              WHERE id=? AND owner_id=? AND kind='space' AND space_id IS NULL
                AND trashed_at=? AND trash_batch=?
                AND NOT EXISTS(SELECT 1 FROM workspace_items c WHERE c.parent_id=workspace_items.id)`,
              )
              .run(root.id, root.ownerId, root.trashedAt, root.trashBatch);
            if (removed.changes !== 1) throw new Error('Space deletion identity changed.');
          }
          return items.length + Number(whole);
        });
      } catch {
        // Keep the complete failed transaction, continue unrelated work, and
        // report status without titles, IDs, locations, or arbitrary SQL errors.
        failed++;
      }
    }
    if (visited === candidates.length && candidates.length < MAX_SPACE_EXPIRY_CANDIDATES)
      this.after = '';
    return { count, failed };
  }
}
