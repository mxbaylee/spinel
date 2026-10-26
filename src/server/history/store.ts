import { DocumentStore } from '../workspace/documents.ts';
import { randomUUID } from 'node:crypto';
import { gzip, gzipSync, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import {
  createHistoryReadContext,
  resolveDocument,
  validateDocumentCredentials,
} from '../workspace/document-access.ts';
import {
  classifyOrdinaryItems,
  isOrdinaryItem,
  MAX_ANCESTOR_READS,
} from '../workspace/ordinary-scope.ts';
import { AuthError } from '../auth/store.ts';
import { expiredCheckpoints, MINUTE } from './policy.ts';
import type { Checkpoint } from './policy.ts';
import { observeJob } from '../health/jobs.ts';
import type { ObserveJob } from '../health/jobs.ts';

const compress = promisify(gzip),
  decompress = promisify(gunzip);
type NativeSnapshot = IDocumentData | IWorkbookData;
type Progress = { revision: number; edited_at: number; captured_at: number };
type Source = 'native' | 'collaboration';
type HistoryCheckpoint = Checkpoint & { source: Source };
type MaintenanceItem = { id: string; owner_id: string; state: string | null; space_id?: string };

/** Application-owned recovery checkpoints guarded by current document access. */
export class HistoryStore {
  private readonly workspace: WorkspaceStore;
  private readonly collaboration: CollaborationStore;
  private readonly captures = new Map<string, Promise<void>>();
  // Successful reads establish support, never permission. Retention resolves
  // current access again and leaves every deferred/unsupported child untouched.
  private readonly maintainedSpaces = new Set<string>();
  private readonly subscriptions: { dispose(): void }[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking: Promise<void> | undefined;
  private closing = false;
  private readonly observeMaintenance?: ObserveJob;

  constructor(
    workspace: WorkspaceStore,
    collaboration: CollaborationStore,
    observeMaintenance?: ObserveJob,
  ) {
    this.workspace = workspace;
    this.collaboration = collaboration;
    this.observeMaintenance = observeMaintenance;
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
    this.subscriptions.push(
      collaboration.onPrepared((user, id, custom) => this.ensureInitial(user, id, custom)),
    );
    // Raw clients may skip the application preparation route; preserve their baseline too.
    this.subscriptions.push(
      collaboration.onSubmitting(async (context, unitId) => {
        const id = collaboration.itemForUnit(unitId);
        await this.ensureInitial(context.userID, id, context.customData);
      }),
    );
    this.subscriptions.push(
      collaboration.onCommitted((changeset) => {
        const generation = collaboration.generations.resolve(changeset.unitID);
        if (!generation) return;
        const now = workspace.auth.now();
        try {
          if (!isOrdinaryItem(db, generation.itemId)) {
            if (!workspace.spacesEnabled) return;
            const member = db
              .prepare('SELECT owner_id,space_id FROM workspace_items WHERE id=?')
              .get(generation.itemId) as { owner_id: string; space_id: string | null } | undefined;
            if (!member?.space_id) return;
            const custom = createHistoryReadContext(
              workspace,
              member.owner_id,
              member.space_id,
              generation.itemId,
            );
            resolveDocument(workspace, member.owner_id, generation.itemId, 'read', custom);
          }
          db.prepare(
            `INSERT INTO history_progress VALUES(?,'collaboration',?,?,0)
          ON CONFLICT(item_id,source) DO UPDATE SET revision=max(revision,excluded.revision),
          edited_at=max(edited_at,excluded.edited_at)`,
          ).run(generation.itemId, changeset.revision + generation.offset, now);
        } catch (error) {
          if (error instanceof AuthError) return;
          // The edit is already durable. Reconcile this derived marker on the next scan.
          console.error('History change marker could not be saved; it will retry.');
        }
      }),
    );
  }

  private ensureInitial(user: string, id: string, customData: Record<string, unknown> = {}) {
    resolveDocument(this.workspace, user, id, 'read', customData);
    customData = Object.freeze({ ...customData });
    if (
      this.workspace.auth.database
        .prepare(
          "SELECT 1 FROM history_checkpoints WHERE item_id=? AND source='collaboration' LIMIT 1",
        )
        .get(id)
    )
      return Promise.resolve().then(() => {
        resolveDocument(this.workspace, user, id, 'read', customData);
      });
    return this.capture(user, id, 'collaboration', customData);
  }

  /** Coalesce simultaneous callers without allowing a newer edit to be marked captured. */
  async capture(
    user: string,
    id: string,
    source: Source = 'collaboration',
    customData: Record<string, unknown> = {},
  ): Promise<void> {
    if (this.closing) throw new Error('History is closing.');
    resolveDocument(this.workspace, user, id, 'read', customData);
    customData = Object.freeze({ ...customData });
    const generation =
      source === 'collaboration' ? this.collaboration.generations.active(id) : undefined;
    const key = `${source}:${id}`;
    const pending = this.captures.get(key);
    const task =
      pending ??
      this.captureCurrent(user, id, source, customData).finally(() => this.captures.delete(key));
    if (!pending) this.captures.set(key, task);
    await task;
    // Sharing compression work never shares the initiating caller's authority.
    resolveDocument(this.workspace, user, id, 'read', customData);
    if (generation) {
      const current = this.collaboration.generations.active(id);
      if (current.unitId !== generation.unitId || current.offset !== generation.offset)
        throw new AuthError(409, 'The document changed while saving history. Try again.');
    }
  }

  private native(user: string, id: string, customData: Record<string, unknown> = {}) {
    const item = resolveDocument(this.workspace, user, id, 'read', customData);
    if (item.kind !== 'sheet' && item.kind !== 'doc') throw new AuthError(404, 'Not a document.');
    const table = item.kind === 'sheet' ? 'sheet_snapshots' : 'doc_snapshots';
    const row = this.workspace.auth.database
      .prepare(`SELECT snapshot,revision FROM ${table} WHERE item_id=?`)
      .get(id) as { snapshot: string; revision: number } | undefined;
    return row
      ? { snapshot: JSON.parse(row.snapshot) as NativeSnapshot, revision: row.revision }
      : undefined;
  }

  private async captureCurrent(
    user: string,
    id: string,
    source: Source,
    customData: Record<string, unknown>,
  ) {
    const db = this.workspace.auth.database;
    const migrated = () =>
      source === 'native' &&
      db.prepare('SELECT 1 FROM workspace_collaboration WHERE item_id=?').get(id);
    // A scan's cached row may predate the migration fence. Never capture that old native copy.
    if (migrated()) return;
    const generation =
      source === 'collaboration' ? this.collaboration.generations.active(id) : undefined;
    const data =
      source === 'collaboration'
        ? await this.collaboration.load(user, id, customData)
        : this.native(user, id, customData);
    resolveDocument(this.workspace, user, id, 'read', customData);
    if (!data) return;
    const observedAt = this.workspace.auth.now();
    const bytes = Buffer.from(JSON.stringify(data.snapshot));
    if (bytes.length > 10 * 1024 * 1024)
      throw new Error('Checkpoint exceeds the document size limit.');
    const packed = await compress(bytes);
    this.workspace.auth.transaction(() => {
      resolveDocument(this.workspace, user, id, 'read', customData);
      // Migration may finish while native compression yields. Its baseline supersedes this pending capture.
      if (migrated()) return;
      if (generation) {
        const current = this.collaboration.generations.active(id);
        if (current.unitId !== generation.unitId || current.offset !== generation.offset)
          throw new AuthError(409, 'The document changed while saving history. Try again.');
      }
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
      if (typeof customData.spaceId === 'string') this.maintainedSpaces.add(id);
    });
  }

  private accountAccess(
    user: string,
    id: string,
    mode: 'read' | 'edit',
    customData: Record<string, unknown>,
  ) {
    const family = validateDocumentCredentials(this.workspace, user, customData, mode === 'edit');
    if (
      (family !== 'account' && family !== 'trusted') ||
      (family !== 'account' && ('spaceId' in customData || 'spaceItem' in customData))
    )
      throw new AuthError(404, 'Version not found.');
    return resolveDocument(this.workspace, user, id, mode, customData);
  }

  list(user: string, id: string, customData: Record<string, unknown> = {}): HistoryCheckpoint[] {
    this.accountAccess(user, id, 'read', customData);
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

  rename(
    user: string,
    id: string,
    checkpoint: string,
    value: unknown,
    customData: Record<string, unknown> = {},
  ) {
    this.accountAccess(user, id, 'edit', customData);
    const name = value === null ? null : this.versionName(value);
    const result = this.workspace.auth.database
      .prepare('UPDATE history_checkpoints SET name=? WHERE item_id=? AND id=?')
      .run(name, id, checkpoint);
    if (!result.changes) throw new AuthError(404, 'Version not found.');
  }

  /** Name exactly the confirmed state observed by this request, never an older coalesced capture. */
  async nameCurrent(
    user: string,
    id: string,
    value: unknown,
    checkSession = () => {},
    customData: Record<string, unknown> = {},
  ) {
    const name = this.versionName(value);
    checkSession();
    this.accountAccess(user, id, 'edit', customData);
    customData = Object.freeze({ ...customData });
    const db = this.workspace.auth.database;
    const state = () =>
      db.prepare('SELECT state FROM workspace_collaboration WHERE item_id=?').get(id)?.state;
    const before = state();
    if (before === 'preparing')
      throw new AuthError(409, 'The document is still opening. Try again.');
    const source: Source = before === 'ready' ? 'collaboration' : 'native';
    const generation =
      source === 'collaboration' ? this.collaboration.generations.active(id) : undefined;
    const data =
      source === 'collaboration'
        ? await this.collaboration.load(user, id, customData)
        : this.native(user, id, customData);
    checkSession();
    this.accountAccess(user, id, 'edit', customData);
    if (!data) throw new AuthError(409, 'Save the document before naming this version.');
    const observedAt = this.workspace.auth.now();
    const bytes = Buffer.from(JSON.stringify(data.snapshot));
    if (bytes.length > 10 * 1024 * 1024)
      throw new AuthError(413, 'This document is too large to save.');
    const packed = await compress(bytes);
    return this.workspace.auth.transaction(() => {
      checkSession();
      this.accountAccess(user, id, 'edit', customData);
      if (state() !== before) throw new AuthError(409, 'The document finished opening. Try again.');
      if (generation) {
        const current = this.collaboration.generations.active(id);
        if (current.unitId !== generation.unitId || current.offset !== generation.offset)
          throw new AuthError(409, 'The document changed while naming this version. Try again.');
      }
      const checkpoint = randomUUID();
      db.prepare(
        `INSERT INTO history_checkpoints VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(item_id,source,revision) DO UPDATE SET name=excluded.name`,
      ).run(checkpoint, id, source, data.revision, observedAt, name, packed);
      return this.list(user, id, customData).find(
        (point) => point.source === source && point.revision === data.revision,
      )!;
    });
  }

  async load(
    user: string,
    id: string,
    checkpoint: string,
    customData: Record<string, unknown> = {},
  ): Promise<NativeSnapshot> {
    this.accountAccess(user, id, 'read', customData);
    customData = Object.freeze({ ...customData });
    const row = this.workspace.auth.database
      .prepare('SELECT snapshot FROM history_checkpoints WHERE item_id=? AND id=?')
      .get(id, checkpoint) as { snapshot: Uint8Array } | undefined;
    if (!row) throw new AuthError(404, 'Version not found.');
    const bytes = await decompress(row.snapshot, { maxOutputLength: 10 * 1024 * 1024 });
    this.accountAccess(user, id, 'read', customData);
    const snapshot = JSON.parse(bytes.toString()) as NativeSnapshot;
    new DocumentStore(this.workspace).validateImages(id, snapshot);
    return snapshot;
  }

  async restore(
    user: string,
    id: string,
    checkpoint: string,
    expectedUnit: string,
    requestId: string,
    checkSession = () => {},
    customData: Record<string, unknown> = {},
  ) {
    checkSession();
    this.accountAccess(user, id, 'edit', customData);
    customData = Object.freeze({ ...customData });
    const completed = this.collaboration.generations.completed(
      user,
      id,
      requestId,
      checkpoint,
      customData,
    );
    if (completed) return completed; // The selected unnamed checkpoint may have since been pruned.
    if (
      this.workspace.auth.database
        .prepare('SELECT state FROM workspace_collaboration WHERE item_id=?')
        .get(id)?.state !== 'ready'
    )
      await this.collaboration.prepare(user, id, customData);
    const snapshot = await this.load(user, id, checkpoint, customData);
    checkSession();
    this.accountAccess(user, id, 'edit', customData);
    const restored = await this.collaboration.restore(
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
      customData,
    );
    checkSession();
    this.accountAccess(user, id, 'edit', customData);
    return restored;
  }

  private membershipFilter() {
    const fields = new Set(
      this.workspace.auth.database
        .prepare('PRAGMA table_info(workspace_items)')
        .all()
        .map((row) => row.name),
    );
    // Explicit Space members cannot consume the ordinary maintenance budget.
    // The store may predate migration; full ancestry is still classified below.
    return ['space_id', 'space_position']
      .filter((field) => fields.has(field))
      .map((field) => ` AND w.${field} IS NULL`)
      .join('');
  }

  /**
   * Space work has its own complete bounded batch, so an unsupported or very
   * large Space population cannot starve ordinary maintenance. Count repeated
   * ancestry walks before authorizing any candidates; this cache is structural
   * only and never carries access across an await.
   */
  private spaceMaintenanceItems(): MaintenanceItem[] {
    if (!this.workspace.spacesEnabled) return [];
    const db = this.workspace.auth.database;
    const fields = new Set(
      db
        .prepare('PRAGMA table_info(workspace_items)')
        .all()
        .map(({ name }) => name),
    );
    if (
      !['space_id', 'space_position', 'trashed_at', 'trash_batch'].every((field) =>
        fields.has(field),
      )
    )
      return [];
    const rows = db
      .prepare(
        `
      SELECT w.id,w.owner_id,w.space_id,c.state FROM workspace_items w
      LEFT JOIN workspace_collaboration c ON c.item_id=w.id
      WHERE w.kind IN ('doc','sheet') AND w.space_id IS NOT NULL AND w.space_position IS NOT NULL
        AND w.trashed_at IS NULL AND w.trash_batch IS NULL
        AND (c.state='ready' OR c.state IS NULL)
      ORDER BY w.id LIMIT ?
    `,
      )
      .all(MAX_ANCESTOR_READS + 1) as MaintenanceItem[];
    if (rows.length > MAX_ANCESTOR_READS) return [];
    const lookup = db.prepare('SELECT parent_id FROM workspace_items WHERE id=?');
    const parents = new Map<string, string | null | undefined>();
    const candidates: MaintenanceItem[] = [];
    let work = 0;
    for (const row of rows) {
      const seen = new Set<string>();
      let cursor: string | null | undefined = row.id;
      let foundRoot = false;
      while (typeof cursor === 'string' && !seen.has(cursor)) {
        if (++work > MAX_ANCESTOR_READS) return [];
        seen.add(cursor);
        if (cursor === row.space_id) foundRoot = true;
        if (!parents.has(cursor)) {
          const parent = lookup.get(cursor) as { parent_id: string | null } | undefined;
          parents.set(cursor, parent?.parent_id);
        }
        cursor = parents.get(cursor);
      }
      if (cursor === null && foundRoot) candidates.push(row);
    }
    return candidates;
  }

  prune(now = this.workspace.auth.now()) {
    const db = this.workspace.auth.database;
    this.workspace.auth.transaction(() => {
      const ids = db
        .prepare(
          `SELECT DISTINCT h.item_id FROM history_checkpoints h
          JOIN workspace_items w ON w.id=h.item_id
          WHERE w.kind IN ('folder','sheet','doc')${this.membershipFilter()}
          ORDER BY h.item_id LIMIT ?`,
        )
        .all(MAX_ANCESTOR_READS + 1)
        .map(({ item_id }) => String(item_id));
      // Classify the complete batch before deleting anything. Its shared cache
      // walks common ancestry once; a budget refusal cannot prune a partial set.
      const ordinary = classifyOrdinaryItems(db, ids);
      if (!ordinary) throw new Error('This history maintenance batch is too large.');
      const supported = [...ordinary];
      for (const row of this.spaceMaintenanceItems()) {
        if (!this.maintainedSpaces.has(row.id)) continue;
        try {
          const custom = createHistoryReadContext(
            this.workspace,
            row.owner_id,
            row.space_id!,
            row.id,
          );
          resolveDocument(this.workspace, row.owner_id, row.id, 'read', custom);
          if (row.state !== 'ready' && !this.native(row.owner_id, row.id, custom)) continue;
          supported.push(row.id);
        } catch (error) {
          if (!(error instanceof AuthError)) throw error;
          // Inaccessible, disabled-owner and malformed children keep all history.
        }
      }
      for (const item_id of supported) {
        const records = db
          .prepare(
            'SELECT id,captured_at AS capturedAt,revision,name,source,EXISTS(SELECT 1 FROM history_restore_labels WHERE checkpoint_id=history_checkpoints.id) AS beforeRestore FROM history_checkpoints WHERE item_id=?',
          )
          .all(item_id) as Checkpoint[];
        for (const id of expiredCheckpoints(records, now))
          db.prepare('DELETE FROM history_checkpoints WHERE id=?').run(id);
      }
    });
    // A later maintenance pass must establish support again; this set cannot
    // grow with permanently deleted documents or become a durable permission cache.
    this.maintainedSpaces.clear();
    // Images are deliberately retained. An unreferenced upload may still be in an offline edit.
  }

  tick(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (this.ticking) return this.ticking;
    const finish = observeJob(this.observeMaintenance);
    this.ticking = this.scan()
      .then(
        (success) => {
          finish(success);
        },
        (error) => {
          finish(false);
          throw error;
        },
      )
      .finally(() => {
        this.ticking = undefined;
      });
    return this.ticking;
  }

  private async scan() {
    let success = true;
    const db = this.workspace.auth.database;
    const rows = db
      .prepare(
        `SELECT w.id,w.owner_id,c.state FROM workspace_items w LEFT JOIN workspace_collaboration c ON c.item_id=w.id
      WHERE (c.state='ready' OR c.state IS NULL) AND w.kind IN ('sheet','doc') AND w.trashed_at IS NULL${this.membershipFilter()}
      ORDER BY w.id LIMIT ?`,
      )
      .all(MAX_ANCESTOR_READS + 1) as MaintenanceItem[];
    // This is only a structural exclusion, never a cached grant. Every candidate
    // still resolves current ordinary access below and capture rechecks after
    // awaited work. A later structural change can only defer a skipped item.
    const ordinary = classifyOrdinaryItems(
      db,
      rows.map(({ id }) => id),
    );
    if (!ordinary) throw new Error('This history maintenance batch is too large.');
    // Use the same resolver as requests, including inherited grants and disabled users.
    // A disabled owner must not stop history for an active collaborator. No bypass identity is created.
    const users = db
      .prepare('SELECT id FROM auth_users WHERE disabled=0 AND is_admin=0 ORDER BY id')
      .all() as { id: string }[];
    const candidates = [
      ...rows.filter(({ id }) => ordinary.has(id)),
      ...this.spaceMaintenanceItems(),
    ];
    for (const { id, owner_id, state, space_id } of candidates) {
      if (this.closing) {
        success = false;
        break;
      }
      try {
        const user = space_id
          ? owner_id
          : [owner_id, ...users.map((u) => u.id)].find((candidate) => {
              try {
                this.workspace.get(candidate, id);
                return true;
              } catch (error) {
                if (error instanceof AuthError) return false;
                throw error;
              }
            });
        if (!user) continue;
        const customData = space_id
          ? createHistoryReadContext(this.workspace, user, space_id, id)
          : {};
        resolveDocument(this.workspace, user, id, 'read', customData);
        const source: Source = state === 'ready' ? 'collaboration' : 'native';
        // Public adapter metadata repairs a missed commit event after an interrupted process.
        const generation =
          source === 'collaboration' ? this.collaboration.generations.active(id) : undefined;
        const headRevision =
          source === 'collaboration'
            ? await this.collaboration.headRevision(user, generation!.unitId, customData)
            : undefined;
        resolveDocument(this.workspace, user, id, 'read', customData);
        if (generation) {
          const current = this.collaboration.generations.active(id);
          if (current.unitId !== generation.unitId || current.offset !== generation.offset)
            continue;
        }
        const revision =
          source === 'collaboration'
            ? headRevision !== undefined
              ? headRevision + generation!.offset
              : undefined
            : this.native(user, id, customData)?.revision;
        if (revision === undefined) continue;
        if (space_id) this.maintainedSpaces.add(id);
        const now = this.workspace.auth.now();
        let progress = db
          .prepare(
            'SELECT revision,edited_at,captured_at FROM history_progress WHERE item_id=? AND source=?',
          )
          .get(id, source) as Progress | undefined;
        if (!progress) {
          await this.capture(user, id, source, customData);
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
          await this.capture(user, id, source, customData);
      } catch (error) {
        // Access loss and a concurrent generation change deliberately defer this
        // item. Validation/storage errors (including AuthError 400) are failures.
        if (error instanceof AuthError && [401, 403, 404, 409].includes(error.status)) continue;
        // No contents or credentials in logs. Dirty revision stays durable for the next pass.
        success = false;
        console.error('History checkpoint could not be saved; it will retry.');
      }
    }
    this.prune();
    return success;
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
