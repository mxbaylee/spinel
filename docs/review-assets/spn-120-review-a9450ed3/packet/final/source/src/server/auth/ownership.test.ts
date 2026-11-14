import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from './store.ts';
import { AdminStore } from './admin.ts';
import { InvitationService } from './invitations.ts';
import { MAX_TRANSFER_ITEMS, OwnershipTransfer } from './ownership.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { SpaceRecoveryStore } from '../workspace/space-recovery.ts';
import { SpaceLifecycleStore } from '../workspace/space-lifecycle.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { guestCookieName } from '../workspace/links.ts';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((close) => close()));

function fixture() {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  new DocumentStore(workspace);
  new SheetStore(workspace);
  new CollaborationGenerations(workspace);
  const operator = auth.createUser('Operator', true);
  const source = auth.createUser('Departed person');
  const target = auth.createUser('New owner');
  const collaborator = auth.createUser('Collaborator');
  const invites = new InvitationService(auth, 'http://localhost:3000');
  const admin = new AdminStore(auth, invites);
  const transfer = new OwnershipTransfer(auth);
  const create = (
    name: string,
    kind: 'folder' | 'doc' | 'sheet' = 'doc',
    parentId: string | null = null,
    user = source.id,
  ) => workspace.create(user, { name, kind, parentId });
  const spaces = new SpaceStore(workspace);
  const recovery = new SpaceRecoveryStore(workspace);
  const preview = () => transfer.preview(operator.id, source.id);
  const finish = (confirmation = preview().confirmation) =>
    transfer.transfer(operator.id, source.id, target.id, confirmation);
  const state = () => ({
    items: db.prepare('SELECT * FROM workspace_items ORDER BY id').all(),
    grants: db.prepare('SELECT * FROM workspace_grants ORDER BY item_id,user_id').all(),
    placements: db.prepare('SELECT * FROM workspace_placements ORDER BY item_id,user_id').all(),
    links: db.prepare('SELECT * FROM workspace_links ORDER BY item_id').all(),
    guests: db.prepare('SELECT * FROM workspace_guest_sessions ORDER BY id').all(),
    recovery: db.prepare('SELECT * FROM workspace_space_trash ORDER BY item_id').all(),
  });
  return {
    db,
    auth,
    workspace,
    operator,
    source,
    target,
    collaborator,
    invites,
    admin,
    transfer,
    create,
    spaces,
    recovery,
    preview,
    finish,
    state,
  };
}

test('complete ordinary and Space handover preserves identity, content, recovery, grants and private filing', () => {
  const f = fixture();
  const outer = f.create('Private outer', 'folder');
  const doc = f.create('Secret document', 'doc', outer.id);
  const sheet = f.create('Private budget', 'sheet', outer.id);
  const deleted = f.create('Earlier deletion', 'doc');
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=?,trash_batch=? WHERE id=?')
    .run(1234, 'old-trash', deleted.id);
  const space = f.spaces.createRoot(f.source.id, {
    name: 'Private Space',
    parentId: outer.id,
  }).space;
  const page = f.spaces.createChild(f.source.id, space.id, {
    name: 'Page',
    kind: 'doc',
    parentId: space.id,
  }).item;
  const nested = f.spaces.createChild(f.source.id, space.id, {
    name: 'Nested sheet',
    kind: 'sheet',
    parentId: page.id,
  }).item;
  const removedFolder = f.spaces.createChild(f.source.id, space.id, {
    name: 'Removed folder',
    kind: 'folder',
    parentId: nested.id,
  }).item;
  f.spaces.createChild(f.source.id, space.id, {
    name: 'Removed child',
    kind: 'doc',
    parentId: removedFolder.id,
  });
  f.recovery.trash(f.source.id, space.id, removedFolder.id);
  f.workspace.share(f.source.id, outer.id, f.collaborator.id, 'editor');
  f.workspace.share(f.source.id, outer.id, f.target.id, 'viewer');
  f.db
    .prepare('INSERT INTO workspace_grants(item_id,user_id,role,shared_at) VALUES(?,?,?,1)')
    .run(outer.id, f.source.id, 'editor');
  const collaboratorFolder = f.create('Their filing', 'folder', null, f.collaborator.id);
  f.workspace.place(f.collaborator.id, doc.id, collaboratorFolder.id);
  f.workspace.place(f.target.id, doc.id, null);
  const unrelated = f.create('Unrelated shared file', 'doc', null, f.collaborator.id);
  f.workspace.share(f.collaborator.id, unrelated.id, f.source.id, 'viewer');
  f.workspace.place(f.source.id, unrelated.id, outer.id);
  f.workspace.changeTag(f.source.id, doc.id, 'source private');
  f.workspace.changeTag(f.target.id, doc.id, 'recipient private');
  f.workspace.changeTag(f.collaborator.id, doc.id, 'collaborator private');
  f.db.prepare('INSERT INTO doc_snapshots VALUES(?,?,7,?)').run(
    doc.id,
    JSON.stringify({
      id: doc.id,
      body: { dataStream: 'Keep\r\n' },
      formula: { itemId: sheet.id, sheetId: 'tab', range: 'A1' },
    }),
    randomUUID(),
  );
  f.db
    .prepare('INSERT INTO doc_images VALUES(?,?,?,?)')
    .run(doc.id, 'image', 'image/png', Buffer.from('opaque image'));
  f.db
    .prepare('INSERT INTO sheet_snapshots VALUES(?,?,4,?)')
    .run(nested.id, '{"opaque":"sheet"}', randomUUID());
  f.db.prepare('INSERT INTO spinel_live_units VALUES(?,?,?)').run(page.id, randomUUID(), 42);
  f.db.exec(
    'CREATE TABLE history_checkpoints (id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES workspace_items(id),snapshot BLOB NOT NULL)',
  );
  f.db
    .prepare('INSERT INTO history_checkpoints VALUES(?,?,?)')
    .run('checkpoint', doc.id, Buffer.from('opaque checkpoint'));
  const retained = () =>
    [
      'doc_snapshots',
      'doc_images',
      'sheet_snapshots',
      'spinel_live_units',
      'history_checkpoints',
      'workspace_space_trash',
      'workspace_tag_assignments',
    ].map((table) => f.db.prepare('SELECT * FROM ' + table).all());
  const unchanged = retained();
  const original = f.db
    .prepare('SELECT * FROM workspace_items WHERE owner_id=? ORDER BY id')
    .all(f.source.id);
  const grant = f.db
    .prepare('SELECT * FROM workspace_grants WHERE user_id=?')
    .all(f.collaborator.id);
  f.admin.disable(f.operator.id, f.source.id);
  const preview = f.preview();
  expect(preview.counts).toEqual({ items: 7, folders: 2, links: 0 });
  const text = JSON.stringify(preview);
  for (const hidden of [
    'Secret document',
    'Private budget',
    'Private Space',
    doc.id,
    sheet.id,
    outer.id,
    page.id,
  ])
    expect(text).not.toContain(hidden);
  f.finish(preview.confirmation);
  const wrapper = f.db
    .prepare('SELECT * FROM workspace_items WHERE owner_id=? AND parent_id IS NULL')
    .get(f.target.id)!;
  expect(wrapper).toMatchObject({ kind: 'folder', name: f.source.name, trashed_at: null });
  for (const row of original)
    expect(f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(String(row.id))).toEqual({
      ...row,
      owner_id: f.target.id,
      parent_id: row.parent_id === null ? wrapper.id : row.parent_id,
    });
  expect(retained()).toEqual(unchanged);
  expect(f.workspace.get(f.target.id, doc.id, 'owner').tags).toEqual(['recipient private']);
  expect(f.workspace.get(f.collaborator.id, doc.id, 'edit').tags).toEqual(['collaborator private']);
  expect(
    f.db.prepare('SELECT * FROM workspace_grants WHERE user_id=?').all(f.collaborator.id),
  ).toEqual(grant);
  expect(
    f.workspace.shared(f.collaborator.id).find((item) => item.id === doc.id)?.placementParentId,
  ).toBe(collaboratorFolder.id);
  expect(
    f.db.prepare('SELECT * FROM workspace_placements WHERE user_id=?').all(f.target.id),
  ).toEqual([]);
  expect(
    f.db.prepare('SELECT * FROM workspace_placements WHERE parent_id=?').all(outer.id),
  ).toEqual([]);
  expect(f.spaces.list(f.target.id, space.id).access).toBe('owner');
  expect(f.spaces.list(f.collaborator.id, space.id).access).toBe('editor');
  f.admin.reactivate(f.operator.id, f.source.id);
  expect(() => f.workspace.get(f.source.id, doc.id)).toThrow('not available');
  expect(() => f.spaces.list(f.source.id, space.id)).toThrow();
  expect(f.workspace.get(f.source.id, unrelated.id).access).toBe('viewer');
  expect(f.workspace.tagSuggestions(f.source.id)).toContain('source private');
});

test('whole-Space trash and internal recovery remain unchanged and recover under the new owner', () => {
  const f = fixture();
  const space = f.spaces.createRoot(f.source.id, { name: 'Project', parentId: null }).space;
  const page = f.spaces.createChild(f.source.id, space.id, {
    name: 'Page',
    kind: 'doc',
    parentId: space.id,
  }).item;
  f.recovery.trash(f.source.id, space.id, page.id);
  const lifecycle = new SpaceLifecycleStore(f.workspace);
  lifecycle.trash(f.source.id, space.id);
  const recovery = f.db.prepare('SELECT * FROM workspace_space_trash').all();
  f.admin.disable(f.operator.id, f.source.id);
  f.finish();
  expect(f.db.prepare('SELECT * FROM workspace_space_trash').all()).toEqual(recovery);
  lifecycle.restore(f.target.id, space.id);
  f.recovery.restore(f.target.id, space.id, page.id);
  expect(f.spaces.list(f.target.id, space.id).items.map((item) => item.id)).toEqual([page.id]);
});

test('handover permanently closes every old guest capability, and only the new owner can create another', () => {
  const f = fixture(),
    doc = f.create('Shared document');
  const link = f.workspace.links.begin(doc.id, 'editor', 7);
  f.workspace.links.finish(doc.id, link.epoch, true);
  const guest = f.workspace.links.exchange(doc.id, link.token!);
  const headers = { cookie: guestCookieName(doc.id) + '=' + guest.token };
  expect(f.workspace.links.preview(doc.id, link.previewToken!)).toBeDefined();
  f.admin.disable(f.operator.id, f.source.id);
  expect(f.preview().counts.links).toBe(1);
  f.finish();
  expect(f.workspace.links.state(doc.id)).toEqual({
    epoch: link.epoch + 1,
    state: 'off',
    role: 'editor',
    enabledAt: null,
    expiresAt: null,
  });
  expect(
    f.db.prepare('SELECT token_hash,preview_hash FROM workspace_links WHERE item_id=?').get(doc.id),
  ).toEqual({ token_hash: null, preview_hash: null });
  expect(() => f.workspace.links.exchange(doc.id, link.token!)).toThrow();
  expect(() => f.workspace.links.principal(headers, doc.id)).toThrow();
  expect(f.workspace.links.preview(doc.id, link.previewToken!)).toBeUndefined();
  f.admin.reactivate(f.operator.id, f.source.id);
  expect(() => f.workspace.get(f.source.id, doc.id, 'owner')).toThrow();
  expect(f.workspace.get(f.target.id, doc.id, 'owner').access).toBe('owner');
  const replacement = f.workspace.links.begin(doc.id, 'viewer');
  f.workspace.links.finish(doc.id, replacement.epoch, true);
  expect(f.workspace.links.exchange(doc.id, replacement.token!).userId).toMatch(/^guest:/);
  expect(() => f.workspace.links.exchange(doc.id, link.token!)).toThrow();
});

test('database failure rolls back owners, wrapper, grants, placements and guest invalidation', () => {
  const f = fixture(),
    doc = f.create('Do not lose');
  f.workspace.share(f.source.id, doc.id, f.target.id, 'viewer');
  f.workspace.place(f.target.id, doc.id, null);
  const link = f.workspace.links.begin(doc.id, 'viewer');
  f.workspace.links.finish(doc.id, link.epoch, true);
  f.workspace.links.exchange(doc.id, link.token!);
  f.admin.disable(f.operator.id, f.source.id);
  const before = f.state();
  const preview = f.preview();
  f.db.exec(
    "CREATE TRIGGER fail_transfer BEFORE UPDATE OF owner_id ON workspace_items BEGIN SELECT RAISE(ABORT, 'fixture transfer failure'); END",
  );
  expect(() => f.finish(preview.confirmation)).toThrow('fixture transfer failure');
  expect(f.state()).toEqual(before);
  expect(f.preview()).toEqual(preview);
});

test.each(['identity', 'parent', 'trash', 'epoch'] as const)(
  'confirmation rejects equal-count %s changes and replay',
  (change) => {
    const f = fixture(),
      first = f.create('First'),
      folder = f.create('Folder', 'folder');
    const link = f.workspace.links.begin(first.id, 'viewer');
    f.workspace.links.finish(first.id, link.epoch, true);
    f.admin.disable(f.operator.id, f.source.id);
    const preview = f.preview();
    if (change === 'identity') {
      // Replace a row without changing item/folder/link counts.
      const next = randomUUID();
      f.db
        .prepare(
          "INSERT INTO workspace_items(id,owner_id,kind,name,created_at,updated_at) VALUES(?,?,'doc','Replacement',1,1)",
        )
        .run(next, f.source.id);
      f.db.prepare('UPDATE workspace_links SET item_id=? WHERE item_id=?').run(next, first.id);
      f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(first.id);
    }
    if (change === 'parent')
      f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(folder.id, first.id);
    if (change === 'trash')
      f.db
        .prepare("UPDATE workspace_items SET trashed_at=123,trash_batch='changed' WHERE id=?")
        .run(first.id);
    if (change === 'epoch')
      f.db.prepare('UPDATE workspace_links SET epoch=epoch+1 WHERE item_id=?').run(first.id);
    expect(f.preview().counts).toEqual(preview.counts);
    const changed = f.state();
    expect(() => f.finish(preview.confirmation)).toThrow('changed');
    expect(f.state()).toEqual(changed);
    f.finish();
    const done = f.state();
    expect(() => f.finish(preview.confirmation)).toThrow();
    expect(f.state()).toEqual(done);
  },
);

test('source, target, Operator and empty-account checks are current and never create a wrapper on refusal', () => {
  const f = fixture();
  const disabled = f.auth.createUser('Disabled destination');
  f.admin.disable(f.operator.id, disabled.id);
  expect(() => f.preview()).toThrow('Disable this account');
  f.admin.disable(f.operator.id, f.source.id);
  const empty = f.preview();
  expect(empty.counts).toEqual({ items: 0, folders: 0, links: 0 });
  expect(empty.recipients.map((user) => user.id).sort()).toEqual(
    [f.target.id, f.collaborator.id].sort(),
  );
  expect(() => f.finish()).toThrow('no owned files');
  expect(f.db.prepare('SELECT * FROM workspace_items').all()).toEqual([]);
  for (const target of [f.operator.id, disabled.id, f.source.id, 'missing', null])
    expect(() =>
      f.transfer.transfer(f.operator.id, f.source.id, target, empty.confirmation),
    ).toThrow('active everyday');
  for (const actor of ['', f.target.id, f.source.id])
    expect(() => f.transfer.preview(actor, f.source.id)).toThrow('Not found');
  expect(() => f.transfer.preview(f.operator.id, f.operator.id)).toThrow('Account not found');
});

test.each(['mixed-owner', 'foreign-child', 'cross-space', 'cycle', 'bad-recovery'] as const)(
  'malformed %s structure is refused without mutation',
  (corruption) => {
    const f = fixture();
    const outer = f.create('Outer', 'folder');
    const space = f.spaces.createRoot(f.source.id, { name: 'Space', parentId: outer.id }).space;
    const page = f.spaces.createChild(f.source.id, space.id, {
      name: 'Page',
      kind: 'doc',
      parentId: space.id,
    }).item;
    if (corruption === 'mixed-owner')
      f.db.prepare('UPDATE workspace_items SET owner_id=? WHERE id=?').run(f.target.id, page.id);
    if (corruption === 'foreign-child') {
      const foreign = f.create('Foreign', 'doc', null, f.target.id);
      f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(page.id, foreign.id);
    }
    if (corruption === 'cross-space') {
      const other = f.spaces.createRoot(f.target.id, { name: 'Other', parentId: null }).space;
      f.db.prepare('UPDATE workspace_items SET space_id=? WHERE id=?').run(other.id, page.id);
    }
    if (corruption === 'cycle')
      f.db.prepare('UPDATE workspace_items SET parent_id=id WHERE id=?').run(outer.id);
    if (corruption === 'bad-recovery') {
      f.recovery.trash(f.source.id, space.id, page.id);
      f.db
        .prepare("UPDATE workspace_space_trash SET trash_batch='mismatch' WHERE item_id=?")
        .run(page.id);
    }
    f.admin.disable(f.operator.id, f.source.id);
    const before = f.state();
    expect(() => f.preview()).toThrow('need attention');
    expect(f.state()).toEqual(before);
  },
);

test('oversized metadata sets fail in full and account names become safe recognizable folder names', () => {
  const f = fixture();
  f.db.prepare('UPDATE auth_users SET name=? WHERE id=?').run('A / B\\C', f.source.id);
  const insert = f.db.prepare(
    "INSERT INTO workspace_items(id,owner_id,kind,name,created_at,updated_at) VALUES(?,?,'doc','Private',1,1)",
  );
  f.auth.transaction(() => {
    for (let index = 0; index <= MAX_TRANSFER_ITEMS; index++)
      insert.run('item-' + index, f.source.id);
  });
  f.admin.disable(f.operator.id, f.source.id);
  expect(() => f.preview()).toThrow('too many items');
  f.db.prepare("DELETE FROM workspace_items WHERE id<>'item-0'").run();
  f.finish();
  expect(f.db.prepare("SELECT name FROM workspace_items WHERE kind='folder'").get()?.name).toBe(
    'A   B C',
  );
});

test.each([
  { sourceCount: MAX_TRANSFER_ITEMS - 2, targetCount: 1, allowed: true },
  { sourceCount: MAX_TRANSFER_ITEMS, targetCount: 0, allowed: false },
  { sourceCount: 1, targetCount: MAX_TRANSFER_ITEMS - 1, allowed: false },
])(
  'recipient discovery remains complete for $sourceCount transferred + $targetCount existing rows',
  ({ sourceCount, targetCount, allowed }) => {
    const f = fixture();
    const insert = f.db.prepare(
      "INSERT INTO workspace_items(id,owner_id,kind,name,created_at,updated_at) VALUES(?,?,'doc','Retained',1,1)",
    );
    f.auth.transaction(() => {
      for (let index = 0; index < sourceCount; index++) insert.run('source-' + index, f.source.id);
      for (let index = 0; index < targetCount; index++) insert.run('target-' + index, f.target.id);
    });
    f.admin.disable(f.operator.id, f.source.id);
    const preview = f.preview();
    if (allowed) {
      f.finish(preview.confirmation);
      // The wrapper uses one slot; acceptance must prove the actual dashboard
      // resolver can still return all files, not just that the SQL update worked.
      expect(f.workspace.list(f.target.id)).toHaveLength(sourceCount + targetCount + 1);
    } else {
      const before = f.state();
      expect(() => f.finish(preview.confirmation)).toThrow('too many files and folders');
      expect(f.state()).toEqual(before);
    }
  },
);
