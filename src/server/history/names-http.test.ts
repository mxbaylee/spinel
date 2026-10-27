import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import WebSocket from 'ws';
import { JSONX } from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { openSyncSocket } from '../collaboration/transport.fixture.ts';
import type { SocketClient } from '../collaboration/transport.fixture.ts';

test('history naming routes enforce current access, sessions, origin and document scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-names-http-'));
  const path = join(directory, 'db.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const app = await createApp({ databasePath: path, staticDirectory: directory });
  const db = openDatabase(path);
  const sockets: WebSocket[] = [];
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Owner'),
      editor = auth.createUser('Editor'),
      viewer = auth.createUser('Viewer'),
      other = auth.createUser('Other'),
      admin = auth.createUser('Operator', true);
    const sessions = [owner, editor, viewer, other, admin].map((u) => auth.createSession(u.id));
    const request = (
      suffix: string,
      who = 0,
      method = 'GET',
      data?: unknown,
      origin = 'http://localhost:3000',
    ) =>
      fetch(root + '/api/items' + suffix, {
        method,
        headers: {
          Cookie: who < 0 ? '' : `${COOKIE_NAME}=${sessions[who].token}`,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    const item = workspace.create(owner.id, { name: 'Named doc', kind: 'doc', parentId: null });
    const foreign = workspace.create(other.id, { name: 'Other doc', kind: 'doc', parentId: null });
    workspace.share(owner.id, item.id, editor.id, 'editor');
    workspace.share(owner.id, item.id, viewer.id, 'viewer');
    expect(
      (
        await request(`/${item.id}/doc`, 0, 'PUT', {
          snapshot: { id: item.id, body: { dataStream: 'Contents\r\n' } },
          revision: 0,
          writeId: randomUUID(),
        })
      ).ok,
    ).toBe(true);
    const result = await request(`/${item.id}/history`, 1, 'POST', { name: 'Checkpoint' });
    expect(result.status).toBe(201);
    const point = (await result.json()).version;
    const list = await request(`/${item.id}/history`, 2);
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect(await list.json()).toMatchObject({
      canName: false,
      versions: [{ id: point.id, name: 'Checkpoint' }],
    });
    for (const who of [-1, 2, 3, 4]) {
      expect((await request(`/${item.id}/history`, who, 'POST', { name: 'Denied' })).ok).toBe(
        false,
      );
      expect(
        (await request(`/${item.id}/history/${point.id}`, who, 'PATCH', { name: null })).ok,
      ).toBe(false);
    }
    expect(
      (await request(`/${foreign.id}/history/${point.id}`, 3, 'PATCH', { name: 'Wrong doc' }))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          `/${item.id}/history/${point.id}`,
          1,
          'PATCH',
          { name: 'Bad origin' },
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(`/${item.id}/history`, 0, 'POST', { name: ' ', unexpected: true })).status,
    ).toBe(400);
    const restorePath = `/${item.id}/history/${point.id}/restore`;
    const restoreBody = { unitId: item.id, requestId: randomUUID() };
    for (const who of [-1, 2, 3, 4])
      expect((await request(restorePath, who, 'POST', restoreBody)).ok).toBe(false);
    expect(
      (await request(restorePath, 1, 'POST', restoreBody, 'https://evil.example')).status,
    ).toBe(403);
    const restored = await request(restorePath, 1, 'POST', restoreBody);
    expect(restored.status).toBe(200);
    const active = (await restored.json()).unitId as string;
    expect(active).not.toBe(item.id);
    const cookie = (who: number) => (who < 0 ? '' : `${COOKIE_NAME}=${sessions[who].token}`);
    const syncRequest = (
      action: 'snapshot' | 'ticket',
      who = 0,
      unitId = active,
      itemId = item.id,
    ) =>
      fetch(`${root}/sync-api/items/${itemId}/${action}?unitId=${unitId}`, {
        method: action === 'ticket' ? 'POST' : 'GET',
        headers: { Cookie: cookie(who), Origin: 'http://localhost:3000' },
      });
    const ticket = async (who: number) => {
      const response = await syncRequest('ticket', who);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      return (await response.json()).ticket as string;
    };
    const open = (who: number, token: string, unitId = active) =>
      openSyncSocket(
        `${root.replace('http:', 'ws:')}/sync-api/items/${item.id}/socket?unitId=${unitId}&ticket=${encodeURIComponent(token)}`,
        cookie(who),
        'http://localhost:3000',
        sockets,
      );
    const connect = async (who: number) => {
      const client = await open(who, await ticket(who));
      expect(client.status).toBe(101);
      await expect
        .poll(() => client.messages.some((frame) => frame.type === 'snapshot'))
        .toBe(true);
      expect(client.messages.find((frame) => frame.type === 'snapshot')).toMatchObject({
        unitId: active,
        snapshot: { id: active, body: { dataStream: 'Contents\r\n' } },
      });
      return client;
    };
    // Native access is bound to both the stable item and its active generation.
    for (const [who, access] of [
      [1, 'editor'],
      [2, 'viewer'],
    ] as const) {
      const metadata = await request(`/${item.id}/collaboration`, who, 'POST', {});
      expect(metadata.status).toBe(200);
      expect(await metadata.json()).toMatchObject({ unitId: active, access, syncVersion: 1 });
      const snapshot = await syncRequest('snapshot', who);
      expect(snapshot.status).toBe(200);
      expect(await snapshot.json()).toMatchObject({
        version: 1,
        unitId: active,
        snapshot: { id: active, body: { dataStream: 'Contents\r\n' } },
      });
      expect(
        (await request(`/${item.id}/sharing`, who, 'PUT', { userId: other.id, role: 'viewer' })).ok,
      ).toBe(false);
    }
    for (const [who, unitId, itemId] of [
      [-1, active, item.id],
      [3, active, item.id],
      [4, active, item.id],
      [1, item.id, item.id],
      [1, active, foreign.id],
    ] as const) {
      for (const action of ['snapshot', 'ticket'] as const) {
        const response = await syncRequest(action, who, unitId, itemId);
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain('Contents');
      }
    }
    const editorClient = await connect(1);
    const viewerClient = await connect(2);
    const before = (await (await syncRequest('snapshot')).json()) as {
      revision: number;
      snapshot: IDocumentData;
    };
    const submit = async (
      client: SocketClient,
      revision: number,
      body: IDocumentData['body'],
      value: string,
    ) => {
      const mutationId = randomUUID();
      client.socket.send(
        JSON.stringify({
          type: 'submit',
          mutationId,
          baseRevision: revision,
          mutations: [
            {
              id: RichTextEditingMutation.id,
              params: {
                unitId: active,
                actions: new JSONX().replaceOp(['body'], body, { dataStream: value + '\r\n' }),
                textRanges: [],
              },
            },
          ],
        }),
      );
      await expect
        .poll(
          () =>
            client.messages.some(
              (frame) => frame.mutationId === mutationId && ['ack', 'resync'].includes(frame.type),
            ) || client.socket.readyState === WebSocket.CLOSED,
        )
        .toBe(true);
      return client.messages.find(
        (frame) => frame.mutationId === mutationId && ['ack', 'resync'].includes(frame.type),
      );
    };
    expect(
      (await submit(viewerClient, before.revision, before.snapshot.body, 'Denied viewer edit'))
        ?.type,
    ).toBe('resync');
    expect(await (await syncRequest('snapshot')).json()).toEqual(before);
    expect(
      await submit(editorClient, before.revision, before.snapshot.body, 'Edited after restore'),
    ).toMatchObject({ type: 'ack', revision: before.revision + 1 });
    const saved = await (await syncRequest('snapshot')).json();
    expect(saved.snapshot.body.dataStream).toBe('Edited after restore\r\n');
    const staleTicket = await ticket(1);
    workspace.share(owner.id, item.id, editor.id, null);
    await submit(editorClient, saved.revision, saved.snapshot.body, 'Denied revoked edit');
    await expect.poll(() => editorClient.socket.readyState).toBe(WebSocket.CLOSED);
    expect((await open(1, staleTicket)).status).toBe(403);
    for (const action of ['snapshot', 'ticket'] as const)
      expect((await syncRequest(action, 1)).status).toBe(403);
    expect(await (await syncRequest('snapshot')).json()).toEqual(saved);
    expect((await request(`/${item.id}/history`, 1)).status).toBe(404);
    expect(
      (await request(`/${item.id}/history/${point.id}`, 0, 'PATCH', { name: 'Renamed' })).ok,
    ).toBe(true);
    auth.revokeSession(sessions[0].session.token_hash);
    expect((await request(`/${item.id}/history`, 0)).status).toBe(401);
    expect((await syncRequest('snapshot')).status).toBe(403);
    expect((await syncRequest('ticket')).status).toBe(403);
  } finally {
    for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
