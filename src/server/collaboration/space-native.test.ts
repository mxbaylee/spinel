import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import sharp from 'sharp';
import { getDocsEmptySnapshot, JSONX } from '@univerjs/core';
import type { IDocumentBody, IDocumentData, IWorkbookData } from '@univerjs/core';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import type { FormulaDefinition } from '@spinel/doc-formulas';
import { RichTextEditingMutation } from '@univerjs/docs';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { UniverType } from '@univerjs/protocol';
import type { IChangeset } from '@univerjs/protocol';
import { openDatabase } from '../../../server/database.ts';
import type { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { AdminStore } from '../auth/admin.ts';
import { AccessTokens } from '../auth/tokens.ts';
import { InvitationService } from '../auth/invitations.ts';
import { OwnershipTransfer } from '../auth/ownership.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { guestCookieName } from '../workspace/links.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { SpaceRecoveryStore } from '../workspace/space-recovery.ts';
import { SpaceLifecycleStore } from '../workspace/space-lifecycle.ts';
import { HistoryStore } from '../history/store.ts';
import { DocFormulas } from '../formulas/service.ts';
import { digest, readKey, restoreArchive } from '../backup/archive.ts';
import { BackupService } from '../backup/service.ts';
import type { RemoteStore } from '../backup/spaces.ts';
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
  cleanup.push(() => {
    if (db.isOpen) db.close();
  });
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: spaceReview });
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
  const history = new HistoryStore(workspace, collab);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await history.close();
    } finally {
      await collab.close();
    }
  };
  cleanup.push(stop);
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
  const submit = (
    changeset: IChangeset,
    custom: Record<string, unknown> = context(changeset.userID, changeset.unitID),
  ) =>
    collab.submitChangeset(
      { changeset },
      { userID: changeset.userID, memberID: changeset.memberID, customData: custom },
    );
  return {
    directory,
    path,
    stop,
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

type NativeFixture = Awaited<ReturnType<typeof fixture>>;
const png = () =>
  sharp({ create: { width: 3, height: 2, channels: 4, background: '#aa3388' } })
    .png()
    .toBuffer();

async function editDoc(f: NativeFixture, id: string, body: IDocumentBody, image?: { url: string }) {
  const custom = f.context(f.owner.id, id);
  await f.collab.prepare(f.owner.id, id, custom);
  const before = await f.collab.load(f.owner.id, id, custom);
  const generation = f.collab.generations.active(id);
  const snapshot = before.snapshot as IDocumentData;
  let actions = new JSONX().replaceOp(['body'], snapshot.body, body);
  if (image) {
    actions = JSONX.compose(
      actions,
      new JSONX().insertOp(['drawings', 'photo'], {
        unitId: generation.unitId,
        subUnitId: generation.unitId,
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
      }),
    );
    actions = JSONX.compose(
      actions,
      snapshot.drawingsOrder
        ? new JSONX().replaceOp(['drawingsOrder'], snapshot.drawingsOrder, [
            ...snapshot.drawingsOrder,
            'photo',
          ])
        : new JSONX().insertOp(['drawingsOrder'], ['photo']),
    );
  }
  const changeset: IChangeset = {
    ...f.sheetEdit(f.owner.id, before.revision - generation.offset),
    unitID: generation.unitId,
    type: UniverType.UNIVER_DOC,
    mutations: [
      {
        id: RichTextEditingMutation.id,
        data: JSON.stringify({ unitId: generation.unitId, actions, textRanges: [] }),
      },
    ],
  };
  expect(await f.submit(changeset, custom)).toMatchObject({ status: 'committed' });
  return f.collab.load(f.owner.id, id, custom);
}

function tableRows(db: DatabaseSync, name: string) {
  const key = (row: unknown) =>
    JSON.stringify(row, (_name, value: unknown) =>
      typeof value === 'bigint' ? String(value) : value,
    );
  // Compare row contents without assuming rowid exists in an SDK-owned table.
  return db
    .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
    .all()
    .sort((left, right) => key(left).localeCompare(key(right)));
}

function persistentRows(db: DatabaseSync) {
  return Object.fromEntries(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('spinel_recovery','backup_state') ORDER BY name",
      )
      .all()
      .map(({ name }) => [String(name), tableRows(db, String(name))]),
  );
}

test('disabled native Space admission stays closed and is never inferred from an accessible child ID', async () => {
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

test('ownership transfer keeps real native Space units and scoped account history usable by the new owner', async () => {
  const f = await fixture();
  const ordinary = f.workspace.create(f.owner.id, {
    name: 'Standalone history',
    kind: 'sheet',
    parentId: null,
  });
  f.workspace.share(f.owner.id, ordinary.id, f.editor.id, 'editor');
  f.workspace.share(f.owner.id, ordinary.id, f.viewer.id, 'viewer');
  await f.collab.prepare(f.owner.id, ordinary.id);
  const changeset = {
    ...f.sheetEdit(f.owner.id),
    unitID: ordinary.id,
    mutations: [
      {
        id: SetRangeValuesMutation.id,
        data: JSON.stringify({
          unitId: ordinary.id,
          subUnitId: 'first',
          cellValue: { 0: { 0: { v: 64 } } },
        }),
      },
    ],
  };
  expect(
    await f.collab.submitChangeset(
      { changeset },
      {
        userID: f.owner.id,
        memberID: changeset.memberID,
        customData: { sessionHash: f.sessions.get(f.owner.id)!.session.token_hash },
      },
    ),
  ).toMatchObject({ status: 'committed' });
  const checkpoint = await f.history.nameCurrent(f.owner.id, ordinary.id, 'Keep this budget');
  const checkpointSnapshot = await f.history.load(f.owner.id, ordinary.id, checkpoint.id);
  expect((checkpointSnapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBe(64);
  const historyRows = f.db
    .prepare('SELECT * FROM history_checkpoints WHERE item_id=? ORDER BY id')
    .all(ordinary.id);
  const generation = f.collab.generations.active(ordinary.id);
  await f.collab.prepare(f.owner.id, f.sheet.id, f.context());
  expect(await f.submit(f.sheetEdit())).toMatchObject({ status: 'committed' });
  const nativeBefore = await f.collab.load(f.editor.id, f.sheet.id, f.context(f.editor.id));
  const spaceGeneration = f.collab.generations.active(f.sheet.id);
  const spaceCheckpoint = await f.history.nameCurrent(
    f.owner.id,
    f.sheet.id,
    'Keep this Space budget',
    () => {},
    f.context(),
  );
  const admin = new AdminStore(f.auth, new InvitationService(f.auth, 'http://localhost:3000'));
  const handover = new OwnershipTransfer(f.auth);
  admin.disable(f.operator.id, f.owner.id);
  const preview = handover.preview(f.operator.id, f.owner.id);
  handover.transfer(f.operator.id, f.owner.id, f.editor.id, preview.confirmation);
  expect(f.collab.generations.active(ordinary.id)).toEqual(generation);
  expect(f.collab.generations.active(f.sheet.id)).toEqual(spaceGeneration);
  const nativeAfter = await f.collab.load(f.editor.id, f.sheet.id, f.context(f.editor.id));
  expect(nativeAfter.snapshot).toEqual(nativeBefore.snapshot);
  expect(nativeAfter.access).toBe('owner');
  expect((await f.collab.load(f.viewer.id, f.sheet.id, f.context(f.viewer.id))).access).toBe(
    'viewer',
  );
  expect(
    f.db.prepare('SELECT * FROM history_checkpoints WHERE item_id=? ORDER BY id').all(ordinary.id),
  ).toEqual(historyRows);
  expect(f.history.list(f.editor.id, ordinary.id)).toContainEqual(
    expect.objectContaining({
      id: checkpoint.id,
      revision: checkpoint.revision,
      name: 'Keep this budget',
    }),
  );
  expect(await f.history.load(f.editor.id, ordinary.id, checkpoint.id)).toEqual(checkpointSnapshot);
  expect(await f.history.load(f.viewer.id, ordinary.id, checkpoint.id)).toEqual(checkpointSnapshot);
  await expect(
    f.history.restore(f.viewer.id, ordinary.id, checkpoint.id, generation.unitId, randomUUID()),
  ).rejects.toThrow();
  admin.reactivate(f.operator.id, f.owner.id);
  f.sessions.set(f.owner.id, f.auth.createSession(f.owner.id));
  expect(() => f.history.list(f.owner.id, ordinary.id)).toThrow('not available');
  await expect(f.history.load(f.owner.id, ordinary.id, checkpoint.id)).rejects.toThrow(
    'not available',
  );
  await expect(f.collab.load(f.owner.id, f.sheet.id, f.context())).rejects.toThrow('not available');
  // Transfer itself preserves generations. A later explicit history restore by
  // the new owner remains the existing, independently authorized operation.
  const restored = await f.history.restore(
    f.editor.id,
    ordinary.id,
    checkpoint.id,
    generation.unitId,
    randomUUID(),
  );
  expect(restored.status).toBe('complete');
  expect((await f.collab.load(f.editor.id, ordinary.id)).snapshot).toMatchObject({
    sheets: { first: { cellData: { 0: { 0: { v: 64 } } } } },
  });
  expect(f.history.list(f.editor.id, f.sheet.id, f.context(f.editor.id))).toContainEqual(
    expect.objectContaining({ id: spaceCheckpoint.id, name: 'Keep this Space budget' }),
  );
  expect(
    await f.history.load(f.viewer.id, f.sheet.id, spaceCheckpoint.id, f.context(f.viewer.id)),
  ).toEqual(nativeBefore.snapshot);
  // Account history requires its exact Space/child context after handover too.
  expect(() => f.history.list(f.editor.id, f.sheet.id)).toThrow();
}, 45_000);

test('one native engine preserves subtree recovery and deferred checkpoints before scoped history activation', async () => {
  const f = await fixture();
  const checkpointId = randomUUID();
  const existing = {
    ...getDocsEmptySnapshot(f.doc.id),
    body: { dataStream: 'Earlier notes remain available\r\n' },
  };
  f.db
    .prepare('INSERT INTO history_checkpoints VALUES(?,?,?,?,?,?,?)')
    .run(
      checkpointId,
      f.doc.id,
      'native',
      1,
      f.auth.now(),
      'Existing checkpoint',
      gzipSync(JSON.stringify(existing)),
    );
  // These entries remain untouched until this process establishes a supported
  // scoped capture. Naming the retained version keeps it through later pruning.
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
        gzipSync(JSON.stringify(existing)),
      );
  const checkpoints = f.db.prepare('SELECT * FROM history_checkpoints').all();
  f.history.prune();
  expect(f.db.prepare('SELECT * FROM history_checkpoints').all()).toEqual(checkpoints);
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
  await expect(f.submit(f.sheetEdit(f.viewer.id, 2))).rejects.toThrow();
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
  expect(f.db.prepare('SELECT * FROM history_checkpoints WHERE id=?').get(checkpointId)).toEqual(
    checkpoints.find((row) => row.id === checkpointId),
  );
  expect(
    f.db
      .prepare("SELECT revision FROM history_progress WHERE item_id=? AND source='collaboration'")
      .get(f.doc.id),
  ).toEqual({ revision: 2 });
  expect(f.history.list(f.viewer.id, f.doc.id, f.context(f.viewer.id, f.doc.id))).toContainEqual(
    expect.objectContaining({ id: checkpointId, name: 'Existing checkpoint' }),
  );
  expect(
    await f.history.load(f.viewer.id, f.doc.id, checkpointId, f.context(f.viewer.id, f.doc.id)),
  ).toEqual(existing);
  expect(() => f.history.list(f.owner.id, f.doc.id)).toThrow();
  await expect(f.collab.load(f.owner.id, f.doc.id)).rejects.toThrow('not available');
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}, 30_000);

test('exact account context refuses wrong Space/child, missing or mixed credentials and revoked or disabled principals', async () => {
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
    await expect(f.collab.load(user.id, f.sheet.id, f.context(user.id))).rejects.toThrow();
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
  const original = f.collab.sync.load.bind(f.collab.sync);
  const read = vi
    .spyOn(f.collab.sync, 'load')
    .mockImplementationOnce((...args) => {
      const data = original(...args);
      f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
      return data;
    });
  await expect(f.collab.load(f.editor.id, f.sheet.id, f.context(f.editor.id))).rejects.toThrow(
    'not available',
  );
  read.mockRestore();
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
  f.collab.onSubmitting(async () => {
    await Promise.resolve();
    f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
  });
  await expect(f.submit(f.sheetEdit())).rejects.toThrow();
  const current = await f.collab.load(f.owner.id, f.sheet.id, f.context());
  expect(current.revision).toBe(1);
  expect((current.snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]).toBeUndefined();
}, 20_000);

test('real Space offline bundles retain exact child identity and images while guest and MCP native work stays online', async () => {
  const f = await fixture();
  const docs = new DocumentStore(f.workspace);
  const image = await docs.upload(
    f.owner.id,
    f.doc.id,
    await png(),
    'image/png',
    f.context(f.owner.id, f.doc.id),
  );
  const bytes = Buffer.from(
    docs.image(f.owner.id, f.doc.id, image.id, f.context(f.owner.id, f.doc.id)).data,
  );
  const saved = await editDoc(f, f.doc.id, { dataStream: 'A native Space image\r\n' }, image);
  const docBundle = await f.collab.offlineBundle(
    f.viewer.id,
    f.doc.id,
    () => {},
    f.context(f.viewer.id, f.doc.id),
  );
  expect(docBundle).toMatchObject({
    accountId: f.viewer.id,
    spaceId: f.space.id,
    itemId: f.doc.id,
    kind: 'doc',
    access: 'viewer',
    readOnly: true,
    unitId: f.doc.id,
    revision: saved.revision,
    revisionOffset: 0,
    images: [
      {
        source: image.url,
        mime: 'image/png',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.byteLength,
      },
    ],
  });
  expect(docBundle.snapshot).toEqual(saved.snapshot);
  expect(JSON.stringify(docBundle)).not.toContain(f.otherSpace.id);
  await f.collab.prepare(f.owner.id, f.sheet.id, f.context());
  expect(await f.submit(f.sheetEdit())).toMatchObject({ status: 'committed' });
  expect(
    await f.collab.offlineBundle(f.editor.id, f.sheet.id, () => {}, f.context(f.editor.id)),
  ).toMatchObject({
    spaceId: f.space.id,
    itemId: f.sheet.id,
    kind: 'sheet',
    access: 'editor',
    readOnly: false,
    revision: 2,
  });

  const link = f.workspace.links.begin(f.space.id, 'editor');
  f.workspace.links.finish(f.space.id, link.epoch, true);
  const guest = f.workspace.links.exchange(f.space.id, link.token!);
  const principal = f.workspace.links.principal(
    { cookie: `${guestCookieName(f.space.id)}=${guest.token}` },
    f.space.id,
  );
  const guestContext = {
    guestHash: principal.guestHash,
    guestItem: f.space.id,
    spaceId: f.space.id,
    spaceItem: f.sheet.id,
  };
  await f.collab.prepare(guest.userId, f.sheet.id, guestContext);
  const guestEdit = f.sheetEdit(guest.userId, 2);
  guestEdit.mutations[0].data = JSON.stringify({
    unitId: f.sheet.id,
    subUnitId: 'first',
    cellValue: { 0: { 0: { v: 'Guest native edit' } } },
  });
  expect(await f.submit(guestEdit, guestContext)).toMatchObject({ status: 'committed' });
  expect((await f.collab.load(guest.userId, f.sheet.id, guestContext)).snapshot).toMatchObject({
    sheets: { first: { cellData: { 0: { 0: { v: 'Guest native edit' } } } } },
  });
  await expect(
    f.collab.offlineBundle(guest.userId, f.sheet.id, () => {}, guestContext),
  ).rejects.toMatchObject({ status: 404 });
  const tokens = new AccessTokens(f.auth);
  const token = tokens.create(f.editor.id, 'Native Space assistant');
  const mcp = {
    mcpTokenHash: tokens.authenticate(token.token).hash,
    spaceId: f.space.id,
    spaceItem: f.sheet.id,
  };
  await f.collab.prepare(f.editor.id, f.sheet.id, mcp);
  const assistantEdit = f.sheetEdit(f.editor.id, 3);
  assistantEdit.mutations[0].data = JSON.stringify({
    unitId: f.sheet.id,
    subUnitId: 'first',
    cellValue: { 0: { 0: { v: 'Assistant native edit' } } },
  });
  expect(await f.submit(assistantEdit, mcp)).toMatchObject({ status: 'committed' });
  expect((await f.collab.load(f.editor.id, f.sheet.id, mcp)).snapshot).toMatchObject({
    sheets: { first: { cellData: { 0: { 0: { v: 'Assistant native edit' } } } } },
  });
  await expect(
    f.collab.offlineBundle(f.editor.id, f.sheet.id, () => {}, mcp),
  ).rejects.toMatchObject({ status: 404 });
  for (const custom of [
    {},
    { ...f.context(), spaceId: f.otherSpace.id },
    { ...f.context(), spaceItem: f.doc.id },
  ])
    await expect(
      f.collab.offlineBundle(f.owner.id, f.sheet.id, () => {}, custom),
    ).rejects.toThrow();
  const rotated = f.workspace.links.begin(f.space.id, 'viewer');
  f.workspace.links.finish(f.space.id, rotated.epoch, true);
  await expect(f.collab.load(guest.userId, f.sheet.id, guestContext)).rejects.toThrow();
  tokens.revoke(f.editor.id, token.id);
  await expect(f.collab.load(f.editor.id, f.sheet.id, mcp)).rejects.toThrow();
}, 45_000);

test('real Space offline materialization refuses late role, credential, generation and ancestry changes', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id, f.context());
  expect(await f.submit(f.sheetEdit())).toMatchObject({ status: 'committed' });
  const checkpoint = await f.history.nameCurrent(
    f.owner.id,
    f.sheet.id,
    'Offline baseline',
    () => {},
    f.context(),
  );
  const read = f.collab.load.bind(f.collab);
  const attempt = async (user: string, change: () => unknown | Promise<unknown>) => {
    const held = vi.spyOn(f.collab, 'load').mockImplementationOnce(async (...args) => {
      const result = await read(...args);
      await change();
      return result;
    });
    try {
      return await f.collab.offlineBundle(user, f.sheet.id, () => {}, f.context(user));
    } finally {
      held.mockRestore();
    }
  };
  await expect(
    attempt(f.viewer.id, () => f.spaces.share(f.owner.id, f.space.id, f.viewer.id, null)),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    attempt(f.editor.id, () => f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer')),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await f.collab.offlineBundle(f.editor.id, f.sheet.id, () => {}, f.context(f.editor.id)),
  ).toMatchObject({
    access: 'viewer',
    readOnly: true,
    spaceId: f.space.id,
  });
  await expect(
    attempt(f.owner.id, () => f.auth.revokeSession(f.sessions.get(f.owner.id)!.session.token_hash)),
  ).rejects.toMatchObject({ status: 404 });
  f.sessions.set(f.owner.id, f.auth.createSession(f.owner.id));
  const generation = f.collab.generations.active(f.sheet.id);
  await expect(
    attempt(f.owner.id, () =>
      f.history.restore(
        f.owner.id,
        f.sheet.id,
        checkpoint.id,
        generation.unitId,
        randomUUID(),
        () => {},
        f.context(),
      ),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const current = f.collab.generations.active(f.sheet.id);
  expect(current.unitId).not.toBe(generation.unitId);
  expect(await f.collab.offlineBundle(f.owner.id, f.sheet.id, () => {}, f.context())).toMatchObject(
    {
      itemId: f.sheet.id,
      spaceId: f.space.id,
      unitId: current.unitId,
      revisionOffset: current.offset,
      access: 'owner',
      readOnly: false,
    },
  );
  const recovery = new SpaceRecoveryStore(f.workspace);
  await expect(
    attempt(f.owner.id, () => recovery.trash(f.owner.id, f.space.id, f.sheet.id)),
  ).rejects.toMatchObject({ status: 404 });
  recovery.restore(f.owner.id, f.space.id, f.sheet.id);
  await expect(
    attempt(f.owner.id, () =>
      f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id),
    ),
  ).rejects.toMatchObject({ status: 404 });
}, 45_000);

test('real Space offline bundles refuse damaged stored image bytes', async () => {
  const f = await fixture();
  const docs = new DocumentStore(f.workspace);
  const image = await docs.upload(
    f.owner.id,
    f.doc.id,
    await png(),
    'image/png',
    f.context(f.owner.id, f.doc.id),
  );
  await editDoc(f, f.doc.id, { dataStream: 'Verify every image\r\n' }, image);
  expect(
    (await f.collab.offlineBundle(f.owner.id, f.doc.id, () => {}, f.context(f.owner.id, f.doc.id)))
      .images[0].sha256,
  ).toBe(image.id);
  f.db
    .prepare('UPDATE doc_images SET data=? WHERE item_id=? AND id=?')
    .run(Buffer.from('damaged'), f.doc.id, image.id);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(
    f.collab.offlineBundle(f.owner.id, f.doc.id, () => {}, f.context(f.owner.id, f.doc.id)),
  ).rejects.toMatchObject({ status: 500 });
  expect(logged).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(logged.mock.calls[0][0]))).toMatchObject({
    event: 'offline_bundle.image_damaged',
    itemId: f.doc.id,
    imageId: image.id,
  });
}, 30_000);

test('BackupService restores complete native Space data and SPN-064 transfers its recovery to the new owner', async () => {
  const f = await fixture();
  const docs = new DocumentStore(f.workspace);
  await f.collab.prepare(f.owner.id, f.sheet.id, f.context());
  const setCell = async (value: number, baseRev: number) => {
    const changeset = f.sheetEdit(f.owner.id, baseRev);
    changeset.mutations[0].data = JSON.stringify({
      unitId: f.sheet.id,
      subUnitId: 'first',
      cellValue: { 0: { 0: { v: value } } },
    });
    expect(await f.submit(changeset, f.context())).toMatchObject({ status: 'committed' });
  };
  await setCell(42, 1);
  const sheetCheckpoint = await f.history.nameCurrent(
    f.owner.id,
    f.sheet.id,
    'Approved budget',
    () => {},
    f.context(),
  );
  const sheetCheckpointSnapshot = await f.history.load(
    f.owner.id,
    f.sheet.id,
    sheetCheckpoint.id,
    f.context(),
  );
  await setCell(99, 2);
  const restore = await f.history.restore(
    f.owner.id,
    f.sheet.id,
    sheetCheckpoint.id,
    f.sheet.id,
    randomUUID(),
    () => {},
    f.context(),
  );
  expect(restore.status).toBe('complete');
  const generation = f.collab.generations.active(f.sheet.id);
  expect(generation.unitId).not.toBe(f.sheet.id);
  expect(generation.offset).toBeGreaterThan(0);
  const sheetBefore = await f.collab.load(f.owner.id, f.sheet.id, f.context());
  expect((sheetBefore.snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBe(42);

  const expression = '=Budget.Sheet1.A1';
  const parsed = parseFormula(expression)[0];
  const definition: FormulaDefinition = {
    version: 1,
    expression,
    references: [
      {
        start: parsed.start,
        end: parsed.end,
        range: parsed.range,
        itemId: f.sheet.id,
        sheetId: 'first',
      },
    ],
    format: 'currency',
  };
  const body = formulaBody('saved-total', definition);
  body.dataStream += '\r\n';
  const image = await docs.upload(
    f.owner.id,
    f.doc.id,
    await png(),
    'image/png',
    f.context(f.owner.id, f.doc.id),
  );
  const imageBytes = Buffer.from(
    docs.image(f.owner.id, f.doc.id, image.id, f.context(f.owner.id, f.doc.id)).data,
  );
  const docBefore = await editDoc(f, f.doc.id, body, image);
  expect(docFormulas((docBefore.snapshot as IDocumentData).body)[0].definition).toEqual(definition);
  const docCheckpoint = await f.history.nameCurrent(
    f.owner.id,
    f.doc.id,
    'Notes with image and Formula',
    () => {},
    f.context(f.owner.id, f.doc.id),
  );

  const first = f.spaces.createChild(f.owner.id, f.space.id, {
    name: 'First section',
    kind: 'folder',
    parentId: f.space.id,
  }).item;
  f.spaces.updateChild(f.owner.id, f.space.id, first.id, { position: 0 });
  const removed = f.spaces.createChild(f.owner.id, f.space.id, {
    name: 'Earlier removed section',
    kind: 'folder',
    parentId: f.space.id,
  }).item;
  const removedDoc = f.spaces.createChild(f.owner.id, f.space.id, {
    name: 'Retained deleted notes',
    kind: 'doc',
    parentId: removed.id,
  }).item;
  const removedBefore = await editDoc(f, removedDoc.id, {
    dataStream: 'Retained internal recovery\r\n',
  });
  const recovery = new SpaceRecoveryStore(f.workspace);
  recovery.trash(f.owner.id, f.space.id, removed.id);
  const internalTrash = f.db.prepare('SELECT * FROM workspace_space_trash ORDER BY item_id').all();
  const outer = f.workspace.create(f.owner.id, {
    name: 'Moved outer folder',
    kind: 'folder',
    parentId: null,
  });
  f.spaces.updateRoot(f.owner.id, f.space.id, { parentId: outer.id, name: 'Recovered project' });
  f.spaces.updateChild(f.owner.id, f.space.id, f.sheet.id, { name: 'Renamed budget' });
  const ordered = f.spaces
    .list(f.owner.id, f.space.id)
    .items.map(({ id, parentId, position }) => ({ id, parentId, position }));
  expect(ordered.map(({ id }) => id)).toEqual([first.id, f.sheet.id, f.doc.id]);
  const link = f.workspace.links.begin(f.space.id, 'editor');
  f.workspace.links.finish(f.space.id, link.epoch, true);
  const guest = f.workspace.links.exchange(f.space.id, link.token!);
  const guestHeaders = { cookie: `${guestCookieName(f.space.id)}=${guest.token}` };
  const principal = f.workspace.links.principal(guestHeaders, f.space.id);
  const guestContext = {
    guestHash: principal.guestHash,
    guestItem: f.space.id,
    spaceId: f.space.id,
    spaceItem: f.doc.id,
  };
  expect((await f.collab.load(guest.userId, f.doc.id, guestContext)).snapshot).toEqual(
    docBefore.snapshot,
  );
  new SpaceLifecycleStore(f.workspace).trash(f.owner.id, f.space.id);
  const owned = f.db
    .prepare('SELECT * FROM workspace_items WHERE owner_id=? ORDER BY id')
    .all(f.owner.id);

  // Settle native capture/purge work before the equality baseline. The live
  // application SQLite connection remains open for the actual online backup.
  await f.stop();
  const keyPath = join(f.directory, 'recovery.key');
  const configPath = join(f.directory, 'backup-config');
  const runtimePath = join(f.directory, 'runtime-environment');
  const remoteArchive = join(f.directory, 'remote-object.spinel');
  await writeFile(keyPath, randomBytes(32), { mode: 0o600 });
  await writeFile(runtimePath, 'NODE_ENV=production\n', { mode: 0o600 });
  await writeFile(
    configPath,
    JSON.stringify({
      region: 'nyc3',
      bucket: 'test-bucket',
      prefix: 'space-instance',
      accessKeyId: 'fixture',
      secretAccessKey: 'fixture-private-transport',
      keyFile: keyPath,
      runtimeEnvironmentFile: runtimePath,
    }),
    { mode: 0o600 },
  );
  let uploadedKey = '';
  const remove = vi.fn(async () => {
    throw new Error('No old objects should be removed.');
  });
  const remote: RemoteStore = {
    async put(key, path, sha256) {
      // BackupService disposes its staging directory after this method returns.
      await copyFile(path, remoteArchive);
      expect(await digest(remoteArchive)).toBe(sha256);
      uploadedKey = key;
    },
    async list() {
      return [uploadedKey];
    },
    remove,
  };
  const now = Date.parse('2026-10-22T02:00:00.000Z');
  const metadata = {
    format: 1,
    createdAt: new Date(now).toISOString(),
    origin: 'https://spinel.example',
    image: `sha256:${'a'.repeat(64)}`,
    runtimeEnvironment: 'NODE_ENV=production\n',
  };
  const backup = new BackupService(f.db, {
    databasePath: f.path,
    configPath,
    origin: metadata.origin,
    image: metadata.image,
    now: () => now,
    remote: () => remote,
  });
  cleanup.push(() => backup.close());
  const before = persistentRows(f.db);
  expect(await backup.run()).toBe(true);
  expect(backup.status()).toMatchObject({ lastGood: now, running: false, error: null });
  expect(uploadedKey).toMatch(/^space-instance\/2026-10-22T02-00-00\.000Z-[a-f0-9-]+\.spinel$/);
  expect(remove).not.toHaveBeenCalled();
  expect((await stat(remoteArchive)).mode & 0o777).toBe(0o600);
  expect((await readFile(remoteArchive)).includes(Buffer.from('Retained internal recovery'))).toBe(
    false,
  );
  expect((await readdir(f.directory)).filter((name) => name.startsWith('.backup-'))).toEqual([]);
  const destination = join(f.directory, 'restored');
  expect(
    await restoreArchive(remoteArchive, await readKey(keyPath), f.directory, destination),
  ).toEqual(metadata);
  await backup.close();
  f.db.close();

  const restoredPath = join(destination, 'spinel.sqlite');
  const db = openDatabase(restoredPath);
  cleanup.push(() => {
    if (db.isOpen) db.close();
  });
  // Compare before constructing application/native stores: startup may reconcile
  // runtime work, whereas the encrypted restore itself preserves every SQL table.
  expect(persistentRows(db)).toEqual(before);
  expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(db.prepare('SELECT lease,owner,last_attempt,error FROM backup_state').get()).toEqual({
    lease: 0,
    owner: null,
    last_attempt: null,
    error: null,
  });
  expect(JSON.parse(await readFile(join(destination, 'recovery.json'), 'utf8'))).toEqual(metadata);

  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const collab = new CollaborationStore(workspace, restoredPath, { spaceReview: true });
  cleanup.push(() => collab.close());
  const history = new HistoryStore(workspace, collab);
  cleanup.push(() => history.close());
  const spaces = new SpaceStore(workspace);
  const restoredDocs = new DocumentStore(workspace);
  const sessions = new Map(
    [...f.sessions].map(([id, session]) => [id, session.session.token_hash]),
  );
  const context = (user: string, id = f.sheet.id) => ({
    sessionHash: sessions.get(user)!,
    spaceId: f.space.id,
    spaceItem: id,
  });
  const admin = new AdminStore(auth, new InvitationService(auth, metadata.origin));
  const transfer = new OwnershipTransfer(auth);
  admin.disable(f.operator.id, f.owner.id);
  const preview = transfer.preview(f.operator.id, f.owner.id);
  transfer.transfer(f.operator.id, f.owner.id, f.editor.id, preview.confirmation);
  const wrapper = db
    .prepare('SELECT id FROM workspace_items WHERE owner_id=? AND parent_id IS NULL')
    .get(f.editor.id)!;
  for (const row of owned)
    expect(db.prepare('SELECT * FROM workspace_items WHERE id=?').get(row.id)).toEqual({
      ...row,
      owner_id: f.editor.id,
      parent_id: row.space_id === null && row.parent_id === null ? wrapper.id : row.parent_id,
    });
  for (const table of [
    'doc_snapshots',
    'sheet_snapshots',
    'doc_images',
    'spinel_live_units',
    'spinel_restore_jobs',
    'spinel_generation_resources',
    'history_checkpoints',
    'history_restore_labels',
    'history_progress',
    'workspace_space_trash',
  ])
    expect(tableRows(db, table)).toEqual(before[table]);
  expect(collab.generations.active(f.sheet.id)).toEqual(generation);
  expect(() => new SpaceLifecycleStore(workspace).restore(f.viewer.id, f.space.id)).toThrow();
  expect(new SpaceLifecycleStore(workspace).restore(f.editor.id, f.space.id)).toMatchObject({
    destination: 'original',
    space: { id: f.space.id, parentId: outer.id },
  });
  expect(
    spaces
      .list(f.editor.id, f.space.id)
      .items.map(({ id, parentId, position }) => ({ id, parentId, position })),
  ).toEqual(ordered);
  expect(spaces.list(f.editor.id, f.space.id).access).toBe('owner');
  expect(spaces.list(f.viewer.id, f.space.id).access).toBe('viewer');
  expect(db.prepare('SELECT * FROM workspace_space_trash ORDER BY item_id').all()).toEqual(
    internalTrash,
  );
  await collab.prepare(f.editor.id, f.sheet.id, context(f.editor.id));
  await collab.prepare(f.editor.id, f.doc.id, context(f.editor.id, f.doc.id));
  const currentSheet = await collab.load(f.editor.id, f.sheet.id, context(f.editor.id));
  const currentDoc = await collab.load(f.editor.id, f.doc.id, context(f.editor.id, f.doc.id));
  expect(currentSheet.snapshot).toEqual(sheetBefore.snapshot);
  expect(currentSheet.revision).toBe(sheetBefore.revision);
  expect(currentDoc.snapshot).toEqual(docBefore.snapshot);
  expect(docFormulas((currentDoc.snapshot as IDocumentData).body)[0].definition).toEqual(
    definition,
  );
  expect(
    Buffer.from(
      restoredDocs.image(f.viewer.id, f.doc.id, image.id, context(f.viewer.id, f.doc.id)).data,
    ),
  ).toEqual(imageBytes);
  expect(history.list(f.editor.id, f.doc.id, context(f.editor.id, f.doc.id))).toContainEqual(
    expect.objectContaining({ id: docCheckpoint.id, name: 'Notes with image and Formula' }),
  );
  expect(
    await history.load(f.viewer.id, f.doc.id, docCheckpoint.id, context(f.viewer.id, f.doc.id)),
  ).toEqual(docBefore.snapshot);
  expect(
    await history.load(f.editor.id, f.sheet.id, sheetCheckpoint.id, context(f.editor.id)),
  ).toEqual(sheetCheckpointSnapshot);
  expect(
    await new DocFormulas(workspace, collab).evaluate(
      f.editor.id,
      f.doc.id,
      definition,
      () => {},
      false,
      context(f.editor.id, f.doc.id),
    ),
  ).toEqual({ ok: true, kind: 'scalar', value: 42 });
  await expect(
    history.restore(
      f.viewer.id,
      f.sheet.id,
      sheetCheckpoint.id,
      generation.unitId,
      randomUUID(),
      () => {},
      context(f.viewer.id),
    ),
  ).rejects.toThrow();
  expect(collab.generations.active(f.sheet.id)).toEqual(generation);
  expect(workspace.links.state(f.space.id)).toEqual({
    state: 'off',
    epoch: link.epoch + 1,
    role: 'editor',
  });
  expect(() => workspace.links.principal(guestHeaders, f.space.id)).toThrow();
  await expect(collab.load(guest.userId, f.doc.id, guestContext)).rejects.toThrow();
  const recovered = new SpaceRecoveryStore(workspace);
  expect(recovered.list(f.editor.id, f.space.id).items.map((item) => item.id)).toEqual([
    removed.id,
  ]);
  expect(recovered.restore(f.editor.id, f.space.id, removed.id).restoredCount).toBe(2);
  await collab.prepare(f.editor.id, removedDoc.id, context(f.editor.id, removedDoc.id));
  expect(
    (await collab.load(f.editor.id, removedDoc.id, context(f.editor.id, removedDoc.id))).snapshot,
  ).toEqual(removedBefore.snapshot);
  for (const user of [f.operator, f.outsider])
    await expect(collab.load(user.id, f.doc.id, context(user.id, f.doc.id))).rejects.toThrow();
  admin.reactivate(f.operator.id, f.owner.id);
  sessions.set(f.owner.id, auth.createSession(f.owner.id).session.token_hash);
  await expect(collab.load(f.owner.id, f.doc.id, context(f.owner.id, f.doc.id))).rejects.toThrow();
  await expect(
    history.load(f.owner.id, f.doc.id, docCheckpoint.id, context(f.owner.id, f.doc.id)),
  ).rejects.toThrow();
  expect(() =>
    restoredDocs.image(f.owner.id, f.doc.id, image.id, context(f.owner.id, f.doc.id)),
  ).toThrow();
  expect(() => workspace.get(f.editor.id, f.doc.id)).toThrow();
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}, 90_000);
