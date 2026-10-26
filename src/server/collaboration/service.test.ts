import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, LocaleType, JSONX } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { UniverType } from '@univerjs/protocol';
import type { IChangeset } from '@univerjs/protocol';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { SQLiteSyncStorage } from '../sync/store.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { makeArchive, restoreArchive } from '../backup/archive.ts';
import { CollaborationStore } from './service.ts';
import { TrashStore } from '../workspace/trash.ts';

// Native materializer cold startup is slower while the separate 25-hour browser soak runs.
vi.setConfig({ testTimeout: 20_000 });

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-collaboration-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'spinel.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => {
    if (db.isOpen) db.close();
  });
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner'),
    viewer = auth.createUser('Viewer');
  const other = auth.createUser('Other'),
    admin = auth.createUser('Operator', true);
  const workspace = new WorkspaceStore(auth);
  const sheets = new SheetStore(workspace),
    docs = new DocumentStore(workspace);
  const sheet = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  const doc = workspace.create(owner.id, { name: 'Notes', kind: 'doc', parentId: null });
  const snapshot: IWorkbookData = {
    id: sheet.id,
    name: 'Budget',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    sheetOrder: ['first'],
    sheets: {
      first: {
        id: 'first',
        name: 'Sheet 1',
        rowCount: 100,
        columnCount: 26,
        cellData: { 0: { 0: { v: 42 }, 1: { f: '=A1*2', v: 84 } } },
      },
    },
    styles: {},
  };
  sheets.save(owner.id, sheet.id, { snapshot, revision: 0, writeId: randomUUID() });
  docs.save(owner.id, doc.id, {
    snapshot: { ...getDocsEmptySnapshot(doc.id), body: { dataStream: 'Preserved notes\r\n' } },
    revision: 0,
    writeId: randomUUID(),
  });
  workspace.share(owner.id, sheet.id, viewer.id, 'viewer');
  const collab = new CollaborationStore(workspace, path);
  let stopped = false;
  const stop = async () => {
    if (!stopped) {
      stopped = true;
      await collab.close();
    }
  };
  cleanup.push(stop);
  const load = async (id = sheet.id, userID = owner.id) =>
    collab.sync.load(id, { userID, customData: {} });
  const edit = (userID = owner.id): IChangeset => ({
    unitID: sheet.id,
    type: UniverType.UNIVER_SHEET,
    baseRev: 1,
    revision: 0,
    userID,
    memberID: 'test-member',
    sid: 'test-session',
    reqId: 1,
    mutations: [
      {
        id: SetRangeValuesMutation.id,
        data: JSON.stringify({
          unitId: sheet.id,
          subUnitId: 'first',
          cellValue: { 0: { 0: { v: 99 } } },
        }),
      },
    ],
  });
  return {
    directory,
    path,
    db,
    auth,
    owner,
    viewer,
    other,
    admin,
    workspace,
    sheets,
    docs,
    sheet,
    doc,
    snapshot,
    collab,
    stop,
    load,
    edit,
  };
}

test('raw sheet revision revert cannot bypass the application restore transaction', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  await f.collab.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  const changeset = {
    ...f.edit(),
    baseRev: 2,
    reqId: 2,
    mutations: [
      {
        id: 'univer.mutation.revert-version',
        data: JSON.stringify({ unitId: f.sheet.id, revision: 1 }),
      },
    ],
  };
  await expect(
    f.collab.submitChangeset({ changeset }, { userID: f.owner.id, memberID: 'test-member' }),
  ).rejects.toThrow('Restore versions through Spinel so the current state is kept.');
  const current = await f.collab.load(f.owner.id, f.sheet.id);
  expect(current.revision).toBe(2);
  expect((current.snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBe(99);
});

test('raw document revision revert cannot bypass the application restore transaction', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.doc.id);
  const original = (await f.collab.load(f.owner.id, f.doc.id)).snapshot as IDocumentData;
  const changedBody = { dataStream: 'Changed notes\r\n' };
  const changeset: IChangeset = {
    ...f.edit(),
    unitID: f.doc.id,
    type: UniverType.UNIVER_DOC,
    mutations: [
      {
        id: RichTextEditingMutation.id,
        data: JSON.stringify({
          unitId: f.doc.id,
          actions: new JSONX().replaceOp(['body'], original.body, changedBody),
          textRanges: [],
        }),
      },
    ],
  };
  const context = { userID: f.owner.id, memberID: 'test-member' };
  expect(await f.collab.submitChangeset({ changeset }, context)).toMatchObject({
    status: 'committed',
  });
  expect(
    ((await f.collab.load(f.owner.id, f.doc.id)).snapshot as IDocumentData).body?.dataStream,
  ).toBe(changedBody.dataStream);
  await expect(
    f.collab.submitChangeset(
      {
        changeset: {
          ...changeset,
          baseRev: 2,
          reqId: 2,
          mutations: [
            {
              id: 'univer.mutation.revert-version',
              data: JSON.stringify({ unitId: f.doc.id, revision: 1 }),
            },
          ],
        },
      },
      context,
    ),
  ).rejects.toThrow('Restore versions through Spinel so the current state is kept.');
  const current = await f.collab.load(f.owner.id, f.doc.id);
  expect(current.revision).toBe(2);
  expect((current.snapshot as IDocumentData).body).toEqual(changedBody);
});

test('permanent purge after atomic preparation removes the unit and acknowledges its outbox', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.doc.id);
  expect(
    f.db.prepare('SELECT unit_id FROM spinel_sync_units WHERE unit_id=?').get(f.doc.id),
  ).toBeDefined();
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(f.doc.id);
  expect(
    f.db.prepare('SELECT 1 FROM collaboration_purge WHERE item_id=?').get(f.doc.id),
  ).toBeDefined();
  await f.collab.purgeDeleted();
  expect(
    f.db.prepare('SELECT unit_id FROM spinel_sync_units WHERE unit_id=?').get(f.doc.id),
  ).toBeUndefined();
  expect(
    f.db.prepare('SELECT 1 FROM collaboration_purge WHERE item_id=?').get(f.doc.id),
  ).toBeUndefined();
});

test('foreign and external image mutations are permanently rejected before persistence', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.doc.id);
  for (const [index, source] of [
    `/api/items/foreign/images/${'a'.repeat(64)}`,
    'https://hostile.invalid/image.png',
  ].entries()) {
    const changeset: IChangeset = {
      unitID: f.doc.id,
      type: UniverType.UNIVER_DOC,
      baseRev: 1,
      revision: 0,
      userID: f.owner.id,
      memberID: 'test-member',
      sid: 'test-images',
      reqId: index + 1,
      mutations: [
        {
          id: RichTextEditingMutation.id,
          data: JSON.stringify({
            unitId: f.doc.id,
            actions: new JSONX().insertOp(['drawings', 'x'], { source }),
            textRanges: [],
          }),
        },
      ],
    };
    await expect(
      f.collab.submitChangeset({ changeset }, { userID: f.owner.id, memberID: 'test-member' }),
    ).rejects.toThrow();
    const saved = await f.collab.load(f.owner.id, f.doc.id);
    expect(saved.revision).toBe(1);
    expect((saved.snapshot as IDocumentData).drawings).toEqual({});
  }
});

test('permanent purge is durable across an interrupted sync deletion and soft restore preserves changes', async () => {
  const f = await fixture();
  const trash = new TrashStore(f.workspace);
  await f.collab.prepare(f.owner.id, f.sheet.id);
  await f.collab.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  trash.trash(f.owner.id, f.sheet.id);
  await expect(f.load()).rejects.toThrow('not available');
  trash.restore(f.owner.id, f.sheet.id);
  expect(
    ((await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(99);
  trash.trash(f.owner.id, f.sheet.id);
  trash.empty(f.owner.id, trash.list(f.owner.id).version);
  expect(f.db.prepare('SELECT item_id FROM collaboration_purge').all()).toEqual([
    { item_id: f.sheet.id },
  ]);
  const remove = vi.spyOn(SQLiteSyncStorage.prototype, 'remove').mockImplementationOnce(() => {
    throw new Error('interrupted');
  });
  await expect(f.collab.purgeDeleted()).rejects.toThrow('interrupted');
  expect(f.db.prepare('SELECT count(*) AS n FROM collaboration_purge').get()?.n).toBe(1);
  remove.mockRestore();
  await f.collab.purgeDeleted();
  expect(f.db.prepare('SELECT count(*) AS n FROM collaboration_purge').get()?.n).toBe(0);
  // Inspect through the public adapter to prove bytes were hard-deleted, not merely hidden by ACL.
  expect(
    f.db.prepare('SELECT unit_id FROM spinel_sync_units WHERE unit_id=?').get(f.sheet.id),
  ).toBeUndefined();
});

test('expired network sessions cannot submit and cross-unit mutations cannot modify another document', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  const session = f.auth.createSession(f.owner.id);
  f.auth.revokeSession(session.session.token_hash);
  await expect(
    f.collab.submitChangeset(
      { changeset: f.edit() },
      {
        userID: f.owner.id,
        memberID: 'test-member',
        customData: { sessionHash: session.session.token_hash },
      },
    ),
  ).rejects.toThrow();
  const changeset = f.edit();
  changeset.mutations[0].data = JSON.stringify({
    unitId: f.doc.id,
    subUnitId: 'first',
    cellValue: { 0: { 0: { v: 'foreign' } } },
  });
  await expect(
    f.collab.submitChangeset({ changeset }, { userID: f.owner.id, memberID: 'test-member' }),
  ).rejects.toThrow();
  expect((await f.load()).revision).toBe(1);
});

test('migration is idempotent, preserves legacy snapshots and fences stale-tab saves', async () => {
  const f = await fixture();
  await Promise.all([
    f.collab.prepare(f.owner.id, f.sheet.id),
    f.collab.prepare(f.viewer.id, f.sheet.id),
  ]);
  await f.collab.prepare(f.owner.id, f.doc.id);
  const sheetBefore = await f.load();
  const docBefore = await f.load(f.doc.id);
  expect(sheetBefore.revision).toBe(1);
  expect(docBefore.revision).toBe(1);
  const native = (await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData;
  expect(native.sheets.first.cellData).toEqual(f.snapshot.sheets.first.cellData);
  expect(native.sheetOrder).toEqual(f.snapshot.sheetOrder);
  expect(
    ((await f.collab.load(f.owner.id, f.doc.id)).snapshot as IDocumentData).body?.dataStream,
  ).toBe('Preserved notes\r\n');
  expect(f.sheets.load(f.owner.id, f.sheet.id).snapshot).toEqual(f.snapshot);
  expect(() =>
    f.sheets.save(f.owner.id, f.sheet.id, {
      snapshot: { ...f.snapshot, name: 'Stale tab' },
      revision: 1,
      writeId: randomUUID(),
    }),
  ).toThrow('live collaboration');
  await f.collab.prepare(f.owner.id, f.sheet.id);
  await f.collab.prepare(f.owner.id, f.doc.id);
  expect(await f.load()).toEqual(sheetBefore);
  expect(await f.load(f.doc.id)).toEqual(docBefore);
});

test('interrupted atomic preparation rolls back both unit and fence and retries without overwriting saved work', async () => {
  const f = await fixture();
  const original = SQLiteSyncStorage.prototype.create;
  const create = vi.spyOn(SQLiteSyncStorage.prototype, 'create').mockImplementationOnce(function (
    this: SQLiteSyncStorage,
    unit,
    guard,
  ) {
    return original.call(this, unit, () => {
      guard();
      throw new Error('interrupted');
    });
  });
  await expect(f.collab.prepare(f.owner.id, f.sheet.id)).rejects.toThrow('interrupted');
  expect(
    f.db.prepare('SELECT state FROM workspace_collaboration WHERE item_id=?').get(f.sheet.id),
  ).toBeUndefined();
  expect(
    f.db.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(f.sheet.id),
  ).toBeUndefined();
  expect(f.sheets.load(f.owner.id, f.sheet.id).snapshot).toEqual(f.snapshot);
  create.mockRestore();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  await f.collab.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  const before = await f.load();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  expect(await f.load()).toEqual(before);
  expect((await f.load()).revision).toBe(2);
  expect(() =>
    f.sheets.save(f.owner.id, f.sheet.id, {
      snapshot: f.snapshot,
      revision: 1,
      writeId: randomUUID(),
    }),
  ).toThrow('live collaboration');
});

test('service read, edit and lifecycle boundaries reuse current workspace grants', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  expect((await f.load(f.sheet.id, f.viewer.id)).revision).toBe(1);
  for (const user of [f.other, f.admin]) {
    await expect(f.collab.prepare(user.id, f.sheet.id)).rejects.toThrow('not available');
    await expect(f.load(f.sheet.id, user.id)).rejects.toThrow('not available');
  }
  const before = f.workspace.get(f.owner.id, f.sheet.id).updatedAt;
  f.auth.now = () => before + 1000;
  await expect(
    f.collab.submitChangeset(
      { changeset: f.edit(f.viewer.id) },
      { userID: f.viewer.id, memberID: 'test-member' },
    ),
  ).rejects.toThrow();
  expect(f.workspace.get(f.owner.id, f.sheet.id).updatedAt).toBe(before);
  expect((await f.load()).revision).toBe(1);
  // No raw deletion API remains; only the application purge outbox may delete.
  f.db.prepare('INSERT INTO collaboration_purge VALUES(?)').run(f.sheet.id);
  await expect(f.collab.purgeDeleted()).rejects.toThrow('active generation');
  f.db.prepare('DELETE FROM collaboration_purge WHERE item_id=?').run(f.sheet.id);
  f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, null);
  await expect(f.load(f.sheet.id, f.viewer.id)).rejects.toThrow('not available');
});

test('actual collaboration changes survive encrypted application backup, fresh restore and sync reopen', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  await f.collab.prepare(f.owner.id, f.doc.id);
  const savedAt = f.workspace.get(f.owner.id, f.sheet.id).updatedAt + 1000;
  f.auth.now = () => savedAt;
  const result = await f.collab.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  expect(result.status).toBe('committed');
  expect(f.workspace.get(f.owner.id, f.sheet.id).updatedAt).toBe(savedAt);
  const expectedSheet = await f.load(),
    expectedDoc = await f.load(f.doc.id);
  expect(expectedSheet.revision).toBe(2);
  expect(
    ((await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(99);
  const key = randomBytes(32);
  const archive = await makeArchive(f.db, f.directory, key, {
    format: 1,
    createdAt: new Date().toISOString(),
    origin: 'https://spinel.example',
    image: `sha256:${'a'.repeat(64)}`,
    runtimeEnvironment: '',
  });
  cleanup.push(() => archive.dispose());
  const restored = join(f.directory, 'restored');
  await restoreArchive(archive.archive, key, f.directory, restored);
  const path = join(restored, 'spinel.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => db.close());
  const workspace = new WorkspaceStore(new AuthStore(db));
  const collab = new CollaborationStore(workspace, path);
  cleanup.push(() => collab.close());
  for (const [id, expected] of [
    [f.sheet.id, expectedSheet],
    [f.doc.id, expectedDoc],
  ] as const) {
    await collab.prepare(f.owner.id, id);
    expect(collab.sync.load(id, { userID: f.owner.id, customData: {} })).toEqual(expected);
  }
  expect(workspace.get(f.viewer.id, f.sheet.id).access).toBe('viewer');
  expect(
    ((await collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(99);
  // Two native runtimes plus authenticated archive/restore need headroom on loaded CI hosts.
}, 20_000);

test('a different SQLite file is rejected before collaboration schema can be created there', async () => {
  const f = await fixture();
  const path = join(f.directory, 'unbacked.sqlite');
  const other = openDatabase(path);
  try {
    expect(() => new CollaborationStore(f.workspace, path)).toThrow('application database file');
    expect(other.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  } finally {
    other.close();
  }
});

test('access revoked during mutation application is checked again before durable commit', async () => {
  const f = await fixture();
  const audit = vi.spyOn(console, 'warn').mockImplementation(() => {});
  f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, 'editor');
  await f.collab.prepare(f.owner.id, f.sheet.id);
  f.collab.onSubmitting(async () => {
    f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, null);
    await Promise.resolve();
  });
  const before = f.workspace.get(f.owner.id, f.sheet.id).updatedAt;
  f.auth.now = () => before + 1000;
  await expect(
    f.collab.submitChangeset(
      { changeset: f.edit(f.viewer.id) },
      { userID: f.viewer.id, memberID: 'test-member' },
    ),
  ).rejects.toThrow();
  expect(f.workspace.get(f.owner.id, f.sheet.id).updatedAt).toBe(before);
  expect(audit.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
    'collaboration.edit_denied',
  );
  expect((await f.load()).revision).toBe(1);
  expect(
    ((await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(42);
}, 20_000);

test('guest viewer mutations are denied while the same editor mutation commits', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  for (const role of ['viewer', 'editor'] as const) {
    const link = f.workspace.links.begin(f.sheet.id, role);
    f.workspace.links.finish(f.sheet.id, link.epoch, true);
    const guest = f.workspace.links.exchange(f.sheet.id, link.token);
    const credential = f.workspace.links.access(guest.userId)!;
    const result = f.collab.submitChangeset(
      { changeset: f.edit(guest.userId) },
      {
        userID: guest.userId,
        memberID: 'test-member',
        customData: {
          guestHash: credential.tokenHash,
          guestItem: f.sheet.id,
        },
      },
    );
    if (role === 'viewer') await expect(result).rejects.toThrow();
    else await expect(result).resolves.toMatchObject({ status: 'committed' });
    expect((await f.load()).revision).toBe(role === 'viewer' ? 1 : 2);
    expect(
      ((await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
        .cellData?.[0]?.[0]?.v,
    ).toBe(role === 'viewer' ? 42 : 99);
  }
});

test('revoking a guest link during mutation application prevents the durable commit', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  const link = f.workspace.links.begin(f.sheet.id, 'editor');
  f.workspace.links.finish(f.sheet.id, link.epoch, true);
  const guest = f.workspace.links.exchange(f.sheet.id, link.token);
  const credential = f.workspace.links.access(guest.userId)!;
  let entered!: () => void, release!: () => void;
  const applying = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = f.collab.onSubmitting(async () => {
    entered();
    await gate;
    await Promise.resolve();
  });
  cleanup.push(() => {
    release();
    blocker.dispose();
  });
  const submitted = f.collab.submitChangeset(
    { changeset: f.edit(guest.userId) },
    {
      userID: guest.userId,
      memberID: 'test-member',
      customData: {
        guestHash: credential.tokenHash,
        guestItem: f.sheet.id,
      },
    },
  );
  await applying;
  const revoked = f.workspace.links.begin(f.sheet.id, null);
  release();
  await expect(submitted).rejects.toThrow();
  f.workspace.links.finish(f.sheet.id, revoked.epoch, false);
  expect((await f.load()).revision).toBe(1);
  expect(
    ((await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(42);
});

test('retained native restore drains accepted edits, fences old IDs and keeps exact recoverable pre-state', async () => {
  const f = await fixture();
  const { HistoryStore } = await import('../history/store.ts');
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const target = await history.nameCurrent(f.owner.id, f.sheet.id, 'Original native budget');
  await f.collab.prepare(f.owner.id, f.sheet.id);
  let entered!: () => void, release!: () => void;
  const committing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = f.collab.onSubmitting(async () => {
    entered();
    await gate;
    await Promise.resolve();
  });
  cleanup.push(() => {
    release();
    blocker.dispose();
  });
  const accepted = f.collab.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  await committing;
  const requestId = randomUUID();
  const restored = history.restore(f.owner.id, f.sheet.id, target.id, f.sheet.id, requestId);
  await vi.waitFor(() => expect(f.collab.generations.restoring(f.sheet.id)).toBe(true));
  await expect(
    f.collab.submitChangeset(
      { changeset: { ...f.edit(), reqId: 2 } },
      { userID: f.owner.id, memberID: 'test-member' },
    ),
  ).rejects.toThrow();
  release();
  await accepted;
  const receipt = await restored;
  blocker.dispose();
  expect(receipt.revision).toBe(3);
  const current = await f.collab.load(f.owner.id, f.sheet.id);
  expect(current.revision).toBe(3);
  expect(current.snapshot.id).toBe(f.sheet.id);
  expect((current.snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBe(42);
  const before = history.list(f.owner.id, f.sheet.id).find((point) => point.beforeRestore)!;
  expect(before.revision).toBe(2);
  expect(
    ((await history.load(f.owner.id, f.sheet.id, before.id)) as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(99);
  await expect(f.load()).rejects.toThrow('not available');
  await expect(
    f.collab.submitChangeset(
      { changeset: { ...f.edit(), reqId: 3 } },
      { userID: f.owner.id, memberID: 'test-member' },
    ),
  ).rejects.toThrow();
  const edit = f.edit();
  edit.unitID = receipt.nextUnit;
  edit.mutations[0].data = JSON.stringify({
    unitId: receipt.nextUnit,
    subUnitId: 'first',
    cellValue: { 0: { 0: { v: 123 } } },
  });
  await f.collab.submitChangeset(
    { changeset: edit },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  expect((await f.collab.load(f.owner.id, f.sheet.id)).revision).toBe(4);
  expect(await history.restore(f.owner.id, f.sheet.id, target.id, f.sheet.id, requestId)).toEqual(
    receipt,
  );
  expect(
    ((await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(123);
  const undo = await history.restore(
    f.owner.id,
    f.sheet.id,
    before.id,
    receipt.nextUnit,
    randomUUID(),
  );
  expect(undo.revision).toBe(5);
  expect(
    ((await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(99);
  history.prune(f.auth.now() + 365 * 24 * 60 * 60 * 1000);
  expect(history.list(f.owner.id, f.sheet.id).some((point) => point.id === before.id)).toBe(true);
  await f.collab.purgeDeleted();
  expect((await f.collab.load(f.owner.id, f.sheet.id)).revision).toBe(5);
});

test('document restore validates retained image references and rolls back session revocation during staging', async () => {
  const f = await fixture();
  const { HistoryStore } = await import('../history/store.ts');
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const target = await history.nameCurrent(f.owner.id, f.doc.id, 'Native notes');
  await f.collab.prepare(f.owner.id, f.doc.id);
  const live = await f.collab.load(f.owner.id, f.doc.id);
  const result = await history.restore(f.owner.id, f.doc.id, target.id, f.doc.id, randomUUID());
  expect(result.revision).toBe(2);
  expect((await f.collab.load(f.owner.id, f.doc.id)).snapshot).toMatchObject({
    id: f.doc.id,
    body: (live.snapshot as IDocumentData).body,
  });
  const state = await f.collab.load(f.owner.id, f.doc.id);
  const bad = structuredClone(state.snapshot) as IDocumentData;
  bad.drawings = {
    bad: { source: '/api/items/foreign/images/' + 'a'.repeat(64) },
  } as unknown as IDocumentData['drawings'];
  // A stored checkpoint is checked again when it is previewed.
  const planted = await history.nameCurrent(f.owner.id, f.doc.id, 'Planted');
  f.db
    .prepare('UPDATE history_checkpoints SET snapshot=? WHERE id=?')
    .run(gzipSync(JSON.stringify(bad)), planted.id);
  await expect(history.load(f.owner.id, f.doc.id, planted.id)).rejects.toThrow('Insert images');
  await expect(
    f.collab.restore(
      f.owner.id,
      f.doc.id,
      result.nextUnit,
      randomUUID(),
      target.id,
      bad,
      async () => () => {},
      () => {},
    ),
  ).rejects.toThrow('Insert images');
  expect((await f.collab.load(f.owner.id, f.doc.id)).revision).toBe(2);
  let checks = 0;
  await expect(
    history.restore(f.owner.id, f.doc.id, target.id, result.nextUnit, randomUUID(), () => {
      if (++checks === 4) throw new Error('expired session');
    }),
  ).rejects.toThrow('expired session');
  expect((await f.collab.load(f.owner.id, f.doc.id)).revision).toBe(2);
  expect(f.collab.generations.restoring(f.doc.id)).toBe(false);
  expect(history.list(f.owner.id, f.doc.id).filter((point) => point.beforeRestore)).toHaveLength(1);
  await expect(
    history.restore(f.viewer.id, f.doc.id, target.id, result.nextUnit, randomUUID()),
  ).rejects.toThrow();
});

test('sync generation restore retains multi-tab formulas, styles, resources and stored Doc images after later edits', async () => {
  const f = await fixture();
  const { HistoryStore } = await import('../history/store.ts');
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const rich = structuredClone(f.snapshot);
  rich.styles = { bold: { bl: 1, bg: { rgb: '#ffdde6' } } };
  rich.sheets.first.cellData![0]![0]!.s = 'bold';
  rich.sheetOrder.push('second');
  rich.sheets.second = {
    id: 'second',
    name: 'Totals',
    rowCount: 20,
    columnCount: 10,
    cellData: { 0: { 0: { f: "='Sheet 1'!A1", v: 42 }, 1: { v: f.sheet.id } } },
  };
  rich.resources = [{ name: 'SPINEL_TEST_RESOURCE', data: '{"keep":"exactly"}' }];
  f.sheets.save(f.owner.id, f.sheet.id, { snapshot: rich, revision: 1, writeId: randomUUID() });
  const sheetTarget = await history.nameCurrent(f.owner.id, f.sheet.id, 'Rich native sheet');
  await f.collab.prepare(f.owner.id, f.sheet.id);
  await f.collab.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  const namedPrestate = await history.nameCurrent(f.owner.id, f.sheet.id, 'Keep my existing label');
  const sheetRestore = await history.restore(
    f.owner.id,
    f.sheet.id,
    sheetTarget.id,
    f.sheet.id,
    randomUUID(),
  );
  expect(
    history.list(f.owner.id, f.sheet.id).find((point) => point.id === namedPrestate.id),
  ).toMatchObject({ name: 'Keep my existing label', beforeRestore: 1 });
  const restored = (await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData;
  expect(restored.sheetOrder).toEqual(rich.sheetOrder);
  expect(restored.styles.bold).toEqual(rich.styles.bold);
  expect(restored.sheets.second.cellData).toEqual(rich.sheets.second.cellData);
  expect(restored.resources).toContainEqual(rich.resources[0]);
  const edit = f.edit();
  edit.unitID = sheetRestore.nextUnit;
  edit.mutations[0].data = JSON.stringify({
    unitId: sheetRestore.nextUnit,
    subUnitId: 'second',
    cellValue: { 1: { 0: { v: 'After restore' } } },
  });
  await f.collab.submitChangeset(
    { changeset: edit },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  const edited = (await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData;
  expect(edited.sheets.second.cellData?.[1]?.[0]?.v).toBe('After restore');
  expect(edited.sheets.second.cellData?.[0]?.[0]?.f).toBe("='Sheet 1'!A1");
  expect(edited.resources).toContainEqual(rich.resources[0]);
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#ff9900' } })
    .png()
    .toBuffer();
  const image = await f.docs.upload(f.owner.id, f.doc.id, bytes, 'image/png');
  const drawing = {
    unitId: f.doc.id,
    subUnitId: f.doc.id,
    drawingId: 'photo',
    drawingType: 0,
    imageSourceType: 'URL',
    source: image.url,
    layoutType: 0,
    docTransform: {
      size: { width: 3, height: 2 },
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 0, posOffset: 0 },
      angle: 0,
    },
  };
  const doc: IDocumentData = {
    ...f.docs.load(f.owner.id, f.doc.id).snapshot!,
    drawings: { photo: drawing },
    drawingsOrder: ['photo'],
  };
  f.docs.save(f.owner.id, f.doc.id, { snapshot: doc, revision: 1, writeId: randomUUID() });
  const docTarget = await history.nameCurrent(f.owner.id, f.doc.id, 'Image checkpoint');
  await f.collab.prepare(f.owner.id, f.doc.id);
  const docRestore = await history.restore(
    f.owner.id,
    f.doc.id,
    docTarget.id,
    f.doc.id,
    randomUUID(),
  );
  const current = (await f.collab.load(f.owner.id, f.doc.id)).snapshot as IDocumentData;
  expect(current.drawings?.photo).toMatchObject(drawing);
  expect(current.drawingsOrder).toEqual(['photo']);
  const changeset = {
    ...f.edit(),
    unitID: docRestore.nextUnit,
    type: UniverType.UNIVER_DOC,
    mutations: [
      {
        id: RichTextEditingMutation.id,
        data: JSON.stringify({
          unitId: docRestore.nextUnit,
          actions: new JSONX().replaceOp(['body'], current.body, {
            dataStream: 'Image still here\r\n',
          }),
          textRanges: [],
        }),
      },
    ],
  };
  await f.collab.submitChangeset({ changeset }, { userID: f.owner.id, memberID: 'test-member' });
  const after = (await f.collab.load(f.owner.id, f.doc.id)).snapshot as IDocumentData;
  expect(after.body?.dataStream).toBe('Image still here\r\n');
  expect(after.drawings?.photo).toMatchObject(drawing);
  expect(Buffer.from(f.docs.image(f.owner.id, f.doc.id, image.id).data)).toEqual(bytes);
});

test('file-backed restart cancels a staged sync replacement and preserves a completed restore and receipt', async () => {
  const f = await fixture();
  const step = async <T>(name: string, action: () => Promise<T>) => {
    try {
      return await action();
    } catch (cause) {
      throw new Error(`Restore restart stage: ${name}`, { cause });
    }
  };
  const integrity = (database: typeof f.db, stage: string) => {
    expect(database.prepare('PRAGMA integrity_check').all(), stage).toEqual([
      { integrity_check: 'ok' },
    ]);
  };
  const { HistoryStore } = await import('../history/store.ts');
  const history = new HistoryStore(f.workspace, f.collab);
  let historyClosed = false;
  cleanup.push(async () => {
    if (!historyClosed) await history.close();
  });
  const target = await history.nameCurrent(f.owner.id, f.sheet.id, 'Original');
  await f.collab.prepare(f.owner.id, f.sheet.id);
  await f.collab.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  // Fault injection models termination after the native stage is durable but before
  // the application switch; process death cannot run the normal catch cleanup.
  vi.spyOn(f.collab.generations, 'finish').mockImplementation(() => {
    throw new Error('power lost before switch');
  });
  vi.spyOn(f.collab.generations, 'cancel').mockImplementation(() => {});
  await expect(
    history.restore(f.owner.id, f.sheet.id, target.id, f.sheet.id, randomUUID()),
  ).rejects.toThrow('power lost');
  const staged = f.db
    .prepare("SELECT next_unit FROM spinel_restore_jobs WHERE status='staging'")
    .get()!;
  expect(
    f.db
      .prepare('SELECT unit_id FROM spinel_sync_units WHERE unit_id=?')
      .get(String(staged.next_unit)),
  ).toBeDefined();
  await history.close();
  historyClosed = true;
  integrity(f.db, 'before closing staged fixture');
  await f.stop();
  integrity(f.db, 'after closing staged sync');
  f.db.close();
  const db = openDatabase(f.path);
  integrity(db, 'reopened staged database');
  cleanup.push(() => {
    if (db.isOpen) db.close();
  });
  const workspace = new WorkspaceStore(new AuthStore(db));
  const collab = new CollaborationStore(workspace, f.path);
  let stopped = false;
  cleanup.push(async () => {
    if (!stopped) await collab.close();
  });
  const reopened = new HistoryStore(workspace, collab);
  let reopenedClosed = false;
  cleanup.push(async () => {
    if (!reopenedClosed) await reopened.close();
  });
  expect(collab.generations.restoring(f.sheet.id)).toBe(false);
  expect(
    (
      (await step('load old live after staged restart', () => collab.load(f.owner.id, f.sheet.id)))
        .snapshot as IWorkbookData
    ).sheets.first.cellData?.[0]?.[0]?.v,
  ).toBe(99);
  expect(
    db.prepare('SELECT status FROM spinel_restore_jobs WHERE next_unit=?').get(staged.next_unit)
      ?.status,
  ).toBe('cancelled');
  await step('purge abandoned stage', () => collab.purgeDeleted());
  integrity(db, 'after purging abandoned stage');
  expect(
    db
      .prepare('SELECT unit_id FROM spinel_sync_units WHERE unit_id=?')
      .get(String(staged.next_unit)),
  ).toBeUndefined();
  const request = randomUUID();
  const completed = await step('complete restore after first restart', () =>
    reopened.restore(f.owner.id, f.sheet.id, target.id, f.sheet.id, request),
  );
  await reopened.close();
  reopenedClosed = true;
  integrity(db, 'before closing completed sync');
  await collab.close();
  integrity(db, 'after closing completed sync');
  stopped = true;
  db.close();
  const lastDb = openDatabase(f.path);
  integrity(lastDb, 'reopened completed database');
  cleanup.push(() => lastDb.close());
  const lastWorkspace = new WorkspaceStore(new AuthStore(lastDb));
  const last = new CollaborationStore(lastWorkspace, f.path);
  cleanup.push(() => last.close());
  const lastHistory = new HistoryStore(lastWorkspace, last);
  cleanup.push(() => lastHistory.close());
  await step('prepare completed generation after restart', () =>
    last.prepare(f.owner.id, f.sheet.id),
  );
  expect(last.generations.active(f.sheet.id)).toMatchObject({
    unitId: completed.nextUnit,
    offset: 2,
  });
  const saved = await step('load completed generation after restart', () =>
    last.load(f.owner.id, f.sheet.id),
  );
  expect(saved.revision).toBe(3);
  expect((saved.snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBe(42);
  expect(await lastHistory.restore(f.owner.id, f.sheet.id, target.id, f.sheet.id, request)).toEqual(
    completed,
  );
  await last.purgeDeleted();
  expect((await last.load(f.owner.id, f.sheet.id)).revision).toBe(3);
  expect(lastHistory.list(f.owner.id, f.sheet.id).some((point) => point.beforeRestore)).toBe(true);
});

test('Sheet image validation fences live mutations and preserved resources', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  const source = 'https://outside.invalid/pixel.png';
  const cellDoc = {
    ...getDocsEmptySnapshot('cell-doc'),
    drawings: {
      picture: { unitId: 'cell-doc', subUnitId: 'cell-doc', source },
    },
  };
  const change = f.edit();
  change.mutations[0].data = JSON.stringify({
    unitId: f.sheet.id,
    subUnitId: 'first',
    cellValue: { 1: { 0: { p: cellDoc } } },
  });
  await expect(
    f.collab.submitChangeset(
      { changeset: change },
      { userID: f.owner.id, memberID: 'test-member' },
    ),
  ).rejects.toThrow('Insert images');
  expect((await f.collab.load(f.owner.id, f.sheet.id)).revision).toBe(1);
  const unsafeResource = {
    name: 'SHEET_DRAWING_PLUGIN',
    data: JSON.stringify({ first: { data: { picture: { source } } } }),
  };
  f.db
    .prepare('INSERT OR REPLACE INTO spinel_generation_resources VALUES(?,?,?)')
    .run(f.sheet.id, f.sheet.id, JSON.stringify([unsafeResource]));
  await expect(f.collab.load(f.owner.id, f.sheet.id)).rejects.toThrow('Insert images');
  await expect(f.collab.prepare(f.owner.id, f.sheet.id)).rejects.toThrow('Insert images');
});

// A workbook whose first cell holds an image, imported the way a person would.
async function cellImageWorkbook(f: Awaited<ReturnType<typeof fixture>>) {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#ff9900' } })
    .png()
    .toBuffer();
  const { PortableFiles } = await import('../workspace/portable.ts');
  const cell = {
    ...getDocsEmptySnapshot('cell-doc'),
    drawings: {
      picture: {
        unitId: 'cell-doc',
        subUnitId: 'cell-doc',
        drawingId: 'picture',
        drawingType: 0,
        imageSourceType: 'BASE64',
        source: `data:image/png;base64,${bytes.toString('base64')}`,
      },
    },
  };
  const imported = await new PortableFiles(f.workspace).import(
    f.owner.id,
    {
      filename: 'cell.json',
      parentId: null,
      snapshot: {
        ...f.snapshot,
        sheets: { first: { ...f.snapshot.sheets.first, cellData: { 0: { 0: { p: cell } } } } },
      },
    },
    () => {},
  );
  await f.collab.prepare(f.owner.id, imported.id);
  const before = (await f.collab.load(f.owner.id, imported.id)).snapshot as IWorkbookData;
  const preserved = before.sheets.first.cellData![0]![0];
  const source = (preserved!.p!.drawings!.picture as unknown as { source: string }).source;
  return { bytes, cell, imported, preserved: preserved!, source };
}

test('moving and restoring an existing Sheet cell image preserves its identity and access without allowing foreign targets', async () => {
  const f = await fixture();
  const { bytes, cell, imported, preserved, source } = await cellImageWorkbook(f);
  const { HistoryStore } = await import('../history/store.ts');
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const checkpoint = await history.nameCurrent(f.owner.id, imported.id, 'Original image');
  const change = { ...f.edit(), unitID: imported.id };
  change.mutations[0].data = JSON.stringify({
    unitId: imported.id,
    subUnitId: 'first',
    cellValue: { 0: { 0: null }, 1: { 0: preserved } },
  });
  const committed = await f.collab.submitChangeset(
    { changeset: change },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  expect(committed.status).toBe('committed');
  if (committed.status !== 'committed') throw new Error('Expected a committed image move.');
  const moved = (await f.collab.load(f.owner.id, imported.id)).snapshot as IWorkbookData;
  expect(moved.sheets.first.cellData![1]![0]!.p?.drawings?.picture).toMatchObject({
    unitId: 'cell-doc',
    subUnitId: 'cell-doc',
  });
  for (const data of [
    { unitId: f.sheet.id, subUnitId: 'first', cellValue: { 1: { 0: preserved } } },
    {
      unitId: imported.id,
      subUnitId: 'first',
      cellValue: {
        1: {
          0: {
            p: { ...cell, drawings: { picture: { ...cell.drawings.picture, unitId: f.sheet.id } } },
          },
        },
      },
    },
  ]) {
    const bad = {
      ...change,
      baseRev: 2,
      reqId: 2,
      mutations: [{ id: SetRangeValuesMutation.id, data: JSON.stringify(data) }],
    };
    await expect(
      f.collab.submitChangeset({ changeset: bad }, { userID: f.owner.id, memberID: 'test-member' }),
    ).rejects.toThrow('Cross-document changes are not allowed.');
  }
  const removal = await f.collab.submitChangeset(
    {
      changeset: {
        ...change,
        baseRev: 2,
        reqId: 3,
        mutations: [
          {
            id: SetRangeValuesMutation.id,
            data: JSON.stringify({
              unitId: imported.id,
              subUnitId: 'first',
              cellValue: { 1: { 0: null } },
            }),
          },
        ],
      },
    },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  expect(removal.status).toBe('committed');
  if (removal.status !== 'committed') throw new Error('Expected a committed image removal.');
  await history.restore(f.owner.id, imported.id, checkpoint.id, imported.id, randomUUID());
  const generation = f.collab.generations.active(imported.id);
  expect(generation.unitId).not.toBe(imported.id);
  const restored = (await f.collab.load(f.owner.id, imported.id)).snapshot as IWorkbookData;
  expect(restored.sheets.first.cellData![0]![0]!.p?.drawings?.picture).toMatchObject({
    unitId: 'cell-doc',
    subUnitId: 'cell-doc',
    source,
  });
  f.workspace.share(f.owner.id, imported.id, f.viewer.id, 'viewer');
  expect(
    Buffer.from(f.docs.image(f.viewer.id, imported.id, source.split('/').at(-1)!).data),
  ).toEqual(bytes);
  f.workspace.share(f.owner.id, imported.id, f.viewer.id, null);
  expect(() => f.docs.image(f.viewer.id, imported.id, source.split('/').at(-1)!)).toThrow();
});

test('cell images and plain cell rich text travel through every cell-data mutation', async () => {
  const f = await fixture();
  const { cell, imported, preserved } = await cellImageWorkbook(f);
  const original = (await f.collab.load(f.owner.id, imported.id)).snapshot as IWorkbookData;
  let revision = 1;
  const submit = (id: string, data: unknown) =>
    f.collab.submitChangeset(
      {
        changeset: {
          ...f.edit(),
          unitID: imported.id,
          baseRev: revision,
          reqId: revision,
          mutations: [{ id, data: JSON.stringify(data) }],
        },
      },
      { userID: f.owner.id, memberID: 'test-member' },
    );
  const commits = async (id: string, data: unknown) => {
    await expect(submit(id, data)).resolves.toMatchObject({ status: 'committed' });
    revision++;
  };
  const range = (row: number) => ({ startRow: row, endRow: row, startColumn: 0, endColumn: 0 });
  // Cut/paste and drag-moving cells.
  await commits('sheet.mutation.move-range', {
    unitId: imported.id,
    fromRange: range(0),
    toRange: range(2),
    from: { subUnitId: 'first', value: { 0: { 0: null } } },
    to: { subUnitId: 'first', value: { 2: { 0: preserved } } },
  });
  // Duplicating a sheet, and undoing a sheet deletion.
  await commits('sheet.mutation.insert-sheet', {
    unitId: imported.id,
    index: 1,
    sheet: {
      ...original.sheets.first,
      id: 'copy',
      name: 'Copy',
      cellData: { 2: { 0: preserved } },
    },
  });
  // Rich text without its own ID or drawings stays an ordinary cell edit.
  const plain = { body: { dataStream: 'Plain\r\n' } };
  await commits('sheet.mutation.set-range-values', {
    unitId: imported.id,
    subUnitId: 'first',
    cellValue: { 3: { 0: { p: plain } } },
  });
  const loaded = (await f.collab.load(f.owner.id, imported.id)).snapshot as IWorkbookData;
  for (const sheet of ['first', 'copy'])
    expect(loaded.sheets[sheet].cellData![2]![0]!.p?.drawings?.picture).toMatchObject({
      unitId: 'cell-doc',
    });
  expect(loaded.sheets.first.cellData![3]![0]!.p?.body?.dataStream).toBe('Plain\r\n');
  const foreign = { ...cell.drawings.picture, unitId: f.sheet.id };
  for (const p of [
    { ...preserved.p, drawings: { picture: foreign } },
    { ...plain, drawings: { picture: { ...foreign, unitId: 'cell-doc' } } },
  ])
    await expect(
      submit('sheet.mutation.move-range', {
        unitId: imported.id,
        fromRange: range(2),
        toRange: range(4),
        from: { subUnitId: 'first', value: { 2: { 0: null } } },
        to: { subUnitId: 'first', value: { 4: { 0: { p } } } },
      }),
    ).rejects.toThrow('Cross-document changes are not allowed.');
  // Only cell rich text (`<row>.<column>.p`) may name its own Doc. An `id` anywhere
  // else, or a `p` without a row and column above it, can't retarget the unit.
  for (const extra of [
    { sheet: { id: f.sheet.id, unitId: f.sheet.id } },
    { extra: { p: { id: f.sheet.id, unitId: f.sheet.id } } },
  ])
    await expect(
      submit('sheet.mutation.set-range-values', {
        unitId: imported.id,
        subUnitId: 'first',
        cellValue: { 5: { 0: { v: 1 } } },
        ...extra,
      }),
    ).rejects.toThrow('Cross-document changes are not allowed.');
});
