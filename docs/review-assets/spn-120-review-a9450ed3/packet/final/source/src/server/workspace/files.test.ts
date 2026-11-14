import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceFiles } from './files.ts';
import { SpaceStore } from './spaces.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { TrashStore } from './trash.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function fixture(enabled = true) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: enabled });
  migrateSpaceSchema(db);
  const files = new WorkspaceFiles(workspace);
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Collaborator');
  const admin = auth.createUser('Operator', true);
  const outer = workspace.create(owner.id, {
    name: 'Private outer',
    kind: 'folder',
    parentId: null,
  });
  const root = spaces.createRoot(owner.id, { name: 'Project', parentId: outer.id }).space;
  const child = spaces.createChild(owner.id, root.id, {
    name: 'Secret child',
    kind: 'doc',
    parentId: root.id,
  }).item;
  const internal = spaces.createChild(owner.id, root.id, {
    name: 'Private internal folder',
    kind: 'folder',
    parentId: root.id,
  }).item;
  return { db, auth, workspace, files, spaces, owner, other, admin, outer, root, child, internal };
}

test('outer catalogs expose exactly one Space file while ordinary/native lookups remain closed', () => {
  const f = fixture();
  expect(
    f.files
      .list(f.owner.id)
      .map((item) => item.id)
      .sort(),
  ).toEqual([f.outer.id, f.root.id].sort());
  expect(f.files.children(f.owner.id, f.outer.id)).toEqual([
    expect.objectContaining({ id: f.root.id, kind: 'space' }),
  ]);
  expect(f.files.children(f.owner.id, f.root.id)).toEqual([]);
  expect(f.files.ancestors(f.owner.id, f.root.id)).toEqual([
    f.workspace.get(f.owner.id, f.outer.id),
  ]);
  expect(f.files.find(f.owner.id, { type: 'space' })).toEqual([
    expect.objectContaining({ id: f.root.id, kind: 'space', paths: ['Private outer'] }),
  ]);
  expect(f.files.find(f.owner.id, { q: 'Secret child' })).toEqual([]);
  for (const id of [f.root.id, f.child.id, f.internal.id])
    expect(() => f.workspace.get(f.owner.id, id)).toThrow('not available');
  for (const id of [f.child.id, f.internal.id]) {
    expect(() => f.files.get(f.owner.id, id)).toThrow('not available');
    expect(() => f.files.changeTag(f.owner.id, id, 'hidden')).toThrow('not available');
  }
});

test('direct root sharing redacts outer locations and grants current root roles without child discovery', () => {
  const f = fixture();
  f.files.share(f.owner.id, f.root.id, f.other.id, 'viewer');
  const shared = f.files.shared(f.other.id);
  expect(shared).toEqual([
    expect.objectContaining({
      id: f.root.id,
      access: 'viewer',
      parentId: null,
      ownerName: 'Owner',
    }),
  ]);
  expect(JSON.stringify(shared)).not.toContain(f.outer.id);
  expect(JSON.stringify(shared)).not.toContain(f.child.name);
  expect(f.files.ancestors(f.other.id, f.root.id)).toEqual([]);
  f.workspace.share(f.owner.id, f.outer.id, f.other.id, 'editor');
  expect(f.files.get(f.other.id, f.root.id)).toMatchObject({
    access: 'editor',
    parentId: f.outer.id,
  });
  expect(f.files.sharing(f.owner.id, f.root.id)).toEqual([
    expect.objectContaining({ id: f.other.id, directRole: 'viewer', effectiveRole: 'editor' }),
  ]);
  expect(f.files.children(f.other.id, f.outer.id).map((item) => item.id)).toEqual([f.root.id]);
  expect(f.workspace.shared(f.other.id).map((item) => item.id)).toEqual([f.outer.id]);
  for (const actor of [f.other.id, f.admin.id, 'guest:unregistered']) {
    expect(() => f.files.update(actor, f.root.id, { name: 'Denied' })).toThrow();
    expect(() => f.files.sharing(actor, f.root.id)).toThrow();
  }
  f.workspace.share(f.owner.id, f.outer.id, f.other.id, null);
  expect(f.files.get(f.other.id, f.root.id).access).toBe('viewer');
  f.files.share(f.owner.id, f.root.id, f.other.id, null);
  expect(f.files.shared(f.other.id)).toEqual([]);
  expect(() => f.files.get(f.other.id, f.root.id)).toThrow('not available');
});

test.each([
  ['editor', 'viewer', 'editor'],
  ['viewer', 'viewer', 'viewer'],
  ['viewer', 'admin', 'admin'],
] as const)(
  'Space sharing previews direct %s and inherited %s before direct removal',
  (direct, inherited, effective) => {
    const f = fixture();
    f.workspace.share(f.owner.id, f.outer.id, f.other.id, inherited);
    f.files.share(f.owner.id, f.root.id, f.other.id, direct);
    const grants = () =>
      f.db.prepare('SELECT * FROM workspace_grants ORDER BY item_id,user_id').all();
    const before = grants();
    const preview = f.files.sharing(f.owner.id, f.root.id)[0];
    expect(preview).toMatchObject({
      id: f.other.id,
      directRole: direct,
      effectiveRole: effective,
      inheritedRole: inherited,
    });
    expect(grants()).toEqual(before);
    expect(f.files.share(f.owner.id, f.root.id, f.other.id, null)[0]).toMatchObject({
      directRole: null,
      effectiveRole: preview.inheritedRole,
      inheritedRole: preview.inheritedRole,
    });
    expect(f.files.get(f.other.id, f.root.id).access).toBe(preview.inheritedRole);
    expect(f.spaces.get(f.other.id, f.root.id, f.child.id).access).toBe(preview.inheritedRole);
  },
);

test('Space inherited previews reveal no private locations and never use child grants or disabled access', () => {
  const f = fixture();
  const delegate = f.auth.createUser('File admin');
  f.files.share(f.owner.id, f.root.id, delegate.id, 'admin');
  f.workspace.share(f.owner.id, f.outer.id, f.other.id, 'viewer');
  f.files.share(f.owner.id, f.root.id, f.other.id, 'editor');
  expect(f.files.get(delegate.id, f.root.id).parentId).toBeNull();
  const preview = f.files.sharing(delegate.id, f.root.id);
  expect(preview).toEqual([
    {
      id: f.other.id,
      name: f.other.name,
      disabled: 0,
      directRole: 'editor',
      effectiveRole: 'editor',
      inheritedRole: 'viewer',
    },
  ]);
  for (const secret of [f.outer.id, f.outer.name, f.child.id, f.child.name])
    expect(JSON.stringify(preview)).not.toContain(secret);
  // A stale or imported internal grant does not affect the outer sharing boundary.
  f.db
    .prepare('INSERT INTO workspace_grants(item_id,user_id,role,shared_at) VALUES(?,?,?,?)')
    .run(f.child.id, f.other.id, 'admin', 1);
  f.workspace.share(f.owner.id, f.outer.id, f.other.id, null);
  expect(f.files.sharing(delegate.id, f.root.id)[0]).toMatchObject({
    directRole: 'editor',
    effectiveRole: 'editor',
    inheritedRole: null,
  });
  f.files.share(f.owner.id, f.root.id, f.other.id, null);
  expect(f.files.sharing(delegate.id, f.root.id)[0]).toMatchObject({
    directRole: null,
    effectiveRole: null,
    inheritedRole: null,
  });
  for (const id of [f.child.id, f.internal.id])
    expect(() => f.files.sharing(f.owner.id, id)).toThrow('not available');
  f.workspace.share(f.owner.id, f.outer.id, f.other.id, 'viewer');
  f.files.share(f.owner.id, f.root.id, f.other.id, 'editor');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.other.id);
  expect(f.files.sharing(delegate.id, f.root.id)[0]).toMatchObject({
    disabled: 1,
    directRole: 'editor',
    effectiveRole: null,
    inheritedRole: null,
  });
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.files.sharing(delegate.id, f.root.id)).toThrow('not available');
});

test('root filing survives ordinary cleanup, never moves the canonical root, and disappears on revocation', () => {
  const f = fixture();
  const destination = f.workspace.create(f.other.id, {
    name: 'My references',
    kind: 'folder',
    parentId: null,
  });
  f.files.share(f.owner.id, f.root.id, f.other.id, 'editor');
  f.files.place(f.other.id, f.root.id, destination.id);
  f.workspace.shared(f.other.id);
  f.workspace.update(f.other.id, destination.id, { name: 'Renamed reference folder' });
  f.workspace.cleanPlacements();
  expect(f.files.shared(f.other.id)[0].placementParentId).toBe(destination.id);
  expect(f.files.get(f.owner.id, f.root.id).parentId).toBe(f.outer.id);
  expect(f.files.find(f.other.id, { type: 'space' })[0].paths).toEqual([
    'Renamed reference folder',
  ]);
  expect(() => f.files.place(f.other.id, f.root.id, f.outer.id)).toThrow();
  expect(() => f.files.place(f.other.id, f.root.id, f.internal.id)).toThrow();
  f.files.place(f.other.id, f.root.id, null, true);
  expect(f.files.shared(f.other.id)[0].placementParentId).toBeUndefined();
  f.files.place(f.other.id, f.root.id, null);
  expect(f.files.shared(f.other.id)[0].placementParentId).toBeNull();
  f.files.share(f.owner.id, f.root.id, f.other.id, null);
  expect(f.db.prepare('SELECT * FROM workspace_placements WHERE item_id=?').all(f.root.id)).toEqual(
    [],
  );
});

test('Space creation admits editable shared folders while canonical moves preserve owner boundaries; root tags remain personal', () => {
  const f = fixture();
  const foreign = f.workspace.create(f.other.id, {
    name: 'Shared destination',
    kind: 'folder',
    parentId: null,
  });
  f.workspace.share(f.other.id, foreign.id, f.owner.id, 'editor');
  const shared = f.files.create(f.owner.id, {
    kind: 'space',
    name: 'Shared Space',
    parentId: foreign.id,
  });
  expect(shared).toMatchObject({
    access: 'editor',
    parentId: foreign.id,
    ownerName: f.other.name,
    createdByName: f.owner.name,
  });
  expect(f.workspace.fileOwner(shared.id)).toBe(f.other.id);
  expect(() => f.files.update(f.owner.id, f.root.id, { parentId: foreign.id })).toThrow();
  for (const parentId of [f.root.id, f.internal.id, f.child.id]) {
    expect(() => f.files.create(f.owner.id, { kind: 'space', name: 'Denied', parentId })).toThrow();
    expect(() => f.files.update(f.owner.id, f.root.id, { parentId })).toThrow();
  }
  const root = f.files.create(f.owner.id, { kind: 'space', name: 'New Space', parentId: null });
  expect(root).toMatchObject({ kind: 'space', parentId: null, access: 'owner', tags: [] });
  expect(
    f.files.update(f.owner.id, root.id, { parentId: f.outer.id, name: 'Moved Space' }),
  ).toMatchObject({ parentId: f.outer.id, name: 'Moved Space' });
  f.files.share(f.owner.id, f.root.id, f.other.id, 'viewer');
  f.files.changeTag(f.owner.id, f.root.id, 'Owner-only tag');
  f.files.changeTag(f.other.id, f.root.id, 'Reader tag');
  expect(f.files.get(f.owner.id, f.root.id).tags).toEqual(['owner-only tag']);
  expect(f.files.get(f.other.id, f.root.id).tags).toEqual(['reader tag']);
  expect(f.files.tagSuggestions(f.other.id)).toEqual(['reader tag']);
  expect(f.files.find(f.other.id, { tag: 'Owner-only tag' })).toEqual([]);
  expect(f.files.find(f.other.id, { tag: 'Reader tag' }).map((item) => item.id)).toEqual([
    f.root.id,
  ]);
  expect(() => f.workspace.ownTags(f.owner.id, f.root.id)).toThrow('not available');
});

test('preactivation and disabled accounts never acquire an outer Space fallback', () => {
  const f = fixture(false);
  f.spaces.share(f.owner.id, f.root.id, f.other.id, 'viewer');
  expect(f.files.list(f.owner.id)).toEqual([f.workspace.get(f.owner.id, f.outer.id)]);
  expect(f.files.shared(f.other.id)).toEqual([]);
  expect(f.files.find(f.owner.id, { type: 'space' })).toEqual([]);
  expect(() => f.files.get(f.owner.id, f.root.id)).toThrow('not available');
  expect(() =>
    f.files.create(f.owner.id, { name: 'Denied', kind: 'space', parentId: null }),
  ).toThrow('not available');
  expect(() => f.files.changeTag(f.owner.id, f.root.id, 'Denied')).toThrow('not available');
  const live = fixture();
  live.files.share(live.owner.id, live.root.id, live.other.id, 'viewer');
  live.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(live.owner.id);
  expect(live.files.shared(live.other.id)).toEqual([]);
  expect(() => live.files.get(live.other.id, live.root.id)).toThrow();
  expect(() => live.files.get(live.admin.id, live.root.id)).toThrow('everyday');
});

test('disabling Spaces preserves dormant personal filing through unrelated ordinary operations', () => {
  const f = fixture();
  const destination = f.workspace.create(f.other.id, {
    kind: 'folder',
    name: 'References',
    parentId: null,
  });
  f.files.share(f.owner.id, f.root.id, f.other.id, 'viewer');
  f.files.place(f.other.id, f.root.id, destination.id);
  const before = f.db.prepare('SELECT * FROM workspace_placements WHERE item_id=?').all(f.root.id);
  const disabled = new WorkspaceStore(f.auth, { spacesEnabled: false });
  expect(disabled.shared(f.other.id)).toEqual([]);
  disabled.update(f.other.id, destination.id, { name: 'Renamed while Spaces disabled' });
  disabled.cleanPlacements();
  expect(f.db.prepare('SELECT * FROM workspace_placements WHERE item_id=?').all(f.root.id)).toEqual(
    before,
  );
  const hidden = new WorkspaceFiles(disabled);
  expect(hidden.shared(f.other.id)).toEqual([]);
  for (const id of [f.root.id, f.child.id, f.internal.id]) {
    expect(() => hidden.get(f.other.id, id)).toThrow('not available');
    expect(() => disabled.get(f.other.id, id)).toThrow('not available');
  }
  expect(f.files.shared(f.other.id)[0].placementParentId).toBe(destination.id);
  // Re-enabling restores normal current-access cleanup, including a revocation.
  f.files.share(f.owner.id, f.root.id, f.other.id, null);
  expect(f.db.prepare('SELECT * FROM workspace_placements WHERE item_id=?').all(f.root.id)).toEqual(
    [],
  );
});

test.each([false, true])(
  'disabled Space filing follows actual inherited access through revoke/regrant (independent root grant: %s)',
  (direct) => {
    const f = fixture();
    const destination = f.workspace.create(f.other.id, {
      kind: 'folder',
      name: 'References',
      parentId: null,
    });
    f.workspace.share(f.owner.id, f.outer.id, f.other.id, 'editor');
    if (direct) f.files.share(f.owner.id, f.root.id, f.other.id, 'viewer');
    f.files.place(f.other.id, f.root.id, destination.id);
    const placement = () =>
      f.db
        .prepare('SELECT parent_id FROM workspace_placements WHERE user_id=? AND item_id=?')
        .get(f.other.id, f.root.id);
    expect(placement()?.parent_id).toBe(destination.id);
    const disabled = new WorkspaceStore(f.auth, { spacesEnabled: false });

    // An ordinary ancestor grant can change while Space APIs are disabled.
    // Actual access loss permanently removes filing; a surviving direct grant
    // keeps the same placement even though the effective role is downgraded.
    disabled.share(f.owner.id, f.outer.id, f.other.id, null);
    expect(placement()?.parent_id).toBe(direct ? destination.id : undefined);
    disabled.share(f.owner.id, f.outer.id, f.other.id, 'editor');
    expect(new WorkspaceFiles(disabled).shared(f.other.id).map((item) => item.id)).toEqual([
      f.outer.id,
    ]);
    const restored = f.files.shared(f.other.id).find((item) => item.id === f.root.id);
    expect(restored?.access).toBe('editor');
    expect(restored?.placementParentId).toBe(direct ? destination.id : undefined);
  },
);

test('trashing a personal destination while Spaces are disabled permanently removes its Space references', () => {
  const f = fixture();
  const destination = f.workspace.create(f.other.id, {
    kind: 'folder',
    name: 'References',
    parentId: null,
  });
  f.files.share(f.owner.id, f.root.id, f.other.id, 'viewer');
  f.files.place(f.other.id, f.root.id, destination.id);
  const disabled = new WorkspaceStore(f.auth, { spacesEnabled: false });
  const trash = new TrashStore(disabled);
  expect(trash.trash(f.other.id, destination.id)).toEqual({ count: 1 });
  expect(f.db.prepare('SELECT * FROM workspace_placements WHERE item_id=?').all(f.root.id)).toEqual(
    [],
  );
  expect(trash.restore(f.other.id, destination.id).id).toBe(destination.id);
  const restored = f.files.shared(f.other.id).find((item) => item.id === f.root.id);
  expect(restored?.access).toBe('viewer');
  expect(restored?.placementParentId).toBeUndefined();
  expect(f.files.get(f.owner.id, f.root.id).parentId).toBe(f.outer.id);
  // Restoring a folder permits a deliberate new filing, not resurrection.
  f.files.place(f.other.id, f.root.id, destination.id);
  expect(f.files.shared(f.other.id)[0].placementParentId).toBe(destination.id);
});
