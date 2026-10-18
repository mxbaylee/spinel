import { randomUUID } from 'node:crypto';
import { DatabaseSync } from '../../../server/database.ts';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { PortableFiles, PORTABLE_LIMIT } from './portable.ts';
import type { CollaborationStore } from '../collaboration/service.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner'),
    other = auth.createUser('Other');
  const files = new PortableFiles(workspace);
  const sheet = {
    id: 'source',
    name: 'Budget',
    sheetOrder: ['tab'],
    sheets: {
      tab: {
        id: 'tab',
        name: 'Budget',
        rowCount: 100,
        columnCount: 26,
        cellData: {
          0: { 0: { v: 42, s: { bg: { rgb: '#ffeecc' } } }, 1: { f: '=[source]tab!A1' } },
        },
      },
    },
    resources: [{ name: 'future-resource', data: 'keep me' }],
  };
  const doc = {
    id: 'source',
    title: 'Journal',
    body: { dataStream: 'Original\r\n', paragraphs: [{ startIndex: 8 }] },
  };
  return { db, auth, workspace, owner, other, files, sheet, doc };
}

test('native sheet import creates a new owned item in its folder and preserves content, styles, resources and self references', async () => {
  const f = fixture();
  const folder = f.workspace.create(f.owner.id, { name: 'Files', kind: 'folder', parentId: null });
  const item = await f.files.import(
    f.owner.id,
    { filename: 'Budget.univer.json', parentId: folder.id, snapshot: f.sheet },
    () => {},
  );
  expect(item.parentId).toBe(folder.id);
  expect(item.id).not.toBe('source');
  const saved = f.files.sheets.load(f.owner.id, item.id).snapshot!;
  expect(saved.sheets.tab.cellData![0]![0]).toEqual(f.sheet.sheets.tab.cellData[0][0]);
  expect(saved.sheets.tab.cellData![0]![1]!.f).toContain(item.id);
  expect(saved.resources).toEqual(f.sheet.resources);
  const exported = JSON.parse((await f.files.export(f.owner.id, item.id, () => {})).text);
  expect(exported).toEqual(saved);
  const second = await f.files.import(
    f.owner.id,
    { filename: 'second.json', parentId: folder.id, snapshot: exported },
    () => {},
  );
  expect(second.id).not.toBe(item.id);
  expect(f.files.sheets.load(f.owner.id, item.id).snapshot).toEqual(saved);
  await expect(f.files.export(f.other.id, item.id, () => {})).rejects.toThrow();
});

test('PNG, JPEG and WebP images round-trip by bytes and acquire new document-scoped URLs', async () => {
  const f = fixture();
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const bytes = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#aa5588' },
    })
      .toFormat(format)
      .toBuffer();
    const source = `data:image/${format};base64,${bytes.toString('base64')}`;
    const drawing = {
      source,
      drawingType: 0,
      imageSourceType: 'BASE64',
      unitId: 'source',
      subUnitId: 'source',
    };
    const snapshot = {
      ...f.doc,
      drawings: { picture: drawing },
      resources: [{ name: 'DOC_DRAWING_PLUGIN', data: JSON.stringify({ picture: drawing }) }],
    };
    const first = await f.files.import(
      f.owner.id,
      { filename: 'image.json', parentId: null, snapshot },
      () => {},
    );
    const native = f.files.docs.load(f.owner.id, first.id).snapshot!;
    const savedSource = (native.drawings!.picture as unknown as { source: string }).source;
    expect(savedSource).toContain(`/api/items/${first.id}/images/`);
    expect(
      Buffer.from(f.files.docs.image(f.owner.id, first.id, savedSource.split('/').at(-1)!).data),
    ).toEqual(bytes);
    const exported = JSON.parse((await f.files.export(f.owner.id, first.id, () => {})).text);
    expect(exported.drawings.picture.source).toBe(source);
    const second = await f.files.import(
      f.owner.id,
      { filename: 'copy.json', parentId: null, snapshot: exported },
      () => {},
    );
    const secondSource = (
      f.files.docs.load(f.owner.id, second.id).snapshot!.drawings!.picture as unknown as {
        source: string;
      }
    ).source;
    expect(secondSource).toContain(`/api/items/${second.id}/images/`);
    expect(
      Buffer.from(f.files.docs.image(f.owner.id, second.id, secondSource.split('/').at(-1)!).data),
    ).toEqual(bytes);
  }
});

test('malformed/other formats, remote images, unauthorized folders and oversized files publish nothing', async () => {
  const f = fixture();
  const before = f.workspace.list(f.owner.id);
  for (const [filename, snapshot] of [
    ['file.pdf', f.doc],
    ['file.xlsx', f.sheet],
    ['file.csv', f.sheet],
    ['file.json', {}],
    ['file.json', { ...f.doc, resources: {} }],
    ['file.json', { ...f.doc, drawings: { image: { source: 'https://example.com/private.png' } } }],
    ['file.json', { ...f.doc, drawings: { image: { source: 'data:image/png;base64,YmFk' } } }],
  ] as const)
    await expect(
      f.files.import(f.owner.id, { filename, parentId: null, snapshot }, () => {}),
    ).rejects.toThrow();
  const privateFolder = f.workspace.create(f.other.id, {
    name: 'Private',
    kind: 'folder',
    parentId: null,
  });
  await expect(
    f.files.import(
      f.owner.id,
      { filename: 'file.json', parentId: privateFolder.id, snapshot: f.doc },
      () => {},
    ),
  ).rejects.toThrow();
  await expect(
    f.files.import(
      f.owner.id,
      {
        filename: 'file.json',
        parentId: null,
        snapshot: { ...f.doc, extra: 'x'.repeat(PORTABLE_LIMIT) },
      },
      () => {},
    ),
  ).rejects.toThrow('20 MiB');
  expect(f.workspace.list(f.owner.id)).toEqual(before);
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_images').get()!.n).toBe(0);
});

test('late snapshot failure and revoked session roll back the entire new item and its images', async () => {
  const f = fixture();
  const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const snapshot = {
    ...f.doc,
    body: { dataStream: 'invalid terminator' },
    drawings: { p: { source: `data:image/png;base64,${bytes.toString('base64')}` } },
  };
  await expect(
    f.files.import(f.owner.id, { filename: 'file.json', parentId: null, snapshot }, () => {}),
  ).rejects.toThrow('Invalid document');
  await expect(
    f.files.import(f.owner.id, { filename: 'file.json', parentId: null, snapshot: f.doc }, () => {
      throw new Error('Session revoked');
    }),
  ).rejects.toThrow('Session revoked');
  expect(f.workspace.list(f.owner.id)).toEqual([]);
  expect(f.db.prepare('SELECT count(*) AS n FROM doc_images').get()!.n).toBe(0);
  // A nested rollback must not poison the next valid transaction.
  expect(
    await f.files.import(
      f.owner.id,
      { filename: 'file.json', parentId: null, snapshot: f.doc },
      () => {},
    ),
  ).toMatchObject({ name: 'Journal' });
});

test('exports use current materialized collaboration state and recheck access after loading', async () => {
  const f = fixture();
  const item = await f.files.import(
    f.owner.id,
    { filename: 'file.json', parentId: null, snapshot: f.doc },
    () => {},
  );
  const current = { ...f.doc, id: item.id, body: { dataStream: 'Latest accepted edit\r\n' } };
  const collaboration = {
    prepare: vi.fn(async () => {}),
    load: vi.fn(async () => ({ snapshot: current })),
  } as unknown as CollaborationStore;
  const files = new PortableFiles(f.workspace, collaboration);
  expect(JSON.parse((await files.export(f.owner.id, item.id, () => {})).text).body.dataStream).toBe(
    'Latest accepted edit\r\n',
  );
  expect(collaboration.prepare).toHaveBeenCalledWith(f.owner.id, item.id);
  await expect(
    files.export(f.owner.id, item.id, () => {
      throw new Error('Expired');
    }),
  ).rejects.toThrow('Expired');
  expect(f.files.docs.load(f.owner.id, item.id).snapshot!.body!.dataStream).toBe('Original\r\n');
});

test('nested transactions retain outer atomicity and can roll back an inner savepoint', () => {
  const f = fixture();
  f.auth.transaction(() => {
    f.auth.createUser('Kept');
    expect(() =>
      f.auth.transaction(() => {
        f.auth.createUser('Rolled back');
        throw new Error('fail');
      }),
    ).toThrow('fail');
  });
  expect(f.db.prepare('SELECT name FROM auth_users WHERE name=?').get('Kept')).toBeDefined();
  expect(
    f.db.prepare('SELECT name FROM auth_users WHERE name=?').get('Rolled back'),
  ).toBeUndefined();
  expect(() =>
    f.auth.transaction(() => {
      f.auth.transaction(() => f.auth.createUser('Also rolled back'));
      throw new Error('outer');
    }),
  ).toThrow('outer');
  expect(
    f.db.prepare('SELECT name FROM auth_users WHERE name=?').get('Also rolled back'),
  ).toBeUndefined();
  // A failed BEGIN leaves the transaction wrapper usable after the external lock clears.
  f.db.exec('BEGIN IMMEDIATE');
  expect(() => f.auth.transaction(() => randomUUID())).toThrow();
  f.db.exec('ROLLBACK');
  expect(f.auth.transaction(() => 'ok')).toBe('ok');
});
