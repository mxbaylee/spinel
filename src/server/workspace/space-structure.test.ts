import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { readSpaceStructure } from './space-structure.ts';
import { SpaceStore } from './spaces.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  const spaces = new SpaceStore(workspace);
  const space = spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space;
  const child = (name: string, parentId = space.id) =>
    spaces.createChild(owner.id, space.id, {
      name,
      kind: 'doc',
      parentId,
    }).item;
  const removed = child('Removed');
  const nested = child('Nested', removed.id);
  db.prepare("UPDATE workspace_items SET trashed_at=10,trash_batch='batch' WHERE space_id=?").run(
    space.id,
  );
  db.prepare('INSERT INTO workspace_space_trash VALUES(?,?,?,?,?,?,?)').run(
    removed.id,
    space.id,
    space.id,
    0,
    10,
    owner.id,
    'batch',
  );
  return { db, auth, owner, workspace, spaces, space, child, removed, nested };
}

test('complete graph validation preserves tombstone boundaries and does not expose their names in live listing', () => {
  const f = fixture();
  const live = f.child('Live');
  const tree = readSpaceStructure(f.db, f.space.id, f.owner.id);
  expect(tree.items).toHaveLength(3);
  expect(tree.recovery.get(f.removed.id)?.trashBatch).toBe('batch');
  expect(tree.byId.get(f.nested.id)?.trashedAt).toBe(10);
  const listing = f.spaces.list(f.owner.id, f.space.id);
  expect(listing.items.map((item) => item.id)).toEqual([live.id]);
  expect(JSON.stringify(listing)).not.toContain('Removed');
  expect(JSON.stringify(listing)).not.toContain('trashedAt');
});

test('recovery metadata cannot hide malformed trash batches, live descendants or cycles', () => {
  const f = fixture();
  const original = f.db.prepare('SELECT * FROM workspace_items ORDER BY id').all();
  const denied = (sql: string, values: (string | number | null)[]) => {
    f.auth.transaction(() => {
      f.db.exec('SAVEPOINT malformed');
      try {
        f.db.prepare(sql).run(...values);
        expect(() => f.spaces.list(f.owner.id, f.space.id)).toThrow('not available');
      } finally {
        f.db.exec('ROLLBACK TO malformed; RELEASE malformed;');
      }
    });
    expect(f.db.prepare('SELECT * FROM workspace_items ORDER BY id').all()).toEqual(original);
  };
  denied('UPDATE workspace_items SET trash_batch=NULL WHERE id=?', [f.nested.id]);
  denied('UPDATE workspace_items SET trashed_at=NULL,trash_batch=NULL WHERE id=?', [f.nested.id]);
  denied('UPDATE workspace_items SET trash_batch=? WHERE id=?', ['other-batch', f.nested.id]);
  denied('UPDATE workspace_items SET trashed_at=? WHERE id=?', [11, f.nested.id]);
  denied('UPDATE workspace_items SET parent_id=? WHERE id=?', [f.nested.id, f.removed.id]);
  denied('UPDATE workspace_space_trash SET trashed_at=? WHERE item_id=?', [11, f.removed.id]);
  denied('UPDATE workspace_space_trash SET item_id=? WHERE item_id=?', [f.nested.id, f.removed.id]);
  denied('DELETE FROM workspace_space_trash WHERE item_id=?', [f.removed.id]);
});

test('saved original location may become unavailable while the recovery graph stays valid', () => {
  const f = fixture();
  f.db
    .prepare('UPDATE workspace_space_trash SET original_parent_id=? WHERE item_id=?')
    .run('removed-or-private-parent', f.removed.id);
  expect(
    readSpaceStructure(f.db, f.space.id, f.owner.id).recovery.get(f.removed.id)?.originalParentId,
  ).toBe('removed-or-private-parent');
  const ordinary = f.workspace.create(f.owner.id, {
    name: 'Foreign attachment',
    kind: 'doc',
    parentId: null,
  });
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.nested.id, ordinary.id);
  expect(() => f.spaces.list(f.owner.id, f.space.id)).toThrow('not available');
});

test('foreign-scoped recovery records attached to members or the root cannot hide from validation', () => {
  const f = fixture();
  const other = f.spaces.createRoot(f.owner.id, { name: 'Other', parentId: null }).space;
  const insert = f.db.prepare('INSERT INTO workspace_space_trash VALUES(?,?,?,?,?,?,?)');
  for (const itemId of [f.nested.id, f.space.id]) {
    insert.run(itemId, other.id, other.id, 0, 10, f.owner.id, 'foreign-batch');
    expect(() => f.spaces.list(f.owner.id, f.space.id)).toThrow('not available');
    expect(() => f.spaces.list(f.owner.id, other.id)).toThrow('not available');
    f.db.prepare('DELETE FROM workspace_space_trash WHERE item_id=?').run(itemId);
  }
  expect(readSpaceStructure(f.db, f.space.id, f.owner.id).items).toHaveLength(2);
});

test('all-status capacity includes tombstones before creation and refuses excess fetches', () => {
  const f = fixture();
  f.child('Only live child');
  f.db
    .prepare(
      `WITH RECURSIVE sequence(value) AS (
    SELECT 1 UNION ALL SELECT value+1 FROM sequence WHERE value<9997
  ) INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position,trashed_at,trash_batch)
    SELECT 'deleted-'||value,?,?,'sheet','Deleted',0,0,?,value,10,'batch' FROM sequence
  `,
    )
    .run(f.owner.id, f.removed.id, f.space.id);
  expect(f.spaces.list(f.owner.id, f.space.id).items).toHaveLength(1);
  expect(() => f.child('Would make future requests impossible')).toThrow('too large');
  expect(
    f.db.prepare('SELECT count(*) AS total FROM workspace_items WHERE space_id=?').get(f.space.id)
      ?.total,
  ).toBe(10000);
  f.db
    .prepare(
      `INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position,trashed_at,trash_batch)
    VALUES('over-budget',?,?,'doc','Over budget',0,0,?,10000,10,'batch')
  `,
    )
    .run(f.owner.id, f.removed.id, f.space.id);
  expect(() => f.spaces.list(f.owner.id, f.space.id)).toThrow('too large');
});

test('parent-only traversal uses an index both before and after the migration', () => {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  new WorkspaceStore(auth);
  const queryPlan = (database: DatabaseSync) =>
    database
      .prepare('EXPLAIN QUERY PLAN SELECT id FROM workspace_items WHERE parent_id=?')
      .all('parent')
      .map((row) => row.detail)
      .join('\n');
  expect(queryPlan(db)).toMatch(/SEARCH .*parent_id=\?/);
  // libsql retains a prepared EXPLAIN statement's schema lock. Inspect a fresh
  // migrated fixture rather than carrying that diagnostic statement into DDL.
  const migrated = fixture().db;
  expect(queryPlan(migrated)).toMatch(/SEARCH .*parent_id=\?/);
  const attachment = migrated
    .prepare(
      `EXPLAIN QUERY PLAN
    SELECT 1 FROM workspace_items WHERE parent_id=? AND (space_id IS NOT ? OR owner_id<>?) LIMIT 1
  `,
    )
    .all('parent', 'space', 'owner')
    .map((row) => row.detail)
    .join('\n');
  expect(attachment).toMatch(/SEARCH .*parent_id=\?/);
  expect(attachment).not.toMatch(/SCAN workspace_items/);
});
