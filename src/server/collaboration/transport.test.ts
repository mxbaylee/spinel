import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'vitest';
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
      fetch(`${root}/universer-api/user/session-ticket`, {
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
    const snapshot = `${root}/universer-api/snapshot/2/unit/${item.id}/rev/0`;
    expect((await fetch(snapshot, { headers: { Cookie: cookie } })).ok).toBe(true);
    const foreign = `${COOKIE_NAME}=${auth.createSession(unrelated.id).token}`;
    const denied = await fetch(snapshot, { headers: { Cookie: foreign } });
    expect(await denied.text()).not.toContain('Budget');
    const granted = await ticket();
    expect(granted.headers.get('cache-control')).toBe('no-store');
    const { ticket: opaque } = await granted.json();
    expect(typeof opaque).toBe('string');
    const upgrade = (value: string, suppliedOrigin = origin, credential = cookie) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          `${root}/universer-api/comb/connect?sessionTicket=${encodeURIComponent(value)}`,
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
