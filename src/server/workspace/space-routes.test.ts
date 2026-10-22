import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { spaceRoutes } from './space-routes.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(spaceReview = true) {
  const db = new DatabaseSync(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const other = auth.createUser('Other');
  const admin = auth.createUser('Operator', true);
  const cookies = new Map(
    [owner, editor, viewer, other, admin].map((user) => [
      user.id,
      `${COOKIE_NAME}=${auth.createSession(user.id).token}`,
    ]),
  );
  const origin = 'http://localhost:3000';
  const app = express();
  app.use('/api/spaces', spaceRoutes(workspace, origin, { spaceReview }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/spaces`;
  const send = (
    path: string,
    actor = owner.id,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    extraHeaders: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        Cookie: cookies.get(actor) ?? '',
        Origin: origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const folder = workspace.create(owner.id, {
    name: 'Private outer folder',
    kind: 'folder',
    parentId: null,
  });
  const space = spaces.createRoot(owner.id, { name: 'Project', parentId: folder.id }).space;
  spaces.share(owner.id, space.id, editor.id, 'editor');
  spaces.share(owner.id, space.id, viewer.id, 'viewer');
  return { db, auth, workspace, spaces, owner, editor, viewer, other, admin, folder, space, send };
}

test('review API is off by default and requires an active everyday session, Origin and strict payload', async () => {
  const closed = await fixture(false);
  expect((await closed.send('/?spaceReview=1')).status).toBe(404);
  expect((await closed.send('', closed.owner.id, { name: 'Hidden', parentId: null })).status).toBe(
    404,
  );
  const f = await fixture();
  expect((await f.send('', 'no-session')).status).toBe(401);
  expect((await f.send('', f.admin.id)).status).toBe(403);
  for (const body of [
    [],
    null,
    { name: 'Wrong', parentId: null, actor: f.owner.id },
    { name: '', parentId: null },
  ])
    expect((await f.send('', f.owner.id, body)).status).toBe(400);
  expect(
    (
      await f.send('', f.owner.id, { name: 'Wrong origin', parentId: null }, 'POST', {
        Origin: 'https://unrelated.invalid',
      })
    ).status,
  ).toBe(403);
  expect((await f.send('/not-an-id')).status).toBe(404);
  expect((await f.send(`/${f.space.id}/sharing`, f.owner.id, {})).status).toBe(404);
  expect((await f.send(`/${f.space.id}`)).headers.get('cache-control')).toBe('no-store');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect((await f.send(`/${f.space.id}`)).status).toBe(401);
});

test('landing lists only authorized roots and owned folder choices without private placement or owner metadata', async () => {
  const f = await fixture();
  const own = f.workspace.create(f.editor.id, {
    name: 'My folder',
    kind: 'folder',
    parentId: null,
  });
  const child = f.spaces.createChild(f.owner.id, f.space.id, {
    name: 'Secret child',
    kind: 'doc',
    parentId: f.space.id,
  }).item;
  // A stale/corrupt child grant must not discover the root or any child metadata.
  f.db
    .prepare("INSERT INTO workspace_grants(item_id,user_id,role) VALUES(?,?,'editor')")
    .run(child.id, f.other.id);
  const received = await (await f.send('', f.editor.id)).json();
  expect(received.spaces).toMatchObject([
    { space: { id: f.space.id, parentId: null }, access: 'editor' },
  ]);
  expect(received.folders).toEqual([{ id: own.id, name: own.name, parentId: null }]);
  expect(JSON.stringify(received)).not.toContain(f.folder.id);
  expect(JSON.stringify(received)).not.toContain(f.folder.name);
  expect(JSON.stringify(received)).not.toContain(f.owner.id);
  expect(JSON.stringify(received)).not.toContain(child.name);
  expect((await (await f.send('', f.other.id)).json()).spaces).toEqual([]);
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
  f.workspace.share(f.owner.id, f.folder.id, f.editor.id, 'viewer');
  expect((await (await f.send('', f.editor.id)).json()).spaces).toMatchObject([
    { access: 'viewer' },
  ]);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect((await (await f.send('', f.editor.id)).json()).spaces).toEqual([]);
});

test('real HTTP create, rename, nested page/Sheet movement and ordering use stable persisted IDs', async () => {
  const f = await fixture();
  const created = await f.send('', f.owner.id, { name: 'New Space', parentId: f.folder.id });
  expect(created.status).toBe(201);
  const { space } = await created.json();
  expect((await (await f.send(`/${space.id}`)).json()).items).toEqual([]);
  const add = async (kind: string, parentId = space.id) => {
    const response = await f.send(`/${space.id}/items`, f.owner.id, {
      name: 'Same name',
      kind,
      parentId,
    });
    expect(response.status).toBe(201);
    return (await response.json()).item;
  };
  const doc = await add('doc');
  const sheet = await add('sheet', doc.id);
  const folder = await add('folder', sheet.id);
  const sibling = await add('doc');
  expect(
    (
      await f.send(
        `/${space.id}/items/${sheet.id}`,
        f.owner.id,
        { parentId: space.id, position: 0, name: 'Budget' },
        'PATCH',
      )
    ).status,
  ).toBe(200);
  const tree = await (await f.send(`/${space.id}`)).json();
  expect(tree.items.map((item: { id: string }) => item.id)).toEqual([
    sheet.id,
    folder.id,
    doc.id,
    sibling.id,
  ]);
  expect(tree.items[0]).toMatchObject({ name: 'Budget', position: 0, parentId: space.id });
  expect(
    (await f.send(`/${space.id}/items/${sheet.id}`, f.owner.id, { parentId: folder.id }, 'PATCH'))
      .status,
  ).toBe(409);
  expect(
    (await f.send(`/${space.id}/items/${doc.id}`, f.owner.id, { parentId: f.space.id }, 'PATCH'))
      .status,
  ).toBe(404);
  expect(
    (
      await f.send(`/${space.id}/items`, f.owner.id, {
        name: 'Bad',
        kind: 'space',
        parentId: space.id,
      })
    ).status,
  ).toBe(400);
  expect(
    f.workspace.list(f.owner.id).some((item) => [space.id, doc.id, sheet.id].includes(item.id)),
  ).toBe(false);
  expect(() => f.workspace.get(f.owner.id, doc.id)).toThrow('not available');
});

test('Edit manages and restores whole subtrees; View gets no recovery data; only Owner confirms the exact fresh deletion set', async () => {
  const f = await fixture();
  const add = (kind: 'doc' | 'sheet' | 'folder', parentId = f.space.id) =>
    f.spaces.createChild(f.owner.id, f.space.id, { name: kind, kind, parentId }).item;
  const original = add('folder');
  const doc = add('doc', original.id);
  const sheet = add('sheet', doc.id);
  const folder = add('folder', sheet.id);
  for (const [path, body, method] of [
    [`/${f.space.id}/items`, { name: 'No', kind: 'doc', parentId: f.space.id }, 'POST'],
    [`/${f.space.id}/items/${doc.id}`, { name: 'No' }, 'PATCH'],
    [`/${f.space.id}/items/${doc.id}`, {}, 'DELETE'],
  ] as const)
    expect((await f.send(path, f.viewer.id, body, method)).status).toBe(403);
  const trashed = await f.send(`/${f.space.id}/items/${doc.id}`, f.editor.id, {}, 'DELETE');
  expect(await trashed.json()).toMatchObject({ count: 3 });
  const listing = await (await f.send(`/${f.space.id}/trash`, f.editor.id)).json();
  expect(listing.items).toMatchObject([
    { id: doc.id, descendantCount: 2, originalLocation: { id: original.id } },
  ]);
  const denied = await f.send(`/${f.space.id}/trash`, f.viewer.id);
  expect(denied.status).toBe(403);
  expect(await denied.text()).not.toContain(doc.name);
  expect((await f.send(`/${f.space.id}/trash/${doc.id}/delete-preview`, f.editor.id)).status).toBe(
    403,
  );
  // An earlier separate tombstone stays independent when its original parent is trashed.
  await f.send(`/${f.space.id}/items/${original.id}`, f.editor.id, {}, 'DELETE');
  const restored = await (
    await f.send(`/${f.space.id}/trash/${doc.id}/restore`, f.editor.id, {})
  ).json();
  expect(restored).toMatchObject({
    item: { id: doc.id, parentId: f.space.id },
    restoredCount: 3,
    destination: 'space-root',
    reason: 'original-location-unavailable',
  });
  const recovered = await (await f.send(`/${f.space.id}`)).json();
  expect(recovered.items.map((item: { id: string }) => item.id)).toEqual([
    doc.id,
    sheet.id,
    folder.id,
  ]);
  await f.send(`/${f.space.id}/items/${doc.id}`, f.editor.id, {}, 'DELETE');
  const preview = await (await f.send(`/${f.space.id}/trash/${doc.id}/delete-preview`)).json();
  expect(preview.counts).toEqual({ total: 3, docs: 1, sheets: 1, folders: 1 });
  expect(preview.items.map((item: { id: string }) => item.id)).toEqual([
    doc.id,
    sheet.id,
    folder.id,
  ]);
  // Merely fetching/cancelling the preview has no destructive effect.
  expect(
    (await (await f.send(`/${f.space.id}/trash`)).json()).items.some(
      (item: { id: string }) => item.id === doc.id,
    ),
  ).toBe(true);
  expect(
    (await f.send(`/${f.space.id}/trash/${doc.id}`, f.owner.id, { version: 'stale' }, 'DELETE'))
      .status,
  ).toBe(409);
  expect(
    (
      await f.send(
        `/${f.space.id}/trash/${doc.id}`,
        f.editor.id,
        { version: preview.version },
        'DELETE',
      )
    ).status,
  ).toBe(403);
  expect(
    await (
      await f.send(
        `/${f.space.id}/trash/${doc.id}`,
        f.owner.id,
        { version: preview.version },
        'DELETE',
      )
    ).json(),
  ).toEqual({ count: 3 });
  expect((await (await f.send(`/${f.space.id}/trash`)).json()).items).toMatchObject([
    { id: original.id },
  ]);
});

test('current downgrade, revocation and root trash apply to subsequent tree/recovery requests', async () => {
  const f = await fixture();
  const child = f.spaces.createChild(f.owner.id, f.space.id, {
    name: 'Page',
    kind: 'doc',
    parentId: f.space.id,
  }).item;
  expect((await f.send(`/${f.space.id}`, f.editor.id)).status).toBe(200);
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
  expect(
    (await f.send(`/${f.space.id}/items/${child.id}`, f.editor.id, { name: 'Denied' }, 'PATCH'))
      .status,
  ).toBe(403);
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
  expect((await f.send(`/${f.space.id}`, f.editor.id)).status).toBe(404);
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
    .run('outer', f.folder.id);
  expect((await f.send(`/${f.space.id}`)).status).toBe(404);
  expect((await f.send(`/${f.space.id}/trash`)).status).toBe(404);
});
