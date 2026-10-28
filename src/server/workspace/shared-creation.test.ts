import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import type { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceFiles } from './files.ts';
import { FileTrash } from './file-trash.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { TRASH_RETENTION_MS } from './trash-retention.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function fixture() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const files = new WorkspaceFiles(workspace);
  const owner = auth.createUser('Folder owner');
  const editor = auth.createUser('File creator');
  const viewer = auth.createUser('Reader');
  const operator = auth.createUser('Operator', true);
  const privateRoot = workspace.create(owner.id, {
    name: 'Private ancestor',
    kind: 'folder',
    parentId: null,
  });
  const folder = workspace.create(owner.id, {
    name: 'Trip 2027',
    kind: 'folder',
    parentId: privateRoot.id,
  });
  workspace.share(owner.id, folder.id, editor.id, 'editor');
  workspace.share(owner.id, folder.id, viewer.id, 'viewer');
  return { db, auth, workspace, files, owner, editor, viewer, operator, privateRoot, folder };
}

test.each(['folder', 'sheet', 'doc', 'space'] as const)(
  'editor-created %s belongs to the canonical folder owner and inherits only folder access',
  (kind) => {
    const f = fixture();
    const item = f.files.create(f.editor.id, {
      name: 'Collaborative work',
      kind,
      parentId: f.folder.id,
    });
    expect(item).toMatchObject({
      kind,
      parentId: f.folder.id,
      access: 'editor',
      ownerName: f.owner.name,
      createdByName: f.editor.name,
    });
    expect(f.workspace.fileOwner(item.id)).toBe(f.owner.id);
    expect(f.files.list(f.editor.id)).toEqual([]);
    expect(f.files.list(f.owner.id)).toContainEqual(
      expect.objectContaining({ id: item.id, access: 'owner', createdByName: f.editor.name }),
    );
    expect(f.files.get(f.viewer.id, item.id)).toMatchObject({
      access: 'viewer',
      createdByName: f.editor.name,
    });
    expect(f.files.children(f.owner.id, f.folder.id)).toContainEqual(
      expect.objectContaining({ id: item.id }),
    );
    expect(f.files.shared(f.editor.id)).toContainEqual(
      expect.objectContaining({ id: item.id, createdByName: f.editor.name }),
    );
    expect(f.db.prepare('SELECT * FROM workspace_grants WHERE item_id=?').all(item.id)).toEqual([]);
    expect(
      f.db.prepare('SELECT created_by FROM workspace_item_creators WHERE item_id=?').get(item.id)
        ?.created_by,
    ).toBe(f.editor.id);
    expect(f.files.get(f.editor.id, f.folder.id).parentId).toBeNull();
    expect(() => f.files.update(f.editor.id, item.id, { name: 'Rename' })).toThrow(
      'Only the owner',
    );
    expect(() => f.files.update(f.editor.id, item.id, { parentId: null })).toThrow(
      'Only the owner',
    );
    expect(() =>
      new FileTrash(f.workspace, TRASH_RETENTION_MS).trash(f.editor.id, item.id),
    ).toThrow();
    expect(() => f.files.share(f.editor.id, item.id, f.viewer.id, 'editor')).toThrow();
    // The creator has no extra grant: losing the folder removes their new item too.
    f.workspace.share(f.owner.id, f.folder.id, f.editor.id, null);
    expect(() => f.files.get(f.editor.id, item.id)).toThrow('not available');
    expect(f.files.get(f.owner.id, item.id).createdByName).toBe(f.editor.name);
  },
);

test('creation uses inherited Admin/Edit access, while filing and moves retain their original authority', () => {
  const f = fixture();
  const nested = f.files.create(f.editor.id, {
    name: 'Next stop',
    kind: 'folder',
    parentId: f.folder.id,
  });
  const doc = f.files.create(f.editor.id, { name: 'Notes', kind: 'doc', parentId: nested.id });
  expect(f.workspace.fileOwner(doc.id)).toBe(f.owner.id);
  expect(() => f.workspace.place(f.editor.id, doc.id, nested.id)).toThrow('Only the owner');
  f.workspace.share(f.owner.id, f.folder.id, f.editor.id, 'admin');
  const sheet = f.files.create(f.editor.id, { name: 'Costs', kind: 'sheet', parentId: nested.id });
  expect(sheet.access).toBe('admin');
  expect(
    f.files.update(f.editor.id, sheet.id, { name: 'Budget', parentId: f.folder.id }),
  ).toMatchObject({ name: 'Budget', parentId: f.folder.id, createdByName: f.editor.name });
  const mine = f.files.create(f.editor.id, { name: 'My draft', kind: 'doc', parentId: null });
  expect(f.workspace.fileOwner(mine.id)).toBe(f.editor.id);
  expect(() => f.files.update(f.editor.id, mine.id, { parentId: f.folder.id })).toThrow();
});

test('read-only, revoked, disabled, Operator, unknown and nonfolder destinations publish nothing', () => {
  const f = fixture();
  const before = f.db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count;
  const create = (actor: string, parentId: unknown = f.folder.id) =>
    f.files.create(actor, { kind: 'doc', name: 'No', parentId });
  expect(() => create(f.viewer.id)).toThrow('cannot edit');
  expect(() => create(f.operator.id)).toThrow('everyday account');
  expect(() => create(f.editor.id, f.privateRoot.id)).toThrow('not available');
  expect(() => create(f.editor.id, randomUUID())).toThrow('not available');
  f.workspace.share(f.owner.id, f.folder.id, f.editor.id, null);
  expect(() => create(f.editor.id)).toThrow('not available');
  f.workspace.share(f.owner.id, f.folder.id, f.editor.id, 'editor');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
  expect(() => create(f.editor.id)).toThrow('Sign in');
  expect(f.db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count).toBe(before);
});

test('a disabled owner does not change retained ordinary collaborator grants or Space-specific restrictions', () => {
  const f = fixture();
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  const doc = f.files.create(f.editor.id, {
    kind: 'doc',
    name: 'Continuing work',
    parentId: f.folder.id,
  });
  expect(doc.access).toBe('editor');
  expect(f.workspace.fileOwner(doc.id)).toBe(f.owner.id);
  expect(() =>
    f.files.create(f.editor.id, { kind: 'space', name: 'Space', parentId: f.folder.id }),
  ).toThrow('not available');
});

test('account-only creator attribution follows names, survives departure and does not grant access or expose guest identity', () => {
  const f = fixture();
  const item = f.files.create(f.editor.id, {
    name: 'Shared notes',
    kind: 'doc',
    parentId: f.folder.id,
  });
  const change = f.workspace.links.begin(item.id, 'editor');
  f.workspace.links.finish(item.id, change.epoch, true);
  const guest = f.workspace.links.exchange(item.id, change.token!).userId;
  const publicItem = f.workspace.get(guest, item.id);
  expect(publicItem).not.toHaveProperty('createdByName');
  expect(JSON.stringify(publicItem)).not.toContain(f.editor.name);
  expect(JSON.stringify(publicItem)).not.toContain(f.editor.id);
  expect(JSON.stringify(publicItem)).not.toContain(f.owner.name);
  expect(() => f.files.create(guest, { name: 'No', kind: 'doc', parentId: f.folder.id })).toThrow();
  f.db.prepare('UPDATE auth_users SET name=? WHERE id=?').run('Updated creator', f.editor.id);
  expect(f.files.get(f.owner.id, item.id).createdByName).toBe('Updated creator');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
  expect(f.files.get(f.owner.id, item.id).createdByName).toBe('Updated creator');
  // Removing the collaborator must not cascade into the folder owner's item.
  f.db.prepare('DELETE FROM auth_users WHERE id=?').run(f.editor.id);
  expect(f.files.get(f.owner.id, item.id)).toMatchObject({
    createdByName: f.editor.name,
    access: 'owner',
  });
  expect(f.workspace.fileOwner(item.id)).toBe(f.owner.id);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('ordinary shared-folder creation cannot enter a Space tree, and its attribution survives the Space migration', () => {
  const f = fixture();
  const spaces = new SpaceStore(f.workspace);
  const root = f.files.create(f.editor.id, {
    name: 'Trip Space',
    kind: 'space',
    parentId: f.folder.id,
  });
  const child = spaces.createChild(f.editor.id, root.id, {
    name: 'Inside',
    kind: 'folder',
    parentId: root.id,
  }).item;
  for (const parentId of [root.id, child.id])
    expect(() =>
      f.files.create(f.editor.id, { kind: 'doc', name: 'Ordinary', parentId }),
    ).toThrow();
  migrateSpaceSchema(f.db);
  expect(f.files.get(f.owner.id, root.id).createdByName).toBe(f.editor.name);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('creator metadata is additive and does not invent attribution for existing or restored legacy rows', () => {
  const f = fixture();
  const id = randomUUID();
  f.db
    .prepare(
      'INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(id, f.owner.id, f.folder.id, 'doc', 'Retained document', 1, 1);
  expect(f.files.get(f.owner.id, id)).not.toHaveProperty('createdByName');
  expect(f.files.get(f.editor.id, id)).not.toHaveProperty('createdByName');
  const reopened = new WorkspaceStore(f.auth, { spacesEnabled: true });
  migrateSpaceSchema(f.db);
  expect(reopened.get(f.editor.id, id)).not.toHaveProperty('createdByName');
  expect(f.db.prepare('SELECT * FROM workspace_item_creators WHERE item_id=?').all(id)).toEqual([]);
});
