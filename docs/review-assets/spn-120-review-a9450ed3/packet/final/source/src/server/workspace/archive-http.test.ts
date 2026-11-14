import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { createHttpServer } from '../../../server/http.ts';
import { ARCHIVE_LIMIT } from '../../shared/archive.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { workspaceRoutes } from './routes.ts';
import { WorkspaceStore } from './store.ts';
import { PortableFiles } from './portable.ts';

async function fixture(collaboration?: CollaborationStore) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-archive-http-'));
  const db = new DatabaseSync(join(directory, 'app.sqlite'));
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Other');
  const operator = auth.createUser('Operator', true);
  const session = auth.createSession(owner.id);
  const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
  const ownerCookie = `${COOKIE_NAME}=${session.token}`;
  const headers = {
    Cookie: ownerCookie,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
  };
  const app = express();
  const server = createHttpServer(app);
  app.use('/api/items', workspaceRoutes(auth, headers.Origin, workspace, collaboration));
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/items`;
  const payload = {
    filename: 'Writing.json',
    parentId: null as string | null,
    snapshot: { id: 'source', title: 'Writing', body: { dataStream: 'My content\r\n' } },
  };
  const native = (overrides = headers) =>
    fetch(`${root}/import`, { method: 'POST', headers: overrides, body: JSON.stringify(payload) });
  const start = (overrides = headers) =>
    fetch(`${root}/archive-export`, { method: 'POST', headers: overrides, body: '{}' });
  const status = async (id: string) =>
    (await fetch(`${root}/archive-export/${id}`, { headers })).json();
  return {
    directory,
    db,
    auth,
    workspace,
    owner,
    other,
    operator,
    session,
    cookie,
    headers,
    root,
    payload,
    native,
    start,
    status,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('archive HTTP round trip is session-bound, owned-only and imports into a fresh database', async () => {
  const source = await fixture();
  const target = await fixture();
  try {
    const folder = source.workspace.create(source.owner.id, {
      name: 'Projects',
      kind: 'folder',
      parentId: null,
    });
    source.payload.parentId = folder.id;
    expect((await source.native()).status).toBe(201);
    const shared = source.workspace.create(source.other.id, {
      name: 'Shared private document',
      kind: 'doc',
      parentId: null,
    });
    source.workspace.share(source.other.id, shared.id, source.owner.id, 'admin');
    for (const [Cookie, expected] of [
      ['', 401],
      [source.cookie(source.operator.id), 403],
    ] as const)
      expect((await source.start({ ...source.headers, Cookie })).status).toBe(expected);
    expect(
      (await source.start({ ...source.headers, Origin: 'https://elsewhere.example' })).status,
    ).toBe(403);
    const created = await source.start();
    expect(created.status).toBe(201);
    const { task } = await created.json();
    // Retrying a lost task-creation response must not strand the account until expiry.
    expect((await (await source.start()).json()).task.id).toBe(task.id);
    for (const Cookie of [source.cookie(source.other.id), source.cookie(source.owner.id)])
      expect(
        (await fetch(`${source.root}/archive-export/${task.id}`, { headers: { Cookie } })).status,
      ).toBe(404);
    expect(
      (await source.start({ ...source.headers, Cookie: source.cookie(source.owner.id) })).status,
    ).toBe(429);
    const downloaded = await fetch(`${source.root}/archive-export/${task.id}/download`, {
      headers: source.headers,
    });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe('application/zip');
    expect(downloaded.headers.get('content-disposition')).toMatch(/attachment;.*\.zip/);
    expect(downloaded.headers.get('cache-control')).toBe('no-store');
    expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff');
    const zip = await downloaded.arrayBuffer();
    await expect.poll(async () => (await source.status(task.id)).task.state).toBe('completed');
    expect((await source.status(task.id)).task).toMatchObject({ completed: 1, total: 1 });
    expect(
      (
        await fetch(`${source.root}/archive-export/${task.id}/download`, {
          headers: source.headers,
        })
      ).status,
    ).toBe(409);
    const imported = await fetch(`${target.root}/archive-import`, {
      method: 'POST',
      headers: { ...target.headers, 'Content-Type': 'application/zip' },
      body: zip,
    });
    expect(imported.status).toBe(201);
    expect(await imported.json()).toEqual({
      result: { items: 2, files: 1, folders: 1, spaces: 0 },
    });
    const rows = target.db
      .prepare('SELECT id,owner_id,parent_id,kind,name FROM workspace_items ORDER BY kind')
      .all();
    expect(rows.map((row) => row.name).sort()).toEqual(['Projects', 'Writing']);
    const importedFolder = rows.find((row) => row.kind === 'folder')!;
    const importedDoc = rows.find((row) => row.kind === 'doc')!;
    expect(importedDoc.parent_id).toBe(importedFolder.id);
    expect(importedFolder.id).not.toBe(folder.id);
    expect(rows.every((row) => row.owner_id === target.owner.id)).toBe(true);
    expect(target.db.prepare('SELECT COUNT(*) AS total FROM workspace_grants').get()!.total).toBe(
      0,
    );
    await expect.poll(() => readdir(join(target.directory, '.archive-imports'))).toEqual([]);
    const before = rows.length;
    for (const [path, type, body, expected] of [
      ['/archive-import', 'application/zip', Buffer.from('not a zip'), 400],
      ['/archive-import?parentId=some-folder', 'application/zip', Buffer.from(zip), 400],
      ['/archive-import', 'application/json', Buffer.from('{}'), 415],
    ] as const) {
      const response = await fetch(`${target.root}${path}`, {
        method: 'POST',
        headers: { ...target.headers, 'Content-Type': type },
        body,
      });
      expect(response.status).toBe(expected);
    }
    expect(target.db.prepare('SELECT COUNT(*) AS total FROM workspace_items').get()!.total).toBe(
      before,
    );
    await expect.poll(() => readdir(join(target.directory, '.archive-imports'))).toEqual([]);
  } finally {
    await source.close();
    await target.close();
  }
});

test('cancelled or revoked exports retain admission until materialization settles', async () => {
  let release = () => {};
  let entered = () => {};
  let held: Promise<void> | undefined;
  const collaboration = {
    prepare: async () => {},
    load: async () => {
      entered();
      await held;
      return { snapshot: { id: 'source', body: { dataStream: 'Latest\r\n' } } };
    },
    generations: { active: (id: string) => ({ unitId: id }), restoring: () => false },
  } as unknown as CollaborationStore;
  const source = await fixture(collaboration);
  try {
    expect((await source.native()).status).toBe(201);
    for (const revoke of [false, true]) {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const { task } = await (await source.start()).json();
      const download = fetch(`${source.root}/archive-export/${task.id}/download`, {
        headers: source.headers,
      })
        .then((response) => response.arrayBuffer())
        .catch(() => undefined);
      await started;
      if (revoke) source.auth.revokeSession(source.session.session.token_hash);
      else {
        const cancelled = await fetch(`${source.root}/archive-export/${task.id}`, {
          method: 'DELETE',
          headers: source.headers,
          body: '{}',
        });
        expect((await cancelled.json()).task.state).toBe('cancelled');
      }
      const otherHeaders = { ...source.headers, Cookie: source.cookie(source.other.id) };
      expect((await source.native(otherHeaders)).status).toBe(429);
      release();
      await download;
      await expect.poll(async () => (await source.native(otherHeaders)).status).toBe(201);
      if (!revoke) expect((await source.status(task.id)).task.state).toBe('cancelled');
    }
  } finally {
    release();
    await source.close();
  }
});

test('an oversized declaration and a stalled upload release admission and remove staged files', async () => {
  const source = await fixture();
  const timer = vi.spyOn(globalThis, 'setTimeout');
  try {
    const oversized = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${source.root}/archive-import`,
        {
          method: 'POST',
          headers: {
            ...source.headers,
            'Content-Type': 'application/zip',
            'Content-Length': String(ARCHIVE_LIMIT + 1),
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.on('error', reject);
      request.flushHeaders();
    });
    expect(oversized).toBe(413);
    const count = timer.mock.calls.length;
    let upload: ReturnType<typeof httpRequest>;
    const disconnected = new Promise<void>((resolve) => {
      upload = httpRequest(
        `${source.root}/archive-import`,
        {
          method: 'POST',
          headers: { ...source.headers, 'Content-Type': 'application/zip' },
        },
        (response) => {
          response.resume();
          resolve();
        },
      );
      upload.once('error', () => resolve());
      upload.write('PK');
    });
    await expect.poll(async () => (await source.native()).status).toBe(429);
    const deadline = timer.mock.calls.slice(count).find((call) => call[1] === 60 * 60_000)!;
    expect(deadline).toBeDefined();
    (deadline[0] as () => void)();
    await disconnected;
    upload!.destroy();
    await expect.poll(async () => (await source.native()).status).toBe(201);
    expect(await readdir(join(source.directory, '.archive-imports'))).toEqual([]);
  } finally {
    timer.mockRestore();
    await source.close();
  }
});

test('cancelling a stalled browser download wakes backpressure and releases transfer admission', async () => {
  const source = await fixture();
  source.workspace.create(source.owner.id, { name: 'Large document', kind: 'doc', parentId: null });
  // The transport must stop even when a native member is valid but poorly
  // compressible and the browser stops reading its socket entirely.
  const native = vi.spyOn(PortableFiles.prototype, 'export').mockResolvedValue({
    filename: 'Large document.univer.json',
    text: JSON.stringify({
      id: 'source',
      body: { dataStream: 'Large document\r\n' },
      resources: [{ name: 'opaque', data: randomBytes(8 * 1024 * 1024).toString('base64') }],
    }),
  });
  let request: ReturnType<typeof httpRequest> | undefined;
  try {
    const { task } = await (await source.start()).json();
    await new Promise<void>((resolve, reject) => {
      request = httpRequest(
        `${source.root}/archive-export/${task.id}/download`,
        {
          headers: source.headers,
        },
        (response) => {
          response.on('error', () => {});
          response.pause();
          resolve();
        },
      );
      request.once('error', reject);
      request.end();
    });
    expect((await source.status(task.id)).task.state).toBe('exporting');
    const cancelled = await fetch(`${source.root}/archive-export/${task.id}`, {
      method: 'DELETE',
      headers: source.headers,
      body: '{}',
    });
    expect((await cancelled.json()).task.state).toBe('cancelled');
    await expect.poll(async () => (await source.native()).status).toBe(201);
    expect((await source.status(task.id)).task.state).toBe('cancelled');
  } finally {
    request?.destroy();
    native.mockRestore();
    await source.close();
  }
});
