import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test } from 'vitest';
import sharp from 'sharp';
import { SyncServer } from '@spinel/sync-server';
import { backup, DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { TrashStore, DAY_MS } from '../workspace/trash.ts';
import { holdRestoredTrash } from '../workspace/recovery-holds.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { SQLiteSyncStorage } from '../sync/store.ts';
import { makeArchive, restoreArchive } from './archive.ts';
import { verifyInventory } from './inventory.ts';
import { checkVerificationHeadroom, prepareRestoreArchive, verifyArchive } from './verification.ts';
import { verifySemantics } from './verification-semantics.ts';
import { RecoveryResourceError } from './resource-error.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const recovery = {
  format: 1 as const,
  createdAt: '2026-10-27T02:00:00.000Z',
  origin: 'https://spinel.example',
  image: `sha256:${'a'.repeat(64)}`,
  runtimeEnvironment: 'NODE_ENV=production\n',
  keyId: 'current',
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-verify-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, 'live.sqlite'));
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const viewer = auth.createUser('Reader');
  auth.createUser('Operator', true);
  migrateSpaceSchema(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const sheets = new SheetStore(workspace);
  const docs = new DocumentStore(workspace);
  const doc = workspace.create(owner.id, { name: 'Journal', kind: 'doc', parentId: null });
  const sheet = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#abc' } })
    .png()
    .toBuffer();
  const picture = await docs.upload(owner.id, doc.id, bytes, 'image/png');
  docs.save(owner.id, doc.id, {
    revision: 0,
    writeId: randomUUID(),
    snapshot: {
      id: doc.id,
      body: { dataStream: 'Retained journal\r\n' },
      drawings: { image: { source: picture.url } },
    },
  });
  sheets.save(owner.id, sheet.id, {
    revision: 0,
    writeId: randomUUID(),
    snapshot: {
      id: sheet.id,
      name: 'Budget',
      sheetOrder: ['sheet'],
      sheets: { sheet: { id: 'sheet', name: 'Sheet1', cellData: { 0: { 0: { v: 42 } } } } },
    },
  });
  workspace.share(owner.id, doc.id, viewer.id, 'viewer');
  db.exec(
    "CREATE TABLE future_data (id INTEGER PRIMARY KEY,value BLOB,large_integer INTEGER,precise_real REAL); INSERT INTO future_data VALUES(1,x'00ff',9223372036854775807,1.0000000000000002)",
  );
  const key = randomBytes(32),
    keyFile = join(directory, 'key');
  await writeFile(keyFile, key, { mode: 0o600 });
  const options = {
    keyFile,
    stagingRoot: directory,
    expectedOrigin: recovery.origin,
    expectedImage: recovery.image,
  };
  const archive = async () => {
    const result = await makeArchive(db, directory, key, recovery);
    cleanup.push(result.dispose);
    return result;
  };
  return { directory, db, auth, workspace, owner, doc, sheet, key, keyFile, options, archive };
}

test('a real isolated process authenticates inventory, native content, image bytes and access structure', async () => {
  const f = await fixture(),
    archive = await f.archive();
  const source = await readFile(archive.archive);
  const result = await verifyArchive({ ...f.options, archive: archive.archive });
  expect(result).toMatchObject({ snapshots: 2, images: 1, keyId: 'current' });
  expect(result.tables).toBeGreaterThan(10);
  expect(result.rows).toBeGreaterThan(5);
  expect(await readFile(archive.archive)).toEqual(source);
  expect(
    (await readdir(f.directory)).filter(
      (name) => name.startsWith('.verify-') || name.startsWith('.restore-'),
    ),
  ).toEqual([]);
  expect(
    f.db.prepare('SELECT snapshot FROM doc_snapshots WHERE item_id=?').get(f.doc.id)?.snapshot,
  ).toContain('Retained journal');
}, 30_000);

test('restore preparation retains verified bytes without activating data or returning deployment secrets', async () => {
  const f = await fixture(),
    archive = await f.archive();
  const source = await readFile(archive.archive);
  f.db.prepare('UPDATE workspace_items SET name=? WHERE id=?').run('Newer work', f.doc.id);
  const prepared = await prepareRestoreArchive({
    ...f.options,
    archive: archive.archive,
    expectedArchive: { bytes: (await stat(archive.archive)).size, sha256: archive.sha256 },
  });
  cleanup.push(prepared.dispose);
  expect(prepared.archive.path).not.toBe(archive.archive);
  expect(prepared.archive.bytes).toBe(source.length);
  expect(prepared.archive.sha256).toBe(archive.sha256);
  expect(await readFile(prepared.archive.path)).toEqual(source);
  expect(prepared).toMatchObject({
    snapshots: 2,
    images: 1,
    keyId: 'current',
    recovery: { createdAt: recovery.createdAt, origin: recovery.origin, image: recovery.image },
  });
  expect(JSON.stringify(prepared)).not.toContain('NODE_ENV');
  expect(Object.keys(prepared.recovery).sort()).toEqual(['createdAt', 'image', 'origin']);
  expect(await readdir(dirname(prepared.databasePath))).toEqual(['spinel.sqlite']);
  expect((await stat(prepared.databasePath)).mode & 0o077).toBe(0);
  const candidate = await readFile(prepared.databasePath);
  expect(candidate.length).toBe(prepared.databaseBytes);
  expect(createHash('sha256').update(candidate).digest('hex')).toBe(prepared.databaseSha256);
  const restored = new DatabaseSync(prepared.databasePath);
  try {
    expect(verifyInventory(restored)).toMatchObject({
      tables: prepared.tables,
      rows: prepared.rows,
    });
    expect(
      restored.prepare('SELECT name FROM workspace_items WHERE id=?').get(f.doc.id)?.name,
    ).toBe('Journal');
  } finally {
    restored.close();
  }
  // Preparation is deliberately separate from permission to discard later work.
  expect(f.db.prepare('SELECT name FROM workspace_items WHERE id=?').get(f.doc.id)?.name).toBe(
    'Newer work',
  );
  expect(await readFile(archive.archive)).toEqual(source);
  await archive.dispose();
  expect(await readFile(prepared.archive.path)).toEqual(source);
  await prepared.dispose();
  await prepared.dispose();
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-candidate-')),
  ).toEqual([]);
}, 30_000);

test('source preparation requires the exact completed encrypted transfer', async () => {
  const f = await fixture(),
    archive = await f.archive();
  const source = await readFile(archive.archive);
  for (const expectedArchive of [
    { bytes: source.length, sha256: '0'.repeat(64) },
    { bytes: source.length + 1, sha256: archive.sha256 },
  ])
    await expect(
      prepareRestoreArchive({ ...f.options, archive: archive.archive, expectedArchive }),
    ).rejects.toThrow();
  expect(await readFile(archive.archive)).toEqual(source);
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-candidate-')),
  ).toEqual([]);
});

test('encrypted candidate preparation preserves a populated recovery hold and permits later authorized recovery', async () => {
  const f = await fixture();
  new TrashStore(f.workspace).trash(f.owner.id, f.doc.id);
  holdRestoredTrash(f.db);
  const expected = f.db.prepare('SELECT * FROM workspace_recovery_holds').all();
  const archive = await f.archive();
  const prepared = await prepareRestoreArchive({
    ...f.options,
    archive: archive.archive,
    expectedArchive: { bytes: (await stat(archive.archive)).size, sha256: archive.sha256 },
  });
  cleanup.push(prepared.dispose);
  const db = new DatabaseSync(prepared.databasePath);
  try {
    expect(db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual(expected);
    expect(verifyInventory(db)).toMatchObject({ rows: prepared.rows, tables: prepared.tables });
    const workspace = new WorkspaceStore(new AuthStore(db, () => Date.now() + 40 * DAY_MS), {
      spacesEnabled: true,
    });
    new TrashStore(workspace).restore(f.owner.id, f.doc.id);
    expect(workspace.get(f.owner.id, f.doc.id).name).toBe('Journal');
    expect(db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual([]);
  } finally {
    db.close();
  }
  expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual(expected);
}, 30_000);

test('incompatible or interrupted preparation leaves no candidate and preserves the encrypted source', async () => {
  const f = await fixture(),
    archive = await f.archive();
  const source = await readFile(archive.archive);
  await expect(
    prepareRestoreArchive({
      ...f.options,
      archive: archive.archive,
      expectedArchive: { bytes: (await stat(archive.archive)).size, sha256: archive.sha256 },
      expectedImage: `sha256:${'b'.repeat(64)}`,
    }),
  ).rejects.toMatchObject({ code: 'backup-image' });
  await expect(
    prepareRestoreArchive({
      ...f.options,
      archive: archive.archive,
      expectedArchive: { bytes: (await stat(archive.archive)).size, sha256: archive.sha256 },
      expectedOrigin: 'https://another.example',
    }),
  ).rejects.toMatchObject({ code: 'backup-origin' });
  await expect(
    prepareRestoreArchive({
      ...f.options,
      archive: archive.archive,
      expectedArchive: { bytes: (await stat(archive.archive)).size, sha256: archive.sha256 },
      timeoutMs: 1,
    }),
  ).rejects.toEqual(new RecoveryResourceError('time-limit'));
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-candidate-')),
  ).toEqual([]);
  expect(await readFile(archive.archive)).toEqual(source);
}, 30_000);

test('inventory covers unknown tables, integer/real precision, data, schema and empty tables', async () => {
  const f = await fixture(),
    archive = await f.archive();
  const target = join(f.directory, 'restored');
  await restoreArchive(archive.archive, f.key, f.directory, target, {
    requireInventory: true,
    preserveJobState: true,
  });
  const db = new DatabaseSync(join(target, 'spinel.sqlite'));
  cleanup.push(() => db.close());
  expect(verifyInventory(db)?.tables).toBeGreaterThan(10);
  db.exec('UPDATE future_data SET large_integer=9223372036854775806');
  expect(() => verifyInventory(db)).toThrow('does not match');
  db.exec('UPDATE future_data SET large_integer=9223372036854775807');
  expect(verifyInventory(db)).toBeDefined();
  db.exec('UPDATE future_data SET precise_real=1.0000000000000004');
  expect(() => verifyInventory(db)).toThrow('does not match');
  db.exec('UPDATE future_data SET precise_real=1.0000000000000002');
  expect(verifyInventory(db)).toBeDefined();
  db.exec('CREATE TABLE extra_empty (id INTEGER)');
  expect(() => verifyInventory(db)).toThrow('does not match');
});

test('a freshly authenticated but semantically broken snapshot is rejected', async () => {
  const f = await fixture();
  f.db
    .prepare('UPDATE doc_snapshots SET snapshot=? WHERE item_id=?')
    .run(
      JSON.stringify({ id: 'wrong-document', body: { dataStream: 'Invalid identity\r\n' } }),
      f.doc.id,
    );
  const archive = await f.archive();
  await expect(verifyArchive({ ...f.options, archive: archive.archive })).rejects.toThrow(
    'verification',
  );
  expect((await readdir(f.directory)).filter((name) => name.startsWith('.verify-'))).toEqual([]);
}, 30_000);

test('an online snapshot preserves an interrupted staged generation without activating it', async () => {
  const f = await fixture();
  const generations = new CollaborationGenerations(f.workspace);
  const storage = new SQLiteSyncStorage(f.auth);
  const snapshot = {
    id: f.doc.id,
    documentStyle: {},
    body: { dataStream: 'Current native document\r\n' },
  };
  storage.create(
    { unitId: f.doc.id, kind: 'doc', revision: 1, retainedFrom: 1, snapshot },
    () => {},
  );
  const job = generations.begin(f.owner.id, f.doc.id, f.doc.id, randomUUID(), randomUUID());
  storage.create(
    {
      unitId: job.nextUnit,
      kind: 'doc',
      revision: 1,
      retainedFrom: 1,
      snapshot: { ...snapshot, id: job.nextUnit },
    },
    () => {},
  );
  const archive = await f.archive();
  const result = await verifyArchive({ ...f.options, archive: archive.archive });
  expect(result.snapshots).toBe(4);
  expect(generations.active(f.doc.id).unitId).toBe(f.doc.id);
  expect(
    f.db.prepare('SELECT status FROM spinel_restore_jobs WHERE id=?').get(job.id)?.status,
  ).toBe('staging');
  f.db
    .prepare('UPDATE spinel_restore_jobs SET previous_unit=? WHERE id=?')
    .run('not-active', job.id);
  await expect(verifySemantics(f.db)).rejects.toThrow('invariants');
}, 30_000);

test('a completed imported head verifies before and after a real native edit, but missing receipts fail', async () => {
  const f = await fixture();
  const storage = new SQLiteSyncStorage(f.auth);
  const text = String(
    f.db.prepare('SELECT snapshot FROM sheet_snapshots WHERE item_id=?').get(f.sheet.id)!.snapshot,
  );
  const snapshotHash = createHash('sha256').update(text).digest('hex');
  // These are the exact completed-cutover tables/receipts written by
  // importSyncTransition. A legacy revision 17 has no native edits 2 through 17.
  f.db.exec(`CREATE TABLE spinel_sync_transition_state (
    id INTEGER PRIMARY KEY CHECK(id=1), source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('preparing','complete'))) STRICT;
    CREATE TABLE spinel_sync_transition_units (
      unit_id TEXT PRIMARY KEY, snapshot_hash TEXT NOT NULL, revision INTEGER NOT NULL) STRICT;`);
  f.db
    .prepare("INSERT INTO spinel_sync_transition_state VALUES(1,?,?,'complete')")
    .run('a'.repeat(64), 'b'.repeat(64));
  f.db
    .prepare('INSERT INTO spinel_sync_units VALUES(?,?,?,?,?)')
    .run(f.sheet.id, 'sheet', 17, text, 17);
  f.db
    .prepare('INSERT INTO spinel_sync_transition_units VALUES(?,?,?)')
    .run(f.sheet.id, snapshotHash, 17);
  const initial = await f.archive();
  await expect(verifyArchive({ ...f.options, archive: initial.archive })).resolves.toMatchObject({
    snapshots: 3,
  });
  f.db.exec("UPDATE spinel_sync_transition_state SET status='preparing'");
  await expect(verifySemantics(f.db)).rejects.toThrow('invariants');
  f.db.exec("PRAGMA query_only=OFF; UPDATE spinel_sync_transition_state SET status='complete'");
  const server = new SyncServer<void>(storage, { authorize() {} });
  cleanup.push(() => server.close());
  const edited = await server.submit(
    {
      unitId: f.sheet.id,
      actorId: f.owner.id,
      mutationId: randomUUID(),
      baseRevision: 17,
      mutations: [
        {
          id: 'sheet.mutation.set-range-values',
          params: {
            unitId: f.sheet.id,
            subUnitId: 'sheet',
            cellValue: { 0: { 0: { v: 84 } } },
          },
        },
      ],
    },
    undefined,
  );
  expect(edited.edit.revision).toBe(18);
  const after = await f.archive();
  await expect(verifyArchive({ ...f.options, archive: after.archive })).resolves.toMatchObject({
    snapshots: 3,
  });
  f.db.prepare('DELETE FROM spinel_sync_transition_units WHERE unit_id=?').run(f.sheet.id);
  await expect(verifySemantics(f.db)).rejects.toThrow('invariants');
  f.db.exec('PRAGMA query_only=OFF');
  f.db
    .prepare('INSERT INTO spinel_sync_transition_units VALUES(?,?,?)')
    .run(f.sheet.id, snapshotHash, 17);
  f.db.prepare('DELETE FROM spinel_sync_revisions WHERE unit_id=? AND revision=18').run(f.sheet.id);
  const incomplete = await f.archive();
  await expect(verifyArchive({ ...f.options, archive: incomplete.archive })).rejects.toThrow(
    'verification',
  );
}, 30_000);

test('a small container and host memory pressure refuse verification before an OOM', async () => {
  const MiB = 1024 ** 2;
  let maximum = String(1024 * MiB),
    used = String(600 * MiB),
    host = 'MemAvailable: 8388608 kB\n';
  const read = async (path: string) => {
    if (path === '/sys/fs/cgroup/memory.max') return maximum;
    if (path === '/sys/fs/cgroup/memory.current') return used;
    if (path === '/proc/meminfo') return host;
    throw new Error('Unexpected resource path.');
  };
  // Plenty of host memory does not make room inside a 1 GiB application limit.
  await expect(checkVerificationHeadroom('start', read, 'linux')).rejects.toEqual(
    new RecoveryResourceError('memory-headroom'),
  );
  used = String(950 * MiB);
  await expect(checkVerificationHeadroom('running', read, 'linux')).rejects.toThrow('headroom');
  maximum = 'max';
  await expect(checkVerificationHeadroom('start', read, 'linux')).resolves.toBeUndefined();
  host = 'MemAvailable: 102400 kB\n';
  const unavailableCgroup = async (path: string) => {
    if (path === '/proc/meminfo') return host;
    throw new Error('ENOENT');
  };
  await expect(checkVerificationHeadroom('running', unavailableCgroup, 'linux')).rejects.toThrow(
    'headroom',
  );
  host = 'MemAvailable: 8388608 kB\n';
  await expect(
    checkVerificationHeadroom('start', unavailableCgroup, 'linux'),
  ).resolves.toBeUndefined();
  await expect(checkVerificationHeadroom('start', read, 'darwin')).resolves.toBeUndefined();
});

test('wrong key, incompatible image, bounded decompression and killed worker preserve the source', async () => {
  const f = await fixture(),
    archive = await f.archive();
  const wrong = join(f.directory, 'wrong-key');
  await writeFile(wrong, randomBytes(32), { mode: 0o600 });
  const alias = join(f.directory, 'key-alias');
  await symlink(f.keyFile, alias);
  const source = await readFile(archive.archive);
  await expect(
    verifyArchive({ ...f.options, archive: archive.archive, keyFile: wrong }),
  ).rejects.toMatchObject({ name: 'RecoveryResourceError', code: 'backup-unreadable' });
  await expect(
    verifyArchive({ ...f.options, archive: archive.archive, keyFile: alias }),
  ).rejects.toThrow();
  await expect(
    verifyArchive({
      ...f.options,
      archive: archive.archive,
      expectedImage: `sha256:${'b'.repeat(64)}`,
    }),
  ).rejects.toMatchObject({ code: 'backup-image' });
  await expect(
    restoreArchive(archive.archive, f.key, f.directory, join(f.directory, 'too-large'), {
      maxDatabaseBytes: 4096,
    }),
  ).rejects.toMatchObject({ name: 'RecoveryResourceError', code: 'database-size' });
  // The child reports an allowlisted code; the parent reconstructs the same safe
  // error class, so the service can stop key retries and show useful advice.
  await expect(
    verifyArchive({ ...f.options, archive: archive.archive, maxDatabaseBytes: 4096 }),
  ).rejects.toEqual(new RecoveryResourceError('database-size'));
  await expect(
    verifyArchive({ ...f.options, archive: archive.archive, timeoutMs: 1 }),
  ).rejects.toEqual(new RecoveryResourceError('time-limit'));
  expect(await readFile(archive.archive)).toEqual(source);
  expect(
    (await readdir(f.directory)).filter(
      (name) => name.startsWith('.verify-') || name.startsWith('.restore-') || name === 'too-large',
    ),
  ).toEqual([]);
}, 30_000);

test('an old encrypted bundle restores unchanged but cannot claim complete verification coverage', async () => {
  const f = await fixture();
  const legacyRecovery = {
    format: recovery.format,
    createdAt: recovery.createdAt,
    origin: recovery.origin,
    image: recovery.image,
    runtimeEnvironment: recovery.runtimeEnvironment,
  };
  const copy = join(f.directory, 'legacy.sqlite');
  await backup(f.db, copy);
  const legacy = new DatabaseSync(copy);
  try {
    legacy.exec(
      'PRAGMA journal_mode=DELETE; CREATE TABLE spinel_recovery (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL) STRICT',
    );
    legacy.prepare('INSERT INTO spinel_recovery VALUES(1,?)').run(JSON.stringify(legacyRecovery));
  } finally {
    legacy.close();
  }
  // Produce the previous on-disk format independently: no inventory column and
  // no key identifier. The current writer intentionally cannot emit this format.
  const header = Buffer.concat([Buffer.from('SPINEL01'), randomBytes(12)]);
  const cipher = createCipheriv('aes-256-gcm', f.key, header.subarray(8));
  cipher.setAAD(header);
  const bytes = Buffer.concat([
    header,
    cipher.update(gzipSync(await readFile(copy))),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const archive = join(f.directory, 'legacy.spinel');
  await writeFile(archive, bytes, { mode: 0o600 });
  const target = join(f.directory, 'legacy-restored');
  expect(await restoreArchive(archive, f.key, f.directory, target)).toEqual(legacyRecovery);
  const db = new DatabaseSync(join(target, 'spinel.sqlite'));
  cleanup.push(() => db.close());
  expect(verifyInventory(db, false)).toBeUndefined();
  expect(() => verifyInventory(db)).toThrow('predates');
  await expect(verifyArchive({ ...f.options, archive })).rejects.toThrow('verification');
  expect(await readFile(archive)).toEqual(bytes);
  expect((await readdir(f.directory)).filter((name) => name.startsWith('.verify-'))).toEqual([]);
}, 30_000);

test('valid SQL with a cyclic outer tree or mismatched image identity fails semantic checks', async () => {
  const f = await fixture();
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.doc.id, f.doc.id);
  await expect(verifySemantics(f.db)).rejects.toThrow('invariants');
  f.db.exec('PRAGMA query_only=OFF');
  f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(f.doc.id);
  f.db.exec("UPDATE doc_images SET data=x'010203'");
  await expect(verifySemantics(f.db)).rejects.toThrow('invariants');
});
