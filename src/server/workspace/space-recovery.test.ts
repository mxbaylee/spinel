import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { backup, DatabaseSync } from '../../../server/database.ts';
import type { ItemKind } from '../../shared/workspace.ts';
import { AuthStore } from '../auth/store.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';

const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) if (database.isOpen) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function open(path: string) {
  const db = new DatabaseSync(path);
  databases.push(db);
  return db;
}

function fixture(path = ':memory:') {
  let now = Date.UTC(2026, 9, 22);
  const db = open(path);
  const auth = new AuthStore(db, () => now);
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  const spaces = new SpaceStore(workspace);
  const recovery = new SpaceRecoveryStore(workspace);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const other = auth.createUser('Other');
  const admin = auth.createUser('Operator', true);
  const outer = workspace.create(owner.id, {
    kind: 'folder',
    name: 'Private outer',
    parentId: null,
  });
  const space = spaces.createRoot(owner.id, { name: 'Project', parentId: outer.id }).space;
  spaces.share(owner.id, space.id, editor.id, 'editor');
  spaces.share(owner.id, space.id, viewer.id, 'viewer');
  const child = (name: string, kind: ItemKind = 'doc', parentId = space.id) =>
    spaces.createChild(owner.id, space.id, { name, kind, parentId }).item;
  // Opaque existing native records: recovery must never rewrite or reinterpret
  // snapshots or stable formula bindings while moving their workspace items.
  db.exec(`
    CREATE TABLE doc_snapshots (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL,revision INTEGER NOT NULL,write_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE sheet_snapshots (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL,revision INTEGER NOT NULL,write_id TEXT NOT NULL
    ) STRICT;
  `);
  const content = (docId: string, sheetId: string) => {
    db.prepare('INSERT INTO doc_snapshots VALUES(?,?,7,?)').run(
      docId,
      JSON.stringify({
        id: docId,
        body: 'Keep\r\n',
        sourceBindings: [{ itemId: sheetId, range: 'A1:B2' }],
      }),
      randomUUID(),
    );
    db.prepare('INSERT INTO sheet_snapshots VALUES(?,?,4,?)').run(
      sheetId,
      JSON.stringify({ id: sheetId, cells: { A1: 42, B2: '=A1+1' } }),
      randomUUID(),
    );
  };
  return {
    db,
    auth,
    workspace,
    spaces,
    recovery,
    owner,
    editor,
    viewer,
    other,
    admin,
    outer,
    space,
    child,
    content,
    advance: (milliseconds = 1_000) => {
      now += milliseconds;
    },
  };
}

type Fixture = ReturnType<typeof fixture>;
const rows = (db: DatabaseSync, table: string) =>
  db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const state = (db: DatabaseSync) =>
  ['workspace_items', 'workspace_space_trash', 'doc_snapshots', 'sheet_snapshots'].map((table) =>
    rows(db, table),
  );
const snapshots = (db: DatabaseSync) => [rows(db, 'doc_snapshots'), rows(db, 'sheet_snapshots')];
const live = (f: Fixture, parentId = f.space.id) =>
  f.spaces
    .list(f.owner.id, f.space.id)
    .items.filter((item) => item.parentId === parentId)
    .map((item) => [item.id, item.position]);

test('Edit recovers internal content; View, guests, outsiders and Operator receive no recovery access', () => {
  const f = fixture();
  const doc = f.child('Private deleted document');
  f.child('Nested sheet', 'sheet', doc.id);
  const liveDoc = f.child('Live');
  expect(f.recovery.trash(f.editor.id, f.space.id, doc.id).count).toBe(2);
  const preview = f.recovery.previewDelete(f.owner.id, f.space.id, doc.id);
  expect(f.recovery.list(f.editor.id, f.space.id)).toMatchObject({
    access: 'editor',
    items: [{ id: doc.id }],
  });
  for (const actor of [f.viewer.id, f.other.id, f.admin.id, 'missing', 'guest:unregistered']) {
    const before = state(f.db);
    expect(() => f.recovery.list(actor, f.space.id)).toThrow();
    expect(() => f.recovery.trash(actor, f.space.id, liveDoc.id)).toThrow();
    expect(() => f.recovery.restore(actor, f.space.id, doc.id)).toThrow();
    expect(() => f.recovery.previewDelete(actor, f.space.id, doc.id)).toThrow();
    expect(() => f.recovery.delete(actor, f.space.id, doc.id, preview.version)).toThrow();
    expect(state(f.db)).toEqual(before);
  }
  expect(() => f.recovery.previewDelete(f.editor.id, f.space.id, doc.id)).toThrow('Only the owner');
  expect(() => f.recovery.delete(f.editor.id, f.space.id, doc.id, preview.version)).toThrow(
    'Only the owner',
  );
  expect(() => f.recovery.trash(f.owner.id, f.space.id, f.space.id)).toThrow();
  expect(f.recovery.restore(f.editor.id, f.space.id, doc.id).restoredCount).toBe(2);
  expect(f.recovery.list(f.owner.id, f.space.id).items).toEqual([]);
});

test('deleting and restoring a mixed subtree retains native bytes, bindings, IDs and original sibling order', () => {
  const f = fixture();
  const parent = f.child('Original location');
  const first = f.child('Same', 'doc', parent.id);
  const doc = f.child('Same', 'doc', parent.id);
  const sheet = f.child('Nested', 'sheet', doc.id);
  const folder = f.child('Folder', 'folder', sheet.id);
  const last = f.child('Same', 'sheet', parent.id);
  f.content(doc.id, sheet.id);
  const native = snapshots(f.db);
  const deletion = f.recovery.trash(f.editor.id, f.space.id, doc.id);
  expect(deletion).toMatchObject({
    count: 3,
    item: {
      id: doc.id,
      descendantCount: 2,
      originalLocation: { id: parent.id, name: parent.name },
    },
  });
  expect(rows(f.db, 'workspace_space_trash')).toEqual([
    expect.objectContaining({
      item_id: doc.id,
      space_id: f.space.id,
      original_parent_id: parent.id,
      original_position: 1,
      trashed_by: f.editor.id,
      trashed_at: f.auth.now(),
    }),
  ]);
  expect(
    f.db.prepare('SELECT parent_id FROM workspace_items WHERE id=?').get(doc.id)?.parent_id,
  ).toBe(f.space.id);
  expect(
    f.db.prepare('SELECT parent_id FROM workspace_items WHERE id=?').get(sheet.id)?.parent_id,
  ).toBe(doc.id);
  expect(
    f.db.prepare('SELECT parent_id FROM workspace_items WHERE id=?').get(folder.id)?.parent_id,
  ).toBe(sheet.id);
  expect(live(f, parent.id)).toEqual([
    [first.id, 0],
    [last.id, 1],
  ]);
  expect(snapshots(f.db)).toEqual(native);
  f.spaces.updateChild(f.owner.id, f.space.id, parent.id, { name: 'Current location name' });
  expect(f.recovery.list(f.editor.id, f.space.id).items[0].originalLocation).toEqual({
    id: parent.id,
    name: 'Current location name',
  });
  // SPN-095: native recovery stays exact throughout the common 30-day window.
  f.advance(29 * 24 * 60 * 60 * 1_000);
  expect(f.recovery.restore(f.editor.id, f.space.id, doc.id)).toMatchObject({
    item: { id: doc.id, parentId: parent.id, position: 1 },
    restoredCount: 3,
    destination: 'original',
  });
  expect(live(f, parent.id)).toEqual([
    [first.id, 0],
    [doc.id, 1],
    [last.id, 2],
  ]);
  expect(f.spaces.get(f.owner.id, f.space.id, folder.id).item.parentId).toBe(sheet.id);
  expect(snapshots(f.db)).toEqual(native);
  expect(rows(f.db, 'workspace_space_trash')).toEqual([]);
});

test('earlier independent batches remain separate through later parent restore and permanent deletion', () => {
  const f = fixture();
  const parent = f.child('Later parent', 'folder');
  const old = f.child('Earlier document', 'doc', parent.id);
  const nested = f.child('Earlier sheet', 'sheet', old.id);
  const sibling = f.child('Later child', 'doc', parent.id);
  f.content(old.id, nested.id);
  f.recovery.trash(f.editor.id, f.space.id, old.id);
  const earlier = rows(f.db, 'workspace_space_trash')[0];
  const native = snapshots(f.db);
  f.advance();
  expect(f.recovery.trash(f.editor.id, f.space.id, parent.id).count).toBe(2);
  expect(f.recovery.list(f.editor.id, f.space.id).items).toHaveLength(2);
  expect(
    f.recovery.list(f.editor.id, f.space.id).items.find((item) => item.id === old.id)
      ?.originalLocation,
  ).toBeNull();
  expect(f.recovery.restore(f.editor.id, f.space.id, parent.id).restoredCount).toBe(2);
  expect(f.spaces.get(f.editor.id, f.space.id, sibling.id).item.parentId).toBe(parent.id);
  expect(() => f.spaces.get(f.editor.id, f.space.id, old.id)).toThrow('not available');
  expect(rows(f.db, 'workspace_space_trash')).toEqual([earlier]);

  f.recovery.trash(f.owner.id, f.space.id, parent.id);
  const preview = f.recovery.previewDelete(f.owner.id, f.space.id, parent.id);
  expect(preview.counts.total).toBe(2);
  expect(f.recovery.delete(f.owner.id, f.space.id, parent.id, preview.version)).toEqual({
    count: 2,
  });
  expect(rows(f.db, 'workspace_space_trash')).toEqual([earlier]);
  expect(snapshots(f.db)).toEqual(native);
  const listed = f.recovery.list(f.editor.id, f.space.id).items[0];
  expect(listed.originalLocation).toBeNull();
  expect(JSON.stringify(listed)).not.toContain(parent.id);
  const restored = f.recovery.restore(f.editor.id, f.space.id, old.id);
  expect(restored).toMatchObject({
    item: { id: old.id, parentId: f.space.id },
    restoredCount: 2,
    destination: 'space-root',
    reason: 'original-location-unavailable',
  });
  expect(JSON.stringify(restored)).not.toContain(parent.id);
  expect(snapshots(f.db)).toEqual(native);
});

test.each(['trashed', 'missing', 'different-space'] as const)(
  'an original parent that is %s causes a private Space-root fallback',
  (condition) => {
    const f = fixture();
    const parent = f.child('Do not disclose this historical location');
    const doc = f.child('Restore me', 'doc', parent.id);
    f.recovery.trash(f.editor.id, f.space.id, doc.id);
    if (condition === 'trashed') f.recovery.trash(f.owner.id, f.space.id, parent.id);
    else if (condition === 'missing')
      f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(parent.id);
    else {
      const privateSpace = f.spaces.createRoot(f.owner.id, {
        name: 'Unshared',
        parentId: null,
      }).space;
      // Simulate retained historical metadata after an external repair/import. The
      // recovery operation itself never permits conversion between Spaces.
      f.db
        .prepare('UPDATE workspace_items SET parent_id=?,space_id=? WHERE id=?')
        .run(privateSpace.id, privateSpace.id, parent.id);
    }
    const entry = f.recovery
      .list(f.editor.id, f.space.id)
      .items.find((item) => item.id === doc.id)!;
    expect(entry.originalLocation).toBeNull();
    expect(JSON.stringify(entry)).not.toContain(parent.id);
    expect(JSON.stringify(entry)).not.toContain(parent.name);
    const restored = f.recovery.restore(f.editor.id, f.space.id, doc.id);
    expect(restored).toMatchObject({
      item: { id: doc.id, parentId: f.space.id },
      destination: 'space-root',
      reason: 'original-location-unavailable',
    });
    expect(JSON.stringify(restored)).not.toContain(parent.id);
    expect(JSON.stringify(restored)).not.toContain(parent.name);
  },
);

test('exact-set confirmation is read-only and rejects wrong, same-count and newly enlarged deletion sets', () => {
  const f = fixture();
  const folder = f.child('Delete collection', 'folder');
  f.child('Document', 'doc', folder.id);
  f.child('Sheet', 'sheet', folder.id);
  const survivor = f.child('Keep');
  f.recovery.trash(f.owner.id, f.space.id, folder.id);
  const before = state(f.db);
  const preview = f.recovery.previewDelete(f.owner.id, f.space.id, folder.id);
  expect(preview.counts).toEqual({ total: 3, docs: 1, sheets: 1, folders: 1 });
  expect(preview.items.map((item) => item.name)).toEqual([
    'Delete collection',
    'Document',
    'Sheet',
  ]);
  // Cancel is simply not calling delete; preview itself cannot change any state.
  expect(state(f.db)).toEqual(before);
  for (const version of [undefined, null, '', 'wrong']) {
    expect(() => f.recovery.delete(f.owner.id, f.space.id, folder.id, version)).toThrow(
      'Review it again',
    );
    expect(state(f.db)).toEqual(before);
  }
  f.recovery.restore(f.owner.id, f.space.id, folder.id);
  f.recovery.trash(f.owner.id, f.space.id, folder.id);
  const replaced = state(f.db);
  expect(() => f.recovery.delete(f.owner.id, f.space.id, folder.id, preview.version)).toThrow(
    'Review it again',
  );
  expect(state(f.db)).toEqual(replaced);
  const current = f.recovery.previewDelete(f.owner.id, f.space.id, folder.id);
  const root = f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(folder.id)!;
  f.db
    .prepare(
      `INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position,trashed_at,trash_batch)
    VALUES(?,?,?,'doc','Added later',0,0,?,2,?,?)`,
    )
    .run(randomUUID(), f.owner.id, folder.id, f.space.id, root.trashed_at, root.trash_batch);
  const enlarged = state(f.db);
  expect(() => f.recovery.delete(f.owner.id, f.space.id, folder.id, current.version)).toThrow(
    'Review it again',
  );
  expect(state(f.db)).toEqual(enlarged);
  const final = f.recovery.previewDelete(f.owner.id, f.space.id, folder.id);
  expect(final.counts.total).toBe(4);
  expect(f.recovery.delete(f.owner.id, f.space.id, folder.id, final.version)).toEqual({ count: 4 });
  expect(f.spaces.list(f.owner.id, f.space.id).items.map((item) => item.id)).toEqual([survivor.id]);
});

test('leaf-first permanent deletion keeps native cleanup hooks and rolls them back on a later failure', () => {
  const f = fixture();
  const folder = f.child('Folder', 'folder');
  const doc = f.child('Doc', 'doc', folder.id);
  const sheet = f.child('Sheet', 'sheet', folder.id);
  f.content(doc.id, sheet.id);
  new CollaborationGenerations(f.workspace);
  f.db.exec(`
    CREATE TABLE workspace_collaboration (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('preparing','ready'))
    ) STRICT;
    CREATE TABLE doc_images (
      item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
      id TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(item_id,id)
    ) STRICT;
    CREATE TRIGGER collaboration_deleted BEFORE DELETE ON workspace_items
    WHEN EXISTS(SELECT 1 FROM workspace_collaboration WHERE item_id=OLD.id)
    BEGIN INSERT OR IGNORE INTO collaboration_purge VALUES(OLD.id); END;
  `);
  f.db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(doc.id);
  f.db
    .prepare('INSERT INTO doc_images VALUES(?,?,?,?)')
    .run(doc.id, 'image', 'image/png', Buffer.from([0, 255, 128]));
  f.db.prepare('INSERT INTO spinel_live_units VALUES(?,?,3)').run(doc.id, 'active-unit');
  f.db
    .prepare("INSERT INTO spinel_restore_jobs VALUES(?,?,?,?,?,?,'staging',NULL)")
    .run('restore-job', doc.id, f.owner.id, 'checkpoint', 'active-unit', 'staged-unit');
  f.recovery.trash(f.owner.id, f.space.id, folder.id);
  const preview = f.recovery.previewDelete(f.owner.id, f.space.id, folder.id);
  const before = state(f.db);
  const auxiliary = [
    'doc_images',
    'workspace_collaboration',
    'spinel_live_units',
    'spinel_restore_jobs',
    'collaboration_purge',
  ];
  const beforeAuxiliary = auxiliary.map((table) => rows(f.db, table));
  const prepare = f.db.prepare.bind(f.db);
  let deletes = 0;
  const spy = vi.spyOn(f.db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (!sql.includes('DELETE FROM workspace_items')) return statement;
    return {
      ...statement,
      run: (...values) => {
        if (++deletes === 3) throw new Error('Injected final deletion failure');
        return statement.run(...values);
      },
    };
  });
  expect(() => f.recovery.delete(f.owner.id, f.space.id, folder.id, preview.version)).toThrow(
    'Injected final deletion failure',
  );
  spy.mockRestore();
  expect(deletes).toBe(3);
  expect(state(f.db)).toEqual(before);
  expect(auxiliary.map((table) => rows(f.db, table))).toEqual(beforeAuxiliary);
  expect(f.recovery.delete(f.owner.id, f.space.id, folder.id, preview.version)).toEqual({
    count: 3,
  });
  expect(snapshots(f.db)).toEqual([[], []]);
  expect(rows(f.db, 'doc_images')).toEqual([]);
  expect(
    rows(f.db, 'collaboration_purge')
      .map((row) => row.item_id)
      .sort(),
  ).toEqual([doc.id, 'active-unit', 'staged-unit'].sort());
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test.each([
  'foreign-owner',
  'foreign-space',
  'missing-membership',
  'cycle',
  'batch-mismatch',
  'missing-record',
] as const)(
  'a %s corruption refuses every recovery operation without repairing or losing data',
  (corruption) => {
    const f = fixture();
    const folder = f.child('Folder', 'folder');
    const doc = f.child('Doc', 'doc', folder.id);
    const otherSpace = f.spaces.createRoot(f.owner.id, { name: 'Other', parentId: null }).space;
    f.recovery.trash(f.owner.id, f.space.id, folder.id);
    const preview = f.recovery.previewDelete(f.owner.id, f.space.id, folder.id);
    if (corruption === 'foreign-owner')
      f.db.prepare('UPDATE workspace_items SET owner_id=? WHERE id=?').run(f.other.id, doc.id);
    else if (corruption === 'foreign-space')
      f.db.prepare('UPDATE workspace_items SET space_id=? WHERE id=?').run(otherSpace.id, doc.id);
    else if (corruption === 'missing-membership')
      f.db
        .prepare('UPDATE workspace_items SET space_id=NULL,space_position=NULL WHERE id=?')
        .run(doc.id);
    else if (corruption === 'cycle')
      f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(doc.id, folder.id);
    else if (corruption === 'batch-mismatch')
      f.db.prepare("UPDATE workspace_items SET trash_batch='other-batch' WHERE id=?").run(doc.id);
    else f.db.prepare('DELETE FROM workspace_space_trash WHERE item_id=?').run(folder.id);
    const before = state(f.db);
    expect(() => f.recovery.list(f.editor.id, f.space.id)).toThrow('not available');
    expect(() => f.recovery.restore(f.editor.id, f.space.id, folder.id)).toThrow('not available');
    expect(() => f.recovery.previewDelete(f.owner.id, f.space.id, folder.id)).toThrow(
      'not available',
    );
    expect(() => f.recovery.delete(f.owner.id, f.space.id, folder.id, preview.version)).toThrow(
      'not available',
    );
    expect(state(f.db)).toEqual(before);
  },
);

test('a foreign attachment beneath a live subtree prevents any soft-deletion mutation', () => {
  const f = fixture();
  const folder = f.child('Folder', 'folder');
  const doc = f.child('Doc', 'doc', folder.id);
  f.db
    .prepare('UPDATE workspace_items SET space_id=NULL,space_position=NULL WHERE id=?')
    .run(doc.id);
  const before = state(f.db);
  expect(() => f.recovery.trash(f.editor.id, f.space.id, folder.id)).toThrow('not available');
  expect(state(f.db)).toEqual(before);
});

test('wrong-Space IDs, revoked access, disabled accounts and a trashed root never become recovery grants', () => {
  const f = fixture();
  const doc = f.child('Deleted');
  f.recovery.trash(f.editor.id, f.space.id, doc.id);
  const otherSpace = f.spaces.createRoot(f.owner.id, { name: 'Other', parentId: null }).space;
  expect(f.recovery.list(f.owner.id, otherSpace.id).items).toEqual([]);
  expect(() => f.recovery.restore(f.owner.id, otherSpace.id, doc.id)).toThrow('not in this');
  expect(() => f.recovery.previewDelete(f.owner.id, otherSpace.id, doc.id)).toThrow('not in this');
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
  expect(() => f.recovery.list(f.editor.id, f.space.id)).toThrow('cannot edit');
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
  expect(() => f.recovery.restore(f.editor.id, f.space.id, doc.id)).toThrow('not available');
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
  const before = state(f.db);
  for (const id of [f.editor.id, f.owner.id]) {
    f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(id);
    expect(() => f.recovery.list(f.editor.id, f.space.id)).toThrow();
    expect(() => f.recovery.restore(f.editor.id, f.space.id, doc.id)).toThrow();
    f.db.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(id);
  }
  f.db
    .prepare("UPDATE workspace_items SET trashed_at=1,trash_batch='outer' WHERE id=?")
    .run(f.space.id);
  expect(() => f.recovery.list(f.owner.id, f.space.id)).toThrow('not available');
  expect(() => f.recovery.restore(f.owner.id, f.space.id, doc.id)).toThrow('not available');
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=NULL,trash_batch=NULL WHERE id=?')
    .run(f.space.id);
  expect(state(f.db)).toEqual(before);
});

test('recovery metadata and opaque native bindings survive reopen and SQLite snapshot serialization', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-space-recovery-'));
  directories.push(directory);
  const path = join(directory, 'database.sqlite');
  const snapshotPath = join(directory, 'snapshot.sqlite');
  const f = fixture(path);
  const parent = f.child('Parent');
  const doc = f.child('Doc', 'doc', parent.id);
  const sheet = f.child('Sheet', 'sheet', doc.id);
  f.content(doc.id, sheet.id);
  f.recovery.trash(f.editor.id, f.space.id, doc.id);
  const listing = f.recovery.list(f.editor.id, f.space.id);
  const before = state(f.db);
  expect(JSON.parse(JSON.stringify(listing))).toEqual(listing);
  await backup(f.db, snapshotPath);
  f.db.close();
  for (const stored of [path, snapshotPath]) {
    const database = open(stored);
    const workspace = new WorkspaceStore(new AuthStore(database, () => f.auth.now()));
    const recovery = new SpaceRecoveryStore(workspace);
    expect(recovery.list(f.editor.id, f.space.id)).toEqual(listing);
    expect(state(database)).toEqual(before);
    const result = recovery.restore(f.editor.id, f.space.id, doc.id);
    expect(result).toMatchObject({
      item: { id: doc.id, parentId: parent.id },
      restoredCount: 2,
      destination: 'original',
    });
    expect(
      database.prepare('SELECT parent_id,space_id FROM workspace_items WHERE id=?').get(sheet.id),
    ).toEqual({ parent_id: doc.id, space_id: f.space.id });
    expect(snapshots(database)).toEqual(before.slice(2));
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  }
});

test('an oversized Space refuses recovery before storing a deletion batch', () => {
  const f = fixture();
  const folder = f.child('Folder', 'folder');
  f.db
    .prepare(
      `WITH RECURSIVE sequence(value) AS (
    SELECT 1 UNION ALL SELECT value+1 FROM sequence WHERE value<10000
  ) INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
    SELECT 'large-'||value,?,?,'doc','Large',0,0,?,value-1 FROM sequence`,
    )
    .run(f.owner.id, folder.id, f.space.id);
  expect(() => f.recovery.trash(f.editor.id, f.space.id, folder.id)).toThrow(
    'too large to process',
  );
  expect(rows(f.db, 'workspace_space_trash')).toEqual([]);
  expect(
    f.db.prepare('SELECT count(*) AS total FROM workspace_items WHERE trashed_at IS NOT NULL').get()
      ?.total,
  ).toBe(0);
  expect(
    f.db.prepare('SELECT parent_id FROM workspace_items WHERE id=?').get(folder.id)?.parent_id,
  ).toBe(f.space.id);
});
