import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { DocFormulas } from '../formulas/service.ts';
import { PortableFiles, PORTABLE_LIMIT } from './portable.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';

const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) if (database.isOpen) database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(path = ':memory:') {
  const db = new DatabaseSync(path);
  databases.push(db);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const collaborator = auth.createUser('Collaborator');
  const operator = auth.createUser('Operator', true);
  const files = new PortableFiles(workspace);
  const snapshot = (kind: 'sheet' | 'doc', id = 'original') =>
    kind === 'sheet'
      ? {
          id,
          name: 'Budget (offline copy, 2026-10-26 21.00)',
          sheetOrder: ['sheet'],
          sheets: {
            sheet: {
              id: 'sheet',
              name: 'Budget',
              rowCount: 100,
              columnCount: 26,
              cellData: { 0: { 0: { v: 42 }, 1: { f: '=[original]sheet!A1' } } },
            },
          },
          resources: [{ name: 'opaque', data: 'preserve this resource' }],
        }
      : {
          id,
          title: 'Journal (offline copy, 2026-10-26 21.00)',
          body: { dataStream: 'Offline work\r\n', paragraphs: [{ startIndex: 12 }] },
        };
  const input = (kind: 'sheet' | 'doc') => ({
    recoveryId: randomUUID(),
    filename: 'offline.univer.json',
    snapshot: snapshot(kind),
  });
  return { db, auth, workspace, owner, collaborator, operator, files, snapshot, input };
}

test.each(['sheet', 'doc'] as const)(
  '%s recovery creates one root-owned copy and preserves the changed original across repeated/concurrent retries',
  async (kind) => {
    const f = fixture();
    const original = await f.files.import(
      f.owner.id,
      { filename: 'original.json', parentId: null, snapshot: f.snapshot(kind) },
      () => {},
    );
    f.workspace.share(f.owner.id, original.id, f.collaborator.id, 'editor');
    const request = f.input(kind);
    request.snapshot.id = original.id;
    const originalBefore = f.db
      .prepare(`SELECT * FROM ${kind === 'sheet' ? 'sheet_snapshots' : 'doc_snapshots'}`)
      .all();
    // Recovery consumes the person's retained bytes; a revoked original grants
    // no read/write capability and must not prevent keeping their own work.
    f.workspace.share(f.owner.id, original.id, f.collaborator.id, null);
    const [first, second] = await Promise.all([
      f.files.recover(f.collaborator.id, request, () => {}),
      f.files.recover(f.collaborator.id, structuredClone(request), () => {}),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ parentId: null, access: 'owner', kind });
    expect(first.id).not.toBe(original.id);
    expect(f.workspace.fileOwner(first.id)).toBe(f.collaborator.id);
    const store = kind === 'sheet' ? f.files.sheets : f.files.docs;
    expect(store.load(f.collaborator.id, first.id).snapshot).toMatchObject({ id: first.id });
    expect(
      f.db
        .prepare(
          `SELECT * FROM ${kind === 'sheet' ? 'sheet_snapshots' : 'doc_snapshots'} WHERE item_id=?`,
        )
        .all(original.id),
    ).toEqual(originalBefore);
    expect(
      await new PortableFiles(f.workspace).recover(f.collaborator.id, request, () => {}),
    ).toEqual(first);
    expect(f.workspace.list(f.collaborator.id)).toEqual([first]);
    expect(
      f.db.prepare('SELECT count(*) AS count FROM workspace_offline_recoveries').get()!.count,
    ).toBe(1);
  },
);

test('a durable recovery receipt survives closing and reopening the database after a lost response', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-offline-recovery-'));
  directories.push(directory);
  const path = join(directory, 'app.sqlite');
  const f = fixture(path);
  const request = { ...f.input('doc'), possibleReplayCrash: true };
  const item = await f.files.recover(f.owner.id, request, () => {});
  f.db.close();
  const db = new DatabaseSync(path);
  databases.push(db);
  const workspace = new WorkspaceStore(new AuthStore(db), { spacesEnabled: true });
  const files = new PortableFiles(workspace);
  expect(await files.recover(f.owner.id, request, () => {})).toEqual(item);
  // Count possible lost-ack/crash copies once, even after repeated delivery.
  expect(
    db
      .prepare(
        'SELECT count(*) AS copies,sum(possible_replay_crash) AS possible FROM workspace_offline_recoveries',
      )
      .get(),
  ).toEqual({ copies: 1, possible: 1 });
});

test('recovery identities bind payload and crash classification but remain scoped to their original account', async () => {
  const f = fixture();
  const request = f.input('doc');
  const first = await f.files.recover(f.owner.id, request, () => {});
  for (const change of [
    { filename: 'changed.json' },
    { possibleReplayCrash: true },
    { snapshot: { ...request.snapshot, title: 'Changed' } },
  ])
    await expect(
      f.files.recover(f.owner.id, { ...request, ...change }, () => {}),
    ).rejects.toMatchObject({ status: 409 });
  const second = await f.files.recover(f.collaborator.id, request, () => {});
  expect(second.id).not.toBe(first.id);
  expect(f.workspace.fileOwner(second.id)).toBe(f.collaborator.id);
  expect(f.workspace.list(f.owner.id)).toEqual([first]);
  expect(f.workspace.list(f.collaborator.id)).toEqual([second]);
});

test.each(['trashed', 'deleted', 'transferred'] as const)(
  'a %s recovery copy never permits a stale retry to publish another copy',
  async (state) => {
    const f = fixture();
    const request = f.input('doc');
    const item = await f.files.recover(f.owner.id, request, () => {});
    if (state === 'trashed')
      f.db
        .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
        .run(randomUUID(), item.id);
    else if (state === 'deleted')
      f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(item.id);
    else
      f.db
        .prepare('UPDATE workspace_items SET owner_id=? WHERE id=?')
        .run(f.collaborator.id, item.id);
    await expect(f.files.recover(f.owner.id, request, () => {})).rejects.toMatchObject({
      status: 409,
    });
    expect(
      f.db.prepare('SELECT count(*) AS count FROM workspace_offline_recoveries').get()!.count,
    ).toBe(1);
    expect(f.db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count).toBe(
      state === 'deleted' ? 0 : 1,
    );
  },
);

test('recovery keeps Doc Formula definitions, rejects cached values and reauthorizes source access', async () => {
  const f = fixture();
  const source = f.workspace.create(f.owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  const expression = '=Budget.Summary.A1';
  const reference = parseFormula(expression)[0];
  const definition = {
    version: 1 as const,
    expression,
    references: [
      {
        start: reference.start,
        end: reference.end,
        itemId: source.id,
        sheetId: 'summary',
        range: reference.range,
      },
    ],
  };
  const body = formulaBody('formula', definition);
  body.dataStream += '\r\n';
  const request = { ...f.input('doc'), snapshot: { id: 'old-host', title: 'Recovery', body } };
  const item = await f.files.recover(f.collaborator.id, request, () => {});
  const saved = f.files.docs.load(f.collaborator.id, item.id).snapshot!;
  expect(docFormulas(saved.body)[0].definition).toEqual(definition);
  const prepare = vi.fn();
  const collaboration = { prepare } as unknown as CollaborationStore;
  const formulas = new DocFormulas(f.workspace, collaboration);
  await expect(
    formulas.resolve(f.collaborator.id, item.id, { expression, previous: definition }, () => {}),
  ).rejects.toThrow();
  expect(prepare).not.toHaveBeenCalled();
  const invalid = structuredClone(request);
  const annotation = invalid.snapshot.body.customRanges![0].properties!.spinelFormula as Record<
    string,
    unknown
  >;
  annotation.result = 42;
  await expect(
    f.files.recover(f.collaborator.id, { ...invalid, recoveryId: randomUUID() }, () => {}),
  ).rejects.toMatchObject({ status: 400 });
  expect(f.workspace.list(f.collaborator.id)).toEqual([item]);
});

test('a revoked Space child recovers into ordinary owned files with separately scoped image bytes', async () => {
  const f = fixture();
  const spaces = new SpaceStore(f.workspace);
  const root = spaces.createRoot(f.owner.id, { name: 'Project', parentId: null }).space;
  const child = spaces.createChild(f.owner.id, root.id, {
    name: 'Notes',
    kind: 'doc',
    parentId: root.id,
  }).item;
  spaces.share(f.owner.id, root.id, f.collaborator.id, 'editor');
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ab4567' } })
    .png()
    .toBuffer();
  const request = {
    ...f.input('doc'),
    snapshot: {
      ...f.snapshot('doc', child.id),
      drawings: {
        picture: {
          drawingType: 0,
          imageSourceType: 'BASE64',
          source: `data:image/png;base64,${bytes.toString('base64')}`,
          unitId: child.id,
          subUnitId: child.id,
        },
      },
    },
  };
  spaces.share(f.owner.id, root.id, f.collaborator.id, null);
  const original = f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(child.id);
  const item = await f.files.recover(f.collaborator.id, request, () => {});
  expect(
    f.db.prepare('SELECT parent_id,space_id,owner_id FROM workspace_items WHERE id=?').get(item.id),
  ).toEqual({ parent_id: null, space_id: null, owner_id: f.collaborator.id });
  const saved = f.files.docs.load(f.collaborator.id, item.id).snapshot!;
  const source = (saved.drawings!.picture as unknown as { source: string }).source;
  expect(source).toMatch(new RegExp(`^/api/items/${item.id}/images/[a-f0-9]{64}$`));
  expect(
    Buffer.from(f.files.docs.image(f.collaborator.id, item.id, source.split('/').at(-1)!).data),
  ).toEqual(bytes);
  expect(f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(child.id)).toEqual(original);
  expect(
    f.db.prepare('SELECT count(*) AS count FROM doc_images WHERE item_id=?').get(child.id)!.count,
  ).toBe(0);
  expect(() => f.files.docs.image(f.owner.id, item.id, source.split('/').at(-1)!)).toThrow();
});

test('invalid payloads, operators, disabled accounts and late failures publish neither copy nor receipt', async () => {
  const f = fixture();
  const request = f.input('doc');
  for (const change of [
    { recoveryId: 'not-a-uuid' },
    { possibleReplayCrash: 'yes' },
    { snapshot: { ...request.snapshot, body: { dataStream: 'No native terminator' } } },
    { snapshot: { ...request.snapshot, extra: 'x'.repeat(PORTABLE_LIMIT) } },
    {
      snapshot: {
        ...request.snapshot,
        drawings: { picture: { source: 'https://example.test/private.png' } },
      },
    },
  ])
    await expect(
      f.files.recover(f.owner.id, { ...request, ...change }, () => {}),
    ).rejects.toThrow();
  await expect(f.files.recover(f.operator.id, request, () => {})).rejects.toMatchObject({
    status: 403,
  });
  const originalPrepare = f.files.prepare.bind(f.files);
  vi.spyOn(f.files, 'prepare').mockImplementation(async (...args) => {
    const prepared = await originalPrepare(...args);
    f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
    return prepared;
  });
  await expect(f.files.recover(f.owner.id, request, () => {})).rejects.toMatchObject({
    status: 401,
  });
  expect(f.db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count).toBe(0);
  expect(
    f.db.prepare('SELECT count(*) AS count FROM workspace_offline_recoveries').get()!.count,
  ).toBe(0);
  expect(f.db.prepare('SELECT count(*) AS count FROM doc_images').get()!.count).toBe(0);
});

test('a failure writing the receipt rolls back the snapshot and item together', async () => {
  const f = fixture();
  f.db.exec(
    "CREATE TRIGGER fail_recovery BEFORE INSERT ON workspace_offline_recoveries BEGIN SELECT RAISE(ABORT,'Disk failure'); END",
  );
  await expect(f.files.recover(f.owner.id, f.input('doc'), () => {})).rejects.toThrow(
    'Disk failure',
  );
  expect(f.workspace.list(f.owner.id)).toEqual([]);
  expect(f.db.prepare('SELECT count(*) AS count FROM doc_snapshots').get()!.count).toBe(0);
  expect(
    f.db.prepare('SELECT count(*) AS count FROM workspace_offline_recoveries').get()!.count,
  ).toBe(0);
});
