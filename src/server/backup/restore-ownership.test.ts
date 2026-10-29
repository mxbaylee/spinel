import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { backup, DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { OwnershipTransfer } from '../auth/ownership.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { TrashStore, DAY_MS } from '../workspace/trash.ts';
import { SpaceRecoveryStore } from '../workspace/space-recovery.ts';
import { reconcileRestoreCredentials } from './restore-credentials.ts';
import { reconcileRestoreOwnership } from './restore-ownership.ts';
import { reconcileRestoreGrants } from './restore-grants.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-ownership-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, 'current.sqlite'));
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Original owner'),
    recipient = auth.createUser('Current owner'),
    reader = auth.createUser('Collaborator'),
    operator = auth.createUser('Operator', true);
  const spaces = new SpaceStore(workspace),
    recovery = new SpaceRecoveryStore(workspace),
    trash = new TrashStore(workspace);
  db.exec(
    'CREATE TABLE retained_fixture(item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE, content TEXT NOT NULL) STRICT',
  );
  const file = (kind: 'folder' | 'doc' = 'doc', parentId: string | null = null) => {
    const item = workspace.create(owner.id, { kind, parentId, name: 'Private retained content' });
    db.prepare('INSERT INTO retained_fixture VALUES(?,?)').run(item.id, 'original:' + item.id);
    return item;
  };
  const snapshot = async () => {
    const path = join(directory, 'candidate.sqlite');
    await backup(db, path);
    const candidate = new DatabaseSync(path);
    cleanup.push(() => candidate.close());
    const targetWorkspace = new WorkspaceStore(new AuthStore(candidate), { spacesEnabled: true });
    return { candidate, targetWorkspace };
  };
  return {
    db,
    auth,
    workspace,
    owner,
    recipient,
    reader,
    operator,
    spaces,
    recovery,
    trash,
    file,
    snapshot,
  };
}
const row = (db: DatabaseSync, id: string) =>
  db.prepare('SELECT * FROM workspace_items WHERE id=?').get(id)!;
const snapshotState = (db: DatabaseSync) =>
  [
    'auth_users',
    'workspace_items',
    'workspace_grants',
    'workspace_recovery_holds',
    'retained_fixture',
  ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());

test('current ownership wins and changed ownership boundaries detach without altering native evidence', async () => {
  const f = await fixture(),
    parent = f.file('folder'),
    child = f.file('doc', parent.id),
    c = await f.snapshot();
  f.db
    .prepare('UPDATE workspace_items SET owner_id=?,parent_id=NULL WHERE id=?')
    .run(f.recipient.id, child.id);
  reconcileRestoreCredentials(f.db, c.candidate);
  const original = snapshotState(f.db),
    content = c.candidate.prepare('SELECT * FROM retained_fixture ORDER BY 1').all();
  expect(reconcileRestoreOwnership(f.db, c.candidate)).toMatchObject({
    currentItems: 2,
    isolatedItems: 0,
    detachedRoots: 1,
  });
  expect(row(c.candidate, child.id)).toMatchObject({ owner_id: f.recipient.id, parent_id: null });
  expect(row(c.candidate, parent.id).owner_id).toBe(f.owner.id);
  expect(c.candidate.prepare('SELECT * FROM retained_fixture ORDER BY 1').all()).toEqual(content);
  expect(snapshotState(f.db)).toEqual(original);
});

test('splits ordinary known/unknown boundaries in both directions and strips archived sharing', async () => {
  const f = await fixture();
  const knownRoot = f.file('folder'),
    unknownParent = f.file('folder', knownRoot.id),
    knownChild = f.file('doc', unknownParent.id),
    unknownChild = f.file('doc', unknownParent.id);
  f.workspace.share(f.owner.id, unknownParent.id, f.reader.id, 'editor');
  const c = await f.snapshot();
  f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(knownChild.id);
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(unknownChild.id);
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(unknownParent.id);
  reconcileRestoreCredentials(f.db, c.candidate);
  expect(reconcileRestoreOwnership(f.db, c.candidate)).toMatchObject({
    currentItems: 2,
    isolatedItems: 2,
    isolatedGroups: 1,
    detachedRoots: 2,
  });
  const isolated = String(row(c.candidate, unknownParent.id).owner_id);
  expect(isolated).not.toBe(f.owner.id);
  expect(row(c.candidate, unknownParent.id).parent_id).toBeNull();
  expect(row(c.candidate, unknownChild.id)).toMatchObject({
    owner_id: isolated,
    parent_id: unknownParent.id,
  });
  expect(row(c.candidate, knownChild.id)).toMatchObject({
    owner_id: f.owner.id,
    parent_id: null,
  });
  expect(
    c.candidate.prepare('SELECT is_admin,disabled FROM auth_users WHERE id=?').get(isolated),
  ).toEqual({ is_admin: 0, disabled: 1 });
  expect(c.candidate.prepare('SELECT * FROM auth_passkeys WHERE user_id=?').all(isolated)).toEqual(
    [],
  );
  expect(() => c.targetWorkspace.get(f.reader.id, unknownChild.id)).toThrow();
  reconcileRestoreGrants(f.workspace, c.targetWorkspace);
});

test('distinct archive-only components get distinct identities and can be explicitly handed over with held trash', async () => {
  const f = await fixture(),
    first = f.file(),
    second = f.file();
  f.trash.trash(f.owner.id, first.id);
  const c = await f.snapshot();
  f.db.exec('DELETE FROM workspace_items');
  reconcileRestoreCredentials(f.db, c.candidate);
  expect(reconcileRestoreOwnership(f.db, c.candidate)).toMatchObject({
    isolatedGroups: 2,
    heldTrashBatches: 1,
  });
  const owner1 = String(row(c.candidate, first.id).owner_id),
    owner2 = String(row(c.candidate, second.id).owner_id);
  expect(owner1).not.toBe(owner2);
  const transfer = new OwnershipTransfer(c.targetWorkspace.auth),
    preview = transfer.preview(f.operator.id, owner1);
  transfer.transfer(f.operator.id, owner1, f.recipient.id, preview.confirmation);
  const later = new WorkspaceStore(new AuthStore(c.candidate, () => Date.now() + 40 * DAY_MS), {
    spacesEnabled: true,
  });
  new TrashStore(later).restore(f.recipient.id, first.id);
  expect(later.get(f.recipient.id, first.id).name).toBe('Private retained content');
  expect(row(c.candidate, second.id).owner_id).toBe(owner2);
});

test('quarantines an entirely missing Space atomically and preserves its recovery record', async () => {
  const f = await fixture(),
    root = f.spaces.createRoot(f.owner.id, { name: 'Private Space', parentId: null }).space;
  const child = f.spaces.createChild(f.owner.id, root.id, {
    name: 'Page',
    kind: 'doc',
    parentId: root.id,
  }).item;
  f.recovery.trash(f.owner.id, root.id, child.id);
  const c = await f.snapshot(),
    original = c.candidate.prepare('SELECT * FROM workspace_space_trash').all();
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(child.id);
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(root.id);
  reconcileRestoreCredentials(f.db, c.candidate);
  expect(reconcileRestoreOwnership(f.db, c.candidate)).toMatchObject({
    isolatedGroups: 1,
    isolatedItems: 2,
    heldTrashBatches: 1,
  });
  expect(row(c.candidate, child.id).owner_id).toBe(row(c.candidate, root.id).owner_id);
  expect(c.candidate.prepare('SELECT * FROM workspace_space_trash').all()).toEqual(original);
});

test('refuses mixed known/unknown Space membership before changing any candidate data', async () => {
  const f = await fixture(),
    root = f.spaces.createRoot(f.owner.id, { name: 'Space', parentId: null }).space;
  const child = f.spaces.createChild(f.owner.id, root.id, {
    name: 'Page',
    kind: 'doc',
    parentId: root.id,
  }).item;
  const c = await f.snapshot();
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(child.id);
  reconcileRestoreCredentials(f.db, c.candidate);
  const before = snapshotState(c.candidate);
  expect(() => reconcileRestoreOwnership(f.db, c.candidate)).toThrow('ownership');
  expect(snapshotState(c.candidate)).toEqual(before);
});

test('an in-transaction failure restores accounts, topology, sharing, holds and retained content', async () => {
  const f = await fixture(),
    item = f.file();
  f.workspace.share(f.owner.id, item.id, f.reader.id, 'viewer');
  const c = await f.snapshot();
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(item.id);
  reconcileRestoreCredentials(f.db, c.candidate);
  const before = snapshotState(c.candidate),
    prepare = c.candidate.prepare.bind(c.candidate);
  vi.spyOn(c.candidate, 'prepare').mockImplementation((sql) => {
    if (sql.startsWith('UPDATE workspace_items SET owner_id=')) throw new Error('fixture failure');
    return prepare(sql);
  });
  expect(() => reconcileRestoreOwnership(f.db, c.candidate)).toThrow('fixture failure');
  expect(snapshotState(c.candidate)).toEqual(before);
});

test('refuses kind/Space namespace changes, malformed trees and inode aliases', async () => {
  const f = await fixture(),
    parent = f.file('folder'),
    child = f.file('doc', parent.id),
    root = f.spaces.createRoot(f.owner.id, { name: 'Space', parentId: null }).space,
    c = await f.snapshot();
  expect(() => reconcileRestoreOwnership(f.db, f.db)).toThrow('ownership');
  c.candidate.prepare("UPDATE workspace_items SET kind='sheet' WHERE id=?").run(child.id);
  expect(() => reconcileRestoreOwnership(f.db, c.candidate)).toThrow('ownership');
  c.candidate.prepare("UPDATE workspace_items SET kind='doc' WHERE id=?").run(child.id);
  c.candidate
    .prepare('UPDATE workspace_items SET parent_id=?,space_id=?,space_position=0 WHERE id=?')
    .run(root.id, root.id, child.id);
  expect(() => reconcileRestoreOwnership(f.db, c.candidate)).toThrow('ownership');
  c.candidate
    .prepare('UPDATE workspace_items SET parent_id=?,space_id=NULL,space_position=NULL WHERE id=?')
    .run(parent.id, child.id);
  c.candidate
    .prepare('UPDATE workspace_items SET parent_id=? WHERE id=?')
    .run(parent.id, parent.id);
  expect(() => reconcileRestoreOwnership(f.db, c.candidate)).toThrow('ownership');
});

test('refuses a component that cannot fit the existing handover budget including its new folder', async () => {
  const f = await fixture(),
    parent = f.file('folder');
  f.db
    .prepare(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<9999)
    INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at)
    SELECT 'retained-'||x,?,?,'doc','Retained',0,0 FROM n`,
    )
    .run(f.owner.id, parent.id);
  const c = await f.snapshot();
  f.db.prepare('DELETE FROM workspace_items WHERE parent_id=?').run(parent.id);
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(parent.id);
  reconcileRestoreCredentials(f.db, c.candidate);
  const users = c.candidate.prepare('SELECT * FROM auth_users ORDER BY id').all();
  expect(() => reconcileRestoreOwnership(f.db, c.candidate)).toThrow('ownership');
  expect(c.candidate.prepare('SELECT * FROM auth_users ORDER BY id').all()).toEqual(users);
  expect(c.candidate.prepare('SELECT count(*) AS n FROM workspace_items').get()!.n).toBe(10000);
});

test.each([
  [-1, 'batch'],
  [Number.MAX_SAFE_INTEGER + 1, 'batch'],
  [0, ''],
])('refuses trash metadata that prevents later handover: %s %s', async (timestamp, batch) => {
  const f = await fixture(),
    item = f.file(),
    c = await f.snapshot();
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(item.id);
  c.candidate
    .prepare('UPDATE workspace_items SET trashed_at=?,trash_batch=? WHERE id=?')
    .run(timestamp, batch, item.id);
  reconcileRestoreCredentials(f.db, c.candidate);
  const before = snapshotState(c.candidate);
  expect(() => reconcileRestoreOwnership(f.db, c.candidate)).toThrow('ownership');
  expect(snapshotState(c.candidate)).toEqual(before);
});

test('refuses a foreign-key-valid Space recovery record outside any Space graph', async () => {
  const f = await fixture(),
    first = f.file(),
    second = f.file(),
    c = await f.snapshot();
  f.db.exec('DELETE FROM workspace_items');
  c.candidate
    .prepare('UPDATE workspace_items SET trashed_at=0,trash_batch=? WHERE id=?')
    .run('batch', first.id);
  c.candidate
    .prepare('INSERT INTO workspace_space_trash VALUES(?,?,?,?,?,?,?)')
    .run(first.id, second.id, second.id, 0, 0, f.owner.id, 'batch');
  reconcileRestoreCredentials(f.db, c.candidate);
  const before = snapshotState(c.candidate),
    records = c.candidate.prepare('SELECT * FROM workspace_space_trash').all();
  expect(c.candidate.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(() => reconcileRestoreOwnership(f.db, c.candidate)).toThrow('ownership');
  expect(snapshotState(c.candidate)).toEqual(before);
  expect(c.candidate.prepare('SELECT * FROM workspace_space_trash').all()).toEqual(records);
});
