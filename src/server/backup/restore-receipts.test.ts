import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { backup, DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { OfflineCreations } from '../workspace/offline-creation.ts';
import { PortableFiles } from '../workspace/portable.ts';
import { McpDocuments } from '../mcp/documents.ts';
import { reconcileRestoreCredentials } from './restore-credentials.ts';
import { reconcileRestoreReceipts } from './restore-receipts.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function services(db: DatabaseSync) {
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const collaboration = new CollaborationStore(workspace, db.path);
  cleanup.push(() => collaboration.close());
  const creations = new OfflineCreations(workspace, collaboration),
    files = new PortableFiles(workspace, collaboration);
  new McpDocuments(workspace, collaboration);
  return { db, auth, workspace, collaboration, creations, files };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-receipts-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, 'current.sqlite'));
  cleanup.push(() => db.close());
  const current = services(db),
    owner = current.auth.createUser('Owner');
  const snapshot = async () => {
    const path = join(directory, 'candidate.sqlite');
    await backup(db, path);
    const target = new DatabaseSync(path);
    cleanup.push(() => target.close());
    return services(target);
  };
  return { ...current, owner, snapshot };
}
function receipt(db: DatabaseSync, user: string, item = randomUUID(), unit = randomUUID()) {
  db.prepare('INSERT INTO workspace_offline_creations VALUES(?,?,?,?,?)').run(
    item,
    unit,
    user,
    'a'.repeat(64),
    user,
  );
  return { item, unit };
}
const tables = ['workspace_offline_creations', 'workspace_offline_recoveries', 'mcp_writes'];
const evidence = (db: DatabaseSync) =>
  tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all());

test('a lost creation response cannot recreate a newer accepted then deleted file after restore', async () => {
  const f = await fixture(),
    c = await f.snapshot();
  const request = {
    version: 1 as const,
    itemId: randomUUID(),
    unitId: randomUUID(),
    kind: 'doc' as const,
    name: 'Accepted later',
    parentId: null,
  };
  f.creations.create(f.owner.id, request, () => {});
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(request.itemId);
  const original = evidence(f.db);
  reconcileRestoreCredentials(f.db, c.db);
  expect(reconcileRestoreReceipts(f.db, c.db)).toEqual({ copied: 1, matched: 0 });
  expect(() => c.creations.create(f.owner.id, request, () => {})).toThrow(
    expect.objectContaining({ code: 'creation-conflict' }),
  );
  expect(
    c.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(request.itemId),
  ).toBeUndefined();
  expect(
    c.db.prepare('SELECT * FROM spinel_sync_units WHERE unit_id=?').get(request.unitId),
  ).toBeUndefined();
  expect(evidence(f.db)).toEqual(original);
  expect(reconcileRestoreReceipts(f.db, c.db)).toEqual({ copied: 0, matched: 1 });
});

test('a lost offline recovery response cannot publish another copy for a missing accepted item', async () => {
  const f = await fixture(),
    c = await f.snapshot();
  const request = {
    recoveryId: randomUUID(),
    filename: 'Recovered.univer.json',
    snapshot: {
      id: randomUUID(),
      title: 'Recovered',
      body: { dataStream: 'Retained\r\n', paragraphs: [{ startIndex: 8 }] },
    },
  };
  const accepted = await f.files.recover(f.owner.id, request, () => {});
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(accepted.id);
  reconcileRestoreCredentials(f.db, c.db);
  reconcileRestoreReceipts(f.db, c.db);
  await expect(c.files.recover(f.owner.id, request, () => {})).rejects.toThrow(
    'no longer available',
  );
  expect(c.workspace.list(f.owner.id)).toEqual([]);
  expect(c.db.prepare('SELECT count(*) AS n FROM workspace_offline_recoveries').get()!.n).toBe(1);
});

test('retains archive-only and current-only receipts, including missing documents and later account identities', async () => {
  const f = await fixture();
  receipt(f.db, f.owner.id);
  const c = await f.snapshot();
  f.db.exec('DELETE FROM workspace_offline_creations');
  const later = f.auth.createUser('Later account');
  receipt(f.db, later.id);
  f.db
    .prepare('INSERT INTO workspace_offline_recoveries VALUES(?,?,?,?,?)')
    .run(later.id, randomUUID(), 'b'.repeat(64), randomUUID(), 1);
  f.db
    .prepare('INSERT INTO mcp_writes VALUES(?,?,?,?)')
    .run('token:current', randomUUID(), 'c'.repeat(64), 1000);
  reconcileRestoreCredentials(f.db, c.db);
  expect(reconcileRestoreReceipts(f.db, c.db)).toEqual({ copied: 3, matched: 0 });
  expect(c.db.prepare('SELECT count(*) AS n FROM workspace_offline_creations').get()!.n).toBe(2);
  expect(c.db.prepare('SELECT * FROM workspace_items').all()).toEqual([]);
  expect(reconcileRestoreReceipts(f.db, c.db)).toEqual({ copied: 0, matched: 3 });
});

test.each(['request_hash', 'user_id', 'owner_id', 'unit_id'] as const)(
  'refuses different %s for the same accepted creation',
  async (column) => {
    const f = await fixture();
    const other = f.auth.createUser('Other');
    const accepted = receipt(f.db, f.owner.id),
      c = await f.snapshot();
    f.db
      .prepare(`UPDATE workspace_offline_creations SET ${column}=? WHERE item_id=?`)
      .run(
        column === 'request_hash' ? 'd'.repeat(64) : column === 'unit_id' ? randomUUID() : other.id,
        accepted.item,
      );
    reconcileRestoreCredentials(f.db, c.db);
    const original = evidence(c.db);
    expect(() => reconcileRestoreReceipts(f.db, c.db)).toThrow('incompatible');
    expect(evidence(c.db)).toEqual(original);
  },
);

test.each(['unit', 'cross-namespace'] as const)(
  'refuses %s identity collisions across generations',
  async (kind) => {
    const f = await fixture(),
      archived = receipt(f.db, f.owner.id),
      c = await f.snapshot();
    f.db.exec('DELETE FROM workspace_offline_creations');
    receipt(f.db, f.owner.id, randomUUID(), kind === 'unit' ? archived.unit : archived.item);
    const original = evidence(c.db);
    expect(() => reconcileRestoreReceipts(f.db, c.db)).toThrow();
    expect(evidence(c.db)).toEqual(original);
  },
);

test('a conflicting recovery mapping rolls back creation receipts copied earlier in the transaction', async () => {
  const f = await fixture();
  const recoveryId = randomUUID();
  f.db
    .prepare('INSERT INTO workspace_offline_recoveries VALUES(?,?,?,?,0)')
    .run(f.owner.id, recoveryId, 'b'.repeat(64), randomUUID());
  const c = await f.snapshot();
  receipt(f.db, f.owner.id);
  f.db
    .prepare('UPDATE workspace_offline_recoveries SET item_id=? WHERE recovery_id=?')
    .run(randomUUID(), recoveryId);
  const original = evidence(c.db);
  expect(() => reconcileRestoreReceipts(f.db, c.db)).toThrow('incompatible');
  expect(evidence(c.db)).toEqual(original);
});

test('matching MCP fingerprints keep the later retention date but changed fingerprints refuse', async () => {
  const f = await fixture(),
    id = randomUUID();
  f.db.prepare('INSERT INTO mcp_writes VALUES(?,?,?,?)').run('token:old', id, 'c'.repeat(64), 100);
  const c = await f.snapshot();
  f.db.prepare('UPDATE mcp_writes SET created_at=200').run();
  reconcileRestoreReceipts(f.db, c.db);
  expect(c.db.prepare('SELECT created_at FROM mcp_writes').get()!.created_at).toBe(200);
  f.db.prepare('UPDATE mcp_writes SET payload_hash=?').run('d'.repeat(64));
  expect(() => reconcileRestoreReceipts(f.db, c.db)).toThrow('incompatible');
  expect(c.db.prepare('SELECT payload_hash FROM mcp_writes').get()!.payload_hash).toBe(
    'c'.repeat(64),
  );
});

test('refuses a same-schema unknown receipt column and a source/destination inode alias', async () => {
  const f = await fixture();
  f.db.exec('ALTER TABLE workspace_offline_recoveries ADD COLUMN unknown_policy TEXT');
  const c = await f.snapshot();
  expect(() => reconcileRestoreReceipts(f.db, c.db)).toThrow('incompatible');
  expect(() => reconcileRestoreReceipts(f.db, f.db)).toThrow('incompatible');
});

test('refuses an oversized union atomically even when each input is within its byte budget', async () => {
  const f = await fixture();
  const largeActor = 'x'.repeat(5 * 1024 ** 2);
  f.db.prepare('INSERT INTO mcp_writes VALUES(?,?,?,1)').run(largeActor, 'old', 'a'.repeat(64));
  const c = await f.snapshot();
  f.db.exec('DELETE FROM mcp_writes');
  f.db.prepare('INSERT INTO mcp_writes VALUES(?,?,?,1)').run(largeActor, 'new', 'b'.repeat(64));
  expect(() => reconcileRestoreReceipts(f.db, c.db)).toThrow();
  expect(c.db.prepare('SELECT request_id FROM mcp_writes').all()).toEqual([{ request_id: 'old' }]);
});
