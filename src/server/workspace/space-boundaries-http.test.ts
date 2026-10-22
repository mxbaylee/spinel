import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { AccessTokens } from '../auth/tokens.ts';
import { DocumentStore } from './documents.ts';
import { guestCookieName } from './links.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SheetStore } from './sheets.ts';
import { WorkspaceStore } from './store.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-space-boundaries-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const filename = join(directory, 'app.sqlite');
  const seed = openDatabase(filename);
  const auth = new AuthStore(seed);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const folder = workspace.create(owner.id, {
    name: 'Ordinary folder',
    kind: 'folder',
    parentId: null,
  });
  const doc = workspace.create(owner.id, {
    name: 'Hidden Space notes',
    kind: 'doc',
    parentId: folder.id,
  });
  const sheet = workspace.create(owner.id, {
    name: 'Hidden Space budget',
    kind: 'sheet',
    parentId: folder.id,
  });
  const ordinary = workspace.create(owner.id, {
    name: 'Ordinary sheet',
    kind: 'sheet',
    parentId: null,
  });
  workspace.share(owner.id, folder.id, editor.id, 'editor');
  workspace.share(owner.id, folder.id, viewer.id, 'viewer');
  const documents = new DocumentStore(workspace);
  documents.save(owner.id, doc.id, {
    snapshot: { ...getDocsEmptySnapshot(doc.id), body: { dataStream: 'Hidden native text\r\n' } },
    revision: 0,
    writeId: randomUUID(),
  });
  new SheetStore(workspace).save(owner.id, sheet.id, {
    snapshot: {
      id: sheet.id,
      name: sheet.name,
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      sheetOrder: ['first'],
      styles: {},
      sheets: {
        first: {
          id: 'first',
          name: 'Secret tab',
          rowCount: 10,
          columnCount: 10,
          cellData: { 0: { 0: { v: 'Hidden cell' } } },
        },
      },
    },
    revision: 0,
    writeId: randomUUID(),
  });
  const imageId = 'a'.repeat(64);
  seed
    .prepare('INSERT INTO doc_images VALUES(?,?,?,?)')
    .run(doc.id, imageId, 'image/png', Buffer.from('Hidden image'));
  // Simulate stale independently issued capabilities in deliberately malformed data.
  // There is no production conversion path from an ordinary file into a Space.
  const link = workspace.links.begin(doc.id, 'editor');
  workspace.links.finish(doc.id, link.epoch, true);
  const guest = workspace.links.exchange(doc.id, link.token);
  const cookie = (userId: string) => COOKIE_NAME + '=' + auth.createSession(userId).token;
  const cookies = [cookie(owner.id), cookie(editor.id), cookie(viewer.id)];
  const token = new AccessTokens(auth).create(owner.id, 'Space boundary fixture').token;
  const spaceId = randomUUID();
  migrateSpaceSchema(seed); // Before the application/SDK opens another connection.
  seed
    .prepare(
      "INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,?,'space','Hidden Space',1,1)",
    )
    .run(spaceId, owner.id, folder.id);
  seed
    .prepare('UPDATE workspace_items SET parent_id=?,space_id=?,space_position=0 WHERE id=?')
    .run(spaceId, spaceId, doc.id);
  seed
    .prepare('UPDATE workspace_items SET parent_id=?,space_id=?,space_position=0 WHERE id=?')
    .run(doc.id, spaceId, sheet.id);
  const before = ['doc_snapshots', 'sheet_snapshots', 'doc_images'].map((table) =>
    seed.prepare('SELECT * FROM ' + table).all(),
  );
  seed.close();

  const origin = 'http://localhost:3000';
  const app = await createApp({ databasePath: filename, staticDirectory: directory, origin });
  cleanup.push(() => app.close());
  const db = openDatabase(filename);
  cleanup.push(() => db.close());
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const root = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port;
  const send = (
    path: string,
    credential = cookies[0],
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ) =>
    fetch(root + path, {
      method,
      headers: {
        Cookie: credential,
        Origin: origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const unchanged = () => {
    expect(
      ['doc_snapshots', 'sheet_snapshots', 'doc_images'].map((table) =>
        db.prepare('SELECT * FROM ' + table).all(),
      ),
    ).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  };
  return {
    db,
    origin,
    root,
    send,
    cookies,
    owner,
    editor,
    viewer,
    folder,
    doc,
    sheet,
    ordinary,
    spaceId,
    imageId,
    link,
    token,
    guestCookie: guestCookieName(doc.id) + '=' + guest.token,
    unchanged,
  };
}

test('ordinary HTTP discovery and direct-ID content, grants, exports and formulas refuse hidden Space data', async () => {
  const f = await fixture();
  for (const cookie of f.cookies) {
    for (const path of ['/api/items', '/api/items/shared', '/api/items/search']) {
      const response = await f.send(path, cookie);
      expect(response.status, path).toBe(200);
      const body = await response.text();
      for (const secret of [f.spaceId, f.doc.id, f.sheet.id, 'Hidden'])
        expect(body, path).not.toContain(secret);
    }
    for (const id of [f.spaceId, f.doc.id, f.sheet.id]) {
      for (const suffix of ['', '/sharing', '/link', '/history', '/export', '/offline-bundle']) {
        const response = await f.send('/api/items/' + id + suffix, cookie);
        expect(response.status, suffix).toBe(404);
        expect(await response.text()).not.toContain('Hidden');
      }
      for (const [suffix, method, body] of [
        ['', 'PATCH', { name: 'Escaped' }],
        ['/sharing', 'PUT', { userId: f.viewer.id, role: 'editor' }],
        ['/link', 'PUT', { role: 'viewer' }],
        ['/placement', 'PUT', { parentId: null }],
        ['/tags', 'POST', { tag: 'hidden' }],
        ['/trash', 'POST', {}],
        ['/restore', 'POST', {}],
        ['/collaboration', 'POST', {}],
      ] as const) {
        const response = await f.send('/api/items/' + id + suffix, cookie, body, method);
        expect(response.status, method + ' ' + suffix).toBe(
          suffix === '/collaboration' ? 400 : 404,
        );
      }
    }
    for (const path of [
      '/api/items/' + f.doc.id + '/doc',
      '/api/items/' + f.sheet.id + '/sheet',
      '/api/items/' + f.doc.id + '/images/' + f.imageId,
      '/api/items/' + f.doc.id + '/formulas/sources',
    ]) {
      const response = await f.send(path, cookie);
      expect(response.status, path).toBe(404);
      expect(await response.text()).not.toContain('Hidden');
    }
    expect(
      (
        await f.send(
          '/api/items/' + f.doc.id + '/doc',
          cookie,
          {
            snapshot: {
              ...getDocsEmptySnapshot(f.doc.id),
              body: { dataStream: 'Forged write\r\n' },
            },
            revision: 1,
            writeId: randomUUID(),
          },
          'PUT',
        )
      ).status,
    ).toBe(404);
  }
  const ordinary = await f.send('/api/items/' + f.ordinary.id + '/sheet');
  expect(ordinary.status).toBe(200);
  f.unchanged();
}, 30_000);

test('protocol permissions, snapshots, session tickets and guest capabilities close at the real application boundary', async () => {
  const f = await fixture();
  const ids = [f.spaceId, f.doc.id, f.sheet.id];
  for (const cookie of f.cookies) {
    const allowed = await f.send('/universer-api/authz/-/object/-/batch_allowed', cookie, {
      requests: ids.map((id) => ({ unitID: id, objectID: id, actions: [0, 1, 2, 34] })),
    });
    expect(allowed.status).toBe(200);
    const body = await allowed.json();
    expect(body.objectActions).toHaveLength(ids.length);
    for (const row of body.objectActions)
      expect(row.actions.every((action: { allowed: boolean }) => !action.allowed)).toBe(true);
    for (const id of ids) {
      expect(
        (await f.send('/universer-api/user/session-ticket?unitID=' + id, cookie)).status,
      ).toBeGreaterThanOrEqual(400);
      const snapshot = await f.send('/universer-api/snapshot/2/unit/' + id + '/rev/0', cookie);
      expect(snapshot.status).toBeGreaterThanOrEqual(400);
      expect(await snapshot.text()).not.toContain('Hidden');
    }
  }
  for (const path of [
    '/api/guest/' + f.doc.id,
    '/api/items/' + f.doc.id + '/images/' + f.imageId,
    '/guest-api/' + f.doc.id + '/universer-api/user/session-ticket?unitID=' + f.doc.id,
    '/guest-api/' + f.doc.id + '/universer-api/snapshot/1/unit/' + f.doc.id + '/rev/0',
  ]) {
    const response = await f.send(path, f.guestCookie);
    expect(response.status, path).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain('Hidden');
  }
  expect(
    (await f.send('/api/guest/' + f.doc.id + '/session', '', { token: f.link.token })).status,
  ).toBe(404);
  expect(
    (await f.send('/share/' + f.doc.id + '/preview.png?preview=' + f.link.previewToken, '')).status,
  ).toBe(404);

  // A valid account and an existing protocol ticket still cannot upgrade a hidden unit.
  expect(
    (await f.send('/api/items/' + f.ordinary.id + '/collaboration', f.cookies[0], {})).ok,
  ).toBe(true);
  const ticketResponse = await f.send('/universer-api/user/session-ticket?unitID=' + f.ordinary.id);
  expect(ticketResponse.status).toBe(200);
  const ticket = (await ticketResponse.json()).ticket;
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      f.root +
        '/universer-api/comb/connect?unitID=' +
        f.sheet.id +
        '&sessionTicket=' +
        encodeURIComponent(ticket),
      {
        headers: {
          Cookie: f.cookies[0],
          Origin: f.origin,
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.alloc(16).toString('base64'),
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
      },
    );
    req.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode!);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Space upgrade timeout')));
    req.end();
  });
  expect(status).toBeGreaterThanOrEqual(400);
  f.unchanged();
}, 30_000);

test('MCP enumeration and guessed IDs cannot read or write Space children', async () => {
  const f = await fixture();
  const client = new Client({ name: 'space-boundary', version: '1.0.0' });
  cleanup.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(f.root + '/mcp'), {
      requestInit: { headers: { authorization: 'Bearer ' + f.token } },
    }),
  );
  const listing = await client.callTool({ name: 'list_documents', arguments: {} });
  expect(listing.isError).not.toBe(true);
  expect(JSON.stringify(listing)).toContain(f.ordinary.id);
  for (const id of [f.spaceId, f.doc.id, f.sheet.id])
    expect(JSON.stringify(listing)).not.toContain(id);
  for (const [name, id] of [
    ['read_doc', f.doc.id],
    ['read_sheet', f.sheet.id],
  ] as const) {
    const result = await client.callTool({ name, arguments: { id } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Hidden');
  }
  const edit = await client.callTool({
    name: 'edit_doc',
    arguments: {
      id: f.doc.id,
      unitId: f.doc.id,
      revision: 1,
      requestId: randomUUID(),
      offset: 0,
      deleteCount: 0,
      text: 'Forged MCP text',
    },
  });
  expect(edit.isError).toBe(true);
  f.unchanged();
}, 30_000);
