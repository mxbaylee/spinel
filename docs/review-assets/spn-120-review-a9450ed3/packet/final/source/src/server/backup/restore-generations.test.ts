import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { MAX_SNAPSHOT_BYTES } from '@spinel/sync-server';
import { JSONX } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import { blankOfflineSnapshot } from '../../shared/offlineCreation.ts';
import { backup, DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { TrashStore } from '../workspace/trash.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { SQLiteSyncStorage } from '../sync/store.ts';
import { restoreRevisionHighWater, rotateRestoreGenerations } from './restore-generations.ts';

vi.setConfig({ testTimeout: 20_000 });
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-generations-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, 'current.sqlite'));
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    collaboration = new CollaborationStore(workspace, db.path);
  cleanup.push(() => collaboration.close());
  const docs = new DocumentStore(workspace);
  const create = () => {
    const item = workspace.create(owner.id, {
      kind: 'doc',
      name: 'Retained content',
      parentId: null,
    });
    docs.save(owner.id, item.id, {
      snapshot: {
        id: item.id,
        title: 'Retained',
        body: { dataStream: 'Retained\r\n', paragraphs: [{ startIndex: 8 }] },
      },
      revision: 0,
      writeId: randomUUID(),
    });
    return item;
  };
  const live = create(),
    lazy = create();
  await collaboration.prepare(owner.id, live.id);
  const resources = [
    { name: 'future-plugin', data: 'opaque bytes' },
    {
      name: 'DOC_DRAWING_PLUGIN',
      data: JSON.stringify({ data: { drawing: { unitId: live.id, subUnitId: live.id } } }),
    },
  ];
  db.prepare('INSERT INTO spinel_generation_resources VALUES(?,?,?)').run(
    live.id,
    live.id,
    JSON.stringify(resources),
  );
  const snapshot = async () => {
    const path = join(directory, `${randomUUID()}.sqlite`);
    await backup(db, path);
    const candidate = new DatabaseSync(path);
    cleanup.push(() => candidate.close());
    return candidate;
  };
  const open = (candidate: DatabaseSync) => {
    const candidateAuth = new AuthStore(candidate),
      candidateWorkspace = new WorkspaceStore(candidateAuth, { spacesEnabled: true });
    const collab = new CollaborationStore(candidateWorkspace, candidate.path);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await collab.close();
    };
    cleanup.push(close);
    return { collab, workspace: candidateWorkspace, auth: candidateAuth, close };
  };
  return {
    db,
    auth,
    workspace,
    owner,
    collaboration,
    live,
    lazy,
    create,
    snapshot,
    open,
    resources,
  };
}
function state(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => [
      row.name,
      db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}"`).all(),
    ]);
}

test('rollback generations exceed all attempts without copying their content or mappings', async () => {
  const f = await fixture(),
    a = await f.snapshot(),
    b = await f.snapshot(),
    c = await f.snapshot();
  const first = rotateRestoreGenerations(f.db, a);
  const second = rotateRestoreGenerations(f.db, b, [a]);
  expect(second.revisionOffset).toBeGreaterThan(first.revisionOffset);
  const before = [state(f.db), state(a), state(b)];
  const high = restoreRevisionHighWater(f.db, c, [a, b]);
  const result = rotateRestoreGenerations(f.db, c, [a, b]);
  expect(result.revisionOffset).toBe(high);
  expect(high).toBeGreaterThan(second.revisionOffset);
  const units = [a, b].flatMap((db) =>
    db
      .prepare('SELECT unit_id FROM spinel_live_units')
      .all()
      .map((row) => row.unit_id),
  );
  for (const unit of units) {
    expect(
      c.prepare("SELECT 1 FROM spinel_restore_fences WHERE kind='identity' AND id=?").get(unit),
    ).toBeDefined();
    expect(c.prepare('SELECT 1 FROM spinel_live_units WHERE unit_id=?').get(unit)).toBeUndefined();
    expect(c.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(unit)).toBeUndefined();
  }
  expect([state(f.db), state(a), state(b)]).toEqual(before);
});

test('rejects namespace collisions found only between attempts before rotating anything', async () => {
  const f = await fixture(),
    a = await f.snapshot(),
    b = await f.snapshot(),
    c = await f.snapshot();
  const collision = randomUUID();
  a.prepare('INSERT INTO spinel_live_units VALUES(?,?,0)').run(f.live.id, collision);
  b.prepare('INSERT INTO spinel_live_units VALUES(?,?,0)').run(f.lazy.id, collision);
  const before = state(c);
  expect(() => rotateRestoreGenerations(f.db, c, [a, b])).toThrow('reconciliation');
  expect(state(c)).toEqual(before);
});

test('an empty purged current generation retains its permanent revision ceiling for future recovery', async () => {
  const f = await fixture(),
    candidate = await f.snapshot();
  f.db.exec(
    'UPDATE spinel_restore_revision SET revision=500; DELETE FROM workspace_items; DELETE FROM spinel_sync_units; DELETE FROM collaboration_purge',
  );
  expect(restoreRevisionHighWater(f.db, candidate)).toBe(500);
  const result = rotateRestoreGenerations(f.db, candidate);
  expect(result.revisionOffset).toBe(500);
  expect(candidate.prepare('SELECT revision FROM spinel_restore_revision').get()!.revision).toBe(
    501,
  );
  candidate.exec(
    'DELETE FROM workspace_items; DELETE FROM spinel_sync_units; DELETE FROM collaboration_purge',
  );
  expect(restoreRevisionHighWater(f.db, candidate)).toBe(501);
});

test('rotates every document, preserves archived resources/content, and old identities stay retired after purge and another restore', async () => {
  const f = await fixture(),
    trashed = f.create();
  new TrashStore(f.workspace).trash(f.owner.id, trashed.id);
  const spaces = new SpaceStore(f.workspace),
    root = spaces.createRoot(f.owner.id, { name: 'Space', parentId: null }).space;
  const member = spaces.createChild(f.owner.id, root.id, {
    name: 'Page',
    kind: 'doc',
    parentId: root.id,
  }).item;
  const job = f.collaboration.generations.begin(
    f.owner.id,
    f.live.id,
    f.live.id,
    randomUUID(),
    'checkpoint',
  );
  const candidate = await f.snapshot();
  f.collaboration.generations.cancel(job.id);
  f.db.prepare('INSERT INTO spinel_live_units VALUES(?,?,40)').run(f.live.id, f.live.id);
  const original = (await f.collaboration.load(f.owner.id, f.live.id)).snapshot as IDocumentData;
  await f.collaboration.submitSync(
    {
      unitId: f.live.id,
      baseRevision: 1,
      mutationId: randomUUID(),
      mutations: [
        {
          id: RichTextEditingMutation.id,
          params: {
            unitId: f.live.id,
            actions: new JSONX().replaceOp(['body'], original.body, {
              ...original.body,
              dataStream: 'Changed!\r\n',
            }),
            textRanges: [],
          },
        },
      ],
    },
    { userID: f.owner.id, customData: {} },
  );
  const source = state(f.db),
    retainedLegacy = candidate.prepare('SELECT * FROM doc_snapshots ORDER BY item_id').all();
  expect(rotateRestoreGenerations(f.db, candidate)).toEqual({
    rotated: 4,
    initialized: 1,
    revisionOffset: 42,
  });
  const mappings = candidate.prepare('SELECT * FROM spinel_live_units').all();
  expect(mappings).toHaveLength(4);
  for (const id of [f.live.id, f.lazy.id, trashed.id, member.id]) {
    const row = mappings.find((row) => row.item_id === id)!;
    expect(row.unit_id).not.toBe(id);
    expect(row.revision_offset).toBe(42);
  }
  expect(
    candidate.prepare('SELECT status FROM spinel_restore_jobs WHERE id=?').get(job.id)!.status,
  ).toBe('cancelled');
  const opened = f.open(candidate),
    fresh = opened.collab.generations.active(f.live.id).unitId;
  const copied = JSON.parse(
    String(
      candidate
        .prepare('SELECT resources FROM spinel_generation_resources WHERE unit_id=?')
        .get(fresh)!.resources,
    ),
  );
  expect(copied[0]).toEqual(f.resources[0]);
  expect(JSON.parse(copied[1].data).data.drawing).toEqual({ unitId: fresh, subUnitId: fresh });
  await opened.collab.prepare(f.owner.id, f.lazy.id);
  expect((await opened.collab.load(f.owner.id, f.lazy.id)).revision).toBe(43);
  expect(
    ((await opened.collab.load(f.owner.id, f.live.id)).snapshot as IDocumentData).body?.dataStream,
  ).toBe('Retained\r\n');
  expect(
    ((await f.collaboration.load(f.owner.id, f.live.id)).snapshot as IDocumentData).body
      ?.dataStream,
  ).toBe('Changed!\r\n');
  expect(candidate.prepare('SELECT * FROM doc_snapshots ORDER BY item_id').all()).toEqual(
    retainedLegacy,
  );
  await opened.collab.purgeDeleted();
  for (const id of [f.live.id, f.lazy.id, trashed.id, member.id, job.nextUnit])
    expect(opened.collab.generations.resolve(id)).toBeUndefined();
  expect(() =>
    opened.collab.generations.begin(f.owner.id, f.live.id, fresh, job.id, 'checkpoint'),
  ).toThrow('retired');
  expect(new SQLiteSyncStorage(opened.auth).load(fresh)?.snapshot.id).toBe(fresh);
  await opened.close();
  expect(rotateRestoreGenerations(f.db, candidate).revisionOffset).toBe(44);
  const again = f.open(candidate);
  expect(again.collab.generations.resolve(fresh)).toBeUndefined();
  expect((await again.collab.load(f.owner.id, f.live.id)).revision).toBe(45);
  expect(state(f.db)).toEqual(source);
});

test('Sheet formulas and retained names rebase while ordinary cell and opaque resource bytes stay intact', async () => {
  const f = await fixture(),
    sheet = f.workspace.create(f.owner.id, { kind: 'sheet', name: 'Budget', parentId: null });
  const snapshot = blankOfflineSnapshot({
    itemId: sheet.id,
    kind: 'sheet',
    name: 'Budget',
  }) as IWorkbookData;
  const first = snapshot.sheetOrder[0];
  snapshot.sheets[first].cellData = {
    0: { 0: { v: 'Retained cell' }, 1: { f: `=[${sheet.id}]Sheet1!A1` } },
  };
  new SheetStore(f.workspace).save(f.owner.id, sheet.id, {
    snapshot,
    revision: 0,
    writeId: randomUUID(),
  });
  await f.collaboration.prepare(f.owner.id, sheet.id);
  const opaque = { name: 'future-plugin', data: JSON.stringify({ unitId: sheet.id }) };
  f.db.prepare('INSERT INTO spinel_generation_resources VALUES(?,?,?)').run(
    sheet.id,
    sheet.id,
    JSON.stringify([
      {
        name: 'SHEET_DEFINED_NAME_PLUGIN',
        data: JSON.stringify({
          myRange: {
            id: 'range',
            localSheetId: first,
            formulaOrRefString: `=[${sheet.id}]Sheet1!A1`,
          },
        }),
      },
      opaque,
    ]),
  );
  const candidate = await f.snapshot();
  rotateRestoreGenerations(f.db, candidate);
  const unit = String(
    candidate.prepare('SELECT unit_id FROM spinel_live_units WHERE item_id=?').get(sheet.id)!
      .unit_id,
  );
  const restored = new SQLiteSyncStorage(new AuthStore(candidate)).load(unit)!
    .snapshot as IWorkbookData;
  expect(restored.sheets[first].cellData?.[0]?.[0]?.v).toBe('Retained cell');
  expect(restored.sheets[first].cellData?.[0]?.[1]?.f).toBe(`=[${unit}]Sheet1!A1`);
  const resources = JSON.parse(
    String(
      candidate
        .prepare('SELECT resources FROM spinel_generation_resources WHERE unit_id=?')
        .get(unit)!.resources,
    ),
  );
  expect(JSON.parse(resources[0].data).myRange.formulaOrRefString).toBe(`=[${unit}]Sheet1!A1`);
  expect(resources[1]).toEqual(opaque);
});

test('a later mapping failure rolls back every candidate table, including fences and staging cancellation', async () => {
  const f = await fixture();
  f.collaboration.generations.begin(f.owner.id, f.live.id, f.live.id, randomUUID(), 'checkpoint');
  const candidate = await f.snapshot(),
    before = state(candidate),
    prepare = candidate.prepare.bind(candidate);
  let writes = 0;
  vi.spyOn(candidate, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql.startsWith('INSERT INTO spinel_live_units')) {
      const run = statement.run.bind(statement);
      vi.spyOn(statement, 'run').mockImplementation((...values) => {
        if (++writes === 2) throw new Error('later failure');
        return run(...values);
      });
    }
    return statement;
  });
  expect(() => rotateRestoreGenerations(f.db, candidate)).toThrow('later failure');
  expect(state(candidate)).toEqual(before);
});

test('rebased retained-resource expansion refuses atomically before publishing an oversized row', async () => {
  const f = await fixture(),
    candidate = await f.snapshot();
  const snapshot = JSON.parse(
    String(
      candidate.prepare('SELECT snapshot FROM spinel_sync_units WHERE unit_id=?').get(f.live.id)!
        .snapshot,
    ),
  );
  snapshot.id = 'x';
  candidate
    .prepare('UPDATE spinel_sync_units SET unit_id=?,snapshot=? WHERE unit_id=?')
    .run('x', JSON.stringify(snapshot), f.live.id);
  candidate.prepare('INSERT INTO spinel_live_units VALUES(?,?,0)').run(f.live.id, 'x');
  const resources = [
    {
      name: 'DOC_DRAWING_PLUGIN',
      data: JSON.stringify({ data: { drawing: { unitId: 'x', subUnitId: 'x' } } }),
    },
    { name: 'future-plugin', data: '' },
  ];
  resources[1].data = 'a'.repeat(
    MAX_SNAPSHOT_BYTES - Buffer.byteLength(JSON.stringify(resources)) - 10,
  );
  candidate
    .prepare('UPDATE spinel_generation_resources SET unit_id=?,resources=? WHERE item_id=?')
    .run('x', JSON.stringify(resources), f.live.id);
  const before = state(candidate);
  expect(() => rotateRestoreGenerations(f.db, candidate)).toThrow('reconciliation');
  expect(state(candidate)).toEqual(before);
});

test('refuses cross-copy unit/stable-identity collisions without mutating the candidate', async () => {
  const f = await fixture(),
    candidate = await f.snapshot();
  f.db.prepare('INSERT INTO spinel_live_units VALUES(?,?,0)').run(f.live.id, f.lazy.id);
  const before = state(candidate);
  expect(() => rotateRestoreGenerations(f.db, candidate)).toThrow('reconciliation');
  expect(state(candidate)).toEqual(before);
});

test('high-water arithmetic leaves a later edit representable and refuses exhaustion before mutation', async () => {
  const f = await fixture(),
    candidate = await f.snapshot();
  f.db
    .prepare('INSERT INTO spinel_live_units VALUES(?,?,?)')
    .run(f.live.id, f.live.id, Number.MAX_SAFE_INTEGER - 3);
  expect(restoreRevisionHighWater(f.db, candidate)).toBe(Number.MAX_SAFE_INTEGER - 2);
  const before = state(candidate);
  f.db.prepare('UPDATE spinel_live_units SET revision_offset=?').run(Number.MAX_SAFE_INTEGER - 2);
  expect(() => rotateRestoreGenerations(f.db, candidate)).toThrow('revision capacity');
  expect(state(candidate)).toEqual(before);
  f.db.prepare('UPDATE spinel_live_units SET revision_offset=?').run(Number.MAX_SAFE_INTEGER);
  expect(() => restoreRevisionHighWater(f.db, candidate)).toThrow('revision capacity');
});
