import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { UniverType } from '@univerjs/protocol';
import type { IChangeset } from '@univerjs/protocol';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { makeArchive, restoreArchive } from '../backup/archive.ts';
import { CollaborationStore } from './service.ts';

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
  cleanup.push(() => db.close());
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
  cleanup.push(() => collab.close());
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
    revision: 2,
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
    load,
    edit,
  };
}

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
  expect((await f.load()).targetRevision).toBe(1);
  expect(
    ((await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe(42);
});
