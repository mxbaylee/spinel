import express from 'express';
import type { AddressInfo } from 'node:net';
import { expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { workspaceRoutes } from './routes.ts';
import { spaceNativeRoutes } from './space-native-routes.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { guestCookieName } from './links.ts';
import type { CollaborationStore } from '../collaboration/service.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('copy HTTP is account-only, scoped, origin-bound and atomic across disconnect or lost acknowledgement', async () => {
  const db = new DatabaseSync(':memory:');
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    viewer = auth.createUser('Viewer'),
    operator = auth.createUser('Operator', true);
  const source = workspace.create(owner.id, { name: 'Original', kind: 'doc', parentId: null });
  workspace.share(owner.id, source.id, viewer.id, 'viewer');
  const spaces = new SpaceStore(workspace);
  const space = spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space;
  const child = spaces.createChild(owner.id, space.id, {
    name: 'Native page',
    kind: 'doc',
    parentId: space.id,
  }).item;
  spaces.share(owner.id, space.id, viewer.id, 'viewer');
  let hold: ReturnType<typeof deferred> | undefined;
  let entered = deferred(),
    settled = deferred();
  const collaboration = {
    prepare: async () => {},
    load: async (_user: string, id: string) => {
      entered.resolve();
      await hold?.promise;
      settled.resolve();
      return { snapshot: { id, body: { dataStream: 'Confirmed current text\r\n' } } };
    },
    generations: { active: (id: string) => ({ unitId: id }), restoring: () => false },
  } as unknown as CollaborationStore;
  const app = express();
  // A controlled response loss happens after the atomic service has returned.
  app.use((request, response, next) => {
    if (request.headers['x-test-drop-response'])
      response.json = () => {
        response.destroy();
        return response;
      };
    next();
  });
  const origin = 'http://localhost:3000';
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
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = (user: string) => `${COOKIE_NAME}=${auth.createSession(user).token}`;
  const viewerCookie = cookie(viewer.id);
  const headers = { Cookie: viewerCookie, Origin: origin, 'Content-Type': 'application/json' };
  const send = (
    path: string,
    supplied: Record<string, string> = headers,
    body = '{}',
    signal?: AbortSignal,
  ) => fetch(base + path, { method: 'POST', headers: supplied, body, signal });
  const endpoint = `/api/items/${source.id}/copy`;
  const count = () => Number(db.prepare('SELECT count(*) AS n FROM workspace_items').get()!.n);
  try {
    for (const [credential, status] of [
      ['', 401],
      [cookie(operator.id), 403],
    ] as const)
      expect((await send(endpoint, { ...headers, Cookie: credential })).status).toBe(status);
    expect((await send(endpoint, { ...headers, Origin: 'https://wrong.example' })).status).toBe(
      403,
    );
    expect((await send(endpoint, headers, '{bad')).status).toBe(400);
    expect((await send(endpoint, headers, JSON.stringify({ sourceId: child.id }))).status).toBe(
      400,
    );
    expect((await send(endpoint, headers, JSON.stringify({ name: 'x'.repeat(9000) }))).status).toBe(
      413,
    );
    const response = await send(endpoint);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { item } = await response.json();
    expect(item).toMatchObject({ access: 'owner', parentId: null, name: 'Original (copy)' });
    expect(workspace.fileOwner(item.id)).toBe(viewer.id);
    const scoped = await send(`/api/spaces/${space.id}/items/${child.id}/copy`);
    expect(scoped.status).toBe(201);
    expect((await scoped.json()).item.parentId).toBeNull();
    expect((await send(`/api/items/${child.id}/copy`)).status).toBe(404);
    expect((await send(`/api/spaces/${space.id}/items/${source.id}/copy`)).status).toBe(404);
    const link = workspace.links.begin(space.id, 'editor');
    workspace.links.finish(space.id, link.epoch, true);
    const guest = workspace.links.exchange(space.id, link.token);
    const guestHeaders = { ...headers, Cookie: `${guestCookieName(space.id)}=${guest.token}` };
    expect(
      (await send(`/api/guest-spaces/${space.id}/items/${child.id}/copy`, guestHeaders)).status,
    ).toBe(404);
    expect(
      (await send(`/api/spaces/${space.id}/items/${child.id}/copy`, guestHeaders)).status,
    ).toBe(401);

    const before = count();
    hold = deferred();
    entered = deferred();
    settled = deferred();
    const controller = new AbortController();
    const pending = send(endpoint, headers, '{}', controller.signal);
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    controller.abort();
    await cancelled;
    // A cancelled client cannot release the still-running materializer's transfer slot.
    expect((await send(endpoint)).status).toBe(429);
    hold.resolve();
    await settled.promise;
    hold = undefined;
    await vi.waitFor(async () => {
      const invalid = await send(endpoint, headers, JSON.stringify({ name: '' }));
      expect(invalid.status).toBe(400);
    });
    expect(count()).toBe(before);

    await expect(send(endpoint, { ...headers, 'x-test-drop-response': '1' })).rejects.toThrow();
    // The response is uncertain, not an invitation to replay the mutation automatically.
    expect(count()).toBe(before + 1);
    const copied = db
      .prepare('SELECT id FROM workspace_items WHERE owner_id=? AND name=?')
      .all(viewer.id, 'Original (copy)');
    expect(copied).toHaveLength(2); // the earlier acknowledged copy plus this lost acknowledgement
  } finally {
    hold?.resolve();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    db.close();
  }
}, 20000);
