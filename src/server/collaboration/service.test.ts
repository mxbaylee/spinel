import { encodeOfflineReplay, decodeOfflineReplay } from '../../shared/offlineReplay.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, LocaleType, JSONX } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { UniverType } from '@univerjs/protocol';
import type { IChangeset } from '@univerjs/protocol';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { RevertRevisionMutation } from '@univerjs-pro/collaboration';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { makeArchive, restoreArchive } from '../backup/archive.ts';
import { CollaborationStore } from './service.ts';
import { TrashStore } from '../workspace/trash.ts';

// SDK materializer cold startup is slower while the separate 25-hour browser soak runs.
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
  const load = (id = sheet.id, userID = owner.id) =>
    collab.service.getUnitLoadDataWithBlocks(
      {
        unitID: id,
        type: id === sheet.id ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC,
        revision: 0,
      },
      { userID },
    );
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
  await f.collab.service.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  const changeset = {
    ...f.edit(),
    baseRev: 2,
    reqId: 2,
    mutations: [
      {
        id: RevertRevisionMutation.id,
        data: JSON.stringify({ unitId: f.sheet.id, revision: 1 }),
      },
    ],
  };
  await expect(
    f.collab.service.submitChangeset(
      { changeset },
      { userID: f.owner.id, memberID: 'test-member' },
    ),
  ).resolves.toMatchObject({
    status: 'rejected',
    error: {
      code: 'PERMISSION_DENIED',
      message: 'Restore versions through Spinel so the current state is kept.',
    },
  });
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
  expect(await f.collab.service.submitChangeset({ changeset }, context)).toMatchObject({
    status: 'committed',
  });
  expect(
    ((await f.collab.load(f.owner.id, f.doc.id)).snapshot as IDocumentData).body?.dataStream,
  ).toBe(changedBody.dataStream);
  await expect(
    f.collab.service.submitChangeset(
      {
        changeset: {
          ...changeset,
          baseRev: 2,
          reqId: 2,
          mutations: [
            {
              id: RevertRevisionMutation.id,
              data: JSON.stringify({ unitId: f.doc.id, revision: 1 }),
            },
          ],
        },
      },
      context,
    ),
  ).resolves.toMatchObject({
    status: 'rejected',
    error: {
      code: 'PERMISSION_DENIED',
      message: 'Restore versions through Spinel so the current state is kept.',
    },
  });
  const current = await f.collab.load(f.owner.id, f.doc.id);
  expect(current.revision).toBe(2);
  expect((current.snapshot as IDocumentData).body).toEqual(changedBody);
});

test('permanent purge waits for in-flight migration before acknowledging deletion', async () => {
  const f = await fixture();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.collab.service.use('createUnit', async (_context, next) => {
    enter();
    await gate;
    await next();
  });
  const preparing = f.collab.prepare(f.owner.id, f.doc.id).catch((error) => error);
  await entered;
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(f.doc.id);
  let finished = false;
  const purge = f.collab.purgeDeleted().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(finished).toBe(false);
  expect(
    f.db.prepare('SELECT 1 FROM collaboration_purge WHERE item_id=?').get(f.doc.id),
  ).toBeDefined();
  release();
  expect(await preparing).toBeInstanceOf(Error);
  await purge;
  expect(
    await f.collab.service.dbAdapter.getUnit(
      { userID: f.owner.id, customData: {}, request: {} },
      f.doc.id,
    ),
  ).toBeNull();
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
      f.collab.service.submitChangeset(
        { changeset },
        { userID: f.owner.id, memberID: 'test-member' },
      ),
    ).resolves.toMatchObject({ status: 'rejected', error: { code: 'INVALID_REQUEST' } });
    const saved = await f.collab.load(f.owner.id, f.doc.id);
    expect(saved.revision).toBe(1);
    expect((saved.snapshot as IDocumentData).drawings).toEqual({});
  }
});

test('permanent purge is durable across an interrupted SDK deletion and soft restore preserves changes', async () => {
  const f = await fixture();
  const trash = new TrashStore(f.workspace);
  await f.collab.prepare(f.owner.id, f.sheet.id);
  await f.collab.service.submitChangeset(
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
  const remove = vi
    .spyOn(f.collab.service, 'deleteUnits')
    .mockRejectedValueOnce(new Error('interrupted'));
  await expect(f.collab.purgeDeleted()).rejects.toThrow('interrupted');
  expect(f.db.prepare('SELECT count(*) AS n FROM collaboration_purge').get()?.n).toBe(1);
  remove.mockRestore();
  await f.collab.purgeDeleted();
  expect(f.db.prepare('SELECT count(*) AS n FROM collaboration_purge').get()?.n).toBe(0);
  // Inspect through the public adapter to prove bytes were hard-deleted, not merely hidden by ACL.
  expect(
    await f.collab.service.dbAdapter.getUnit(
      { userID: f.owner.id, customData: {}, request: {} },
      f.sheet.id,
    ),
  ).toBeNull();
});

test('expired network sessions cannot submit and cross-unit mutations cannot modify another document', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  const session = f.auth.createSession(f.owner.id);
  f.auth.revokeSession(session.session.token_hash);
  await expect(
    f.collab.service.submitChangeset(
      { changeset: f.edit() },
      {
        userID: f.owner.id,
        memberID: 'test-member',
        customData: { sessionHash: session.session.token_hash },
      },
    ),
  ).resolves.toMatchObject({ status: 'rejected', error: { code: 'PERMISSION_DENIED' } });
  const changeset = f.edit();
  changeset.mutations[0].data = JSON.stringify({
    unitId: f.doc.id,
    subUnitId: 'first',
    cellValue: { 0: { 0: { v: 'foreign' } } },
  });
  await expect(
    f.collab.service.submitChangeset(
      { changeset },
      { userID: f.owner.id, memberID: 'test-member' },
    ),
  ).resolves.toMatchObject({ status: 'rejected', error: { code: 'PERMISSION_DENIED' } });
  expect((await f.load()).targetRevision).toBe(1);
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
  expect(sheetBefore.targetRevision).toBe(1);
  expect(docBefore.targetRevision).toBe(1);
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

test('an interrupted migration stays fenced and retries without overwriting an existing unit', async () => {
  const f = await fixture();
  const create = vi
    .spyOn(f.collab.service, 'createUnitFromData')
    .mockRejectedValueOnce(new Error('interrupted'));
  await expect(f.collab.prepare(f.owner.id, f.sheet.id)).rejects.toThrow('interrupted');
  expect(
    f.db.prepare('SELECT state FROM workspace_collaboration WHERE item_id=?').get(f.sheet.id)
      ?.state,
  ).toBe('preparing');
  expect(() =>
    f.sheets.save(f.owner.id, f.sheet.id, {
      snapshot: f.snapshot,
      revision: 1,
      writeId: randomUUID(),
    }),
  ).toThrow('live collaboration');
  create.mockRestore();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  const before = await f.load();
  f.db
    .prepare("UPDATE workspace_collaboration SET state='preparing' WHERE item_id=?")
    .run(f.sheet.id);
  await f.collab.prepare(f.owner.id, f.sheet.id);
  expect(await f.load()).toEqual(before);
});

test('service read, edit and lifecycle boundaries reuse current workspace grants', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  expect((await f.load(f.sheet.id, f.viewer.id)).targetRevision).toBe(1);
  for (const user of [f.other, f.admin]) {
    await expect(f.collab.prepare(user.id, f.sheet.id)).rejects.toThrow('not available');
    await expect(f.load(f.sheet.id, user.id)).rejects.toThrow('not available');
  }
  const before = f.workspace.get(f.owner.id, f.sheet.id).updatedAt;
  f.auth.now = () => before + 1000;
  const result = await f.collab.service.submitChangeset(
    { changeset: f.edit(f.viewer.id) },
    { userID: f.viewer.id, memberID: 'test-member' },
  );
  expect(result.status).toBe('rejected');
  expect(f.workspace.get(f.owner.id, f.sheet.id).updatedAt).toBe(before);
  if (result.status === 'rejected') expect(result.error.code).toBe('PERMISSION_DENIED');
  expect((await f.load()).targetRevision).toBe(1);
  await expect(
    f.collab.service.deleteUnits(
      { unitIDs: [f.sheet.id], hardDelete: true },
      { userID: f.owner.id },
    ),
  ).rejects.toThrow('through Spinel');
  f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, null);
  await expect(f.load(f.sheet.id, f.viewer.id)).rejects.toThrow('not available');
});

test('actual collaboration changes survive encrypted application backup, fresh restore and SDK reopen', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  await f.collab.prepare(f.owner.id, f.doc.id);
  const savedAt = f.workspace.get(f.owner.id, f.sheet.id).updatedAt + 1000;
  f.auth.now = () => savedAt;
  const result = await f.collab.service.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  expect(result.status).toBe('committed');
  expect(f.workspace.get(f.owner.id, f.sheet.id).updatedAt).toBe(savedAt);
  const expectedSheet = await f.load(),
    expectedDoc = await f.load(f.doc.id);
  expect(expectedSheet.targetRevision).toBe(2);
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
  for (const [id, type, expected] of [
    [f.sheet.id, UniverType.UNIVER_SHEET, expectedSheet],
    [f.doc.id, UniverType.UNIVER_DOC, expectedDoc],
  ] as const) {
    await collab.prepare(f.owner.id, id);
    expect(
      await collab.service.getUnitLoadDataWithBlocks(
        { unitID: id, type, revision: 0 },
        { userID: f.owner.id },
      ),
    ).toEqual(expected);
  }
  expect(workspace.get(f.viewer.id, f.sheet.id).access).toBe('viewer');
  expect(
    ((await collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(99);
  // Two SDK runtimes plus authenticated archive/restore need headroom on loaded CI hosts.
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
  f.collab.service.use('applyChangeset', async (_context, next) => {
    f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, null);
    await next();
  });
  const before = f.workspace.get(f.owner.id, f.sheet.id).updatedAt;
  f.auth.now = () => before + 1000;
  const result = await f.collab.service.submitChangeset(
    { changeset: f.edit(f.viewer.id) },
    { userID: f.viewer.id, memberID: 'test-member' },
  );
  expect(result.status).toBe('rejected');
  expect(f.workspace.get(f.owner.id, f.sheet.id).updatedAt).toBe(before);
  if (result.status === 'rejected') expect(result.error.code).toBe('PERMISSION_DENIED');
  expect(audit.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
    'collaboration.edit_denied',
  );
  expect((await f.load()).targetRevision).toBe(1);
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
    const result = await f.collab.service.submitChangeset(
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
    if (role === 'viewer')
      expect(result).toMatchObject({ status: 'rejected', error: { code: 'PERMISSION_DENIED' } });
    expect((await f.load()).targetRevision).toBe(role === 'viewer' ? 1 : 2);
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
  const blocker = f.collab.service.use('applyChangeset', async (_context, next) => {
    entered();
    await gate;
    await next();
  });
  cleanup.push(() => {
    release();
    blocker.dispose();
  });
  const submitted = f.collab.service.submitChangeset(
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
  await expect(submitted).resolves.toMatchObject({
    status: 'rejected',
    error: { code: 'PERMISSION_DENIED' },
  });
  f.workspace.links.finish(f.sheet.id, revoked.epoch, false);
  expect((await f.load()).targetRevision).toBe(1);
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
  const blocker = f.collab.service.use('commitChangeset', async (_context, next) => {
    entered();
    await gate;
    await next();
  });
  cleanup.push(() => {
    release();
    blocker.dispose();
  });
  const accepted = f.collab.service.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  await committing;
  const requestId = randomUUID();
  const restored = history.restore(f.owner.id, f.sheet.id, target.id, f.sheet.id, requestId);
  await vi.waitFor(() => expect(f.collab.generations.restoring(f.sheet.id)).toBe(true));
  await expect(
    f.collab.service.submitChangeset(
      { changeset: { ...f.edit(), reqId: 2 } },
      { userID: f.owner.id, memberID: 'test-member' },
    ),
  ).resolves.toMatchObject({ status: 'rejected', error: { code: 'PERMISSION_DENIED' } });
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
    f.collab.service.submitChangeset(
      { changeset: { ...f.edit(), reqId: 3 } },
      { userID: f.owner.id, memberID: 'test-member' },
    ),
  ).resolves.toMatchObject({ status: 'rejected', error: { code: 'PERMISSION_DENIED' } });
  const edit = f.edit();
  edit.unitID = receipt.nextUnit;
  edit.mutations[0].data = JSON.stringify({
    unitId: receipt.nextUnit,
    subUnitId: 'first',
    cellValue: { 0: { 0: { v: 123 } } },
  });
  await f.collab.service.submitChangeset(
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

test('SDK generation restore retains multi-tab formulas, styles, resources and stored Doc images after later edits', async () => {
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
  await f.collab.service.submitChangeset(
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
  await f.collab.service.submitChangeset(
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
  await f.collab.service.submitChangeset(
    { changeset },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  const after = (await f.collab.load(f.owner.id, f.doc.id)).snapshot as IDocumentData;
  expect(after.body?.dataStream).toBe('Image still here\r\n');
  expect(after.drawings?.photo).toMatchObject(drawing);
  expect(Buffer.from(f.docs.image(f.owner.id, f.doc.id, image.id).data)).toEqual(bytes);
});

test('file-backed restart cancels a staged SDK replacement and preserves a completed restore and receipt', async () => {
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
  await f.collab.service.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  // Fault injection models termination after the SDK stage is durable but before
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
    await f.collab.service.dbAdapter.getUnit(
      { userID: f.owner.id, customData: {}, request: {} },
      String(staged.next_unit),
    ),
  ).not.toBeNull();
  await history.close();
  historyClosed = true;
  integrity(f.db, 'before closing staged fixture');
  await f.stop();
  integrity(f.db, 'after closing staged SDK');
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
    await collab.service.dbAdapter.getUnit(
      { userID: f.owner.id, customData: {}, request: {} },
      String(staged.next_unit),
    ),
  ).toBeNull();
  const request = randomUUID();
  const completed = await step('complete restore after first restart', () =>
    reopened.restore(f.owner.id, f.sheet.id, target.id, f.sheet.id, request),
  );
  await reopened.close();
  reopenedClosed = true;
  integrity(db, 'before closing completed SDK');
  await collab.close();
  integrity(db, 'after closing completed SDK');
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

test('offline replay preserves complete binary blocks, exact revision and generation identity across JSON', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  const original = await f.collab.offlineReplay(f.viewer.id, f.sheet.id, f.sheet.id, 1);
  expect(original.access).toBe('viewer');
  expect(original.accountId).toBe(f.viewer.id);
  expect(original.data.targetRevision).toBe(1);
  expect(original.data.sheetBlocks.length).toBeGreaterThan(0);
  const roundtrip = decodeOfflineReplay(JSON.parse(JSON.stringify(encodeOfflineReplay(original))));
  expect(roundtrip).toEqual(original);
  expect(roundtrip.data.sheetBlocks[0].data).toBeInstanceOf(Uint8Array);
  await f.collab.service.submitChangeset(
    { changeset: f.edit() },
    { userID: f.owner.id, memberID: 'test-member' },
  );
  const pinned = await f.collab.offlineReplay(f.owner.id, f.sheet.id, f.sheet.id, 1);
  expect(pinned.data).toEqual(original.data);
  const latest = await f.collab.offlineReplay(f.owner.id, f.sheet.id, f.sheet.id, 0);
  expect(latest.data.targetRevision).toBeGreaterThan(1);
  const { HistoryStore } = await import('../history/store.ts');
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const checkpoint = await history.nameCurrent(f.owner.id, f.sheet.id, 'Replay generation');
  const restored = await history.restore(
    f.owner.id,
    f.sheet.id,
    checkpoint.id,
    f.sheet.id,
    randomUUID(),
  );
  const next = await f.collab.offlineReplay(f.owner.id, f.sheet.id, restored.nextUnit, 0);
  expect(next.unitId).toBe(restored.nextUnit);
  expect(next.data.snapshot.unitID).toBe(restored.nextUnit);
  expect(next.revisionOffset).toBeGreaterThan(0);
  expect(next.data.targetRevision + next.revisionOffset).toBe(restored.revision);
  await expect(f.collab.offlineReplay(f.owner.id, f.sheet.id, f.sheet.id, 1)).rejects.toThrow(
    'changed versions',
  );
  await f.collab.prepare(f.owner.id, f.doc.id);
  const doc = await f.collab.offlineReplay(f.owner.id, f.doc.id, f.doc.id, 0);
  expect(decodeOfflineReplay(JSON.parse(JSON.stringify(encodeOfflineReplay(doc))))).toEqual(doc);
});

test('offline replay refuses unrelated/admin access and a grant changed while reading', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  for (const user of [f.other.id, f.admin.id, 'guest:untrusted'])
    await expect(f.collab.offlineReplay(user, f.sheet.id, f.sheet.id, 0)).rejects.toThrow();
  await expect(f.collab.offlineReplay(f.owner.id, f.sheet.id, f.sheet.id, -1)).rejects.toThrow(
    'valid SDK revision',
  );
  const data = await f.load();
  vi.spyOn(f.collab.service, 'getUnitLoadDataWithBlocks').mockImplementationOnce(async () => {
    f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, 'editor');
    return data;
  });
  await expect(f.collab.offlineReplay(f.viewer.id, f.sheet.id, f.sheet.id, 0)).rejects.toThrow(
    'Access or the document version changed',
  );
});

test('offline replay never returns a generation replaced while acquisition was in flight', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  const { HistoryStore } = await import('../history/store.ts');
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const checkpoint = await history.nameCurrent(f.owner.id, f.sheet.id, 'Before download race');
  const original = await f.load();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  cleanup.push(() => resume.resolve());
  vi.spyOn(f.collab.service, 'getUnitLoadDataWithBlocks').mockImplementationOnce(async () => {
    entered.resolve();
    await resume.promise;
    return original;
  });
  const reading = f.collab.offlineReplay(f.owner.id, f.sheet.id, f.sheet.id, 0);
  const rejected = expect(reading).rejects.toThrow('Access or the document version changed');
  await entered.promise;
  await history.restore(f.owner.id, f.sheet.id, checkpoint.id, f.sheet.id, randomUUID());
  resume.resolve();
  await rejected;
});

test('Sheet image validation fences live mutations, historical replay bases and preserved resources', async () => {
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
    f.collab.service.submitChangeset(
      { changeset: change },
      { userID: f.owner.id, memberID: 'test-member' },
    ),
  ).rejects.toThrow('Insert images');
  expect((await f.collab.load(f.owner.id, f.sheet.id)).revision).toBe(1);
  const original = await f.load();
  // A pre-integration legacy snapshot may be unsafe even when current head is clean.
  const legacy = structuredClone(original);
  legacy.snapshot.workbook!.resources.push({
    name: 'SHEET_DRAWING_PLUGIN',
    data: JSON.stringify({ first: { data: { picture: { source } } } }),
  });
  vi.spyOn(f.collab.service, 'getUnitLoadDataWithBlocks').mockResolvedValueOnce(legacy);
  await expect(f.collab.offlineReplay(f.owner.id, f.sheet.id, f.sheet.id, 1)).rejects.toThrow(
    'Insert images',
  );
  const tail = structuredClone(original);
  tail.targetRevision = 3;
  tail.changesets = [
    {
      ...f.edit(),
      baseRev: 1,
      revision: 2,
      mutations: [
        {
          id: SetRangeValuesMutation.id,
          data: JSON.stringify({
            unitId: f.sheet.id,
            subUnitId: 'first',
            cellValue: { 1: { 0: { p: cellDoc } } },
          }),
        },
      ],
    },
    {
      ...f.edit(),
      baseRev: 2,
      revision: 3,
      reqId: 2,
      mutations: [
        {
          id: SetRangeValuesMutation.id,
          data: JSON.stringify({
            unitId: f.sheet.id,
            subUnitId: 'first',
            cellValue: { 1: { 0: null } },
          }),
        },
      ],
    },
  ];
  vi.spyOn(f.collab.service, 'getUnitLoadDataWithBlocks').mockResolvedValueOnce(tail);
  await expect(f.collab.offlineReplay(f.owner.id, f.sheet.id, f.sheet.id, 3)).rejects.toThrow(
    'Insert images',
  );
  const unsafeResource = {
    name: 'SHEET_DRAWING_PLUGIN',
    data: JSON.stringify({ first: { data: { picture: { source } } } }),
  };
  f.db
    .prepare('INSERT OR REPLACE INTO spinel_generation_resources VALUES(?,?,?)')
    .run(f.sheet.id, f.sheet.id, JSON.stringify([unsafeResource]));
  await expect(f.collab.offlineReplay(f.owner.id, f.sheet.id, f.sheet.id, 1)).rejects.toThrow(
    'Insert images',
  );
});

test('moving an existing Sheet cell image preserves its embedded Doc identity without allowing foreign mutation targets', async () => {
  const f = await fixture();
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
  const change = { ...f.edit(), unitID: imported.id };
  change.mutations[0].data = JSON.stringify({
    unitId: imported.id,
    subUnitId: 'first',
    cellValue: { 0: { 0: null }, 1: { 0: preserved } },
  });
  expect(
    (
      await f.collab.service.submitChangeset(
        { changeset: change },
        { userID: f.owner.id, memberID: 'test-member' },
      )
    ).status,
  ).toBe('committed');
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
      f.collab.service.submitChangeset(
        { changeset: bad },
        { userID: f.owner.id, memberID: 'test-member' },
      ),
    ).rejects.toThrow('Cross-document');
  }
});
