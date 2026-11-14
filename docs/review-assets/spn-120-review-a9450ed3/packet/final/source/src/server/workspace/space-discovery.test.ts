import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Owner');
  const reader = auth.createUser('Reader');
  const other = auth.createUser('Other');
  const insert = db.prepare(`INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
    VALUES(?,?,?,?,?,1,1,?,?)`);
  const add = (
    kind: string,
    parentId: string | null = null,
    spaceId: string | null = null,
    position: number | null = null,
    userId = owner.id,
  ) => {
    const id = randomUUID();
    insert.run(id, userId, parentId, kind, kind, spaceId, position);
    return id;
  };
  return { db, auth, workspace, spaces, owner, reader, other, add };
}

test('root discovery combines direct and inherited roles without traversing internal members', () => {
  const f = fixture();
  const outer = f.add('folder');
  const nested = f.add('folder', outer);
  const root = f.add('space', nested);
  f.workspace.share(f.owner.id, outer, f.reader.id, 'viewer');
  f.spaces.share(f.owner.id, root, f.reader.id, 'editor');
  f.auth.transaction(() => {
    for (let index = 0; index < 10_000; index++) f.add('doc', root, root, index);
  });
  const reads = vi.spyOn(f.db, 'prepare');
  expect(f.spaces.roots(f.reader.id)).toMatchObject([{ space: { id: root }, access: 'editor' }]);
  expect(reads.mock.calls.length).toBeLessThan(100);
  reads.mockRestore();
  f.spaces.share(f.owner.id, root, f.reader.id, null);
  expect(f.spaces.roots(f.reader.id)).toMatchObject([{ space: { id: root }, access: 'viewer' }]);
  expect(f.spaces.roots(f.other.id)).toEqual([]);
});

test('malformed, cyclic, trashed and disabled-owner ancestry never appears in discovery', () => {
  const f = fixture();
  const ordinary = f.add('folder');
  const valid = f.add('space', ordinary);
  const foreign = f.add('folder', null, null, null, f.other.id);
  const wrongOwner = f.add('space', foreign);
  const underDoc = f.add('space', f.add('doc'));
  const cycleFolder = f.add('folder');
  const cycleRoot = f.add('space', cycleFolder);
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(cycleRoot, cycleFolder);
  expect(f.spaces.roots(f.owner.id).map((scope) => scope.space.id)).toEqual([valid]);
  for (const id of [wrongOwner, underDoc, cycleRoot])
    f.db
      .prepare("INSERT INTO workspace_grants(item_id,user_id,role) VALUES(?,?,'viewer')")
      .run(id, f.reader.id);
  expect(f.spaces.roots(f.reader.id)).toEqual([]);
  f.spaces.share(f.owner.id, valid, f.reader.id, 'viewer');
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
    .run('deleted', ordinary);
  expect(f.spaces.roots(f.reader.id)).toEqual([]);
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=NULL,trash_batch=NULL WHERE id=?')
    .run(ordinary);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(f.spaces.roots(f.reader.id)).toEqual([]);
});

test('many roots sharing a deep outer chain refuse the whole request within an aggregate budget', () => {
  const f = fixture();
  let parent: string | null = null;
  f.auth.transaction(() => {
    for (let index = 0; index < 150; index++) parent = f.add('folder', parent);
    for (let index = 0; index < 20; index++) f.add('space', parent);
  });
  expect(f.spaces.roots(f.owner.id)).toHaveLength(20);
  f.auth.transaction(() => {
    for (let index = 0; index < 80; index++) f.add('space', parent);
  });
  const resolver = vi.spyOn(f.spaces, 'get');
  expect(() => f.spaces.roots(f.owner.id)).toThrow('too large');
  expect(resolver).not.toHaveBeenCalled();
});

test('ineligible grant rows still spend the budget before item probes and matching children have an indexed access path', () => {
  const f = fixture();
  const outer = f.add('folder');
  const root = f.add('space', outer);
  f.workspace.share(f.owner.id, outer, f.reader.id, 'viewer');
  const grant = f.db.prepare(
    "INSERT INTO workspace_grants(item_id,user_id,role) VALUES(?,?,'viewer')",
  );
  f.auth.transaction(() => {
    // Nonmatching ordinary siblings cannot make each folder walk scan the catalog.
    for (let index = 0; index < 10_001; index++) f.add('doc', outer);
  });
  const query = `SELECT id,owner_id,kind FROM workspace_items
    WHERE owner_id=? AND parent_id=? AND space_id IS NULL AND space_position IS NULL
      AND trashed_at IS NULL AND trash_batch IS NULL AND kind IN ('folder','space') LIMIT ?`;
  const plan = f.db.prepare('EXPLAIN QUERY PLAN ' + query).all(f.owner.id, outer, 10_001);
  expect(
    plan.some((row) => String(row.detail).includes('workspace_space_discovery_children')),
  ).toBe(true);
  expect(f.spaces.roots(f.reader.id)).toMatchObject([{ space: { id: root } }]);
  f.auth.transaction(() => {
    for (let index = 0; index < 10_001; index++) {
      const id = f.add('doc', root, root, index);
      grant.run(id, f.reader.id);
    }
  });
  const resolver = vi.spyOn(f.spaces, 'get');
  expect(() => f.spaces.roots(f.reader.id)).toThrow('too large');
  expect(resolver).not.toHaveBeenCalled();
});
