import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceFiles } from './files.ts';
import { SpaceStore } from './spaces.ts';
import { migrateSpaceSchema } from './space-schema.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture(spacesEnabled = true) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const auth = new AuthStore(database);
  const workspace = new WorkspaceStore(auth, { spacesEnabled });
  migrateSpaceSchema(database);
  const files = new WorkspaceFiles(workspace);
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Owner');
  const reader = auth.createUser('Collaborator');
  const operator = auth.createUser('Operator', true);
  const privateFolder = workspace.create(owner.id, {
    name: 'Private medical records',
    kind: 'folder',
    parentId: null,
  });
  const folder = workspace.create(owner.id, {
    name: 'Budgets',
    kind: 'folder',
    parentId: privateFolder.id,
  });
  const doc = workspace.create(owner.id, { name: 'Plan', kind: 'doc', parentId: folder.id });
  const details = (id = doc.id, spaceId?: string) => files.accessDetails(reader.id, id, spaceId);
  return {
    database,
    auth,
    workspace,
    files,
    spaces,
    owner,
    reader,
    operator,
    privateFolder,
    folder,
    doc,
    details,
  };
}

test('the effective readable folder is reported without disclosing its private ancestry', () => {
  const f = fixture();
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, 'editor');
  const grants = f.database.prepare('SELECT * FROM workspace_grants').all();
  const locations = f.database.prepare('SELECT id,parent_id,owner_id FROM workspace_items').all();
  expect(f.details()).toEqual({
    access: 'editor',
    source: { kind: 'folder', id: f.folder.id, name: 'Budgets' },
  });
  f.files.setHidden(f.reader.id, f.folder.id, true);
  // A personal discovery preference does not make an authorized grant source private.
  expect(f.details().source).toEqual({ kind: 'folder', id: f.folder.id, name: 'Budgets' });
  for (const value of [f.privateFolder.id, f.privateFolder.name, f.owner.id, f.owner.name])
    expect(JSON.stringify(f.details())).not.toContain(value);
  expect(f.database.prepare('SELECT * FROM workspace_grants').all()).toEqual(grants);
  expect(f.database.prepare('SELECT id,parent_id,owner_id FROM workspace_items').all()).toEqual(
    locations,
  );
});

test('direct access wins a tie and stronger inherited access names its actual source', () => {
  const f = fixture();
  f.workspace.share(f.owner.id, f.doc.id, f.reader.id, 'editor');
  expect(f.details()).toEqual({ access: 'editor', source: { kind: 'direct' } });
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, 'viewer');
  expect(f.details()).toEqual({ access: 'editor', source: { kind: 'direct' } });
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, 'editor');
  expect(f.details()).toEqual({ access: 'editor', source: { kind: 'direct' } });
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, 'admin');
  expect(f.details()).toEqual({
    access: 'admin',
    source: { kind: 'folder', id: f.folder.id, name: 'Budgets' },
  });
  expect(f.files.accessDetails(f.owner.id, f.doc.id)).toEqual({
    access: 'owner',
    source: { kind: 'owner' },
  });
});

test('the nearest strongest grant is current after rename, downgrade and revocation', () => {
  const f = fixture();
  f.workspace.share(f.owner.id, f.privateFolder.id, f.reader.id, 'editor');
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, 'editor');
  expect(f.details().source).toMatchObject({ id: f.folder.id });
  f.workspace.update(f.owner.id, f.folder.id, { name: 'Household budgets' });
  expect(f.details().source).toMatchObject({ name: 'Household budgets' });
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, 'viewer');
  expect(f.details()).toMatchObject({ access: 'editor', source: { id: f.privateFolder.id } });
  f.workspace.share(f.owner.id, f.privateFolder.id, f.reader.id, null);
  expect(f.details()).toMatchObject({ access: 'viewer', source: { id: f.folder.id } });
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, null);
  expect(() => f.details()).toThrow('not available');
});

test('Space pages report both the outer grant and uniform Space boundary, never a child grant', () => {
  const f = fixture();
  const space = f.spaces.createRoot(f.owner.id, { name: 'Household', parentId: f.folder.id }).space;
  const internal = f.spaces.createChild(f.owner.id, space.id, {
    name: 'Plans',
    kind: 'folder',
    parentId: space.id,
  }).item;
  const page = f.spaces.createChild(f.owner.id, space.id, {
    name: 'Spending',
    kind: 'doc',
    parentId: internal.id,
  }).item;
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, 'editor');
  const inherited = {
    access: 'editor',
    source: { kind: 'folder', id: f.folder.id, name: 'Budgets' },
    space: { id: space.id, name: 'Household' },
  };
  expect(f.details(space.id)).toEqual(inherited);
  expect(f.details(page.id, space.id)).toEqual(inherited);
  for (const value of [f.privateFolder.id, f.privateFolder.name, internal.id, internal.name])
    expect(JSON.stringify(f.details(page.id, space.id))).not.toContain(value);
  f.files.share(f.owner.id, space.id, f.reader.id, 'admin');
  expect(f.details(space.id)).toEqual({
    access: 'admin',
    source: { kind: 'direct' },
    space: inherited.space,
  });
  expect(f.details(page.id, space.id)).toEqual({
    access: 'admin',
    source: { kind: 'space', ...inherited.space },
    space: inherited.space,
  });
  f.files.share(f.owner.id, space.id, f.reader.id, 'viewer');
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, null);
  // A stale/imported grant on a child never creates an independent permission boundary.
  f.database
    .prepare('INSERT INTO workspace_grants(item_id,user_id,role) VALUES(?,?,?)')
    .run(page.id, f.reader.id, 'admin');
  expect(f.details(page.id, space.id)).toEqual({
    access: 'viewer',
    source: { kind: 'space', ...inherited.space },
    space: inherited.space,
  });
  expect(JSON.stringify(f.details(page.id, space.id))).not.toContain(f.folder.name);
});

test('current authority and explicit Space membership are required for every detail request', () => {
  const f = fixture();
  f.workspace.share(f.owner.id, f.doc.id, f.reader.id, 'viewer');
  for (const actor of [f.operator.id, 'guest:unregistered', 'missing'])
    expect(() => f.files.accessDetails(actor, f.doc.id)).toThrow();
  const space = f.spaces.createRoot(f.owner.id, { name: 'Project', parentId: null }).space;
  const otherSpace = f.spaces.createRoot(f.owner.id, { name: 'Other', parentId: null }).space;
  const page = f.spaces.createChild(f.owner.id, space.id, {
    name: 'Page',
    kind: 'doc',
    parentId: space.id,
  }).item;
  f.files.share(f.owner.id, space.id, f.reader.id, 'viewer');
  f.files.share(f.owner.id, otherSpace.id, f.reader.id, 'viewer');
  expect(() => f.details(page.id)).toThrow('not available');
  expect(() => f.details(page.id, otherSpace.id)).toThrow('not available');
  expect(() => f.details(f.doc.id, space.id)).toThrow('not available');
  f.database.prepare('UPDATE workspace_items SET trashed_at=1 WHERE id=?').run(f.folder.id);
  expect(() => f.details()).toThrow('not available');
  const disabled = new WorkspaceStore(f.auth);
  expect(() => new WorkspaceFiles(disabled).accessDetails(f.reader.id, page.id, space.id)).toThrow(
    'not available',
  );
  f.database.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.reader.id);
  expect(() => f.details(page.id, space.id)).toThrow();
});
