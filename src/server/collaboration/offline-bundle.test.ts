import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { openDatabase } from '../../../server/database.ts';
import type { OfflineBundle } from '../../shared/offlineBundle.ts';
import { AuthError, AuthStore, COOKIE_NAME, hashToken } from '../auth/store.ts';
import { HistoryStore } from '../history/store.ts';
import { guestCookieName } from '../workspace/links.ts';
import { PortableFiles } from '../workspace/portable.ts';
import { workspaceRoutes } from '../workspace/routes.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { CollaborationStore } from './service.ts';
import packageInfo from '../../../package.json' with { type: 'json' };

vi.setConfig({ testTimeout: 30_000 });

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

const png = (background: string) =>
  sharp({ create: { width: 4, height: 3, channels: 3, background } })
    .png()
    .toBuffer();
const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-offline-bundle-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'spinel.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => db.isOpen && db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner'),
    editor = auth.createUser('Editor'),
    viewer = auth.createUser('Viewer'),
    other = auth.createUser('Other'),
    admin = auth.createUser('Operator', true);
  const collab = new CollaborationStore(workspace, path);
  cleanup.push(() => collab.close());
  const files = new PortableFiles(workspace, collab);
  const red = await png('#cc2200'),
    blue = await png('#0044cc');
  const drawing = (source: string, unitId: string, subUnitId: string) => ({
    source,
    imageSourceType: 'BASE64',
    drawingType: 0,
    unitId,
    subUnitId,
    drawingId: 'picture',
  });
  const tab = { rowCount: 20, columnCount: 5 };
  const workbook = {
    id: 'source',
    name: 'Budget',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: ['tab', 'second'],
    sheets: {
      tab: {
        ...tab,
        id: 'tab',
        name: 'Tab',
        cellData: {
          0: { 0: { v: 42 }, 1: { f: '=A1*2' } },
          1: {
            0: {
              p: {
                id: 'rich-cell',
                body: { dataStream: '\b\r\n' },
                drawings: { picture: drawing(dataUrl(blue), 'rich-cell', 'rich-cell') },
              },
            },
          },
        },
      },
      second: { ...tab, id: 'second', name: 'Second', backgroundImage: { source: dataUrl(red) } },
    },
    resources: [
      {
        name: 'SHEET_DRAWING_PLUGIN',
        data: JSON.stringify({
          tab: { order: ['picture'], data: { picture: drawing(dataUrl(red), 'source', 'tab') } },
        }),
      },
      { name: 'SPINEL_OPAQUE_TEST_PLUGIN', data: JSON.stringify({ kept: true }) },
    ],
  };
  const document = {
    id: 'source',
    title: 'Notes',
    body: {
      dataStream: '\bOffline notes\r\n',
      paragraphs: [{ startIndex: 14 }],
      customBlocks: [{ startIndex: 0, blockId: 'picture' }],
    },
    documentStyle: {},
    drawingsOrder: ['picture'],
    drawings: { picture: drawing(dataUrl(blue), 'source', 'source') },
    resources: [
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({
          data: { picture: drawing(dataUrl(blue), 'source', 'source') },
          order: ['picture'],
        }),
      },
    ],
  };
  const sheet = await files.import(
    owner.id,
    { filename: 'budget.json', parentId: null, snapshot: workbook },
    () => {},
  );
  const doc = await files.import(
    owner.id,
    { filename: 'notes.json', parentId: null, snapshot: document },
    () => {},
  );
  for (const item of [sheet, doc]) {
    workspace.share(owner.id, item.id, editor.id, 'editor');
    workspace.share(owner.id, item.id, viewer.id, 'viewer');
  }
  const bundle = async (user: string, id: string, verify = () => {}) => {
    await collab.prepare(user, id);
    return collab.offlineBundle(user, id, verify);
  };
  /** Holds the bundle's one snapshot read open until `release` is called. */
  const holdLoad = () => {
    let release = () => {};
    let started = () => {};
    const ready = new Promise<void>((resolve) => (started = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    const original = collab.load.bind(collab);
    vi.spyOn(collab, 'load').mockImplementationOnce(async (...args) => {
      started();
      await held;
      return original(...args);
    });
    return { ready, release };
  };
  return {
    auth,
    workspace,
    collab,
    owner,
    editor,
    viewer,
    other,
    admin,
    sheet,
    doc,
    red,
    blue,
    bundle,
    holdLoad,
  };
}

test('a Sheet bundle is the live snapshot and revision from one read, with a complete image manifest', async () => {
  const f = await fixture();
  const bundle = await f.bundle(f.owner.id, f.sheet.id);
  const live = await f.collab.load(f.owner.id, f.sheet.id);
  const generation = f.collab.generations.active(f.sheet.id);
  expect(bundle).toMatchObject({
    version: 1,
    accountId: f.owner.id,
    itemId: f.sheet.id,
    kind: 'sheet',
    name: 'Budget',
    unitId: generation.unitId,
    revision: live.revision,
    revisionOffset: generation.offset,
    access: 'owner',
    readOnly: false,
    sdkVersion: packageInfo.dependencies['@univerjs/core'],
  });
  expect(bundle.snapshot).toEqual(live.snapshot);
  const workbook = bundle.snapshot as IWorkbookData;
  expect(workbook.sheetOrder).toEqual(['tab', 'second']);
  expect(workbook.sheets.tab.cellData![0]![1]!.f).toBe('=A1*2');
  expect(workbook.resources).toContainEqual({
    name: 'SPINEL_OPAQUE_TEST_PLUGIN',
    data: JSON.stringify({ kept: true }),
  });
  // Floating and background share the red bytes; the cell image is blue. One entry per source.
  expect(bundle.images).toEqual(
    [f.red, f.blue]
      .map((bytes) => ({
        source: `/api/items/${f.sheet.id}/images/${sha(bytes)}`,
        sha256: sha(bytes),
        mime: 'image/png',
        byteLength: bytes.byteLength,
      }))
      .sort((a, b) => a.source.localeCompare(b.source)),
  );
  const sources = new Set<string>();
  JSON.stringify(bundle.snapshot, (key, value) => {
    if (key === 'source' && typeof value === 'string') sources.add(value);
    return value;
  });
  expect([...sources].sort()).toEqual(bundle.images.map((image) => image.source));
});

test('a Doc bundle lists its images, and a viewer bundle is marked read-only', async () => {
  const f = await fixture();
  for (const [user, access] of [
    [f.owner.id, 'owner'],
    [f.editor.id, 'editor'],
    [f.viewer.id, 'viewer'],
  ] as const) {
    const bundle = await f.bundle(user, f.doc.id);
    expect(bundle).toMatchObject({
      accountId: user,
      kind: 'doc',
      access,
      readOnly: access === 'viewer',
    });
    expect((bundle.snapshot as IDocumentData).body?.dataStream).toBe('\bOffline notes\r\n');
    expect(bundle.images).toEqual([
      {
        source: `/api/items/${f.doc.id}/images/${sha(f.blue)}`,
        sha256: sha(f.blue),
        mime: 'image/png',
        byteLength: f.blue.byteLength,
      },
    ]);
  }
});

test('bundles follow a restored generation and its revision', async () => {
  const f = await fixture();
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const before = await f.bundle(f.owner.id, f.doc.id);
  const checkpoint = await history.nameCurrent(f.owner.id, f.doc.id, 'Before');
  const restored = await history.restore(
    f.owner.id,
    f.doc.id,
    checkpoint.id,
    before.unitId,
    randomUUID(),
  );
  const after = await f.bundle(f.owner.id, f.doc.id);
  expect(after.unitId).toBe(restored.nextUnit);
  expect(after.unitId).not.toBe(before.unitId);
  expect(after.revision).toBe(restored.revision);
  expect(after.revision - after.revisionOffset).toBeGreaterThanOrEqual(1);
});

test('access, session and generation changes during the read fail the whole bundle', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.sheet.id);
  const attempt = async (
    user: string,
    change: () => unknown | Promise<unknown>,
    verify?: () => void,
  ) => {
    const hold = f.holdLoad();
    const pending = f.collab.offlineBundle(user, f.sheet.id, verify ?? (() => {}));
    await hold.ready;
    await change();
    hold.release();
    return pending;
  };
  await expect(
    attempt(f.viewer.id, () => f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, null)),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    attempt(f.editor.id, () => f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, 'viewer')),
  ).rejects.toMatchObject({ status: 409 });
  let signedIn = true;
  await expect(
    attempt(
      f.owner.id,
      () => (signedIn = false),
      () => {
        if (!signedIn) throw new AuthError(401, 'Sign in to continue.');
      },
    ),
  ).rejects.toMatchObject({ status: 401 });
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const checkpoint = await history.nameCurrent(f.owner.id, f.sheet.id, 'Before');
  const unit = f.collab.generations.active(f.sheet.id).unitId;
  await expect(
    attempt(f.owner.id, () =>
      history.restore(f.owner.id, f.sheet.id, checkpoint.id, unit, randomUUID()),
    ),
  ).rejects.toMatchObject({ status: 409 });
  for (const user of [f.other.id, f.admin.id])
    await expect(f.collab.offlineBundle(user, f.sheet.id, () => {})).rejects.toMatchObject({
      status: 404,
    });
});

test('damaged stored images and foreign sources return nothing', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.doc.id);
  f.auth.database
    .prepare('UPDATE doc_images SET data=? WHERE item_id=? AND id=?')
    .run(Buffer.from('not the same bytes'), f.doc.id, sha(f.blue));
  await expect(f.collab.offlineBundle(f.owner.id, f.doc.id, () => {})).rejects.toMatchObject({
    status: 500,
  });
  f.auth.database
    .prepare('UPDATE doc_images SET data=? WHERE item_id=? AND id=?')
    .run(f.blue, f.doc.id, sha(f.blue));
  f.auth.database.prepare('INSERT OR REPLACE INTO spinel_generation_resources VALUES(?,?,?)').run(
    f.collab.generations.active(f.doc.id).unitId,
    f.doc.id,
    JSON.stringify([
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({
          outside: { source: `/api/items/${f.sheet.id}/images/${sha(f.red)}` },
        }),
      },
    ]),
  );
  await expect(f.collab.offlineBundle(f.owner.id, f.doc.id, () => {})).rejects.toThrow(
    'Insert images',
  );
});

test('the bundle route enforces sessions, accounts, transfer admission and reproduces images', async () => {
  const f = await fixture();
  const app = express();
  app.use('/api/items', workspaceRoutes(f.auth, 'http://localhost:3000', f.workspace, f.collab));
  const server = app.listen(0, '127.0.0.1');
  cleanup.push(() => new Promise((done) => server.close(done)));
  await new Promise<void>((ready) => server.once('listening', ready));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/items`;
  const session = (id: string) => f.auth.createSession(id).token;
  const cookie = (token: string) => `${COOKIE_NAME}=${token}`;
  const get = (path: string, credential: string) =>
    fetch(`${root}/${path}`, { headers: { Cookie: credential } });
  for (const [user, access] of [
    [f.owner.id, 'owner'],
    [f.editor.id, 'editor'],
    [f.viewer.id, 'viewer'],
  ] as const) {
    const credential = cookie(session(user));
    const response = await get(`${f.sheet.id}/offline-bundle`, credential);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const bundle = (await response.json()) as OfflineBundle;
    expect(bundle).toMatchObject({ accountId: user, access, readOnly: access === 'viewer' });
    for (const image of bundle.images) {
      const bytes = await get(image.source.slice('/api/items/'.length), credential);
      expect(bytes.status).toBe(200);
      expect(bytes.headers.get('content-type')).toBe(image.mime);
      const body = new Uint8Array(await bytes.arrayBuffer());
      expect(body.byteLength).toBe(image.byteLength);
      expect(sha(body)).toBe(image.sha256);
    }
  }
  const link = f.workspace.links.begin(f.sheet.id, 'editor');
  f.workspace.links.finish(f.sheet.id, link.epoch, true);
  const guest = f.workspace.links.exchange(f.sheet.id, link.token);
  const folder = f.workspace.create(f.owner.id, { name: 'Folder', kind: 'folder', parentId: null });
  for (const [path, credential, status] of [
    [`${f.sheet.id}/offline-bundle`, '', 401],
    [`${f.sheet.id}/offline-bundle`, `${guestCookieName(f.sheet.id)}=${guest.token}`, 401],
    [`${f.sheet.id}/offline-bundle`, cookie(session(f.admin.id)), 403],
    [`${f.sheet.id}/offline-bundle`, cookie(session(f.other.id)), 404],
    [`${folder.id}/offline-bundle`, cookie(session(f.owner.id)), 400],
  ] as const)
    expect((await get(path, credential)).status).toBe(status);
  // A sign-out while the read is in flight, and a second transfer meanwhile.
  const token = session(f.owner.id);
  const hold = f.holdLoad();
  const pending = get(`${f.doc.id}/offline-bundle`, cookie(token));
  await hold.ready;
  expect((await get(`${f.doc.id}/offline-bundle`, cookie(session(f.owner.id)))).status).toBe(429);
  f.auth.revokeSession(hashToken(token));
  hold.release();
  const signedOut = await pending;
  expect(signedOut.status).toBe(401);
  expect(await signedOut.json()).toEqual({ error: 'Sign in to continue.' });
  expect((await get(`${f.doc.id}/offline-bundle`, cookie(session(f.owner.id)))).status).toBe(200);
});
