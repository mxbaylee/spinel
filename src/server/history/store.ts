import { randomUUID } from 'node:crypto';
import { gzip, gzipSync, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { AuthError } from '../auth/store.ts';
import { expiredCheckpoints, MINUTE } from './policy.ts';
import type { Checkpoint } from './policy.ts';

const compress = promisify(gzip),
  decompress = promisify(gunzip);
type NativeSnapshot = IDocumentData | IWorkbookData;
type Progress = { revision: number; edited_at: number; captured_at: number };
type Source = 'native' | 'collaboration';
type HistoryCheckpoint = Checkpoint & { source: Source };

/** Application-owned recovery checkpoints; no network route grants access to this store. */
export class HistoryStore {
  private readonly workspace: WorkspaceStore;
  private readonly collaboration: CollaborationStore;
  private readonly captures = new Map<string, Promise<void>>();
  private readonly subscriptions: { dispose(): void }[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking: Promise<void> | undefined;
  private closing = false;

  constructor(workspace: WorkspaceStore, collaboration: CollaborationStore) {
    this.workspace = workspace;
    this.collaboration = collaboration;
    const db = workspace.auth.database;
    db.exec(`
      CREATE TABLE IF NOT EXISTS history_checkpoints (
        id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK(source IN ('native','collaboration')),
        revision INTEGER NOT NULL, captured_at INTEGER NOT NULL, name TEXT,
        snapshot BLOB NOT NULL, UNIQUE(item_id,source,revision)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS history_checkpoints_item_time ON history_checkpoints(item_id,captured_at);
      CREATE TABLE IF NOT EXISTS history_progress (
        item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK(source IN ('native','collaboration')),
        revision INTEGER NOT NULL, edited_at INTEGER NOT NULL, captured_at INTEGER NOT NULL,
        PRIMARY KEY(item_id,source)
      ) STRICT;
    `);
    this.subscriptions.push(
      workspace.onSnapshotSaved(({ id, before, after }) => {
        const now = workspace.auth.now();
        if (
          !db
            .prepare(
              "SELECT 1 FROM history_checkpoints WHERE item_id=? AND source='native' LIMIT 1",
            )
            .get(id)
        ) {
          // Native saves are synchronous and already bounded to 10 MiB. Preserve the prior
          // durable content atomically before it can be overwritten; for a new item keep its first save.
          const baseline = before ?? after;
          db.prepare("INSERT INTO history_checkpoints VALUES(?,?,'native',?,?,NULL,?)").run(
            randomUUID(),
            id,
            baseline.revision,
            now,
            gzipSync(baseline.snapshot),
          );
          db.prepare("INSERT OR IGNORE INTO history_progress VALUES(?,'native',?,?,?)").run(
            id,
            baseline.revision,
            now,
            now,
          );
        }
        db.prepare(
          `INSERT INTO history_progress VALUES(?,'native',?,?,0)
        ON CONFLICT(item_id,source) DO UPDATE SET revision=excluded.revision,edited_at=excluded.edited_at`,
        ).run(id, after.revision, now);
      }),
    );
    this.subscriptions.push(collaboration.onPrepared((user, id) => this.ensureInitial(user, id)));
    // Raw clients may skip the application preparation route; preserve their baseline too.
    this.subscriptions.push(
      collaboration.service.use('submitChangeset', async (context, next) => {
        await this.ensureInitial(context.userID, context.request.changeset.unitID);
        await next();
      }),
    );
    this.subscriptions.push(
      collaboration.service.on('changesetCommitted', ({ changeset }) => {
        const now = workspace.auth.now();
        try {
          db.prepare(
            `INSERT INTO history_progress VALUES(?,'collaboration',?,?,0)
          ON CONFLICT(item_id,source) DO UPDATE SET revision=max(revision,excluded.revision),
          edited_at=max(edited_at,excluded.edited_at)`,
          ).run(changeset.unitID, changeset.revision, now);
        } catch {
          // The edit is already durable. Reconcile this derived marker on the next scan.
          console.error('History change marker could not be saved; it will retry.');
        }
      }),
    );
  }

  private ensureInitial(user: string, id: string) {
    if (
      this.workspace.auth.database
        .prepare(
          "SELECT 1 FROM history_checkpoints WHERE item_id=? AND source='collaboration' LIMIT 1",
        )
        .get(id)
    )
      return Promise.resolve();
    return this.capture(user, id);
  }

  /** Coalesce simultaneous callers without allowing a newer edit to be marked captured. */
  capture(user: string, id: string, source: Source = 'collaboration'): Promise<void> {
    if (this.closing) return Promise.reject(new Error('History is closing.'));
    const key = `${source}:${id}`;
    const pending = this.captures.get(key);
    if (pending) return pending;
    const task = this.captureCurrent(user, id, source).finally(() => this.captures.delete(key));
    this.captures.set(key, task);
    return task;
  }

  private native(user: string, id: string) {
    const item = this.workspace.get(user, id);
    if (item.kind !== 'sheet' && item.kind !== 'doc') throw new AuthError(404, 'Not a document.');
    const table = item.kind === 'sheet' ? 'sheet_snapshots' : 'doc_snapshots';
    const row = this.workspace.auth.database
      .prepare(`SELECT snapshot,revision FROM ${table} WHERE item_id=?`)
      .get(id) as { snapshot: string; revision: number } | undefined;
    return row
      ? { snapshot: JSON.parse(row.snapshot) as NativeSnapshot, revision: row.revision }
      : undefined;
  }

  private async captureCurrent(user: string, id: string, source: Source) {
    const db = this.workspace.auth.database;
    const migrated = () =>
      source === 'native' &&
      db.prepare('SELECT 1 FROM workspace_collaboration WHERE item_id=?').get(id);
    // A scan's cached row may predate the migration fence. Never capture that old native copy.
    if (migrated()) return;
    const data =
      source === 'collaboration' ? await this.collaboration.load(user, id) : this.native(user, id);
    if (!data) return;
    const observedAt = this.workspace.auth.now();
    const bytes = Buffer.from(JSON.stringify(data.snapshot));
    if (bytes.length > 10 * 1024 * 1024)
      throw new Error('Checkpoint exceeds the document size limit.');
    const packed = await compress(bytes);
    this.workspace.auth.transaction(() => {
      this.workspace.get(user, id); // Revocation or deletion during compression must not bypass access.
      // Migration may finish while native compression yields. Its baseline supersedes this pending capture.
      if (migrated()) return;
      db.prepare('INSERT OR IGNORE INTO history_checkpoints VALUES(?,?,?,?,?,NULL,?)').run(
        randomUUID(),
        id,
        source,
        data.revision,
        observedAt,
        packed,
      );
      // A concurrent confirmed edit retains its newer revision and idle timestamp.
      db.prepare(
        `INSERT INTO history_progress VALUES(?,?,?,?,?) ON CONFLICT(item_id,source) DO UPDATE SET
        revision=max(revision,excluded.revision), captured_at=max(captured_at,excluded.captured_at)`,
      ).run(id, source, data.revision, observedAt, observedAt);
    });
  }

  list(user: string, id: string): HistoryCheckpoint[] {
    this.workspace.get(user, id);
    return this.workspace.auth.database
      .prepare(
        "SELECT id,captured_at AS capturedAt,revision,name,source FROM history_checkpoints WHERE item_id=? ORDER BY captured_at DESC,(source='collaboration') DESC,revision DESC",
      )
      .all(id) as HistoryCheckpoint[];
  }

  async load(user: string, id: string, checkpoint: string): Promise<NativeSnapshot> {
    this.workspace.get(user, id);
    const row = this.workspace.auth.database
      .prepare('SELECT snapshot FROM history_checkpoints WHERE item_id=? AND id=?')
      .get(id, checkpoint) as { snapshot: Uint8Array } | undefined;
    if (!row) throw new AuthError(404, 'Version not found.');
    const bytes = await decompress(row.snapshot, { maxOutputLength: 10 * 1024 * 1024 });
    this.workspace.get(user, id);
    return JSON.parse(bytes.toString()) as NativeSnapshot;
  }

  prune(now = this.workspace.auth.now()) {
    const db = this.workspace.auth.database;
    this.workspace.auth.transaction(() => {
      for (const { item_id } of db
        .prepare('SELECT DISTINCT item_id FROM history_checkpoints')
        .all()) {
        const records = db
          .prepare(
            'SELECT id,captured_at AS capturedAt,revision,name,source FROM history_checkpoints WHERE item_id=?',
          )
          .all(item_id) as Checkpoint[];
        for (const id of expiredCheckpoints(records, now))
          db.prepare('DELETE FROM history_checkpoints WHERE id=?').run(id);
      }
    });
    // Images are deliberately retained. An unreferenced upload may still be in an offline edit.
  }

  tick(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (this.ticking) return this.ticking;
    this.ticking = this.scan().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }

  private async scan() {
    const db = this.workspace.auth.database;
    const rows = db
      .prepare(
        `SELECT w.id,w.owner_id,c.state FROM workspace_items w LEFT JOIN workspace_collaboration c ON c.item_id=w.id
      WHERE (c.state='ready' OR c.state IS NULL) AND w.kind IN ('sheet','doc') AND w.trashed_at IS NULL ORDER BY w.id`,
      )
      .all() as { id: string; owner_id: string; state: string | null }[];
    // Use the same resolver as requests, including inherited grants and disabled users.
    // A disabled owner must not stop history for an active collaborator. No bypass identity is created.
    const users = db
      .prepare('SELECT id FROM auth_users WHERE disabled=0 AND is_admin=0 ORDER BY id')
      .all() as { id: string }[];
    for (const { id, owner_id, state } of rows) {
      if (this.closing) break;
      try {
        const user = [owner_id, ...users.map((u) => u.id)].find((candidate) => {
          try {
            this.workspace.get(candidate, id);
            return true;
          } catch (error) {
            if (error instanceof AuthError) return false;
            throw error;
          }
        });
        if (!user) continue;
        const source: Source = state === 'ready' ? 'collaboration' : 'native';
        // Public adapter metadata repairs a missed commit event after an interrupted process.
        const unit =
          source === 'collaboration'
            ? await this.collaboration.service.dbAdapter.getUnit(
                { userID: user, customData: {}, request: {} },
                id,
              )
            : undefined;
        const revision =
          source === 'collaboration' ? unit?.headRevision : this.native(user, id)?.revision;
        if (revision === undefined) continue;
        const now = this.workspace.auth.now();
        let progress = db
          .prepare(
            'SELECT revision,edited_at,captured_at FROM history_progress WHERE item_id=? AND source=?',
          )
          .get(id, source) as Progress | undefined;
        if (!progress) {
          await this.capture(user, id, source);
          continue;
        }
        if (revision > progress.revision) {
          db.prepare(
            'UPDATE history_progress SET revision=?,edited_at=? WHERE item_id=? AND source=?',
          ).run(revision, now, id, source);
          progress = { ...progress, revision, edited_at: now };
        }
        const latest = db
          .prepare(
            'SELECT max(revision) AS revision FROM history_checkpoints WHERE item_id=? AND source=?',
          )
          .get(id, source) as { revision: number | null };
        if (
          (latest.revision ?? 0) < progress.revision &&
          (now - progress.captured_at >= 5 * MINUTE || now - progress.edited_at >= MINUTE)
        )
          await this.capture(user, id, source);
      } catch (error) {
        // Trashed/deleted documents are intentionally inaccessible; retain their existing history.
        if (error instanceof AuthError) continue;
        // No contents or credentials in logs. Dirty revision stays durable for the next pass.
        console.error('History checkpoint could not be saved; it will retry.');
      }
    }
    this.prune();
  }

  start() {
    if (this.timer || this.closing) return;
    const run = () => {
      void this.tick().catch(() => console.error('History maintenance will retry.'));
    };
    run();
    this.timer = setInterval(run, 30_000);
    this.timer.unref();
  }

  async close() {
    this.closing = true;
    clearInterval(this.timer);
    for (const subscription of this.subscriptions) subscription.dispose();
    await Promise.allSettled([this.ticking, ...this.captures.values()]);
  }
}
