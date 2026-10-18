import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test } from 'vitest';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { TrashStore } from './trash.ts';
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('PRAGMA foreign_keys=ON');
  const auth = new AuthStore(db),
    store = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner'),
    viewer = auth.createUser('Viewer'),
    admin = auth.createUser('Operator', true);
  const folder = store.create(owner.id, { name: 'Folder', kind: 'folder', parentId: null });
  const sheet = store.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: folder.id });
  const doc = store.create(owner.id, { name: 'Journal', kind: 'doc', parentId: null });
  return { db, auth, store, owner, viewer, admin, folder, sheet, doc };
}
const ids = (items: { id: string }[]) => items.map((item) => item.id);
test('pins append once, reorder and unpin without changing the shared document', () => {
  const f = fixture(),
    user = f.owner.id;
  for (const item of [f.folder, f.sheet, f.doc, f.folder]) f.store.pin(user, item.id);
  expect(ids(f.store.pins(user))).toEqual([f.folder.id, f.sheet.id, f.doc.id]);
  const order = [f.doc.id, f.folder.id, f.sheet.id];
  expect(ids(f.store.orderPins(user, order))).toEqual(order);
  expect(ids(new WorkspaceStore(f.auth).pins(user))).toEqual(order);
  expect(f.store.get(user, f.sheet.id)).toEqual(f.sheet);
  expect(ids(f.store.pin(user, f.folder.id, true))).toEqual([f.doc.id, f.sheet.id]);
  f.store.pin(user, f.folder.id, true);
  expect(ids(f.store.pin(user, f.folder.id))).toEqual([f.doc.id, f.sheet.id, f.folder.id]);
});
test('a viewer organizes their own shared pins without content or grant changes', () => {
  const f = fixture();
  f.store.share(f.owner.id, f.folder.id, f.viewer.id, 'viewer');
  f.store.pin(f.owner.id, f.sheet.id);
  f.store.pin(f.viewer.id, f.folder.id);
  f.store.pin(f.viewer.id, f.sheet.id);
  f.store.orderPins(f.viewer.id, [f.sheet.id, f.folder.id]);
  expect(ids(f.store.pins(f.owner.id))).toEqual([f.sheet.id]);
  expect(f.store.pins(f.viewer.id).map((item) => item.access)).toEqual(['viewer', 'viewer']);
  f.store.pin(f.viewer.id, f.sheet.id, true);
  expect(ids(f.store.pins(f.owner.id))).toEqual([f.sheet.id]);
  expect(() => f.store.get(f.viewer.id, f.sheet.id, 'edit')).toThrow('cannot edit');
});
test('stale, duplicate, foreign and malformed reorders are rejected atomically', () => {
  const f = fixture();
  f.store.pin(f.owner.id, f.sheet.id);
  f.store.pin(f.owner.id, f.doc.id);
  for (const order of [
    [],
    [f.sheet.id],
    [f.sheet.id, f.folder.id],
    [f.sheet.id, f.doc.id, 'foreign'],
  ])
    expect(() => f.store.orderPins(f.owner.id, order)).toThrow('pins changed');
  for (const order of [null, 'x', [1], [f.sheet.id, f.sheet.id]])
    expect(() => f.store.orderPins(f.owner.id, order)).toThrow('once');
  expect(ids(f.store.pins(f.owner.id))).toEqual([f.sheet.id, f.doc.id]);
  expect(() => f.store.pin(f.viewer.id, f.doc.id)).toThrow('not available');
  expect(() => f.store.pin(f.owner.id, null)).toThrow('Choose');
  for (const id of [f.admin.id, 'missing']) {
    expect(() => f.store.pins(id)).toThrow();
    expect(() => f.store.pin(id, f.sheet.id)).toThrow();
    expect(() => f.store.orderPins(id, [])).toThrow();
  }
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.store.pins(f.owner.id)).toThrow('Sign in');
});
test('revoking inherited access removes pins permanently but alternative grants retain them', () => {
  const f = fixture();
  f.store.share(f.owner.id, f.folder.id, f.viewer.id, 'viewer');
  f.store.share(f.owner.id, f.sheet.id, f.viewer.id, 'viewer');
  f.store.pin(f.viewer.id, f.folder.id);
  f.store.pin(f.viewer.id, f.sheet.id);
  f.store.share(f.owner.id, f.folder.id, f.viewer.id, null);
  expect(ids(f.store.pins(f.viewer.id))).toEqual([f.sheet.id]);
  f.store.share(f.owner.id, f.sheet.id, f.viewer.id, null);
  // Regrant before any read must not resurrect a removed reference.
  f.store.share(f.owner.id, f.folder.id, f.viewer.id, 'viewer');
  expect(f.store.pins(f.viewer.id)).toEqual([]);
  f.store.pin(f.viewer.id, f.sheet.id);
  f.store.update(f.owner.id, f.sheet.id, { parentId: null });
  f.store.update(f.owner.id, f.sheet.id, { parentId: f.folder.id });
  expect(f.store.pins(f.viewer.id)).toEqual([]);
});
test('trashing a subtree removes all users pins, restore does not repin, deletion cascades', () => {
  const f = fixture(),
    trash = new TrashStore(f.store);
  f.store.share(f.owner.id, f.folder.id, f.viewer.id, 'viewer');
  f.store.pin(f.owner.id, f.folder.id);
  f.store.pin(f.owner.id, f.sheet.id);
  f.store.pin(f.viewer.id, f.sheet.id);
  trash.trash(f.owner.id, f.folder.id);
  trash.restore(f.owner.id, f.folder.id);
  expect(f.store.pins(f.owner.id)).toEqual([]);
  expect(f.store.pins(f.viewer.id)).toEqual([]);
  f.store.pin(f.owner.id, f.sheet.id);
  trash.trash(f.owner.id, f.folder.id);
  trash.empty(f.owner.id, trash.list(f.owner.id).version);
  expect(f.db.prepare('SELECT count(*) AS n FROM workspace_pins').get()?.n).toBe(0);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
