import { randomUUID } from 'node:crypto';
import { DatabaseSync } from '../../../server/database.ts';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { PortableFiles, PORTABLE_LIMIT } from './portable.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';

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

test('portable imports keep source formulas as text without binding foreign IDs to local documents', async () => {
  const f = fixture();
  const source = f.workspace.create(f.owner.id, {
    kind: 'sheet',
    name: 'Budget',
    parentId: null,
  });
  const expression = '=Budget.Summary.A1';
  const reference = parseFormula(expression)[0];
  const body = formulaBody('formula', {
    version: 1,
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
  });
  body.dataStream += '\r\n';
  const item = await f.files.import(
    f.owner.id,
    { filename: 'formula.json', parentId: null, snapshot: { ...f.doc, body } },
    () => {},
  );
  const loaded = f.files.docs.load(f.owner.id, item.id).snapshot!;
  expect(loaded.body?.dataStream).toBe(`${expression}\r\n`);
  expect(docFormulas(loaded.body)).toEqual([]);
  expect(JSON.stringify(loaded)).not.toContain(source.id);
  expect(JSON.stringify(loaded)).not.toContain('spinelFormula');
  const literal = formulaBody('array', { version: 1, expression: '={1,2;3,4}', references: [] });
  literal.dataStream += '\r\n';
  const literalItem = await f.files.import(
    f.owner.id,
    { filename: 'literal.json', parentId: null, snapshot: { ...f.doc, body: literal } },
    () => {},
  );
  expect(docFormulas(f.files.docs.load(f.owner.id, literalItem.id).snapshot!.body)).toHaveLength(1);
});

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

test.each(['sheet', 'doc'] as const)(
  'native %s import into a shared folder belongs to its owner and records the importing editor',
  async (kind) => {
    const f = fixture();
    const folder = f.workspace.create(f.owner.id, {
      kind: 'folder',
      name: 'Shared imports',
      parentId: null,
    });
    f.workspace.share(f.owner.id, folder.id, f.other.id, 'editor');
    const item = await f.files.import(
      f.other.id,
      { filename: 'source.json', snapshot: f[kind], parentId: folder.id },
      () => {},
    );
    expect(item).toMatchObject({
      access: 'editor',
      parentId: folder.id,
      createdByName: f.other.name,
    });
    expect(f.workspace.fileOwner(item.id)).toBe(f.owner.id);
    expect(f.workspace.get(f.owner.id, item.id)).toMatchObject({
      access: 'owner',
      createdByName: f.other.name,
    });
    expect(f.workspace.list(f.other.id)).toEqual([]);
  },
);

test('native import rechecks shared-folder access after asynchronous preparation', async () => {
  const f = fixture();
  const folder = f.workspace.create(f.owner.id, {
    kind: 'folder',
    name: 'Shared imports',
    parentId: null,
  });
  f.workspace.share(f.owner.id, folder.id, f.other.id, 'editor');
  const before = f.db.prepare('SELECT * FROM workspace_items').all();
  const creators = f.db.prepare('SELECT * FROM workspace_item_creators').all();
  const pending = f.files.import(
    f.other.id,
    { filename: 'source.json', snapshot: f.doc, parentId: folder.id },
    () => {},
  );
  f.workspace.share(f.owner.id, folder.id, f.other.id, 'viewer');
  await expect(pending).rejects.toThrow('cannot edit');
  expect(f.db.prepare('SELECT * FROM workspace_items').all()).toEqual(before);
  expect(f.db.prepare('SELECT * FROM workspace_item_creators').all()).toEqual(creators);
  expect(f.db.prepare('SELECT * FROM doc_snapshots').all()).toEqual([]);
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
    generations: {
      active: (id: string) => ({ unitId: id }),
      restoring: () => false,
    },
  } as unknown as CollaborationStore;
  const files = new PortableFiles(f.workspace, collaboration);
  expect(JSON.parse((await files.export(f.owner.id, item.id, () => {})).text).body.dataStream).toBe(
    'Latest accepted edit\r\n',
  );
  expect(collaboration.prepare).toHaveBeenCalledWith(f.owner.id, item.id, {});
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

test('tiny malformed snapshots cannot expand into unbounded sheet caches or publish unusable items', async () => {
  const f = fixture();
  for (const patch of [
    { rowCount: 1e12 },
    { rowCount: -1 },
    { rowCount: 1.5 },
    { columnCount: 1e12 },
    { rowCount: 0 },
    { columnCount: '26' },
    { cellData: { 100: { 0: { v: 'outside' } } } },
    { cellData: { 0: { 26: { v: 'outside' } } } },
    { cellData: [] },
    { cellData: { 0: { 0: { f: {} } } } },
    { rowData: { 999: {} } },
    { mergeData: [{ startRow: 0, endRow: 999999, startColumn: 0, endColumn: 1 }] },
  ]) {
    const snapshot = { ...f.sheet, sheets: { tab: { ...f.sheet.sheets.tab, ...patch } } };
    await expect(
      f.files.import(f.owner.id, { filename: 'a.json', parentId: null, snapshot }, () => {}),
    ).rejects.toThrow('Univer layout');
  }
  const large = structuredClone(f.sheet);
  large.sheetOrder = ['a', 'b', 'c'];
  large.sheets = Object.fromEntries(
    large.sheetOrder.map((id) => [id, { ...f.sheet.sheets.tab, id, rowCount: 100_000 }]),
  ) as typeof large.sheets;
  await expect(
    f.files.import(f.owner.id, { filename: 'a.json', parentId: null, snapshot: large }, () => {}),
  ).rejects.toThrow('Univer layout');
  expect(f.workspace.list(f.owner.id)).toEqual([]);
  expect(f.db.prepare('SELECT count(*) AS n FROM sheet_snapshots').get()!.n).toBe(0);
  await expect(
    f.files.import(f.owner.id, { filename: 'a.json', parentId: null, snapshot: f.sheet }, () => {}),
  ).resolves.toMatchObject({ name: 'Budget' });
});

test('export refuses native content that exceeds reimport budgets instead of issuing an unusable backup', async () => {
  const f = fixture();
  const item = await f.files.import(
    f.owner.id,
    { filename: 'a.json', parentId: null, snapshot: f.sheet },
    () => {},
  );
  const snapshot = {
    ...f.sheet,
    id: item.id,
    sheets: { tab: { ...f.sheet.sheets.tab, rowCount: 100_001 } },
  };
  f.files.sheets.save(f.owner.id, item.id, { snapshot, revision: 1, writeId: randomUUID() });
  await expect(f.files.export(f.owner.id, item.id, () => {})).rejects.toThrow('Univer layout');
  expect(f.files.sheets.load(f.owner.id, item.id).snapshot!.sheets.tab.rowCount).toBe(100_001);
});

test('Sheet floating, cell and background images import/export with item-scoped bytes and access checks', async () => {
  const f = fixture();
  const bytes = await sharp({
    create: { width: 80, height: 60, channels: 4, background: '#ff9900' },
  })
    .png()
    .toBuffer();
  const source = `data:image/png;base64,${bytes.toString('base64')}`;
  const drawing = {
    source,
    imageSourceType: 'BASE64',
    drawingType: 0,
    unitId: 'source',
    subUnitId: 'tab',
    drawingId: 'picture',
  };
  const snapshot = {
    ...f.sheet,
    sheetOrder: ['tab', 'second'],
    sheets: {
      second: { ...f.sheet.sheets.tab, id: 'second', name: 'Second', backgroundImage: { source } },
      tab: {
        ...f.sheet.sheets.tab,
        backgroundImage: { source },
        cellData: {
          0: {
            0: {
              p: {
                id: 'rich-cell',
                body: { dataStream: '\b\r\n' },
                drawings: { picture: { ...drawing, unitId: 'rich-cell', subUnitId: 'rich-cell' } },
              },
            },
          },
        },
      },
    },
    resources: [
      {
        name: 'SHEET_DRAWING_PLUGIN',
        data: JSON.stringify({
          tab: { order: ['picture'], data: { picture: drawing } },
          second: { order: ['picture'], data: { picture: { ...drawing, subUnitId: 'second' } } },
        }),
      },
    ],
  };
  const first = await f.files.import(
    f.owner.id,
    { filename: 'images.json', parentId: null, snapshot },
    () => {},
  );
  const native = f.files.sheets.load(f.owner.id, first.id).snapshot!;
  const canonical = native.sheets.tab.backgroundImage!.source;
  expect(canonical).toContain(`/api/items/${first.id}/images/`);
  const hash = canonical.split('/').at(-1)!;
  expect(Buffer.from(f.files.docs.image(f.owner.id, first.id, hash).data)).toEqual(bytes);
  expect(() => f.files.docs.image(f.other.id, first.id, hash)).toThrow();
  f.workspace.share(f.owner.id, first.id, f.other.id, 'viewer');
  expect(Buffer.from(f.files.docs.image(f.other.id, first.id, hash).data)).toEqual(bytes);
  f.workspace.share(f.owner.id, first.id, f.other.id, null);
  expect(() => f.files.docs.image(f.other.id, first.id, hash)).toThrow();
  const exported = JSON.parse((await f.files.export(f.owner.id, first.id, () => {})).text);
  expect(exported.sheets.tab.backgroundImage).toMatchObject({ source, imageSourceType: 'BASE64' });
  expect(exported.sheets.tab.cellData[0][0].p.drawings.picture).toMatchObject({
    unitId: 'rich-cell',
    subUnitId: 'rich-cell',
    imageSourceType: 'BASE64',
  });
  expect(JSON.parse(exported.resources[0].data).tab.data.picture.unitId).toBe(first.id);
  expect(exported.sheets.tab.cellData[0][0].p.drawings.picture.source).toBe(source);
  expect(exported.sheetOrder).toEqual(['tab', 'second']);
  expect(exported.sheets.second.backgroundImage.source).toBe(source);
  expect(JSON.parse(exported.resources[0].data).second.data.picture).toMatchObject({
    unitId: first.id,
    subUnitId: 'second',
    source,
  });
  expect(JSON.parse(exported.resources[0].data).tab.data.picture.source).toBe(source);
  const second = await f.files.import(
    f.owner.id,
    { filename: 'copy.json', parentId: null, snapshot: exported },
    () => {},
  );
  expect(
    f.files.sheets.load(f.owner.id, second.id).snapshot!.sheets.tab.backgroundImage!.source,
  ).toContain(`/api/items/${second.id}/images/`);
  const secondNative = f.files.sheets.load(f.owner.id, second.id).snapshot!;
  expect(secondNative.sheetOrder).toEqual(['tab', 'second']);
  expect(JSON.parse(secondNative.resources![0].data).second.data.picture).toMatchObject({
    unitId: second.id,
    subUnitId: 'second',
  });
});

test('remote Sheet image sources in each renderable location are rejected before import creates an item', async () => {
  const f = fixture();
  const source = 'https://outside.invalid/pixel.png';
  const variants = [
    {
      ...f.sheet,
      resources: [
        {
          name: 'SHEET_DRAWING_PLUGIN',
          data: JSON.stringify({ tab: { data: { image: { source } } } }),
        },
      ],
    },
    { ...f.sheet, sheets: { tab: { ...f.sheet.sheets.tab, backgroundImage: { source } } } },
    {
      ...f.sheet,
      sheets: {
        tab: {
          ...f.sheet.sheets.tab,
          cellData: { 0: { 0: { p: { drawings: { image: { source } } } } } },
        },
      },
    },
  ];
  for (const snapshot of variants)
    await expect(
      f.files.import(f.owner.id, { filename: 'unsafe.json', parentId: null, snapshot }, () => {}),
    ).rejects.toThrow('remote images are not fetched');
  expect(f.db.prepare('SELECT count(*) AS n FROM workspace_items').get()!.n).toBe(0);
});

test.each(['malformed resource', 'invalid source', 'foreign image'])(
  'Sheet %s rejects the complete import without publishing partial images or items',
  async (mode) => {
    const f = fixture();
    const bytes = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#ff9900' },
    })
      .png()
      .toBuffer();
    const snapshot = {
      ...f.sheet,
      sheets: {
        tab: {
          ...f.sheet.sheets.tab,
          backgroundImage: { source: `data:image/png;base64,${bytes.toString('base64')}` },
        },
      },
      resources: [
        {
          name: 'SHEET_DRAWING_PLUGIN',
          data:
            mode === 'malformed resource'
              ? '{'
              : JSON.stringify({
                  tab: {
                    data: {
                      picture: {
                        source:
                          mode === 'invalid source'
                            ? 42
                            : `/api/items/another-item/images/${'a'.repeat(64)}`,
                      },
                    },
                  },
                }),
        },
      ],
    };
    await expect(
      f.files.import(f.owner.id, { filename: 'bad.json', parentId: null, snapshot }, () => {}),
    ).rejects.toThrow();
    expect(f.db.prepare('SELECT count(*) AS n FROM workspace_items').get()!.n).toBe(0);
    expect(f.db.prepare('SELECT count(*) AS n FROM doc_images').get()!.n).toBe(0);
  },
);

// SPN-093: CSV/TSV reaches the same creation, access and rollback path as JSON.
const delimitedInput = (filename: string, text: unknown, parentId: unknown = null) => ({
  filename,
  parentId,
  text,
});

test('CSV and TSV import as a new one-worksheet Sheet with fresh IDs and literal cells', async () => {
  const f = fixture();
  const csv = '﻿id,note\r\n007,"a,b"\r\n,"two\nlines"\r\n=1+1,"say ""hi"""\r\n';
  const first = await f.files.import(f.owner.id, delimitedInput('Orders.csv', csv), () => {});
  const second = await f.files.import(
    f.owner.id,
    delimitedInput('Orders.tsv', csv.replaceAll(',', '\t').replace('a\tb', 'a,b')),
    () => {},
  );
  expect(first.kind).toBe('sheet');
  expect(first.name).toBe('Orders');
  expect(second.id).not.toBe(first.id);
  for (const item of [first, second]) {
    const snapshot = f.files.sheets.load(f.owner.id, item.id).snapshot!;
    expect(snapshot.id).toBe(item.id);
    expect(snapshot.sheetOrder).toHaveLength(1);
    const cells = snapshot.sheets[snapshot.sheetOrder[0]].cellData!;
    const value = (row: number, column: number) => cells[row]?.[column]?.v;
    expect([value(0, 0), value(0, 1), value(1, 0), value(1, 1)]).toEqual([
      'id',
      'note',
      '007',
      'a,b',
    ]);
    expect(cells[2]).toEqual({ 1: { v: 'two\nlines', t: 1 } });
    expect([value(3, 0), value(3, 1)]).toEqual(['=1+1', 'say "hi"']);
    expect(JSON.stringify(cells)).not.toContain('"f"');
  }
  expect(f.workspace.list(f.owner.id)).toHaveLength(2);
});

test('an import never replaces an item with the same name', async () => {
  const f = fixture();
  const a = await f.files.import(f.owner.id, delimitedInput('Same.csv', 'x\n'), () => {});
  const b = await f.files.import(f.owner.id, delimitedInput('Same.csv', 'y\n'), () => {});
  expect(b.id).not.toBe(a.id);
  const cell = (id: string) => f.files.sheets.load(f.owner.id, id).snapshot!.sheets['sheet-1'] ?? 0;
  expect(JSON.stringify(cell(a.id))).toContain('"x"');
  expect(JSON.stringify(cell(b.id))).toContain('"y"');
});

test('unsupported types, malformed text, oversized tables and a missing body leave no item or asset', async () => {
  const f = fixture();
  const folder = f.workspace.create(f.owner.id, { name: 'Dest', kind: 'folder', parentId: null });
  const before = () => [
    f.db.prepare('SELECT * FROM workspace_items').all(),
    f.db.prepare('SELECT * FROM workspace_item_creators').all(),
    f.db.prepare('SELECT * FROM sheet_snapshots').all(),
    f.db.prepare('SELECT * FROM doc_images').all(),
  ];
  const baseline = before();
  for (const [input, message] of [
    [delimitedInput('a.txt', 'a,b\n', folder.id), 'not supported'],
    [delimitedInput('a', 'a,b\n', folder.id), 'not supported'],
    [delimitedInput('a.csv', 'a,"b\n', folder.id), 'never closed'],
    [delimitedInput('a.csv', 'a,b"c\n', folder.id), 'unquoted'],
    [delimitedInput('a.csv', '', folder.id), 'empty'],
    [delimitedInput('a.csv', undefined, folder.id), 'Choose a file'],
    [delimitedInput('a.csv', '\n'.repeat(100_001), folder.id), '100,000 rows'],
    [delimitedInput('a.csv', 'x'.repeat(PORTABLE_LIMIT + 1), folder.id), '20 MiB'],
  ] as const)
    await expect(f.files.import(f.owner.id, input, () => {})).rejects.toThrow(message);
  expect(before()).toEqual(baseline);
  expect(f.workspace.list(f.owner.id).map((item) => item.name)).toEqual(['Dest']);
});

test('lost creation access or a revoked session leaves no partial Sheet and other files unchanged', async () => {
  const f = fixture();
  const folder = f.workspace.create(f.owner.id, { name: 'Shared', kind: 'folder', parentId: null });
  const existing = await f.files.import(
    f.owner.id,
    delimitedInput('Keep.csv', 'keep\n', folder.id),
    () => {},
  );
  f.workspace.share(f.owner.id, folder.id, f.other.id, 'editor');
  const snapshotOf = () => f.db.prepare('SELECT * FROM sheet_snapshots').all();
  const state = () => [f.db.prepare('SELECT * FROM workspace_items').all(), snapshotOf()];
  const baseline = state();
  // Creation access is lost while the request is in flight.
  const pending = f.files.import(
    f.other.id,
    delimitedInput('Late.csv', 'a,b\n', folder.id),
    () => {},
  );
  f.workspace.share(f.owner.id, folder.id, f.other.id, null);
  await expect(pending).rejects.toThrow();
  // The session is revoked after parsing, inside the publishing transaction.
  await expect(
    f.files.import(f.owner.id, delimitedInput('Gone.tsv', 'a\tb\n', folder.id), () => {
      throw new Error('Session revoked');
    }),
  ).rejects.toThrow('Session revoked');
  // A viewer, and a folder owned by someone else, cannot create at all.
  f.workspace.share(f.owner.id, folder.id, f.other.id, 'viewer');
  await expect(
    f.files.import(f.other.id, delimitedInput('Nope.csv', 'a\n', folder.id), () => {}),
  ).rejects.toThrow('cannot edit');
  const foreign = f.workspace.create(f.other.id, {
    name: 'Private',
    kind: 'folder',
    parentId: null,
  });
  await expect(
    f.files.import(f.owner.id, delimitedInput('Nope.csv', 'a\n', foreign.id), () => {}),
  ).rejects.toThrow();
  const after = state();
  expect(after[0].filter((row) => row.name !== 'Private')).toEqual(baseline[0]);
  expect(after[1]).toEqual(baseline[1]);
  expect(f.files.sheets.load(f.owner.id, existing.id).snapshot!.sheets['sheet-1']).toBeDefined();
  // The same failure does not poison the next valid import.
  f.workspace.share(f.owner.id, folder.id, f.other.id, 'editor');
  expect(
    (await f.files.import(f.other.id, delimitedInput('Next.csv', 'a\n', folder.id), () => {})).name,
  ).toBe('Next');
});

test('a body that is too wide or too long for the native sheet limits is refused before publishing', async () => {
  const f = fixture();
  await expect(
    f.files.import(
      f.owner.id,
      delimitedInput('wide.csv', Array(1_025).fill('x').join(',')),
      () => {},
    ),
  ).rejects.toThrow('1,024 columns');
  expect(f.workspace.list(f.owner.id)).toEqual([]);
});

test('a table within the transfer cap but over the 10 MiB native content cap is refused atomically', async () => {
  const f = fixture();
  // About 11 MiB of text passes the 20 MiB transfer check; the native save limit refuses it
  // inside the publishing transaction, so the already-created item must roll back.
  const text = `big\n${'x'.repeat(11 * 1024 * 1024)}\n`;
  await expect(
    f.files.import(f.owner.id, delimitedInput('Huge.csv', text), () => {}),
  ).rejects.toThrow('10 MiB');
  expect(f.workspace.list(f.owner.id)).toEqual([]);
  expect(f.db.prepare('SELECT count(*) AS n FROM sheet_snapshots').get()!.n).toBe(0);
  expect(f.db.prepare('SELECT count(*) AS n FROM workspace_item_creators').get()!.n).toBe(0);
});
