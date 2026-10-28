import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { materialize } from '@spinel/sync-server';
import {
  cloneParagraphWithId,
  cloneSectionBreakWithId,
  validateDocumentStructure,
} from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { openDatabase } from '../../../server/database.ts';
import { blankOfflineSnapshot, isOfflineCreationRequest } from '../../shared/offlineCreation.ts';
import type { OfflineCreationRequest } from '../../shared/offlineCreation.ts';
import { snapshotIdentity } from '../../shared/snapshotIdentity.ts';
import { AuthError, AuthStore } from '../auth/store.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { SQLiteSyncStorage } from '../sync/store.ts';
import { OfflineCreations } from './offline-creation.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-offline-creation-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => {
    if (db.isOpen) db.close();
  });
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Collaborator');
  const operator = auth.createUser('Operator', true);
  const collaboration = new CollaborationStore(workspace, path);
  cleanup.push(() => collaboration.close());
  const creations = new OfflineCreations(workspace, collaboration);
  const input = (kind: 'sheet' | 'doc' = 'sheet'): OfflineCreationRequest => ({
    version: 1,
    itemId: randomUUID(),
    unitId: randomUUID(),
    kind,
    name: kind === 'sheet' ? 'New budget' : 'New journal',
    parentId: null,
  });
  return { path, db, auth, workspace, owner, other, operator, collaboration, creations, input };
}

test('the shared Doc base preserves deterministic identities through native normalization', () => {
  const request = { itemId: randomUUID(), kind: 'doc' as const, name: 'Offline journal' };
  const snapshot = blankOfflineSnapshot(request) as IDocumentData;
  expect(blankOfflineSnapshot(request)).toEqual(snapshot);
  expect(validateDocumentStructure(snapshot)).toEqual([]);
  const paragraphIds = new Set<string>();
  const sectionIds = new Set<string>();
  expect(
    snapshot.body!.paragraphs!.map((paragraph) => cloneParagraphWithId(paragraph, paragraphIds)),
  ).toEqual(snapshot.body!.paragraphs);
  expect(
    snapshot.body!.sectionBreaks!.map((section) => cloneSectionBreakWithId(section, sectionIds)),
  ).toEqual(snapshot.body!.sectionBreaks);
});

test.each([
  { icon: 'lucide:book-open', iconColor: 'info-strong' },
  { icon: '🍋', iconColor: null },
])('offline identity persists atomically and is immutable on retry: $icon', async (identity) => {
  const f = await fixture();
  const request = { ...f.input('doc'), ...identity };
  const first = f.creations.create(f.owner.id, request, () => {});
  expect(first.item.appearance).toMatchObject({ ...identity, revision: 1 });
  expect(f.workspace.get(f.owner.id, request.itemId).appearance).toEqual(first.item.appearance);
  expect(f.creations.create(f.owner.id, structuredClone(request), () => {})).toEqual(first);
  for (const change of [{ icon: '🍂' }, { iconColor: 'primary-soft' }])
    expect(() => f.creations.create(f.owner.id, { ...request, ...change }, () => {})).toThrow(
      expect.objectContaining({ status: 409, code: 'creation-conflict' }),
    );
  expect(f.workspace.get(f.owner.id, request.itemId).appearance).toEqual(first.item.appearance);
});

test('legacy creation receipts treat omitted and null identity as the same automatic icon', async () => {
  const f = await fixture();
  const request = f.input();
  const first = f.creations.create(f.owner.id, request, () => {});
  expect(first.item.appearance).toMatchObject({ icon: null, iconColor: null, revision: 0 });
  expect(
    f.creations.create(f.owner.id, { ...request, icon: null, iconColor: null }, () => {}),
  ).toEqual(first);
});

test('legacy own-account receipts migrate without changing the accepted request or allowing ownership transfer on retry', async () => {
  const f = await fixture();
  const request = f.input();
  const first = f.creations.create(f.owner.id, request, () => {});
  f.db.exec(`
    ALTER TABLE workspace_offline_creations DROP COLUMN owner_id;
  `);
  const migrated = new OfflineCreations(f.workspace, f.collaboration);
  expect(migrated.create(f.owner.id, request, () => {})).toEqual(first);
  expect(
    f.db
      .prepare('SELECT owner_id FROM workspace_offline_creations WHERE item_id=?')
      .get(request.itemId)?.owner_id,
  ).toBe(f.owner.id);
  f.db.prepare('UPDATE workspace_items SET owner_id=? WHERE id=?').run(f.other.id, request.itemId);
  f.workspace.share(f.other.id, request.itemId, f.owner.id, 'editor');
  expect(() => migrated.create(f.owner.id, request, () => {})).toThrow(
    expect.objectContaining({ code: 'creation-conflict' }),
  );
});

test.each(['sheet', 'doc'] as const)(
  '%s creation admits the exact shared blank base once and inherits folder visibility',
  async (kind) => {
    const f = await fixture();
    const folder = f.workspace.create(f.owner.id, {
      name: 'Shared folder',
      kind: 'folder',
      parentId: null,
    });
    f.workspace.share(f.owner.id, folder.id, f.other.id, 'viewer');
    const request = { ...f.input(kind), parentId: folder.id };
    const first = f.creations.create(f.owner.id, request, () => {});
    const stored = new SQLiteSyncStorage(f.auth).load(request.unitId)!;
    expect(first).toMatchObject({
      item: { id: request.itemId, kind, name: request.name, parentId: folder.id, access: 'owner' },
      unitId: request.unitId,
      revision: 1,
      revisionOffset: 0,
      syncVersion: 1,
    });
    expect(stored.snapshot).toEqual(
      materialize(snapshotIdentity(blankOfflineSnapshot(request), request.unitId), kind),
    );
    expect(stored.revision).toBe(1);
    expect(f.workspace.get(f.other.id, request.itemId).access).toBe('viewer');
    expect(f.collaboration.generations.active(request.itemId)).toEqual({
      itemId: request.itemId,
      unitId: request.unitId,
      offset: 0,
    });
    // Ignore the first result, as if the network dropped its acknowledgement.
    expect(f.creations.create(f.owner.id, structuredClone(request), () => {})).toEqual(first);
    expect(
      f.db.prepare('SELECT count(*) AS count FROM workspace_offline_creations').get()!.count,
    ).toBe(1);
    expect(f.db.prepare('SELECT count(*) AS count FROM spinel_sync_units').get()!.count).toBe(1);
  },
);

test('creation retries preserve subsequent native edits, renamed metadata and moved destination', async () => {
  const f = await fixture();
  const request = f.input();
  f.creations.create(f.owner.id, request, () => {});
  const mutation = {
    unitId: request.unitId,
    baseRevision: 1,
    actorId: f.owner.id,
    mutationId: randomUUID(),
    mutations: [
      {
        id: 'sheet.mutation.set-range-values',
        params: { unitId: request.unitId, subUnitId: 'first', cellValue: { 0: { 0: { v: 72 } } } },
      },
    ],
  };
  await f.collaboration.sync.submit(mutation, { userID: f.owner.id, customData: {} });
  const folder = f.workspace.create(f.owner.id, {
    name: 'Moved here',
    kind: 'folder',
    parentId: null,
  });
  const updated = f.workspace.update(f.owner.id, request.itemId, {
    name: 'Later name',
    parentId: folder.id,
  });
  const before = new SQLiteSyncStorage(f.auth).load(request.unitId);
  expect(f.creations.create(f.owner.id, request, () => {}).item).toEqual(updated);
  expect(new SQLiteSyncStorage(f.auth).load(request.unitId)).toEqual(before);
  expect(before).toMatchObject({
    revision: 2,
    snapshot: { sheets: { first: { cellData: { 0: { 0: { v: 72 } } } } } },
  });
  expect(f.db.prepare('SELECT count(*) AS count FROM spinel_sync_revisions').get()!.count).toBe(1);
});

test.each(['sheet', 'doc'] as const)(
  'offline %s publication keeps folder-owner ownership, creator attribution and one receipt across restart',
  async (kind) => {
    const f = await fixture();
    const folder = f.workspace.create(f.owner.id, {
      kind: 'folder',
      name: 'Shared trip',
      parentId: null,
    });
    f.workspace.share(f.owner.id, folder.id, f.other.id, 'editor');
    const request = { ...f.input(kind), parentId: folder.id };
    const first = f.creations.create(f.other.id, request, () => {});
    expect(first.item).toMatchObject({
      access: 'editor',
      parentId: folder.id,
      ownerName: f.owner.name,
      createdByName: f.other.name,
    });
    expect(f.workspace.fileOwner(request.itemId)).toBe(f.owner.id);
    expect(f.workspace.list(f.other.id)).toEqual([]);
    expect(f.workspace.get(f.owner.id, request.itemId)).toMatchObject({
      access: 'owner',
      createdByName: f.other.name,
    });
    expect(
      f.db
        .prepare('SELECT user_id,owner_id FROM workspace_offline_creations WHERE item_id=?')
        .get(request.itemId),
    ).toEqual({ user_id: f.other.id, owner_id: f.owner.id });
    const snapshot = new SQLiteSyncStorage(f.auth).load(request.unitId);
    await f.collaboration.close();
    f.db.close();
    const db = openDatabase(f.path);
    cleanup.push(() => db.close());
    const workspace = new WorkspaceStore(new AuthStore(db));
    const collaboration = new CollaborationStore(workspace, f.path);
    cleanup.push(() => collaboration.close());
    const creations = new OfflineCreations(workspace, collaboration);
    // A lost HTTP response may be retried after both server and browser restart.
    expect(creations.create(f.other.id, structuredClone(request), () => {})).toEqual(first);
    expect(new SQLiteSyncStorage(workspace.auth).load(request.unitId)).toEqual(snapshot);
    expect(
      db.prepare('SELECT count(*) AS count FROM workspace_items WHERE id=?').get(request.itemId)!
        .count,
    ).toBe(1);
    expect(
      db.prepare('SELECT count(*) AS count FROM workspace_offline_creations').get()!.count,
    ).toBe(1);
    workspace.share(f.owner.id, folder.id, f.other.id, null);
    expect(() => creations.create(f.other.id, request, () => {})).toThrow(
      expect.objectContaining({ code: 'creation-conflict' }),
    );
    expect(() => creations.create(f.other.id, { ...request, parentId: null }, () => {})).toThrow(
      expect.objectContaining({ code: 'creation-conflict' }),
    );
    expect(workspace.get(f.owner.id, request.itemId).parentId).toBe(folder.id);
    expect(new SQLiteSyncStorage(workspace.auth).load(request.unitId)).toEqual(snapshot);
  },
);

test('shared publication refuses a grant revoked at final admission without committing an item or receipt', async () => {
  const f = await fixture();
  const folder = f.workspace.create(f.owner.id, { kind: 'folder', name: 'Shared', parentId: null });
  f.workspace.share(f.owner.id, folder.id, f.other.id, 'editor');
  const request = { ...f.input(), parentId: folder.id };
  let checks = 0;
  expect(() =>
    f.creations.create(f.other.id, request, () => {
      if (++checks === 3) f.workspace.share(f.owner.id, folder.id, f.other.id, null);
    }),
  ).toThrow(expect.objectContaining({ code: 'folder-unavailable' }));
  expect(
    f.db.prepare('SELECT 1 FROM workspace_items WHERE id=?').get(request.itemId),
  ).toBeUndefined();
  expect(f.db.prepare('SELECT * FROM workspace_offline_creations').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM spinel_sync_units').all()).toEqual([]);
  expect(
    f.db.prepare('SELECT 1 FROM workspace_item_creators WHERE item_id=?').get(request.itemId),
  ).toBeUndefined();
});

test('accepted shared receipts remain bound to their original owner even if the creator still has edit access after transfer', async () => {
  const f = await fixture();
  const folder = f.workspace.create(f.owner.id, { kind: 'folder', name: 'Shared', parentId: null });
  f.workspace.share(f.owner.id, folder.id, f.other.id, 'editor');
  const request = { ...f.input(), parentId: folder.id };
  f.creations.create(f.other.id, request, () => {});
  const recipient = f.auth.createUser('New owner');
  f.db
    .prepare('UPDATE workspace_items SET owner_id=? WHERE id IN (?,?)')
    .run(recipient.id, folder.id, request.itemId);
  expect(f.workspace.get(f.other.id, request.itemId).access).toBe('editor');
  expect(() => f.creations.create(f.other.id, request, () => {})).toThrow(
    expect.objectContaining({ code: 'creation-conflict' }),
  );
  expect(f.workspace.fileOwner(request.itemId)).toBe(recipient.id);
  expect(
    f.db.prepare('SELECT count(*) AS count FROM workspace_offline_creations').get()!.count,
  ).toBe(1);
});

test('receipt identity survives server restart and commits no partial document on storage failure', async () => {
  const f = await fixture();
  const request = f.input('doc');
  const fail = vi.spyOn(SQLiteSyncStorage.prototype, 'create').mockImplementationOnce(() => {
    throw new Error('Injected storage failure');
  });
  expect(() => f.creations.create(f.owner.id, request, () => {})).toThrow(
    'Injected storage failure',
  );
  expect(f.workspace.list(f.owner.id)).toEqual([]);
  expect(f.db.prepare('SELECT * FROM spinel_live_units').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM workspace_offline_creations').all()).toEqual([]);
  fail.mockRestore();
  const first = f.creations.create(f.owner.id, request, () => {});
  await f.collaboration.close();
  f.db.close();
  const db = openDatabase(f.path);
  cleanup.push(() => db.close());
  const workspace = new WorkspaceStore(new AuthStore(db));
  const collaboration = new CollaborationStore(workspace, f.path);
  cleanup.push(() => collaboration.close());
  const reopened = new OfflineCreations(workspace, collaboration);
  expect(reopened.create(f.owner.id, request, () => {})).toEqual(first);
  expect(db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count).toBe(1);
});

test('the immutable accepted request binds account, name, kind, generation and destination', async () => {
  const f = await fixture();
  const request = f.input();
  f.creations.create(f.owner.id, request, () => {});
  for (const change of [
    { name: 'Different' },
    { kind: 'doc' },
    { unitId: randomUUID() },
    { parentId: randomUUID() },
  ])
    expect(() => f.creations.create(f.owner.id, { ...request, ...change }, () => {})).toThrow(
      expect.objectContaining({ status: 409, code: 'creation-conflict' }),
    );
  expect(() => f.creations.create(f.other.id, request, () => {})).toThrow(
    expect.objectContaining({ status: 409, code: 'creation-conflict' }),
  );
  expect(f.workspace.list(f.owner.id)).toHaveLength(1);
  expect(f.workspace.list(f.other.id)).toHaveLength(0);
});

test.each(['trashed', 'deleted', 'transferred', 'restored'] as const)(
  '%s accepted creations cannot be resurrected or reseeded by a delayed retry',
  async (state) => {
    const f = await fixture();
    const request = f.input();
    f.creations.create(f.owner.id, request, () => {});
    if (state === 'trashed')
      f.db
        .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
        .run(randomUUID(), request.itemId);
    if (state === 'deleted')
      f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(request.itemId);
    if (state === 'transferred')
      f.db
        .prepare('UPDATE workspace_items SET owner_id=? WHERE id=?')
        .run(f.other.id, request.itemId);
    if (state === 'restored')
      f.db
        .prepare('UPDATE spinel_live_units SET unit_id=? WHERE item_id=?')
        .run(randomUUID(), request.itemId);
    expect(() => f.creations.create(f.owner.id, request, () => {})).toThrow(
      expect.objectContaining({ status: 409, code: 'creation-conflict' }),
    );
    expect(
      f.db.prepare('SELECT count(*) AS count FROM workspace_offline_creations').get()!.count,
    ).toBe(1);
    expect(f.db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count).toBe(
      state === 'deleted' ? 0 : 1,
    );
  },
);

test('a missing, revoked, trashed, read-only or Space folder never receives a creation; an explicit new destination can retry', async () => {
  const f = await fixture();
  const foreign = f.workspace.create(f.other.id, {
    name: 'Shared only',
    kind: 'folder',
    parentId: null,
  });
  f.workspace.share(f.other.id, foreign.id, f.owner.id, 'viewer');
  const trashed = f.workspace.create(f.owner.id, {
    name: 'Trashed',
    kind: 'folder',
    parentId: null,
  });
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
    .run(randomUUID(), trashed.id);
  const spaces = new SpaceStore(f.workspace);
  const root = spaces.createRoot(f.owner.id, { name: 'Space', parentId: null });
  const child = spaces.createChild(f.owner.id, root.item.id, {
    name: 'Space folder',
    kind: 'folder',
    parentId: root.item.id,
  });
  const request = f.input('doc');
  for (const parentId of [randomUUID(), foreign.id, trashed.id, root.item.id, child.item.id])
    expect(() => f.creations.create(f.owner.id, { ...request, parentId }, () => {})).toThrow(
      expect.objectContaining({ status: 403, code: 'folder-unavailable' }),
    );
  f.workspace.share(f.other.id, foreign.id, f.owner.id, null);
  expect(() =>
    f.creations.create(f.owner.id, { ...request, parentId: foreign.id }, () => {}),
  ).toThrow(expect.objectContaining({ status: 403, code: 'folder-unavailable' }));
  expect(f.db.prepare('SELECT * FROM workspace_offline_creations').all()).toEqual([]);
  const own = f.workspace.create(f.owner.id, {
    name: 'Use this folder',
    kind: 'folder',
    parentId: null,
  });
  expect(
    f.creations.create(f.owner.id, { ...request, parentId: own.id }, () => {}).item.parentId,
  ).toBe(own.id);
  expect(
    f.db.prepare('SELECT count(*) AS count FROM workspace_offline_creations').get()!.count,
  ).toBe(1);
});

test('client IDs cannot collide with another item, native unit, tombstone or retired generation', async () => {
  const f = await fixture();
  const accepted = f.input();
  f.creations.create(f.owner.id, accepted, () => {});
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(accepted.itemId);
  const ordinary = f.workspace.create(f.other.id, { name: 'Private', kind: 'doc', parentId: null });
  const retired = randomUUID();
  f.db.prepare('INSERT INTO collaboration_purge VALUES(?)').run(retired);
  for (const id of [accepted.itemId, accepted.unitId, ordinary.id, retired]) {
    for (const field of ['itemId', 'unitId'])
      expect(() => f.creations.create(f.owner.id, { ...f.input(), [field]: id }, () => {})).toThrow(
        expect.objectContaining({ status: 409, code: 'creation-conflict' }),
      );
  }
  expect(f.workspace.list(f.other.id)).toEqual([ordinary]);
  expect(f.workspace.list(f.owner.id)).toEqual([]);
});

test('invalid kinds, names, routing and snapshots are rejected before native allocation', async () => {
  const f = await fixture();
  const request = f.input();
  for (const change of [
    { version: 2 },
    { itemId: 'invalid' },
    { unitId: request.itemId },
    { kind: 'folder' },
    { kind: 'space' },
    { name: ' leading space' },
    { name: 'nested/title' },
    { name: 'bad\u0000title' },
    { name: 'x'.repeat(121) },
    { parentId: undefined },
    { spaceId: randomUUID() },
    { snapshot: { id: request.itemId } },
    { icon: 'lucide:not-a-real-icon' },
    { icon: 'multiple words' },
    { iconColor: '#ff0000' },
    { cover: { source: 'gem', gem: 'spinel' } },
  ]) {
    const input = { ...request, ...change };
    expect(isOfflineCreationRequest(input)).toBe(false);
    expect(() => f.creations.create(f.owner.id, input, () => {})).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  }
  expect(f.db.prepare('SELECT * FROM workspace_offline_creations').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM spinel_sync_units').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM workspace_items').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM item_appearance').all()).toEqual([]);
});

test('operators, disabled accounts and a session lost at final admission cannot publish', async () => {
  const f = await fixture();
  const request = f.input();
  expect(() => f.creations.create(f.operator.id, request, () => {})).toThrow(
    expect.objectContaining({ status: 403 }),
  );
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.other.id);
  expect(() => f.creations.create(f.other.id, request, () => {})).toThrow(
    expect.objectContaining({ status: 401 }),
  );
  let admissions = 0;
  expect(() =>
    f.creations.create(f.owner.id, request, () => {
      if (++admissions === 3) throw new AuthError(401, 'Session ended');
    }),
  ).toThrow(expect.objectContaining({ status: 401 }));
  expect(f.workspace.list(f.owner.id)).toEqual([]);
  expect(f.db.prepare('SELECT * FROM workspace_offline_creations').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM spinel_sync_units').all()).toEqual([]);
});
