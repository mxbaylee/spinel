import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { CombCmd, CmdRspCode, UnitAction, UniverType } from '@univerjs/protocol';
import type {
  IFetchMissingChangesetsResponse,
  IGetDeserializedSheetBlockResponse,
  IGetUnitOnRevResponse,
} from '@univerjs/protocol';
import { LocaleType } from '@univerjs/core';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { SpaceRecoveryStore } from '../workspace/space-recovery.ts';
import { SpaceLifecycleStore } from '../workspace/space-lifecycle.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { CollaborationStore } from './service.ts';

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
  const ticket = async (user = editor.id, id = sheet.id, unitID = id) => {
    const response = await send(`${base(id)}/user/session-ticket?unitID=${unitID}`, cookie(user));
    expect(response.status).toBe(200);
    return (await response.json()).ticket as string;
  };
  const open = async (user = editor.id, id = sheet.id, existingTicket?: string, unitID = id) => {
    const token = existingTicket ?? (await ticket(user, id, unitID));
    const socket = new WebSocket(
      `${root.replace('http:', 'ws:')}${base(id)}/comb/connect?sessionTicket=${encodeURIComponent(token)}&unitID=${unitID}`,
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
  const connect = async (user = editor.id, id = sheet.id, unitID = id) => {
    const client = await open(user, id, undefined, unitID);
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
        routeKey: unitID,
        routeType: '',
        joinReq: { rooms: [{ roomID: unitID }] },
      }),
    );
    await expect
      .poll(() => client.messages.find((message) => message.cmd === CombCmd.JOIN)?.code)
      .toBe(CmdRspCode.OK);
    return { ...client, memberID };
  };
  const submit = (
    user: string,
    memberID: string,
    value: string,
    baseRev = 1,
    id = sheet.id,
    unitID = id,
  ) =>
    send(`${base(id)}/comb/${UniverType.UNIVER_SHEET}/unit/${unitID}/new_changes`, cookie(user), {
      unitID,
      type: UniverType.UNIVER_SHEET,
      memberID,
      changeset: {
        unitID,
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
              unitId: unitID,
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
  for (const path of ['/review/spaces', `/review/spaces/${f.space.id}?spaceReview=1`]) {
    const response = await f.send(path);
    expect(response.status, path).toBe(404);
    expect(await response.text()).not.toContain('Fixture');
  }
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
  for (const path of ['/review/spaces', `/review/spaces/${f.space.id}?spaceReview=1`]) {
    const response = await f.send(path);
    expect(response.status, path).toBe(200);
    expect(await response.text()).toContain('Fixture');
  }
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

test('Space permission batches resolve one exact unit once and keep Print unavailable without changing ordinary permissions', async () => {
  const f = await fixture(true);
  const access = vi.spyOn(CollaborationStore.prototype, 'access');
  const requests = [
    ...Array.from({ length: 30 }, (_, index) => ({
      unitID: f.sheet.id,
      objectID: `permission-${index}`,
      actions: [UnitAction.View, UnitAction.Edit, UnitAction.Print],
    })),
    {
      unitID: f.doc.id,
      objectID: 'wrong-child',
      actions: [UnitAction.View, UnitAction.Edit, UnitAction.Print],
    },
  ];
  const values = async (user: string) => {
    access.mockClear();
    const response = await f.send(f.base() + '/authz/-/object/-/batch_allowed', f.cookie(user), {
      requests,
    });
    expect(response.status).toBe(200);
    expect(access).toHaveBeenCalledTimes(1);
    expect(access).toHaveBeenCalledWith(user, f.sheet.id, false, {
      sessionHash: f.sessions.get(user)!.session.token_hash,
      spaceId: f.space.id,
      spaceItem: f.sheet.id,
    });
    return (await response.json()).objectActions.map((row: { actions: { allowed: boolean }[] }) =>
      row.actions.map((action) => action.allowed),
    ) as boolean[][];
  };
  for (const user of [f.owner, f.editor, f.viewer]) {
    const allowed = await values(user.id);
    expect(allowed.slice(0, 30)).toEqual(
      Array.from({ length: 30 }, () => [true, user.id !== f.viewer.id, false]),
    );
    expect(allowed[30]).toEqual([false, false, false]);
  }
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
  expect((await values(f.editor.id)).flat().every((allowed) => !allowed)).toBe(true);
  access.mockClear();
  const wrongOnly = await f.send(f.base() + '/authz/-/object/-/batch_allowed', f.cookie(), {
    requests: [requests.at(-1)],
  });
  expect(wrongOnly.status).toBe(200);
  expect(access).not.toHaveBeenCalled();
  expect(
    (await wrongOnly.json()).objectActions[0].actions.every(
      (value: { allowed: boolean }) => !value.allowed,
    ),
  ).toBe(true);

  const ordinary = f.workspace.create(f.owner.id, {
    name: 'Ordinary print permissions',
    kind: 'sheet',
    parentId: null,
  });
  f.workspace.share(f.owner.id, ordinary.id, f.viewer.id, 'viewer');
  for (const user of [f.owner, f.viewer]) {
    const response = await f.send(
      '/universer-api/authz/-/object/-/batch_allowed',
      f.cookie(user.id),
      {
        requests: [{ unitID: ordinary.id, objectID: ordinary.id, actions: [UnitAction.Print] }],
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).objectActions[0].actions).toEqual([
      { action: UnitAction.Print, allowed: true },
    ]);
  }
}, 20_000);

test('a rotated Sheet generation supports scoped parsed snapshots, blocks and missing changes while unused revoked tickets cannot upgrade', async () => {
  const f = await fixture(true);
  const ordinary = f.workspace.create(f.owner.id, {
    name: 'Rotated native sheet',
    kind: 'sheet',
    parentId: null,
  });
  new SheetStore(f.workspace).save(f.owner.id, ordinary.id, {
    snapshot: {
      id: ordinary.id,
      name: ordinary.name,
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
  expect((await f.send(`/api/items/${ordinary.id}/collaboration`, f.cookie(), {})).status).toBe(
    200,
  );
  const named = await f.send(`/api/items/${ordinary.id}/history`, f.cookie(), {
    name: 'Existing native checkpoint',
  });
  expect(named.status).toBe(201);
  const checkpoint = (await named.json()).version.id as string;
  const restored = await f.send(
    `/api/items/${ordinary.id}/history/${checkpoint}/restore`,
    f.cookie(),
    {
      unitId: ordinary.id,
      requestId: randomUUID(),
    },
  );
  expect(restored.status).toBe(200);
  const unitID = (await restored.json()).unitId as string;
  expect(unitID).not.toBe(ordinary.id);
  // Deliberate storage fixture, not a new product conversion route: membership
  // must retain a real existing rotated native generation and checkpoint.
  f.db
    .prepare('UPDATE workspace_items SET parent_id=?,space_id=?,space_position=1 WHERE id=?')
    .run(f.space.id, f.space.id, ordinary.id);
  const preparation = await f.send(f.api(ordinary.id) + '/collaboration', f.cookie(), {});
  expect(preparation.status).toBe(200);
  expect(await preparation.json()).toMatchObject({ unitId: unitID });
  const prefix = f.base(ordinary.id);
  const snapshotPath = `/snapshot/2/unit/${unitID}/rev/0`;
  const response = await f.send(prefix + snapshotPath);
  expect(response.status).toBe(200);
  const content = (await response.json()) as IGetUnitOnRevResponse;
  expect(content.snapshot).toMatchObject({
    unitID,
    type: UniverType.UNIVER_SHEET,
    workbook: { name: ordinary.name },
  });
  const blocks = content.snapshot?.workbook?.blockMeta.first?.blocks ?? [];
  expect(blocks.length).toBeGreaterThan(0);
  const blockPath = `/snapshot/block/2/unit/${unitID}/block/${blocks[0]}`;
  const blockResponse = await f.send(prefix + blockPath, f.cookie(f.viewer.id));
  expect(blockResponse.status).toBe(200);
  const { block } = (await blockResponse.json()) as IGetDeserializedSheetBlockResponse;
  expect(block).toMatchObject({ id: blocks[0], data: expect.any(Object) });
  expect(JSON.stringify(block!.data)).toContain('Retained native cell');
  const baseRev = Math.max(
    content.snapshot!.rev,
    ...content.changesets.map((change) => change.revision),
  );
  const missingPath = `/snapshot/2/unit/${unitID}/fetchmissing?from=${baseRev}&to=0`;
  const missing = async () => {
    const response = await f.send(prefix + missingPath, f.cookie(f.viewer.id));
    expect(response.status).toBe(200);
    return (await response.json()) as IFetchMissingChangesetsResponse;
  };
  expect((await missing()).changesets).toEqual([]);
  const owner = await f.connect(f.owner.id, ordinary.id, unitID);
  expect(
    (
      await f.submit(
        f.owner.id,
        owner.memberID,
        'Saved on the live rotated generation',
        baseRev,
        ordinary.id,
        unitID,
      )
    ).status,
  ).toBe(200);
  await expect
    .poll(async () => (await missing()).changesets.map((change) => change.revision))
    .toEqual([baseRev + 1]);
  const changes = (await missing()).changesets;
  expect(changes[0]).toMatchObject({ unitID, baseRev, revision: baseRev + 1 });
  const mutation = changes[0].mutations.find((change) => change.id === SetRangeValuesMutation.id);
  expect(mutation).toBeDefined();
  expect(JSON.parse(mutation!.data)).toMatchObject({
    unitId: unitID,
    subUnitId: 'first',
    cellValue: { 0: { 0: { v: 'Saved on the live rotated generation' } } },
  });

  for (const path of [snapshotPath, blockPath, missingPath]) {
    const denied = await f.send(f.base(f.doc.id) + path);
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(await denied.text()).not.toContain('Retained native');
    expect((await f.send('/universer-api' + path)).status).toBeGreaterThanOrEqual(400);
  }
  expect(
    (await f.send(`${prefix}/snapshot/2/unit/${ordinary.id}/rev/0`)).status,
  ).toBeGreaterThanOrEqual(400);
  expect((await f.send(`${prefix}/user/session-ticket?unitID=${ordinary.id}`)).status).toBe(403);
  // The ticket was valid when issued and has never been used. Revocation before
  // HTTP upgrade must be refused before HELLO, independently of socket eviction.
  const unused = await f.ticket(f.editor.id, ordinary.id, unitID);
  f.spaces.share(f.owner.id, f.space.id, f.editor.id, null);
  const revoked = await f.open(f.editor.id, ordinary.id, unused, unitID);
  expect(revoked.status).toBe(403);
  expect(revoked.messages).toEqual([]);
  expect(
    f.db.prepare('SELECT id FROM history_checkpoints WHERE id=?').get(checkpoint),
  ).toMatchObject({ id: checkpoint });
}, 30_000);
