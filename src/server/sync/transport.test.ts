import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { hashTouched, materialize } from '@spinel/sync-server';
import type { NativeSnapshot, Touched } from '@spinel/sync-server';
import type { Mutation } from '@spinel/sync-transform';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';

vi.setConfig({ testTimeout: 30_000 });
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
type Frame = {
  type: string;
  revision?: number;
  mutationId?: string;
  duplicate?: boolean;
  reason?: string;
  snapshot?: NativeSnapshot;
  mutations?: Mutation[];
  hash?: string;
  touched?: Touched;
};

async function fixture(enabled = true) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-own-transport-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const filename = join(directory, 'app.sqlite');
  const origin = 'http://localhost:3000';
  const app = await createApp({
    databasePath: filename,
    staticDirectory: directory,
    origin,
    syncServer: enabled,
  });
  const db = openDatabase(filename);
  cleanup.push(() => db.close());
  cleanup.push(() => app.close());
  const sockets: WebSocket[] = [];
  cleanup.push(() => {
    for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Private owner'),
    editor = auth.createUser('Editor'),
    viewer = auth.createUser('Viewer'),
    operator = auth.createUser('Operator', true);
  const sheet = workspace.create(owner.id, {
    kind: 'sheet',
    name: 'Private workbook title',
    parentId: null,
  });
  workspace.share(owner.id, sheet.id, editor.id, 'editor');
  workspace.share(owner.id, sheet.id, viewer.id, 'viewer');
  const sessions = new Map(
    [owner, editor, viewer, operator].map((user) => [user.id, auth.createSession(user.id)]),
  );
  const cookie = (id = owner.id) => `${COOKIE_NAME}=${sessions.get(id)!.token}`;
  const send = (
    path: string,
    credential = cookie(),
    method = 'GET',
    body?: unknown,
    suppliedOrigin = origin,
  ) =>
    fetch(root + path, {
      method,
      headers: {
        Cookie: credential,
        Origin: suppliedOrigin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const prefix = `/sync-api/items/${sheet.id}`;
  const ticket = async (base = prefix, id = sheet.id, credential = cookie()) => {
    const response = await send(`${base}/ticket?unitId=${id}`, credential, 'POST');
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return (await response.json()).ticket as string;
  };
  const connect = async (
    base = prefix,
    id = sheet.id,
    credential = cookie(),
    existing?: string,
  ) => {
    const token = existing ?? (await ticket(base, id, credential));
    const socket = new WebSocket(
      `${root.replace('http:', 'ws:')}${base}/socket?unitId=${id}&ticket=${token}`,
      { headers: { Cookie: credential, Origin: origin } },
    );
    sockets.push(socket);
    const frames: Frame[] = [];
    socket.on('message', (data) => frames.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await expect.poll(() => frames.some((frame) => frame.type === 'snapshot')).toBe(true);
    return { socket, frames };
  };
  const rejectedSocket = async (
    token: string,
    base = prefix,
    id = sheet.id,
    credential = cookie(),
    suppliedOrigin = origin,
  ) => {
    const socket = new WebSocket(
      `${root.replace('http:', 'ws:')}${base}/socket?unitId=${id}&ticket=${token}`,
      { headers: { Cookie: credential, Origin: suppliedOrigin } },
    );
    sockets.push(socket);
    socket.on('error', () => {});
    await expect.poll(() => socket.readyState).toBe(WebSocket.CLOSED);
  };
  const prepare = async () =>
    expect((await send(`/api/items/${sheet.id}/collaboration`, cookie(), 'POST', {})).status).toBe(
      200,
    );
  const mutation = (value: unknown, column = 0, unitId = sheet.id): Mutation => ({
    id: 'sheet.mutation.set-range-values',
    params: { unitId, subUnitId: 'first', cellValue: { 0: { [column]: { v: value } } } },
  });
  return {
    app,
    db,
    auth,
    workspace,
    spaces,
    owner,
    editor,
    viewer,
    operator,
    sheet,
    cookie,
    sessions,
    send,
    prefix,
    ticket,
    connect,
    rejectedSocket,
    prepare,
    mutation,
  };
}

test('the new protocol is disabled by default and requires the flag', async () => {
  const f = await fixture(false);
  expect((await f.send(`${f.prefix}/ticket?unitId=${f.sheet.id}`, f.cookie(), 'POST')).status).toBe(
    404,
  );
  expect(
    f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='spinel_sync_units'").get(),
  ).toBeUndefined();
});

test('two real sockets converge through durable ordering, retry, divergence resync and no duplicate broadcasts', async () => {
  const f = await fixture();
  await f.prepare();
  const a = await f.connect(),
    b = await f.connect(f.prefix, f.sheet.id, f.cookie(f.editor.id));
  const one = {
    type: 'submit',
    mutationId: randomUUID(),
    baseRevision: 1,
    mutations: [f.mutation('First accepted')],
  };
  const two = {
    type: 'submit',
    mutationId: randomUUID(),
    baseRevision: 1,
    mutations: [f.mutation('Other column', 1)],
  };
  a.socket.send(JSON.stringify(one));
  b.socket.send(JSON.stringify(two));
  await expect.poll(() => a.frames.filter((frame) => frame.type === 'edit').length).toBe(2);
  await expect.poll(() => b.frames.filter((frame) => frame.type === 'edit').length).toBe(2);
  const replay = (frames: Frame[]) =>
    frames
      .filter((frame) => frame.type === 'edit')
      .reduce(
        (snapshot, edit) => materialize(snapshot, 'sheet', edit.mutations!),
        frames[0].snapshot!,
      );
  expect(replay(a.frames)).toEqual(replay(b.frames));
  for (const frames of [a.frames, b.frames]) {
    expect(frames.filter((frame) => frame.type === 'edit').map((frame) => frame.revision)).toEqual([
      2, 3,
    ]);
    expect(JSON.stringify(frames)).not.toContain('requestHash');
    expect(JSON.stringify(frames)).not.toContain('beforeCells');
    expect(JSON.stringify(frames)).not.toContain(f.owner.id);
  }
  await expect.poll(() => a.frames.some((frame) => frame.type === 'ack')).toBe(true);
  const receipt = f.db
    .prepare('SELECT revision,mutations FROM spinel_sync_revisions WHERE mutation_id=?')
    .get(one.mutationId)!;
  expect(receipt.revision).toBeGreaterThan(1); // The acknowledgement is observed only after SQLite commit.
  const original = a.frames.find((frame) => frame.type === 'ack')!;
  a.socket.send(JSON.stringify(one));
  await expect.poll(() => a.frames.filter((frame) => frame.type === 'ack').length).toBe(2);
  expect(a.frames.filter((frame) => frame.type === 'ack')[1]).toEqual({
    ...original,
    duplicate: true,
  });
  expect(a.frames.filter((frame) => frame.type === 'edit')).toHaveLength(2);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(2);

  const last = a.frames.filter((frame) => frame.type === 'edit').at(-1)!;
  const hash = hashTouched(replay(a.frames), last.touched!);
  expect(hash).toBe(last.hash);
  a.socket.send(JSON.stringify({ type: 'verify', revision: 3, hash }));
  await expect.poll(() => a.frames.some((frame) => frame.type === 'verified')).toBe(true);
  a.socket.send(JSON.stringify({ type: 'verify', revision: 3, hash: '0'.repeat(64) }));
  await expect
    .poll(() => a.frames.find((frame) => frame.type === 'resync')?.reason)
    .toBe('divergence');
  const current = await f.send(`${f.prefix}/snapshot?unitId=${f.sheet.id}`);
  expect((await current.json()).revision).toBe(3);
  a.socket.close();
  await expect.poll(() => a.socket.readyState).toBe(WebSocket.CLOSED);
  const reconnected = await f.connect();
  reconnected.socket.send(JSON.stringify(one));
  await expect
    .poll(() => reconnected.frames.find((frame) => frame.type === 'ack')?.duplicate)
    .toBe(true);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(2);
});

test('Origin, one-time tickets, operator/viewer boundaries and revoked recipients are enforced over real ingress', async () => {
  const f = await fixture();
  await f.prepare();
  const url = `${f.prefix}/ticket?unitId=${f.sheet.id}`;
  expect((await f.send(url, '', 'POST')).status).toBe(403);
  expect((await f.send(url, f.cookie(f.operator.id), 'POST')).status).toBe(403);
  expect((await f.send(url, f.cookie(), 'POST', undefined, 'https://hostile.example')).status).toBe(
    403,
  );
  const token = await f.ticket();
  await f.rejectedSocket(token, f.prefix, f.sheet.id, f.cookie(), 'https://hostile.example');
  await f.rejectedSocket(token, f.prefix, f.sheet.id, f.cookie(f.editor.id));
  const owner = await f.connect(f.prefix, f.sheet.id, f.cookie(), token);
  await f.rejectedSocket(token);
  const viewer = await f.connect(f.prefix, f.sheet.id, f.cookie(f.viewer.id));
  viewer.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 1,
      mutations: [f.mutation('forged')],
    }),
  );
  await expect.poll(() => viewer.frames.some((frame) => frame.type === 'resync')).toBe(true);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(0);
  const editor = await f.connect(f.prefix, f.sheet.id, f.cookie(f.editor.id));
  f.db
    .prepare('DELETE FROM auth_sessions WHERE token_hash=?')
    .run(f.sessions.get(f.editor.id)!.session.token_hash);
  owner.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 1,
      mutations: [f.mutation('accepted')],
    }),
  );
  await expect.poll(() => owner.frames.some((frame) => frame.type === 'ack')).toBe(true);
  await expect.poll(() => editor.socket.readyState).toBe(WebSocket.CLOSED);
  expect(editor.frames.filter((frame) => frame.type === 'edit')).toHaveLength(0);
  owner.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 2,
      mutations: [f.mutation('cross-document', 0, randomUUID())],
    }),
  );
  await expect.poll(() => owner.frames.some((frame) => frame.type === 'resync')).toBe(true);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(1);
});

test('Space sockets bind root plus child and root rotation fences every child, guest and old ticket', async () => {
  const f = await fixture();
  const space = f.spaces.createRoot(f.owner.id, { name: 'Private Space', parentId: null }).space;
  const sheet = f.spaces.createChild(f.owner.id, space.id, {
    name: 'Sheet',
    kind: 'sheet',
    parentId: space.id,
  }).item;
  const doc = f.spaces.createChild(f.owner.id, space.id, {
    name: 'Doc',
    kind: 'doc',
    parentId: space.id,
  }).item;
  const otherSpace = f.spaces.createRoot(f.owner.id, { name: 'Other', parentId: null }).space;
  f.spaces.share(f.owner.id, space.id, f.editor.id, 'admin');
  const base = (id: string, root = space.id) => `/sync-api/spaces/${root}/items/${id}`;
  for (const item of [sheet, doc])
    expect(
      (
        await f.send(
          `/api/spaces/${space.id}/items/${item.id}/collaboration`,
          f.cookie(),
          'POST',
          {},
        )
      ).status,
    ).toBe(200);
  expect(
    (await f.send(`${base(sheet.id, otherSpace.id)}/ticket?unitId=${sheet.id}`, f.cookie(), 'POST'))
      .status,
  ).toBe(403);
  expect(
    (await f.send(`/sync-api/items/${sheet.id}/ticket?unitId=${sheet.id}`, f.cookie(), 'POST'))
      .status,
  ).toBe(403);
  const sheetSocket = await f.connect(base(sheet.id), sheet.id, f.cookie(f.editor.id));
  const docSocket = await f.connect(base(doc.id), doc.id, f.cookie(f.editor.id));
  const oldTicket = await f.ticket(base(doc.id), doc.id);
  const enabled = await f.send(`/api/items/${space.id}/link`, f.cookie(), 'PUT', {
    role: 'editor',
  });
  expect(enabled.status, await enabled.clone().text()).toBe(200);
  await expect.poll(() => sheetSocket.socket.readyState).toBe(WebSocket.CLOSED);
  await expect.poll(() => docSocket.socket.readyState).toBe(WebSocket.CLOSED);
  await f.rejectedSocket(oldTicket, base(doc.id), doc.id);
  const link = await enabled.json();
  const entered = await f.send(`/api/guest/${space.id}/session`, '', 'POST', {
    token: new URL(link.url).hash.slice(1),
  });
  expect(entered.status).toBe(204);
  const guestCookie = entered.headers.get('set-cookie')!.split(';')[0];
  const guestBase = `/sync-api/guest-spaces/${space.id}/items/${sheet.id}`;
  const guest = await f.connect(guestBase, sheet.id, guestCookie);
  expect(JSON.stringify(guest.frames)).not.toContain(f.owner.name);
  guest.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 1,
      mutations: [f.mutation('guest', 0, sheet.id)],
    }),
  );
  await expect.poll(() => guest.frames.some((frame) => frame.type === 'ack')).toBe(true);
  const rotation = await f.send(`/api/items/${space.id}/link`, f.cookie(), 'PUT', { role: null });
  expect(rotation.status).toBe(200);
  await expect.poll(() => guest.socket.readyState).toBe(WebSocket.CLOSED);
  expect((await f.send(`${guestBase}/snapshot?unitId=${sheet.id}`, guestCookie)).status).toBe(403);
});
