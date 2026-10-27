import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import sharp from 'sharp';
import { LocaleType } from '@univerjs/core';
import { SyncServer } from '@spinel/sync-server';
import { SpaceRecoveryStore } from '../workspace/space-recovery.ts';
import { SpaceLifecycleStore } from '../workspace/space-lifecycle.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { transportFixture } from './transport.fixture.ts';

test('explicitly disabled Spaces refuse metadata, preparation and every native protocol entry', async () => {
  const f = await transportFixture({ space: true, spacesEnabled: false });
  const space = f.space!;
  for (const path of ['/review/spaces', `/review/spaces/${space.id}?spaceReview=1`]) {
    const response = await f.send(path);
    expect(response.status, path).toBe(404);
    expect(await response.text()).not.toContain('Fixture');
  }
  for (const path of [
    f.api(),
    `${f.base()}/ticket?unitId=${f.sheet.id}`,
    `${f.base()}/snapshot?unitId=${f.sheet.id}`,
  ]) {
    const response = await f.send(path, f.cookie(), path.includes('/ticket') ? {} : undefined);
    expect(response.status, path).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain(f.sheet.name);
  }
  expect((await f.send(f.api() + '/collaboration', f.cookie(), {})).status).toBeGreaterThanOrEqual(
    400,
  );
  // A disabled feature's 404 still cannot authorize deleting another account's
  // prepared child when this tab observes a newly switched cookie.
  for (const user of [f.editor, f.operator])
    for (const suffix of ['/collaboration', '/offline-bundle']) {
      const response = await fetch(f.root + f.api() + suffix, {
        method: suffix === '/collaboration' ? 'POST' : 'GET',
        headers: {
          Cookie: f.cookie(user.id),
          Origin: f.origin,
          'Content-Type': 'application/json',
          'X-Spinel-Offline-Account': f.owner.id,
        },
        ...(suffix === '/collaboration' ? { body: '{}' } : {}),
      });
      expect(response.status).toBe(409);
    }
}, 20_000);

test('scoped native HTTP integrations retain ordinary-route denial and exact child permissions', async () => {
  const f = await transportFixture({ space: true });
  const space = f.space!;
  for (const path of ['/review/spaces', `/review/spaces/${space.id}?spaceReview=1`]) {
    const response = await f.send(path);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Fixture');
  }
  for (const item of [f.sheet, f.doc]) {
    await f.prepare(item.id, f.cookie(f.editor.id));
    for (const user of [f.owner, f.editor, f.viewer]) {
      const metadata = await f.send(f.api(item.id), f.cookie(user.id));
      expect(metadata.status).toBe(200);
      expect(metadata.headers.get('cache-control')).toBe('no-store');
      expect(await metadata.json()).toMatchObject({
        item: { id: item.id },
        live: { unitId: item.id },
      });
      const response = await f.snapshot(item.id, f.cookie(user.id));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(item.name);
    }
    expect((await f.send(`/api/items/${item.id}`)).status).toBe(404);
    for (const prefix of [`/sync-api/items/${item.id}`, `/sync-api/guest/${item.id}`])
      expect((await f.send(`${prefix}/ticket?unitId=${item.id}`, f.cookie(), {})).status).toBe(403);
    for (const suffix of ['/history', '/export', '/offline-bundle'])
      expect((await f.send(f.api(item.id) + suffix)).status, suffix).toBe(200);
    expect((await f.send(f.api(item.id) + '/images/secret')).status).toBeGreaterThanOrEqual(400);
    expect((await f.send(f.api(item.id) + '/formulas/sources')).status).toBe(
      item.kind === 'doc' ? 200 : 400,
    );
  }
  expect((await f.send(f.api(), '')).status).toBe(401);
  expect((await f.send(f.api(), f.cookie(f.operator.id))).status).toBeGreaterThanOrEqual(400);
  expect(
    (
      await f.send(f.api() + '/collaboration', f.cookie(), {
        spaceId: space.id,
        spaceItem: f.sheet.id,
      })
    ).status,
  ).toBe(400);
  const wrong = await f.snapshot(f.doc.id, f.cookie(), f.sheet.id);
  expect(wrong.status).toBe(403);
  expect(await wrong.text()).not.toContain(f.sheet.name);
  // The removed SDK permission RPC cannot accept forged namespace credentials.
  for (const prefix of [
    '/universer-api',
    `/space-api/${space.id}/items/${f.sheet.id}/universer-api`,
  ]) {
    const denied = await f.send(prefix + '/authz/-/object/-/batch_allowed', f.cookie(), {
      customData: {
        spaceId: space.id,
        spaceItem: f.sheet.id,
        sessionHash: f.sessions.get(f.owner.id)!.session.token_hash,
      },
      requests: [{ unitID: f.sheet.id, objectID: f.sheet.id, actions: [0, 1] }],
    });
    expect(denied.status).toBeGreaterThanOrEqual(400);
  }
}, 30_000);

test.each(['editor', 'admin'] as const)(
  'Space %s sockets bind the exact root/child and evict changed grants before any later broadcast',
  async (role) => {
    const f = await transportFixture({ space: true, role });
    const space = f.space!;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await f.prepare();
    await f.prepare(f.doc.id);
    const mismatch = await f.open({
      id: f.doc.id,
      ticket: await f.ticket({ credential: f.cookie(f.editor.id) }),
      credential: f.cookie(f.editor.id),
    });
    expect(mismatch.status).toBe(403);
    expect(mismatch.messages).toEqual([]);
    const viewer = await f.connect({ credential: f.cookie(f.viewer.id) });
    const before = await (await f.snapshot()).text();
    expect((await f.submit(viewer, 'viewer cannot persist this'))?.type).toBe('resync');
    expect(await (await f.snapshot()).text()).toBe(before);
    viewer.socket.send(JSON.stringify({ type: 'join', unitId: f.doc.id }));
    await expect
      .poll(() =>
        viewer.messages.some((frame) => frame.type === 'resync' && frame.reason === 'malformed'),
      )
      .toBe(true);
    expect(JSON.stringify(viewer.messages)).not.toContain(f.doc.name);
    const owner = await f.connect();
    const editor = await f.connect({ credential: f.cookie(f.editor.id) });
    f.spaces.share(f.owner.id, space.id, f.editor.id, 'viewer');
    expect((await f.submit(owner, 'Authorized after downgrade'))?.type).toBe('ack');
    await expect.poll(() => editor.socket.readyState).toBe(WebSocket.CLOSED);
    expect(await (await f.snapshot()).text()).toContain('Authorized after downgrade');
    expect(JSON.stringify(editor.messages)).not.toContain('Authorized after downgrade');
    const recovery = new SpaceRecoveryStore(f.workspace);
    const lifecycle = new SpaceLifecycleStore(f.workspace);
    for (const change of [
      'revoke',
      'child-trash',
      'root-trash',
      'disabled-owner',
      'disabled-editor',
    ] as const) {
      f.spaces.share(f.owner.id, space.id, f.editor.id, role);
      const client = await f.connect({ credential: f.cookie(f.editor.id) });
      const unused = await f.ticket({ credential: f.cookie(f.editor.id) });
      if (change === 'revoke') f.spaces.share(f.owner.id, space.id, f.editor.id, null);
      if (change === 'child-trash') recovery.trash(f.owner.id, space.id, f.sheet.id);
      if (change === 'root-trash') lifecycle.trash(f.owner.id, space.id);
      if (change === 'disabled-owner')
        f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
      if (change === 'disabled-editor')
        f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
      await f.submit(client, 'Stale edit must not persist', 2);
      await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
      expect((await f.snapshot(f.sheet.id, f.cookie(f.editor.id))).status).toBe(403);
      expect((await f.open({ credential: f.cookie(f.editor.id), ticket: unused })).status).toBe(
        403,
      );
      if (change === 'child-trash') recovery.restore(f.owner.id, space.id, f.sheet.id);
      if (change === 'root-trash') lifecycle.restore(f.owner.id, space.id);
      f.db
        .prepare('UPDATE auth_users SET disabled=0 WHERE id IN (?,?)')
        .run(f.owner.id, f.editor.id);
      expect(await (await f.snapshot()).text()).not.toContain('Stale edit must not persist');
    }
    f.spaces.share(f.owner.id, space.id, f.editor.id, role);
    const client = await f.connect({ credential: f.cookie(f.editor.id) });
    f.auth.revokeSession(f.sessions.get(f.editor.id)!.session.token_hash);
    await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
    expect((await f.snapshot(f.sheet.id, f.cookie(f.editor.id))).status).toBe(403);
  },
  45_000,
);

test('a rotated generation provides scoped native snapshots and ordered replay while old units and revoked unused tickets stay fenced', async () => {
  const f = await transportFixture({ space: true });
  const space = f.space!;
  const item = f.workspace.create(f.owner.id, {
    kind: 'sheet',
    name: 'Rotated native sheet',
    parentId: null,
  });
  new SheetStore(f.workspace).save(f.owner.id, item.id, {
    snapshot: {
      id: item.id,
      name: item.name,
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      sheetOrder: ['first'],
      styles: {},
      sheets: {
        first: {
          id: 'first',
          name: 'Retained tab',
          rowCount: 10,
          columnCount: 10,
          cellData: { 0: { 0: { v: 'Retained native cell' } } },
        },
      },
    },
    revision: 0,
    writeId: randomUUID(),
  });
  await f.prepare(item.id, f.cookie(), `/api/items/${item.id}`);
  const named = await f.send(`/api/items/${item.id}/history`, f.cookie(), {
    name: 'Existing native checkpoint',
  });
  expect(named.status).toBe(201);
  const checkpoint = (await named.json()).version.id as string;
  const restored = await f.send(`/api/items/${item.id}/history/${checkpoint}/restore`, f.cookie(), {
    unitId: item.id,
    requestId: randomUUID(),
  });
  expect(restored.status).toBe(200);
  const unitId = (await restored.json()).unitId as string;
  expect(unitId).not.toBe(item.id);
  // Storage fixture verifies existing generations survive root membership intact.
  f.db
    .prepare('UPDATE workspace_items SET parent_id=?,space_id=?,space_position=1 WHERE id=?')
    .run(space.id, space.id, item.id);
  expect(await f.prepare(item.id)).toMatchObject({ unitId });
  const response = await f.snapshot(item.id, f.cookie(f.viewer.id), unitId);
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data).toMatchObject({
    version: 1,
    unitId,
    revision: 1,
    snapshot: {
      id: unitId,
      name: item.name,
      sheets: { first: { cellData: { 0: { 0: { v: 'Retained native cell' } } } } },
    },
  });
  const owner = await f.connect({ id: item.id, unitId });
  expect(
    (await f.submit(owner, 'Saved on the live rotated generation', data.revision, unitId))?.type,
  ).toBe('ack');
  const resumed = await f.connect({
    id: item.id,
    unitId,
    credential: f.cookie(f.viewer.id),
    afterRevision: data.revision,
  });
  expect(resumed.messages.find((frame) => frame.type === 'resume')).toMatchObject({
    fromRevision: 1,
    revision: 2,
    edits: [
      {
        revision: 2,
        mutations: [
          expect.objectContaining({
            id: 'sheet.mutation.set-range-values',
            params: {
              unitId,
              subUnitId: 'first',
              cellValue: { 0: { 0: { v: 'Saved on the live rotated generation' } } },
            },
          }),
        ],
      },
    ],
  });
  for (const prefix of [f.base(f.doc.id), `/sync-api/items/${item.id}`]) {
    const denied = await f.snapshot(item.id, f.cookie(), unitId, prefix);
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('Retained native');
  }
  expect((await f.snapshot(item.id, f.cookie(), item.id)).status).toBe(403);
  expect((await f.send(`${f.base(item.id)}/ticket?unitId=${item.id}`, f.cookie(), {})).status).toBe(
    403,
  );
  const unused = await f.ticket({ id: item.id, unitId, credential: f.cookie(f.editor.id) });
  f.spaces.share(f.owner.id, space.id, f.editor.id, null);
  const revoked = await f.open({
    id: item.id,
    unitId,
    credential: f.cookie(f.editor.id),
    ticket: unused,
  });
  expect(revoked.status).toBe(403);
  expect(revoked.messages).toEqual([]);
  expect(
    f.db.prepare('SELECT id FROM history_checkpoints WHERE id=?').get(checkpoint),
  ).toMatchObject({ id: checkpoint });
}, 30_000);

test('native initial subscription rechecks the root epoch before publishing a snapshot or personal presence', async () => {
  const f = await transportFixture({ space: true });
  const space = f.space!;
  await f.prepare(f.doc.id);
  const ticket = await f.ticket({ id: f.doc.id });
  const original = SyncServer.prototype.load;
  let rotated = false;
  const read = vi.spyOn(SyncServer.prototype, 'load').mockImplementation(function (
    this: SyncServer<unknown>,
    unitId,
    context,
  ) {
    const result = original.call(this, unitId, context);
    if (!rotated && unitId === f.doc.id) {
      rotated = true;
      f.workspace.links.begin(space.id, 'viewer');
    }
    return result;
  });
  // The new protocol has no asynchronous JOIN. Inject the change at its final
  // read/publication boundary to prove the final check, rather than retain a fake JOIN.
  const client = await f.open({ id: f.doc.id, ticket });
  expect(client.status).toBe(101);
  await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
  expect(rotated).toBe(true);
  expect(client.messages).toEqual([]);
  expect(
    (await f.send(`${f.base(f.doc.id)}/ticket?unitId=${f.doc.id}`, f.cookie(), {})).status,
  ).toBe(403);
  read.mockRestore();
}, 30_000);

test('one Space guest capability covers its current and future children, with private metadata, images and root-wide revocation', async () => {
  const f = await transportFixture({ space: true });
  const space = f.space!;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const guestBase = (id: string) => `/sync-api/guest-spaces/${space.id}/items/${id}`;
  const guestApi = (id: string) => `/api/guest-spaces/${space.id}/items/${id}`;
  const treePath = `/api/guest-spaces/${space.id}`;
  const link = async (role: 'editor' | 'viewer' | null) => {
    const response = await f.send(`/api/items/${space.id}/link`, f.cookie(), { role }, 'PUT');
    expect(response.status).toBe(200);
    return response.json() as Promise<{ url: string | null }>;
  };
  const exchange = async (url: string) => {
    const response = await f.send(`/api/guest/${space.id}/session`, '', {
      token: new URL(url).hash.slice(1),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  for (const item of [f.sheet, f.doc]) await f.prepare(item.id);
  const unrelated = f.workspace.create(f.owner.id, {
    kind: 'sheet',
    name: 'Unrelated',
    parentId: null,
  });
  await f.prepare(unrelated.id, f.cookie(), `/api/items/${unrelated.id}`);
  const independent = await f.connect({
    id: unrelated.id,
    prefix: `/sync-api/items/${unrelated.id}`,
  });
  const personal = await f.connect();
  const accountDoc = await f.connect({ id: f.doc.id });
  const unusedAccountTicket = await f.ticket({ id: f.doc.id });
  const credential = await exchange((await link('editor')).url!);
  for (const client of [personal, accountDoc])
    await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
  expect(independent.socket.readyState).toBe(WebSocket.OPEN);
  expect((await f.open({ id: f.doc.id, ticket: unusedAccountTicket })).status).toBe(403);
  const mixed = credential + '; ' + f.cookie(f.operator.id);
  expect(await (await f.send(`/api/guest/${space.id}`, mixed)).json()).toEqual({
    item: { id: space.id, kind: 'space', name: space.name, access: 'editor' },
  });
  const tree = await (await f.send(treePath, mixed)).json();
  expect(tree.space.parentId).toBeNull();
  expect(tree.access).toBe('editor');
  expect(tree.items.map((item: { id: string }) => item.id)).toEqual([f.sheet.id, f.doc.id]);
  expect(JSON.stringify(tree)).not.toContain(space.parentId);
  expect(JSON.stringify(tree)).not.toMatch(
    /ownerId|ownerName|sessionHash|guestHash|profile-avatar/,
  );
  const future = await f.send(treePath + '/items', mixed, {
    kind: 'doc',
    name: 'Guest-created page',
    parentId: space.id,
  });
  expect(future.status).toBe(201);
  const futureId = (await future.json()).item.id as string;
  const prepared = await f.send(guestApi(futureId) + '/collaboration', mixed, {});
  expect(prepared.status).toBe(200);
  expect(await prepared.json()).toMatchObject({
    access: 'editor',
    user: { name: 'Guest' },
    syncVersion: 1,
  });
  expect((await f.send(guestApi(f.doc.id) + '/formulas/sources', mixed)).status).toBe(200);
  for (const path of [
    treePath + '/trash',
    treePath + '/trash/' + f.doc.id + '/restore',
    ...['/history', '/export', '/offline-bundle', '/sharing', '/link'].map(
      (suffix) => guestApi(f.doc.id) + suffix,
    ),
  ])
    expect((await f.send(path, mixed)).status, path).toBeGreaterThanOrEqual(400);
  expect((await f.send('/api/items', credential)).status).toBe(401);
  expect((await f.send(f.api(f.doc.id), credential)).status).toBe(401);
  for (const id of [f.sheet.id, unrelated.id])
    expect((await f.snapshot(f.doc.id, mixed, id, guestBase(f.doc.id))).status).toBe(403);
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#aa33bb' } })
    .png()
    .toBuffer();
  const upload = await fetch(f.root + guestApi(f.doc.id) + '/images', {
    method: 'POST',
    headers: { Cookie: mixed, Origin: f.origin, 'Content-Type': 'image/png' },
    body: bytes,
  });
  expect(upload.status).toBe(201);
  const image = await upload.json();
  expect(image.url).toBe(`/api/items/${f.doc.id}/images/${image.id}`);
  expect(Buffer.from(await (await f.send(image.url, mixed)).arrayBuffer())).toEqual(bytes);
  expect((await f.send(`/api/items/${futureId}/images/${image.id}`, mixed)).status).toBe(404);
  expect(
    new DocumentStore(f.workspace).image(f.owner.id, f.doc.id, image.id, {
      sessionHash: f.sessions.get(f.owner.id)!.session.token_hash,
      spaceId: space.id,
      spaceItem: f.doc.id,
    }).data.byteLength,
  ).toBe(bytes.length);
  const guestSheet = await f.connect({ prefix: guestBase(f.sheet.id), credential: mixed });
  const guestDoc = await f.connect({
    id: f.doc.id,
    prefix: guestBase(f.doc.id),
    credential: mixed,
  });
  const anonymousAccount = await f.connect();
  expect(JSON.stringify(guestSheet.messages)).not.toContain(f.owner.name);
  expect(JSON.stringify(guestSheet.messages)).not.toContain('profile-avatar');
  await expect.poll(() => JSON.stringify(anonymousAccount.messages)).toContain('Guest');
  const unusedGuest = await f.ticket({
    id: futureId,
    prefix: guestBase(futureId),
    credential: mixed,
  });
  const viewerCookie = await exchange((await link('viewer')).url!);
  for (const client of [guestSheet, guestDoc, anonymousAccount])
    await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
  expect(independent.socket.readyState).toBe(WebSocket.OPEN);
  expect(
    (await f.send(guestApi(f.doc.id) + '/collaboration', credential + '; ' + f.cookie(), {}))
      .status,
  ).toBeGreaterThanOrEqual(400);
  expect((await f.send(image.url, credential + '; ' + f.cookie())).status).toBe(200);
  expect(
    (
      await f.open({
        id: futureId,
        prefix: guestBase(futureId),
        credential: viewerCookie,
        ticket: unusedGuest,
      })
    ).status,
  ).toBe(403);
  const viewer = await f.connect({ prefix: guestBase(f.sheet.id), credential: viewerCookie });
  expect(
    (
      await f.send(treePath + '/items', viewerCookie, {
        kind: 'doc',
        name: 'Denied',
        parentId: space.id,
      })
    ).status,
  ).toBe(403);
  const before = await (await f.snapshot()).text();
  expect((await f.submit(viewer, 'Denied viewer'))?.type).toBe('resync');
  expect(
    (await f.submit(viewer, 'Denied forged owner', 1, f.sheet.id, { userID: f.owner.id }))?.type,
  ).toBe('resync');
  expect(await (await f.snapshot()).text()).toBe(before);
  await link(null);
  await expect.poll(() => viewer.socket.readyState).toBe(WebSocket.CLOSED);
  expect(
    (await f.send(guestApi(f.doc.id), viewerCookie + '; ' + f.cookie())).status,
  ).toBeGreaterThanOrEqual(400);
  expect(independent.socket.readyState).toBe(WebSocket.OPEN);
}, 60_000);
