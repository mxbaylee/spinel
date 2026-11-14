import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { ImageSourceType } from '@univerjs/core';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { AppearanceStore } from '../appearance/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { DocFormulas } from '../formulas/service.ts';
import { CopyFiles } from './copy.ts';
import { PortableFiles } from './portable.ts';
import { WorkspaceStore } from './store.ts';
import { SpaceStore } from './spaces.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { IMAGE_LIMIT } from './documents.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => db.close());
});

function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const collaborator = auth.createUser('Collaborator');
  const operator = auth.createUser('Operator', true);
  const files = new PortableFiles(workspace);
  const copies = new CopyFiles(workspace, files);
  const appearance = new AppearanceStore(workspace);
  const folder = workspace.create(owner.id, { kind: 'folder', name: 'Recipes', parentId: null });
  const create = async (kind: 'doc' | 'sheet' = 'doc', parentId: string | null = folder.id) =>
    files.import(
      owner.id,
      {
        filename: 'source.json',
        parentId,
        snapshot:
          kind === 'doc'
            ? {
                id: 'source',
                title: 'Recipe',
                body: { dataStream: 'Original\r\n' },
              }
            : {
                id: 'source',
                name: 'Budget',
                sheetOrder: ['summary'],
                sheets: {
                  summary: {
                    id: 'summary',
                    name: 'Summary',
                    rowCount: 100,
                    columnCount: 26,
                    cellData: { 0: { 0: { v: 42 }, 1: { f: '=[source]summary!A1' } } },
                  },
                },
              },
      },
      () => {},
    );
  const actor = (userId = owner.id) => ({ userId, customData: {} });
  const rowCounts = () =>
    [
      'workspace_items',
      'doc_snapshots',
      'sheet_snapshots',
      'doc_images',
      'cover_assets',
      'item_appearance',
      'workspace_item_creators',
    ].map((table) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n));
  return {
    db,
    auth,
    workspace,
    owner,
    collaborator,
    operator,
    files,
    copies,
    appearance,
    folder,
    create,
    actor,
    rowCounts,
  };
}

const png = () =>
  sharp({ create: { width: 3, height: 2, channels: 4, background: '#dd5577' } })
    .png()
    .toBuffer();

function native(
  f: ReturnType<typeof fixture>,
  id: string,
  kind: 'doc' | 'sheet',
  snapshot: IDocumentData | IWorkbookData,
) {
  const generations = new CollaborationGenerations(f.workspace);
  f.db
    .exec(`CREATE TABLE IF NOT EXISTS workspace_collaboration(item_id TEXT PRIMARY KEY,state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS spinel_sync_units(unit_id TEXT PRIMARY KEY,kind TEXT NOT NULL,revision INTEGER NOT NULL,snapshot TEXT NOT NULL,retained_from INTEGER NOT NULL);`);
  f.db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(id);
  f.db
    .prepare('INSERT INTO spinel_sync_units VALUES(?,?,7,?,1)')
    .run(id, kind, JSON.stringify(snapshot));
  const load = vi.fn(async (_user: string, itemId: string) => {
    const generation = generations.active(itemId);
    const row = f.db
      .prepare('SELECT snapshot,revision FROM spinel_sync_units WHERE unit_id=?')
      .get(generation.unitId)!;
    return {
      snapshot: JSON.parse(String(row.snapshot)),
      revision: Number(row.revision) + generation.offset,
    };
  });
  const collaboration = {
    generations,
    prepare: vi.fn(async () => {}),
    load,
  } as unknown as CollaborationStore;
  const files = new PortableFiles(f.workspace, collaboration);
  return { collaboration, files, copies: new CopyFiles(f.workspace, files), load, generations };
}

test.each(['doc', 'sheet'] as const)(
  '%s copies default to the owned source folder with a fresh ID and independent edits',
  async (kind) => {
    const f = fixture();
    const original = await f.create(kind);
    const copy = await f.copies.copy(f.owner.id, original.id, {}, () => {});
    expect(copy).toMatchObject({
      name: `${original.name} (copy)`,
      parentId: f.folder.id,
      access: 'owner',
      kind,
    });
    expect(copy.id).not.toBe(original.id);
    const store = kind === 'doc' ? f.files.docs : f.files.sheets;
    const before = store.load(f.owner.id, original.id).snapshot!;
    const loaded = store.load(f.owner.id, copy.id).snapshot!;
    expect(loaded.id).toBe(copy.id);
    if ('sheets' in loaded) {
      expect(loaded.name).toBe(copy.name);
      expect(loaded.sheets.summary.cellData![0]![1]!.f).toBe(`=[${copy.id}]summary!A1`);
      loaded.sheets.summary.cellData![0]![0]!.v = 99;
    } else {
      expect(loaded.title).toBe(copy.name);
      loaded.body!.dataStream = 'Changed copy\r\n';
    }
    store.save(f.owner.id, copy.id, { snapshot: loaded, revision: 1, writeId: randomUUID() });
    expect(store.load(f.owner.id, original.id).snapshot).toEqual(before);
    const rootCopy = await f.copies.copy(
      f.owner.id,
      original.id,
      { name: 'January', parentId: null },
      () => {},
    );
    expect(rootCopy).toMatchObject({ name: 'January', parentId: null });
  },
);

test.each(['viewer', 'editor', 'admin'] as const)(
  'a read-authorized %s receives an owned root copy without the source grants, tags or guest link',
  async (role) => {
    const f = fixture();
    const original = await f.create();
    f.workspace.share(f.owner.id, original.id, f.collaborator.id, role);
    f.workspace.changeTag(f.owner.id, original.id, 'Personal');
    const link = f.workspace.links.begin(original.id, 'viewer');
    f.workspace.links.finish(original.id, link.epoch, true);
    const copy = await f.copies.copy(f.collaborator.id, original.id, {}, () => {});
    expect(copy).toMatchObject({
      access: 'owner',
      parentId: null,
      tags: [],
      createdByName: 'Collaborator',
    });
    expect(f.workspace.fileOwner(copy.id)).toBe(f.collaborator.id);
    expect(f.db.prepare('SELECT * FROM workspace_grants WHERE item_id=?').all(copy.id)).toEqual([]);
    expect(f.workspace.links.metadata(copy.id).enabled).toBe(false);
    expect(() => f.workspace.get(f.owner.id, copy.id)).toThrow();
    f.workspace.share(f.owner.id, original.id, f.collaborator.id, null);
    expect(f.files.docs.load(f.collaborator.id, copy.id).snapshot!.body!.dataStream).toBe(
      'Original\r\n',
    );
  },
);

test('explicit shared-folder copies adopt its owner and creator attribution while options exclude viewers and Spaces', async () => {
  const f = fixture();
  const original = await f.create();
  const personal = f.workspace.create(f.collaborator.id, {
    kind: 'folder',
    name: 'Personal',
    parentId: null,
  });
  f.workspace.share(f.owner.id, original.id, f.collaborator.id, 'viewer');
  f.workspace.share(f.owner.id, f.folder.id, f.collaborator.id, 'viewer');
  const spaces = new SpaceStore(f.workspace);
  spaces.createRoot(f.collaborator.id, { name: 'Project', parentId: null });
  expect(f.copies.options(f.collaborator.id, original.id)).toMatchObject({
    name: 'Recipe (copy)',
    parentId: null,
    destinations: [personal],
  });
  await expect(
    f.copies.copy(f.collaborator.id, original.id, { parentId: f.folder.id }, () => {}),
  ).rejects.toMatchObject({ status: 403 });
  f.workspace.share(f.owner.id, f.folder.id, f.collaborator.id, 'editor');
  expect(
    f.copies.options(f.collaborator.id, original.id).destinations.map((item) => item.id),
  ).toContain(f.folder.id);
  const copy = await f.copies.copy(
    f.collaborator.id,
    original.id,
    { parentId: f.folder.id },
    () => {},
  );
  expect(copy).toMatchObject({
    access: 'editor',
    parentId: f.folder.id,
    createdByName: 'Collaborator',
  });
  expect(f.workspace.fileOwner(copy.id)).toBe(f.owner.id);
  expect(f.db.prepare('SELECT * FROM workspace_grants WHERE item_id=?').all(copy.id)).toEqual([]);
});

test('image and uploaded cover bytes survive loss of source access in the copy’s independent scope', async () => {
  const f = fixture();
  const original = await f.create();
  const bytes = await png();
  const image = await f.files.docs.upload(f.owner.id, original.id, bytes, 'image/png');
  const snapshot = f.files.docs.load(f.owner.id, original.id).snapshot!;
  snapshot.drawings = {
    picture: { source: image.url, unitId: original.id, subUnitId: original.id },
  } as unknown as IDocumentData['drawings'];
  f.files.docs.save(f.owner.id, original.id, { snapshot, revision: 1, writeId: randomUUID() });
  const saved = await f.appearance.update(f.actor(), original.id, {
    revision: 0,
    icon: '🌻',
    iconColor: 'info-strong',
    cover: {
      source: 'upload',
      position: 35,
      images: { shared: { data: bytes.toString('base64') } },
    },
  });
  f.workspace.share(f.owner.id, original.id, f.collaborator.id, 'viewer');
  const copy = await f.copies.copy(f.collaborator.id, original.id, {}, () => {});
  expect(copy.appearance).toMatchObject({ ...saved.appearance, revision: 1 });
  const copied = f.files.docs.load(f.collaborator.id, copy.id).snapshot!;
  expect(copied.drawings!.picture).toMatchObject({
    source: `/api/items/${copy.id}/images/${image.id}`,
    unitId: copy.id,
    subUnitId: copy.id,
  });
  const cover = saved.appearance.cover!;
  if (cover.source !== 'upload') throw new Error('Expected uploaded cover');
  const hash = cover.images.shared!;
  const coverBytes = f.appearance.asset(f.actor(), original.id, hash);
  f.workspace.share(f.owner.id, original.id, f.collaborator.id, null);
  expect(() => f.files.docs.image(f.collaborator.id, original.id, image.id)).toThrow();
  expect(() => f.appearance.asset(f.actor(f.collaborator.id), original.id, hash)).toThrow();
  expect(Buffer.from(f.files.docs.image(f.collaborator.id, copy.id, image.id).data)).toEqual(bytes);
  expect(f.appearance.asset(f.actor(f.collaborator.id), copy.id, hash)).toEqual(coverBytes);
  expect(JSON.stringify(copied)).not.toContain(original.id);
});

test('native Sheet drawing resources and background images are re-scoped without changing cell text', async () => {
  const f = fixture();
  const original = await f.create('sheet');
  const bytes = await png();
  const hash = createHash('sha256').update(bytes).digest('hex');
  f.db.prepare('INSERT INTO doc_images VALUES(?,?,?,?)').run(original.id, hash, 'image/png', bytes);
  const url = `/api/items/${original.id}/images/${hash}`;
  const snapshot = f.files.sheets.load(f.owner.id, original.id).snapshot!;
  snapshot.sheets.summary.backgroundImage = { source: url, imageSourceType: ImageSourceType.URL };
  snapshot.sheets.summary.cellData![1] = { 0: { v: url } };
  snapshot.resources = [
    {
      name: 'SHEET_DRAWING_PLUGIN',
      data: JSON.stringify({
        summary: {
          order: ['photo'],
          data: {
            photo: { drawingId: 'photo', source: url, unitId: original.id, subUnitId: 'summary' },
          },
        },
      }),
    },
  ];
  f.files.sheets.save(f.owner.id, original.id, { snapshot, revision: 1, writeId: randomUUID() });
  const copy = await f.copies.copy(f.owner.id, original.id, {}, () => {});
  const saved = f.files.sheets.load(f.owner.id, copy.id).snapshot!;
  expect(saved.sheets.summary.backgroundImage!.source).toBe(`/api/items/${copy.id}/images/${hash}`);
  expect(JSON.parse(saved.resources![0].data).summary.data.photo).toMatchObject({
    unitId: copy.id,
    source: `/api/items/${copy.id}/images/${hash}`,
  });
  expect(saved.sheets.summary.cellData![1]![0]!.v).toBe(url);
});

test('gem covers and saved Unsplash attribution survive copying without a new remote request', async () => {
  const f = fixture();
  const source = await f.create();
  await f.appearance.update(f.actor(), source.id, {
    revision: 0,
    cover: { source: 'gem', gem: 'amethyst' },
  });
  const gem = await f.copies.copy(f.owner.id, source.id, {}, () => {});
  expect(gem.appearance!.cover).toEqual({ source: 'gem', gem: 'amethyst' });
  const photo = {
    id: 'photo',
    url: 'https://images.unsplash.com/photo-example',
    photographer: 'Photographer',
    profile: 'https://unsplash.com/@photographer?utm_source=spinel&utm_medium=referral',
    page: 'https://unsplash.com/photos/photo?utm_source=spinel&utm_medium=referral',
  };
  const choose = vi.spyOn(f.appearance.provider, 'choose').mockResolvedValue(photo);
  await f.appearance.update(f.actor(), source.id, {
    revision: 1,
    cover: { source: 'unsplash', images: { shared: 'photo' }, position: 45 },
  });
  const copy = await f.copies.copy(f.owner.id, source.id, {}, () => {});
  expect(copy.appearance!.cover).toEqual({
    source: 'unsplash',
    images: { shared: photo },
    position: 45,
  });
  expect(choose).toHaveBeenCalledTimes(1);
});

test('Formula definitions retain deliberate source bindings, refuse cached results, and never grant source access', async () => {
  const f = fixture();
  const host = await f.create();
  const source = await f.create('sheet');
  const expression = '=Budget.Summary.A1';
  const reference = parseFormula(expression)[0];
  const definition = {
    version: 1 as const,
    expression,
    references: [
      {
        start: reference.start,
        end: reference.end,
        range: reference.range,
        itemId: source.id,
        sheetId: 'summary',
      },
    ],
  };
  const body = formulaBody('formula', definition);
  body.dataStream += '\r\n';
  const snapshot = { ...f.files.docs.load(f.owner.id, host.id).snapshot!, body };
  f.files.docs.save(f.owner.id, host.id, { snapshot, revision: 1, writeId: randomUUID() });
  f.workspace.share(f.owner.id, host.id, f.collaborator.id, 'viewer');
  const copy = await f.copies.copy(f.collaborator.id, host.id, {}, () => {});
  const saved = f.files.docs.load(f.collaborator.id, copy.id).snapshot!;
  expect(docFormulas(saved.body)[0].definition).toEqual(definition);
  const prepare = vi.fn();
  const formulas = new DocFormulas(f.workspace, { prepare } as unknown as CollaborationStore);
  expect(await formulas.evaluate(f.collaborator.id, copy.id, definition, () => {})).toEqual({
    ok: false,
    reason: 'private-source',
  });
  expect(prepare).not.toHaveBeenCalled();
  (snapshot.body.customRanges![0].properties!.spinelFormula as Record<string, unknown>).result =
    'PRIVATE RESULT';
  f.files.docs.save(f.owner.id, host.id, { snapshot, revision: 2, writeId: randomUUID() });
  const before = f.rowCounts();
  await expect(f.copies.copy(f.collaborator.id, host.id, {}, () => {})).rejects.toMatchObject({
    status: 400,
  });
  expect(f.rowCounts()).toEqual(before);
});

test('copy loads the durable collaboration head instead of the old imported snapshot', async () => {
  const f = fixture();
  const source = await f.create();
  const n = native(f, source.id, 'doc', {
    ...f.files.docs.load(f.owner.id, source.id).snapshot!,
    body: { dataStream: 'Latest confirmed edit\r\n' },
  });
  const copy = await n.copies.copy(f.owner.id, source.id, {}, () => {});
  expect(f.files.docs.load(f.owner.id, copy.id).snapshot!.body!.dataStream).toBe(
    'Latest confirmed edit\r\n',
  );
  expect(f.files.docs.load(f.owner.id, source.id).snapshot!.body!.dataStream).toBe('Original\r\n');
  expect(n.collaboration.prepare).toHaveBeenCalledWith(f.owner.id, source.id, {});
});

test.each([
  'edit',
  'restore',
  'appearance',
  'source-access',
  'destination-access',
  'session',
  'destination-owner',
] as const)('a late %s change fails the complete copy before publication', async (change) => {
  const f = fixture();
  const source = await f.create();
  f.workspace.share(f.owner.id, f.folder.id, f.collaborator.id, 'editor');
  const session = f.auth.createSession(f.collaborator.id).session;
  const custom = { sessionHash: session.token_hash };
  const n = native(f, source.id, 'doc', f.files.docs.load(f.owner.id, source.id).snapshot!);
  const prepare = n.files.prepare.bind(n.files);
  let before: number[] = [];
  vi.spyOn(n.files, 'prepare').mockImplementationOnce(async (...args) => {
    const prepared = await prepare(...args);
    if (change === 'edit')
      f.db
        .prepare('UPDATE spinel_sync_units SET revision=revision+1 WHERE unit_id=?')
        .run(source.id);
    if (change === 'restore')
      f.db.prepare('INSERT INTO spinel_live_units VALUES(?,?,7)').run(source.id, randomUUID());
    if (change === 'appearance')
      await f.appearance.update(f.actor(), source.id, { revision: 0, icon: '🌷' });
    if (change === 'source-access')
      f.workspace.share(f.owner.id, f.folder.id, f.collaborator.id, null);
    if (change === 'destination-access') {
      f.workspace.share(f.owner.id, source.id, f.collaborator.id, 'viewer');
      f.workspace.share(f.owner.id, f.folder.id, f.collaborator.id, 'viewer');
    }
    if (change === 'session') {
      f.auth.revokeSession(session.token_hash);
      custom.sessionHash = f.auth.createSession(f.collaborator.id).session.token_hash;
    }
    if (change === 'destination-owner')
      f.db
        .prepare('UPDATE workspace_items SET owner_id=? WHERE id IN (?,?)')
        .run(f.collaborator.id, source.id, f.folder.id);
    before = f.rowCounts();
    return prepared;
  });
  await expect(
    n.copies.copy(f.collaborator.id, source.id, { parentId: f.folder.id }, () => {}, custom),
  ).rejects.toThrow();
  expect(f.rowCounts()).toEqual(before);
});

test('a failed appearance publication rolls back the new item, native state and all assets', async () => {
  const f = fixture();
  const source = await f.create();
  const before = f.rowCounts();
  f.db.exec(
    "CREATE TRIGGER fail_copy BEFORE INSERT ON item_appearance BEGIN SELECT RAISE(ABORT,'Disk failure'); END",
  );
  await expect(f.copies.copy(f.owner.id, source.id, {}, () => {})).rejects.toThrow('Disk failure');
  expect(f.rowCounts()).toEqual(before);
});

test('source native content, individual images, aggregate images and owner cover storage remain bounded', async () => {
  const f = fixture();
  const source = await f.create();
  const saved = f.files.docs.load(f.owner.id, source.id).snapshot!;
  const write = (snapshot: unknown) =>
    f.db
      .prepare('UPDATE doc_snapshots SET snapshot=? WHERE item_id=?')
      .run(JSON.stringify(snapshot), source.id);
  write({ ...saved, extra: 'x'.repeat(10 * 1024 * 1024) });
  await expect(f.copies.copy(f.owner.id, source.id, {}, () => {})).rejects.toThrow('10 MiB');
  const image = (id: string) => ({ source: `/api/items/${source.id}/images/${id}` });
  const hash = 'a'.repeat(64);
  f.db
    .prepare('INSERT INTO doc_images VALUES(?,?,?,zeroblob(?))')
    .run(source.id, hash, 'image/png', IMAGE_LIMIT + 1);
  write({ ...saved, drawings: { first: image(hash) } });
  await expect(f.copies.copy(f.owner.id, source.id, {}, () => {})).rejects.toThrow('5 MiB');
  f.db.prepare('DELETE FROM doc_images').run();
  const drawings: Record<string, { source: string }> = {};
  for (let index = 0; index < 11; index++) {
    const id = index.toString(16).padStart(64, '0');
    f.db
      .prepare('INSERT INTO doc_images VALUES(?,?,?,zeroblob(?))')
      .run(source.id, id, 'image/png', IMAGE_LIMIT);
    drawings[id] = image(id);
  }
  write({ ...saved, drawings });
  await expect(f.copies.copy(f.owner.id, source.id, {}, () => {})).rejects.toThrow('50 MiB');
  f.db.prepare('DELETE FROM doc_images').run();
  write(saved);
  const bytes = await png();
  await f.appearance.update(f.actor(), source.id, {
    revision: 0,
    cover: {
      source: 'upload',
      position: 50,
      images: { shared: { data: bytes.toString('base64') } },
    },
  });
  f.db
    .prepare('INSERT INTO cover_assets VALUES(?,?,zeroblob(?))')
    .run(f.folder.id, 'b'.repeat(64), 100 * 1024 * 1024);
  const before = f.rowCounts();
  await expect(f.copies.copy(f.owner.id, source.id, {}, () => {})).rejects.toThrow(
    'Cover storage is full',
  );
  expect(f.rowCounts()).toEqual(before);
});

test('Space children copy to standalone files while whole Spaces, folders, guests and Operators cannot copy', async () => {
  const f = fixture();
  const spaces = new SpaceStore(f.workspace);
  const root = spaces.createRoot(f.owner.id, { name: 'Project', parentId: null }).space;
  const source = spaces.createChild(f.owner.id, root.id, {
    name: 'Notes',
    kind: 'doc',
    parentId: root.id,
  }).item;
  spaces.share(f.owner.id, root.id, f.collaborator.id, 'viewer');
  const session = f.auth.createSession(f.collaborator.id).session;
  const custom = { sessionHash: session.token_hash, spaceId: root.id, spaceItem: source.id };
  const n = native(f, source.id, 'doc', {
    id: source.id,
    title: 'Notes',
    documentStyle: {},
    body: { dataStream: 'Space content\r\n' },
  });
  expect(n.copies.options(f.collaborator.id, source.id, custom).parentId).toBe(null);
  const copy = await n.copies.copy(f.collaborator.id, source.id, {}, () => {}, custom);
  expect(
    f.db.prepare('SELECT owner_id,parent_id,space_id FROM workspace_items WHERE id=?').get(copy.id),
  ).toEqual({ owner_id: f.collaborator.id, parent_id: null, space_id: null });
  spaces.share(f.owner.id, root.id, f.collaborator.id, null);
  expect(f.files.docs.load(f.collaborator.id, copy.id).snapshot!.body!.dataStream).toBe(
    'Space content\r\n',
  );
  for (const [user, id, context] of [
    [f.operator.id, copy.id, {}],
    ['guest:any', copy.id, {}],
    [f.owner.id, f.folder.id, {}],
    [f.owner.id, root.id, {}],
    [f.owner.id, source.id, {}],
    [f.collaborator.id, source.id, custom],
  ] as const) {
    expect(() => n.copies.options(user, id, context)).toThrow();
    await expect(n.copies.copy(user, id, {}, () => {}, context)).rejects.toThrow();
  }
});

test('copy naming preserves a valid bounded suffix and rejects unrecognized mutation inputs', async () => {
  const f = fixture();
  const source = await f.create();
  f.workspace.update(f.owner.id, source.id, { name: 'a'.repeat(112) + '🌷🌷🌷🌷' });
  const name = f.copies.options(f.owner.id, source.id).name;
  expect(name).toBe('a'.repeat(112) + ' (copy)');
  expect(name.length).toBeLessThanOrEqual(120);
  for (const input of [
    null,
    [],
    { name: '' },
    { parentId: 123 },
    { snapshot: {} },
    { ownerId: f.collaborator.id },
  ])
    await expect(f.copies.copy(f.owner.id, source.id, input, () => {})).rejects.toThrow();
});
