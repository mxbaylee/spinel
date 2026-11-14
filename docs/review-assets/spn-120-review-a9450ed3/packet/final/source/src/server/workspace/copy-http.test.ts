import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { WorkspaceStore } from './store.ts';
import { PortableFiles } from './portable.ts';
import { workspaceRoutes } from './routes.ts';
import { spaceNativeRoutes } from './space-native-routes.ts';
import { SpaceStore } from './spaces.ts';
import { migrateSpaceSchema } from './space-schema.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const finish of cleanup.splice(0).reverse()) await finish();
});

async function fixture() {
  const db = new DatabaseSync(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const reader = auth.createUser('Reader');
  const operator = auth.createUser('Operator', true);
  const sessions = new Map(
    [owner, reader, operator].map((user) => [user.id, auth.createSession(user.id)]),
  );
  const files = new PortableFiles(workspace);
  const original = await files.import(
    owner.id,
    {
      filename: 'doc.json',
      parentId: null,
      snapshot: { id: 'source', title: 'Recipe', body: { dataStream: 'Original\r\n' } },
    },
    () => {},
  );
  workspace.share(owner.id, original.id, reader.id, 'viewer');
  const generations = new CollaborationGenerations(workspace);
  const spaces = new SpaceStore(workspace);
  const space = spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space;
  const child = spaces.createChild(owner.id, space.id, {
    name: 'Page',
    kind: 'doc',
    parentId: space.id,
  }).item;
  spaces.share(owner.id, space.id, reader.id, 'viewer');
  db.exec(`CREATE TABLE workspace_collaboration(item_id TEXT PRIMARY KEY,state TEXT NOT NULL);
    CREATE TABLE spinel_sync_units(unit_id TEXT PRIMARY KEY,kind TEXT NOT NULL,revision INTEGER NOT NULL,snapshot TEXT NOT NULL,retained_from INTEGER NOT NULL);`);
  for (const item of [original, child]) {
    db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(item.id);
    db.prepare("INSERT INTO spinel_sync_units VALUES(?,'doc',3,?,1)").run(
      item.id,
      JSON.stringify({ id: item.id, title: item.name, body: { dataStream: 'Latest saved\r\n' } }),
    );
  }
  const load = vi.fn(async (_user: string, id: string) => {
    const row = db
      .prepare('SELECT snapshot,revision FROM spinel_sync_units WHERE unit_id=?')
      .get(id)!;
    return { snapshot: JSON.parse(String(row.snapshot)), revision: Number(row.revision) };
  });
  const collaboration = {
    generations,
    prepare: vi.fn(async () => {}),
    load,
  } as unknown as CollaborationStore;
  const origin = 'http://localhost:3000';
  const app = express();
  app.use('/api/items', workspaceRoutes(auth, origin, workspace, collaboration));
  app.use(
    '/api/spaces/:spaceId/items/:itemId',
    spaceNativeRoutes(workspace, collaboration, origin, { spaceReview: true }),
  );
  app.use(
    '/api/guest-spaces/:spaceId/items/:itemId',
    spaceNativeRoutes(workspace, collaboration, origin, { spaceReview: true, guest: true }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((done, reject) => {
    server.once('listening', done);
    server.once('error', reject);
  });
  cleanup.push(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = (actor = owner.id) => ({
    Cookie: sessions.has(actor) ? `${COOKIE_NAME}=${sessions.get(actor)!.token}` : '',
    Origin: origin,
    'Content-Type': 'application/json',
  });
  const send = (
    path: string,
    actor = owner.id,
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(root + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers(actor), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    db,
    auth,
    workspace,
    owner,
    reader,
    operator,
    sessions,
    files,
    original,
    spaces,
    space,
    child,
    load,
    collaboration,
    root,
    headers,
    send,
  };
}

test('ordinary and scoped copy routes validate authority, CSRF, content and exact scope before publishing', async () => {
  const f = await fixture();
  const ordinary = `/api/items/${f.original.id}`;
  const scoped = `/api/spaces/${f.space.id}/items/${f.child.id}`;
  for (const base of [ordinary, scoped]) {
    for (const [actor, status] of [
      ['absent', 401],
      // Scoped native routes use documentIdentity's existing everyday-account denial.
      [f.operator.id, base === ordinary ? 403 : 401],
    ] as const) {
      expect((await f.send(base + '/copy-options', actor)).status).toBe(status);
      expect((await f.send(base + '/copy', actor, {})).status).toBe(status);
    }
    expect(
      (await f.send(base + '/copy', f.owner.id, {}, { Origin: 'https://elsewhere.test' })).status,
    ).toBe(403);
    expect((await f.send(base + '/copy', f.owner.id, { ownerId: f.reader.id })).status).toBe(400);
    expect((await f.send(base + '/copy', f.owner.id, { name: 'x'.repeat(9000) })).status).toBe(413);
    const options = await f.send(base + '/copy-options', f.reader.id);
    expect(options.status).toBe(200);
    expect(options.headers.get('cache-control')).toBe('no-store');
    expect(await options.json()).toMatchObject({ parentId: null, destinations: [] });
    const response = await f.send(base + '/copy', f.reader.id, { name: 'My copy', parentId: null });
    expect(response.status).toBe(201);
    const { item } = await response.json();
    expect(item).toMatchObject({ name: 'My copy', parentId: null, access: 'owner' });
    expect(f.files.docs.load(f.reader.id, item.id).snapshot!.body!.dataStream).toBe(
      'Latest saved\r\n',
    );
  }
  expect((await f.send(`/api/items/${f.child.id}/copy`, f.owner.id, {})).status).toBe(404);
  expect(
    (await f.send(`/api/spaces/${f.original.id}/items/${f.child.id}/copy`, f.owner.id, {})).status,
  ).toBe(404);
  expect(
    (await f.send(`/api/spaces/${f.space.id}/items/${f.space.id}/copy`, f.owner.id, {})).status,
  ).toBe(404);
  expect(
    (await f.send(`/api/guest-spaces/${f.space.id}/items/${f.child.id}/copy`, f.owner.id, {}))
      .status,
  ).toBe(404);
});

test('copy admission stays held after a disconnected request and revoked sessions publish nothing', async () => {
  const f = await fixture();
  const endpoint = `/api/items/${f.original.id}/copy`;
  let release = () => {};
  let started = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  const began = new Promise<void>((done) => {
    started = done;
  });
  const originalLoad = f.load.getMockImplementation()!;
  f.load.mockImplementationOnce(async (...args) => {
    started();
    await held;
    return originalLoad(...args);
  });
  const controller = new AbortController();
  const pending = fetch(f.root + endpoint, {
    method: 'POST',
    headers: f.headers(),
    body: '{}',
    signal: controller.signal,
  }).catch(() => undefined);
  try {
    await began;
    controller.abort();
    await pending;
    expect((await f.send(endpoint, f.owner.id, {})).status).toBe(429);
    release();
    await expect.poll(async () => (await f.send(endpoint, f.operator.id, {})).status).toBe(403);
    // Wait for the aborted materializer to release admission without issuing a
    // second successful copy while polling.
    await expect
      .poll(async () => (await f.send(endpoint, f.owner.id, { name: '' })).status)
      .toBe(400);
    expect(f.workspace.list(f.owner.id).map((item) => item.id)).toEqual([f.original.id]);
    f.load.mockImplementationOnce(async (...args) => {
      const result = await originalLoad(...args);
      f.auth.revokeSession(f.sessions.get(f.owner.id)!.session.token_hash);
      return result;
    });
    expect((await f.send(endpoint, f.owner.id, {})).status).toBe(401);
    expect(f.db.prepare('SELECT count(*) AS n FROM workspace_items').get()!.n).toBe(3);
  } finally {
    release();
  }
});
