import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceFiles } from './files.ts';
import { WorkspaceSearch } from './search.ts';
import { SpaceStore } from './spaces.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { DocumentStore } from './documents.ts';
import { parseSearch } from '../../shared/search.ts';
import { searchWithinScope } from '../../shared/searchScope.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  databases.push(db);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const files = new WorkspaceFiles(workspace);
  const owner = auth.createUser('Owner');
  const reader = auth.createUser('Reader');
  const other = auth.createUser('Other');
  const operator = auth.createUser('Operator', true);
  const folder = files.create(owner.id, { name: 'Plans', kind: 'folder', parentId: null });
  const doc = files.create(owner.id, { name: 'Journey notes', kind: 'doc', parentId: folder.id });
  files.share(owner.id, folder.id, reader.id, 'editor');
  files.share(owner.id, folder.id, other.id, 'viewer');
  return { db, auth, workspace, files, owner, reader, other, operator, folder, doc };
}

test('hiding is persistent personal discovery, preserving grants, filing and readable contents', () => {
  const f = fixture();
  f.files.place(f.reader.id, f.doc.id, null);
  const documents = new DocumentStore(f.workspace);
  const contents = documents.load(f.reader.id, f.doc.id);
  const protectedRows = () => ({
    items: f.db.prepare('SELECT * FROM workspace_items ORDER BY id').all(),
    grants: f.db.prepare('SELECT * FROM workspace_grants ORDER BY item_id,user_id').all(),
    placements: f.db.prepare('SELECT * FROM workspace_placements ORDER BY item_id,user_id').all(),
    snapshots: f.db.prepare('SELECT * FROM doc_snapshots ORDER BY item_id').all(),
  });
  const before = protectedRows();
  const inventory = f.files.setHidden(f.reader.id, f.doc.id, true);
  expect(inventory.find((item) => item.id === f.doc.id)).toMatchObject({
    hidden: true,
    placementParentId: null,
    access: 'editor',
  });
  expect(f.files.shared(f.reader.id).map((item) => item.id)).not.toContain(f.doc.id);
  expect(f.workspace.shared(f.reader.id).map((item) => item.id)).not.toContain(f.doc.id);
  expect(f.files.find(f.reader.id, { q: f.doc.name })).toEqual([]);
  expect(new WorkspaceSearch(f.workspace).find(f.reader.id, { q: f.doc.name })).toEqual([]);
  expect(f.files.find(f.other.id, { q: f.doc.name })).toHaveLength(1);
  expect(f.files.find(f.owner.id, { q: f.doc.name })).toHaveLength(1);
  expect(f.files.get(f.reader.id, f.doc.id).access).toBe('editor');
  expect(documents.load(f.reader.id, f.doc.id)).toEqual(contents);
  // Hiding one outer file neither recursively hides children nor removes its
  // canonical folder membership or personal filed reference.
  expect(f.files.children(f.reader.id, f.folder.id).map((item) => item.id)).toContain(f.doc.id);
  expect(protectedRows()).toEqual(before);
  const reopened = new WorkspaceFiles(new WorkspaceStore(f.auth, { spacesEnabled: true }));
  expect(reopened.shared(f.reader.id, true).find((item) => item.id === f.doc.id)?.hidden).toBe(
    true,
  );
  expect(reopened.setHidden(f.reader.id, f.doc.id, true)).toEqual(inventory);
  const shown = reopened.setHidden(f.reader.id, f.doc.id, false);
  expect(shown.find((item) => item.id === f.doc.id)?.hidden).toBeUndefined();
  expect(reopened.find(f.reader.id, { q: f.doc.name })).toHaveLength(1);
  expect(protectedRows()).toEqual(before);
});

test('hidden inventories never grant revoked access or permit writes for another account', () => {
  const f = fixture();
  const outsider = f.auth.createUser('Outsider');
  for (const user of [f.owner.id, f.operator.id, outsider.id, 'guest:unregistered'])
    expect(() => f.files.setHidden(user, f.doc.id, true)).toThrow();
  for (const value of [null, 1, 'true', {}, undefined])
    expect(() => f.files.setHidden(f.reader.id, f.doc.id, value)).toThrow('Choose Hide or Show');
  expect(f.db.prepare('SELECT * FROM workspace_hidden').all()).toEqual([]);
  f.files.setHidden(f.reader.id, f.doc.id, true);
  f.files.share(f.owner.id, f.folder.id, f.reader.id, null);
  expect(f.files.shared(f.reader.id, true)).toEqual([]);
  expect(() => f.files.get(f.reader.id, f.doc.id)).toThrow('not available');
  expect(() => f.files.setHidden(f.reader.id, f.doc.id, false)).toThrow('not available');
  expect(f.files.shared(f.other.id).map((item) => item.id)).toContain(f.doc.id);
});

test('a hidden folder stays a traversal node for its independently visible children', () => {
  const f = fixture();
  f.files.setHidden(f.reader.id, f.folder.id, true);
  expect(f.files.shared(f.reader.id).map((item) => item.id)).toEqual([f.doc.id]);
  expect(f.files.find(f.reader.id, { q: 'Plans' }).map((item) => item.id)).toEqual([f.doc.id]);
  expect(
    new WorkspaceSearch(f.workspace).find(f.reader.id, { q: 'Plans' }).map((item) => item.id),
  ).toEqual([f.doc.id]);
  const catalog = f.files.searchCatalog(f.reader.id);
  expect(catalog.find((item) => item.id === f.folder.id)?.hidden).toBe(true);
  expect(
    searchWithinScope(catalog, parseSearch({}), { kind: 'folder', id: f.folder.id }, 0).map(
      (item) => item.id,
    ),
  ).toEqual([f.doc.id]);
});

test('Space hiding applies only to its outer file and leaves native pages accessible', () => {
  const f = fixture();
  const spaces = new SpaceStore(f.workspace);
  const root = f.files.create(f.owner.id, {
    name: 'Trip Space',
    kind: 'space',
    parentId: f.folder.id,
  });
  const child = spaces.createChild(f.owner.id, root.id, {
    name: 'Daily notes',
    kind: 'doc',
    parentId: root.id,
  }).item;
  const previous = spaces.get(f.reader.id, root.id, child.id);
  f.files.place(f.reader.id, root.id, null);
  f.files.setHidden(f.reader.id, root.id, true);
  expect(f.files.shared(f.reader.id).map((item) => item.id)).not.toContain(root.id);
  expect(f.files.shared(f.reader.id, true).find((item) => item.id === root.id)).toMatchObject({
    hidden: true,
    placementParentId: null,
    kind: 'space',
  });
  expect(f.files.find(f.reader.id, { type: 'space' })).toEqual([]);
  expect(spaces.get(f.reader.id, root.id, child.id)).toEqual(previous);
  for (const hidden of [true, false])
    expect(() => f.files.setHidden(f.reader.id, child.id, hidden)).toThrow('not available');
  expect(f.db.prepare('SELECT item_id FROM workspace_hidden').all()).toEqual([
    { item_id: root.id },
  ]);
  expect(
    f.files.setHidden(f.reader.id, root.id, false).find((item) => item.id === root.id)?.hidden,
  ).toBeUndefined();
  expect(f.files.find(f.reader.id, { type: 'space' }).map((item) => item.id)).toEqual([root.id]);
});
