import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceSearch } from './search.ts';
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
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const other = auth.createUser('Other');
  const workspace = new WorkspaceStore(auth);
  const outer = workspace.create(owner.id, {
    name: 'Ordinary folder',
    kind: 'folder',
    parentId: null,
  });
  const ordinary = workspace.create(owner.id, {
    name: 'Ordinary document',
    kind: 'doc',
    parentId: outer.id,
  });
  workspace.share(owner.id, outer.id, editor.id, 'editor');
  workspace.share(owner.id, outer.id, viewer.id, 'viewer');
  migrateSpaceSchema(db);
  const insert = (
    kind: ItemKind | 'space',
    parentId: string | null,
    spaceId: string | null = null,
    ownerId = owner.id,
  ) => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO workspace_items
       (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
       VALUES(?,?,?,?,?,0,0,?,?)`,
    ).run(id, ownerId, parentId, kind, `Hidden ${kind}`, spaceId, spaceId ? 0 : null);
    return id;
  };
  const space = insert('space', outer.id);
  const folder = insert('folder', space, space);
  const doc = insert('doc', folder, space);
  const sheet = insert('sheet', doc, space);
  // A malformed row without membership markers must not become a public escape.
  const unmarked = insert('folder', space);
  const malformed = insert('sheet', unmarked);
  const hidden = [space, folder, doc, sheet, unmarked, malformed];
  const grant = (id: string, userId: string, role: 'viewer' | 'editor') =>
    db
      .prepare('INSERT INTO workspace_grants(item_id,user_id,role,shared_at) VALUES(?,?,?,0)')
      .run(id, userId, role);
  grant(space, editor.id, 'editor');
  grant(doc, other.id, 'editor');
  grant(malformed, other.id, 'viewer');
  const state = () => ({
    items: db.prepare('SELECT * FROM workspace_items ORDER BY id').all(),
    grants: db.prepare('SELECT * FROM workspace_grants ORDER BY item_id,user_id').all(),
    placements: db.prepare('SELECT * FROM workspace_placements ORDER BY item_id,user_id').all(),
    tags: db.prepare('SELECT * FROM workspace_tags ORDER BY user_id,name').all(),
    assignments: db
      .prepare('SELECT * FROM workspace_tag_assignments ORDER BY user_id,item_id,name')
      .all(),
  });
  return {
    db,
    auth,
    owner,
    editor,
    viewer,
    other,
    workspace,
    outer,
    ordinary,
    space,
    folder,
    doc,
    sheet,
    unmarked,
    malformed,
    hidden,
    insert,
    grant,
    state,
    search: new WorkspaceSearch(workspace),
  };
}

test('ordinary direct-ID APIs refuse Spaces and members regardless of owner, inheritance or child grants', () => {
  const f = fixture();
  expect(resolveSpaceScope(f.auth, f.editor.id, f.space, f.sheet).access).toBe('editor');
  for (const actor of [f.owner.id, f.editor.id, f.viewer.id, f.other.id]) {
    for (const id of f.hidden) {
      for (const needed of ['read', 'edit', 'owner'] as const)
        expect(() => f.workspace.get(actor, id, needed)).toThrow('This item is not available.');
      expect(() => f.workspace.children(actor, id)).toThrow('This item is not available.');
      expect(() => f.workspace.ancestors(actor, id)).toThrow('This item is not available.');
      expect(() => f.workspace.ownTags(actor, id)).toThrow('This item is not available.');
    }
  }
  expect(f.workspace.get(f.editor.id, f.ordinary.id).access).toBe('editor');
});

test('ordinary discovery, children and search skip hidden rows without losing accessible siblings', () => {
  const f = fixture();
  const ordinaryIds = [f.outer.id, f.ordinary.id].sort();
  expect(
    f.workspace
      .list(f.owner.id)
      .map((item) => item.id)
      .sort(),
  ).toEqual(ordinaryIds);
  expect(f.workspace.list(f.editor.id)).toEqual([]);
  expect(
    f.workspace
      .shared(f.editor.id)
      .map((item) => item.id)
      .sort(),
  ).toEqual(ordinaryIds);
  expect(f.workspace.shared(f.other.id)).toEqual([]);
  for (const actor of [f.owner.id, f.editor.id, f.viewer.id]) {
    expect(f.workspace.children(actor, f.outer.id).map((item) => item.id)).toEqual([f.ordinary.id]);
    expect(f.search.find(actor, { q: 'Hidden' })).toEqual([]);
    expect(
      f.search
        .find(actor, {})
        .map((item) => item.id)
        .sort(),
    ).toEqual(ordinaryIds);
    const catalog = JSON.stringify(f.search.find(actor, {}));
    for (const id of f.hidden) expect(catalog).not.toContain(id);
  }
});

test('ordinary metadata, sharing, tags, moves and creation cannot modify or extract a hidden item', () => {
  const f = fixture();
  const before = f.state();
  for (const id of f.hidden) {
    for (const action of [
      () => f.workspace.sharing(f.owner.id, id),
      () => f.workspace.share(f.owner.id, id, f.viewer.id, 'editor'),
      () => f.workspace.share(f.owner.id, id, f.other.id, null),
      () => f.workspace.changeTag(f.owner.id, id, 'must-not-save'),
      () => f.workspace.changeTag(f.owner.id, id, 'must-not-remove', true),
      () => f.workspace.update(f.owner.id, id, { name: 'Must not rename', parentId: null }),
      () => f.workspace.parent(f.owner.id, id),
      () => f.workspace.create(f.owner.id, { name: 'Must not create', kind: 'doc', parentId: id }),
      () => f.workspace.update(f.owner.id, f.ordinary.id, { name: 'Must not move', parentId: id }),
      () => f.workspace.place(f.editor.id, id, null),
      () => f.workspace.place(f.editor.id, id, null, true),
    ])
      expect(action).toThrow('This item is not available.');
  }
  expect(() =>
    f.workspace.create(f.owner.id, { name: 'Must not create', kind: 'space', parentId: null }),
  ).toThrow('Choose Folder, Sheet or Doc.');
  expect(f.state()).toEqual(before);
});

test('hidden filing sources and destinations cannot leak via stale personal placements', () => {
  const f = fixture();
  const destination = f.workspace.create(f.editor.id, {
    name: 'My folder',
    kind: 'folder',
    parentId: null,
  });
  const privateSpace = f.insert('space', null, null, f.editor.id);
  const privateFolder = f.insert('folder', privateSpace, privateSpace, f.editor.id);
  for (const id of [privateSpace, privateFolder])
    expect(() => f.workspace.place(f.editor.id, f.ordinary.id, id)).toThrow(
      'This item is not available.',
    );
  const insert = f.db.prepare(
    'INSERT INTO workspace_placements(user_id,item_id,parent_id) VALUES(?,?,?)',
  );
  insert.run(f.editor.id, f.doc, destination.id);
  insert.run(f.editor.id, f.ordinary.id, privateFolder);
  insert.run(f.viewer.id, f.ordinary.id, null);
  const before = f.state();
  expect(() => f.workspace.place(f.editor.id, f.doc, null, true)).toThrow(
    'This item is not available.',
  );
  expect(f.state()).toEqual(before);
  const shared = f.workspace.shared(f.editor.id);
  expect(shared.map((item) => item.id).sort()).toEqual([f.outer.id, f.ordinary.id].sort());
  expect(shared.find((item) => item.id === f.ordinary.id)).not.toHaveProperty('placementParentId');
  expect(f.db.prepare('SELECT user_id,item_id,parent_id FROM workspace_placements').all()).toEqual([
    { user_id: f.viewer.id, item_id: f.ordinary.id, parent_id: null },
  ]);
});

test('hidden-only tags stay out of suggestions while ordinary personal vocabulary survives revocation', () => {
  const f = fixture();
  f.workspace.changeTag(f.editor.id, f.ordinary.id, 'ordinary-tag');
  f.workspace.changeTag(f.editor.id, f.ordinary.id, 'reusable-tag');
  f.workspace.changeTag(f.editor.id, f.ordinary.id, 'reusable-tag', true);
  const label = f.db.prepare('INSERT OR IGNORE INTO workspace_tags(user_id,name) VALUES(?,?)');
  const assignment = f.db.prepare(
    'INSERT INTO workspace_tag_assignments(user_id,item_id,name) VALUES(?,?,?)',
  );
  for (const [id, name] of [
    [f.doc, 'hidden-only'],
    [f.malformed, 'hidden-malformed'],
    [f.sheet, 'ordinary-tag'],
  ]) {
    label.run(f.editor.id, name);
    assignment.run(f.editor.id, id, name);
  }
  expect(f.workspace.tagSuggestions(f.editor.id)).toEqual(['ordinary-tag', 'reusable-tag']);
  expect(f.search.find(f.editor.id, { q: 'hidden-only' })).toEqual([]);
  expect(f.search.find(f.editor.id, { tag: 'hidden-malformed' })).toEqual([]);
  f.workspace.share(f.owner.id, f.outer.id, f.editor.id, null);
  // Decision #62 preserves personal vocabulary after ordinary access is revoked.
  expect(f.workspace.tagSuggestions(f.editor.id)).toEqual(['ordinary-tag', 'reusable-tag']);
});

test('ordinary collaborators retain disabled-owner access while hidden IDs stay closed', () => {
  const f = fixture();
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(f.workspace.get(f.editor.id, f.ordinary.id, 'edit').access).toBe('editor');
  expect(
    f.workspace
      .shared(f.viewer.id)
      .map((item) => item.id)
      .sort(),
  ).toEqual([f.outer.id, f.ordinary.id].sort());
  expect(f.search.find(f.editor.id, { q: 'Ordinary document' }).map((item) => item.id)).toEqual([
    f.ordinary.id,
  ]);
  for (const id of f.hidden)
    expect(() => f.workspace.get(f.editor.id, id)).toThrow('This item is not available.');
  expect(() => f.workspace.list(f.owner.id)).toThrow('Sign in');
});

test('a direct grant cannot authorize corrupt ordinary ancestry or make discovery fail wholesale', () => {
  const f = fixture();
  const invalid = f.workspace.create(f.owner.id, {
    name: 'Invalid',
    kind: 'doc',
    parentId: f.outer.id,
  });
  const foreign = f.workspace.create(f.other.id, {
    name: 'Foreign folder',
    kind: 'folder',
    parentId: null,
  });
  f.grant(invalid.id, f.editor.id, 'editor');
  for (const parent of [f.space, f.folder, f.unmarked, f.ordinary.id, foreign.id, invalid.id]) {
    f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(parent, invalid.id);
    expect(() => f.workspace.get(f.owner.id, invalid.id)).toThrow('This item is not available.');
    expect(() => f.workspace.get(f.editor.id, invalid.id)).toThrow('This item is not available.');
    expect(
      f.workspace
        .list(f.owner.id)
        .map((item) => item.id)
        .sort(),
    ).toEqual([f.outer.id, f.ordinary.id].sort());
    expect(
      f.workspace
        .shared(f.editor.id)
        .map((item) => item.id)
        .sort(),
    ).toEqual([f.outer.id, f.ordinary.id].sort());
    expect(f.workspace.children(f.editor.id, f.outer.id).map((item) => item.id)).toEqual([
      f.ordinary.id,
    ]);
  }
});

test('ordinary access never caches an earlier classification across membership changes', () => {
  const f = fixture();
  expect(f.workspace.get(f.editor.id, f.ordinary.id).access).toBe('editor');
  // Simulate a malformed imported record, not a supported conversion operation.
  f.db
    .prepare('UPDATE workspace_items SET parent_id=?,space_id=?,space_position=0 WHERE id=?')
    .run(f.folder, f.space, f.ordinary.id);
  expect(() => f.workspace.get(f.editor.id, f.ordinary.id)).toThrow('This item is not available.');
  expect(f.workspace.list(f.owner.id).map((item) => item.id)).toEqual([f.outer.id]);
  expect(f.workspace.shared(f.editor.id).map((item) => item.id)).toEqual([f.outer.id]);
  f.db
    .prepare('UPDATE workspace_items SET parent_id=?,space_id=NULL,space_position=NULL WHERE id=?')
    .run(f.outer.id, f.ordinary.id);
  expect(f.workspace.get(f.editor.id, f.ordinary.id).access).toBe('editor');
});
