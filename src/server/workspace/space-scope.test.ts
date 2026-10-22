import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { resolveSpaceScope } from './space-scope.ts';
import type { ItemKind } from '../../shared/workspace.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Collaborator');
  const viewer = auth.createUser('Reader');
  const other = auth.createUser('Other');
  const admin = auth.createUser('Operator', true);
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  const insert = (
    kind: ItemKind | 'space',
    parentId: string | null = null,
    spaceId: string | null = null,
    ownerId = owner.id,
    position = 0,
  ) => {
    const id = randomUUID();
    db.prepare(
      `
      INSERT INTO workspace_items
        (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
      VALUES(?,?,?,?,?,0,0,?,?)
    `,
    ).run(id, ownerId, parentId, kind, kind, spaceId, spaceId ? position : null);
    return id;
  };
  const outer = insert('folder');
  const space = insert('space', outer);
  const doc = insert('doc', space, space);
  const sheet = insert('sheet', doc, space);
  const grant = (id: string, user: string, role: 'viewer' | 'editor' | null) => {
    if (role === null)
      db.prepare('DELETE FROM workspace_grants WHERE item_id=? AND user_id=?').run(id, user);
    else
      db.prepare(
        `
        INSERT INTO workspace_grants(item_id,user_id,role,shared_at) VALUES(?,?,?,0)
        ON CONFLICT(item_id,user_id) DO UPDATE SET role=excluded.role
      `,
      ).run(id, user, role);
  };
  const scope = (
    actor = owner.id,
    target = space,
    capability: 'read' | 'edit' | 'owner' = 'read',
  ) => resolveSpaceScope(auth, actor, space, target, capability);
  return {
    db,
    auth,
    owner,
    editor,
    viewer,
    other,
    admin,
    workspace,
    insert,
    outer,
    space,
    doc,
    sheet,
    grant,
    scope,
  };
}

test('Space and future children use the most generous root or outer-folder grant', () => {
  const f = fixture();
  f.grant(f.space, f.editor.id, 'viewer');
  f.grant(f.outer, f.editor.id, 'editor');
  const future = f.insert('folder', f.sheet, f.space);
  for (const id of [f.space, f.doc, f.sheet, future]) {
    expect(f.scope(f.editor.id, id).access).toBe('editor');
    expect(f.scope(f.owner.id, id)).toMatchObject({ access: 'owner', ownerId: f.owner.id });
  }
  f.grant(f.outer, f.editor.id, 'viewer');
  expect(f.scope(f.editor.id, future).access).toBe('viewer');
  f.grant(f.space, f.editor.id, 'editor');
  expect(f.scope(f.editor.id, future).access).toBe('editor');
  f.grant(f.outer, f.editor.id, null);
  f.grant(f.space, f.editor.id, null);
  expect(() => f.scope(f.editor.id, future)).toThrow('This Space is not available.');
});

test('View reads, Edit changes internal targets, and only Owner manages the outer Space', () => {
  const f = fixture();
  f.grant(f.space, f.viewer.id, 'viewer');
  f.grant(f.space, f.editor.id, 'editor');
  for (const id of [f.space, f.doc, f.sheet]) {
    expect(f.scope(f.viewer.id, id).access).toBe('viewer');
    expect(() => f.scope(f.viewer.id, id, 'edit')).toThrow('cannot edit');
    expect(f.scope(f.editor.id, id, 'edit').access).toBe('editor');
  }
  for (const user of [f.viewer.id, f.editor.id])
    expect(() => f.scope(user, f.space, 'owner')).toThrow('Only the owner');
  expect(f.scope(f.owner.id, f.space, 'owner').access).toBe('owner');
  expect(() => f.scope(f.owner.id, f.doc, 'owner')).toThrow('This Space is not available.');
});

test('malformed direct child grants cannot create or elevate Space access', () => {
  const f = fixture();
  f.grant(f.doc, f.other.id, 'editor');
  expect(() => f.scope(f.other.id, f.doc)).toThrow('This Space is not available.');
  expect(() => f.scope(f.other.id, f.sheet)).toThrow('This Space is not available.');
  f.grant(f.space, f.other.id, 'viewer');
  expect(f.scope(f.other.id, f.doc).access).toBe('viewer');
  expect(f.scope(f.other.id, f.sheet).access).toBe('viewer');
  expect(() => f.scope(f.other.id, f.sheet, 'edit')).toThrow('cannot edit');
});

test('a direct Space grant does not reveal private outer locations', () => {
  const f = fixture();
  f.grant(f.space, f.editor.id, 'editor');
  expect(f.scope(f.editor.id).space.parentId).toBeNull();
  expect(f.scope(f.editor.id, f.sheet).item.parentId).toBe(f.doc);
  expect(JSON.stringify(f.scope(f.editor.id, f.sheet))).not.toContain(f.outer);
  f.grant(f.outer, f.editor.id, 'viewer');
  expect(f.scope(f.editor.id).space.parentId).toBe(f.outer);
  expect(f.scope().space.parentId).toBe(f.outer);
});

test('the supplied Space must own the requested child even when both Spaces are readable', () => {
  const f = fixture();
  const otherSpace = f.insert('space');
  const child = f.insert('doc', otherSpace, otherSpace);
  const standalone = f.insert('sheet');
  for (const id of [otherSpace, child, standalone, randomUUID()])
    expect(() => f.scope(f.owner.id, id)).toThrow('This Space is not available.');
  expect(() => resolveSpaceScope(f.auth, f.owner.id, f.doc, f.sheet)).toThrow(
    'This Space is not available.',
  );
});

test('internal ancestry cannot cross ownership or Space membership, detach, or cycle', () => {
  const f = fixture();
  const otherSpace = f.insert('space');
  const otherChild = f.insert('folder', otherSpace, otherSpace);
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(otherChild, f.doc);
  expect(() => f.scope(f.owner.id, f.sheet)).toThrow('This Space is not available.');
  f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(f.doc);
  expect(() => f.scope(f.owner.id, f.sheet)).toThrow('This Space is not available.');
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.sheet, f.doc);
  expect(() => f.scope(f.owner.id, f.sheet)).toThrow('This Space is not available.');
  f.db
    .prepare('UPDATE workspace_items SET parent_id=?,owner_id=? WHERE id=?')
    .run(f.space, f.other.id, f.doc);
  expect(() => f.scope(f.owner.id, f.sheet)).toThrow('This Space is not available.');
});

test('outer ancestry must consist entirely of same-owner ordinary folders and be rooted', () => {
  const f = fixture();
  const foreign = f.insert('folder', null, null, f.other.id);
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(foreign, f.outer);
  expect(() => f.scope()).toThrow('This Space is not available.');
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(f.space, f.outer);
  expect(() => f.scope()).toThrow('This Space is not available.');
  f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(f.outer);
  const standaloneDoc = f.insert('doc');
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(standaloneDoc, f.space);
  expect(() => f.scope()).toThrow('This Space is not available.');
  const otherSpace = f.insert('space');
  f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(otherSpace, f.space);
  expect(() => f.scope()).toThrow('This Space is not available.');
});

test('Operator, guest, missing and disabled actors cannot resolve Space content', () => {
  const f = fixture();
  f.grant(f.space, f.editor.id, 'editor');
  expect(() => f.scope(f.admin.id)).toThrow('everyday account');
  expect(() => f.scope(`guest:${randomUUID()}`)).toThrow('This Space is not available.');
  expect(() => f.scope(randomUUID())).toThrow('Sign in');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
  expect(() => f.scope(f.editor.id, f.sheet)).toThrow('Sign in');
});

test('disabled Space owners close inherited access without changing standalone policy', () => {
  const f = fixture();
  const standalone = f.workspace.create(f.owner.id, {
    name: 'Existing',
    kind: 'doc',
    parentId: null,
  });
  f.grant(f.space, f.editor.id, 'editor');
  f.grant(standalone.id, f.editor.id, 'viewer');
  expect(f.scope(f.editor.id, f.sheet).access).toBe('editor');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.scope(f.editor.id, f.sheet)).toThrow('This Space is not available.');
  // Existing standalone history intentionally continues through active collaborators.
  expect(f.workspace.get(f.editor.id, standalone.id).access).toBe('viewer');
});

test('live access refuses a trashed Space, outer folder, internal parent or target', () => {
  const f = fixture();
  f.grant(f.space, f.editor.id, 'editor');
  for (const id of [f.outer, f.space, f.doc, f.sheet]) {
    f.db
      .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
      .run(randomUUID(), id);
    expect(() => f.scope(f.editor.id, f.sheet)).toThrow('This Space is not available.');
    expect(() => f.scope(f.owner.id, f.sheet, 'edit')).toThrow('This Space is not available.');
    f.db.prepare('UPDATE workspace_items SET trashed_at=NULL,trash_batch=NULL WHERE id=?').run(id);
  }
  expect(f.scope(f.editor.id, f.sheet).access).toBe('editor');
});

test('Docs and Sheets can contain deep children independently of names and presentation depth', () => {
  const f = fixture();
  let parent = f.doc;
  for (let depth = 0; depth < 32; depth++) {
    const child = f.insert(depth % 2 ? 'doc' : 'sheet', parent, f.space, f.owner.id, depth);
    expect(f.scope(f.owner.id, child).item).toMatchObject({
      id: child,
      parentId: parent,
      spaceId: f.space,
      position: depth,
    });
    parent = child;
  }
});

test('checks compose with the tree mutation transaction and do not cache a previous grant', () => {
  const f = fixture();
  f.grant(f.space, f.editor.id, 'editor');
  expect(f.scope(f.editor.id, f.sheet, 'edit').access).toBe('editor');
  expect(() =>
    f.auth.transaction(() => {
      f.grant(f.space, f.editor.id, 'viewer');
      f.scope(f.editor.id, f.sheet, 'edit');
    }),
  ).toThrow('cannot edit');
  expect(f.scope(f.editor.id, f.sheet, 'edit').access).toBe('editor');
  f.grant(f.space, f.editor.id, 'viewer');
  expect(() => f.scope(f.editor.id, f.sheet, 'edit')).toThrow('cannot edit');
});
