import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import sharp from 'sharp';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { guestCookieName } from '../workspace/links.ts';
import { appearanceRoutes } from './routes.ts';
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const db = new DatabaseSync(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    viewer = auth.createUser('Viewer'),
    operator = auth.createUser('Operator', true);
  const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
  const ownerCookie = cookie(owner.id),
    viewerCookie = cookie(viewer.id),
    operatorCookie = cookie(operator.id);
  const item = workspace.create(owner.id, { name: 'Private Doc', kind: 'doc', parentId: null });
  workspace.share(owner.id, item.id, viewer.id, 'viewer');
  const app = express();
  app.use('/api/appearance', appearanceRoutes(workspace, 'http://spinel.example'));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/appearance`;
  const send = (
    path: string,
    body?: unknown,
    credential = ownerCookie,
    origin = 'http://spinel.example',
  ) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'PATCH',
      headers: {
        Cookie: credential,
        Origin: origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    db,
    auth,
    workspace,
    owner,
    viewer,
    item,
    send,
    ownerCookie,
    viewerCookie,
    operatorCookie,
  };
}
test('HTTP ingress rejects missing credentials, Operator, forged origin and viewer writes without changing appearance', async () => {
  const f = await fixture(),
    path = `/items/${f.item.id}`;
  expect((await f.send(path, undefined, '')).status).toBe(401);
  expect((await f.send(path, undefined, f.operatorCookie)).status).toBe(401);
  expect(
    (await f.send(path, { revision: 0, icon: '🌷' }, f.ownerCookie, 'https://other.example'))
      .status,
  ).toBe(403);
  expect((await f.send(path, { revision: 0, icon: '🌷' }, f.viewerCookie)).status).toBe(403);
  const read = await f.send(path);
  expect(read.headers.get('cache-control')).toBe('no-store');
  expect((await read.json()).appearance.revision).toBe(0);
  expect((await f.send(path, { revision: 0, icon: '🌷' })).status).toBe(200);
  expect((await f.send(path, { revision: 0, icon: '🍋' })).status).toBe(409);
});
test('uploaded assets recheck item and link access, carry no-store/nosniff, and cannot cross Space roots', async () => {
  const f = await fixture(),
    spaces = new SpaceStore(f.workspace);
  const root = spaces.createRoot(f.owner.id, { name: 'Space', parentId: null }).space;
  const child = spaces.createChild(f.owner.id, root.id, {
    name: 'Page',
    kind: 'doc',
    parentId: root.id,
  }).item;
  const other = spaces.createRoot(f.owner.id, { name: 'Other', parentId: null }).space;
  const link = f.workspace.links.begin(root.id, 'editor');
  f.workspace.links.finish(root.id, link.epoch, true);
  const session = f.workspace.links.exchange(root.id, link.token);
  const cookie = `${guestCookieName(root.id)}=${session.token}`;
  const path = `/guest/spaces/${root.id}/items/${child.id}`;
  const data = (
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'pink' } })
      .png()
      .toBuffer()
  ).toString('base64');
  const response = await f.send(
    path,
    { revision: 0, cover: { source: 'upload', images: { shared: { data } }, position: 50 } },
    cookie,
  );
  expect(response.status).toBe(200);
  const hash = (await response.json()).appearance.cover.images.shared;
  const asset = await f.send(`${path}/assets/${hash}`, undefined, cookie);
  expect(asset.status).toBe(200);
  expect(asset.headers.get('cache-control')).toBe('no-store');
  expect(asset.headers.get('x-content-type-options')).toBe('nosniff');
  expect(asset.headers.get('content-type')).toContain('image/webp');
  expect((await f.send(`/spaces/${other.id}/items/${child.id}/assets/${hash}`)).status).toBe(404);
  expect((await f.send(`/items/${child.id}/assets/${hash}`)).status).toBe(404);
  expect(
    (
      await f.send(
        `/guest/spaces/${root.id}/items/${root.id}`,
        { revision: 0, accent: 'ruby' },
        cookie,
      )
    ).status,
  ).toBe(403);
  f.workspace.links.begin(root.id, null);
  expect((await f.send(`${path}/assets/${hash}`, undefined, cookie)).ok).toBe(false);
});
