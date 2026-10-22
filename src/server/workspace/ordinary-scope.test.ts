import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { classifyOrdinaryItems, isOrdinaryItem } from './ordinary-scope.ts';
import type { ItemKind } from '../../shared/workspace.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Other');
  const workspace = new WorkspaceStore(auth);
  const create = (kind: ItemKind, parentId: string | null = null, ownerId = owner.id) =>
    workspace.create(ownerId, { kind, name: kind, parentId }).id;
  return { db, auth, owner, other, workspace, create };
}

test('legacy ordinary items need no Space migration and retain caller-specific trash/account policy', () => {
  const f = fixture();
  const folder = f.create('folder');
  const doc = f.create('doc', folder);
  expect(
    f.db
      .prepare('PRAGMA table_info(workspace_items)')
      .all()
      .map((row) => row.name),
  ).not.toContain('space_id');
  expect(isOrdinaryItem(f.db, doc)).toBe(true);
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
    .run('batch', folder);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  // Structure is reusable by Trash and by existing disabled-owner collaborator policy.
  expect(isOrdinaryItem(f.db, doc)).toBe(true);
  expect(isOrdinaryItem(f.db, folder)).toBe(true);
  expect(isOrdinaryItem(f.db, randomUUID())).toBe(false);
});

test('real Space roots, members and unmarked descendants cannot masquerade as ordinary files', () => {
  const f = fixture();
  const outer = f.create('folder');
  const ordinary = f.create('sheet', outer);
  migrateSpaceSchema(f.db);
  const insert = (kind: ItemKind | 'space', parent: string, spaceId: string | null = null) => {
    const id = randomUUID();
    f.db
      .prepare(
        `INSERT INTO workspace_items
       (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
       VALUES(?,?,?,?,?,0,0,?,?)`,
      )
      .run(id, f.owner.id, parent, kind, 'Hidden', spaceId, spaceId ? 0 : null);
    return id;
  };
  const space = insert('space', outer);
  const member = insert('folder', space, space);
  const unmarked = insert('folder', space);
  const malformed = insert('doc', unmarked);
  const belowMember = insert('sheet', member);
  for (const id of [space, member, unmarked, malformed, belowMember])
    expect(isOrdinaryItem(f.db, id)).toBe(false);
  expect(isOrdinaryItem(f.db, outer)).toBe(true);
  expect(isOrdinaryItem(f.db, ordinary)).toBe(true);
  f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(member);
  expect(isOrdinaryItem(f.db, member)).toBe(false);
});

test('ordinary ancestry must reach a same-owner folder root without cycles or missing parents', () => {
  const f = fixture();
  const root = f.create('folder');
  const middle = f.create('folder', root);
  const doc = f.create('doc', middle);
  const foreign = f.create('folder', null, f.other.id);
  const nonfolder = f.create('sheet');
  for (const parent of [foreign, nonfolder, middle, doc]) {
    f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(parent, root);
    expect(isOrdinaryItem(f.db, doc)).toBe(false);
    f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(root);
  }
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(randomUUID(), root);
  f.db.exec('PRAGMA foreign_keys=ON');
  expect(isOrdinaryItem(f.db, doc)).toBe(false);
  f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(root);
  expect(isOrdinaryItem(f.db, doc)).toBe(true);
});

test('either nonnull membership marker refuses access even in an incomplete additive schema', () => {
  const f = fixture();
  const doc = f.create('doc');
  f.db.exec('ALTER TABLE workspace_items ADD COLUMN space_position INTEGER');
  expect(isOrdinaryItem(f.db, doc)).toBe(true);
  f.db.prepare('UPDATE workspace_items SET space_position=0 WHERE id=?').run(doc);
  expect(isOrdinaryItem(f.db, doc)).toBe(false);
  f.db.prepare('UPDATE workspace_items SET space_position=NULL WHERE id=?').run(doc);
  f.db.exec('ALTER TABLE workspace_items ADD COLUMN space_id TEXT');
  f.db.prepare('UPDATE workspace_items SET space_id=? WHERE id=?').run(randomUUID(), doc);
  expect(isOrdinaryItem(f.db, doc)).toBe(false);
  f.db.prepare('UPDATE workspace_items SET space_id=NULL WHERE id=?').run(doc);
  expect(isOrdinaryItem(f.db, doc)).toBe(true);
});

test('a deeper ordinary folder tree stays ordinary, and a later malformed edge is rechecked', () => {
  const f = fixture();
  const root = f.create('folder');
  let parent = root;
  for (let depth = 0; depth < 32; depth++) parent = f.create('folder', parent);
  const doc = f.create('doc', parent);
  expect(isOrdinaryItem(f.db, doc)).toBe(true);
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(parent, root);
  expect(isOrdinaryItem(f.db, doc)).toBe(false);
});

test('batch classification shares ancestry while preserving owner and parent-kind boundaries', () => {
  const f = fixture();
  const folder = f.create('folder');
  const doc = f.create('doc', folder);
  const sheet = f.create('sheet', folder);
  const invalidChild = f.create('folder');
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(doc, invalidChild);
  const foreign = f.create('folder', null, f.other.id);
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(folder, foreign);
  const ids = [doc, sheet, folder, invalidChild, foreign];
  expect(classifyOrdinaryItems(f.db, ids)).toEqual(new Set([doc, sheet, folder]));
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(doc, folder);
  expect(classifyOrdinaryItems(f.db, ids)).toEqual(new Set());
  f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(folder);
  expect(classifyOrdinaryItems(f.db, ids)).toEqual(new Set([doc, sheet, folder]));
  // A request larger than the shared budget cannot return a partially admitted set.
  expect(
    classifyOrdinaryItems(
      f.db,
      Array.from({ length: 10_001 }, () => doc),
    ),
  ).toBeUndefined();
});
