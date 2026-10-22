import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import type { ItemKind } from '../../shared/workspace.ts';
import { AuthStore } from '../auth/store.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';

const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) if (database.isOpen) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function fixture(path = ':memory:') {
  const db = new DatabaseSync(path);
  databases.push(db);
  let clock = 100;
  const auth = new AuthStore(db, () => ++clock);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Collaborator');
  const viewer = auth.createUser('Reader');
  const other = auth.createUser('Other');
  const admin = auth.createUser('Operator', true);
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  const spaces = new SpaceStore(workspace);
  const folder = (name: string, parentId: string | null = null, actorId = owner.id) =>
    workspace.create(actorId, { name, kind: 'folder', parentId });
  const outer = folder('Outer');
  const space = spaces.createRoot(owner.id, { name: 'Project', parentId: outer.id }).space;
  const child = (
    name: string,
    kind: ItemKind = 'doc',
    parentId = space.id,
    actorId = owner.id,
    position?: number,
  ) => spaces.createChild(actorId, space.id, { name, kind, parentId, position }).item;
  return {
    db,
    auth,
    owner,
    editor,
    viewer,
    other,
    admin,
    workspace,
    spaces,
    folder,
    outer,
    space,
    child,
  };
}

const state = (database: DatabaseSync) =>
  database.prepare('SELECT * FROM workspace_items ORDER BY id').all();

function children(f: ReturnType<typeof fixture>, parentId = f.space.id) {
  return f.spaces
    .list(f.owner.id, f.space.id)
    .items.filter((item) => item.parentId === parentId)
    .map((item) => [item.id, item.position]);
}

test('Space creation reuses ordinary names and owned outer folders without enabling generic creation', () => {
  const f = fixture();
  const nested = f.folder('Nested', f.outer.id);
  const created = f.spaces.createRoot(f.owner.id, {
    name: '  Another project  ',
    parentId: nested.id,
  });
  expect(created).toMatchObject({
    access: 'owner',
    ownerId: f.owner.id,
    space: {
      id: created.space.id,
      kind: 'space',
      name: 'Another project',
      parentId: nested.id,
      spaceId: null,
      position: null,
    },
  });
  expect(created.space.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(() =>
    f.workspace.create(f.owner.id, { name: 'Hidden', kind: 'space', parentId: null }),
  ).toThrow('Choose Folder, Sheet or Doc');
  for (const name of ['', '  ', 'x'.repeat(121), 'a/b', 'a\\b', 'a\n'])
    expect(() => f.spaces.createRoot(f.owner.id, { name, parentId: null })).toThrow('name');
  const foreign = f.folder('Private', null, f.other.id);
  const ordinary = f.workspace.create(f.owner.id, {
    name: 'Standalone',
    kind: 'doc',
    parentId: null,
  });
  const internal = f.child('Internal folder', 'folder');
  for (const parentId of [foreign.id, ordinary.id, f.space.id, internal.id, 'missing'])
    expect(() => f.spaces.createRoot(f.owner.id, { name: 'Invalid', parentId })).toThrow();
  expect(() => f.spaces.createRoot(f.owner.id, { name: 'Missing destination' })).toThrow(
    'destination',
  );
  for (const actorId of [f.admin.id, 'missing', 'guest:unregistered'])
    expect(() => f.spaces.createRoot(actorId, { name: 'Invalid', parentId: null })).toThrow();
});

test('duplicate names and mixed Doc/Sheet parents retain distinct inherited identities and ordered children', () => {
  const f = fixture();
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
  const doc = f.child('Same', 'doc', f.space.id, f.editor.id);
  const sheet = f.child('Same', 'sheet', doc.id, f.editor.id);
  const folder = f.child('Same', 'folder', sheet.id, f.editor.id);
  const last = f.child('Same', 'doc');
  const first = f.child('Same', 'sheet', f.space.id, f.editor.id, 0);
  const tree = f.spaces.list(f.editor.id, f.space.id);
  expect(tree.items.map((item) => item.id)).toEqual([
    first.id,
    doc.id,
    sheet.id,
    folder.id,
    last.id,
  ]);
  expect(new Set(tree.items.map((item) => item.id)).size).toBe(5);
  expect(tree.items.map((item) => item.spaceId)).toEqual(Array(5).fill(f.space.id));
  expect(children(f)).toEqual([
    [first.id, 0],
    [doc.id, 1],
    [last.id, 2],
  ]);
  expect(
    f.db.prepare('SELECT DISTINCT owner_id FROM workspace_items WHERE space_id=?').all(f.space.id),
  ).toEqual([{ owner_id: f.owner.id }]);
  expect(
    f.db.prepare('SELECT count(*) AS total FROM workspace_grants WHERE item_id<>?').get(f.space.id)
      ?.total,
  ).toBe(0);
  expect(f.db.prepare('SELECT count(*) AS total FROM workspace_links').get()?.total).toBe(0);
  expect(tree.space.parentId).toBeNull();
  expect(JSON.stringify(tree)).not.toContain(f.outer.id);
});

test('current and future children follow the strongest root or outer grant and immediate downgrade/revocation', () => {
  const f = fixture();
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
  f.workspace.share(f.owner.id, f.outer.id, f.editor.id, 'editor');
  const doc = f.child('First', 'doc', f.space.id, f.editor.id);
  const future = f.child('Future', 'sheet', doc.id, f.editor.id);
  expect(f.spaces.get(f.editor.id, f.space.id, future.id).access).toBe('editor');
  expect(f.spaces.list(f.editor.id, f.space.id).space.parentId).toBe(f.outer.id);
  f.workspace.share(f.owner.id, f.outer.id, f.editor.id, null);
  expect(f.spaces.get(f.editor.id, f.space.id, future.id).access).toBe('viewer');
  expect(() => f.spaces.updateChild(f.editor.id, f.space.id, doc.id, { name: 'Denied' })).toThrow(
    'cannot edit',
  );
  expect(() => f.child('Denied', 'doc', f.space.id, f.editor.id)).toThrow('cannot edit');
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
  expect(() => f.spaces.get(f.editor.id, f.space.id, future.id)).toThrow('not available');
  expect(() => f.spaces.list(f.editor.id, f.space.id)).toThrow('not available');
});

test('the live service preserves deep Doc/Sheet nesting beyond the Storybook presentation fixture', () => {
  const f = fixture();
  const ids: string[] = [];
  let parentId = f.space.id;
  for (let depth = 0; depth < 32; depth++) {
    const item = f.child('Repeated name', depth % 2 ? 'sheet' : 'doc', parentId);
    ids.push(item.id);
    parentId = item.id;
  }
  expect(f.spaces.list(f.owner.id, f.space.id).items.map((item) => item.id)).toEqual(ids);
  expect(f.spaces.get(f.owner.id, f.space.id, ids[31]).item.parentId).toBe(ids[30]);
});

test('creation refuses to leave a tree larger than the service can safely process', () => {
  const f = fixture();
  f.db
    .prepare(
      `
    WITH RECURSIVE sequence(value) AS (
      SELECT 1 UNION ALL SELECT value+1 FROM sequence WHERE value<10000
    ) INSERT INTO workspace_items
      (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
      SELECT 'budget-'||value,?,?,'folder','Existing',0,0,?,value-1 FROM sequence
  `,
    )
    .run(f.owner.id, f.space.id, f.space.id);
  expect(() => f.child('One too many')).toThrow('too large');
  expect(
    f.db.prepare('SELECT count(*) AS total FROM workspace_items WHERE space_id=?').get(f.space.id)
      ?.total,
  ).toBe(10000);
  expect(f.spaces.list(f.owner.id, f.space.id).items).toHaveLength(10000);
});

test('View never mutates and Edit has no outer administration or child sharing capability', () => {
  const f = fixture();
  f.spaces.share(f.owner.id, f.space.id, f.viewer.id, 'viewer');
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
  const doc = f.child('Page');
  const before = state(f.db);
  expect(f.spaces.get(f.viewer.id, f.space.id, doc.id).item.id).toBe(doc.id);
  expect(() => f.child('Denied', 'folder', f.space.id, f.viewer.id)).toThrow('cannot edit');
  expect(() => f.spaces.updateChild(f.viewer.id, f.space.id, doc.id, { name: 'Denied' })).toThrow(
    'cannot edit',
  );
  for (const actorId of [f.editor.id, f.viewer.id]) {
    expect(() => f.spaces.updateRoot(actorId, f.space.id, { name: 'Denied' })).toThrow(
      'Only the owner',
    );
    expect(() => f.spaces.updateRoot(actorId, f.space.id, { parentId: null })).toThrow(
      'Only the owner',
    );
    expect(() => f.spaces.share(actorId, f.space.id, f.other.id, 'editor')).toThrow(
      'Only the owner',
    );
  }
  expect(() =>
    f.spaces.updateChild(f.editor.id, f.space.id, f.space.id, { name: 'Denied' }),
  ).toThrow('not available');
  expect(() => f.spaces.share(f.owner.id, doc.id, f.other.id, 'editor')).toThrow('not available');
  expect(state(f.db)).toEqual(before);
  f.spaces.updateChild(f.editor.id, f.space.id, doc.id, { name: 'Edited' });
  expect(f.spaces.get(f.viewer.id, f.space.id, doc.id).item.name).toBe('Edited');
});

test('root grants accept only active everyday recipients and retain original share time on role changes', () => {
  const f = fixture();
  for (const recipient of [f.owner.id, f.admin.id, 'missing', 'guest:missing'])
    expect(() => f.spaces.share(f.owner.id, f.space.id, recipient, 'editor')).toThrow();
  for (const role of ['owner', 'unknown', undefined])
    expect(() => f.spaces.share(f.owner.id, f.space.id, f.editor.id, role)).toThrow(
      'Choose a person',
    );
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
  const grant = () =>
    f.db
      .prepare('SELECT * FROM workspace_grants WHERE item_id=? AND user_id=?')
      .get(f.space.id, f.editor.id);
  const first = grant();
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
  expect(grant()).toEqual({ ...first, role: 'editor' });
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'admin');
  expect(grant()).toEqual({ ...first, role: 'admin' });
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
  expect(() => f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer')).toThrow(
    'active everyday account',
  );
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
  expect(grant()).toBeUndefined();
});

test('reorder and same-Space subtree moves atomically resequence both sibling lists', () => {
  const f = fixture();
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
  const doc = f.child('A', 'doc');
  const sheet = f.child('B', 'sheet');
  const folder = f.child('C', 'folder');
  const nested = f.child('Nested', 'doc', doc.id);
  f.spaces.updateChild(f.editor.id, f.space.id, folder.id, { position: 0 });
  expect(children(f)).toEqual([
    [folder.id, 0],
    [doc.id, 1],
    [sheet.id, 2],
  ]);
  f.spaces.updateChild(f.editor.id, f.space.id, doc.id, {
    name: 'Moved',
    parentId: sheet.id,
    position: 0,
  });
  expect(children(f)).toEqual([
    [folder.id, 0],
    [sheet.id, 1],
  ]);
  expect(children(f, sheet.id)).toEqual([[doc.id, 0]]);
  expect(f.spaces.get(f.owner.id, f.space.id, nested.id).item).toEqual(nested);
  const first = f.child('First', 'folder', sheet.id, f.owner.id, 0);
  expect(children(f, sheet.id)).toEqual([
    [first.id, 0],
    [doc.id, 1],
  ]);
  f.spaces.updateChild(f.editor.id, f.space.id, doc.id, { name: 'Renamed' });
  expect(children(f, sheet.id)).toEqual([
    [first.id, 0],
    [doc.id, 1],
  ]);
  f.spaces.updateChild(f.editor.id, f.space.id, doc.id, { position: 0 });
  expect(children(f, sheet.id)).toEqual([
    [doc.id, 0],
    [first.id, 1],
  ]);
});

test('invalid cycles, cross-Space moves, extraction and positions leave names and ordering untouched', () => {
  const f = fixture();
  const doc = f.child('Original');
  const nested = f.child('Nested', 'sheet', doc.id);
  const sibling = f.child('Sibling');
  const otherSpace = f.spaces.createRoot(f.owner.id, { name: 'Other Space', parentId: null }).space;
  const otherChild = f.spaces.createChild(f.owner.id, otherSpace.id, {
    name: 'Other',
    kind: 'folder',
    parentId: otherSpace.id,
  }).item;
  const standalone = f.workspace.create(f.owner.id, {
    name: 'Standalone',
    kind: 'doc',
    parentId: null,
  });
  const before = state(f.db);
  for (const parentId of [
    doc.id,
    nested.id,
    otherSpace.id,
    otherChild.id,
    standalone.id,
    f.outer.id,
    null,
    'missing',
  ])
    expect(() =>
      f.spaces.updateChild(f.owner.id, f.space.id, doc.id, { name: 'Must not save', parentId }),
    ).toThrow();
  for (const position of [-1, 0.5, 3, NaN, Infinity, '0'])
    expect(() =>
      f.spaces.updateChild(f.owner.id, f.space.id, sibling.id, { name: 'Must not save', position }),
    ).toThrow('position');
  for (const parentId of [
    f.space.id,
    doc.id,
    nested.id,
    otherSpace.id,
    otherChild.id,
    standalone.id,
  ])
    expect(() =>
      f.spaces.updateRoot(f.owner.id, f.space.id, { name: 'Must not save', parentId }),
    ).toThrow();
  expect(() =>
    f.spaces.updateChild(f.owner.id, f.space.id, standalone.id, { parentId: doc.id }),
  ).toThrow('not available');
  expect(() =>
    f.spaces.updateChild(f.owner.id, f.space.id, otherChild.id, { parentId: doc.id }),
  ).toThrow('not available');
  expect(() =>
    f.spaces.updateChild(f.owner.id, f.space.id, doc.id, { name: 'Invalid/name' }),
  ).toThrow('name');
  for (const kind of ['space', 'slides', 'unknown'])
    expect(() =>
      f.spaces.createChild(f.owner.id, f.space.id, { name: 'Denied', kind, parentId: doc.id }),
    ).toThrow('Choose Folder, Sheet or Doc');
  expect(state(f.db)).toEqual(before);
});

test('a failure after parent and source-order changes rolls back the entire mutation', () => {
  const f = fixture();
  const moving = f.child('Moving');
  f.child('Source sibling');
  const destination = f.child('Destination', 'sheet');
  const existing = f.child('Existing child', 'doc', destination.id);
  const before = state(f.db);
  f.db.exec(`CREATE TRIGGER fail_space_reorder BEFORE UPDATE OF space_position ON workspace_items
    WHEN OLD.id='${existing.id}' BEGIN SELECT RAISE(ABORT, 'fixture reorder failure'); END`);
  expect(() =>
    f.spaces.updateChild(f.owner.id, f.space.id, moving.id, {
      name: 'Must not save',
      parentId: destination.id,
      position: 0,
    }),
  ).toThrow('fixture reorder failure');
  expect(state(f.db)).toEqual(before);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('moving the whole Space changes outer inheritance without changing descendants', () => {
  const f = fixture();
  const doc = f.child('Kept');
  const sheet = f.child('Nested', 'sheet', doc.id);
  f.workspace.share(f.owner.id, f.outer.id, f.viewer.id, 'viewer');
  const destination = f.folder('Destination');
  f.workspace.share(f.owner.id, destination.id, f.editor.id, 'editor');
  expect(f.spaces.get(f.viewer.id, f.space.id, sheet.id).access).toBe('viewer');
  f.spaces.updateRoot(f.owner.id, f.space.id, { name: 'Moved Space', parentId: destination.id });
  expect(() => f.spaces.get(f.viewer.id, f.space.id, sheet.id)).toThrow('not available');
  expect(f.spaces.get(f.editor.id, f.space.id, sheet.id).access).toBe('editor');
  expect(f.spaces.list(f.owner.id, f.space.id).items).toEqual([doc, sheet]);
  expect(f.spaces.get(f.owner.id, f.space.id).space).toMatchObject({
    id: f.space.id,
    name: 'Moved Space',
    parentId: destination.id,
  });
});

test('creating and moving a Space validates deep outer ancestry with linear statement work', () => {
  const f = fixture();
  const doc = f.child('Preserved');
  let destination: string | null = null;
  f.auth.transaction(() => {
    const insert = f.db.prepare(`INSERT INTO workspace_items
      (id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,?,'folder','Deep',0,0)`);
    for (let depth = 0; depth < 1_000; depth++) {
      const id = `outer-depth-${depth}`;
      insert.run(id, f.owner.id, destination);
      destination = id;
    }
  });
  const prepare = f.db.prepare.bind(f.db);
  let statements = 0;
  const spy = vi.spyOn(f.db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    return {
      get: (...values) => {
        statements++;
        return statement.get(...values);
      },
      all: (...values) => {
        statements++;
        return statement.all(...values);
      },
      run: (...values) => {
        statements++;
        return statement.run(...values);
      },
    };
  });
  try {
    expect(
      f.spaces.createRoot(f.owner.id, { name: 'Deep Space', parentId: destination }).space.parentId,
    ).toBe(destination);
    expect(statements).toBeLessThanOrEqual(6_040);
    statements = 0;
    expect(
      f.spaces.updateRoot(f.owner.id, f.space.id, { parentId: destination }).space.parentId,
    ).toBe(destination);
    expect(statements).toBeLessThanOrEqual(6_040);
  } finally {
    spy.mockRestore();
  }
  expect(f.spaces.list(f.owner.id, f.space.id).items).toEqual([doc]);
});

test('an outer ancestry beyond the work budget refuses Space creation and move atomically', () => {
  const f = fixture();
  let destination: string | null = null;
  f.auth.transaction(() => {
    const insert = f.db.prepare(`INSERT INTO workspace_items
      (id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,?,'folder','Deep',0,0)`);
    for (let depth = 0; depth < 10_001; depth++) {
      const id = `over-budget-${depth}`;
      insert.run(id, f.owner.id, destination);
      destination = id;
    }
  });
  const before = state(f.db);
  expect(() =>
    f.spaces.createRoot(f.owner.id, { name: 'Must not save', parentId: destination }),
  ).toThrow('not available');
  expect(() =>
    f.spaces.updateRoot(f.owner.id, f.space.id, {
      name: 'Must not rename',
      parentId: destination,
    }),
  ).toThrow('not available');
  expect(state(f.db)).toEqual(before);
});

test('malformed trees refuse listing and mutation instead of omitting foreign or cyclic descendants', () => {
  const f = fixture();
  const doc = f.child('Parent');
  const nested = f.child('Nested', 'sheet', doc.id);
  const denied = () => {
    const before = state(f.db);
    expect(() => f.spaces.list(f.owner.id, f.space.id)).toThrow('not available');
    expect(() => f.child('Denied')).toThrow('not available');
    expect(() => f.spaces.updateRoot(f.owner.id, f.space.id, { name: 'Denied' })).toThrow(
      'not available',
    );
    expect(state(f.db)).toEqual(before);
  };
  f.db.prepare('UPDATE workspace_items SET owner_id=? WHERE id=?').run(f.other.id, doc.id);
  denied();
  f.db
    .prepare('UPDATE workspace_items SET owner_id=?,parent_id=? WHERE id=?')
    .run(f.owner.id, nested.id, doc.id);
  denied();
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.space.id, doc.id);
  const standalone = f.workspace.create(f.owner.id, {
    name: 'Foreign member',
    kind: 'doc',
    parentId: null,
  });
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(doc.id, standalone.id);
  denied();
});

test('live listing and resequencing leave internal tombstones and recovery metadata intact', () => {
  const f = fixture();
  const removed = f.child('Removed', 'doc');
  const nested = f.child('Nested', 'sheet', removed.id);
  const live = f.child('Live', 'folder');
  f.db
    .prepare(
      "UPDATE workspace_items SET trashed_at=10,trash_batch='existing-trash' WHERE id IN (?,?)",
    )
    .run(removed.id, nested.id);
  f.db
    .prepare('INSERT INTO workspace_space_trash VALUES(?,?,?,?,?,?,?)')
    .run(removed.id, f.space.id, f.space.id, 0, 10, f.owner.id, 'existing-trash');
  const recovery = f.db.prepare('SELECT * FROM workspace_space_trash').all();
  const tombstones = f.db
    .prepare('SELECT * FROM workspace_items WHERE trashed_at IS NOT NULL ORDER BY id')
    .all();
  expect(f.spaces.list(f.owner.id, f.space.id).items.map((item) => item.id)).toEqual([live.id]);
  expect(() => f.spaces.get(f.owner.id, f.space.id, nested.id)).toThrow('not available');
  expect(() =>
    f.spaces.updateChild(f.owner.id, f.space.id, removed.id, { name: 'Denied' }),
  ).toThrow('not available');
  const added = f.child('Added');
  expect(children(f)).toEqual([
    [live.id, 0],
    [added.id, 1],
  ]);
  f.spaces.updateRoot(f.owner.id, f.space.id, { parentId: null });
  expect(f.db.prepare('SELECT * FROM workspace_space_trash').all()).toEqual(recovery);
  expect(
    f.db.prepare('SELECT * FROM workspace_items WHERE trashed_at IS NOT NULL ORDER BY id').all(),
  ).toEqual(tombstones);
});

test('live descendants beneath a trashed parent are never returned', () => {
  const f = fixture();
  const doc = f.child('Unavailable');
  f.child('Must not leak', 'doc', doc.id);
  f.db
    .prepare("UPDATE workspace_items SET trashed_at=1,trash_batch='broken-trash' WHERE id=?")
    .run(doc.id);
  expect(() => f.spaces.list(f.owner.id, f.space.id)).toThrow('not available');
});

test('each service operation rechecks the actor, owner and current grant inside its transaction', () => {
  const f = fixture();
  const doc = f.child('Original');
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
  expect(f.spaces.get(f.editor.id, f.space.id, doc.id).access).toBe('editor');
  expect(() =>
    f.auth.transaction(() => {
      f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
      f.spaces.updateChild(f.editor.id, f.space.id, doc.id, { name: 'Denied' });
    }),
  ).toThrow('cannot edit');
  expect(f.spaces.get(f.editor.id, f.space.id, doc.id)).toMatchObject({
    access: 'editor',
    item: { name: 'Original' },
  });
  for (const actorId of [f.admin.id, f.other.id, 'guest:missing', 'missing']) {
    expect(() => f.spaces.list(actorId, f.space.id)).toThrow();
    expect(() => f.spaces.updateChild(actorId, f.space.id, doc.id, { name: 'Denied' })).toThrow();
  }
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
  expect(() => f.spaces.get(f.editor.id, f.space.id, doc.id)).toThrow('Sign in');
  f.db.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(f.editor.id);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.spaces.list(f.editor.id, f.space.id)).toThrow('not available');
  expect(() => f.child('Denied', 'doc', f.space.id, f.editor.id)).toThrow('not available');
});

test('renames, subtree/root moves and reopen preserve opaque native contents and stable formula bindings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-spaces-'));
  directories.push(directory);
  const path = join(directory, 'database.sqlite');
  const f = fixture(path);
  const doc = f.child('Same', 'doc');
  const sheet = f.child('Same', 'sheet', doc.id);
  const folder = f.child('Same', 'folder');
  // Existing native-service storage, populated directly so this test never opens
  // an unwired content route or invents a second snapshot implementation.
  f.db.exec(`
    CREATE TABLE doc_snapshots (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL,revision INTEGER NOT NULL,write_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE sheet_snapshots (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL,revision INTEGER NOT NULL,write_id TEXT NOT NULL
    ) STRICT;
  `);
  const document = JSON.stringify({
    id: doc.id,
    body: 'Kept\r\n',
    sourceBindings: [{ itemId: sheet.id, range: 'A1:B2' }],
  });
  const spreadsheet = JSON.stringify({ id: sheet.id, cells: { A1: 42, B2: '=A1+1' } });
  f.db.prepare('INSERT INTO doc_snapshots VALUES(?,?,7,?)').run(doc.id, document, 'doc-write');
  f.db
    .prepare('INSERT INTO sheet_snapshots VALUES(?,?,4,?)')
    .run(sheet.id, spreadsheet, 'sheet-write');
  const snapshots = () => [
    f.db.prepare('SELECT * FROM doc_snapshots').all(),
    f.db.prepare('SELECT * FROM sheet_snapshots').all(),
  ];
  const before = snapshots();
  f.spaces.updateChild(f.owner.id, f.space.id, doc.id, { name: 'Renamed', parentId: folder.id });
  f.spaces.updateChild(f.owner.id, f.space.id, sheet.id, { position: 0 });
  f.spaces.updateRoot(f.owner.id, f.space.id, {
    name: 'Relocated',
    parentId: f.folder('New outer').id,
  });
  expect(snapshots()).toEqual(before);
  const tree = f.spaces.list(f.owner.id, f.space.id);
  f.db.close();
  const reopened = new DatabaseSync(path);
  databases.push(reopened);
  const spaces = new SpaceStore(new WorkspaceStore(new AuthStore(reopened)));
  expect(spaces.list(f.owner.id, f.space.id)).toEqual(tree);
  expect([
    reopened.prepare('SELECT * FROM doc_snapshots').all(),
    reopened.prepare('SELECT * FROM sheet_snapshots').all(),
  ]).toEqual(before);
  expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
