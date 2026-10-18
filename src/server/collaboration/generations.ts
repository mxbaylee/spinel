import { randomUUID } from 'node:crypto';
import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from '../workspace/store.ts';

export type LiveGeneration = { itemId: string; unitId: string; offset: number };
export type RestoreJob = {
  id: string;
  itemId: string;
  userId: string;
  checkpointId: string;
  previousUnit: string;
  nextUnit: string;
  status: 'staging' | 'complete' | 'cancelled';
  revision: number | null;
};
const fields = `id,item_id AS itemId,user_id AS userId,checkpoint_id AS checkpointId,previous_unit AS previousUnit,
  next_unit AS nextUnit,status,revision`;

/** Application-owned restore receipts and active SDK IDs. No SDK storage is modified. */
export class CollaborationGenerations {
  private readonly workspace: WorkspaceStore;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
    workspace.auth.database.exec(`
      CREATE TABLE IF NOT EXISTS collaboration_units (
        item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
        unit_id TEXT NOT NULL UNIQUE, revision_offset INTEGER NOT NULL CHECK(revision_offset>=0)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS collaboration_restores (
        id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL, checkpoint_id TEXT NOT NULL, previous_unit TEXT NOT NULL, next_unit TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('staging','complete','cancelled')),
        revision INTEGER
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_restore ON collaboration_restores(item_id)
        WHERE status='staging';
      CREATE TABLE IF NOT EXISTS collaboration_purge (item_id TEXT PRIMARY KEY) STRICT;
      CREATE TRIGGER IF NOT EXISTS generation_deleted BEFORE DELETE ON workspace_items
      BEGIN
        INSERT OR IGNORE INTO collaboration_purge SELECT unit_id FROM collaboration_units WHERE item_id=OLD.id;
        INSERT OR IGNORE INTO collaboration_purge SELECT next_unit FROM collaboration_restores
          WHERE item_id=OLD.id AND status='staging';
      END;
    `);
  }

  active(itemId: string): LiveGeneration {
    const row = this.workspace.auth.database
      .prepare(
        'SELECT unit_id AS unitId,revision_offset AS offset FROM collaboration_units WHERE item_id=?',
      )
      .get(itemId) as { unitId: string; offset: number } | undefined;
    return { itemId, unitId: row?.unitId ?? itemId, offset: row?.offset ?? 0 };
  }

  /** An obsolete SDK ID must never fall back to the stable application ID. */
  resolve(unitId: string): LiveGeneration | undefined {
    const row = this.workspace.auth.database
      .prepare(
        'SELECT item_id AS itemId,revision_offset AS offset FROM collaboration_units WHERE unit_id=?',
      )
      .get(unitId) as { itemId: string; offset: number } | undefined;
    if (row) return { ...row, unitId };
    const original = this.workspace.auth.database
      .prepare(
        `SELECT id FROM workspace_items
      WHERE id=? AND kind IN ('sheet','doc') AND NOT EXISTS(
        SELECT 1 FROM collaboration_units WHERE item_id=workspace_items.id)`,
      )
      .get(unitId);
    return original ? { itemId: unitId, unitId, offset: 0 } : undefined;
  }

  restoring(itemId: string): boolean {
    return Boolean(
      this.workspace.auth.database
        .prepare("SELECT 1 FROM collaboration_restores WHERE item_id=? AND status='staging'")
        .get(itemId),
    );
  }

  private job(id: string): RestoreJob | undefined {
    return this.workspace.auth.database
      .prepare(`SELECT ${fields} FROM collaboration_restores WHERE id=?`)
      .get(id) as RestoreJob | undefined;
  }

  begin(
    userId: string,
    itemId: string,
    expectedUnit: string,
    requestId: string,
    checkpointId: string,
  ): RestoreJob {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
      throw new AuthError(400, 'Invalid restore request.');
    return this.workspace.auth.transaction(() => {
      const item = this.workspace.get(userId, itemId, 'edit');
      if (item.kind !== 'sheet' && item.kind !== 'doc') throw new AuthError(404, 'Not a document.');
      const previous = this.job(requestId);
      if (previous) {
        if (
          previous.itemId !== itemId ||
          previous.userId !== userId ||
          previous.checkpointId !== checkpointId
        )
          throw new AuthError(409, 'This restore request has already been used.');
        return previous; // Lost-response retries must not overwrite subsequent edits.
      }
      if (this.restoring(itemId)) throw new AuthError(409, 'Another restore is in progress.');
      if (this.active(itemId).unitId !== expectedUnit)
        throw new AuthError(409, 'This document changed. Reload before restoring.');
      const nextUnit = randomUUID();
      this.workspace.auth.database
        .prepare(
          `INSERT INTO collaboration_restores
        VALUES(?,?,?,?,?,?,'staging',NULL)`,
        )
        .run(requestId, itemId, userId, checkpointId, expectedUnit, nextUnit);
      return this.job(requestId)!;
    });
  }

  /**
   * Caller must finish admitted writes and create/validate the staged SDK unit first.
   * drainedRevision is the logical revision: SDK head + the current generation offset.
   * preserveBefore must write synchronously inside this application transaction.
   */
  finish(
    id: string,
    drainedRevision: number,
    preserveBefore: () => void,
    checkSession: () => void,
  ): RestoreJob {
    if (
      !Number.isSafeInteger(drainedRevision) ||
      drainedRevision < 1 ||
      drainedRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new AuthError(409, 'Invalid live revision.');
    return this.workspace.auth.transaction(() => {
      const job = this.job(id);
      if (!job) throw new AuthError(404, 'Restore request not found.');
      checkSession();
      this.workspace.get(job.userId, job.itemId, 'edit');
      if (job.status === 'complete') return job;
      if (job.status !== 'staging' || this.active(job.itemId).unitId !== job.previousUnit)
        throw new AuthError(409, 'Restore was cancelled. Reload and try again.');
      // All application changes commit together, including the exact pre-state and purge outbox.
      preserveBefore();
      const db = this.workspace.auth.database;
      db.prepare(
        `INSERT INTO collaboration_units VALUES(?,?,?) ON CONFLICT(item_id) DO UPDATE SET
        unit_id=excluded.unit_id,revision_offset=excluded.revision_offset`,
      ).run(job.itemId, job.nextUnit, drainedRevision);
      db.prepare("UPDATE collaboration_restores SET status='complete',revision=? WHERE id=?").run(
        drainedRevision + 1,
        id,
      );
      db.prepare('INSERT OR IGNORE INTO collaboration_purge VALUES(?)').run(job.previousUnit);
      return this.job(id)!;
    });
  }

  /** Call after any in-process staged creation settles, or before serving requests on restart. */
  cancel(id: string) {
    this.workspace.auth.transaction(() => {
      const job = this.job(id);
      if (!job || job.status !== 'staging') return;
      if (this.active(job.itemId).unitId === job.nextUnit)
        throw new Error('Refusing to purge the live restore generation.');
      const db = this.workspace.auth.database;
      db.prepare("UPDATE collaboration_restores SET status='cancelled' WHERE id=?").run(id);
      db.prepare('INSERT OR IGNORE INTO collaboration_purge VALUES(?)').run(job.nextUnit);
    });
  }

  recoverBeforeServing() {
    const rows = this.workspace.auth.database
      .prepare("SELECT id FROM collaboration_restores WHERE status='staging'")
      .all();
    for (const row of rows) this.cancel(String(row.id));
  }
}
