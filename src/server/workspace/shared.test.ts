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
  let time = 1000;
  const auth = new AuthStore(db, () => time),
    store = new WorkspaceStore(auth),
    trash = new TrashStore(store);
  const owner = auth.createUser('Original Owner'),
    viewer = auth.createUser('Viewer'),
    other = auth.createUser('Other'),
    admin = auth.createUser('Operator', true);
  const folder = store.create(owner.id, { name: 'Shared folder', kind: 'folder', parentId: null });
  const doc = store.create(owner.id, { name: 'Shared journal', kind: 'doc', parentId: folder.id });
  const sheet = store.create(owner.id, { name: 'Shared budget', kind: 'sheet', parentId: null });
  const mine = store.create(viewer.id, { name: 'My folder', kind: 'folder', parentId: null });
  return {
    db,
    auth,
    store,
    trash,
    owner,
    viewer,
    other,
    admin,
    folder,
    doc,
    sheet,
    mine,
    tick: (n: number) => {
      time = n;
    },
  };
}
test('shared discovery orders grant time, not edits; inherited children and role changes stay predictable', () => {
  const f = fixture(),
    who = f.viewer.id;
  f.tick(2000);
  f.store.share(f.owner.id, f.folder.id, who, 'viewer');
  f.tick(3000);
  f.store.share(f.owner.id, f.sheet.id, who, 'editor');
  expect(f.store.shared(who).map((i) => i.id)[0]).toBe(f.sheet.id);
  expect(f.store.shared(who).find((i) => i.id === f.doc.id)).toMatchObject({
    sharedAt: 2000,
    ownerName: 'Original Owner',
    access: 'viewer',
  });
  f.tick(4000);
  f.store.update(f.owner.id, f.doc.id, { name: 'Edited name' });
  f.tick(5000);
  f.store.share(f.owner.id, f.folder.id, who, 'editor');
  expect(f.store.shared(who).map((i) => i.id)[0]).toBe(f.sheet.id);
  f.tick(6000);
  const child = f.store.create(f.owner.id, {
    name: 'New child',
    kind: 'doc',
    parentId: f.folder.id,
  });
  expect(f.store.shared(who)[0]).toMatchObject({ id: child.id, sharedAt: 6000 });
  expect(f.store.shared(f.owner.id)).toEqual([]);
  expect(f.store.shared(f.other.id)).toEqual([]);
  expect(() => f.store.shared(f.admin.id)).toThrow('everyday account');
  f.store.pin(who, f.doc.id);
  expect(f.store.pins(who)[0].ownerName).toBe('Original Owner');
});
test('legacy grants migrate without fabricating share dates or altering their roles', () => {
  const f = fixture();
  f.store.share(f.owner.id, f.doc.id, f.viewer.id, 'viewer');
  f.db.exec('ALTER TABLE workspace_grants DROP COLUMN shared_at');
  const migrated = new WorkspaceStore(f.auth);
  expect(migrated.shared(f.viewer.id)[0]).toMatchObject({
    id: f.doc.id,
    access: 'viewer',
    sharedAt: 0,
  });
  f.tick(9000);
  migrated.update(f.owner.id, f.doc.id, { name: 'Changed' });
  migrated.share(f.owner.id, f.doc.id, f.viewer.id, 'editor');
  expect(migrated.shared(f.viewer.id)[0].sharedAt).toBe(0);
  migrated.share(f.owner.id, f.doc.id, f.viewer.id, null);
  migrated.share(f.owner.id, f.doc.id, f.viewer.id, 'viewer');
  expect(migrated.shared(f.viewer.id)[0].sharedAt).toBe(9000);
});
test('personal filing moves one reference and removal preserves content, access, pins and the owner tree', () => {
  const f = fixture(),
    who = f.viewer.id;
  f.store.share(f.owner.id, f.folder.id, who, 'viewer');
  const original = f.store.get(f.owner.id, f.doc.id);
  f.store.pin(who, f.doc.id);
  f.store.place(who, f.doc.id, f.mine.id);
  expect(f.store.shared(who).find((i) => i.id === f.doc.id)).toMatchObject({
    placementParentId: f.mine.id,
  });
  expect(f.store.get(f.owner.id, f.doc.id)).toEqual(original);
  f.store.place(who, f.doc.id, null);
  expect(f.store.shared(who).find((i) => i.id === f.doc.id)?.placementParentId).toBeNull();
  expect(f.db.prepare('SELECT count(*) AS n FROM workspace_placements').get()?.n).toBe(1);
  f.store.place(who, f.doc.id, null, true);
  expect(f.store.shared(who).find((i) => i.id === f.doc.id)).not.toHaveProperty(
    'placementParentId',
  );
  expect(f.store.pins(who)).toHaveLength(1);
  expect(f.store.get(who, f.doc.id).access).toBe('viewer');
  expect(f.store.get(f.owner.id, f.doc.id)).toEqual(original);
  // A shared folder is a reference too; its children remain in the owner's tree.
  f.store.place(who, f.folder.id, f.mine.id);
  expect(f.store.children(who, f.folder.id).map((i) => i.id)).toEqual([f.doc.id]);
  expect(f.store.get(f.owner.id, f.folder.id).parentId).toBeNull();
});
test('placement destinations and sources enforce current access and never mutate another person references', () => {
  const f = fixture(),
    who = f.viewer.id;
  f.store.share(f.owner.id, f.doc.id, who, 'editor');
  f.store.share(f.owner.id, f.doc.id, f.other.id, 'viewer');
  f.store.place(who, f.doc.id, f.mine.id);
  f.store.place(f.other.id, f.doc.id, null);
  expect(() => f.store.place(who, f.doc.id, f.folder.id)).toThrow('not available');
  f.store.share(f.owner.id, f.folder.id, who, 'editor');
  expect(() => f.store.place(who, f.doc.id, f.folder.id)).toThrow('Only the owner');
  expect(() => f.store.place(who, f.mine.id, null)).toThrow('File a shared item');
  expect(() => f.store.place(who, f.sheet.id, null)).toThrow('not available');
  expect(() => f.store.place(f.admin.id, f.doc.id, null)).toThrow('everyday account');
  expect(() => f.store.place('guest:unknown', f.doc.id, null)).toThrow('Sign in');
  expect(() => f.store.place(who, f.doc.id, {})).toThrow('destination');
  f.store.place(who, f.doc.id, null, true);
  expect(f.store.shared(f.other.id)[0]).toHaveProperty('placementParentId', null);
});
test('revoke, inherited moves and trash clean references permanently without deleting shared originals', () => {
  const f = fixture(),
    who = f.viewer.id;
  f.store.share(f.owner.id, f.folder.id, who, 'viewer');
  f.store.share(f.owner.id, f.doc.id, who, 'viewer');
  f.store.place(who, f.doc.id, f.mine.id);
  f.store.share(f.owner.id, f.folder.id, who, null);
  expect(f.store.shared(who)[0].placementParentId).toBe(f.mine.id);
  f.store.share(f.owner.id, f.doc.id, who, null);
  expect(f.store.shared(who)).toEqual([]);
  f.store.share(f.owner.id, f.folder.id, who, 'viewer');
  expect(f.store.shared(who).find((i) => i.id === f.doc.id)).not.toHaveProperty(
    'placementParentId',
  );
  f.store.place(who, f.doc.id, f.mine.id);
  f.store.update(f.owner.id, f.doc.id, { parentId: null });
  f.store.update(f.owner.id, f.doc.id, { parentId: f.folder.id });
  expect(f.store.shared(who).find((i) => i.id === f.doc.id)).not.toHaveProperty(
    'placementParentId',
  );
  f.store.place(who, f.doc.id, f.mine.id);
  f.trash.trash(who, f.mine.id);
  f.trash.restore(who, f.mine.id);
  expect(f.store.shared(who).find((i) => i.id === f.doc.id)).not.toHaveProperty(
    'placementParentId',
  );
  expect(f.store.get(f.owner.id, f.doc.id).id).toBe(f.doc.id);
  f.store.place(who, f.doc.id, f.mine.id);
  f.trash.trash(f.owner.id, f.folder.id);
  f.trash.restore(f.owner.id, f.folder.id);
  expect(f.store.shared(who).find((i) => i.id === f.doc.id)).not.toHaveProperty(
    'placementParentId',
  );
});
