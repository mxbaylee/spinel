import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import { LocaleType } from '@univerjs/core';
import { CollabError } from '@univerjs-pro/collaboration-service';
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
const route = (itemId: string, bytes: Buffer) => `/api/items/${itemId}/images/${sha(bytes)}`;
const manifest = (itemId: string, ...images: Buffer[]) =>
  images
    .map((bytes) => ({
      source: route(itemId, bytes),
      sha256: sha(bytes),
      mime: 'image/png',
      byteLength: bytes.byteLength,
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
/** Reads one path from untyped snapshot JSON. */
const at = (value: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], value);
const resource = (snapshot: IWorkbookData | IDocumentData, name: string): unknown =>
  JSON.parse(snapshot.resources!.find((entry) => entry.name === name)!.data);
/** Every `source` in the snapshot, including inside each resource's JSON data. */
const allSources = (snapshot: IWorkbookData | IDocumentData) => {
  const sources = new Set<string>();
  const collect = (value: unknown) =>
    JSON.stringify(value, (key, child: unknown) => {
      if (key === 'source' && typeof child === 'string') sources.add(child);
      return child;
    });
  collect(snapshot);
  for (const entry of snapshot.resources ?? []) {
    let data: unknown;
    try {
      data = JSON.parse(entry.data);
    } catch {
      continue; // Not JSON, so it cannot hold an image.
    }
    collect(data);
  }
  return [...sources].sort();
};

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
  // Distinct bytes per location, so a location the bundle misses is a missing manifest entry.
  const images = {
    floating: await png('#cc2200'),
    background: await png('#ccaa00'),
    cell: await png('#0044cc'),
    preserved: await png('#00aa44'),
    body: await png('#7700cc'),
    header: await png('#00aacc'),
    footer: await png('#cc0077'),
  };
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
                drawings: { picture: drawing(dataUrl(images.cell), 'rich-cell', 'rich-cell') },
              },
            },
          },
        },
      },
      second: {
        ...tab,
        id: 'second',
        name: 'Second',
        backgroundImage: { source: dataUrl(images.background) },
      },
    },
    resources: [
      {
        name: 'SHEET_DRAWING_PLUGIN',
        data: JSON.stringify({
          tab: {
            order: ['picture'],
            data: { picture: drawing(dataUrl(images.floating), 'source', 'tab') },
          },
        }),
      },
      { name: 'SPINEL_OPAQUE_TEST_PLUGIN', data: JSON.stringify({ kept: true }) },
      // Sheets don't render this resource, so Spinel stores and preserves it. Its image
      // is in no other location, and the bundle must still carry it.
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({
          data: { kept: drawing(dataUrl(images.preserved), 'source', 'source') },
          order: ['kept'],
        }),
      },
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
    headers: {
      top: {
        headerId: 'top',
        body: { dataStream: '\r\n' },
        drawings: { mark: drawing(dataUrl(images.header), 'source', 'top') },
      },
    },
    footers: {
      bottom: {
        footerId: 'bottom',
        body: { dataStream: '\r\n' },
        drawings: { mark: drawing(dataUrl(images.footer), 'source', 'bottom') },
      },
    },
    drawingsOrder: ['picture'],
    drawings: { picture: drawing(dataUrl(images.body), 'source', 'source') },
    resources: [
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({
          data: { picture: drawing(dataUrl(images.body), 'source', 'source') },
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
  const bundle = (user: string, id: string, verify = () => {}) =>
    collab.offlineBundle(user, id, verify);
  /** Holds the next snapshot read open until `release` is called. Holds queue in order. */
  const holdLoad = () => {
    let release = () => {};
    let started = () => {};
    const ready = new Promise<void>((resolve) => (started = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(collab, 'load').mockImplementationOnce(async (...args) => {
      started();
      await held;
      return CollaborationStore.prototype.load.apply(collab, args);
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
    images,
    bundle,
    holdLoad,
  };
}

test('a Sheet bundle is the live snapshot and revision from one read, with every image location in its manifest', async () => {
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
  if (bundle.kind !== 'sheet') throw new Error('Expected a Sheet bundle.');
  const workbook = bundle.snapshot;
  expect(workbook.sheetOrder).toEqual(['tab', 'second']);
  expect(workbook.sheets.tab.cellData![0]![1]!.f).toBe('=A1*2');
  expect(workbook.resources).toContainEqual({
    name: 'SPINEL_OPAQUE_TEST_PLUGIN',
    data: JSON.stringify({ kept: true }),
  });
  const { floating, background, cell, preserved } = f.images;
  expect({
    floating: at(resource(workbook, 'SHEET_DRAWING_PLUGIN'), 'tab', 'data', 'picture', 'source'),
    background: workbook.sheets.second.backgroundImage?.source,
    cell: at(workbook.sheets.tab.cellData, 1, 0, 'p', 'drawings', 'picture', 'source'),
    preserved: at(resource(workbook, 'DOC_DRAWING_PLUGIN'), 'data', 'kept', 'source'),
  }).toEqual({
    floating: route(f.sheet.id, floating),
    background: route(f.sheet.id, background),
    cell: route(f.sheet.id, cell),
    preserved: route(f.sheet.id, preserved),
  });
  expect(bundle.images).toEqual(manifest(f.sheet.id, floating, background, cell, preserved));
  expect(allSources(workbook)).toEqual(bundle.images.map((image) => image.source));
});

test('a Doc bundle lists body, header and footer images, and a viewer bundle is marked read-only', async () => {
  const f = await fixture();
  const { body, header, footer } = f.images;
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
    if (bundle.kind !== 'doc') throw new Error('Expected a Doc bundle.');
    const document = bundle.snapshot;
    expect(document.body?.dataStream).toBe('\bOffline notes\r\n');
    expect({
      body: at(document.drawings, 'picture', 'source'),
      resource: at(resource(document, 'DOC_DRAWING_PLUGIN'), 'data', 'picture', 'source'),
      header: at(document.headers, 'top', 'drawings', 'mark', 'source'),
      footer: at(document.footers, 'bottom', 'drawings', 'mark', 'source'),
    }).toEqual({
      body: route(f.doc.id, body),
      resource: route(f.doc.id, body),
      header: route(f.doc.id, header),
      footer: route(f.doc.id, footer),
    });
    expect(bundle.images).toEqual(manifest(f.doc.id, body, header, footer));
    expect(allSources(document)).toEqual(bundle.images.map((image) => image.source));
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
  // Why 404: a revoked account learns no more than one that never had access (#91).
  await expect(
    attempt(f.viewer.id, () => f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, null)),
  ).rejects.toMatchObject({ status: 404 });
  // Why 409: the account still has access, so the device retries and gets a bundle
  // issued for its new access level instead of an editable copy it may no longer edit (#91).
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
  // Why 409: the document is still available, so a retry downloads the restored version (#91).
  await expect(
    attempt(f.owner.id, () =>
      history.restore(f.owner.id, f.sheet.id, checkpoint.id, unit, randomUUID()),
    ),
  ).rejects.toMatchObject({ status: 409 });
  for (const user of [f.other.id, f.admin.id])
    await expect(f.collab.offlineBundle(user, f.sheet.id, () => {})).rejects.toMatchObject({
      status: 404,
      message: 'This document is not available.',
    });
});

test('a restore still in flight when the read finishes fails the bundle', async () => {
  const f = await fixture();
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const checkpoint = await history.nameCurrent(f.owner.id, f.sheet.id, 'Before');
  // Prepared first, so the held read is the bundle's own and not the prepare's.
  await f.collab.prepare(f.owner.id, f.sheet.id);
  const unit = f.collab.generations.active(f.sheet.id).unitId;
  const read = f.holdLoad();
  const pending = f.collab.offlineBundle(f.owner.id, f.sheet.id, () => {});
  await read.ready;
  // The restore's own read of the old generation is held too, so it stays staging.
  const staging = f.holdLoad();
  const restoring = history.restore(f.owner.id, f.sheet.id, checkpoint.id, unit, randomUUID());
  await staging.ready;
  expect(f.collab.generations.restoring(f.sheet.id)).toBe(true);
  read.release();
  // Why 409: the live generation is about to be replaced, so the device retries (#91).
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect(f.collab.generations.active(f.sheet.id).unitId).toBe(unit);
  // A bundle started while the restore is staging fails before any read.
  await expect(f.bundle(f.owner.id, f.sheet.id)).rejects.toMatchObject({ status: 409 });
  staging.release();
  await restoring;
  // Once the restore lands, a new bundle is the restored generation.
  expect((await f.bundle(f.owner.id, f.sheet.id)).unitId).not.toBe(unit);
});

test('a revoke while the bundle prepares the document is 404, not a save error', async () => {
  const f = await fixture();
  const revoke = f.collab.onPrepared(async (user, id) => {
    if (user === f.viewer.id && id === f.doc.id)
      f.workspace.share(f.owner.id, f.doc.id, f.viewer.id, null);
  });
  cleanup.push(() => revoke.dispose());
  // Why 404: a revoked account learns no more than one that never had access (#91).
  await expect(f.bundle(f.viewer.id, f.doc.id)).rejects.toMatchObject({
    status: 404,
    message: 'This document is not available.',
  });
});

test('an SDK denial is 409 when the unit was replaced and 404 when access is gone', async () => {
  const f = await fixture();
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  await f.collab.prepare(f.owner.id, f.doc.id);
  const checkpoint = await history.nameCurrent(f.owner.id, f.doc.id, 'Before');
  const unit = f.collab.generations.active(f.doc.id).unitId;
  const stale = () =>
    new CollabError('PERMISSION_DENIED', 'This version is no longer live. Reload to continue.');
  // The SDK refuses a read of a unit that a restore replaced mid-read.
  vi.spyOn(f.collab, 'load').mockImplementationOnce(async () => {
    await history.restore(f.owner.id, f.doc.id, checkpoint.id, unit, randomUUID());
    throw stale();
  });
  // Why 409: the account still has access, so a retry downloads the restored version (#91).
  await expect(f.bundle(f.owner.id, f.doc.id)).rejects.toMatchObject({ status: 409 });
  // Any other denial is 404, even while the account keeps access and nothing was replaced.
  vi.spyOn(f.collab, 'load').mockRejectedValueOnce(
    new CollabError('PERMISSION_DENIED', 'Your session expired.'),
  );
  await expect(f.bundle(f.owner.id, f.doc.id)).rejects.toMatchObject({ status: 404 });
  vi.spyOn(f.collab, 'load').mockImplementationOnce(async () => {
    f.workspace.share(f.owner.id, f.doc.id, f.editor.id, null);
    throw new CollabError('PERMISSION_DENIED', 'This document is not available.');
  });
  // Why 404: a revoked account learns no more than one that never had access (#91).
  await expect(f.bundle(f.editor.id, f.doc.id)).rejects.toMatchObject({ status: 404 });
});

test('link guests cannot take an offline bundle, even with link access', async () => {
  const f = await fixture();
  const link = f.workspace.links.begin(f.sheet.id, 'editor');
  f.workspace.links.finish(f.sheet.id, link.epoch, true);
  const guest = f.workspace.links.exchange(f.sheet.id, link.token);
  expect(f.workspace.get(guest.userId, f.sheet.id).access).toBe('editor');
  // Why 404: guests use the link while it lasts; an offline copy would outlive it (#91).
  await expect(f.collab.offlineBundle(guest.userId, f.sheet.id, () => {})).rejects.toMatchObject({
    status: 404,
  });
});

test('damaged stored images and foreign sources return nothing', async () => {
  const f = await fixture();
  await f.collab.prepare(f.owner.id, f.doc.id);
  const body = f.images.body;
  f.auth.database
    .prepare('UPDATE doc_images SET data=? WHERE item_id=? AND id=?')
    .run(Buffer.from('not the same bytes'), f.doc.id, sha(body));
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(f.collab.offlineBundle(f.owner.id, f.doc.id, () => {})).rejects.toMatchObject({
    status: 500,
  });
  expect(logged).toHaveBeenCalledTimes(1);
  const [line] = logged.mock.calls[0]!;
  expect(JSON.parse(String(line))).toMatchObject({
    event: 'offline_bundle.image_damaged',
    itemId: f.doc.id,
    imageId: sha(body),
  });
  expect(String(line)).not.toContain('Notes');
  expect(String(line)).not.toContain(Buffer.from('not the same bytes').toString('base64'));
  f.auth.database
    .prepare('UPDATE doc_images SET data=? WHERE item_id=? AND id=?')
    .run(body, f.doc.id, sha(body));
  // Rejected by load()'s image validation, before the bundle's own same-item guard.
  f.auth.database.prepare('INSERT OR REPLACE INTO spinel_generation_resources VALUES(?,?,?)').run(
    f.collab.generations.active(f.doc.id).unitId,
    f.doc.id,
    JSON.stringify([
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({
          outside: { source: route(f.sheet.id, f.images.floating) },
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
    expect(bundle.images).toHaveLength(4);
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
  // Prepared first, so the held read is the bundle's own and not the prepare's.
  await f.collab.prepare(f.owner.id, f.doc.id);
  const token = session(f.owner.id);
  const hold = f.holdLoad();
  const pending = get(`${f.doc.id}/offline-bundle`, cookie(token));
  await hold.ready;
  expect((await get(`${f.doc.id}/offline-bundle`, cookie(session(f.owner.id)))).status).toBe(429);
  f.auth.revokeSession(hashToken(token));
  // load() now rejects its original credential; the request must still report sign-in.
  hold.release();
  const signedOut = await pending;
  expect(signedOut.status).toBe(401);
  expect(await signedOut.json()).toEqual({ error: 'Sign in to continue.' });
  expect((await get(`${f.doc.id}/offline-bundle`, cookie(session(f.owner.id)))).status).toBe(200);
  /** Runs `change` while the route's one read is held, and returns the response. */
  const race = async (user: string, id: string, change: () => unknown | Promise<unknown>) => {
    const held = f.holdLoad();
    const response = get(`${id}/offline-bundle`, cookie(session(user)));
    await held.ready;
    await change();
    held.release();
    const result = await response;
    return { status: result.status, body: (await result.json()) as unknown };
  };
  // Why 404: a revoked account learns no more than one that never had access (#91).
  expect(
    await race(f.viewer.id, f.sheet.id, () =>
      f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, null),
    ),
  ).toEqual({ status: 404, body: { error: 'This document is not available.' } });
  const retry = { error: 'Access or the document version changed. Retry the download.' };
  // Why 409: the account still has access, so the device retries for its new level (#91).
  expect(
    await race(f.editor.id, f.sheet.id, () =>
      f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, 'viewer'),
    ),
  ).toEqual({ status: 409, body: retry });
  // Created only now, so the races above hold the bundle read and not the history load.
  const history = new HistoryStore(f.workspace, f.collab);
  cleanup.push(() => history.close());
  const checkpoint = await history.nameCurrent(f.owner.id, f.doc.id, 'Before');
  const unit = f.collab.generations.active(f.doc.id).unitId;
  // Why 409: the document is still available, so a retry downloads the restored version (#91).
  expect(
    await race(f.owner.id, f.doc.id, () =>
      history.restore(f.owner.id, f.doc.id, checkpoint.id, unit, randomUUID()),
    ),
  ).toEqual({ status: 409, body: retry });
  // A revoke while the route prepares the document, before the read.
  const revoke = f.collab.onPrepared(async (user, id) => {
    if (user === f.editor.id && id === f.doc.id)
      f.workspace.share(f.owner.id, f.doc.id, f.editor.id, null);
  });
  cleanup.push(() => revoke.dispose());
  const revoked = await get(`${f.doc.id}/offline-bundle`, cookie(session(f.editor.id)));
  // Why 404: a revoked account learns no more than one that never had access (#91).
  expect(revoked.status).toBe(404);
  expect(await revoked.json()).toEqual({ error: 'This document is not available.' });
});
