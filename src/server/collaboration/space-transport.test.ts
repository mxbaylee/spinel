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
import { DocumentStore } from '../workspace/documents.ts';
import sharp from 'sharp';
import { CollaborationStore } from './service.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(spaceReview: boolean, role: 'editor' | 'admin' = 'editor') {
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
    workspace = new WorkspaceStore(auth, { spacesEnabled: spaceReview }),
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
  spaces.share(owner.id, space.id, editor.id, role);
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
  const ticket = async (
    user = editor.id,
    id = sheet.id,
    unitID = id,
    credential = cookie(user),
    prefix = base(id),
  ) => {
    const response = await send(`${prefix}/user/session-ticket?unitID=${unitID}`, credential);
    expect(response.status).toBe(200);
    return (await response.json()).ticket as string;
  };
  const open = async (
    user = editor.id,
    id = sheet.id,
    existingTicket?: string,
    unitID = id,
    credential = cookie(user),
    prefix = base(id),
  ) => {
    const token = existingTicket ?? (await ticket(user, id, unitID, credential, prefix));
    const socket = new WebSocket(
      `${root.replace('http:', 'ws:')}${prefix}/comb/connect?sessionTicket=${encodeURIComponent(token)}&unitID=${unitID}`,
      { headers: { Cookie: credential, Origin: origin } },
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
  const connect = async (
    user = editor.id,
    id = sheet.id,
    unitID = id,
    credential = cookie(user),
    prefix = base(id),
  ) => {
    const client = await open(user, id, undefined, unitID, credential, prefix);
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
    root,
    origin,
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

test('explicitly disabled Spaces refuse metadata, preparation and every protocol entry', async () => {
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

test('scoped native HTTP integrations retain ordinary-route denial and exact child permissions', async () => {
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
    for (const suffix of ['/history', '/export', '/offline-bundle'])
      expect((await f.send(f.api(item.id) + suffix)).status, suffix).toBe(200);
    expect((await f.send(f.api(item.id) + '/images/secret')).status).toBeGreaterThanOrEqual(400);
    const sources = await f.send(f.api(item.id) + '/formulas/sources');
    expect(sources.status).toBe(item.kind === 'doc' ? 200 : 400);
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

test.each(['editor', 'admin'] as const)(
  'Space %s sockets bind the exact pair, deny viewers and stale commits, and evict changed grants before broadcast',
  async (role) => {
    const f = await fixture(true, role);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const item of [f.sheet, f.doc])
      expect((await f.send(f.api(item.id) + '/collaboration', f.cookie(), {})).status).toBe(200);
    const mismatched = await f.open(f.editor.id, f.doc.id, await f.ticket());
    expect(mismatched.status).toBe(101);
    await expect.poll(() => mismatched.socket.readyState).toBe(WebSocket.CLOSED);
    expect(mismatched.messages).toEqual([]);
    const viewer = await f.connect(f.viewer.id);
    const before = await (await f.snapshot()).text();
    expect(
      (await f.submit(f.viewer.id, viewer.memberID, 'viewer cannot persist this')).status,
    ).toBe(200);
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
      f.spaces.share(f.owner.id, f.space.id, f.editor.id, role);
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
      f.db
        .prepare('UPDATE auth_users SET disabled=0 WHERE id IN (?,?)')
        .run(f.owner.id, f.editor.id);
    }
    const client = await f.connect();
    f.auth.revokeSession(f.sessions.get(f.editor.id)!.session.token_hash);
    await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
    expect((await f.snapshot(f.sheet.id, f.cookie(f.editor.id))).status).toBe(401);
  },
  45_000,
);

test('Space permission batches resolve one exact unit once and retain existing native Print permissions', async () => {
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
      Array.from({ length: 30 }, () => [true, user.id !== f.viewer.id, true]),
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

test('a root link transition drains an admitted child join before publishing the new capability', async () => {
  const f = await fixture(true);
  expect((await f.send(f.api(f.doc.id) + '/collaboration', f.cookie(), {})).status).toBe(200);
  const client = await f.open(f.owner.id, f.doc.id);
  expect(client.status).toBe(101);
  client.socket.send(JSON.stringify({ cmd: CombCmd.HELLO, routeKey: '', routeType: '' }));
  await expect
    .poll(() => client.messages.find((message) => message.cmd === CombCmd.HELLO)?.infoRsp?.memberID)
    .toBeTypeOf('string');
  let entered!: () => void;
  let release!: () => void;
  const admission = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = CollaborationStore.prototype.prepare;
  const prepare = vi
    .spyOn(CollaborationStore.prototype, 'prepare')
    .mockImplementation(async function (
      this: CollaborationStore,
      ...args: Parameters<CollaborationStore['prepare']>
    ) {
      if (args[1] === f.doc.id) {
        entered();
        await held;
      }
      return original.apply(this, args);
    });
  let update: Promise<Response> | undefined;
  try {
    client.socket.send(
      JSON.stringify({
        cmd: CombCmd.JOIN,
        routeKey: f.doc.id,
        routeType: '',
        joinReq: { rooms: [{ roomID: f.doc.id }] },
      }),
    );
    await admission;
    let finished = false;
    update = f
      .send(`/api/items/${f.space.id}/link`, f.cookie(), { role: 'viewer' }, 'PUT')
      .then((response) => {
        finished = true;
        return response;
      });
    await expect.poll(() => f.workspace.links.state(f.space.id)?.state).toBe('pending');
    // The caller cannot get the capability while any child admission is still
    // running. New tickets are fenced for every sibling at the same root epoch.
    expect(finished).toBe(false);
    expect((await f.send(`${f.base()}/user/session-ticket?unitID=${f.sheet.id}`)).status).toBe(403);
    expect(finished).toBe(false);
    release();
    const changed = await update;
    expect(changed.status).toBe(200);
    expect(f.workspace.links.state(f.space.id)?.state).toBe('active');
    await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
    expect(client.messages.filter((message) => message.cmd === CombCmd.JOIN)).not.toContainEqual(
      expect.objectContaining({ code: CmdRspCode.OK }),
    );
  } finally {
    release();
    await update;
    prepare.mockRestore();
  }
}, 30_000);

test('one Space guest capability covers its tree while link transitions fence every child room and ticket', async () => {
  const f = await fixture(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const guestBase = (id: string) => `/guest-space-api/${f.space.id}/items/${id}/universer-api`;
  const guestApi = (id: string) => `/api/guest-spaces/${f.space.id}/items/${id}`;
  const treePath = `/api/guest-spaces/${f.space.id}`;
  const linkPath = `/api/items/${f.space.id}/link`;
  const link = async (role: 'editor' | 'viewer' | null) => {
    const response = await f.send(linkPath, f.cookie(), { role }, 'PUT');
    expect(response.status).toBe(200);
    return response.json() as Promise<{ url: string | null }>;
  };
  const exchange = async (url: string) => {
    const response = await f.send(`/api/guest/${f.space.id}/session`, '', {
      token: new URL(url).hash.slice(1),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  for (const item of [f.sheet, f.doc])
    expect((await f.send(f.api(item.id) + '/collaboration', f.cookie(), {})).status).toBe(200);
  const unrelated = f.workspace.create(f.owner.id, {
    kind: 'sheet',
    name: 'Unrelated',
    parentId: null,
  });
  expect((await f.send(`/api/items/${unrelated.id}/collaboration`, f.cookie(), {})).status).toBe(
    200,
  );
  const independent = await f.connect(
    f.owner.id,
    unrelated.id,
    unrelated.id,
    f.cookie(),
    '/universer-api',
  );
  const accountSheet = await f.connect(f.owner.id);
  const pendingAccountDoc = await f.open(f.owner.id, f.doc.id);
  const unusedAccountTicket = await f.ticket(f.owner.id, f.doc.id);
  const enabled = await link('editor');
  await expect.poll(() => accountSheet.socket.readyState).toBe(WebSocket.CLOSED);
  await expect.poll(() => pendingAccountDoc.socket.readyState).toBe(WebSocket.CLOSED);
  expect(independent.socket.readyState).toBe(WebSocket.OPEN);
  const credential = await exchange(enabled.url!);
  const mixed = credential + '; ' + f.cookie(f.operator.id);
  const metadata = await (await f.send(`/api/guest/${f.space.id}`, mixed)).json();
  expect(metadata).toEqual({
    item: { id: f.space.id, kind: 'space', name: f.space.name, access: 'editor' },
  });
  const tree = await (await f.send(treePath, mixed)).json();
  expect(tree.space.parentId).toBeNull();
  expect(tree.access).toBe('editor');
  expect(tree.items.map((item: { id: string }) => item.id)).toEqual([f.sheet.id, f.doc.id]);
  expect(JSON.stringify(tree)).not.toContain(f.space.parentId);
  expect(JSON.stringify(tree)).not.toMatch(
    /ownerId|ownerName|sessionHash|guestHash|profile-avatar/,
  );
  const future = await f.send(treePath + '/items', mixed, {
    kind: 'doc',
    name: 'Guest-created page',
    parentId: f.space.id,
  });
  expect(future.status).toBe(201);
  const futureId = (await future.json()).item.id as string;
  const prepared = await f.send(guestApi(futureId) + '/collaboration', mixed, {});
  expect(prepared.status).toBe(200);
  expect(await prepared.json()).toMatchObject({ access: 'editor', user: { name: 'Guest' } });
  expect((await f.send(guestApi(f.doc.id) + '/formulas/sources', mixed)).status).toBe(200);
  for (const path of [
    treePath + '/trash',
    treePath + '/trash/' + f.doc.id + '/restore',
    guestApi(f.doc.id) + '/history',
    guestApi(f.doc.id) + '/export',
    guestApi(f.doc.id) + '/offline-bundle',
    guestApi(f.doc.id) + '/sharing',
    guestApi(f.doc.id) + '/link',
  ])
    expect((await f.send(path, mixed)).status, path).toBeGreaterThanOrEqual(400);
  expect((await f.send('/api/items', credential)).status).toBe(401);
  expect((await f.send(f.api(f.doc.id), credential)).status).toBe(401);
  expect(
    (await f.send(`${guestBase(f.doc.id)}/snapshot/2/unit/${f.sheet.id}/rev/0`, mixed)).status,
  ).toBeGreaterThanOrEqual(400);
  expect(
    (await f.send(`${guestBase(f.doc.id)}/snapshot/2/unit/${unrelated.id}/rev/0`, mixed)).status,
  ).toBeGreaterThanOrEqual(400);

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
      spaceId: f.space.id,
      spaceItem: f.doc.id,
    }).data.byteLength,
  ).toBe(bytes.length);

  const guestSheet = await f.connect('guest', f.sheet.id, f.sheet.id, mixed, guestBase(f.sheet.id));
  const guestDoc = await f.connect('guest', f.doc.id, f.doc.id, mixed, guestBase(f.doc.id));
  const anonymousAccount = await f.connect(f.owner.id, f.sheet.id);
  expect(JSON.stringify(guestSheet.messages)).not.toMatch(/"name":"Owner"|profile-avatar/);
  expect(JSON.stringify(anonymousAccount.messages)).toContain('Guest');
  const staleAccount = await f.open(f.owner.id, f.doc.id, unusedAccountTicket);
  if (staleAccount.status === 101)
    await expect.poll(() => staleAccount.socket.readyState).toBe(WebSocket.CLOSED);
  else expect(staleAccount.status).toBeGreaterThanOrEqual(400);
  const unusedGuestTicket = await f.ticket('guest', futureId, futureId, mixed, guestBase(futureId));
  const viewed = await link('viewer');
  for (const client of [guestSheet, guestDoc, anonymousAccount])
    await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
  expect(independent.socket.readyState).toBe(WebSocket.OPEN);
  // A privileged cookie cannot rescue the namespace's revoked guest credential.
  expect(
    (await f.send(guestApi(f.doc.id) + '/collaboration', credential + '; ' + f.cookie(), {}))
      .status,
  ).toBeGreaterThanOrEqual(400);
  // Canonical image reads intentionally allow the independently authorized account.
  expect((await f.send(image.url, credential + '; ' + f.cookie())).status).toBe(200);
  const viewerCookie = await exchange(viewed.url!);
  const staleGuest = await f.open(
    'guest',
    futureId,
    unusedGuestTicket,
    futureId,
    viewerCookie,
    guestBase(futureId),
  );
  if (staleGuest.status === 101)
    await expect.poll(() => staleGuest.socket.readyState).toBe(WebSocket.CLOSED);
  else expect(staleGuest.status).toBeGreaterThanOrEqual(400);
  const viewer = await f.connect(
    'guest',
    f.sheet.id,
    f.sheet.id,
    viewerCookie,
    guestBase(f.sheet.id),
  );
  const permissions = await f.send(
    guestBase(f.sheet.id) + '/authz/-/object/-/batch_allowed',
    viewerCookie,
    {
      requests: [
        {
          unitID: f.sheet.id,
          objectID: f.sheet.id,
          actions: [
            UnitAction.View,
            UnitAction.Edit,
            UnitAction.Print,
            UnitAction.Share,
            UnitAction.RecoverHistory,
          ],
        },
      ],
    },
  );
  expect(
    (await permissions.json()).objectActions[0].actions.map(
      (entry: { allowed: boolean }) => entry.allowed,
    ),
  ).toEqual([true, false, true, false, false]);
  expect(
    (
      await f.send(treePath + '/items', viewerCookie, {
        kind: 'doc',
        name: 'Denied',
        parentId: f.space.id,
      })
    ).status,
  ).toBe(403);
  const before = await (await f.snapshot()).text();
  const submit = await f.send(
    guestBase(f.sheet.id) + `/comb/2/unit/${f.sheet.id}/new_changes`,
    viewerCookie,
    {
      unitID: f.sheet.id,
      type: UniverType.UNIVER_SHEET,
      memberID: viewer.memberID,
      changeset: {
        unitID: f.sheet.id,
        type: UniverType.UNIVER_SHEET,
        userID: f.owner.id,
        memberID: viewer.memberID,
        sid: 'forged-space-viewer',
        reqId: 1,
        baseRev: 1,
        revision: 0,
        mutations: [
          {
            id: SetRangeValuesMutation.id,
            data: JSON.stringify({
              unitId: f.sheet.id,
              subUnitId: 'first',
              cellValue: { 0: { 0: { v: 'Denied forged owner' } } },
            }),
          },
        ],
      },
    },
  );
  expect(submit.status).toBe(200);
  await expect.poll(() => JSON.stringify(viewer.messages)).toContain('permission_rej');
  expect(await (await f.snapshot()).text()).toBe(before);
  await link(null);
  await expect.poll(() => viewer.socket.readyState).toBe(WebSocket.CLOSED);
  expect(
    (await f.send(guestApi(f.doc.id), viewerCookie + '; ' + f.cookie())).status,
  ).toBeGreaterThanOrEqual(400);
  expect(independent.socket.readyState).toBe(WebSocket.OPEN);
}, 60_000);
