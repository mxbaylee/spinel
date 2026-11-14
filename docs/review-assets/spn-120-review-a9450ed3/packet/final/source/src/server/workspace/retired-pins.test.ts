import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
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
  return { db, auth, store: new WorkspaceStore(auth), owner: auth.createUser('Owner') };
}

test('new workspaces do not create the retired pin schema', () => {
  const { db } = fixture();
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE name='workspace_pins'").get(),
  ).toBeUndefined();
});

test('opening a legacy pin database preserves files and ordinary trash recovery', () => {
  const { db, auth, store, owner } = fixture();
  const folder = store.create(owner.id, { name: 'Recipes', kind: 'folder', parentId: null });
  const doc = store.create(owner.id, { name: 'Bread', kind: 'doc', parentId: folder.id });
  // Preserve the old table as an unused compatibility tombstone, not a destructive migration.
  db.exec(`CREATE TABLE workspace_pins (
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY(user_id,item_id)
  ) STRICT`);
  db.prepare('INSERT INTO workspace_pins VALUES(?,?,0)').run(owner.id, doc.id);

  const reopened = new WorkspaceStore(auth);
  expect(reopened.get(owner.id, doc.id)).toEqual(doc);
  const trash = new TrashStore(reopened);
  trash.trash(owner.id, folder.id);
  trash.restore(owner.id, folder.id);
  expect(reopened.get(owner.id, doc.id)).toEqual(doc);
  expect(db.prepare('SELECT item_id FROM workspace_pins').get()?.item_id).toBe(doc.id);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
