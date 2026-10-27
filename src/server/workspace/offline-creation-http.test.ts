import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { SQLiteSyncStorage } from '../sync/store.ts';
import { workspaceRoutes } from './routes.ts';
import { WorkspaceStore } from './store.ts';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-offline-create-http-'));
  const path = join(directory, 'app.sqlite');
  const db = openDatabase(path);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Other');
  const operator = auth.createUser('Operator', true);
  const session = auth.createSession(owner.id);
  const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
  const headers: Record<string, string> = {
    Cookie: `${COOKIE_NAME}=${session.token}`,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
    'x-spinel-offline-account': owner.id,
  };
  const collaboration = new CollaborationStore(workspace, path);
  const app = express();
  app.use('/api/items', workspaceRoutes(auth, headers.Origin, workspace, collaboration));
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/items`;
  const input = {
    version: 1,
    itemId: randomUUID(),
    unitId: randomUUID(),
    name: 'New offline sheet',
    kind: 'sheet',
    parentId: null as string | null,
  };
  const create = (body: unknown = input, overrides = headers) =>
    fetch(`${root}/offline-create`, {
      method: 'POST',
      headers: overrides,
      body: JSON.stringify(body),
    });
  return {
    db,
    auth,
    workspace,
    owner,
    other,
    operator,
    cookie,
    headers,
    input,
    root,
    create,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await collaboration.close();
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('offline-create HTTP commits one native document after an ignored acknowledgement and reordered retry', async () => {
  const f = await fixture();
  try {
    const first = await f.create();
    expect(first.status).toBe(201);
    expect(first.headers.get('cache-control')).toBe('no-store');
    await first.body!.cancel();
    const response = await f.create(Object.fromEntries(Object.entries(f.input).reverse()));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({
      item: {
        id: f.input.itemId,
        name: f.input.name,
        kind: 'sheet',
        parentId: null,
        access: 'owner',
      },
      unitId: f.input.unitId,
      revision: 1,
      revisionOffset: 0,
      syncVersion: 1,
    });
    expect(f.workspace.list(f.owner.id)).toEqual([result.item]);
    expect(new SQLiteSyncStorage(f.auth).load(f.input.unitId)).toMatchObject({
      revision: 1,
      kind: 'sheet',
    });
    expect((await f.create({ ...f.input, name: 'Changed' })).status).toBe(409);
    const conflict = await f.create({ ...f.input, parentId: randomUUID() });
    expect(await conflict.json()).toMatchObject({ code: 'creation-conflict' });
    expect(f.db.prepare('SELECT count(*) AS count FROM workspace_items').get()!.count).toBe(1);
    expect(
      f.db.prepare('SELECT count(*) AS count FROM workspace_offline_creations').get()!.count,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

test('offline-create is cookie/account fenced before permission checks and refuses guests, operators, CSRF and disabled accounts', async () => {
  const f = await fixture();
  try {
    const withoutFence = { ...f.headers };
    delete withoutFence['x-spinel-offline-account'];
    const attempts: Array<[Record<string, string>, number]> = [
      [{ ...f.headers, Cookie: '' }, 401],
      [{ ...f.headers, Cookie: '', Authorization: 'Bearer unscoped-token' }, 401],
      [{ ...f.headers, Cookie: f.cookie(f.other.id) }, 409],
      [{ ...f.headers, Cookie: f.cookie(f.operator.id) }, 409],
      [
        {
          ...f.headers,
          Cookie: f.cookie(f.operator.id),
          'x-spinel-offline-account': f.operator.id,
        },
        403,
      ],
      [withoutFence, 409],
      [{ ...f.headers, Origin: 'https://foreign.example' }, 403],
      [{ ...f.headers, 'Content-Type': 'text/plain' }, 403],
    ];
    for (const [headers, status] of attempts)
      expect((await f.create(f.input, headers)).status).toBe(status);
    f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
    expect((await f.create()).status).toBe(401);
    expect(f.db.prepare('SELECT * FROM workspace_items').all()).toEqual([]);
    expect(f.db.prepare('SELECT * FROM workspace_offline_creations').all()).toEqual([]);
    expect(f.db.prepare('SELECT * FROM spinel_sync_units').all()).toEqual([]);
  } finally {
    await f.close();
  }
});

test('folder refusal is a definitive no-write result, while malformed and oversized creation requests remain bounded', async () => {
  const f = await fixture();
  try {
    const foreign = f.workspace.create(f.other.id, {
      name: 'Foreign folder',
      kind: 'folder',
      parentId: null,
    });
    f.workspace.share(f.other.id, foreign.id, f.owner.id, 'editor');
    for (const parentId of [randomUUID(), foreign.id]) {
      const denied = await f.create({ ...f.input, parentId });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ code: 'folder-unavailable' });
    }
    for (const body of [
      { ...f.input, kind: 'space' },
      { ...f.input, spaceId: randomUUID() },
      { ...f.input, snapshot: { id: 'foreign' } },
      { ...f.input, name: 'bad/name' },
      { ...f.input, version: 2 },
    ])
      expect((await f.create(body)).status).toBe(400);
    expect((await f.create({ ...f.input, name: 'x'.repeat(9000) })).status).toBe(413);
    expect(f.workspace.list(f.owner.id)).toEqual([]);
    expect(f.db.prepare('SELECT * FROM workspace_offline_creations').all()).toEqual([]);
    expect(f.db.prepare('SELECT * FROM spinel_sync_units').all()).toEqual([]);
    const accepted = await f.create();
    expect(accepted.status).toBe(201);
    expect((await accepted.json()).item.parentId).toBeNull();
  } finally {
    await f.close();
  }
});
