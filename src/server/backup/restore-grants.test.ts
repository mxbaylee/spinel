import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { backup, DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { AdminStore } from '../auth/admin.ts';
import { InvitationService } from '../auth/invitations.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { resolveSpaceScope } from '../workspace/space-scope.ts';
import { TrashStore } from '../workspace/trash.ts';
import { reconcileRestoreCredentials } from './restore-credentials.ts';
import { reconcileRestoreGrants } from './restore-grants.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-grants-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, 'current.sqlite'));
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  new InvitationService(auth, 'https://spinel.example');
  const trash = new TrashStore(workspace);
  const owner = auth.createUser('Owner'),
    reader = auth.createUser('Collaborator'),
    operator = auth.createUser('Operator', true);
  const insert = (
    kind: 'folder' | 'doc' | 'space',
    parent: string | null = null,
    space: string | null = null,
  ) => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
      VALUES(?,?,?,?,?,0,0,?,?)`,
    ).run(id, owner.id, parent, kind, 'Private document name', space, space ? 0 : null);
    return id;
  };
  const folder = insert('folder'),
    doc = insert('doc', folder),
    elsewhere = insert('folder');
  const grant = (item: string, role: 'viewer' | 'editor' | 'admin', user = reader.id) =>
    db
      .prepare(
        `INSERT INTO workspace_grants VALUES(?,?,?,123)
      ON CONFLICT(item_id,user_id) DO UPDATE SET role=excluded.role`,
      )
      .run(item, user, role);
  const snapshot = async () => {
    const path = join(directory, 'candidate.sqlite');
    await backup(db, path);
    const target = new DatabaseSync(path);
    cleanup.push(() => target.close());
    const candidate = new WorkspaceStore(new AuthStore(target), { spacesEnabled: true });
    return { target, candidate };
  };
  return {
    db,
    auth,
    workspace,
    trash,
    owner,
    reader,
    operator,
    folder,
    doc,
    elsewhere,
    insert,
    grant,
    snapshot,
  };
}
const rows = (db: DatabaseSync) =>
  db.prepare('SELECT * FROM workspace_grants ORDER BY item_id,user_id').all();

test('preserves current direct grants and their dates, never copies a revoked archived grant', async () => {
  const f = await fixture();
  f.grant(f.folder, 'editor');
  f.grant(f.doc, 'admin');
  const c = await f.snapshot();
  f.db.prepare('DELETE FROM workspace_grants WHERE item_id=?').run(f.doc);
  f.db.prepare('INSERT INTO workspace_placements VALUES(?,?,?)').run(f.reader.id, f.folder, null);
  c.target
    .prepare('INSERT INTO workspace_placements VALUES(?,?,?)')
    .run(f.reader.id, f.folder, null);
  reconcileRestoreCredentials(f.db, c.target);
  const before = rows(f.db);
  expect(reconcileRestoreGrants(f.workspace, c.candidate)).toEqual({
    copied: 1,
    removed: 0,
    downgraded: 0,
  });
  expect(rows(c.target)).toEqual(before);
  expect(c.candidate.get(f.reader.id, f.doc).access).toBe('editor');
  expect(c.target.prepare('SELECT * FROM workspace_placements').all()).toEqual([]);
  expect(rows(f.db)).toEqual(before);
  expect(f.db.prepare('SELECT * FROM workspace_placements').all()).toHaveLength(1);
  expect(reconcileRestoreGrants(f.workspace, c.candidate)).toEqual({
    copied: 1,
    removed: 0,
    downgraded: 0,
  });
});

test('caps a current folder grant when the restored old ancestry would expose a moved-out file', async () => {
  const f = await fixture();
  f.grant(f.folder, 'admin');
  const c = await f.snapshot();
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.elsewhere, f.doc);
  f.grant(f.doc, 'viewer');
  reconcileRestoreCredentials(f.db, c.target);
  expect(reconcileRestoreGrants(f.workspace, c.candidate)).toEqual({
    copied: 2,
    removed: 0,
    downgraded: 1,
  });
  expect(c.candidate.get(f.reader.id, f.doc).access).toBe('viewer');
  expect(c.candidate.get(f.reader.id, f.folder).access).toBe('viewer');
  expect(f.workspace.get(f.reader.id, f.folder).access).toBe('admin');
});

test('removes every contributing inherited grant if the old child has no current access', async () => {
  const f = await fixture();
  const outer = f.insert('folder');
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(outer, f.folder);
  f.grant(outer, 'editor');
  f.grant(f.folder, 'admin');
  const c = await f.snapshot();
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.elsewhere, f.doc);
  reconcileRestoreCredentials(f.db, c.target);
  expect(reconcileRestoreGrants(f.workspace, c.candidate).removed).toBe(2);
  expect(() => c.candidate.get(f.reader.id, f.doc)).toThrow();
  expect(() => c.candidate.get(f.reader.id, outer)).toThrow();
});

test('Space member grants never confer access; a current root grant is capped against every restored member', async () => {
  const f = await fixture();
  const space = f.insert('space'),
    member = f.insert('doc', space, space);
  f.grant(space, 'admin');
  f.grant(member, 'admin');
  const c = await f.snapshot();
  // A restored live member must not revive a collaborator's current trash denial.
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=100,trash_batch=? WHERE id=?')
    .run(randomUUID(), member);
  reconcileRestoreCredentials(f.db, c.target);
  expect(reconcileRestoreGrants(f.workspace, c.candidate)).toEqual({
    copied: 1,
    removed: 1,
    downgraded: 0,
  });
  expect(rows(c.target)).toEqual([]);
  expect(() => resolveSpaceScope(c.candidate.auth, f.reader.id, space, member)).toThrow();
  expect(resolveSpaceScope(c.candidate.auth, f.owner.id, space, member).access).toBe('owner');
});

test('disabled-owner ordinary sharing remains usable while disabled actors and Operators receive no grants', async () => {
  const f = await fixture();
  const disabled = f.auth.createUser('Disabled collaborator');
  f.grant(f.folder, 'editor');
  f.grant(f.folder, 'admin', disabled.id);
  f.grant(f.folder, 'admin', f.operator.id);
  const c = await f.snapshot();
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id IN (?,?)').run(f.owner.id, disabled.id);
  reconcileRestoreCredentials(f.db, c.target);
  expect(reconcileRestoreGrants(f.workspace, c.candidate).copied).toBe(1);
  expect(c.candidate.get(f.reader.id, f.doc).access).toBe('editor');
  expect(() => c.candidate.get(disabled.id, f.doc)).toThrow();
  expect(() => c.candidate.get(f.operator.id, f.doc)).toThrow();
});

test('requires current ownership and the same capability namespace before changing any grant', async () => {
  const f = await fixture();
  f.grant(f.folder, 'editor');
  const c = await f.snapshot(),
    old = rows(c.target);
  const newOwner = f.auth.createUser('New owner');
  f.db.prepare('UPDATE workspace_items SET owner_id=?').run(newOwner.id);
  reconcileRestoreCredentials(f.db, c.target);
  expect(() => reconcileRestoreGrants(f.workspace, c.candidate)).toThrow('ownership');
  expect(rows(c.target)).toEqual(old);
  c.target.prepare('UPDATE workspace_items SET owner_id=?').run(newOwner.id);
  expect(reconcileRestoreGrants(f.workspace, c.candidate).copied).toBe(1);
  c.target.prepare("UPDATE workspace_items SET kind='sheet' WHERE id=?").run(f.doc);
  expect(() => reconcileRestoreGrants(f.workspace, c.candidate)).toThrow('ownership');
  expect(rows(c.target)).toEqual(old);
});

test('candidate-only content cannot use an existing or enabled identity as ownership evidence', async () => {
  const f = await fixture();
  f.grant(f.folder, 'editor');
  const c = await f.snapshot();
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(f.doc);
  reconcileRestoreCredentials(f.db, c.target);
  expect(() => reconcileRestoreGrants(f.workspace, c.candidate)).toThrow('ownership');
  const isolated = c.candidate.auth.createUser('Recovered content awaiting ownership');
  c.target
    .prepare('UPDATE workspace_items SET owner_id=?,parent_id=NULL WHERE id=?')
    .run(isolated.id, f.doc);
  expect(() => reconcileRestoreGrants(f.workspace, c.candidate)).toThrow('ownership');
  c.target.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(isolated.id);
  reconcileRestoreGrants(f.workspace, c.candidate);
  expect(() => c.candidate.get(f.reader.id, f.doc)).toThrow();
});

test('a late resolver failure rolls back all grant and placement changes', async () => {
  const f = await fixture();
  f.grant(f.folder, 'editor');
  f.grant(f.doc, 'admin');
  const c = await f.snapshot();
  c.target.prepare('INSERT INTO workspace_placements VALUES(?,?,NULL)').run(f.reader.id, f.folder);
  f.db.prepare('DELETE FROM workspace_grants WHERE item_id=?').run(f.doc);
  reconcileRestoreCredentials(f.db, c.target);
  const old = rows(c.target);
  vi.spyOn(c.candidate, 'accountAccess').mockImplementation(() => {
    throw new Error('fixture read failure');
  });
  expect(() => reconcileRestoreGrants(f.workspace, c.candidate)).toThrow('fixture read failure');
  expect(rows(c.target)).toEqual(old);
  expect(c.target.prepare('SELECT * FROM workspace_placements').all()).toHaveLength(1);
});

test('refuses the same physical database before mutation', async () => {
  const f = await fixture();
  f.grant(f.folder, 'editor');
  const before = rows(f.db);
  expect(() => reconcileRestoreGrants(f.workspace, f.workspace)).toThrow('ownership');
  expect(rows(f.db)).toEqual(before);
});

test('later actual Trash restore cannot reveal a dormant restored inherited grant', async () => {
  const f = await fixture();
  f.grant(f.folder, 'editor');
  f.trash.trash(f.owner.id, f.doc);
  const c = await f.snapshot();
  f.trash.restore(f.owner.id, f.doc);
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.elsewhere, f.doc);
  reconcileRestoreCredentials(f.db, c.target);
  expect(reconcileRestoreGrants(f.workspace, c.candidate).removed).toBe(1);
  new TrashStore(c.candidate).restore(f.owner.id, f.doc);
  expect(c.candidate.get(f.owner.id, f.doc).parentId).toBe(f.folder);
  expect(() => c.candidate.get(f.reader.id, f.doc)).toThrow();
});

test('reactivating a disabled Space owner cannot revive a revoked outer-folder inheritance', async () => {
  const f = await fixture();
  const space = f.insert('space', f.folder),
    member = f.insert('doc', space, space);
  f.grant(f.folder, 'admin');
  const c = await f.snapshot();
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.elsewhere, space);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  reconcileRestoreCredentials(f.db, c.target);
  expect(reconcileRestoreGrants(f.workspace, c.candidate).removed).toBe(1);
  const invites = new InvitationService(c.candidate.auth, 'https://spinel.example');
  new AdminStore(c.candidate.auth, invites).reactivate(f.operator.id, f.owner.id);
  expect(resolveSpaceScope(c.candidate.auth, f.owner.id, space, member).access).toBe('owner');
  expect(() => resolveSpaceScope(c.candidate.auth, f.reader.id, space, member)).toThrow();
});

test('refuses deep ancestry before expensive service reads or any grant mutation', async () => {
  const f = await fixture();
  f.auth.transaction(() => {
    let parent: string | null = f.folder;
    for (let i = 0; i < 500; i++) parent = f.insert('folder', parent);
  });
  f.grant(f.folder, 'editor');
  const c = await f.snapshot(),
    old = rows(c.target);
  reconcileRestoreCredentials(f.db, c.target);
  const get = vi.spyOn(c.candidate, 'accountAccess');
  expect(() => reconcileRestoreGrants(f.workspace, c.candidate)).toThrow('ownership');
  expect(get).not.toHaveBeenCalled();
  expect(rows(c.target)).toEqual(old);
});

test('refuses oversized trees before materialization and leaves the candidate unchanged', async () => {
  const f = await fixture();
  f.grant(f.folder, 'editor');
  const c = await f.snapshot(),
    old = rows(c.target);
  f.db
    .prepare(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10001)
    INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at)
    SELECT 'budget-'||x,?,NULL,'doc','Fixture',0,0 FROM n`,
    )
    .run(f.owner.id);
  const iterate = vi.spyOn(f.db, 'iterate');
  expect(() => reconcileRestoreGrants(f.workspace, c.candidate)).toThrow();
  expect(iterate).not.toHaveBeenCalled();
  expect(rows(c.target)).toEqual(old);
});

test('refuses an excessive complete authorization proof instead of checking only a prefix', async () => {
  const f = await fixture();
  f.auth.transaction(() => {
    f.db
      .prepare(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000)
      INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at)
      SELECT 'budget-'||x,?,NULL,'doc','Fixture',0,0 FROM n`,
      )
      .run(f.owner.id);
    for (let i = 0; i < 25; i++) f.grant(f.folder, 'viewer', f.auth.createUser('Collaborator').id);
  });
  const c = await f.snapshot(),
    old = rows(c.target);
  reconcileRestoreCredentials(f.db, c.target);
  const get = vi.spyOn(c.candidate, 'accountAccess');
  expect(() => reconcileRestoreGrants(f.workspace, c.candidate)).toThrow('ownership');
  expect(get).not.toHaveBeenCalled();
  expect(rows(c.target)).toEqual(old);
});
