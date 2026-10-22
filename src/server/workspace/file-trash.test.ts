import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import type { ItemKind } from '../../shared/workspace.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceFiles } from './files.ts';
import { SpaceStore } from './spaces.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { DAY_MS, TrashStore } from './trash.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  let now = Date.UTC(2026, 9, 22);
  const auth = new AuthStore(db, () => now);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const files = new WorkspaceFiles(workspace),
    spaces = new SpaceStore(workspace);
  const trash = new TrashStore(workspace),
    recovery = new SpaceRecoveryStore(workspace);
  const owner = auth.createUser('Owner'),
    other = auth.createUser('Collaborator');
  const admin = auth.createUser('Operator', true);
  const outer = workspace.create(owner.id, { name: 'Container', kind: 'folder', parentId: null });
  const root = spaces.createRoot(owner.id, { name: 'Project', parentId: outer.id }).space;
  const child = (name: string, kind: ItemKind = 'doc', parentId = root.id) =>
    spaces.createChild(owner.id, root.id, { name, kind, parentId }).item;
  db.exec(
    'CREATE TABLE native_fixture(item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE, value TEXT NOT NULL) STRICT',
  );
  const keep = child('Live page'),
    old = child('Earlier deletion'),
    nested = child('Nested sheet', 'sheet', keep.id);
  for (const item of [keep, old, nested])
    db.prepare('INSERT INTO native_fixture VALUES(?,?)').run(item.id, 'preserved:' + item.id);
  recovery.trash(owner.id, root.id, old.id);
  const sibling = workspace.create(owner.id, {
    name: 'Outer sibling',
    kind: 'doc',
    parentId: outer.id,
  });
  return {
    db,
    auth,
    workspace,
    files,
    spaces,
    trash,
    recovery,
    owner,
    other,
    admin,
    outer,
    root,
    child,
    keep,
    old,
    nested,
    sibling,
    advance: (days: number) => {
      now += days * DAY_MS;
    },
  };
}
const state = (db: DatabaseSync) =>
  [
    'workspace_items',
    'workspace_space_trash',
    'native_fixture',
    'workspace_retained_trash_batches',
  ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
const members = (f: ReturnType<typeof fixture>) =>
  f.db.prepare('SELECT * FROM workspace_items WHERE space_id=? ORDER BY id').all(f.root.id);

test('containing-folder trash stops at Space roots and retains internal tombstones and native state', () => {
  const f = fixture();
  const before = members(f);
  const recovery = f.db.prepare('SELECT * FROM workspace_space_trash').all();
  f.files.share(f.owner.id, f.root.id, f.other.id, 'editor');
  expect(f.trash.trash(f.owner.id, f.outer.id).count).toBe(6);
  expect(members(f)).toEqual(before);
  expect(f.db.prepare('SELECT * FROM workspace_space_trash').all()).toEqual(recovery);
  expect(f.db.prepare('SELECT count(*) AS n FROM native_fixture').get()!.n).toBe(3);
  expect(f.trash.list(f.owner.id)).toMatchObject({
    items: expect.arrayContaining([
      expect.objectContaining({ id: f.outer.id, expiresAt: null }),
      expect.objectContaining({ id: f.root.id, kind: 'space', expiresAt: null }),
      expect.objectContaining({ id: f.sibling.id, expiresAt: null }),
    ]),
    deletion: {
      count: 6,
      items: expect.arrayContaining([expect.objectContaining({ id: f.old.id })]),
    },
  });
  expect(f.trash.list(f.owner.id).items).toHaveLength(3);
  expect(f.files.shared(f.other.id)).toEqual([]);
  expect(() => f.files.get(f.other.id, f.root.id)).toThrow();
  expect(() => f.spaces.get(f.owner.id, f.root.id, f.keep.id)).toThrow();
  f.advance(90);
  expect(f.trash.purgeExpired()).toBe(0);
  expect(f.trash.restore(f.owner.id, f.outer.id).parentId).toBeNull();
  expect(members(f)).toEqual(before);
  expect(
    f.spaces
      .list(f.other.id, f.root.id)
      .items.map((item) => item.id)
      .sort(),
  ).toEqual([f.keep.id, f.nested.id].sort());
  expect(f.recovery.list(f.owner.id, f.root.id).items.map((item) => item.id)).toEqual([f.old.id]);
  expect(f.trash.list(f.owner.id).items).toEqual([]);
});

test('restoring a Space separately falls back to My files and keeps its original containing group retained', () => {
  const f = fixture();
  f.trash.trash(f.owner.id, f.outer.id);
  expect(f.trash.restore(f.owner.id, f.root.id)).toMatchObject({ kind: 'space', parentId: null });
  f.advance(60);
  expect(f.trash.purgeExpired()).toBe(0);
  expect(f.trash.list(f.owner.id).items.every((item) => item.expiresAt === null)).toBe(true);
  expect(f.trash.restore(f.owner.id, f.outer.id).parentId).toBeNull();
  expect(f.files.get(f.owner.id, f.root.id).parentId).toBeNull();
  expect(f.workspace.get(f.owner.id, f.sibling.id).parentId).toBe(f.outer.id);
});

test('an earlier independently trashed Space stays trashed when its containing folder is restored', () => {
  const f = fixture();
  const membersBefore = members(f);
  f.trash.trash(f.owner.id, f.root.id);
  f.advance(1);
  f.trash.trash(f.owner.id, f.outer.id);
  f.trash.restore(f.owner.id, f.outer.id);
  expect(f.trash.list(f.owner.id).items.map((item) => item.id)).toEqual([f.root.id]);
  expect(() => f.files.get(f.owner.id, f.root.id)).toThrow();
  f.trash.restore(f.owner.id, f.root.id);
  expect(f.files.get(f.owner.id, f.root.id).parentId).toBe(f.outer.id);
  expect(members(f)).toEqual(membersBefore);
});

test('explicit Empty trash binds all Space members and recovery metadata, then cascades exactly that graph', () => {
  const f = fixture();
  const unrelated = f.workspace.create(f.owner.id, {
    kind: 'doc',
    name: 'Keep outside',
    parentId: null,
  });
  f.trash.trash(f.owner.id, f.outer.id);
  const first = f.trash.list(f.owner.id);
  f.db
    .prepare(
      'UPDATE workspace_space_trash SET original_position=original_position+1 WHERE item_id=?',
    )
    .run(f.old.id);
  expect(() => f.trash.empty(f.owner.id, first.version)).toThrow('trash changed');
  const second = f.trash.list(f.owner.id);
  f.db
    .prepare('UPDATE workspace_items SET name=? WHERE id=?')
    .run('Renamed retained page', f.keep.id);
  expect(() => f.trash.empty(f.owner.id, second.version)).toThrow('trash changed');
  const current = f.trash.list(f.owner.id);
  expect(current.deletion!.count).toBe(6);
  expect(current.deletion!.items.map((item) => item.id).sort()).toEqual(
    [f.outer, f.root, f.keep, f.old, f.nested, f.sibling].map((item) => item.id).sort(),
  );
  expect(f.trash.empty(f.owner.id, current.version)).toEqual({ count: 6 });
  expect(f.workspace.list(f.owner.id)).toEqual([unrelated]);
  for (const table of [
    'native_fixture',
    'workspace_space_trash',
    'workspace_retained_trash_batches',
  ])
    expect(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(0);
});

test('malformed foreign graphs and late delete failures roll back the whole operation', () => {
  const f = fixture();
  f.trash.trash(f.owner.id, f.root.id);
  const preview = f.trash.list(f.owner.id);
  const before = state(f.db);
  f.db.exec(`CREATE TRIGGER deny_root_delete BEFORE DELETE ON workspace_items WHEN OLD.kind='space'
    BEGIN SELECT RAISE(ABORT,'late delete denied'); END`);
  expect(() => f.trash.empty(f.owner.id, preview.version)).toThrow('late delete denied');
  expect(state(f.db)).toEqual(before);
  f.db.exec('DROP TRIGGER deny_root_delete');
  f.db.prepare('UPDATE workspace_items SET owner_id=? WHERE id=?').run(f.other.id, f.nested.id);
  const malformed = state(f.db);
  expect(() => f.trash.list(f.owner.id)).toThrow();
  expect(() => f.trash.empty(f.owner.id, preview.version)).toThrow();
  expect(state(f.db)).toEqual(malformed);
});

test('account-only lifecycle retains Space groups while unrelated ordinary trash still expires', () => {
  const f = fixture();
  f.files.share(f.owner.id, f.root.id, f.other.id, 'editor');
  for (const actor of [f.other.id, f.admin.id, 'guest:unregistered'])
    expect(() => f.trash.trash(actor, f.root.id)).toThrow();
  f.trash.trash(f.owner.id, f.root.id);
  for (const actor of [f.other.id, f.admin.id, 'guest:unregistered'])
    expect(() => f.trash.restore(actor, f.root.id)).toThrow();
  expect(f.trash.list(f.other.id).items).toEqual([]);
  const ordinary = f.workspace.create(f.owner.id, {
    name: 'Ordinary deletion',
    kind: 'doc',
    parentId: null,
  });
  f.trash.trash(f.owner.id, ordinary.id);
  f.advance(31);
  expect(f.trash.purgeExpired()).toBe(1);
  expect(f.trash.list(f.owner.id).items).toEqual([
    expect.objectContaining({ id: f.root.id, expiresAt: null }),
  ]);
  expect(f.trash.restore(f.owner.id, f.root.id).kind).toBe('space');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.trash.list(f.owner.id)).toThrow('Sign in');
});
