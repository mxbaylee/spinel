import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { backup, DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { DocumentStore } from './documents.ts';
import { SheetStore } from './sheets.ts';
import { SpaceLifecycleStore } from './space-lifecycle.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';

const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true });
});

const open = (path: string) => {
  const db = new DatabaseSync(path);
  databases.push(db);
  return db;
};

function fixture(path = ':memory:') {
  const db = open(path);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  new DocumentStore(workspace);
  new SheetStore(workspace);
  new CollaborationGenerations(workspace);
  const spaces = new SpaceStore(workspace);
  const recovery = new SpaceRecoveryStore(workspace);
  const lifecycle = new SpaceLifecycleStore(workspace);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const outsider = auth.createUser('Other');
  const operator = auth.createUser('Operator', true);
  const outer = workspace.create(owner.id, {
    name: 'Private outer folder',
    kind: 'folder',
    parentId: null,
  });
  const space = spaces.createRoot(owner.id, { name: 'Project', parentId: outer.id }).space;
  spaces.share(owner.id, space.id, editor.id, 'editor');
  spaces.share(owner.id, space.id, viewer.id, 'viewer');
  const doc = spaces.createChild(editor.id, space.id, {
    name: 'Notes',
    kind: 'doc',
    parentId: space.id,
  }).item;
  const sheet = spaces.createChild(editor.id, space.id, {
    name: 'Budget',
    kind: 'sheet',
    parentId: doc.id,
  }).item;
  const deleted = spaces.createChild(editor.id, space.id, {
    name: 'Earlier removed',
    kind: 'folder',
    parentId: doc.id,
  }).item;
  const deletedDoc = spaces.createChild(editor.id, space.id, {
    name: 'Earlier nested',
    kind: 'doc',
    parentId: deleted.id,
  }).item;
  db.prepare('INSERT INTO doc_snapshots VALUES(?,?,3,?)').run(
    doc.id,
    JSON.stringify({
      id: doc.id,
      body: { dataStream: 'Keep\r\n' },
      bindings: [{ itemId: sheet.id, range: 'A1' }],
    }),
    randomUUID(),
  );
  db.prepare('INSERT INTO sheet_snapshots VALUES(?,?,2,?)').run(
    sheet.id,
    JSON.stringify({ id: sheet.id, cellData: { A1: 42 } }),
    randomUUID(),
  );
  db.prepare('INSERT INTO doc_snapshots VALUES(?,?,1,?)').run(
    deletedDoc.id,
    JSON.stringify({ id: deletedDoc.id, body: { dataStream: 'Also keep\r\n' } }),
    randomUUID(),
  );
  db.prepare('INSERT INTO doc_images VALUES(?,?,?,?)').run(
    doc.id,
    'a'.repeat(64),
    'image/png',
    Buffer.from('opaque retained bytes'),
  );
  db.prepare('INSERT INTO spinel_live_units VALUES(?,?,0)').run(doc.id, 'live-doc-unit');
  db.prepare('INSERT INTO spinel_restore_jobs VALUES(?,?,?,?,?,?,?,?)').run(
    'restore-job',
    doc.id,
    owner.id,
    'checkpoint',
    'old-doc-unit',
    'staged-doc-unit',
    'staging',
    null,
  );
  recovery.trash(editor.id, space.id, deleted.id);
  return {
    db,
    auth,
    workspace,
    spaces,
    recovery,
    lifecycle,
    owner,
    editor,
    viewer,
    outsider,
    operator,
    outer,
    space,
    doc,
    sheet,
    deleted,
    deletedDoc,
  };
}

const tables = [
  'workspace_items',
  'workspace_space_trash',
  'workspace_grants',
  'doc_snapshots',
  'sheet_snapshots',
  'doc_images',
  'spinel_live_units',
  'spinel_restore_jobs',
  'collaboration_purge',
];
const rows = (db: DatabaseSync, table: string) =>
  db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all();
const state = (db: DatabaseSync) => tables.map((table) => rows(db, table));
const members = (f: ReturnType<typeof fixture>) =>
  f.db.prepare('SELECT * FROM workspace_items WHERE space_id=? ORDER BY id').all(f.space.id);
const content = (db: DatabaseSync) => tables.slice(3).map((table) => rows(db, table));

test('whole-Space move, trash and restore preserve native IDs, order, contents and earlier recovery batches', () => {
  const f = fixture();
  const before = members(f);
  const native = content(f.db);
  const earlier = rows(f.db, 'workspace_space_trash');
  const folder = f.workspace.create(f.owner.id, {
    name: 'New location',
    kind: 'folder',
    parentId: null,
  });
  f.spaces.updateRoot(f.owner.id, f.space.id, { parentId: folder.id, name: 'Renamed' });
  expect(members(f)).toEqual(before);
  expect(f.lifecycle.trash(f.owner.id, f.space.id)).toMatchObject({ id: f.space.id, count: 5 });
  for (const actor of [f.owner.id, f.editor.id, f.viewer.id]) {
    for (const id of [f.space.id, f.doc.id, f.sheet.id])
      expect(() => f.spaces.get(actor, f.space.id, id)).toThrow('not available');
    expect(() => f.recovery.list(actor, f.space.id)).toThrow('not available');
  }
  expect(members(f)).toEqual(before);
  expect(content(f.db)).toEqual(native);
  expect(rows(f.db, 'workspace_space_trash')).toEqual(earlier);
  expect(f.lifecycle.restore(f.owner.id, f.space.id)).toMatchObject({
    destination: 'original',
    space: { id: f.space.id, parentId: folder.id, name: 'Renamed' },
  });
  expect(f.spaces.list(f.editor.id, f.space.id).items.map((item) => item.id)).toEqual([
    f.doc.id,
    f.sheet.id,
  ]);
  expect(() => f.spaces.get(f.owner.id, f.space.id, f.deletedDoc.id)).toThrow('not available');
  expect(f.recovery.list(f.editor.id, f.space.id).items.map((item) => item.id)).toEqual([
    f.deleted.id,
  ]);
  expect(members(f)).toEqual(before);
  expect(content(f.db)).toEqual(native);
  expect(rows(f.db, 'workspace_space_trash')).toEqual(earlier);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('only the current active everyday owner may use whole-Space lifecycle operations', () => {
  const f = fixture();
  const others = [
    f.editor.id,
    f.viewer.id,
    f.outsider.id,
    f.operator.id,
    'guest:unregistered',
    'missing',
  ];
  let before = state(f.db);
  for (const actor of others) expect(() => f.lifecycle.trash(actor, f.space.id)).toThrow();
  expect(state(f.db)).toEqual(before);
  expect(() => f.lifecycle.trash(f.owner.id, f.doc.id)).toThrow();
  expect(() => f.lifecycle.previewDelete(f.owner.id, f.space.id)).toThrow('not in your trash');
  f.lifecycle.trash(f.owner.id, f.space.id);
  const preview = f.lifecycle.previewDelete(f.owner.id, f.space.id);
  before = state(f.db);
  for (const actor of others) {
    expect(() => f.lifecycle.restore(actor, f.space.id)).toThrow();
    expect(() => f.lifecycle.previewDelete(actor, f.space.id)).toThrow();
    expect(() => f.lifecycle.delete(actor, f.space.id, preview.version)).toThrow();
  }
  expect(state(f.db)).toEqual(before);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.lifecycle.restore(f.owner.id, f.space.id)).toThrow();
  expect(() => f.lifecycle.previewDelete(f.owner.id, f.space.id)).toThrow();
  expect(() => f.lifecycle.delete(f.owner.id, f.space.id, preview.version)).toThrow();
  expect(state(f.db)).toEqual(before);
  f.db.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(f.owner.id);
  f.lifecycle.restore(f.owner.id, f.space.id);
});

test('an unavailable original outer folder restores to My files root without disclosing that location', () => {
  const f = fixture();
  const before = members(f);
  f.lifecycle.trash(f.owner.id, f.space.id);
  // Deliberately simulate a persisted outer hierarchy changed outside this
  // foundation. Ordinary Trash correctly refuses an outer subtree with a Space.
  f.db
    .prepare("UPDATE workspace_items SET trashed_at=1,trash_batch='outer' WHERE id=?")
    .run(f.outer.id);
  const restored = f.lifecycle.restore(f.owner.id, f.space.id);
  expect(restored).toMatchObject({
    destination: 'my-files-root',
    reason: 'original-location-unavailable',
    space: { parentId: null },
  });
  expect(JSON.stringify(restored)).not.toContain(f.outer.id);
  expect(JSON.stringify(restored)).not.toContain(f.outer.name);
  expect(members(f)).toEqual(before);
  expect(f.spaces.get(f.editor.id, f.space.id, f.doc.id).access).toBe('editor');
});

test('foreign and missing saved outer locations are not treated as inherited permission or disclosed', () => {
  const f = fixture();
  const foreign = f.workspace.create(f.outsider.id, {
    name: 'Other owner secret',
    kind: 'folder',
    parentId: null,
  });
  for (const parentId of [foreign.id, 'missing-parent']) {
    f.lifecycle.trash(f.owner.id, f.space.id);
    f.db.exec('PRAGMA foreign_keys=OFF');
    f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(parentId, f.space.id);
    f.db.exec('PRAGMA foreign_keys=ON');
    const restored = f.lifecycle.restore(f.owner.id, f.space.id);
    expect(restored.destination).toBe('my-files-root');
    expect(JSON.stringify(restored)).not.toContain(parentId);
    expect(JSON.stringify(restored)).not.toContain(foreign.name);
    expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  }
});

test('deletion confirmation includes every live and internally deleted member and rejects stale generations', () => {
  const f = fixture();
  f.lifecycle.trash(f.owner.id, f.space.id);
  let preview = f.lifecycle.previewDelete(f.owner.id, f.space.id);
  expect(preview.counts).toEqual({ total: 5, docs: 2, sheets: 1, folders: 1, spaces: 1 });
  expect(new Set(preview.items.map((item) => item.id))).toEqual(
    new Set([f.space.id, f.doc.id, f.sheet.id, f.deleted.id, f.deletedDoc.id]),
  );
  let before = state(f.db);
  for (const version of [undefined, '', preview.version + 'stale'])
    expect(() => f.lifecycle.delete(f.owner.id, f.space.id, version)).toThrow('changed');
  expect(state(f.db)).toEqual(before);
  f.db
    .prepare('UPDATE workspace_items SET name=? WHERE id=?')
    .run('Same count, changed subtree', f.deletedDoc.id);
  before = state(f.db);
  expect(() => f.lifecycle.delete(f.owner.id, f.space.id, preview.version)).toThrow('changed');
  expect(state(f.db)).toEqual(before);
  preview = f.lifecycle.previewDelete(f.owner.id, f.space.id);
  f.lifecycle.restore(f.owner.id, f.space.id);
  f.lifecycle.trash(f.owner.id, f.space.id);
  before = state(f.db);
  expect(() => f.lifecycle.delete(f.owner.id, f.space.id, preview.version)).toThrow('changed');
  expect(state(f.db)).toEqual(before);
});

test('confirmed permanent deletion runs native cascades and generation cleanup while retaining unrelated files', () => {
  const f = fixture();
  const unrelated = f.workspace.create(f.owner.id, {
    name: 'Keep ordinary',
    kind: 'doc',
    parentId: null,
  });
  const other = f.spaces.createRoot(f.owner.id, { name: 'Keep Space', parentId: null }).space;
  f.lifecycle.trash(f.owner.id, f.space.id);
  const preview = f.lifecycle.previewDelete(f.owner.id, f.space.id);
  expect(f.lifecycle.delete(f.owner.id, f.space.id, preview.version)).toEqual({ count: 5 });
  for (const table of [
    'workspace_space_trash',
    'workspace_grants',
    'doc_snapshots',
    'sheet_snapshots',
    'doc_images',
    'spinel_live_units',
    'spinel_restore_jobs',
  ])
    expect(rows(f.db, table), table).toEqual([]);
  expect(
    rows(f.db, 'collaboration_purge')
      .map((row) => row.item_id)
      .sort(),
  ).toEqual(['live-doc-unit', 'staged-doc-unit']);
  expect(f.workspace.get(f.owner.id, unrelated.id).id).toBe(unrelated.id);
  expect(f.workspace.get(f.owner.id, f.outer.id).id).toBe(f.outer.id);
  expect(f.spaces.get(f.owner.id, other.id).space.id).toBe(other.id);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('a late root deletion failure rolls back prior child cascades, recovery records and cleanup queue entries', () => {
  const f = fixture();
  f.lifecycle.trash(f.owner.id, f.space.id);
  const preview = f.lifecycle.previewDelete(f.owner.id, f.space.id);
  f.db.exec(`CREATE TRIGGER refuse_space_root BEFORE DELETE ON workspace_items
    WHEN OLD.kind='space' BEGIN SELECT RAISE(ABORT,'retain the complete Space'); END;`);
  const before = state(f.db);
  expect(() => f.lifecycle.delete(f.owner.id, f.space.id, preview.version)).toThrow(
    'retain the complete Space',
  );
  expect(state(f.db)).toEqual(before);
  f.db.exec('DROP TRIGGER refuse_space_root');
  expect(f.lifecycle.delete(f.owner.id, f.space.id, preview.version)).toEqual({ count: 5 });
});

test('whole operations reject malformed recovery graphs before changing data', () => {
  const f = fixture();
  const native = content(f.db);
  f.db
    .prepare('UPDATE workspace_items SET trash_batch=? WHERE id=?')
    .run('wrong-batch', f.deletedDoc.id);
  let before = state(f.db);
  expect(() => f.lifecycle.trash(f.owner.id, f.space.id)).toThrow('not available');
  expect(state(f.db)).toEqual(before);
  const batch = f.db
    .prepare('SELECT trash_batch FROM workspace_items WHERE id=?')
    .get(f.deleted.id)!.trash_batch;
  f.db.prepare('UPDATE workspace_items SET trash_batch=? WHERE id=?').run(batch, f.deletedDoc.id);
  f.lifecycle.trash(f.owner.id, f.space.id);
  f.db
    .prepare('UPDATE workspace_items SET trash_batch=? WHERE id=?')
    .run('wrong-again', f.deletedDoc.id);
  before = state(f.db);
  expect(() => f.lifecycle.restore(f.owner.id, f.space.id)).toThrow('not available');
  expect(() => f.lifecycle.previewDelete(f.owner.id, f.space.id)).toThrow('not available');
  expect(() => f.lifecycle.delete(f.owner.id, f.space.id, 'untrusted')).toThrow('not available');
  expect(state(f.db)).toEqual(before);
  expect(content(f.db)).toEqual(native);
});

test('a serialized and reopened trashed Space restores with exact child content, bindings and recovery metadata', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-space-lifecycle-'));
  directories.push(directory);
  const f = fixture(join(directory, 'source.sqlite'));
  f.lifecycle.trash(f.owner.id, f.space.id);
  const memberRows = members(f);
  const native = content(f.db);
  const earlier = rows(f.db, 'workspace_space_trash');
  const copyPath = join(directory, 'snapshot.sqlite');
  await backup(f.db, copyPath);
  f.db.close();
  for (const path of [join(directory, 'source.sqlite'), copyPath]) {
    const db = open(path);
    const auth = new AuthStore(db);
    const workspace = new WorkspaceStore(auth);
    migrateSpaceSchema(db);
    const lifecycle = new SpaceLifecycleStore(workspace);
    expect(lifecycle.previewDelete(f.owner.id, f.space.id).counts.total).toBe(5);
    lifecycle.restore(f.owner.id, f.space.id);
    expect(
      db.prepare('SELECT * FROM workspace_items WHERE space_id=? ORDER BY id').all(f.space.id),
    ).toEqual(memberRows);
    expect(content(db)).toEqual(native);
    expect(rows(db, 'workspace_space_trash')).toEqual(earlier);
    expect(new SpaceStore(workspace).get(f.editor.id, f.space.id, f.sheet.id).access).toBe(
      'editor',
    );
    expect(new SpaceRecoveryStore(workspace).list(f.editor.id, f.space.id).items[0].id).toBe(
      f.deleted.id,
    );
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  }
});

test('whole lifecycle refuses over-budget persisted trees before trash, restore or deletion', () => {
  const f = fixture();
  f.db
    .prepare(
      `WITH RECURSIVE sequence(value) AS (
    SELECT 1 UNION ALL SELECT value+1 FROM sequence WHERE value<10000
  ) INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
    SELECT 'oversized-'||value,?,?,'doc','Existing',0,0,?,value FROM sequence
  `,
    )
    .run(f.owner.id, f.space.id, f.space.id);
  expect(() => f.lifecycle.trash(f.owner.id, f.space.id)).toThrow('too large');
  expect(
    f.db.prepare('SELECT trashed_at FROM workspace_items WHERE id=?').get(f.space.id)?.trashed_at,
  ).toBeNull();
  f.db
    .prepare("UPDATE workspace_items SET trashed_at=1,trash_batch='root-batch' WHERE id=?")
    .run(f.space.id);
  const before = state(f.db);
  expect(() => f.lifecycle.restore(f.owner.id, f.space.id)).toThrow('too large');
  expect(() => f.lifecycle.previewDelete(f.owner.id, f.space.id)).toThrow('too large');
  expect(() => f.lifecycle.delete(f.owner.id, f.space.id, 'untrusted')).toThrow('too large');
  expect(state(f.db)).toEqual(before);
});
