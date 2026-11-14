import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { WorkspaceStore } from './store.ts';
import { migrateSpaceSchema } from './space-schema.ts';

const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function open(path = ':memory:') {
  const db = new DatabaseSync(path);
  databases.push(db);
  return db;
}

function schema(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all();
}

const rows = (db: DatabaseSync, table: string) =>
  db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

function item(
  db: DatabaseSync,
  owner: string,
  id: string,
  kind: string,
  parent: string | null = null,
  space: string | null = null,
  position: number | null = null,
) {
  db.prepare(
    `INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
    VALUES(?,?,?,?,?,1,1,?,?)`,
  ).run(id, owner, parent, kind, id, space, position);
}

function populated(path = ':memory:') {
  const db = open(path);
  const auth = new AuthStore(db, () => 100);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Collaborator');
  const folder = workspace.create(owner.id, { name: 'Project', kind: 'folder', parentId: null });
  const doc = workspace.create(owner.id, { name: 'Notes', kind: 'doc', parentId: folder.id });
  const sheet = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: folder.id });
  workspace.share(owner.id, folder.id, editor.id, 'editor');
  workspace.place(editor.id, doc.id, null);
  workspace.changeTag(editor.id, doc.id, 'budget');
  const link = workspace.links.begin(doc.id, 'viewer');
  workspace.links.finish(doc.id, link.epoch, true);
  workspace.links.exchange(doc.id, link.token);

  // Historical application-owned tables from the pre-Space database. This fixture
  // exercises opaque content bytes and foreign keys, without starting the SDK.
  db.exec(`
    CREATE TABLE doc_snapshots (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL,revision INTEGER NOT NULL,write_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE sheet_snapshots (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL,revision INTEGER NOT NULL,write_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE doc_images (
      item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
      id TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(item_id,id)
    ) STRICT;
    CREATE TABLE history_checkpoints (
      id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK(source IN ('native','collaboration')),
      revision INTEGER NOT NULL,captured_at INTEGER NOT NULL,name TEXT,
      snapshot BLOB NOT NULL,UNIQUE(item_id,source,revision)
    ) STRICT;
    CREATE TABLE history_restore_labels (
      checkpoint_id TEXT PRIMARY KEY REFERENCES history_checkpoints(id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE workspace_collaboration (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('preparing','ready'))
    ) STRICT;
    CREATE TABLE spinel_generation_resources (
      unit_id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
      resources TEXT NOT NULL
    ) STRICT;
    CREATE TRIGGER collaboration_deleted BEFORE DELETE ON workspace_items
    WHEN EXISTS(SELECT 1 FROM workspace_collaboration WHERE item_id=OLD.id)
    BEGIN INSERT OR IGNORE INTO collaboration_purge VALUES(OLD.id); END;
    CREATE TABLE workspace_pins (
      user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,PRIMARY KEY(user_id,item_id)
    ) STRICT;
    CREATE INDEX migration_fixture_name ON workspace_items(name,updated_at);
  `);
  new CollaborationGenerations(workspace);
  const docBytes = JSON.stringify({
    id: doc.id,
    sourceBinding: { itemId: sheet.id },
    text: 'Kept',
  });
  db.prepare('INSERT INTO doc_snapshots VALUES(?,?,3,?)').run(doc.id, docBytes, 'doc-write');
  db.prepare('INSERT INTO sheet_snapshots VALUES(?,?,4,?)').run(
    sheet.id,
    JSON.stringify({ id: sheet.id, cell: '=A1+1' }),
    'sheet-write',
  );
  db.prepare('INSERT INTO doc_images VALUES(?,?,?,?)').run(
    doc.id,
    'image-id',
    'image/png',
    Buffer.from([0, 255, 128, 10]),
  );
  db.prepare("INSERT INTO history_checkpoints VALUES(?,?,'native',3,90,?,?)").run(
    'checkpoint',
    doc.id,
    'Kept checkpoint',
    Buffer.from([255, 0, 19]),
  );
  db.prepare('INSERT INTO history_restore_labels VALUES(?)').run('checkpoint');
  db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(doc.id);
  db.prepare('INSERT INTO spinel_live_units VALUES(?,?,3)').run(doc.id, 'active-unit');
  db.prepare("INSERT INTO spinel_restore_jobs VALUES(?,?,?,?,?,?,'staging',NULL)").run(
    'restore-job',
    doc.id,
    owner.id,
    'checkpoint',
    'active-unit',
    'staged-unit',
  );
  db.prepare('INSERT INTO spinel_generation_resources VALUES(?,?,?)').run(
    'active-unit',
    doc.id,
    '["kept-resource"]',
  );
  db.prepare('INSERT INTO workspace_pins VALUES(?,?,0)').run(editor.id, doc.id);
  db.prepare('UPDATE workspace_items SET trashed_at=50,trash_batch=? WHERE id=?').run(
    'older-trash',
    sheet.id,
  );
  return { db, auth, workspace, owner, editor, folder, doc, sheet, docBytes };
}

const retainedTables = [
  'auth_users',
  'workspace_grants',
  'workspace_tags',
  'workspace_tag_assignments',
  'workspace_placements',
  'workspace_links',
  'workspace_guest_sessions',
  'doc_snapshots',
  'sheet_snapshots',
  'doc_images',
  'history_checkpoints',
  'history_restore_labels',
  'workspace_collaboration',
  'spinel_live_units',
  'spinel_restore_jobs',
  'spinel_generation_resources',
  'collaboration_purge',
  'workspace_pins',
];

test('fresh schema stores real Space roots and coherent member metadata without enabling ordinary creation', () => {
  const db = open();
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  migrateSpaceSchema(db);
  const workspace = new WorkspaceStore(auth);
  expect(() =>
    workspace.create(owner.id, { name: 'Hidden', kind: 'space', parentId: null }),
  ).toThrow('Choose Folder, Sheet or Doc');
  item(db, owner.id, 'space', 'space');
  item(db, owner.id, 'doc', 'doc', 'space', 'space', 0);
  item(db, owner.id, 'sheet', 'sheet', 'doc', 'space', 0);
  expect(
    rows(db, 'workspace_items').map((row) => [row.id, row.kind, row.space_id, row.space_position]),
  ).toEqual([
    ['space', 'space', null, null],
    ['doc', 'doc', 'space', 0],
    ['sheet', 'sheet', 'space', 0],
  ]);
  for (const [id, kind, space, position] of [
    ['nested-space', 'space', 'space', 1],
    ['no-position', 'doc', 'space', null],
    ['no-space', 'doc', null, 1],
    ['negative', 'doc', 'space', -1],
    ['fractional', 'doc', 'space', 0.5],
  ] as const)
    expect(() => item(db, owner.id, id, kind, 'space', space, position)).toThrow();
  expect(() => item(db, owner.id, 'dangling', 'doc', 'space', 'missing-space', 0)).toThrow();
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('upgrading populated storage preserves native bytes, ACLs, recovery and working cleanup triggers', () => {
  const f = populated();
  const beforeItems = rows(f.db, 'workspace_items');
  const before = retainedTables.map((name) => rows(f.db, name));
  const definitions = schema(f.db).filter(
    (row) => row.tbl_name === 'workspace_items' && row.type !== 'table',
  );

  migrateSpaceSchema(f.db);

  expect(rows(f.db, 'workspace_items')).toEqual(
    beforeItems.map((row) => ({ ...row, space_id: null, space_position: null })),
  );
  expect(retainedTables.map((name) => rows(f.db, name))).toEqual(before);
  expect(schema(f.db)).toEqual(expect.arrayContaining(definitions));
  expect(f.workspace.get(f.editor.id, f.doc.id).access).toBe('editor');
  expect(f.db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

  // Cleanup must work after a real deletion, not merely retain trigger SQL text.
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(f.doc.id);
  expect(
    rows(f.db, 'collaboration_purge')
      .map((row) => row.item_id)
      .sort(),
  ).toEqual([f.doc.id, 'active-unit', 'staged-unit'].sort());
  for (const table of [
    'doc_snapshots',
    'doc_images',
    'history_checkpoints',
    'history_restore_labels',
    'workspace_links',
    'workspace_guest_sessions',
    'spinel_live_units',
    'spinel_restore_jobs',
  ])
    expect(rows(f.db, table), table).toEqual([]);
  expect(rows(f.db, 'sheet_snapshots')).toHaveLength(1);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('legacy items without trash columns gain nullable metadata without changing identity or contents', () => {
  const db = open();
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  db.exec(`CREATE TABLE workspace_items (
    id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES workspace_items(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,name TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
  ) STRICT`);
  db.prepare("INSERT INTO workspace_items VALUES(?,?,NULL,'doc','Legacy',1,2)").run(
    'legacy',
    owner.id,
  );
  migrateSpaceSchema(db);
  expect(rows(db, 'workspace_items')).toEqual([
    {
      id: 'legacy',
      owner_id: owner.id,
      parent_id: null,
      kind: 'doc',
      name: 'Legacy',
      created_at: 1,
      updated_at: 2,
      trashed_at: null,
      trash_batch: null,
      space_id: null,
      space_position: null,
    },
  ]);
  item(db, owner.id, 'space', 'space');
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('reopen and repeated migration retain ordered children, opaque bindings and missing-parent recovery metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-space-schema-'));
  directories.push(directory);
  const path = join(directory, 'database.sqlite');
  const f = populated(path);
  migrateSpaceSchema(f.db);
  item(f.db, f.owner.id, 'space', 'space', f.folder.id);
  item(f.db, f.owner.id, 'prior-parent', 'doc', 'space', 'space', 0);
  item(f.db, f.owner.id, 'subtree', 'folder', 'space', 'space', 1);
  item(f.db, f.owner.id, 'nested-doc', 'doc', 'subtree', 'space', 0);
  const binding = JSON.stringify({
    id: 'nested-doc',
    sourceBinding: { itemId: f.sheet.id },
    text: 'Unchanged',
  });
  f.db
    .prepare('INSERT INTO doc_snapshots VALUES(?,?,7,?)')
    .run('nested-doc', binding, 'nested-write');
  f.db.exec(
    "UPDATE workspace_items SET trashed_at=200,trash_batch='subtree-batch' WHERE id IN ('subtree','nested-doc')",
  );
  f.db
    .prepare('INSERT INTO workspace_space_trash VALUES(?,?,?,?,?,?,?)')
    .run('subtree', 'space', 'prior-parent', 5, 200, f.editor.id, 'subtree-batch');
  f.db.prepare("DELETE FROM workspace_items WHERE id='prior-parent'").run();
  f.db.prepare('DELETE FROM auth_users WHERE id=?').run(f.editor.id);
  const before = schema(f.db);
  const beforeItems = rows(f.db, 'workspace_items');
  const beforeRecovery = rows(f.db, 'workspace_space_trash');
  migrateSpaceSchema(f.db);
  expect(schema(f.db)).toEqual(before);
  f.db.close();

  const reopened = open(path);
  migrateSpaceSchema(reopened);
  expect(schema(reopened)).toEqual(before);
  expect(rows(reopened, 'workspace_items')).toEqual(beforeItems);
  expect(rows(reopened, 'workspace_space_trash')).toEqual(beforeRecovery);
  expect(beforeRecovery[0]).toMatchObject({
    original_parent_id: 'prior-parent',
    original_position: 5,
    trashed_by: f.editor.id,
  });
  expect(
    reopened.prepare("SELECT snapshot FROM doc_snapshots WHERE item_id='nested-doc'").get()
      ?.snapshot,
  ).toBe(binding);
  expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(() => reopened.prepare("DELETE FROM workspace_items WHERE id='space'").run()).toThrow();
});

test('an injected failure after dropping the old table rolls back all DDL/data and restores FK enforcement', () => {
  const f = populated();
  const beforeSchema = schema(f.db);
  const beforeItems = rows(f.db, 'workspace_items');
  const before = retainedTables.map((name) => rows(f.db, name));
  const execute = f.db.exec.bind(f.db);
  const spy = vi.spyOn(f.db, 'exec').mockImplementation((sql) => {
    if (sql.startsWith('ALTER TABLE workspace_items_space_new'))
      throw new Error('Injected rename failure');
    execute(sql);
  });
  expect(() => migrateSpaceSchema(f.db)).toThrow('Injected rename failure');
  spy.mockRestore();
  expect(schema(f.db)).toEqual(beforeSchema);
  expect(rows(f.db, 'workspace_items')).toEqual(beforeItems);
  expect(retainedTables.map((name) => rows(f.db, name))).toEqual(before);
  expect(f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('invalid existing foreign keys reject the migration atomically instead of dropping or repairing records', () => {
  const f = populated();
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db
    .prepare("INSERT INTO workspace_grants VALUES(?,?,'viewer',0)")
    .run('missing-item', f.editor.id);
  f.db.exec('PRAGMA foreign_keys=ON');
  const beforeSchema = schema(f.db);
  const before = rows(f.db, 'workspace_grants');
  expect(() => migrateSpaceSchema(f.db)).toThrow('invalid foreign keys');
  expect(schema(f.db)).toEqual(beforeSchema);
  expect(rows(f.db, 'workspace_grants')).toEqual(before);
  expect(f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
});

test('nested migration refusal leaves the caller transaction usable and its work intact', () => {
  const f = populated();
  const before = schema(f.db);
  let created = '';
  f.auth.transaction(() => {
    expect(() => migrateSpaceSchema(f.db)).toThrow('outside an existing transaction');
    created = f.auth.createUser('Caller still owns this transaction').id;
  });
  expect(f.auth.user(created)?.name).toBe('Caller still owns this transaction');
  expect(schema(f.db)).toEqual(before);
  expect(f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
});

test('partial Space columns with the old kind CHECK are not mistaken for a completed migration', () => {
  const f = populated();
  f.db.exec('ALTER TABLE workspace_items ADD COLUMN space_id TEXT');
  f.db.exec('ALTER TABLE workspace_items ADD COLUMN space_position INTEGER');
  const before = schema(f.db);
  expect(() => migrateSpaceSchema(f.db)).toThrow('does not recognize the existing Space schema');
  expect(schema(f.db)).toEqual(before);
  expect(f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
});

test('unknown future columns are retained and cause a refusal before rebuilding', () => {
  const f = populated();
  f.db.exec('ALTER TABLE workspace_items ADD COLUMN future_payload TEXT');
  f.db
    .prepare('UPDATE workspace_items SET future_payload=? WHERE id=?')
    .run('Retain this', f.doc.id);
  const before = schema(f.db);
  expect(() => migrateSpaceSchema(f.db)).toThrow('does not recognize the existing item columns');
  expect(schema(f.db)).toEqual(before);
  expect(
    f.db.prepare('SELECT future_payload FROM workspace_items WHERE id=?').get(f.doc.id)
      ?.future_payload,
  ).toBe('Retain this');
});
