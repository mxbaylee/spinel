import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, expect } from 'vitest';
import WebSocket from 'ws';
import { CombCmd, CmdRspCode, UniverType } from '@univerjs/protocol';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';

test('guest HTTP and socket identities are scoped; link transitions evict pending joins and reject stale commits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-guest-'));
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const filename = join(directory, 'app.sqlite'),
    origin = 'http://localhost:3000';
  const app = await createApp({ databasePath: filename, staticDirectory: directory, origin });
  const db = openDatabase(filename),
    sockets: WebSocket[] = [];
  try {
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Private Person Name'),
      item = workspace.create(owner.id, { kind: 'sheet', name: 'Shared budget', parentId: null });
    const other = workspace.create(owner.id, {
      kind: 'sheet',
      name: 'Never shared',
      parentId: null,
    });
    const ownerCookie = `${COOKIE_NAME}=${auth.createSession(owner.id).token}`;
    const send = (
      path: string,
      cookie = '',
      body?: unknown,
      method = body === undefined ? 'GET' : 'POST',
    ) =>
      fetch(root + path, {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect((await send(`/api/items/${item.id}/collaboration`, ownerCookie, {})).ok).toBe(true);
    const base = `/guest-api/${item.id}/universer-api`;
    const ticket = async (prefix: string, cookie: string) => {
      const response = await send(`${prefix}/user/session-ticket?unitID=${item.id}`, cookie);
      expect(response.status).toBe(200);
      return (await response.json()).ticket as string;
    };
    const open = async (
      prefix: string,
      cookie: string,
      joinRoom = true,
      existingTicket?: string,
    ) => {
      const token = existingTicket ?? (await ticket(prefix, cookie));
      const socket = new WebSocket(
        `${root.replace('http:', 'ws:')}${prefix}/comb/connect?sessionTicket=${encodeURIComponent(token)}&unitID=${item.id}`,
        { headers: { Cookie: cookie, Origin: origin } },
      );
      sockets.push(socket);
      const messages: {
        cmd: number;
        code?: number;
        infoRsp?: { memberID: string };
        [key: string]: unknown;
      }[] = [];
      socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      socket.send(JSON.stringify({ cmd: CombCmd.HELLO, routeKey: '', routeType: '' }));
      await expect
        .poll(() => messages.find((m) => m.cmd === CombCmd.HELLO)?.infoRsp?.memberID)
        .toBeTypeOf('string');
      const memberID = messages.find((m) => m.cmd === CombCmd.HELLO)!.infoRsp!.memberID;
      if (joinRoom) {
        socket.send(
          JSON.stringify({
            cmd: CombCmd.JOIN,
            routeKey: item.id,
            routeType: '',
            joinReq: { rooms: [{ roomID: item.id }] },
          }),
        );
        await expect
          .poll(() => messages.find((m) => m.cmd === CombCmd.JOIN)?.code)
          .toBe(CmdRspCode.OK);
      }
      return { socket, messages, memberID };
    };
    // This connection has a personal label but has not joined: activation must close it too.
    const pending = await open('/universer-api', ownerCookie, false);
    const oldOwnerTicket = await ticket('/universer-api', ownerCookie);
    const enabled = await send(
      `/api/items/${item.id}/link`,
      ownerCookie,
      { role: 'editor' },
      'PUT',
    );
    expect(enabled.status).toBe(200);
    const link = await enabled.json();
    await expect.poll(() => pending.socket.readyState).toBe(WebSocket.CLOSED);
    const entered = await send(`/api/guest/${item.id}/session`, '', {
      token: new URL(link.url).hash.slice(1),
    });
    expect(entered.status).toBe(204);
    expect(entered.headers.get('set-cookie')).toContain('HttpOnly');
    const cookie = entered.headers.get('set-cookie')!.split(';')[0];
    expect((await send(`/api/guest/${item.id}/collaboration`, cookie, {})).ok).toBe(true);
    const metadata = await (await send(`/api/guest/${item.id}`, cookie)).json();
    expect(Object.keys(metadata.item).sort()).toEqual(['access', 'id', 'kind', 'name']);
    for (const path of [
      '/api/items',
      '/api/auth/session',
      `/api/items/${item.id}/history`,
      `/api/items/${item.id}/sharing`,
      `/api/items/${item.id}/export`,
      `/api/guest/${other.id}`,
    ])
      expect((await send(path, cookie)).status).toBeGreaterThanOrEqual(400);
    expect(
      (await send(`${base}/snapshot/2/unit/${other.id}/rev/0`, cookie)).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await send(`${base}/snapshot/2/unit/${item.id}/rev/0`, cookie)).ok).toBe(true);
    const account = await open('/universer-api', ownerCookie),
      guest = await open(base, cookie);
    expect(JSON.stringify(guest.messages)).not.toContain(owner.name);
    expect(JSON.stringify(guest.messages)).not.toContain('Private Person');
    await expect.poll(() => JSON.stringify(account.messages)).toContain('Guest');
    const permission = await send(`${base}/authz/-/object/-/batch_allowed`, cookie, {
      requests: [
        { unitID: item.id, objectID: item.id, actions: [0, 1] },
        { unitID: other.id, objectID: other.id, actions: [0] },
      ],
    });
    expect((await permission.json()).objectActions[1].actions[0].allowed).toBe(false);
    // A pre-transition account ticket cannot reconnect with its old personal label.
    const staleSocket = new WebSocket(
      `${root.replace('http:', 'ws:')}/universer-api/comb/connect?sessionTicket=${encodeURIComponent(oldOwnerTicket)}&unitID=${item.id}`,
      { headers: { Cookie: ownerCookie, Origin: origin } },
    );
    sockets.push(staleSocket);
    staleSocket.on('error', () => {});
    await expect.poll(() => staleSocket.readyState).toBe(WebSocket.CLOSED);
    const staleGuestTicket = await ticket(base, cookie);
    const disabled = await send(`/api/items/${item.id}/link`, ownerCookie, { role: null }, 'PUT');
    expect(disabled.status).toBe(200);
    await expect.poll(() => guest.socket.readyState).toBe(WebSocket.CLOSED);
    expect((await send(`/api/guest/${item.id}`, cookie)).status).toBe(404);
    expect((await send(`${base}/snapshot/2/unit/${item.id}/rev/0`, cookie)).status).toBe(401);
    const rejected = await send(`${base}/comb/2/unit/${item.id}/new_changes`, cookie, {
      unitID: item.id,
      type: UniverType.UNIVER_SHEET,
      memberID: guest.memberID,
      changeset: {
        unitID: item.id,
        type: UniverType.UNIVER_SHEET,
        userID: owner.id,
        memberID: guest.memberID,
        sid: 'guest-stale',
        reqId: 1,
        baseRev: 1,
        revision: 0,
        mutations: [
          {
            id: SetRangeValuesMutation.id,
            data: JSON.stringify({
              unitId: item.id,
              subUnitId: 'first',
              cellValue: { 0: { 0: { v: 'Rejected guest write' } } },
            }),
          },
        ],
      },
    });
    expect(rejected.status).toBe(401);
    expect(staleGuestTicket).toBeTruthy();
    expect(await (await send(`/api/items/${item.id}/sheet`, ownerCookie)).text()).not.toContain(
      'Rejected guest write',
    );
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
