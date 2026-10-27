import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, JSONX } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { UniverType } from '@univerjs/protocol';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import type { FormulaDefinition } from '@spinel/doc-formulas';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { HistoryStore } from '../history/store.ts';
import { MINUTE } from '../history/policy.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SQLiteSyncStorage } from './store.ts';

vi.setConfig({ testTimeout: 20_000 });
const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(space = false) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-sync-history-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => {
    if (db.isOpen) db.close();
  });
  const auth = new AuthStore(db);
  let clock = Date.UTC(2026, 9, 26, 12);
  auth.now = () => clock;
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    editor = auth.createUser('Editor'),
    viewer = auth.createUser('Viewer');
  const sessions = new Map(
    [owner, editor, viewer].map((user) => [user.id, auth.createSession(user.id)]),
  );
  const spaces = new SpaceStore(workspace);
  const root = space
    ? spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space
    : undefined;
  const item = root
    ? spaces.createChild(owner.id, root.id, { name: 'Budget', kind: 'sheet', parentId: root.id })
        .item
    : workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  for (const [user, role] of [
    [editor, 'editor'],
    [viewer, 'viewer'],
  ] as const) {
    if (root) spaces.share(owner.id, root.id, user.id, role);
    else workspace.share(owner.id, item.id, user.id, role);
  }
  const custom = (user = owner.id, id = item.id): Record<string, unknown> => ({
    sessionHash: sessions.get(user)!.session.token_hash,
    ...(root && { spaceId: root.id, spaceItem: id }),
  });
  let collab = new CollaborationStore(workspace, path);
  let history = new HistoryStore(workspace, collab);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await history.close();
    await collab.close();
  };
  cleanup.push(close);
  const restart = async () => {
    await close();
    collab = new CollaborationStore(workspace, path);
    history = new HistoryStore(workspace, collab);
    closed = false;
    return { collab, history };
  };
  await collab.prepare(owner.id, item.id, custom());
  const edit = async (value: string, user = owner.id) => {
    const data = await collab.load(user, item.id, custom(user));
    const generation = collab.generations.active(item.id);
    return collab.submitSync(
      {
        unitId: generation.unitId,
        baseRevision: data.revision - generation.offset,
        mutationId: randomUUID(),
        mutations: [
          {
            id: SetRangeValuesMutation.id,
            params: {
              unitId: generation.unitId,
              subUnitId: 'first',
              cellValue: { 0: { 0: { v: value } } },
            },
          },
        ],
      },
      { userID: user, customData: custom(user) },
    );
  };
  const load = () => collab.load(owner.id, item.id, custom());
  return {
    db,
    auth,
    workspace,
    spaces,
    root,
    owner,
    editor,
    viewer,
    sessions,
    item,
    custom,
    collab,
    history,
    edit,
    load,
    restart,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

for (const space of [false, true]) {
  const scope = space ? 'Space' : 'ordinary';
  test(`${scope}: checkpoints track the owned log baseline, idle edit and a missed commit notification`, async () => {
    const f = await fixture(space);
    expect(
      f.history.list(f.owner.id, f.item.id, f.custom()).map((point) => point.revision),
    ).toEqual([1]);
    await f.edit('first');
    f.advance(MINUTE);
    await f.history.tick();
    expect(
      f.history.list(f.owner.id, f.item.id, f.custom()).map((point) => point.revision),
    ).toEqual([2, 1]);
    const checkpoint = f.history.list(f.viewer.id, f.item.id, f.custom(f.viewer.id))[0];
    expect(
      (await f.history.load(
        f.viewer.id,
        f.item.id,
        checkpoint.id,
        f.custom(f.viewer.id),
      )) as IWorkbookData,
    ).toMatchObject({ sheets: { first: { cellData: { 0: { 0: { v: 'first' } } } } } });
    await f.edit('recover missing notification');
    f.db
      .prepare("UPDATE history_progress SET revision=2 WHERE item_id=? AND source='collaboration'")
      .run(f.item.id);
    f.advance(MINUTE);
    await f.history.tick();
    // A recovered revision has no trustworthy last-edit time. Reconciliation
    // starts a fresh idle interval instead of immediately capturing it.
    expect(
      f.db
        .prepare("SELECT revision FROM history_progress WHERE item_id=? AND source='collaboration'")
        .get(f.item.id)?.revision,
    ).toBe(3);
    expect(f.history.list(f.owner.id, f.item.id, f.custom())[0].revision).toBe(2);
    f.advance(MINUTE);
    await f.history.tick();
    expect(f.history.list(f.owner.id, f.item.id, f.custom())[0].revision).toBe(3);
    if (f.root) f.spaces.share(f.owner.id, f.root.id, f.viewer.id, null);
    else f.workspace.share(f.owner.id, f.item.id, f.viewer.id, null);
    await expect(
      f.history.load(f.viewer.id, f.item.id, checkpoint.id, f.custom(f.viewer.id)),
    ).rejects.toThrow();
  });

  test(`${scope}: restore drains admitted edits, preserves Before restore, fences stale generations and retries safely`, async () => {
    const f = await fixture(space);
    const baseline = f.history.list(f.owner.id, f.item.id, f.custom())[0];
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const subscription = f.collab.onSubmitting(async () => {
      entered.resolve();
      await release.promise;
    });
    const pending = f.edit('admitted before restore', f.editor.id);
    await entered.promise;
    const requestId = randomUUID();
    const restoring = f.history.restore(
      f.owner.id,
      f.item.id,
      baseline.id,
      f.item.id,
      requestId,
      () => {},
      f.custom(),
    );
    await vi.waitFor(() => expect(f.collab.generations.restoring(f.item.id)).toBe(true));
    await expect(f.edit('arrived during restore')).rejects.toThrow();
    release.resolve();
    await pending;
    const receipt = await restoring;
    subscription.dispose();
    expect(receipt).toMatchObject({ status: 'complete', revision: 3 });
    const generation = f.collab.generations.active(f.item.id);
    expect(generation.unitId).not.toBe(f.item.id);
    expect(generation.offset).toBe(2);
    expect((await f.load()).revision).toBe(3);
    expect(
      ((await f.load()).snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v,
    ).toBeUndefined();
    const before = f.history
      .list(f.owner.id, f.item.id, f.custom())
      .find((point) => point.beforeRestore)!;
    expect(before.revision).toBe(2);
    expect(
      (await f.history.load(f.owner.id, f.item.id, before.id, f.custom())) as IWorkbookData,
    ).toMatchObject({
      sheets: { first: { cellData: { 0: { 0: { v: 'admitted before restore' } } } } },
    });
    await expect(
      f.collab.submitSync(
        {
          unitId: f.item.id,
          baseRevision: 2,
          mutationId: randomUUID(),
          mutations: [],
        },
        { userID: f.owner.id, customData: f.custom() },
      ),
    ).rejects.toThrow();
    await f.edit('after restore');
    expect(
      await f.history.restore(
        f.owner.id,
        f.item.id,
        baseline.id,
        f.item.id,
        requestId,
        () => {},
        f.custom(),
      ),
    ).toEqual(receipt);
    expect((await f.load()).revision).toBe(4);
    expect(((await f.load()).snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBe(
      'after restore',
    );
    await expect(
      f.history.restore(
        f.viewer.id,
        f.item.id,
        before.id,
        generation.unitId,
        randomUUID(),
        () => {},
        f.custom(f.viewer.id),
      ),
    ).rejects.toThrow();
    await f.collab.purgeDeleted();
    expect(
      f.db.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(f.item.id),
    ).toBeUndefined();
    expect(
      f.db.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(generation.unitId),
    ).toBeTruthy();
    const restarted = await f.restart();
    expect((await f.load()).revision).toBe(4);
    expect(
      restarted.history.list(f.owner.id, f.item.id, f.custom()).find((point) => point.beforeRestore)
        ?.revision,
    ).toBe(2);
  });

  test(`${scope}: Doc Formula metadata and opaque resources survive mutation, restore and server restart`, async () => {
    const f = await fixture(space);
    const doc = f.root
      ? f.spaces.createChild(f.owner.id, f.root.id, {
          kind: 'doc',
          name: 'Report',
          parentId: f.root.id,
        }).item
      : f.workspace.create(f.owner.id, { kind: 'doc', name: 'Report', parentId: null });
    const expression = '=Budget.Sheet1.A1';
    const reference = parseFormula(expression)[0];
    const definition: FormulaDefinition = {
      version: 1,
      expression,
      format: 'currency',
      references: [
        {
          start: reference.start,
          end: reference.end,
          range: reference.range,
          itemId: f.item.id,
          sheetId: 'first',
        },
      ],
    };
    const body = formulaBody('saved-total', definition);
    body.dataStream += '\r\n';
    const native = {
      ...getDocsEmptySnapshot(doc.id),
      body,
      resources: [{ name: 'SPINEL_TEST_METADATA', data: '{"retained":true}' }],
    };
    new DocumentStore(f.workspace);
    // Fixture data for both scopes uses the same application native storage.
    f.db
      .prepare('INSERT INTO doc_snapshots VALUES(?,?,1,?)')
      .run(doc.id, JSON.stringify(native), randomUUID());
    const custom = f.custom(f.owner.id, doc.id);
    await f.collab.prepare(f.owner.id, doc.id, custom);
    const original = (await f.collab.load(f.owner.id, doc.id, custom)).snapshot as IDocumentData;
    expect(docFormulas(original.body)[0].definition).toEqual(definition);
    const checkpoint = await f.history.nameCurrent(
      f.owner.id,
      doc.id,
      'Formula preserved',
      () => {},
      custom,
    );
    await f.collab.submitSync(
      {
        unitId: doc.id,
        baseRevision: 1,
        mutationId: randomUUID(),
        mutations: [
          {
            id: RichTextEditingMutation.id,
            params: {
              unitId: doc.id,
              actions: new JSONX().replaceOp(['body'], original.body, {
                ...original.body,
                dataStream: original.body!.dataStream + 'More text\r\n',
              }),
              textRanges: [],
            },
          },
        ],
      },
      { userID: f.owner.id, customData: custom },
    );
    const edited = (await f.collab.load(f.owner.id, doc.id, custom)).snapshot as IDocumentData;
    expect(docFormulas(edited.body)[0].definition).toEqual(definition);
    expect(edited.resources).toContainEqual(native.resources[0]);
    await f.history.restore(
      f.owner.id,
      doc.id,
      checkpoint.id,
      doc.id,
      randomUUID(),
      () => {},
      custom,
    );
    const restarted = await f.restart();
    const restored = (await restarted.collab.load(f.owner.id, doc.id, custom))
      .snapshot as IDocumentData;
    expect(restored.id).toBe(doc.id);
    expect(restored.body?.dataStream).toBe(original.body?.dataStream);
    expect(docFormulas(restored.body)[0].definition).toEqual(definition);
    expect(restored.resources).toContainEqual(native.resources[0]);
  });
}

test('a failed old-generation purge remains queued and retries without deleting the active replacement', async () => {
  const f = await fixture();
  const baseline = f.history.list(f.owner.id, f.item.id, f.custom())[0];
  await f.edit('preserved');
  await f.history.restore(
    f.owner.id,
    f.item.id,
    baseline.id,
    f.item.id,
    randomUUID(),
    () => {},
    f.custom(),
  );
  const active = f.collab.generations.active(f.item.id).unitId;
  const remove = vi.spyOn(SQLiteSyncStorage.prototype, 'remove').mockImplementationOnce(() => {
    throw new Error('storage unavailable');
  });
  await expect(f.collab.purgeDeleted()).rejects.toThrow('storage unavailable');
  expect(
    f.db.prepare('SELECT 1 FROM collaboration_purge WHERE item_id=?').get(f.item.id),
  ).toBeTruthy();
  expect(f.db.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(active)).toBeTruthy();
  remove.mockRestore();
  await f.collab.purgeDeleted();
  expect(
    f.db.prepare('SELECT 1 FROM collaboration_purge WHERE item_id=?').get(f.item.id),
  ).toBeUndefined();
  expect(
    f.db.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(f.item.id),
  ).toBeUndefined();
  expect((await f.load()).revision).toBe(3);
});

test('restart cancels an unpublished restore and purges its staged own-server generation', async () => {
  const f = await fixture();
  const requestId = randomUUID();
  const job = f.collab.generations.begin(
    f.owner.id,
    f.item.id,
    f.item.id,
    requestId,
    'checkpoint',
    f.custom(),
  );
  const storage = new SQLiteSyncStorage(f.auth);
  const current = storage.load(f.item.id)!;
  storage.create(
    { ...current, unitId: job.nextUnit, snapshot: { ...current.snapshot, id: job.nextUnit } },
    () => {},
  );
  const restarted = await f.restart();
  expect(restarted.collab.generations.active(f.item.id).unitId).toBe(f.item.id);
  expect(restarted.collab.generations.restoring(f.item.id)).toBe(false);
  expect(
    f.db.prepare('SELECT status FROM spinel_restore_jobs WHERE id=?').get(requestId)?.status,
  ).toBe('cancelled');
  await restarted.collab.purgeDeleted();
  expect(storage.has(job.nextUnit)).toBe(false);
  expect((await f.load()).revision).toBe(1);
});

test('a newly prepared document can restore after restart alongside existing native generations', async () => {
  const f = await fixture();
  const reopened = await f.restart();
  const legacy = f.workspace.create(f.owner.id, {
    name: 'Legacy Sheet',
    kind: 'sheet',
    parentId: null,
  });
  const custom = f.custom(f.owner.id, legacy.id);
  await reopened.collab.prepare(f.owner.id, legacy.id, custom);
  const baseline = reopened.history.list(f.owner.id, legacy.id, custom)[0];
  const result = await reopened.collab.submitChangeset(
    {
      changeset: {
        unitID: legacy.id,
        type: UniverType.UNIVER_SHEET,
        baseRev: 1,
        revision: 0,
        userID: f.owner.id,
        memberID: 'legacy-restore',
        sid: 'legacy-restore',
        reqId: 1,
        mutations: [
          {
            id: SetRangeValuesMutation.id,
            data: JSON.stringify({
              unitId: legacy.id,
              subUnitId: 'first',
              cellValue: { 0: { 0: { v: 67 } } },
            }),
          },
        ],
      },
    },
    { userID: f.owner.id, memberID: 'legacy-restore', customData: custom },
  );
  expect(result.status).toBe('committed');
  await reopened.history.restore(
    f.owner.id,
    legacy.id,
    baseline.id,
    legacy.id,
    randomUUID(),
    () => {},
    custom,
  );
  const generation = reopened.collab.generations.active(legacy.id);
  const restored = await reopened.collab.load(f.owner.id, legacy.id, custom);
  expect(restored.revision).toBe(3);
  expect((restored.snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBeUndefined();
  expect(reopened.collab.sync).toBeDefined();
  expect(
    f.db.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(generation.unitId),
  ).toBeTruthy();
  expect(
    f.db.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(f.item.id),
  ).toBeTruthy();
});
