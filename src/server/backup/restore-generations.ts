import { randomUUID } from 'node:crypto';
import { MAX_SNAPSHOT_BYTES, validateSnapshot } from '@spinel/sync-server';
import type { NativeSnapshot, DocumentKind } from '@spinel/sync-server';
import type { DatabaseSync } from '../../../server/database.ts';
import { snapshotIdentity } from '../../shared/snapshotIdentity.ts';
import { imageSources } from '../workspace/imageSources.ts';
import { readRestoreRows } from './restore-credentials.ts';
import { restoreEvidenceSources } from './restore-evidence.ts';
import { reconcileRestoreFences } from './restore-fences.ts';
import { retainRestoreRevision } from '../collaboration/restore-fences.ts';

const incompatible = () =>
  new Error('This backup needs compatible native generation reconciliation.');
const capacity = () => new Error('Workspace recovery exceeds its safe revision capacity.');
const required = [
  'spinel_sync_units',
  'spinel_sync_revisions',
  'spinel_live_units',
  'spinel_restore_jobs',
  'spinel_generation_resources',
  'spinel_restore_fences',
  'spinel_restore_revision',
  'workspace_collaboration',
  'collaboration_purge',
];

/** The durable ceiling covers observed heads after their documents are deleted.
 * Historical offsets erased before this clock existed cannot be reconstructed.
 * A conservative sum may refuse earlier than per-document arithmetic; it never
 * understates an observed logical head or fabricates intermediate native edits.
 */
export function restoreRevisionHighWater(
  current: DatabaseSync,
  candidate: DatabaseSync,
  additional: readonly DatabaseSync[] = [],
) {
  const { sources } = restoreEvidenceSources(current, candidate, additional);
  let native = 1,
    offset = 0,
    other = 0;
  for (const db of [...sources, candidate]) {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all()
        .map((row) => String(row.name)),
    );
    for (const [table, field, minimum] of [
      ['spinel_sync_units', 'revision', 1],
      ['spinel_live_units', 'revision_offset', 0],
      ['sheet_snapshots', 'revision', 0],
      ['doc_snapshots', 'revision', 0],
      ['history_checkpoints', 'revision', 0],
      ['history_progress', 'revision', 0],
      ['spinel_restore_jobs', 'revision', 1],
      ['spinel_restore_revision', 'revision', 0],
    ] as const) {
      if (!tables.has(table)) continue;
      const columns = table === 'spinel_restore_jobs' ? [field, 'status'] : [field];
      for (const row of readRestoreRows(db, table, 100_000, columns)) {
        if (table === 'spinel_restore_jobs' && row.status !== 'complete') continue;
        const value = row[field];
        if (!Number.isSafeInteger(value) || Number(value) < minimum) throw incompatible();
        if (table === 'spinel_sync_units') native = Math.max(native, Number(value));
        else if (table === 'spinel_live_units') offset = Math.max(offset, Number(value));
        else other = Math.max(other, Number(value));
      }
    }
  }
  if (native > Number.MAX_SAFE_INTEGER - offset) throw capacity();
  const result = Math.max(native + offset, other);
  if (result > Number.MAX_SAFE_INTEGER - 2) throw capacity();
  return result;
}

function textColumn(db: DatabaseSync, table: string, column: string, unit: string) {
  const size = db
    .prepare(`SELECT length(CAST(${column} AS BLOB)) AS bytes FROM ${table} WHERE unit_id=?`)
    .get(unit);
  if (!size) return undefined;
  if (
    !Number.isSafeInteger(size.bytes) ||
    Number(size.bytes) < 1 ||
    Number(size.bytes) > MAX_SNAPSHOT_BYTES
  )
    throw incompatible();
  return String(db.prepare(`SELECT ${column} FROM ${table} WHERE unit_id=?`).get(unit)![column]);
}

function assertNamespaces(sources: readonly DatabaseSync[], tables: Set<string>) {
  const meanings = new Map<string, string>();
  let bytes = 0;
  const claim = (identity: unknown, item: unknown) => {
    if (
      typeof identity !== 'string' ||
      typeof item !== 'string' ||
      !identity ||
      !item ||
      Buffer.byteLength(identity) > 256 ||
      Buffer.byteLength(item) > 256
    )
      throw incompatible();
    const existing = meanings.get(identity);
    if (existing !== undefined && existing !== item) throw incompatible();
    if (existing === undefined) {
      meanings.set(identity, item);
      bytes += Buffer.byteLength(identity) + Buffer.byteLength(item);
      if (meanings.size > 100_000 || bytes > 8 * 1024 ** 2) throw incompatible();
    }
  };
  for (const db of sources) {
    for (const row of readRestoreRows(db, 'workspace_items', 10_000, ['id'])) claim(row.id, row.id);
    if (tables.has('workspace_offline_recoveries'))
      for (const row of readRestoreRows(db, 'workspace_offline_recoveries', 100_000, ['item_id']))
        claim(row.item_id, row.item_id);
    for (const [table, columns] of [
      ['spinel_live_units', ['unit_id']],
      ['spinel_restore_jobs', ['previous_unit', 'next_unit']],
      ['workspace_offline_creations', ['unit_id']],
      ['spinel_generation_resources', ['unit_id']],
    ] as const) {
      if (!tables.has(table)) continue;
      for (const row of readRestoreRows(db, table, 100_000, ['item_id', ...columns])) {
        claim(row.item_id, row.item_id);
        for (const column of columns) claim(row[column], row.item_id);
      }
    }
  }
}

/** Frozen disposable working copy only. All identity reservations, cancellations,
 * fresh mappings and content/resource copies commit together. It does not change
 * current authority or the supervisor epoch, or establish activation health.
 */
export function rotateRestoreGenerations(
  current: DatabaseSync,
  candidate: DatabaseSync,
  additional: readonly DatabaseSync[] = [],
) {
  const { sources, tables } = restoreEvidenceSources(current, candidate, additional);
  if (required.some((table) => !tables.has(table))) throw incompatible();
  assertNamespaces([...sources, candidate], tables);
  const highWater = restoreRevisionHighWater(current, candidate, additional);
  const items = readRestoreRows(candidate, 'workspace_items', 10_000, ['id', 'kind']);
  const byId = new Map(items.map((row) => [String(row.id), row]));
  const mappings = readRestoreRows(candidate, 'spinel_live_units', 10_000, ['item_id', 'unit_id']);
  for (const row of mappings)
    if (!['doc', 'sheet'].includes(String(byId.get(String(row.item_id))?.kind)))
      throw incompatible();
  const active = new Map(mappings.map((row) => [String(row.item_id), String(row.unit_id)]));
  const documents = items.filter((row) => row.kind === 'doc' || row.kind === 'sheet');
  const oldUnits = new Set<string>();
  for (const item of documents) {
    const unit = active.get(String(item.id)) ?? String(item.id);
    if (oldUnits.has(unit)) throw incompatible();
    oldUnits.add(unit);
  }
  candidate.exec('BEGIN IMMEDIATE');
  try {
    reconcileRestoreFences(current, candidate, additional);
    const fences = readRestoreRows(candidate, 'spinel_restore_fences', 100_000);
    const reserved = new Set(
      fences.filter((row) => row.kind === 'identity').map((row) => String(row.id)),
    );
    const bytes = fences.reduce((sum, row) => sum + Buffer.byteLength(String(row.id)), 0);
    if (fences.length + documents.length > 100_000 || bytes + documents.length * 36 > 8 * 1024 ** 2)
      throw incompatible();
    const queue = candidate.prepare('INSERT OR IGNORE INTO collaboration_purge VALUES(?)');
    // No staged replacement may be completed by the serving constructor.
    for (const row of readRestoreRows(candidate, 'spinel_restore_jobs', 100_000, [
      'status',
      'next_unit',
    ]))
      if (row.status === 'staging') queue.run(row.next_unit);
    candidate.exec("UPDATE spinel_restore_jobs SET status='cancelled' WHERE status='staging'");
    let initialized = 0;
    for (const item of documents) {
      const id = String(item.id),
        kind = item.kind as DocumentKind,
        oldUnit = active.get(id) ?? id;
      const nextUnit = randomUUID();
      if (reserved.has(nextUnit)) throw incompatible();
      reserved.add(nextUnit);
      candidate.prepare("INSERT INTO spinel_restore_fences VALUES('identity',?)").run(nextUnit);
      const native = textColumn(candidate, 'spinel_sync_units', 'snapshot', oldUnit);
      const retained = textColumn(candidate, 'spinel_generation_resources', 'resources', oldUnit);
      const resources: unknown = retained ? JSON.parse(retained) : [];
      if (
        !Array.isArray(resources) ||
        resources.some(
          (value) => !value || typeof value.name !== 'string' || typeof value.data !== 'string',
        )
      )
        throw incompatible();
      const copiedResources =
        snapshotIdentity({ id: oldUnit, resources } as NativeSnapshot, nextUnit).resources ?? [];
      const resourceText = JSON.stringify(copiedResources);
      if (Buffer.byteLength(resourceText) > MAX_SNAPSHOT_BYTES) throw incompatible();
      const validateImages = (snapshot: NativeSnapshot) =>
        imageSources(snapshot, (source) => {
          const prefix = `/api/items/${id}/images/`;
          if (
            !source.startsWith(prefix) ||
            !/^[a-f0-9]{64}$/.test(source.slice(prefix.length)) ||
            !candidate
              .prepare('SELECT 1 FROM doc_images WHERE item_id=? AND id=?')
              .get(id, source.slice(prefix.length))
          )
            throw incompatible();
          return source;
        });
      // Include duplicate-name resources that are not rendered. Stable image
      // URLs stay unchanged; only native self references use the fresh unit ID.
      validateImages({ id: nextUnit, resources: copiedResources } as NativeSnapshot);
      if (native !== undefined) {
        const row = candidate
          .prepare('SELECT kind FROM spinel_sync_units WHERE unit_id=?')
          .get(oldUnit);
        if (row?.kind !== kind) throw incompatible();
        const snapshot = JSON.parse(native) as NativeSnapshot;
        validateSnapshot(snapshot, kind, oldUnit);
        const replacement = { ...snapshotIdentity(snapshot, nextUnit), rev: 1 };
        validateSnapshot(replacement, kind, nextUnit);
        validateImages({
          ...replacement,
          resources: [...(replacement.resources ?? []), ...copiedResources],
        });
        candidate
          .prepare('INSERT INTO spinel_sync_units VALUES(?,?,1,?,1)')
          .run(nextUnit, kind, JSON.stringify(replacement));
        candidate
          .prepare(
            "INSERT INTO workspace_collaboration VALUES(?,'ready') ON CONFLICT(item_id) DO UPDATE SET state='ready'",
          )
          .run(id);
        initialized++;
      } else if (
        candidate.prepare('SELECT 1 FROM workspace_collaboration WHERE item_id=?').get(id)
      ) {
        throw incompatible(); // Preserve the existing lazy initialization invariant.
      }
      if (retained !== undefined) {
        const row = candidate
          .prepare('SELECT item_id FROM spinel_generation_resources WHERE unit_id=?')
          .get(oldUnit);
        if (row?.item_id !== id) throw incompatible();
        candidate
          .prepare('INSERT INTO spinel_generation_resources VALUES(?,?,?)')
          .run(nextUnit, id, resourceText);
      }
      candidate
        .prepare(
          'INSERT INTO spinel_live_units VALUES(?,?,?) ON CONFLICT(item_id) DO UPDATE SET unit_id=excluded.unit_id,revision_offset=excluded.revision_offset',
        )
        .run(id, nextUnit, highWater);
      queue.run(oldUnit);
    }
    for (const row of candidate.iterate('PRAGMA foreign_key_check')) if (row) throw incompatible();
    retainRestoreRevision(candidate, highWater + 1);
    candidate.exec('COMMIT');
    return { rotated: documents.length, initialized, revisionOffset: highWater };
  } catch (error) {
    candidate.exec('ROLLBACK');
    throw error;
  }
}
