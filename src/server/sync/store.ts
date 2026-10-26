import { MAX_RETAINED_BYTES, MAX_RETAINED_REVISIONS, SyncError } from '@spinel/sync-server';
import type { SyncCommit, SyncRevision, SyncStorage, SyncUnit } from '@spinel/sync-server';
import type { AuthStore } from '../auth/store.ts';

/**
 * The application's sole sync adapter. A guarded edit and its receipt commit on
 * the same connection as sessions, grants and generations; no async work may
 * separate the final authorization check from the write.
 *
 * Accepted edits and retry identities survive retention. Only cell before-images
 * expire: there is one current native snapshot, not a snapshot for every edit.
 * Generation deletion uses the existing application purge outbox.
 */
export class SQLiteSyncStorage implements SyncStorage {
  private readonly auth: AuthStore;

  constructor(auth: AuthStore) {
    this.auth = auth;
    auth.database.exec(`
      CREATE TABLE IF NOT EXISTS spinel_sync_units (
        unit_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('sheet','doc')),
        revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
        snapshot TEXT NOT NULL,
        retained_from INTEGER NOT NULL CHECK(retained_from BETWEEN 1 AND revision)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS spinel_sync_revisions (
        unit_id TEXT NOT NULL REFERENCES spinel_sync_units(unit_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK(revision BETWEEN 2 AND 9007199254740991),
        base_revision INTEGER NOT NULL CHECK(base_revision BETWEEN 1 AND revision-1),
        actor_id TEXT NOT NULL,
        mutation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        mutations TEXT NOT NULL,
        before_cells TEXT,
        retained_bytes INTEGER NOT NULL CHECK(retained_bytes>=0),
        touched TEXT NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY(unit_id,revision),
        UNIQUE(unit_id,actor_id,mutation_id)
      ) STRICT;
    `);
  }

  has(unitId: string): boolean {
    return Boolean(
      this.auth.database.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(unitId),
    );
  }

  load(unitId: string): SyncUnit | undefined {
    const row = this.auth.database
      .prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?')
      .get(unitId);
    if (!row) return undefined;
    return {
      unitId: String(row.unit_id),
      kind: row.kind as SyncUnit['kind'],
      revision: Number(row.revision),
      snapshot: JSON.parse(String(row.snapshot)),
      retainedFrom: Number(row.retained_from),
    };
  }

  /** Reopening preparation may retry creation, but must never replace a live head. */
  create(unit: SyncUnit, guard: () => void): void {
    if (unit.revision !== 1 || unit.retainedFrom !== 1 || unit.snapshot.id !== unit.unitId)
      throw new SyncError('malformed');
    const snapshot = JSON.stringify(unit.snapshot);
    this.auth.transaction(() => {
      synchronousGuard(guard);
      const existing = this.auth.database
        .prepare('SELECT kind FROM spinel_sync_units WHERE unit_id=?')
        .get(unit.unitId);
      if (existing) {
        if (existing.kind !== unit.kind) throw new SyncError('retry-conflict');
        return;
      }
      this.auth.database
        .prepare('INSERT INTO spinel_sync_units VALUES(?,?,?,?,?)')
        .run(unit.unitId, unit.kind, 1, snapshot, 1);
    });
  }

  revisions(unitId: string, after: number, through: number): SyncRevision[] {
    if (
      !Number.isSafeInteger(after) ||
      !Number.isSafeInteger(through) ||
      after < 1 ||
      through < after ||
      through - after > MAX_RETAINED_REVISIONS
    )
      throw new SyncError('stale');
    return this.auth.database
      .prepare(
        'SELECT * FROM spinel_sync_revisions WHERE unit_id=? AND revision>? AND revision<=? ORDER BY revision',
      )
      .all(unitId, after, through)
      .map(decodeRevision);
  }

  receipt(unitId: string, actorId: string, mutationId: string): SyncRevision | undefined {
    const row = this.auth.database
      .prepare(
        'SELECT * FROM spinel_sync_revisions WHERE unit_id=? AND actor_id=? AND mutation_id=?',
      )
      .get(unitId, actorId, mutationId);
    return row ? decodeRevision(row) : undefined;
  }

  commit({ expectedRevision, unit, edit }: SyncCommit, guard: () => void): void {
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 ||
      expectedRevision >= Number.MAX_SAFE_INTEGER ||
      unit.revision !== expectedRevision + 1 ||
      edit.unitId !== unit.unitId ||
      edit.revision !== unit.revision ||
      unit.snapshot.id !== unit.unitId ||
      edit.beforeCells === null
    )
      throw new SyncError('malformed');
    const snapshot = JSON.stringify(unit.snapshot);
    const mutations = JSON.stringify(edit.mutations);
    const before = JSON.stringify(edit.beforeCells);
    const touched = JSON.stringify(edit.touched);
    const retainedBytes =
      Buffer.byteLength(mutations) + Buffer.byteLength(before) + Buffer.byteLength(touched);
    this.auth.transaction(() => {
      // BEGIN IMMEDIATE holds the writer lock before this guard, including when
      // the caller's access resolver uses an AuthStore nested savepoint.
      synchronousGuard(guard);
      const current = this.auth.database
        .prepare('SELECT kind,revision FROM spinel_sync_units WHERE unit_id=?')
        .get(unit.unitId);
      if (!current) throw new SyncError('unavailable');
      if (current.revision !== expectedRevision) throw new SyncError('stale');
      if (current.kind !== unit.kind) throw new SyncError('malformed');
      if (this.receipt(unit.unitId, edit.actorId, edit.mutationId))
        throw new SyncError('retry-conflict');
      this.auth.database
        .prepare('INSERT INTO spinel_sync_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          unit.unitId,
          edit.revision,
          edit.baseRevision,
          edit.actorId,
          edit.mutationId,
          edit.requestHash,
          mutations,
          before,
          retainedBytes,
          touched,
          edit.hash,
        );
      const retainedFrom = this.retain(unit.unitId, unit.revision);
      const changed = this.auth.database
        .prepare(
          'UPDATE spinel_sync_units SET revision=?,snapshot=?,retained_from=? WHERE unit_id=? AND revision=?',
        )
        .run(unit.revision, snapshot, retainedFrom, unit.unitId, expectedRevision);
      if (changed.changes !== 1) throw new SyncError('stale');
    });
  }

  /** Trusted lifecycle caller checks its purge outbox and active generation. */
  remove(unitId: string): void {
    this.auth.transaction(() => {
      this.auth.database.prepare('DELETE FROM spinel_sync_units WHERE unit_id=?').run(unitId);
    });
  }

  private retain(unitId: string, revision: number): number {
    const rows = this.auth.database
      .prepare(
        'SELECT revision,retained_bytes FROM spinel_sync_revisions WHERE unit_id=? AND before_cells IS NOT NULL ORDER BY revision DESC LIMIT ?',
      )
      .all(unitId, MAX_RETAINED_REVISIONS + 1);
    let bytes = 0;
    let retainedFrom = revision;
    let count = 0;
    for (const row of rows) {
      const next = Number(row.retained_bytes);
      if (count === MAX_RETAINED_REVISIONS || bytes + next > MAX_RETAINED_BYTES) break;
      bytes += next;
      count++;
      retainedFrom = Number(row.revision) - 1;
    }
    this.auth.database
      .prepare(
        'UPDATE spinel_sync_revisions SET before_cells=NULL,retained_bytes=0 WHERE unit_id=? AND revision<=? AND before_cells IS NOT NULL',
      )
      .run(unitId, retainedFrom);
    return retainedFrom;
  }
}

function decodeRevision(row: Record<string, unknown>): SyncRevision {
  return {
    unitId: String(row.unit_id),
    revision: Number(row.revision),
    baseRevision: Number(row.base_revision),
    actorId: String(row.actor_id),
    mutationId: String(row.mutation_id),
    requestHash: String(row.request_hash),
    mutations: JSON.parse(String(row.mutations)),
    beforeCells: row.before_cells === null ? null : JSON.parse(String(row.before_cells)),
    touched: JSON.parse(String(row.touched)),
    hash: String(row.hash),
  };
}

function synchronousGuard(guard: () => void): void {
  const result = guard() as unknown;
  if (result && typeof result === 'object' && 'then' in result)
    throw new Error('Sync storage authorization must finish synchronously.');
}
