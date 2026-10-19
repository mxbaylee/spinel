import { CollaborationStore } from './service.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, vi } from 'vitest';
import WebSocket from 'ws';
import { CombCmd, CmdRspCode, ErrorCode, UniverType } from '@univerjs/protocol';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';

test('protocol ingress authenticates independently, binds one-time tickets, and rejects stale sessions and hostile origins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-transport-'));
  const filename = join(directory, 'spinel.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const origin = 'http://localhost:3000';
  const app = await createApp({ databasePath: filename, staticDirectory: directory, origin });
  const db = openDatabase(filename);
  try {
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Owner'),
      viewer = auth.createUser('Viewer'),
      unrelated = auth.createUser('Unrelated'),
      admin = auth.createUser('Admin', true);
    const item = workspace.create(owner.id, { kind: 'sheet', name: 'Budget', parentId: null });
    workspace.share(owner.id, item.id, viewer.id, 'viewer');
    const login = auth.createSession(owner.id);
    const cookie = `${COOKIE_NAME}=${login.token}`;
    const ticket = (credential = cookie, suppliedOrigin = origin) =>
      fetch(`${root}/universer-api/user/session-ticket?unitID=${item.id}`, {
        headers: { Cookie: credential, Origin: suppliedOrigin },
      });
    expect((await ticket('')).status).toBe(401);
    expect((await ticket(`${COOKIE_NAME}=${auth.createSession(admin.id).token}`)).status).toBe(401);
    expect((await ticket(cookie, 'https://hostile.example')).status).toBe(403);
    const prepare = await fetch(`${root}/api/items/${item.id}/collaboration`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(prepare.ok).toBe(true);
    const replay = (credential = cookie, suppliedOrigin = origin, revision = 0) =>
      fetch(`${root}/api/items/${item.id}/offline-replay`, {
        method: 'POST',
        headers: { Cookie: credential, Origin: suppliedOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: item.id, revision }),
      });
    expect((await replay('')).status).toBe(401);
    expect((await replay(cookie, 'https://hostile.example')).status).toBe(403);
    expect((await replay(cookie, origin, -1)).status).toBe(400);
    const downloaded = await replay();
    expect(downloaded.ok).toBe(true);
    expect(downloaded.headers.get('cache-control')).toBe('no-store');
    const bundle = await downloaded.json();
    expect(bundle.accountId).toBe(owner.id);
    expect(bundle.unitId).toBe(item.id);
    expect(typeof bundle.data.snapshot.workbook.originalMeta).toBe('string');
    expect((await replay(`${COOKIE_NAME}=${auth.createSession(unrelated.id).token}`)).ok).toBe(
      false,
    );
    expect((await replay(`${COOKIE_NAME}=${auth.createSession(admin.id).token}`)).ok).toBe(false);
    const expiring = auth.createSession(owner.id);
    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalReplay = CollaborationStore.prototype.offlineReplay;
    const delayedReplay = vi
      .spyOn(CollaborationStore.prototype, 'offlineReplay')
      .mockImplementationOnce(async function (this: CollaborationStore, ...args) {
        const result = await originalReplay.apply(this, args);
        acquired.resolve();
        await release.promise;
        return result;
      });
    try {
      const inFlight = replay(`${COOKIE_NAME}=${expiring.token}`);
      await acquired.promise;
      auth.revokeSession(expiring.session.token_hash);
      release.resolve();
      const expired = await inFlight;
      expect(expired.status).toBe(401);
      expect(await expired.text()).not.toContain('preservedResources');
    } finally {
      release.resolve();
      delayedReplay.mockRestore();
    }
    const snapshot = `${root}/universer-api/snapshot/2/unit/${item.id}/rev/0`;
    expect((await fetch(snapshot, { headers: { Cookie: cookie } })).ok).toBe(true);
    const foreign = `${COOKIE_NAME}=${auth.createSession(unrelated.id).token}`;
    const denied = await fetch(snapshot, { headers: { Cookie: foreign } });
    expect(await denied.text()).not.toContain('Budget');
    const granted = await ticket();
    expect(granted.headers.get('cache-control')).toBe('no-store');
    const { ticket: opaque } = await granted.json();
    expect(typeof opaque).toBe('string');
    const upgrade = (
      value: string,
      suppliedOrigin = origin,
      credential = cookie,
      unitID = item.id,
    ) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          `${root}/universer-api/comb/connect?sessionTicket=${encodeURIComponent(value)}&unitID=${encodeURIComponent(unitID)}`,
          {
            headers: {
              Cookie: credential,
              Origin: suppliedOrigin,
              Connection: 'Upgrade',
              Upgrade: 'websocket',
              'Sec-WebSocket-Version': '13',
              'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode!);
          },
        );
        req.on('upgrade', (res, socket) => {
          socket.destroy();
          resolve(res.statusCode!);
        });
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('Upgrade timeout')));
        req.end();
      });
    expect(await upgrade(opaque, 'https://hostile.example')).toBe(403);
    expect(await upgrade(opaque, origin, '')).toBe(403);
    expect(await upgrade(opaque, origin, foreign)).toBe(403);
    expect(await upgrade(opaque, origin, cookie, '')).toBe(403);
    const outsiderItem = workspace.create(unrelated.id, {
      kind: 'doc',
      name: 'Secret',
      parentId: null,
    });
    expect(await upgrade(opaque, origin, cookie, outsiderItem.id)).toBe(403);
    expect((await ticket(foreign)).status).toBe(403);
    expect(
      (
        await fetch(`${root}/universer-api/user/session-ticket`, {
          headers: { Cookie: cookie, Origin: origin },
        })
      ).status,
    ).toBe(403);
    expect(await upgrade(opaque)).toBe(101);
    expect(await upgrade(opaque)).toBe(401);
    const stale = (await (await ticket()).json()).ticket;
    auth.revokeSession(login.session.token_hash);
    expect(await upgrade(stale)).toBe(403);
    expect((await ticket()).status).toBe(401);
    const viewerCookie = `${COOKIE_NAME}=${auth.createSession(viewer.id).token}`;
    const actions = await fetch(`${root}/universer-api/authz/-/object/-/batch_allowed`, {
      method: 'POST',
      headers: { Cookie: viewerCookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ unitID: item.id, objectID: item.id, actions: [0, 1, 2, 34] }],
      }),
    });
    expect(
      (await actions.json()).objectActions[0].actions.map(
        (entry: { allowed: boolean }) => entry.allowed,
      ),
    ).toEqual([true, false, false, false]);
    expect(
      (
        await fetch(`${root}/universer-api/authz/-/object/-/batch_allowed`, {
          method: 'POST',
          headers: { Cookie: viewerCookie, Origin: origin, 'Content-Type': 'application/json' },
          body: '{"requests":[null]}',
        })
      ).status,
    ).toBe(400);
  } finally {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test('raw document sockets reject viewer and revoked edits, close stale grants, and never join a second document', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-live-permissions-'));
  const filename = join(directory, 'spinel.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const origin = 'http://localhost:3000';
  const app = await createApp({ databasePath: filename, staticDirectory: directory, origin });
  const db = openDatabase(filename);
  const sockets: WebSocket[] = [];
  const audit = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Owner'),
      collaborator = auth.createUser('Collaborator');
    const item = workspace.create(owner.id, {
      kind: 'sheet',
      name: 'Secret budget',
      parentId: null,
    });
    const other = workspace.create(owner.id, { kind: 'doc', name: 'Other secret', parentId: null });
    workspace.share(owner.id, item.id, collaborator.id, 'viewer');
    workspace.share(owner.id, other.id, collaborator.id, 'viewer');
    const ownerCookie = `${COOKIE_NAME}=${auth.createSession(owner.id).token}`;
    const login = auth.createSession(collaborator.id);
    const cookie = `${COOKIE_NAME}=${login.token}`;
    const post = (url: string, data: unknown, credential = cookie) =>
      fetch(root + url, {
        method: 'POST',
        headers: { Cookie: credential, Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    expect((await post(`/api/items/${item.id}/collaboration`, {})).ok).toBe(true);
    const getTicket = async () => {
      const response = await fetch(`${root}/universer-api/user/session-ticket?unitID=${item.id}`, {
        headers: { Cookie: cookie, Origin: origin },
      });
      expect(response.status).toBe(200);
      return (await response.json()).ticket as string;
    };
    const open = async (credential = cookie, ticket?: string, unitID = item.id) => {
      const value = ticket ?? (await getTicket());
      const socket = new WebSocket(
        `${root.replace('http:', 'ws:')}/universer-api/comb/connect?sessionTicket=${encodeURIComponent(value)}&unitID=${unitID}`,
        {
          headers: { Cookie: credential, Origin: origin },
        },
      );
      sockets.push(socket);
      const messages: {
        cmd: number;
        code: number;
        infoRsp?: { memberID?: string };
        collaMsg?: { eventID: string };
      }[] = [];
      socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
      const status = await new Promise<number>((resolve, reject) => {
        socket.once('open', () => resolve(101));
        socket.once('error', reject);
        socket.once('unexpected-response', (_req, response) => {
          response.resume();
          resolve(response.statusCode!);
        });
      });
      return { socket, messages, status };
    };
    const anonymous = await open('');
    expect(anonymous.status).toBe(403);
    expect(anonymous.messages).toEqual([]);
    // Both requested scopes are readable, but the ticket binds a different document/login.
    // SDK connect rejects after upgrade, before HELLO or any room/document data.
    for (const mismatch of [await open(cookie, undefined, other.id), await open(ownerCookie)]) {
      expect(mismatch.status).toBe(101);
      await expect.poll(() => mismatch.socket.readyState).toBe(WebSocket.CLOSED);
      expect(mismatch.messages).toEqual([]);
    }
    const connect = async () => {
      const client = await open();
      expect(client.status).toBe(101);
      client.socket.send(JSON.stringify({ cmd: CombCmd.HELLO, routeKey: '', routeType: '' }));
      await expect
        .poll(() => client.messages.find((m) => m.cmd === CombCmd.HELLO)?.infoRsp?.memberID)
        .toBeTypeOf('string');
      const memberID = client.messages.find((m) => m.cmd === CombCmd.HELLO)!.infoRsp!.memberID!;
      client.socket.send(
        JSON.stringify({
          cmd: CombCmd.JOIN,
          routeKey: item.id,
          routeType: '',
          joinReq: { rooms: [{ roomID: item.id }] },
        }),
      );
      await expect
        .poll(() => client.messages.find((m) => m.cmd === CombCmd.JOIN)?.code)
        .toBe(CmdRspCode.OK);
      return { ...client, memberID };
    };
    const submit = async (memberID: string, reqId: number, value: string, credential = cookie) => {
      const response = await post(
        `/universer-api/comb/2/unit/${item.id}/new_changes`,
        {
          unitID: item.id,
          type: UniverType.UNIVER_SHEET,
          memberID,
          changeset: {
            unitID: item.id,
            type: UniverType.UNIVER_SHEET,
            userID: owner.id,
            memberID,
            sid: 'raw-session',
            reqId,
            baseRev: 1,
            revision: 0,
            mutations: [
              {
                id: SetRangeValuesMutation.id,
                data: JSON.stringify({
                  unitId: item.id,
                  subUnitId: 'first',
                  cellValue: { 0: { 0: { v: value } } },
                }),
              },
            ],
          },
        },
        credential,
      );
      return { status: response.status, body: await response.json() };
    };
    const load = async () =>
      await (
        await fetch(`${root}/api/items/${item.id}/sheet`, { headers: { Cookie: ownerCookie } })
      ).json();
    let baseline = await load();
    const viewer = await connect();
    const denied = await submit(viewer.memberID, 1, 'never persist this payload');
    // The HTTP envelope acknowledges receipt. Permission rejection is delivered on the socket.
    expect(denied.body.error.code).toBe(ErrorCode.OK);
    await expect
      .poll(() => viewer.messages.some((message) => message.collaMsg?.eventID === 'permission_rej'))
      .toBe(true);
    expect(await load()).toEqual(baseline);
    expect(audit.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'collaboration.edit_denied',
    );
    const events = audit.mock.calls
      .filter((c) => String(c[0]).includes('collaboration.edit_denied'))
      .map((c) => JSON.parse(String(c[0])));
    expect(events[0]).toMatchObject({
      userID: collaborator.id,
      unitID: item.id,
      stage: 'submitChangeset',
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('never persist this payload');
    expect(JSON.stringify(audit.mock.calls)).not.toContain(login.token);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(login.session.token_hash);
    // A granted second document still needs its own scoped socket, not a forged JOIN.
    viewer.socket.send(
      JSON.stringify({
        cmd: CombCmd.JOIN,
        routeKey: other.id,
        routeType: '',
        joinReq: { rooms: [{ roomID: other.id }] },
      }),
    );
    await expect.poll(() => viewer.messages.filter((m) => m.cmd === CombCmd.JOIN).length).toBe(2);
    expect(viewer.messages.filter((m) => m.cmd === CombCmd.JOIN)[1].code).not.toBe(CmdRspCode.OK);
    expect(JSON.stringify(viewer.messages)).not.toContain('Other secret');
    viewer.socket.close();
    await expect.poll(() => viewer.socket.readyState).toBe(WebSocket.CLOSED);
    // Positive control: the same raw mutation really commits when the current role permits it.
    workspace.share(owner.id, item.id, collaborator.id, 'editor');
    const allowed = await connect();
    const accepted = await submit(allowed.memberID, 10, 'authorized raw edit');
    expect(accepted.status).toBe(200);
    expect(accepted.body.error?.code ?? ErrorCode.OK).toBe(ErrorCode.OK);
    baseline = await load();
    expect(baseline.revision).toBe(2);
    expect(baseline.snapshot.sheets.first.cellData[0][0].v).toBe('authorized raw edit');
    allowed.socket.close();
    await expect.poll(() => allowed.socket.readyState).toBe(WebSocket.CLOSED);

    for (const access of ['viewer', null] as const) {
      workspace.share(owner.id, item.id, collaborator.id, 'editor');
      const editor = await connect();
      workspace.share(owner.id, item.id, collaborator.id, access);
      const result = await submit(
        editor.memberID,
        access === null ? 3 : 2,
        'denied after access change',
      );
      expect(result.body.error.code).toBe(ErrorCode.OK);
      expect(await load()).toEqual(baseline);
      await expect.poll(() => editor.socket.readyState).toBe(WebSocket.CLOSED);
      expect(JSON.stringify(editor.messages)).not.toContain('denied after access change');
    }
    // A valid ticket cannot keep a removed grant alive before upgrade either.
    workspace.share(owner.id, item.id, collaborator.id, 'editor');
    const pendingTicket = await getTicket();
    workspace.share(owner.id, item.id, collaborator.id, null);
    expect((await open(cookie, pendingTicket)).status).toBe(403);
  } finally {
    for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    audit.mockRestore();
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 40_000);
