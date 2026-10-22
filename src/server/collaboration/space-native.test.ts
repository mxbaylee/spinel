import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import { JSONX } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { UniverType } from '@univerjs/protocol';
import type { IChangeset } from '@univerjs/protocol';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { SpaceRecoveryStore } from '../workspace/space-recovery.ts';
import { SpaceLifecycleStore } from '../workspace/space-lifecycle.ts';
import { HistoryStore } from '../history/store.ts';
import { CollaborationStore } from './service.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(spaceReview = true) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-space-native-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'spinel.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    editor = auth.createUser('Editor'),
    viewer = auth.createUser('Viewer'),
    outsider = auth.createUser('Outsider'),
    operator = auth.createUser('Operator', true);
  const spaces = new SpaceStore(workspace);
  const space = spaces.createRoot(owner.id, { name: 'Review project', parentId: null }).space;
  const sheet = spaces.createChild(owner.id, space.id, {
    name: 'Budget',
    kind: 'sheet',
    parentId: space.id,
  }).item;
  const doc = spaces.createChild(owner.id, space.id, {
    name: 'Notes',
    kind: 'doc',
    parentId: sheet.id,
  }).item;
  const otherSpace = spaces.createRoot(owner.id, { name: 'Another project', parentId: null }).space;
  spaces.share(owner.id, space.id, editor.id, 'editor');
  spaces.share(owner.id, space.id, viewer.id, 'viewer');
  const sessions = new Map(
    [owner, editor, viewer, outsider, operator].map((user) => [
      user.id,
      auth.createSession(user.id),
    ]),
  );
  const context = (user = owner.id, itemId = sheet.id) => ({
    sessionHash: sessions.get(user)!.session.token_hash,
    spaceId: space.id,
    spaceItem: itemId,
  });
  const collab = new CollaborationStore(workspace, path, { spaceReview });
  cleanup.push(() => collab.close());
  const history = new HistoryStore(workspace, collab);
  cleanup.push(() => history.close());
  const sheetEdit = (user = editor.id, baseRev = 1): IChangeset => ({
    unitID: sheet.id,
    type: UniverType.UNIVER_SHEET,
    userID: user,
    memberID: 'space-member',
    sid: 'space-session',
    reqId: baseRev,
    baseRev,
    revision: 0,
    mutations: [
      {
        id: SetRangeValuesMutation.id,
        data: JSON.stringify({
          unitId: sheet.id,
          subUnitId: 'first',
          cellValue: { 0: { 0: { v: 'Saved in this Space' } } },
        }),
      },
    ],
  });
  const submit = (changeset: IChangeset, custom = context(changeset.userID, changeset.unitID)) =>
    collab.service.submitChangeset(
      { changeset },
      { userID: changeset.userID, memberID: changeset.memberID, customData: custom },
    );
  return {
    db,
    auth,
    workspace,
    owner,
    editor,
    viewer,
    outsider,
    operator,
    spaces,
    space,
    sheet,
    doc,
    otherSpace,
    sessions,
    context,
    collab,
    history,
    sheetEdit,
    submit,
  };
}

test('native Space admission is default-off and never inferred from an accessible child ID', async () => {
  const f = await fixture(false);
  expect(() => f.collab.access(f.owner.id, f.sheet.id, false, f.context())).toThrow(
    'not available',
  );
  await expect(f.collab.prepare(f.owner.id, f.sheet.id, f.context())).rejects.toThrow(
    'not available',
  );
  expect(() => f.workspace.get(f.owner.id, f.sheet.id)).toThrow();
  expect(f.db.prepare('SELECT * FROM workspace_collaboration').all()).toEqual([]);
});

test('one native engine persists both Space editors and subtree recovery while automatic/public history stays closed', async () => {
  const f = await fixture();
  const checkpointId = randomUUID();
  f.db
    .prepare('INSERT INTO history_checkpoints VALUES(?,?,?,?,?,?,?)')
    .run(checkpointId, f.doc.id, 'native', 1, f.auth.now(), 'Existing checkpoint', gzipSync('{}'));
  // These unnamed entries occupy the same aged retention bucket. Both must
  // remain while Space history is unavailable, not merely the named version.
  for (const revision of [2, 3])
    f.db
      .prepare('INSERT INTO history_checkpoints VALUES(?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        f.doc.id,
        'native',
        revision,
        f.auth.now() - 2 * 86_400_000,
        null,
        gzipSync('{}'),
      );
  const checkpoints = f.db.prepare('SELECT * FROM history_checkpoints').all();
  await f.collab.prepare(f.viewer.id, f.sheet.id, f.context(f.viewer.id));
  await f.collab.prepare(f.owner.id, f.doc.id, f.context(f.owner.id, f.doc.id));
  expect(await f.submit(f.sheetEdit())).toMatchObject({ status: 'committed' });
  const docBefore = await f.collab.load(f.editor.id, f.doc.id, f.context(f.editor.id, f.doc.id));
  const docEdit: IChangeset = {
    ...f.sheetEdit(),
    unitID: f.doc.id,
    type: UniverType.UNIVER_DOC,
    mutations: [
      {
        id: RichTextEditingMutation.id,
        data: JSON.stringify({
          unitId: f.doc.id,
          actions: new JSONX().replaceOp(['body'], (docBefore.snapshot as IDocumentData).body, {
            dataStream: 'Space notes persist\r\n',
          }),
          textRanges: [],
        }),
      },
    ],
  };
  expect(await f.submit(docEdit)).toMatchObject({ status: 'committed' });
  const sheet = await f.collab.load(f.viewer.id, f.sheet.id, f.context(f.viewer.id));
  const doc = await f.collab.load(f.viewer.id, f.doc.id, f.context(f.viewer.id, f.doc.id));
  expect((sheet.snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBe(
    'Saved in this Space',
  );
  expect((doc.snapshot as IDocumentData).body?.dataStream).toBe('Space notes persist\r\n');
  expect(sheet.access).toBe('viewer');
  expect(await f.submit(f.sheetEdit(f.viewer.id, 2))).toMatchObject({
    status: 'rejected',
    error: { code: 'PERMISSION_DENIED' },
  });
  f.spaces.updateChild(f.editor.id, f.space.id, f.sheet.id, { name: 'Renamed budget' });
  const recovery = new SpaceRecoveryStore(f.workspace);
  expect(recovery.trash(f.editor.id, f.space.id, f.sheet.id).count).toBe(2);
  await expect(
    f.collab.load(f.owner.id, f.doc.id, f.context(f.owner.id, f.doc.id)),
  ).rejects.toThrow('not available');
  expect(recovery.restore(f.editor.id, f.space.id, f.sheet.id).restoredCount).toBe(2);
  expect((await f.collab.load(f.viewer.id, f.sheet.id, f.context(f.viewer.id))).snapshot).toEqual(
    sheet.snapshot,
  );
  expect(
    (await f.collab.load(f.viewer.id, f.doc.id, f.context(f.viewer.id, f.doc.id))).snapshot,
  ).toEqual(doc.snapshot);
  await f.history.tick();
  expect(f.db.prepare('SELECT * FROM history_checkpoints').all()).toEqual(checkpoints);
  expect(f.db.prepare('SELECT * FROM history_progress').all()).toEqual([]);
  expect(() => f.history.list(f.owner.id, f.doc.id)).toThrow();
  await expect(f.collab.load(f.owner.id, f.doc.id)).rejects.toThrow('not available');
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}, 30_000);

test('exact account context refuses wrong Space/child, missing session, guest/MCP and revoked or disabled principals', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id, f.context());
  for (const custom of [
    {},
    { spaceId: f.space.id, spaceItem: f.sheet.id },
    { ...f.context(), spaceId: f.otherSpace.id },
    { ...f.context(), spaceItem: f.doc.id },
    { ...f.context(), guestItem: f.sheet.id },
    { ...f.context(), guestHash: 'forged' },
    { ...f.context(), mcpTokenHash: 'forged' },
    { ...f.context(), sessionHash: f.sessions.get(f.editor.id)!.session.token_hash },
  ]) {
    expect(() => f.collab.access(f.owner.id, f.sheet.id, false, custom)).toThrow('not available');
  }
  for (const user of [f.outsider, f.operator])
    await expect(f.collab.load(user.id, f.sheet.id, f.context(user.id))).rejects.toThrow(
      'not available',
    );
  expect(() => f.collab.access('guest:forged', f.sheet.id, false, f.context())).toThrow(
    'not available',
  );
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
  expect(() => f.collab.access(f.editor.id, f.sheet.id, true, f.context(f.editor.id))).toThrow(
    'not available',
  );
  expect(f.collab.access(f.editor.id, f.sheet.id, false, f.context(f.editor.id)).access).toBe(
    'viewer',
  );
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
  expect(() => f.collab.access(f.editor.id, f.sheet.id, false, f.context(f.editor.id))).toThrow(
    'not available',
  );
  f.auth.revokeSession(f.sessions.get(f.viewer.id)!.session.token_hash);
  expect(() => f.collab.access(f.viewer.id, f.sheet.id, false, f.context(f.viewer.id))).toThrow(
    'not available',
  );
  new SpaceLifecycleStore(f.workspace).trash(f.owner.id, f.space.id);
  expect(() => f.collab.access(f.owner.id, f.sheet.id, false, f.context())).toThrow(
    'not available',
  );
  new SpaceLifecycleStore(f.workspace).restore(f.owner.id, f.space.id);
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.collab.access(f.owner.id, f.sheet.id, false, f.context())).toThrow(
    'not available',
  );
  expect(() => f.collab.access(f.editor.id, f.sheet.id, false, f.context(f.editor.id))).toThrow(
    'not available',
  );
  f.db.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(f.owner.id);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
  expect(() => f.collab.access(f.editor.id, f.sheet.id, false, f.context(f.editor.id))).toThrow(
    'not available',
  );
}, 20_000);

test('permissions changed during materialization refuse the read and prevent a native commit', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id, f.context());
  const original = f.collab.service.getUnitLoadDataWithBlocks.bind(f.collab.service);
  const read = vi
    .spyOn(f.collab.service, 'getUnitLoadDataWithBlocks')
    .mockImplementationOnce(async (...args) => {
      const data = await original(...args);
      f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
      return data;
    });
  await expect(f.collab.load(f.editor.id, f.sheet.id, f.context(f.editor.id))).rejects.toThrow(
    'not available',
  );
  read.mockRestore();
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
  vi.spyOn(f.collab.service, 'getUnitLoadDataWithBlocks').mockImplementationOnce(
    async (...args) => {
      const data = await original(...args);
      f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
      return data;
    },
  );
  expect(await f.submit(f.sheetEdit())).toMatchObject({
    status: 'rejected',
    error: { code: 'PERMISSION_DENIED' },
  });
  const current = await f.collab.load(f.owner.id, f.sheet.id, f.context());
  expect(current.revision).toBe(1);
  expect((current.snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]).toBeUndefined();
}, 20_000);
