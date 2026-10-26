import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { materialize, validateSnapshot, MAX_SNAPSHOT_BYTES } from '@spinel/sync-server';
import type { NativeSnapshot, DocumentKind } from '@spinel/sync-server';
import { validateFormulaDefinition } from '@spinel/doc-formulas';
import { backup, DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { checkDatabase, digest } from '../backup/archive.ts';
import { imageSources } from '../workspace/imageSources.ts';
import { SQLiteSyncStorage } from './store.ts';

/** Offline-only public SDK boundary. No proprietary table is read or rewritten. */
export interface LegacyTransitionReader {
  load(unitId: string, kind: DocumentKind): Promise<{ snapshot: NativeSnapshot; revision: number }>;
  purge(unitIds: readonly string[]): Promise<void>;
  assertMissing(unitIds: readonly string[]): Promise<void>;
  close(): Promise<void>;
}
export type LegacyTransitionReaderFactory = (copy: string) => Promise<LegacyTransitionReader>;
export type TransitionProgress = (event: {
  event:
    | 'sync_transition.exported'
    | 'sync_transition.sanitized'
    | 'sync_transition.imported'
    | 'sync_transition.verified';
  completed: number;
  total: number;
}) => void;

type Inventory = {
  itemId: string;
  unitId: string;
  kind: DocumentKind;
  source: 'legacy' | 'sync' | 'native';
  state: string | null;
  offset: number;
  revision: number | null;
  retainedFrom: number | null;
  snapshotHash: string | null;
};
type ExportedUnit = {
  sourceHash: string;
  itemId: string;
  unitId: string;
  kind: DocumentKind;
  revision: number;
  snapshot: NativeSnapshot;
};
type ExportReceipt = { unitId: string; file: string; hash: string; revision: number };
type Manifest = {
  format: 1;
  status: 'preparing' | 'complete';
  originalPath: string;
  sourceHash: string;
  sanitizedHash: string | null;
  purgedUnits: string[];
  inventory: Inventory[];
  tables: Record<string, string>;
  units: ExportReceipt[];
};

// These are application-owned tables, not the SDK's private storage. A complete
// SQLite copy retains unknown tables too; these hashes verify our own contracts.
const preservedTables = [
  'auth_access_tokens',
  'auth_admin_recovery',
  'auth_admin_recovery_ceremonies',
  'auth_challenges',
  'auth_invite_ceremonies',
  'auth_invites',
  'auth_passkeys',
  'auth_profiles',
  'auth_sessions',
  'auth_setup',
  'auth_users',
  'backup_state',
  'collaboration_purge',
  'diagnostics_state',
  'doc_images',
  'doc_snapshots',
  'history_checkpoints',
  'history_progress',
  'history_restore_labels',
  'mcp_writes',
  'oauth_access',
  'oauth_clients',
  'oauth_codes',
  'oauth_connections',
  'oauth_pending',
  'oauth_refresh',
  'sheet_snapshots',
  'spinel_generation_resources',
  'spinel_live_units',
  'spinel_recovery',
  'spinel_restore_jobs',
  'spinel_sync_activation',
  'workspace_grants',
  'workspace_guest_sessions',
  'workspace_items',
  'workspace_links',
  'workspace_placements',
  'workspace_retained_trash_batches',
  'workspace_space_trash',
  'workspace_tag_assignments',
  'workspace_tags',
] as const;
const MAX_ITEMS = 10_000;
const MAX_ROWS = 200_000;
const manifestName = 'transition.json';
const sourceName = 'source.sqlite';
const sanitizedName = 'metadata.sqlite';
const pendingName = 'pending.sqlite';
const publishedName = 'spinel.sqlite';
const unavailable = () => new Error('Sync transition verification failed; keep the source copy.');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const tableExists = (db: DatabaseSync, table: string) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));
const positive = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value < Number.MAX_SAFE_INTEGER;

function readJson(path: string, limit = MAX_SNAPSHOT_BYTES + 4096): unknown {
  const info = statSync(path);
  if (!info.isFile() || info.size > limit || info.mode & 0o077) throw unavailable();
  return JSON.parse(readFileSync(path, 'utf8'));
}
function writeJson(path: string, value: unknown) {
  const temporary = `${path}.writing`;
  writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}
function readManifest(directory: string): Manifest {
  const value = readJson(join(directory, manifestName)) as Manifest;
  if (
    value?.format !== 1 ||
    !['preparing', 'complete'].includes(value.status) ||
    typeof value.originalPath !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sourceHash) ||
    !(value.sanitizedHash === null || /^[a-f0-9]{64}$/.test(value.sanitizedHash)) ||
    !Array.isArray(value.purgedUnits) ||
    value.purgedUnits.length > MAX_ROWS ||
    !Array.isArray(value.inventory) ||
    value.inventory.length > MAX_ITEMS ||
    !Array.isArray(value.units) ||
    value.units.length > MAX_ITEMS ||
    !value.tables ||
    typeof value.tables !== 'object'
  )
    throw unavailable();
  return value;
}

function inventory(db: DatabaseSync): Inventory[] {
  if (!tableExists(db, 'workspace_items')) return [];
  if (tableExists(db, 'spinel_sync_transition_state'))
    throw new Error('Use the original pre-cutover source copy.');
  if (
    tableExists(db, 'spinel_restore_jobs') &&
    db.prepare("SELECT 1 FROM spinel_restore_jobs WHERE status='staging' LIMIT 1").get()
  )
    throw new Error('Finish or recover the interrupted restore in the legacy application first.');
  const items = db
    .prepare(
      "SELECT id,kind FROM workspace_items WHERE kind IN ('sheet','doc') ORDER BY id LIMIT ?",
    )
    .all(MAX_ITEMS + 1);
  if (items.length > MAX_ITEMS)
    throw new Error('The transition inventory exceeds its safe document limit.');
  return items.map((item) => {
    const itemId = String(item.id);
    const generation = tableExists(db, 'spinel_live_units')
      ? db
          .prepare('SELECT unit_id,revision_offset FROM spinel_live_units WHERE item_id=?')
          .get(itemId)
      : undefined;
    const unitId = String(generation?.unit_id ?? itemId);
    const state = tableExists(db, 'workspace_collaboration')
      ? db.prepare('SELECT state FROM workspace_collaboration WHERE item_id=?').get(itemId)?.state
      : undefined;
    const sync = tableExists(db, 'spinel_sync_units')
      ? db
          .prepare(
            'SELECT kind,revision,retained_from,snapshot FROM spinel_sync_units WHERE unit_id=?',
          )
          .get(unitId)
      : undefined;
    const nativeTable = item.kind === 'sheet' ? 'sheet_snapshots' : 'doc_snapshots';
    const native = tableExists(db, nativeTable)
      ? db.prepare(`SELECT revision,snapshot FROM ${nativeTable} WHERE item_id=?`).get(itemId)
      : undefined;
    const offset = Number(generation?.revision_offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || (sync && sync.kind !== item.kind))
      throw unavailable();
    if (
      sync &&
      (!positive(sync.revision) ||
        !positive(sync.retained_from) ||
        Number(sync.retained_from) > Number(sync.revision))
    )
      throw unavailable();
    return {
      itemId,
      unitId,
      kind: item.kind as DocumentKind,
      source: sync ? 'sync' : state ? 'legacy' : 'native',
      state: state === undefined ? null : String(state),
      offset,
      revision: sync ? Number(sync.revision) : native ? Number(native.revision) : null,
      retainedFrom: sync ? Number(sync.retained_from) : null,
      snapshotHash: sync
        ? hash(String(sync.snapshot))
        : native
          ? hash(String(native.snapshot))
          : null,
    };
  });
}

function legacyUnitIds(db: DatabaseSync, items: Inventory[]) {
  // Native ownership does not prove that an earlier SDK copy is absent. Probe
  // every application-known ID through the public SDK before importing the copy.
  const ids = new Set(items.flatMap((item) => [item.itemId, item.unitId]));
  for (const [table, column] of [
    ['spinel_sync_units', 'unit_id'],
    ['spinel_live_units', 'unit_id'],
    ['spinel_restore_jobs', 'previous_unit'],
    ['spinel_restore_jobs', 'next_unit'],
    ['collaboration_purge', 'item_id'],
  ]) {
    if (!tableExists(db, table)) continue;
    for (const row of db
      .prepare(`SELECT ${column} AS unit FROM ${table} LIMIT ?`)
      .all(MAX_ROWS + 1)) {
      ids.add(String(row.unit));
      if (ids.size > MAX_ROWS) throw unavailable();
    }
  }
  return [...ids].sort();
}

/** Order-independent row hashing bounds memory and does not depend on VACUUM rowids. */
function tableHash(db: DatabaseSync, table: string, filter = '') {
  const definition = db
    .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
    .get(table);
  if (!definition) return null;
  const rows: string[] = [];
  let cursor = Number.MIN_SAFE_INTEGER;
  while (true) {
    const row = db
      .prepare(
        `SELECT rowid AS transition_row_id,* FROM ${table} WHERE rowid>? ${filter} ORDER BY rowid LIMIT 1`,
      )
      .get(cursor);
    if (!row) break;
    cursor = Number(row.transition_row_id);
    const current = createHash('sha256');
    for (const [name, value] of Object.entries(row)) {
      if (name === 'transition_row_id') continue;
      current.update(JSON.stringify(name));
      if (value instanceof Uint8Array) current.update(`blob:${value.length}:`).update(value);
      else current.update(`${typeof value}:${JSON.stringify(value)};`);
    }
    rows.push(current.digest('hex'));
    if (rows.length > MAX_ROWS)
      throw new Error('A retained table exceeds the transition verification limit.');
  }
  const result = createHash('sha256').update(String(definition.sql)).update('\n');
  for (const row of rows.sort()) result.update(row);
  return result.digest('hex');
}
function tableHashes(db: DatabaseSync) {
  return Object.fromEntries(
    preservedTables.flatMap((table) => {
      const value = tableHash(db, table);
      return value === null ? [] : [[table, value]];
    }),
  );
}
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw unavailable();
}

function validateContent(db: DatabaseSync, itemId: string, snapshot: NativeSnapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES
  )
    throw unavailable();
  let nodes = 0;
  const walk = (value: unknown, depth: number) => {
    if (++nodes > 200_000 || depth > 64) throw unavailable();
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'spinelFormula') validateFormulaDefinition(child);
      else walk(child, depth + 1);
    }
  };
  walk(snapshot, 0);
  const seen = new Set<string>();
  imageSources(snapshot, (source) => {
    if (seen.has(source)) return source;
    seen.add(source);
    const prefix = `/api/items/${itemId}/images/`;
    const id = source.slice(prefix.length);
    if (!source.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(id) || !tableExists(db, 'doc_images'))
      throw unavailable();
    const image = db
      .prepare('SELECT data FROM doc_images WHERE item_id=? AND id=?')
      .get(itemId, id);
    if (!(image?.data instanceof Uint8Array) || hash(image.data) !== id) throw unavailable();
    return source;
  });
}

function validateRetainedSnapshots(db: DatabaseSync, items: Inventory[]) {
  for (const item of items) {
    if (item.source === 'legacy') continue;
    const table =
      item.source === 'sync'
        ? 'spinel_sync_units'
        : item.kind === 'sheet'
          ? 'sheet_snapshots'
          : 'doc_snapshots';
    if (!tableExists(db, table)) continue;
    const key = item.source === 'sync' ? 'unit_id' : 'item_id';
    const row = db
      .prepare(`SELECT snapshot FROM ${table} WHERE ${key}=?`)
      .get(item.source === 'sync' ? item.unitId : item.itemId);
    if (row) {
      const snapshot = JSON.parse(String(row.snapshot)) as NativeSnapshot;
      validateContent(db, item.itemId, snapshot);
      withOpaqueResources(db, item.itemId, item.unitId, snapshot);
    }
  }
  if (!tableExists(db, 'history_checkpoints')) return;
  let cursor = Number.MIN_SAFE_INTEGER;
  let count = 0;
  while (true) {
    const row = db
      .prepare(
        'SELECT rowid,item_id,snapshot FROM history_checkpoints WHERE rowid>? ORDER BY rowid LIMIT 1',
      )
      .get(cursor);
    if (!row) break;
    cursor = Number(row.rowid);
    if (++count > MAX_ROWS || !(row.snapshot instanceof Uint8Array)) throw unavailable();
    const text = gunzipSync(row.snapshot, { maxOutputLength: MAX_SNAPSHOT_BYTES }).toString('utf8');
    validateContent(db, String(row.item_id), JSON.parse(text) as NativeSnapshot);
  }
}

function withOpaqueResources(
  db: DatabaseSync,
  itemId: string,
  unitId: string,
  snapshot: NativeSnapshot,
) {
  if (!tableExists(db, 'spinel_generation_resources')) return snapshot;
  const row = db
    .prepare('SELECT resources FROM spinel_generation_resources WHERE unit_id=?')
    .get(unitId);
  if (!row) return snapshot;
  const resources = JSON.parse(String(row.resources)) as NonNullable<NativeSnapshot['resources']>;
  if (!Array.isArray(resources)) throw unavailable();
  // A colliding opaque name is not served, but must not hide an unsafe stored
  // source. Match the ordinary generation read boundary before merging names.
  validateContent(db, itemId, {
    ...snapshot,
    resources: [...(snapshot.resources ?? []), ...resources],
  });
  const known = new Set((snapshot.resources ?? []).map((resource) => resource.name));
  return {
    ...snapshot,
    resources: [
      ...(snapshot.resources ?? []),
      ...resources.filter((resource) => !known.has(resource.name)),
    ],
  };
}

function exported(directory: string, manifest: Manifest, item: Inventory) {
  const receipt = manifest.units.find((entry) => entry.unitId === item.unitId);
  if (!receipt || receipt.file !== `${hash(item.unitId)}.json` || !positive(receipt.revision))
    throw unavailable();
  const path = join(directory, receipt.file);
  const result = readJson(path) as ExportedUnit;
  if (hash(readFileSync(path)) !== receipt.hash) throw unavailable();
  if (
    result?.sourceHash !== manifest.sourceHash ||
    result.itemId !== item.itemId ||
    result.unitId !== item.unitId ||
    result.kind !== item.kind ||
    result.revision !== receipt.revision ||
    result.snapshot?.id !== item.unitId ||
    !positive(result.revision + item.offset)
  )
    throw unavailable();
  return { receipt, result };
}

/** Retain every document, including trash/Space children; no selection or deletion is implicit. */
export async function exportSyncTransition(options: {
  source: string;
  directory: string;
  legacy: LegacyTransitionReaderFactory;
  progress?: TransitionProgress;
}) {
  const directory = resolve(options.directory);
  const original = realpathSync(options.source);
  if (original === join(directory, sourceName)) throw unavailable();
  const provenance = join(directory, 'source-origin.json');
  if (!existsSync(directory)) {
    mkdirSync(directory, { mode: 0o700 });
    writeJson(provenance, { format: 1, originalPath: original });
  } else equal(readJson(provenance), { format: 1, originalPath: original });
  let manifest: Manifest;
  if (existsSync(join(directory, manifestName))) {
    manifest = readManifest(directory);
    if (manifest.originalPath !== original) throw unavailable();
  } else {
    if (!existsSync(join(directory, sourceName))) {
      const copying = join(directory, 'source-copying.sqlite');
      rmSync(copying, { force: true });
      const db = new DatabaseSync(original, { readOnly: true });
      try {
        checkDatabase(db);
        await backup(db, copying);
      } finally {
        db.close();
      }
      chmodSync(copying, 0o600);
      renameSync(copying, join(directory, sourceName));
    }
    const copy = new DatabaseSync(join(directory, sourceName), { readOnly: true });
    try {
      checkDatabase(copy);
      manifest = {
        format: 1,
        status: 'preparing',
        originalPath: original,
        sourceHash: await digest(join(directory, sourceName)),
        sanitizedHash: null,
        purgedUnits: [],
        inventory: inventory(copy),
        tables: tableHashes(copy),
        units: [],
      };
      manifest.purgedUnits = legacyUnitIds(copy, manifest.inventory);
      validateRetainedSnapshots(copy, manifest.inventory);
    } finally {
      copy.close();
    }
    writeJson(join(directory, manifestName), manifest);
  }
  const copyPath = join(directory, sourceName);
  if ((await digest(copyPath)) !== manifest.sourceHash) throw unavailable();
  const db = new DatabaseSync(copyPath, { readOnly: true });
  let reader: LegacyTransitionReader | undefined;
  const working = join(directory, 'legacy-working.sqlite');
  try {
    equal(inventory(db), manifest.inventory);
    equal(tableHashes(db), manifest.tables);
    equal(legacyUnitIds(db, manifest.inventory), manifest.purgedUnits);
    const legacy = manifest.inventory.filter((item) => item.source === 'legacy');
    if (
      new Set(manifest.units.map((entry) => entry.unitId)).size !== manifest.units.length ||
      manifest.units.some((entry) => !legacy.some((item) => item.unitId === entry.unitId))
    )
      throw unavailable();
    for (const item of legacy) {
      if (manifest.units.some((entry) => entry.unitId === item.unitId)) {
        exported(directory, manifest, item);
        continue;
      }
      if (!reader) {
        for (const suffix of ['', '-wal', '-shm']) rmSync(working + suffix, { force: true });
        await backup(db, working);
        chmodSync(working, 0o600);
        reader = await options.legacy(working);
      }
      const current = await reader.load(item.unitId, item.kind);
      if (!positive(current.revision) || !positive(current.revision + item.offset))
        throw unavailable();
      const snapshot = withOpaqueResources(db, item.itemId, item.unitId, current.snapshot);
      if (snapshot.id !== item.unitId) throw unavailable();
      validateContent(db, item.itemId, snapshot);
      const unit: ExportedUnit = {
        sourceHash: manifest.sourceHash,
        itemId: item.itemId,
        unitId: item.unitId,
        kind: item.kind,
        revision: current.revision,
        snapshot,
      };
      const file = `${hash(item.unitId)}.json`;
      writeJson(join(directory, file), unit);
      manifest.units.push({
        unitId: item.unitId,
        file,
        hash: hash(readFileSync(join(directory, file))),
        revision: current.revision,
      });
      writeJson(join(directory, manifestName), manifest);
      options.progress?.({
        event: 'sync_transition.exported',
        completed: manifest.units.length,
        total: legacy.length,
      });
    }
    if (reader) {
      await reader.close();
      reader = undefined;
    }
    const sanitizedPath = join(directory, sanitizedName);
    if (manifest.sanitizedHash === null) {
      const sanitizing = join(directory, 'sanitizing.sqlite');
      for (const suffix of ['', '-wal', '-shm']) rmSync(sanitizing + suffix, { force: true });
      await backup(db, sanitizing);
      chmodSync(sanitizing, 0o600);
      if (manifest.purgedUnits.length) {
        const cleaner = await options.legacy(sanitizing);
        try {
          await cleaner.purge(manifest.purgedUnits);
        } finally {
          await cleaner.close();
        }
        // Reopen through public APIs to prove deletion survived SDK disposal.
        const checker = await options.legacy(sanitizing);
        try {
          await checker.assertMissing(manifest.purgedUnits);
        } finally {
          await checker.close();
        }
      }
      const clean = new DatabaseSync(sanitizing, { readOnly: true });
      try {
        checkDatabase(clean);
        equal(tableHashes(clean), manifest.tables);
        for (const table of [
          'workspace_collaboration',
          'spinel_sync_units',
          'spinel_sync_revisions',
        ])
          equal(tableHash(clean, table), tableHash(db, table));
      } finally {
        clean.close();
      }
      renameSync(sanitizing, sanitizedPath);
      manifest.sanitizedHash = await digest(sanitizedPath);
      writeJson(join(directory, manifestName), manifest);
      options.progress?.({
        event: 'sync_transition.sanitized',
        completed: manifest.purgedUnits.length,
        total: manifest.purgedUnits.length,
      });
    } else if ((await digest(sanitizedPath)) !== manifest.sanitizedHash) throw unavailable();
    manifest.status = 'complete';
    writeJson(join(directory, manifestName), manifest);
  } finally {
    try {
      await reader?.close();
    } finally {
      db.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(working + suffix, { force: true });
    }
  }
  if ((await digest(copyPath)) !== manifest.sourceHash) throw unavailable();
  return {
    documents: manifest.inventory.length,
    converted: manifest.units.length,
    sourceHash: manifest.sourceHash,
  };
}

/** Called before recovery, purge, listeners or any request can alter a copied database. */
export function assertSyncTransitionReady(db: DatabaseSync) {
  let sanitized = false;
  if (tableExists(db, 'spinel_sync_transition_state')) {
    const state = db.prepare('SELECT status FROM spinel_sync_transition_state WHERE id=1').get();
    if (state?.status !== 'complete')
      throw new Error('Finish the offline sync transition before starting Spinel.');
    sanitized = true;
  }
  if (
    tableExists(db, 'workspace_collaboration') &&
    db.prepare("SELECT 1 FROM workspace_collaboration WHERE state<>'ready' LIMIT 1").get()
  )
    throw new Error('Finish the offline sync transition before starting Spinel.');
  if (tableExists(db, 'workspace_collaboration')) {
    const missing = tableExists(db, 'spinel_sync_units')
      ? tableExists(db, 'spinel_live_units')
        ? db
            .prepare(
              `SELECT 1 FROM workspace_collaboration c LEFT JOIN spinel_live_units g ON g.item_id=c.item_id
          WHERE NOT EXISTS(SELECT 1 FROM spinel_sync_units s WHERE s.unit_id=coalesce(g.unit_id,c.item_id)) LIMIT 1`,
            )
            .get()
        : db
            .prepare(
              'SELECT 1 FROM workspace_collaboration c WHERE NOT EXISTS(SELECT 1 FROM spinel_sync_units s WHERE s.unit_id=c.item_id) LIMIT 1',
            )
            .get()
      : db.prepare('SELECT 1 FROM workspace_collaboration LIMIT 1').get();
    if (missing)
      throw new Error(
        'This database needs the offline sync transition; its retained documents have not been changed.',
      );
  }
  const nativeOnly =
    tableExists(db, 'spinel_sync_activation') &&
    db.prepare('SELECT 1 FROM spinel_sync_activation WHERE id=1').get();
  if (!sanitized && !nativeOnly && tableExists(db, 'collaboration_purge')) {
    const unknown = tableExists(db, 'spinel_sync_units')
      ? db
          .prepare(
            'SELECT 1 FROM collaboration_purge p WHERE NOT EXISTS(SELECT 1 FROM spinel_sync_units s WHERE s.unit_id=p.item_id) LIMIT 1',
          )
          .get()
      : db.prepare('SELECT 1 FROM collaboration_purge LIMIT 1').get();
    if (unknown)
      throw new Error(
        'This database has unverified legacy purge work. Run the offline sync transition first.',
      );
  }
  if (
    !sanitized &&
    !nativeOnly &&
    ['workspace_collaboration', 'spinel_sync_units'].some(
      (table) => tableExists(db, table) && db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(),
    )
  )
    throw new Error(
      'This database needs the offline sync transition to verify that no legacy copies remain; its retained documents have not been changed.',
    );
}

/** A successful readiness check establishes native-only provenance for future
 * interrupted removals/cancelled restore stages whose unit is already absent. */
export function markNativeSyncActivated(db: DatabaseSync) {
  assertSyncTransitionReady(db);
  db.exec(
    'CREATE TABLE IF NOT EXISTS spinel_sync_activation (id INTEGER PRIMARY KEY CHECK(id=1)) STRICT; INSERT OR IGNORE INTO spinel_sync_activation VALUES(1);',
  );
}

function verifyTarget(source: DatabaseSync, target: DatabaseSync, manifest: Manifest) {
  equal(tableHashes(target), manifest.tables);
  const sourceNative = tableHash(source, 'spinel_sync_units');
  if (sourceNative !== null)
    equal(
      tableHash(
        target,
        'spinel_sync_units',
        'AND unit_id NOT IN (SELECT unit_id FROM spinel_sync_transition_units)',
      ),
      sourceNative,
    );
  else if (
    target
      .prepare(
        'SELECT 1 FROM spinel_sync_units WHERE unit_id NOT IN (SELECT unit_id FROM spinel_sync_transition_units) LIMIT 1',
      )
      .get()
  )
    throw unavailable();
  const sourceRevisions = tableHash(source, 'spinel_sync_revisions');
  if (sourceRevisions !== null) equal(tableHash(target, 'spinel_sync_revisions'), sourceRevisions);
  else if (target.prepare('SELECT 1 FROM spinel_sync_revisions LIMIT 1').get()) throw unavailable();
  const originalMarkers = tableExists(source, 'workspace_collaboration')
    ? source.prepare('SELECT item_id,state FROM workspace_collaboration ORDER BY item_id').all()
    : [];
  const changed = new Set(manifest.units.map((unit) => unit.unitId));
  const legacyIds = new Set(
    manifest.inventory.filter((item) => changed.has(item.unitId)).map((item) => item.itemId),
  );
  equal(
    target.prepare('SELECT item_id,state FROM workspace_collaboration ORDER BY item_id').all(),
    originalMarkers.map((row) =>
      legacyIds.has(String(row.item_id)) ? { ...row, state: 'ready' } : row,
    ),
  );
  checkDatabase(target);
}

function verifyImportedUnits(directory: string, target: DatabaseSync, manifest: Manifest) {
  for (const item of manifest.inventory.filter((unit) => unit.source === 'legacy')) {
    const { result } = exported(directory, manifest, item);
    const snapshot = JSON.stringify(result.snapshot);
    equal(
      target
        .prepare('SELECT snapshot_hash,revision FROM spinel_sync_transition_units WHERE unit_id=?')
        .get(item.unitId),
      { snapshot_hash: hash(snapshot), revision: result.revision },
    );
    equal(
      target
        .prepare(
          'SELECT kind,revision,snapshot,retained_from FROM spinel_sync_units WHERE unit_id=?',
        )
        .get(item.unitId),
      { kind: item.kind, revision: result.revision, snapshot, retained_from: result.revision },
    );
  }
}

export async function importSyncTransition(options: {
  directory: string;
  destination: string;
  progress?: TransitionProgress;
}) {
  const directory = realpathSync(options.directory);
  const manifest = readManifest(directory);
  if (manifest.status !== 'complete') throw new Error('Complete the public snapshot export first.');
  const sourcePath = join(directory, sourceName);
  if ((await digest(sourcePath)) !== manifest.sourceHash) throw unavailable();
  const sanitizedPath = join(directory, sanitizedName);
  if (!manifest.sanitizedHash || (await digest(sanitizedPath)) !== manifest.sanitizedHash)
    throw unavailable();
  const manifestHash = hash(readFileSync(join(directory, manifestName)));
  const destination = resolve(options.destination);
  if (destination === directory) throw unavailable();
  const marker = join(destination, manifestName);
  if (!existsSync(destination)) {
    mkdirSync(destination, { mode: 0o700 });
    writeJson(marker, { format: 1, sourceHash: manifest.sourceHash, manifestHash });
  } else {
    equal(readJson(marker), { format: 1, sourceHash: manifest.sourceHash, manifestHash });
  }
  const finalPath = join(destination, publishedName);
  const pendingPath = join(destination, pendingName);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let target: DatabaseSync | undefined;
  try {
    checkDatabase(source);
    equal(inventory(source), manifest.inventory);
    equal(tableHashes(source), manifest.tables);
    equal(legacyUnitIds(source, manifest.inventory), manifest.purgedUnits);
    validateRetainedSnapshots(source, manifest.inventory);
    const legacy = manifest.inventory.filter((item) => item.source === 'legacy');
    if (
      manifest.units.length !== legacy.length ||
      new Set(manifest.units.map((unit) => unit.unitId)).size !== legacy.length
    )
      throw unavailable();
    for (const item of legacy) exported(directory, manifest, item);
    if (existsSync(finalPath)) {
      target = new DatabaseSync(finalPath, { readOnly: true });
      const state = target
        .prepare(
          'SELECT source_hash,manifest_hash,status FROM spinel_sync_transition_state WHERE id=1',
        )
        .get();
      equal(state, {
        source_hash: manifest.sourceHash,
        manifest_hash: manifestHash,
        status: 'complete',
      });
      assertSyncTransitionReady(target);
      // Completion is a receipt, not proof that a file is still intact. An
      // already served/changed copy is refused rather than reported verified or
      // overwritten. The operator keeps that live file and its newer edits.
      verifyTarget(source, target, manifest);
      verifyImportedUnits(directory, target, manifest);
      return {
        path: finalPath,
        documents: manifest.inventory.length,
        converted: legacy.length,
        resumed: true,
      };
    }
    if (!existsSync(pendingPath)) {
      const copying = join(destination, 'pending-copying.sqlite');
      for (const suffix of ['', '-wal', '-shm']) rmSync(copying + suffix, { force: true });
      const sanitized = new DatabaseSync(sanitizedPath, { readOnly: true });
      try {
        await backup(sanitized, copying);
      } finally {
        sanitized.close();
      }
      chmodSync(copying, 0o600);
      const copied = new DatabaseSync(copying, { readOnly: true });
      try {
        checkDatabase(copied);
        equal(tableHashes(copied), manifest.tables);
      } finally {
        copied.close();
      }
      renameSync(copying, pendingPath);
    }
    target = new DatabaseSync(pendingPath);
    target.exec('PRAGMA journal_mode=DELETE');
    checkDatabase(target);
    const auth = new AuthStore(target);
    new SQLiteSyncStorage(auth);
    target.exec(`CREATE TABLE IF NOT EXISTS workspace_collaboration (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('preparing','ready'))) STRICT;
      CREATE TABLE IF NOT EXISTS spinel_sync_transition_state (
        id INTEGER PRIMARY KEY CHECK(id=1), source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('preparing','complete'))) STRICT;
      CREATE TABLE IF NOT EXISTS spinel_sync_transition_units (
        unit_id TEXT PRIMARY KEY, snapshot_hash TEXT NOT NULL, revision INTEGER NOT NULL) STRICT;`);
    auth.transaction(() => {
      const previous = target!
        .prepare('SELECT source_hash,manifest_hash FROM spinel_sync_transition_state WHERE id=1')
        .get();
      if (previous)
        equal(previous, { source_hash: manifest.sourceHash, manifest_hash: manifestHash });
      else
        target!
          .prepare("INSERT INTO spinel_sync_transition_state VALUES(1,?,?,'preparing')")
          .run(manifest.sourceHash, manifestHash);
    });
    let completed = 0;
    for (const item of legacy) {
      const { result } = exported(directory, manifest, item);
      validateSnapshot(result.snapshot, item.kind, item.unitId);
      validateContent(target, item.itemId, result.snapshot);
      // Validate the pinned native reopen without normalizing away saved data.
      materialize(result.snapshot, item.kind);
      const snapshot = JSON.stringify(result.snapshot);
      const snapshotHash = hash(snapshot);
      auth.transaction(() => {
        const receipt = target!
          .prepare(
            'SELECT snapshot_hash,revision FROM spinel_sync_transition_units WHERE unit_id=?',
          )
          .get(item.unitId);
        const existing = target!
          .prepare(
            'SELECT kind,revision,snapshot,retained_from FROM spinel_sync_units WHERE unit_id=?',
          )
          .get(item.unitId);
        if (receipt) {
          equal(receipt, { snapshot_hash: snapshotHash, revision: result.revision });
          equal(existing, {
            kind: item.kind,
            revision: result.revision,
            snapshot,
            retained_from: result.revision,
          });
          return;
        }
        if (existing) throw unavailable();
        // This trusted, offline import is the sole creation at a non-one head.
        // No transforms can use a pre-cutover base: retained_from equals head.
        target!
          .prepare('INSERT INTO spinel_sync_units VALUES(?,?,?,?,?)')
          .run(item.unitId, item.kind, result.revision, snapshot, result.revision);
        target!
          .prepare('INSERT INTO spinel_sync_transition_units VALUES(?,?,?)')
          .run(item.unitId, snapshotHash, result.revision);
        target!
          .prepare("UPDATE workspace_collaboration SET state='ready' WHERE item_id=?")
          .run(item.itemId);
      });
      completed++;
      options.progress?.({ event: 'sync_transition.imported', completed, total: legacy.length });
    }
    verifyTarget(source, target, manifest);
    verifyImportedUnits(directory, target, manifest);
    auth.transaction(() =>
      target!.prepare("UPDATE spinel_sync_transition_state SET status='complete' WHERE id=1").run(),
    );
    assertSyncTransitionReady(target);
    target.close();
    target = undefined;
    if ((await digest(sourcePath)) !== manifest.sourceHash) throw unavailable();
    renameSync(pendingPath, finalPath);
    options.progress?.({
      event: 'sync_transition.verified',
      completed: legacy.length,
      total: legacy.length,
    });
    return {
      path: finalPath,
      documents: manifest.inventory.length,
      converted: legacy.length,
      resumed: false,
    };
  } finally {
    target?.close();
    source.close();
  }
}
