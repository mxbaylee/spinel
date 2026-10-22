import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, hashToken } from '../auth/store.ts';
import { AccessTokens } from '../auth/tokens.ts';
import { documentCatalog } from './document-catalog.ts';
import { createHistoryReadContext } from './document-access.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  cleanup
    .splice(0)
    .reverse()
    .forEach((finish) => finish());
});

function fixture() {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const reader = auth.createUser('Reader');
  const outsider = auth.createUser('Other');
  const spaces = new SpaceStore(workspace);
  const root = spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space;
  const child = spaces.createChild(owner.id, root.id, {
    kind: 'sheet',
    name: 'Budget',
    parentId: root.id,
  }).item;
  const ordinary = workspace.create(owner.id, { kind: 'doc', name: 'Notes', parentId: null });
  const context = (userId: string) => ({
    sessionHash: auth.createSession(userId).session.token_hash,
  });
  return { db, auth, workspace, owner, reader, outsider, spaces, root, child, ordinary, context };
}

test('native discovery composes only current readable children with ordinary documents', () => {
  const f = fixture();
  const ownerContext = f.context(f.owner.id);
  expect(documentCatalog(f.workspace, f.owner.id, ownerContext)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: f.child.id, spaceId: f.root.id, access: 'owner' }),
      expect.objectContaining({ id: f.ordinary.id, kind: 'doc' }),
    ]),
  );
  expect(
    documentCatalog(f.workspace, f.owner.id, ownerContext).some((item) => item.id === f.root.id),
  ).toBe(false);
  const readerContext = f.context(f.reader.id);
  expect(documentCatalog(f.workspace, f.reader.id, readerContext)).toEqual([]);
  f.spaces.share(f.owner.id, f.root.id, f.reader.id, 'viewer');
  const items = documentCatalog(f.workspace, f.reader.id, readerContext);
  expect(items).toEqual([
    expect.objectContaining({
      id: f.child.id,
      name: 'Budget',
      access: 'viewer',
      spaceId: f.root.id,
      tags: [],
    }),
  ]);
  expect(JSON.stringify(items)).not.toContain(f.owner.id);
  expect(items[0].ownerName).toBeUndefined();
  f.spaces.share(f.owner.id, f.root.id, f.reader.id, null);
  expect(documentCatalog(f.workspace, f.reader.id, readerContext)).toEqual([]);
  f.auth.revokeSession(ownerContext.sessionHash);
  expect(() => documentCatalog(f.workspace, f.owner.id, ownerContext)).toThrow('credential');
});

test('trusted ordinary callers and a disabled runtime gate cannot discover Space children', () => {
  const f = fixture();
  expect(documentCatalog(f.workspace, f.owner.id).map((item) => item.id)).toEqual([f.ordinary.id]);
  const ordinaryWorkspace = new WorkspaceStore(f.auth);
  expect(
    documentCatalog(ordinaryWorkspace, f.owner.id, f.context(f.owner.id)).map((item) => item.id),
  ).toEqual([f.ordinary.id]);
  expect(() =>
    documentCatalog(f.workspace, f.owner.id, {
      ...f.context(f.owner.id),
      spaceId: f.root.id,
    }),
  ).toThrow('credential');
});

test('MCP discovery preserves current token identity and never promotes internal child grants', () => {
  const f = fixture();
  const tokens = new AccessTokens(f.auth);
  const token = tokens.create(f.reader.id, 'Document picker');
  const context = { mcpTokenHash: hashToken(token.token) };
  f.db
    .prepare("INSERT INTO workspace_grants(item_id,user_id,role) VALUES(?,?,'viewer')")
    .run(f.child.id, f.reader.id);
  expect(documentCatalog(f.workspace, f.reader.id, context)).toEqual([]);
  f.spaces.share(f.owner.id, f.root.id, f.reader.id, 'viewer');
  expect(documentCatalog(f.workspace, f.reader.id, context).map((item) => item.id)).toEqual([
    f.child.id,
  ]);
  tokens.revoke(f.reader.id, token.id);
  expect(() => documentCatalog(f.workspace, f.reader.id, context)).toThrow('token');
});

test('a root guest discovers only its live tree and a history capability grants no discovery', () => {
  const f = fixture();
  const link = f.workspace.links.begin(f.root.id, 'viewer');
  f.workspace.links.finish(f.root.id, link.epoch, true);
  const guest = f.workspace.links.exchange(f.root.id, link.token);
  const context = {
    guestHash: hashToken(guest.token),
    guestItem: f.root.id,
    spaceId: f.root.id,
    spaceItem: f.child.id,
  };
  const other = f.spaces.createRoot(f.owner.id, {
    name: 'Private other root',
    parentId: null,
  }).space;
  f.spaces.createChild(f.owner.id, other.id, {
    kind: 'sheet',
    name: 'Unrelated secrets',
    parentId: other.id,
  });
  expect(documentCatalog(f.workspace, guest.userId, context)).toEqual([
    expect.objectContaining({ id: f.child.id, name: 'Budget', access: 'viewer' }),
  ]);
  expect(() =>
    documentCatalog(f.workspace, guest.userId, {
      ...context,
      sessionHash: f.context(f.owner.id).sessionHash,
    }),
  ).toThrow('credential');
  f.workspace.links.begin(f.root.id, null);
  expect(() => documentCatalog(f.workspace, guest.userId, context)).toThrow('link');
  const capture = createHistoryReadContext(f.workspace, f.owner.id, f.root.id, f.child.id);
  expect(() => documentCatalog(f.workspace, f.owner.id, capture)).toThrow('discovery');
});

test('complete structural validation excludes trash and fails closed on a malformed member', () => {
  const f = fixture();
  const context = f.context(f.owner.id);
  const deleted = f.spaces.createChild(f.owner.id, f.root.id, {
    kind: 'doc',
    name: 'Deleted title',
    parentId: f.root.id,
  }).item;
  new SpaceRecoveryStore(f.workspace).trash(f.owner.id, f.root.id, deleted.id);
  expect(JSON.stringify(documentCatalog(f.workspace, f.owner.id, context))).not.toContain(
    'Deleted title',
  );
  f.db.prepare('UPDATE workspace_items SET owner_id=? WHERE id=?').run(f.outsider.id, f.child.id);
  expect(() => documentCatalog(f.workspace, f.owner.id, context)).toThrow('not available');
});

test('many roots share a retained-member and recovery budget before any graph is expanded', () => {
  const f = fixture();
  const second = f.spaces.createRoot(f.owner.id, { name: 'Second project', parentId: null }).space;
  const insert = f.db.prepare(`INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position,trashed_at,trash_batch)
    VALUES(?,?,?,'doc','Retained',1,1,?,?,1,?)`);
  const record = f.db.prepare(`INSERT INTO workspace_space_trash
    (item_id,space_id,original_parent_id,original_position,trashed_at,trashed_by,trash_batch)
    VALUES(?,?,?,0,1,?,?)`);
  f.auth.transaction(() => {
    for (const root of [f.root, second]) {
      const deleted = randomUUID(),
        batch = randomUUID();
      insert.run(deleted, f.owner.id, root.id, root.id, 0, batch);
      record.run(deleted, root.id, root.id, f.owner.id, batch);
      for (let index = 0; index < 4_999; index++)
        insert.run(randomUUID(), f.owner.id, deleted, root.id, index, batch);
    }
  });
  const reads = vi.spyOn(f.db, 'prepare');
  expect(() => documentCatalog(f.workspace, f.owner.id, f.context(f.owner.id))).toThrow(
    'too large',
  );
  // readSpaceStructure's full member projection must not run before global refusal.
  expect(
    reads.mock.calls.some(
      ([sql]) =>
        sql.includes('space_position AS position') &&
        sql.includes('FROM workspace_items WHERE space_id'),
    ),
  ).toBe(false);
  expect(reads.mock.calls.length).toBeLessThan(100);
});

test('deep native catalogs validate the root role once instead of walking every child ancestry', () => {
  const f = fixture();
  const insert = f.db.prepare(`INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
    VALUES(?,?,?,'doc','Nested page',1,1,?,0)`);
  f.auth.transaction(() => {
    let parentId = f.root.id;
    for (let index = 0; index < 1_000; index++) {
      const id = randomUUID();
      insert.run(id, f.owner.id, parentId, f.root.id);
      parentId = id;
    }
  });
  const roots = vi.spyOn(SpaceStore.prototype, 'get');
  const reads = vi.spyOn(f.db, 'prepare');
  const items = documentCatalog(f.workspace, f.owner.id, f.context(f.owner.id));
  expect(items).toHaveLength(1_002);
  expect(roots).toHaveBeenCalledTimes(1);
  expect(reads.mock.calls.length).toBeLessThan(100);
});
