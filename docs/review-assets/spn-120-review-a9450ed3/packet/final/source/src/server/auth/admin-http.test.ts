import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from './store.ts';

test('admin pages and APIs conceal users from non-admins and revoke only requested access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-admin-http-')),
    path = join(directory, 'app.sqlite');
  await writeFile(join(directory, 'index.html'), 'Admin fixture');
  const app = await createApp({ databasePath: path, staticDirectory: directory });
  const db = openDatabase(path);
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const auth = new AuthStore(db),
      operator = auth.createUser('Operator', true),
      user = auth.createUser('Member');
    for (const key of ['first', 'second'])
      db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
        key,
        user.id,
        Buffer.from([1]),
        0,
        '[]',
        key,
        'Browser',
        auth.now(),
        1234,
        0,
        'singleDevice',
      );
    const admin = auth.createSession(operator.id),
      first = auth.createSession(user.id, undefined, 'first'),
      second = auth.createSession(user.id, undefined, 'second');
    const request = (
      path: string,
      token = admin.token,
      method = 'GET',
      origin = 'http://localhost:3000',
    ) =>
      fetch(root + path, {
        method,
        redirect: 'manual',
        headers: {
          Cookie: `${COOKIE_NAME}=${token}`,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
    for (const token of ['', first.token])
      for (const path of [
        '/admin',
        '/admin/',
        '/ADMIN',
        '/api/auth/admin/users',
        '/api/auth/invites',
        '/api/auth/invites/recipients',
      ])
        expect((await request(path, token)).status).toBe(404);
    const list = await request('/api/auth/admin/users');
    expect(list.headers.get('cache-control')).toBe('no-store');
    const users = (await list.json()).users;
    expect(users.find((u: { id: string }) => u.id === user.id)).toMatchObject({
      name: 'Member',
      isAdmin: false,
      disabled: false,
      passkeys: [
        { name: 'first', lastUsedAt: 1234 },
        { name: 'second', lastUsedAt: 1234 },
      ],
    });
    expect(JSON.stringify(users)).not.toMatch(/public_key|token_hash/);
    const remove = `/api/auth/admin/users/${user.id}/passkeys/first/remove`;
    expect((await request(remove, first.token, 'POST')).status).toBe(404);
    expect((await request(remove, admin.token, 'POST', 'https://evil.example')).status).toBe(403);
    expect((await request(remove, admin.token, 'POST')).status).toBe(204);
    expect((await request('/api/auth/session', first.token)).status).toBe(401);
    expect((await request('/api/auth/session', second.token)).status).toBe(200);
    expect(
      (await request(`/api/auth/admin/users/${user.id}/disable`, admin.token, 'POST')).status,
    ).toBe(204);
    expect((await request('/api/auth/session', second.token)).status).toBe(401);
    expect(db.prepare('SELECT disabled FROM auth_users WHERE id=?').get(user.id)?.disabled).toBe(1);
    expect(
      (await request(`/api/auth/admin/users/${operator.id}/disable`, admin.token, 'POST')).status,
    ).toBe(409);
  } finally {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
