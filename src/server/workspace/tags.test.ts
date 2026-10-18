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
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner'),
    viewer = auth.createUser('Viewer'),
    admin = auth.createUser('Operator', true);
  const store = new WorkspaceStore(auth);
  const item = store.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  store.share(owner.id, item.id, viewer.id, 'viewer');
  return { db, auth, store, owner, viewer, admin, item };
}
test('normalizes labels, preserves reusable vocabulary, and makes assignment changes idempotent', () => {
  const f = fixture();
  const before = f.store.get(f.owner.id, f.item.id).updatedAt;
  f.store.changeTag(f.owner.id, f.item.id, ' #BuDGet ');
  f.store.changeTag(f.owner.id, f.item.id, 'budget');
  f.store.changeTag(f.owner.id, f.item.id, 'cafe\u0301');
  expect(f.store.get(f.owner.id, f.item.id).tags).toEqual(['budget', 'café']);
  expect(f.store.list(f.owner.id)[0].tags).toEqual(['budget', 'café']);
  expect(f.store.get(f.owner.id, f.item.id).updatedAt).toBe(before);
  f.store.changeTag(f.owner.id, f.item.id, '#BUDGET', true);
  f.store.changeTag(f.owner.id, f.item.id, 'budget', true);
  expect(f.store.get(f.owner.id, f.item.id).tags).toEqual(['café']);
  // Previously used names remain reusable even without assignments; decision #62.
  expect(f.store.tagSuggestions(f.owner.id)).toEqual(['budget', 'café']);
});
test('viewers can organize personal tags without editing content or seeing another vocabulary', () => {
  const f = fixture();
  f.store.changeTag(f.owner.id, f.item.id, 'private-budget');
  f.store.changeTag(f.viewer.id, f.item.id, 'to-read');
  expect(f.store.get(f.viewer.id, f.item.id)).toMatchObject({
    access: 'viewer',
    tags: ['to-read'],
  });
  expect(f.store.get(f.owner.id, f.item.id).tags).toEqual(['private-budget']);
  expect(f.store.tagSuggestions(f.viewer.id)).toEqual(['to-read']);
  expect(() => f.store.get(f.viewer.id, f.item.id, 'edit')).toThrow('cannot edit');
  f.store.changeTag(f.viewer.id, f.item.id, 'private-budget', true);
  expect(f.store.get(f.owner.id, f.item.id).tags).toEqual(['private-budget']);
});
test('validates names and document kinds before creating vocabulary or assignments', () => {
  const f = fixture();
  for (const tag of ['', '  # ', 'a\nb', 'x'.repeat(65), null, 123, ['budget']]) {
    expect(() => f.store.changeTag(f.owner.id, f.item.id, tag)).toThrow('tag');
  }
  f.store.changeTag(f.owner.id, f.item.id, 'x'.repeat(64));
  const folder = f.store.create(f.owner.id, { name: 'Folder', kind: 'folder', parentId: null });
  expect(() => f.store.changeTag(f.owner.id, folder.id, 'no-folder-tag')).toThrow('document');
  expect(f.store.tagSuggestions(f.owner.id)).toEqual(['x'.repeat(64)]);
});
test('current access rejects revoked, unrelated, admin and disabled users without modifying tags', () => {
  const f = fixture();
  f.store.changeTag(f.viewer.id, f.item.id, 'mine');
  f.store.share(f.owner.id, f.item.id, f.viewer.id, null);
  expect(() => f.store.changeTag(f.viewer.id, f.item.id, 'must-not-save')).toThrow('not available');
  const stranger = f.auth.createUser('Stranger');
  expect(() => f.store.changeTag(stranger.id, f.item.id, 'must-not-save')).toThrow('not available');
  expect(() => f.store.changeTag(f.admin.id, f.item.id, 'must-not-save')).toThrow('everyday');
  expect(() => f.store.tagSuggestions(f.admin.id)).toThrow('everyday');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.store.changeTag(f.owner.id, f.item.id, 'must-not-save')).toThrow('Sign in');
  expect(() => f.store.tagSuggestions(f.owner.id)).toThrow('Sign in');
  expect(f.db.prepare('SELECT count(*) AS n FROM workspace_tag_assignments').get()?.n).toBe(1);
});
test('inherited viewers have personal tags; trash retains them and permanent deletion cascades assignments', () => {
  const f = fixture();
  const folder = f.store.create(f.owner.id, { name: 'Shared', kind: 'folder', parentId: null });
  f.store.update(f.owner.id, f.item.id, { parentId: folder.id });
  f.store.share(f.owner.id, f.item.id, f.viewer.id, null);
  f.store.share(f.owner.id, folder.id, f.viewer.id, 'viewer');
  f.store.changeTag(f.owner.id, f.item.id, 'budget');
  f.store.changeTag(f.viewer.id, f.item.id, 'reading');
  expect(f.store.children(f.viewer.id, folder.id)[0].tags).toEqual(['reading']);
  const trash = new TrashStore(f.store);
  trash.trash(f.owner.id, folder.id);
  expect(() => f.store.changeTag(f.viewer.id, f.item.id, 'blocked')).toThrow('not available');
  expect(trash.list(f.owner.id).items.find((i) => i.id === f.item.id)?.tags).toEqual(['budget']);
  trash.restore(f.owner.id, folder.id);
  expect(f.store.get(f.viewer.id, f.item.id).tags).toEqual(['reading']);
  trash.trash(f.owner.id, folder.id);
  trash.empty(f.owner.id, trash.list(f.owner.id).version);
  expect(f.db.prepare('SELECT count(*) AS n FROM workspace_tag_assignments').get()?.n).toBe(0);
  expect(f.store.tagSuggestions(f.viewer.id)).toEqual(['reading']);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
