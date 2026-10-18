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

/** Application-owned recovery checkpoints guarded by current document access. */
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
      CREATE TABLE IF NOT EXISTS history_restore_labels (
        checkpoint_id TEXT PRIMARY KEY REFERENCES history_checkpoints(id) ON DELETE CASCADE
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
        await this.ensureInitial(
          context.userID,
          collaboration.itemForUnit(context.request.changeset.unitID),
        );
        await next();
      }),
    );
    this.subscriptions.push(
      collaboration.service.on('changesetCommitted', ({ changeset }) => {
        const generation = collaboration.generations.resolve(changeset.unitID);
        if (!generation) return;
        const now = workspace.auth.now();
        try {
          db.prepare(
            `INSERT INTO history_progress VALUES(?,'collaboration',?,?,0)
          ON CONFLICT(item_id,source) DO UPDATE SET revision=max(revision,excluded.revision),
          edited_at=max(edited_at,excluded.edited_at)`,
          ).run(generation.itemId, changeset.revision + generation.offset, now);
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
        "SELECT id,captured_at AS capturedAt,revision,name,source,EXISTS(SELECT 1 FROM history_restore_labels WHERE checkpoint_id=history_checkpoints.id) AS beforeRestore FROM history_checkpoints WHERE item_id=? ORDER BY captured_at DESC,(source='collaboration') DESC,revision DESC",
      )
      .all(id) as HistoryCheckpoint[];
  }

  private versionName(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
      throw new AuthError(400, 'Enter a version name between 1 and 120 characters.');
    return value.trim();
  }

  rename(user: string, id: string, checkpoint: string, value: unknown) {
    this.workspace.get(user, id, 'edit');
    const name = value === null ? null : this.versionName(value);
    const result = this.workspace.auth.database
      .prepare('UPDATE history_checkpoints SET name=? WHERE item_id=? AND id=?')
      .run(name, id, checkpoint);
    if (!result.changes) throw new AuthError(404, 'Version not found.');
  }

  /** Name exactly the confirmed state observed by this request, never an older coalesced capture. */
  async nameCurrent(user: string, id: string, value: unknown, checkSession = () => {}) {
    const name = this.versionName(value);
    this.workspace.get(user, id, 'edit');
    const db = this.workspace.auth.database;
    const state = () =>
      db.prepare('SELECT state FROM workspace_collaboration WHERE item_id=?').get(id)?.state;
    const before = state();
    if (before === 'preparing')
      throw new AuthError(409, 'The document is still opening. Try again.');
    const source: Source = before === 'ready' ? 'collaboration' : 'native';
    const data =
      source === 'collaboration' ? await this.collaboration.load(user, id) : this.native(user, id);
    if (!data) throw new AuthError(409, 'Save the document before naming this version.');
    const observedAt = this.workspace.auth.now();
    const bytes = Buffer.from(JSON.stringify(data.snapshot));
    if (bytes.length > 10 * 1024 * 1024)
      throw new AuthError(413, 'This document is too large to save.');
    const packed = await compress(bytes);
    return this.workspace.auth.transaction(() => {
      checkSession();
      this.workspace.get(user, id, 'edit');
      if (state() !== before) throw new AuthError(409, 'The document finished opening. Try again.');
      const checkpoint = randomUUID();
      db.prepare(
        `INSERT INTO history_checkpoints VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(item_id,source,revision) DO UPDATE SET name=excluded.name`,
      ).run(checkpoint, id, source, data.revision, observedAt, name, packed);
      return this.list(user, id).find(
        (point) => point.source === source && point.revision === data.revision,
      )!;
    });
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

  async restore(
    user: string,
    id: string,
    checkpoint: string,
    expectedUnit: string,
    requestId: string,
    checkSession = () => {},
  ) {
    this.workspace.get(user, id, 'edit');
    const snapshot = await this.load(user, id, checkpoint);
    return this.collaboration.restore(
      user,
      id,
      expectedUnit,
      requestId,
      checkpoint,
      snapshot,
      async (before) => {
        const text = JSON.stringify(before.snapshot);
        if (Buffer.byteLength(text) > 10 * 1024 * 1024)
          throw new AuthError(413, 'This document is too large to restore.');
        const packed = await compress(text);
        return () => {
          const db = this.workspace.auth.database;
          const now = this.workspace.auth.now();
          db.prepare(
            `INSERT INTO history_checkpoints VALUES(?,?,'collaboration',?,?,NULL,?)
          ON CONFLICT(item_id,source,revision) DO UPDATE SET snapshot=excluded.snapshot`,
          ).run(randomUUID(), id, before.revision, now, packed);
          const row = db
            .prepare(
              "SELECT id FROM history_checkpoints WHERE item_id=? AND source='collaboration' AND revision=?",
            )
            .get(id, before.revision)!;
          db.prepare('INSERT OR IGNORE INTO history_restore_labels VALUES(?)').run(row.id);
          db.prepare('UPDATE workspace_items SET updated_at=max(updated_at,?) WHERE id=?').run(
            now,
            id,
          );
        };
      },
      checkSession,
    );
  }

  prune(now = this.workspace.auth.now()) {
    const db = this.workspace.auth.database;
    this.workspace.auth.transaction(() => {
      for (const { item_id } of db
        .prepare('SELECT DISTINCT item_id FROM history_checkpoints')
        .all()) {
        const records = db
          .prepare(
            'SELECT id,captured_at AS capturedAt,revision,name,source,EXISTS(SELECT 1 FROM history_restore_labels WHERE checkpoint_id=history_checkpoints.id) AS beforeRestore FROM history_checkpoints WHERE item_id=?',
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
        const generation = this.collaboration.generations.active(id);
        const unit =
          source === 'collaboration'
            ? await this.collaboration.service.dbAdapter.getUnit(
                { userID: user, customData: {}, request: {} },
                generation.unitId,
              )
            : undefined;
        if (this.collaboration.generations.active(id).unitId !== generation.unitId) continue;
        const revision =
          source === 'collaboration'
            ? unit
              ? unit.headRevision + generation.offset
              : undefined
            : this.native(user, id)?.revision;
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
