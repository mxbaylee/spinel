import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { LocaleType } from '@univerjs/core';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, hashToken } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { WorkspaceStore } from './store.ts';
import { PortableFiles } from './portable.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { HistoryStore } from '../history/store.ts';
import { gzipSync } from 'node:zlib';
import { createHistoryReadContext } from './document-access.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});
function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    reader = auth.createUser('Reader'),
    operator = auth.createUser('Operator', true);
  const context = (user = owner.id) => ({
    sessionHash: auth.createSession(user).session.token_hash,
  });
  const ownerContext = context(),
    readerContext = context(reader.id);
  const folder = workspace.create(owner.id, { name: 'Templates', kind: 'folder', parentId: null });
  const doc = workspace.create(owner.id, { name: 'Notes', kind: 'doc', parentId: folder.id });
  const sheet = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: folder.id });
  const spaces = new SpaceStore(workspace);
  const space = spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space;
  const child = spaces.createChild(owner.id, space.id, {
    name: 'Page',
    kind: 'doc',
    parentId: space.id,
  }).item;
  spaces.share(owner.id, space.id, reader.id, 'viewer');
  const scoped = (user = owner.id) => ({
    ...context(user),
    spaceId: space.id,
    spaceItem: child.id,
  });
  const snapshots = new Map<string, IDocumentData | IWorkbookData>([
    [doc.id, { id: doc.id, body: { dataStream: 'Current confirmed content\r\n' } }],
    [child.id, { id: child.id, body: { dataStream: 'Current Space content\r\n' } }],
    [
      sheet.id,
      {
        id: sheet.id,
        name: sheet.name,
        appVersion: '1.1.0',
        locale: LocaleType.EN_US,
        styles: {},
        sheetOrder: ['tab'],
        sheets: {
          tab: {
            id: 'tab',
            name: 'Summary',
            rowCount: 100,
            columnCount: 26,
            cellData: { 0: { 0: { v: 42 }, 1: { f: `=[${sheet.id}]tab!A1` } } },
          },
        },
      },
    ],
  ]);
  const prepare = vi.fn(async () => {});
  const load = vi.fn(async (_user: string, id: string) => ({ snapshot: snapshots.get(id)! }));
  const generations = new CollaborationGenerations(workspace);
  const collaboration = { prepare, load, generations } as unknown as CollaborationStore;
  const files = new PortableFiles(workspace, collaboration);
  const copy = (id = doc.id, input: { name?: unknown; parentId?: unknown } = {}) =>
    files.copy(owner.id, id, input, () => {}, ownerContext);
  const count = () => Number(db.prepare('SELECT count(*) AS n FROM workspace_items').get()!.n);
  const image = (id: string, bytes: Buffer, mime = 'image/png') => {
    const imageId = createHash('sha256').update(bytes).digest('hex');
    db.prepare('INSERT INTO doc_images VALUES(?,?,?,?)').run(id, imageId, mime, bytes);
    return `/api/items/${id}/images/${imageId}`;
  };
  return {
    db,
    auth,
    workspace,
    collaboration,
    owner,
    reader,
    operator,
    context,
    ownerContext,
    readerContext,
    folder,
    doc,
    sheet,
    child,
    space,
    spaces,
    scoped,
    snapshots,
    prepare,
    load,
    generations,
    files,
    copy,
    count,
    image,
  };
}

test('copy uses confirmed content, a fresh item and rebased native self references, not the stale legacy snapshot', async () => {
  const f = fixture();
  f.files.docs.save(f.owner.id, f.doc.id, {
    snapshot: { id: f.doc.id, body: { dataStream: 'Stale\r\n' } },
    revision: 0,
    writeId: randomUUID(),
  });
  const doc = await f.copy();
  expect(doc).toMatchObject({
    name: 'Notes (copy)',
    parentId: f.folder.id,
    access: 'owner',
    tags: [],
  });
  expect(doc.id).not.toBe(f.doc.id);
  expect(f.files.docs.load(f.owner.id, doc.id).snapshot!.body!.dataStream).toBe(
    'Current confirmed content\r\n',
  );
  const sheet = await f.copy(f.sheet.id, { parentId: null, name: 'Next budget' });
  const saved = f.files.sheets.load(f.owner.id, sheet.id).snapshot!;
  expect(saved.name).toBe('Next budget');
  expect(saved.sheets.tab.cellData![0]![1]!.f).toContain(sheet.id);
  expect(saved.sheets.tab.cellData![0]![0]!.v).toBe(42);
  saved.sheets.tab.cellData![0]![0]!.v = 99;
  f.files.sheets.save(f.owner.id, sheet.id, {
    snapshot: saved,
    revision: 1,
    writeId: randomUUID(),
  });
  expect((f.snapshots.get(f.sheet.id) as IWorkbookData).sheets.tab.cellData![0]![0]!.v).toBe(42);
});

test.each(['viewer', 'editor', 'admin'] as const)(
  'a %s copy belongs to the caller in My files and carries no source sharing, tags or links',
  async (role) => {
    const f = fixture();
    f.workspace.share(f.owner.id, f.doc.id, f.reader.id, role);
    f.workspace.changeTag(f.reader.id, f.doc.id, 'Personal');
    const link = f.workspace.links.begin(f.doc.id, 'editor');
    f.workspace.links.finish(f.doc.id, link.epoch, true);
    const copy = await f.files.copy(f.reader.id, f.doc.id, {}, () => {}, f.readerContext);
    expect(copy).toMatchObject({ access: 'owner', parentId: null, tags: [] });
    expect(f.workspace.fileOwner(copy.id)).toBe(f.reader.id);
    expect(
      f.db.prepare('SELECT count(*) AS n FROM workspace_grants WHERE item_id=?').get(copy.id)!.n,
    ).toBe(0);
    expect(
      f.db.prepare('SELECT count(*) AS n FROM workspace_links WHERE item_id=?').get(copy.id)!.n,
    ).toBe(0);
    expect(() => f.workspace.get(f.owner.id, copy.id)).toThrow();
    f.workspace.share(f.owner.id, f.doc.id, f.reader.id, null);
    expect(f.files.docs.load(f.reader.id, copy.id).snapshot!.body!.dataStream).toContain(
      'Current confirmed',
    );
  },
);

test('destination grants apply normally, but source direct grants are never reproduced', async () => {
  const f = fixture();
  f.workspace.share(f.owner.id, f.folder.id, f.reader.id, 'viewer');
  f.workspace.share(f.owner.id, f.doc.id, f.reader.id, 'editor');
  const copy = await f.copy();
  expect(f.workspace.get(f.reader.id, copy.id).access).toBe('viewer');
});

test('a scoped Space child becomes standalone while wrong roots, ordinary ingress, operators and non-account credentials fail', async () => {
  const f = fixture();
  const context = f.scoped(f.reader.id);
  const item = await f.files.copy(f.reader.id, f.child.id, {}, () => {}, context);
  expect(item).toMatchObject({ parentId: null, access: 'owner' });
  expect(
    f.db.prepare('SELECT space_id FROM workspace_items WHERE id=?').get(item.id)!.space_id,
  ).toBeNull();
  await expect(f.copy(f.child.id)).rejects.toThrow();
  await expect(
    f.files.copy(f.reader.id, f.child.id, {}, () => {}, { ...context, spaceId: randomUUID() }),
  ).rejects.toThrow();
  await expect(
    f.files.copy(f.operator.id, f.doc.id, {}, () => {}, f.context(f.operator.id)),
  ).rejects.toThrow();
  await expect(f.files.copy(f.owner.id, f.doc.id, {}, () => {}, {})).rejects.toMatchObject({
    status: 403,
  });
  const history = createHistoryReadContext(f.workspace, f.owner.id, f.space.id, f.child.id);
  await expect(f.files.copy(f.owner.id, f.child.id, {}, () => {}, history)).rejects.toMatchObject({
    status: 403,
  });
  const link = f.workspace.links.begin(f.doc.id, 'editor');
  f.workspace.links.finish(f.doc.id, link.epoch, true);
  const guest = f.workspace.links.exchange(f.doc.id, link.token);
  await expect(
    f.files.copy(guest.userId, f.doc.id, {}, () => {}, {
      guestHash: hashToken(guest.token),
      guestItem: f.doc.id,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(f.copy(f.folder.id)).rejects.toMatchObject({ status: 400 });
  await expect(
    f.files.copy(f.owner.id, f.space.id, {}, () => {}, { ...f.scoped(), spaceItem: f.space.id }),
  ).rejects.toThrow();
  await expect(f.copy(f.doc.id, { parentId: f.space.id })).rejects.toThrow();
});

test('trusted copy preserves validated Formula definitions and bindings without computing or granting their sources', async () => {
  const f = fixture();
  const expression = '=Budget.Summary.A1';
  const reference = parseFormula(expression)[0];
  const definition = {
    version: 1 as const,
    expression,
    references: [
      {
        start: reference.start,
        end: reference.end,
        itemId: f.sheet.id,
        sheetId: 'tab',
        range: reference.range,
      },
    ],
  };
  const body = formulaBody('formula', definition);
  body.dataStream += '\r\n';
  f.snapshots.set(f.doc.id, { id: f.doc.id, body });
  f.workspace.share(f.owner.id, f.doc.id, f.reader.id, 'viewer');
  const item = await f.files.copy(f.reader.id, f.doc.id, {}, () => {}, f.readerContext);
  const saved = f.files.docs.load(f.reader.id, item.id).snapshot!;
  expect(docFormulas(saved.body).map((entry) => entry.definition)).toEqual([definition]);
  expect(saved.body).toEqual(body);
  expect(() => f.workspace.get(f.reader.id, f.sheet.id)).toThrow();
});

test.each(['png', 'jpeg', 'webp'] as const)(
  '%s bytes keep digest integrity in an independent destination image scope',
  async (format) => {
    const f = fixture();
    const bytes = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#dd88aa' },
    })
      .toFormat(format)
      .toBuffer();
    const source = f.image(f.doc.id, bytes, `image/${format}`);
    f.snapshots.set(f.doc.id, {
      id: f.doc.id,
      body: { dataStream: 'Picture\r\n' },
      drawings: { picture: { source } },
    } as unknown as IDocumentData);
    f.workspace.share(f.owner.id, f.doc.id, f.reader.id, 'viewer');
    const item = await f.files.copy(f.reader.id, f.doc.id, {}, () => {}, f.readerContext);
    const copied = f.files.docs.load(f.reader.id, item.id).snapshot!;
    const url = (copied.drawings!.picture as unknown as { source: string }).source;
    expect(url).toContain(`/api/items/${item.id}/images/`);
    expect(url).not.toBe(source);
    expect(url.split('/').at(-1)).toBe(source.split('/').at(-1));
    expect(url.split('/').at(-1)).toBe(createHash('sha256').update(bytes).digest('hex'));
    f.workspace.share(f.owner.id, f.doc.id, f.reader.id, null);
    expect(() => f.files.docs.image(f.reader.id, f.doc.id, source.split('/').at(-1)!)).toThrow();
    f.db.prepare('DELETE FROM doc_images WHERE item_id=?').run(f.doc.id);
    expect(
      Buffer.from(f.files.docs.image(f.reader.id, item.id, url.split('/').at(-1)!).data),
    ).toEqual(bytes);
  },
);

test.each(['prepare', 'load', 'decode'] as const)(
  'source/session/destination/generation changes during %s leave no partial copy',
  async (boundary) => {
    for (const change of [
      'source',
      'session',
      'destination',
      'generation',
      'disconnect',
    ] as const) {
      const f = fixture();
      f.workspace.share(f.owner.id, f.doc.id, f.reader.id, 'viewer');
      const destination = f.workspace.create(f.reader.id, {
        name: 'Mine',
        kind: 'folder',
        parentId: null,
      });
      const bytes = await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#dd88aa' },
      })
        .png()
        .toBuffer();
      const source = f.image(f.doc.id, bytes);
      f.snapshots.set(f.doc.id, {
        id: f.doc.id,
        body: { dataStream: '\r\n' },
        drawings: { picture: { source } },
      } as unknown as IDocumentData);
      let connected = true;
      const changeState = () => {
        if (change === 'source') f.workspace.share(f.owner.id, f.doc.id, f.reader.id, null);
        if (change === 'session') f.auth.revokeSession(f.readerContext.sessionHash);
        if (change === 'destination')
          f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(destination.id);
        if (change === 'generation')
          vi.spyOn(f.generations, 'active').mockReturnValue({
            itemId: f.doc.id,
            unitId: randomUUID(),
            offset: 0,
          });
        if (change === 'disconnect') connected = false;
      };
      if (boundary === 'prepare') f.prepare.mockImplementationOnce(async () => changeState());
      if (boundary === 'load')
        f.load.mockImplementationOnce(async (_user, id) => {
          changeState();
          return { snapshot: f.snapshots.get(id)! };
        });
      if (boundary === 'decode') {
        const decode = sharp.prototype.toBuffer;
        vi.spyOn(sharp.prototype, 'toBuffer').mockImplementationOnce(async function (this: Sharp) {
          changeState();
          return decode.call(this);
        });
      }
      const before = f.count();
      await expect(
        f.files.copy(
          f.reader.id,
          f.doc.id,
          { parentId: destination.id },
          () => {
            if (!connected) throw new Error('Disconnected');
          },
          f.readerContext,
        ),
      ).rejects.toThrow();
      expect(f.count()).toBe(before - (change === 'destination' ? 1 : 0));
      expect(
        f.db.prepare('SELECT count(*) AS n FROM doc_images WHERE item_id<>?').get(f.doc.id)!.n,
      ).toBe(0);
      vi.restoreAllMocks();
    }
  },
);

test('atomic writer rolls back new item, images and snapshot when save observers fail', async () => {
  const f = fixture();
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#dd88aa' } })
    .png()
    .toBuffer();
  const source = f.image(f.doc.id, bytes);
  f.snapshots.set(f.doc.id, {
    id: f.doc.id,
    body: { dataStream: '\r\n' },
    drawings: { picture: { source } },
  } as unknown as IDocumentData);
  f.workspace.onSnapshotSaved(() => {
    throw new Error('History baseline failed');
  });
  const before = f.count();
  await expect(f.copy()).rejects.toThrow('History baseline failed');
  expect(f.count()).toBe(before);
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_snapshots').get()!.n).toBe(0);
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_images').get()!.n).toBe(1);
});

test('copy enforces content and individual image limits before creating anything', async () => {
  const f = fixture();
  const before = f.count();
  f.snapshots.set(f.doc.id, {
    id: f.doc.id,
    body: { dataStream: 'x'.repeat(10 * 1024 * 1024) + '\r\n' },
  });
  await expect(f.copy()).rejects.toMatchObject({ status: 413 });
  for (const bytes of [Buffer.from('invalid PNG'), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
    const source = f.image(f.doc.id, bytes);
    f.snapshots.set(f.doc.id, {
      id: f.doc.id,
      body: { dataStream: '\r\n' },
      drawings: { picture: { source } },
    } as unknown as IDocumentData);
    await expect(f.copy()).rejects.toMatchObject({
      status: bytes.length > 5 * 1024 * 1024 ? 413 : 400,
    });
  }
  expect(f.count()).toBe(before);
});

test('the new item starts its own baseline instead of inheriting named or historical checkpoints', async () => {
  const f = fixture();
  const dispose = () => ({ dispose: () => {} });
  const history = new HistoryStore(f.workspace, {
    ...f.collaboration,
    onPrepared: dispose,
    service: { use: dispose, on: dispose },
  } as unknown as CollaborationStore);
  try {
    f.db
      .prepare("INSERT INTO history_checkpoints VALUES(?,?,'native',1,1,'Old template',?)")
      .run(randomUUID(), f.doc.id, gzipSync('old snapshot'));
    const item = await f.copy();
    const checkpoints = f.db
      .prepare('SELECT name,revision FROM history_checkpoints WHERE item_id=?')
      .all(item.id);
    expect(checkpoints).toEqual([{ name: null, revision: 1 }]);
    expect(
      f.db.prepare('SELECT name FROM history_checkpoints WHERE item_id=?').get(f.doc.id)!.name,
    ).toBe('Old template');
  } finally {
    await history.close();
  }
});

test('copy has independent 50 MiB images and 10 MiB content budgets, without the portable 20 MiB envelope', async () => {
  const f = fixture();
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#dd88aa' } })
    .png()
    .toBuffer();
  // Static valid PNG with opaque trailing padding exercises stored byte accounting,
  // without generating/decoding a large raster. Each source asset remains distinct.
  const bytes = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length)]);
  const drawings: Record<string, { source: string }> = {};
  for (let n = 0; n < 10; n++) {
    bytes[bytes.length - 1] = n;
    drawings[String(n)] = { source: f.image(f.doc.id, bytes) };
  }
  f.snapshots.set(f.doc.id, {
    id: f.doc.id,
    body: { dataStream: '\r\n' },
    drawings,
  } as unknown as IDocumentData);
  const copy = await f.copy();
  expect(
    f.db.prepare('SELECT sum(length(data)) AS n FROM doc_images WHERE item_id=?').get(copy.id)!.n,
  ).toBe(50 * 1024 * 1024);
  drawings.extra = { source: f.image(f.doc.id, png) };
  const before = f.count();
  await expect(f.copy()).rejects.toMatchObject({ status: 413 });
  expect(f.count()).toBe(before);
});

test('Sheet background and cell images are re-scoped together and internal Sheets copy to standalone files', async () => {
  const f = fixture();
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#dd88aa' } })
    .png()
    .toBuffer();
  const internal = f.spaces.createChild(f.owner.id, f.space.id, {
    name: 'Sheet page',
    kind: 'sheet',
    parentId: f.space.id,
  }).item;
  const source = f.image(internal.id, bytes);
  const snapshot = structuredClone(f.snapshots.get(f.sheet.id)!) as IWorkbookData;
  snapshot.id = internal.id;
  snapshot.sheets.tab.backgroundImage = { source } as unknown as NonNullable<
    typeof snapshot.sheets.tab.backgroundImage
  >;
  snapshot.sheets.tab.cellData![0]![2] = {
    p: {
      id: 'embedded-cell-doc',
      body: { dataStream: '\r\n' },
      drawings: { image: { source } },
    } as unknown as IDocumentData,
  };
  f.snapshots.set(internal.id, snapshot);
  const copy = await f.files.copy(f.reader.id, internal.id, {}, () => {}, {
    ...f.scoped(f.reader.id),
    spaceItem: internal.id,
  });
  const saved = f.files.sheets.load(f.reader.id, copy.id).snapshot!;
  const background = saved.sheets.tab.backgroundImage as unknown as { source: string };
  expect(background.source).toContain(`/api/items/${copy.id}/images/`);
  expect(
    (saved.sheets.tab.cellData![0]![2]!.p!.drawings!.image as unknown as { source: string }).source,
  ).toBe(background.source);
  expect(saved.sheets.tab.cellData![0]![2]!.p!.id).toBe('embedded-cell-doc');
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_images WHERE item_id=?').get(copy.id)!.n).toBe(
    1,
  );
  expect(copy.parentId).toBeNull();
});

test('the final transaction rechecks authority after save observers and rolls back the copy', async () => {
  const f = fixture();
  f.workspace.share(f.owner.id, f.doc.id, f.reader.id, 'viewer');
  f.workspace.onSnapshotSaved(() => f.workspace.share(f.owner.id, f.doc.id, f.reader.id, null));
  const before = f.count();
  await expect(
    f.files.copy(f.reader.id, f.doc.id, {}, () => {}, f.readerContext),
  ).rejects.toThrow();
  expect(f.count()).toBe(before);
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_snapshots').get()!.n).toBe(0);
});
