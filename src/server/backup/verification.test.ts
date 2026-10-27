import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import sharp from 'sharp';
import { DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { makeArchive, restoreArchive } from './archive.ts';
import { verifyInventory } from './inventory.ts';
import { verifyArchive } from './verification.ts';
import { verifySemantics } from './verification-semantics.ts';

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
  return { directory, db, owner, doc, key, keyFile, options, archive };
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

test('wrong key, incompatible image, bounded decompression and killed worker preserve the source', async () => {
  const f = await fixture(),
    archive = await f.archive();
  const wrong = join(f.directory, 'wrong-key');
  await writeFile(wrong, randomBytes(32), { mode: 0o600 });
  const source = await readFile(archive.archive);
  await expect(
    verifyArchive({ ...f.options, archive: archive.archive, keyFile: wrong }),
  ).rejects.toThrow();
  await expect(
    verifyArchive({
      ...f.options,
      archive: archive.archive,
      expectedImage: `sha256:${'b'.repeat(64)}`,
    }),
  ).rejects.toThrow();
  await expect(
    restoreArchive(archive.archive, f.key, f.directory, join(f.directory, 'too-large'), {
      maxDatabaseBytes: 4096,
    }),
  ).rejects.toThrow('limit');
  await expect(
    verifyArchive({ ...f.options, archive: archive.archive, timeoutMs: 1 }),
  ).rejects.toThrow('time limit');
  expect(await readFile(archive.archive)).toEqual(source);
  expect(
    (await readdir(f.directory)).filter(
      (name) => name.startsWith('.verify-') || name.startsWith('.restore-') || name === 'too-large',
    ),
  ).toEqual([]);
}, 30_000);

test('legacy snapshots remain distinguishable from complete verification coverage', async () => {
  const f = await fixture(),
    archive = await f.archive();
  const target = join(f.directory, 'legacy');
  await restoreArchive(archive.archive, f.key, f.directory, target, { preserveJobState: true });
  const db = new DatabaseSync(join(target, 'spinel.sqlite'));
  cleanup.push(() => db.close());
  db.exec('ALTER TABLE spinel_recovery DROP COLUMN inventory');
  expect(verifyInventory(db, false)).toBeUndefined();
  expect(() => verifyInventory(db)).toThrow('predates');
});

test('valid SQL with a cyclic outer tree or mismatched image identity fails semantic checks', async () => {
  const f = await fixture();
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.doc.id, f.doc.id);
  await expect(verifySemantics(f.db)).rejects.toThrow('invariants');
  f.db.exec('PRAGMA query_only=OFF');
  f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(f.doc.id);
  f.db.exec("UPDATE doc_images SET data=x'010203'");
  await expect(verifySemantics(f.db)).rejects.toThrow('invariants');
});
