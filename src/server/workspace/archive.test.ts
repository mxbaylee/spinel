import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setImmediate as immediate } from 'node:timers/promises';
import { ZipFile } from 'yazl';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { LocaleType } from '@univerjs/core';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import { DatabaseSync } from '../../../server/database.ts';
import { ARCHIVE_ITEM_LIMIT } from '../../shared/archive.ts';
import { AuthError, AuthStore } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { resolveDocument } from './document-access.ts';
import {
  ARCHIVE_MANIFEST,
  ownedArchiveManifest,
  parseArchiveManifest,
} from './archive-manifest.ts';
import type { ArchiveManifest } from './archive-manifest.ts';
import { ArchiveZip } from './archive-zip.ts';
import { WorkspaceArchive } from './archive.ts';
import { PortableFiles } from './portable.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';
import { TrashStore } from './trash.ts';

const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) if (database.isOpen) database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'spinel-archive-test-'));
  directories.push(path);
  return path;
}
function fixture(path = ':memory:') {
  const database = new DatabaseSync(path);
  databases.push(database);
  const auth = new AuthStore(database, () => Date.UTC(2026, 9, 26));
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(database);
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Other');
  const operator = auth.createUser('Operator', true);
  const custom = { sessionHash: auth.createSession(owner.id).session.token_hash };
  const load = async (user: string, id: string, context: Record<string, unknown>) => {
    const item = resolveDocument(workspace, user, id, 'read', context);
    const table = item.kind === 'doc' ? 'doc_snapshots' : 'sheet_snapshots';
    const row = database.prepare(`SELECT snapshot FROM ${table} WHERE item_id=?`).get(id);
    return { snapshot: row ? JSON.parse(String(row.snapshot)) : null };
  };
  // Public materialization is held at a small native seam. Real account/Space
  // authorization, image reads, importer and database publication remain in use.
  const collaboration = {
    prepare: async () => {},
    load,
    generations: { restoring: () => false, active: (id: string) => ({ unitId: id }) },
  } as unknown as CollaborationStore;
  const files = new PortableFiles(workspace, collaboration);
  const archive = new WorkspaceArchive(workspace, files, custom);
  const spaces = new SpaceStore(workspace);
  const create = (
    name: string,
    kind: 'folder' | 'doc' | 'sheet' = 'doc',
    parentId: string | null = null,
    user = owner.id,
  ) => workspace.create(user, { name, kind, parentId });
  const save = (id: string, snapshot: IDocumentData | IWorkbookData) => {
    const kind = 'sheets' in snapshot ? 'sheet' : 'doc';
    database
      .prepare(`INSERT INTO ${kind}_snapshots VALUES(?,?,1,?)`)
      .run(id, JSON.stringify({ ...snapshot, id }), randomUUID());
  };
  return {
    database,
    auth,
    workspace,
    owner,
    other,
    operator,
    custom,
    files,
    archive,
    spaces,
    create,
    save,
  };
}
const doc = (text = 'Native notes\r\n'): IDocumentData => ({
  id: 'source',
  title: 'Notes',
  documentStyle: {},
  body: { dataStream: text },
});
const sheet = (): IWorkbookData => ({
  id: 'source',
  name: 'Budget',
  appVersion: '1.1.0',
  locale: LocaleType.EN_US,
  styles: {},
  sheetOrder: ['tab'],
  sheets: {
    tab: {
      id: 'tab',
      name: 'Summary',
      rowCount: 10,
      columnCount: 10,
      cellData: { 0: { 0: { v: 42 } } },
    },
  },
});
async function collect(stream: AsyncIterable<Buffer>) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function exportPath(f: ReturnType<typeof fixture>) {
  const path = join(directory(), 'archive.zip');
  writeFileSync(path, await collect(f.archive.export(f.owner.id, () => {})));
  return path;
}
async function contents(path: string) {
  const zip = await ArchiveZip.open(path, () => {});
  const entries = new Map<string, Buffer>();
  try {
    for (const entry of zip.entries.values())
      entries.set(
        entry.fileName,
        entry.fileName.endsWith('/')
          ? Buffer.alloc(0)
          : await zip.read(entry.fileName, 20 * 1024 * 1024),
      );
  } finally {
    await zip.close();
  }
  return entries;
}
async function repack(entries: Iterable<[string, Buffer]>) {
  const zip = new ZipFile();
  for (const [path, bytes] of entries)
    if (path.endsWith('/')) zip.addEmptyDirectory(path);
    else zip.addBuffer(bytes, path, { compress: false });
  zip.end();
  const result = join(directory(), 'edited.zip');
  writeFileSync(result, await collect(zip.outputStream as Readable));
  return result;
}
function rows(f: ReturnType<typeof fixture>) {
  return f.database.prepare('SELECT * FROM workspace_items ORDER BY id').all();
}

test('an empty owned workspace exports a valid manifest and imports no new items', async () => {
  const source = fixture();
  const path = await exportPath(source);
  const entries = await contents(path);
  expect([...entries.keys()]).toEqual([ARCHIVE_MANIFEST]);
  const target = fixture();
  expect(await target.archive.import(target.owner.id, path, () => {})).toEqual({
    items: 0,
    files: 0,
    folders: 0,
    spaces: 0,
  });
  expect(rows(target)).toEqual([]);
});

test('a nested native Doc without a title uses the exact manifest name instead of its ZIP path', async () => {
  const source = fixture();
  const folder = source.create('Nested', 'folder');
  const name = 'n'.repeat(120);
  const item = source.create(name, 'doc', folder.id);
  source.save(item.id, {
    id: item.id,
    documentStyle: {},
    body: { dataStream: 'Untitled native content\r\n' },
  });
  const target = fixture();
  target.auth.now = () => Date.UTC(2026, 9, 28);
  const path = await exportPath(source);
  await target.archive.import(target.owner.id, path, () => {});
  const copied = rows(target).find((row) => row.kind === 'doc')!;
  expect(copied.name).toBe(name);
  expect(copied.created_at).toBe(Date.UTC(2026, 9, 28));
  expect(
    target.files.docs.load(target.owner.id, String(copied.id)).snapshot!.body!.dataStream,
  ).toBe('Untitled native content\r\n');
  const entries = await contents(path);
  const payload = [...entries].find(([name]) => name.endsWith('.univer.json'))!;
  const extracted = await target.files.import(
    target.owner.id,
    {
      filename: payload[0].split('/').at(-1),
      parentId: null,
      snapshot: JSON.parse(payload[1].toString()),
    },
    () => {},
  );
  expect(target.files.docs.load(target.owner.id, extracted.id).snapshot!.body!.dataStream).toBe(
    'Untitled native content\r\n',
  );
});

test('owned nested files, empty folders, whole Spaces, mixed page parents and images round-trip as fresh unshared items', async () => {
  const source = fixture();
  const outer = source.create('Files', 'folder');
  source.create('Empty', 'folder', outer.id);
  const sameA = source.create('Same name', 'doc', outer.id);
  const sameB = source.create('Same name', 'doc', outer.id);
  source.save(sameA.id, doc('First copy\r\n'));
  source.save(sameB.id, doc('Second copy\r\n'));
  const root = source.spaces.createRoot(source.owner.id, {
    name: 'Project',
    parentId: outer.id,
  }).space;
  const parent = source.spaces.createChild(source.owner.id, root.id, {
    kind: 'doc',
    name: 'Parent page',
    parentId: root.id,
  }).item;
  const child = source.spaces.createChild(source.owner.id, root.id, {
    kind: 'sheet',
    name: 'Nested budget',
    parentId: parent.id,
  }).item;
  source.save(parent.id, doc('Space parent\r\n'));
  source.save(child.id, sheet());
  const image = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#d43d7b' } })
    .png()
    .toBuffer();
  const imageId = createHash('sha256').update(image).digest('hex');
  source.database
    .prepare('INSERT INTO doc_images VALUES(?,?,?,?)')
    .run(parent.id, imageId, 'image/png', image);
  const imageSnapshot = {
    ...doc('Space parent\r\n'),
    id: parent.id,
    drawings: {
      picture: {
        source: `/api/items/${parent.id}/images/${imageId}`,
        unitId: parent.id,
        subUnitId: parent.id,
      },
    },
  };
  source.database
    .prepare('UPDATE doc_snapshots SET snapshot=? WHERE item_id=?')
    .run(JSON.stringify(imageSnapshot), parent.id);
  const shared = source.create('Foreign shared document', 'doc', null, source.other.id);
  source.save(shared.id, doc('Must stay private\r\n'));
  source.workspace.share(source.other.id, shared.id, source.owner.id, 'admin');
  source.workspace.place(source.owner.id, shared.id, outer.id);
  source.spaces.share(source.owner.id, root.id, source.other.id, 'viewer');
  const removed = source.create('Trashed document');
  new TrashStore(source.workspace).trash(source.owner.id, removed.id);
  const deletedChild = source.spaces.createChild(source.owner.id, root.id, {
    kind: 'doc',
    name: 'Trashed page',
    parentId: root.id,
  }).item;
  new SpaceRecoveryStore(source.workspace).trash(source.owner.id, root.id, deletedChild.id);
  const path = await exportPath(source);
  const entries = await contents(path);
  const manifest = JSON.parse(entries.get(ARCHIVE_MANIFEST)!.toString()) as ArchiveManifest;
  expect(manifest.items.map((item) => item.name)).not.toContain('Foreign shared document');
  expect(manifest.items.map((item) => item.name)).not.toContain('Trashed document');
  expect(manifest.items.map((item) => item.name)).not.toContain('Trashed page');
  expect(new Set(manifest.items.map((item) => item.path)).size).toBe(manifest.items.length);
  expect(manifest.items.find((item) => item.id === child.id)).toMatchObject({
    parentId: parent.id,
    spaceId: root.id,
    position: 0,
  });
  expect(manifest.items.every((item) => item.createdAt === Date.UTC(2026, 9, 26))).toBe(true);
  expect(entries.get(manifest.items.find((item) => item.id === sameA.id)!.path)!.toString()).toBe(
    (await source.files.export(source.owner.id, sameA.id, () => {}, source.custom)).text,
  );
  const target = fixture();
  const result = await target.archive.import(target.owner.id, path, () => {});
  expect(result).toEqual({ items: 7, files: 4, folders: 2, spaces: 1 });
  const imported = rows(target);
  expect(imported).toHaveLength(7);
  expect(imported.every((item) => item.owner_id === target.owner.id)).toBe(true);
  expect(imported.every((item) => !manifest.items.some((before) => before.id === item.id))).toBe(
    true,
  );
  const copiedRoot = imported.find((item) => item.name === 'Project')!;
  const copiedParent = imported.find((item) => item.name === 'Parent page')!;
  const copiedChild = imported.find((item) => item.name === 'Nested budget')!;
  expect(copiedChild).toMatchObject({
    parent_id: copiedParent.id,
    space_id: copiedRoot.id,
    space_position: 0,
  });
  expect(
    target.spaces.list(target.owner.id, String(copiedRoot.id)).items.map((item) => item.name),
  ).toEqual(['Parent page', 'Nested budget']);
  expect(target.database.prepare('SELECT count(*) AS n FROM workspace_grants').get()!.n).toBe(0);
  const copiedImage = target.database.prepare('SELECT item_id,id,data FROM doc_images').get()!;
  expect(copiedImage.item_id).toBe(copiedParent.id);
  expect(Buffer.from(copiedImage.data as Uint8Array)).toEqual(image);
  const copiedSnapshot = target.database
    .prepare('SELECT snapshot FROM doc_snapshots WHERE item_id=?')
    .get(String(copiedParent.id))!;
  expect(String(copiedSnapshot.snapshot)).toContain(
    `/api/items/${copiedParent.id}/images/${imageId}`,
  );
  expect(String(copiedSnapshot.snapshot)).not.toContain(parent.id);
});

test('Formula references remap forward and across Spaces; external source IDs never bind target namesakes', async () => {
  const source = fixture();
  const host = source.create('A first Doc');
  const ordinary = source.create('Z budget', 'sheet');
  source.save(ordinary.id, sheet());
  const space = source.spaces.createRoot(source.owner.id, {
    name: 'Sources',
    parentId: null,
  }).space;
  const internal = source.spaces.createChild(source.owner.id, space.id, {
    name: 'Internal',
    kind: 'sheet',
    parentId: space.id,
  }).item;
  source.save(internal.id, sheet());
  const external = source.create('Shared only', 'sheet', null, source.other.id);
  source.save(external.id, sheet());
  source.workspace.share(source.other.id, external.id, source.owner.id, 'viewer');
  const expression = '=Budget.Summary.A1+Internal.Summary.A1+External.Summary.A1';
  const sources = [ordinary.id, internal.id, external.id];
  const body = formulaBody('formula', {
    version: 1,
    expression,
    references: parseFormula(expression).map((reference, index) => ({
      start: reference.start,
      end: reference.end,
      range: reference.range,
      itemId: sources[index],
      sheetId: 'tab',
    })),
  });
  body.dataStream += '\r\n';
  source.save(host.id, { ...doc(), body });
  const path = await exportPath(source);
  const target = fixture();
  // An existing instance item deliberately has the foreign source's exact ID.
  target.database
    .prepare(
      'INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,NULL,?,?,0,0)',
    )
    .run(external.id, target.owner.id, 'sheet', 'Local namesake');
  target.save(external.id, sheet());
  await target.archive.import(target.owner.id, path, () => {});
  const imported = rows(target);
  const copiedHost = imported.find((item) => item.name === 'A first Doc')!;
  const snapshot = target.files.docs.load(target.owner.id, String(copiedHost.id)).snapshot!;
  const formula = docFormulas(snapshot.body)[0];
  expect(formula.definition.expression).toBe(expression);
  expect(formula.definition.references[0].itemId).toBe(
    imported.find((item) => item.name === 'Z budget')!.id,
  );
  expect(formula.definition.references[1].itemId).toBe(
    imported.find((item) => item.name === 'Internal')!.id,
  );
  expect(formula.definition.references[2].itemId).toMatch(/^unavailable-/);
  expect(formula.definition.references.every((reference) => reference.sheetId === 'tab')).toBe(
    true,
  );
  expect(imported.some((item) => item.id === formula.definition.references[2].itemId)).toBe(false);
  const cached = structuredClone(snapshot);
  (cached.body!.customRanges![0].properties!.spinelFormula as Record<string, unknown>).value = 123;
  target.database
    .prepare('UPDATE doc_snapshots SET snapshot=? WHERE item_id=?')
    .run(JSON.stringify(cached), String(copiedHost.id));
  await expect(collect(target.archive.export(target.owner.id, () => {}))).rejects.toThrow(
    'Formula definition',
  );
});

test('a late native failure or revoked account publishes no folder, item, image or partial snapshot', async () => {
  const source = fixture();
  const folder = source.create('Folder', 'folder');
  const first = source.create('First', 'doc', folder.id);
  source.save(first.id, doc());
  const second = source.create('Second', 'doc', folder.id);
  source.save(second.id, doc());
  const path = await exportPath(source);
  const target = fixture();
  const existing = target.create('Existing');
  target.save(existing.id, doc('Untouched\r\n'));
  const before = rows(target);
  target.database.exec(`CREATE TRIGGER reject_second BEFORE INSERT ON doc_snapshots
    WHEN (SELECT name FROM workspace_items WHERE id=NEW.item_id)='Second'
    BEGIN SELECT RAISE(ABORT,'late snapshot failure'); END;`);
  await expect(target.archive.import(target.owner.id, path, () => {})).rejects.toThrow(
    'late snapshot failure',
  );
  expect(rows(target)).toEqual(before);
  expect(target.database.prepare('SELECT count(*) AS n FROM doc_snapshots').get()!.n).toBe(1);
  expect(
    target.database
      .prepare('PRAGMA database_list')
      .all()
      .some((row) => row.name === 'workspace_archive_import'),
  ).toBe(false);
  target.database.exec('DROP TRIGGER reject_second');
  let active = true;
  await expect(
    target.archive.import(
      target.owner.id,
      path,
      () => {
        if (!active) throw new AuthError(401, 'Session revoked');
      },
      ({ completed, total }) => {
        if (completed === total) active = false;
      },
    ),
  ).rejects.toThrow('Session revoked');
  expect(rows(target)).toEqual(before);
  expect(await target.archive.import(target.owner.id, path, () => {})).toMatchObject({
    items: 3,
    files: 2,
  });
});

test('cleanup failures preserve the original import error or committed result without content in logs', async () => {
  const source = fixture();
  const item = source.create('Private native notes');
  source.save(item.id, doc());
  const path = await exportPath(source);
  const close = ArchiveZip.prototype.close;
  vi.spyOn(ArchiveZip.prototype, 'close').mockImplementation(async function (this: ArchiveZip) {
    await close.call(this);
    throw new Error('Private native notes cleanup fault');
  });
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  const target = fixture();
  const revoked = new AuthError(401, 'Session revoked');
  let active = true;
  await expect(
    target.archive.import(
      target.owner.id,
      path,
      () => {
        if (!active) throw revoked;
      },
      ({ completed, total }) => {
        if (completed === total) active = false;
      },
    ),
  ).rejects.toBe(revoked);
  expect(rows(target)).toEqual([]);
  await expect(target.archive.import(target.owner.id, path, () => {})).resolves.toEqual({
    items: 1,
    files: 1,
    folders: 0,
    spaces: 0,
  });
  expect(rows(target)).toHaveLength(1);
  expect(
    target.database
      .prepare('PRAGMA database_list')
      .all()
      .some((row) => row.name === 'workspace_archive_import'),
  ).toBe(false);
  expect(diagnostic.mock.calls).toEqual([
    ['Archive import temporary database cleanup failed.'],
    ['Archive import temporary database cleanup failed.'],
  ]);
});

test('complete graph validation refuses cycles, foreign memberships and missing parents before publication', () => {
  const f = fixture();
  const parent = f.create('Folder', 'folder');
  const child = f.create('Child', 'doc', parent.id);
  f.save(child.id, doc());
  const manifest = ownedArchiveManifest(f.workspace, f.owner.id);
  for (const change of [
    (copy: ArchiveManifest) => {
      copy.items[0].parentId = copy.items[1].id;
    },
    (copy: ArchiveManifest) => {
      copy.items[1].spaceId = copy.items[0].id;
      copy.items[1].position = 0;
    },
    (copy: ArchiveManifest) => {
      copy.items[1].parentId = randomUUID();
    },
    (copy: ArchiveManifest) => {
      copy.items[1].id = copy.items[0].id;
    },
    (copy: ArchiveManifest) => {
      copy.items[1].path = '../private.univer.json';
    },
  ]) {
    const copy = structuredClone(manifest);
    change(copy);
    expect(() => parseArchiveManifest(JSON.stringify(copy), f.workspace)).toThrow();
  }
  expect(rows(f)).toHaveLength(2);
});

test('archive and single-file imports share workbook-name and native-content save guards', async () => {
  const source = fixture();
  const item = source.create('Budget', 'sheet');
  source.save(item.id, sheet());
  const entries = await contents(await exportPath(source));
  const path = [...entries.keys()].find((name) => name !== ARCHIVE_MANIFEST)!;
  for (const name of [undefined, null]) {
    const snapshot = JSON.parse(entries.get(path)!.toString()) as Record<string, unknown>;
    if (name === undefined) delete snapshot.name;
    else snapshot.name = name;
    snapshot.title = 'Valid fallback title';
    const target = fixture();
    await expect(
      target.files.import(
        target.owner.id,
        { filename: 'sheet.univer.json', parentId: null, snapshot },
        () => {},
      ),
    ).rejects.toThrow('Invalid spreadsheet');
    const edited = new Map(entries);
    edited.set(path, Buffer.from(JSON.stringify(snapshot)));
    await expect(
      target.archive.import(target.owner.id, await repack(edited), () => {}),
    ).rejects.toThrow('Invalid spreadsheet');
    expect(rows(target)).toEqual([]);
    expect(target.database.prepare('SELECT count(*) AS n FROM sheet_snapshots').get()!.n).toBe(0);
  }
  source.database.prepare('UPDATE sheet_snapshots SET snapshot=? WHERE item_id=?').run(
    JSON.stringify({
      ...sheet(),
      id: item.id,
      resources: [{ name: 'future-resource', data: 'x'.repeat(10 * 1024 * 1024) }],
    }),
    item.id,
  );
  await expect(
    source.files.export(source.owner.id, item.id, () => {}, source.custom),
  ).rejects.toThrow('10 MiB');
  await expect(collect(source.archive.export(source.owner.id, () => {}))).rejects.toThrow('10 MiB');
});

test('corrupt CRCs, traversal, symlinks, duplicates, missing and extra members are refused atomically', async () => {
  const source = fixture();
  const item = source.create('Only');
  source.save(item.id, doc('Unique native payload\r\n'));
  const path = await exportPath(source);
  const entries = await contents(path);
  const memberPath = [...entries.keys()].find((path) => path !== ARCHIVE_MANIFEST)!;
  const corrupt = await repack(entries);
  const corruptBytes = readFileSync(corrupt);
  const offset = corruptBytes.indexOf(Buffer.from('Unique native payload'));
  expect(offset).toBeGreaterThan(0);
  corruptBytes[offset] ^= 1;
  writeFileSync(corrupt, corruptBytes);
  const missing = await repack([...entries].filter(([path]) => path !== memberPath));
  const extra = await repack([...entries, ['unexpected.txt', Buffer.from('private')]]);
  const duplicate = await repack([...entries, [memberPath, entries.get(memberPath)!]]);
  const traversal = await repack([['xx/bad', Buffer.from('x')], ...entries]);
  const traversalBytes = readFileSync(traversal);
  let at = -1;
  while ((at = traversalBytes.indexOf(Buffer.from('xx/bad'), at + 1)) >= 0)
    traversalBytes.write('../bad', at);
  writeFileSync(traversal, traversalBytes);
  const symbolic = new ZipFile();
  symbolic.addBuffer(Buffer.from('/etc/passwd'), 'link', { mode: 0o120777 });
  symbolic.addBuffer(entries.get(ARCHIVE_MANIFEST)!, ARCHIVE_MANIFEST);
  symbolic.end();
  const symlink = join(directory(), 'symlink.zip');
  writeFileSync(symlink, await collect(symbolic.outputStream as Readable));
  const target = fixture();
  for (const input of [corrupt, missing, extra, duplicate, traversal, symlink]) {
    await expect(target.archive.import(target.owner.id, input, () => {})).rejects.toThrow();
    expect(rows(target)).toEqual([]);
  }
});

test('operators and guests cannot export archives; a changed owned tree prevents ZIP completion', async () => {
  const f = fixture();
  const item = f.create('Live');
  f.save(item.id, doc());
  await expect(collect(f.archive.export(f.operator.id, () => {}))).rejects.toThrow('everyday');
  await expect(collect(f.archive.export('guest:anything', () => {}))).rejects.toThrow();
  const exportFile = f.files.export.bind(f.files);
  vi.spyOn(f.files, 'export').mockImplementation(async (...args) => {
    const result = await exportFile(...args);
    f.database
      .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
      .run('trash', item.id);
    return result;
  });
  await expect(collect(f.archive.export(f.owner.id, () => {}))).rejects.toThrow('files changed');
});

test('cancelled ZIP generation waits for its in-flight native materializer and starts no next file', async () => {
  const f = fixture();
  for (const name of ['First', 'Second']) {
    const item = f.create(name);
    f.save(item.id, doc());
  }
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finished = false;
  const load = vi.spyOn(f.files, 'export').mockImplementation(async () => {
    entered();
    await gate;
    finished = true;
    return { filename: 'native.json', text: JSON.stringify(doc()) };
  });
  const iterator = f.archive.export(f.owner.id, () => {});
  const next = iterator.next().catch(() => ({ done: true, value: undefined }));
  await started;
  let closed = false;
  const close = iterator.return(undefined).then(() => {
    closed = true;
  });
  await immediate();
  expect(closed).toBe(false);
  expect(finished).toBe(false);
  release();
  await next;
  await close;
  expect(finished).toBe(true);
  expect(load).toHaveBeenCalledTimes(1);
});

test.each(['same connection', 'another connection'])(
  'a slow archive consumer loses further bytes after trash via %s',
  async (connection) => {
    const f = fixture(join(directory(), 'workspace.sqlite'));
    const item = f.create('Active document');
    f.save(item.id, {
      ...doc(),
      resources: [{ name: 'future-resource', data: randomBytes(2 * 1024 * 1024).toString('hex') }],
    });
    const iterator = f.archive.export(f.owner.id, () => {});
    let received = 0;
    while (received < 100_000) {
      const part = await iterator.next();
      expect(part.done).toBe(false);
      received += part.value!.length;
    }
    const writer =
      connection === 'same connection' ? f.database : new DatabaseSync(f.database.path);
    if (writer !== f.database) databases.push(writer);
    writer
      .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
      .run('revoked', item.id);
    await expect(iterator.next()).rejects.toThrow('files changed');
  },
);

test('the complete metadata budget refuses an oversized workspace without a partial catalog', () => {
  const f = fixture();
  f.auth.transaction(() => {
    const insert = f.database.prepare(
      'INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,NULL,?,?,0,0)',
    );
    for (let i = 0; i <= ARCHIVE_ITEM_LIMIT; i++)
      insert.run(randomUUID(), f.owner.id, 'folder', `Folder ${i}`);
  });
  expect(() => ownedArchiveManifest(f.workspace, f.owner.id)).toThrow('too many items');
});

test('a 2,176 MiB logical workspace streams one native member at a time within a 512 MiB process budget', async () => {
  const f = fixture();
  for (let i = 0; i < 272; i++) f.create(`Document ${String(i).padStart(3, '0')}`);
  // A legitimate member may carry an opaque preserved plugin resource. It is
  // generated per callback by the writer instead of retained as 272 native blobs.
  const text = JSON.stringify({
    ...doc(),
    resources: [{ name: 'future-resource', data: 'x'.repeat(8 * 1024 * 1024) }],
  });
  let active = 0;
  let peakActive = 0;
  vi.spyOn(f.files, 'export').mockImplementation(async () => {
    active++;
    peakActive = Math.max(peakActive, active);
    await immediate();
    active--;
    return { filename: 'native.univer.json', text };
  });
  const path = join(directory(), 'large.zip');
  const handle = await open(path, 'w');
  let peakRss = process.memoryUsage().rss;
  const baseline = peakRss;
  try {
    for await (const chunk of f.archive.export(f.owner.id, () => {})) {
      await handle.write(chunk);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
  } finally {
    await handle.close();
  }
  const archive = await ArchiveZip.open(path, () => {});
  try {
    expect(archive.expandedBytes).toBeGreaterThan(2176 * 1024 * 1024);
  } finally {
    await archive.close();
  }
  expect(peakActive).toBe(1);
  expect(peakRss).toBeLessThan(512 * 1024 * 1024);
  console.info(
    `Archive streaming fixture: 2,176 MiB native payload; process RSS baseline ${(baseline / 1024 / 1024).toFixed(1)} MiB, peak ${(peakRss / 1024 / 1024).toFixed(1)} MiB.`,
  );
}, 60_000);
