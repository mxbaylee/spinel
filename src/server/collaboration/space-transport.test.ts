import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { CombCmd, CmdRspCode, UnitAction, UniverType } from '@univerjs/protocol';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { SpaceRecoveryStore } from '../workspace/space-recovery.ts';
import { SpaceLifecycleStore } from '../workspace/space-lifecycle.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(spaceReview: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-space-transport-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const filename = join(directory, 'app.sqlite'),
    origin = 'http://localhost:3000';
  const app = await createApp({
    databasePath: filename,
    staticDirectory: directory,
    origin,
    spaceReview,
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
  const owner = auth.createUser('Owner'),
    editor = auth.createUser('Editor'),
    viewer = auth.createUser('Viewer'),
    operator = auth.createUser('Operator', true);
  const folder = workspace.create(owner.id, {
    name: 'Outside project',
    kind: 'folder',
    parentId: null,
  });
  const space = spaces.createRoot(owner.id, { name: 'Review Space', parentId: folder.id }).space;
  const sheet = spaces.createChild(owner.id, space.id, {
    name: 'Private sheet',
    kind: 'sheet',
    parentId: space.id,
  }).item;
  const doc = spaces.createChild(owner.id, space.id, {
    name: 'Private doc',
    kind: 'doc',
    parentId: sheet.id,
  }).item;
  spaces.share(owner.id, space.id, editor.id, 'editor');
  spaces.share(owner.id, space.id, viewer.id, 'viewer');
  const sessions = new Map(
    [owner, editor, viewer, operator].map((user) => [user.id, auth.createSession(user.id)]),
  );
  const cookie = (user = owner.id) => `${COOKIE_NAME}=${sessions.get(user)!.token}`;
  const base = (id = sheet.id, spaceId = space.id) =>
    `/space-api/${spaceId}/items/${id}/universer-api`;
  const api = (id = sheet.id) => `/api/spaces/${space.id}/items/${id}`;
  const send = (
    path: string,
    credential = cookie(),
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
  const snapshot = (id = sheet.id, credential = cookie()) =>
    send(
      `${base(id)}/snapshot/${id === sheet.id ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC}/unit/${id}/rev/0`,
      credential,
    );
  const ticket = async (user = editor.id, id = sheet.id) => {
    const response = await send(`${base(id)}/user/session-ticket?unitID=${id}`, cookie(user));
    expect(response.status).toBe(200);
    return (await response.json()).ticket as string;
  };
  const open = async (user = editor.id, id = sheet.id, existingTicket?: string) => {
    const token = existingTicket ?? (await ticket(user, id));
    const socket = new WebSocket(
      `${root.replace('http:', 'ws:')}${base(id)}/comb/connect?sessionTicket=${encodeURIComponent(token)}&unitID=${id}`,
      { headers: { Cookie: cookie(user), Origin: origin } },
    );
    sockets.push(socket);
    const messages: {
      cmd: number;
      code?: number;
      infoRsp?: { memberID: string };
      collaMsg?: { eventID: string };
    }[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    const status = await new Promise<number>((resolve, reject) => {
      socket.once('open', () => resolve(101));
      socket.once('error', reject);
      socket.once('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode!);
      });
    });
    return { socket, messages, status };
  };
  const connect = async (user = editor.id, id = sheet.id) => {
    const client = await open(user, id);
    expect(client.status).toBe(101);
    client.socket.send(JSON.stringify({ cmd: CombCmd.HELLO, routeKey: '', routeType: '' }));
    await expect
      .poll(
        () => client.messages.find((message) => message.cmd === CombCmd.HELLO)?.infoRsp?.memberID,
      )
      .toBeTypeOf('string');
    const memberID = client.messages.find((message) => message.cmd === CombCmd.HELLO)!.infoRsp!
      .memberID;
    client.socket.send(
      JSON.stringify({
        cmd: CombCmd.JOIN,
        routeKey: id,
        routeType: '',
        joinReq: { rooms: [{ roomID: id }] },
      }),
    );
    await expect
      .poll(() => client.messages.find((message) => message.cmd === CombCmd.JOIN)?.code)
      .toBe(CmdRspCode.OK);
    return { ...client, memberID };
  };
  const submit = (user: string, memberID: string, value: string, baseRev = 1) =>
    send(`${base()}/comb/${UniverType.UNIVER_SHEET}/unit/${sheet.id}/new_changes`, cookie(user), {
      unitID: sheet.id,
      type: UniverType.UNIVER_SHEET,
      memberID,
      changeset: {
        unitID: sheet.id,
        type: UniverType.UNIVER_SHEET,
        userID: user,
        memberID,
        sid: 'space-transport',
        reqId: baseRev,
        baseRev,
        revision: 0,
        mutations: [
          {
            id: SetRangeValuesMutation.id,
            data: JSON.stringify({
              unitId: sheet.id,
              subUnitId: 'first',
              cellValue: { 0: { 0: { v: value } } },
            }),
          },
        ],
      },
    });
  return {
    db,
    auth,
    workspace,
    spaces,
    space,
    sheet,
    doc,
    owner,
    editor,
    viewer,
    operator,
    sessions,
    cookie,
    base,
    api,
    send,
    snapshot,
    ticket,
    open,
    connect,
    submit,
  };
}

test('default-off Space review refuses metadata, preparation and every protocol entry', async () => {
  const f = await fixture(false);
  for (const path of [
    f.api(),
    `${f.base()}/user/session-ticket?unitID=${f.sheet.id}`,
    `${f.base()}/snapshot/2/unit/${f.sheet.id}/rev/0`,
  ]) {
    const response = await f.send(path);
    expect(response.status, path).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain('Private sheet');
  }
  expect((await f.send(f.api() + '/collaboration', f.cookie(), {})).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(
    (await f.send(f.base() + '/authz/-/object/-/batch_allowed', f.cookie(), { requests: [] }))
      .status,
  ).toBeGreaterThanOrEqual(400);
}, 20_000);

test('gated native HTTP admission retains ordinary/guest denial and exact child permissions', async () => {
  const f = await fixture(true);
  for (const item of [f.sheet, f.doc]) {
    expect(
      (await f.send(f.api(item.id) + '/collaboration', f.cookie(f.editor.id), {})).status,
    ).toBe(200);
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
    expect(
      (await f.send(`/universer-api/user/session-ticket?unitID=${item.id}`)).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await f.send(`/guest-api/${item.id}/universer-api/user/session-ticket?unitID=${item.id}`))
        .status,
    ).toBeGreaterThanOrEqual(400);
    for (const suffix of [
      '/history',
      '/images/secret',
      '/export',
      '/offline-bundle',
      '/formulas/sources',
    ])
      expect((await f.send(f.api(item.id) + suffix)).status, suffix).toBeGreaterThanOrEqual(400);
  }
  expect((await f.send(f.api(), '')).status).toBe(401);
  expect((await f.send(f.api(), f.cookie(f.operator.id))).status).toBeGreaterThanOrEqual(400);
  expect(
    (
      await f.send(f.api() + '/collaboration', f.cookie(), {
        spaceId: f.space.id,
        spaceItem: f.sheet.id,
      })
    ).status,
  ).toBe(400);
  const wrongChild = await f.send(`${f.base(f.doc.id)}/snapshot/2/unit/${f.sheet.id}/rev/0`);
  expect(wrongChild.status).toBeGreaterThanOrEqual(400);
  expect(await wrongChild.text()).not.toContain(f.sheet.name);
  for (const user of [f.owner, f.editor, f.viewer]) {
    const response = await f.send(f.base() + '/authz/-/object/-/batch_allowed', f.cookie(user.id), {
      requests: [f.sheet, f.doc].map((item) => ({
        unitID: item.id,
        objectID: item.id,
        actions: [UnitAction.View, UnitAction.Edit],
      })),
    });
    expect(response.status).toBe(200);
    const values = (await response.json()).objectActions.map(
      (row: { actions: { allowed: boolean }[] }) => row.actions.map((action) => action.allowed),
    );
    expect(values).toEqual([
      [true, user.id !== f.viewer.id],
      [false, false],
    ]);
  }
  const forged = await f.send('/universer-api/authz/-/object/-/batch_allowed', f.cookie(), {
    customData: {
      spaceId: f.space.id,
      spaceItem: f.sheet.id,
      sessionHash: f.sessions.get(f.owner.id)!.session.token_hash,
    },
    requests: [
      { unitID: f.sheet.id, objectID: f.sheet.id, actions: [UnitAction.View, UnitAction.Edit] },
    ],
  });
  expect(
    (await forged.json()).objectActions[0].actions.every(
      (action: { allowed: boolean }) => !action.allowed,
    ),
  ).toBe(true);
}, 30_000);

test('Space sockets bind the exact pair, deny viewers and stale commits, and evict changed grants before broadcast', async () => {
  const f = await fixture(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (const item of [f.sheet, f.doc])
    expect((await f.send(f.api(item.id) + '/collaboration', f.cookie(), {})).status).toBe(200);
  const mismatched = await f.open(f.editor.id, f.doc.id, await f.ticket());
  expect(mismatched.status).toBe(101);
  await expect.poll(() => mismatched.socket.readyState).toBe(WebSocket.CLOSED);
  expect(mismatched.messages).toEqual([]);
  const viewer = await f.connect(f.viewer.id);
  const before = await (await f.snapshot()).text();
  expect((await f.submit(f.viewer.id, viewer.memberID, 'viewer cannot persist this')).status).toBe(
    200,
  );
  await expect
    .poll(() => viewer.messages.some((message) => message.collaMsg?.eventID === 'permission_rej'))
    .toBe(true);
  expect(await (await f.snapshot()).text()).toBe(before);
  viewer.socket.send(
    JSON.stringify({
      cmd: CombCmd.JOIN,
      routeKey: f.doc.id,
      routeType: '',
      joinReq: { rooms: [{ roomID: f.doc.id }] },
    }),
  );
  await expect
    .poll(() => viewer.messages.filter((message) => message.cmd === CombCmd.JOIN).length)
    .toBe(2);
  expect(viewer.messages.filter((message) => message.cmd === CombCmd.JOIN)[1].code).not.toBe(
    CmdRspCode.OK,
  );
  viewer.socket.close();
  const owner = await f.connect(f.owner.id),
    editor = await f.connect();
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'viewer');
  expect((await f.submit(f.owner.id, owner.memberID, 'Authorized after downgrade')).status).toBe(
    200,
  );
  await expect.poll(() => editor.socket.readyState).toBe(WebSocket.CLOSED);
  expect(await (await f.snapshot()).text()).toContain('Authorized after downgrade');
  expect(JSON.stringify(editor.messages)).not.toContain('Authorized after downgrade');
  const baseline = await (await f.snapshot()).text();
  await f.submit(f.editor.id, editor.memberID, 'Stale edit must not persist', 2);
  expect(await (await f.snapshot()).text()).toBe(baseline);
  const recovery = new SpaceRecoveryStore(f.workspace),
    lifecycle = new SpaceLifecycleStore(f.workspace);
  for (const change of [
    'revoke',
    'child-trash',
    'root-trash',
    'disabled-owner',
    'disabled-editor',
  ] as const) {
    f.spaces.share(f.owner.id, f.space.id, f.editor.id, 'editor');
    const client = await f.connect();
    if (change === 'revoke') f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
    if (change === 'child-trash') recovery.trash(f.owner.id, f.space.id, f.sheet.id);
    if (change === 'root-trash') lifecycle.trash(f.owner.id, f.space.id);
    if (change === 'disabled-owner')
      f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
    if (change === 'disabled-editor')
      f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
    await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
    expect((await f.snapshot(f.sheet.id, f.cookie(f.editor.id))).status).toBeGreaterThanOrEqual(
      400,
    );
    if (change === 'child-trash') recovery.restore(f.owner.id, f.space.id, f.sheet.id);
    if (change === 'root-trash') lifecycle.restore(f.owner.id, f.space.id);
    f.db.prepare('UPDATE auth_users SET disabled=0 WHERE id IN (?,?)').run(f.owner.id, f.editor.id);
  }
  const client = await f.connect();
  f.auth.revokeSession(f.sessions.get(f.editor.id)!.session.token_hash);
  await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
  expect((await f.snapshot(f.sheet.id, f.cookie(f.editor.id))).status).toBe(401);
}, 45_000);
