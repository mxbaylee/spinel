import express from 'express';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME, VERIFICATION_MS } from './store.ts';
import { authRoutes } from './routes.ts';

test('self-access HTTP enforces cookie, origin, body, account, fresh proof and durable revocation', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  let now = 1_000_000;
  const store = new AuthStore(db, () => now);
  const user = store.createUser('Owner'),
    other = store.createUser('Other');
  for (const [key, owner] of [
    ['current', user.id],
    ['lost', user.id],
    ['other', other.id],
  ])
    db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      key,
      owner,
      new Uint8Array([1]),
      0,
      '[]',
      key,
      'Passkey',
      now,
      null,
      0,
      'singleDevice',
    );
  const current = store.createSession(user.id, undefined, 'current');
  const lost = store.createSession(user.id, undefined, 'lost');
  const otherSession = store.createSession(other.id, undefined, 'other');
  let changes = 0,
    refreshFails = false;
  const app = express();
  app.use(
    '/api/auth',
    authRoutes(store, 'http://localhost:3000', async () => {
      changes++;
      if (refreshFails) throw new Error('private hook failure');
    }),
  );
  const server = createServer(app);
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`;
  const request = (
    path: string,
    {
      token = current.token,
      method = 'POST',
      body = '{}',
      origin = 'http://localhost:3000',
      content = 'application/json',
    } = {},
  ) =>
    fetch(root + path, {
      method,
      headers: {
        Cookie: `${COOKIE_NAME}=${token}`,
        Origin: origin,
        'Content-Type': content,
        'X-Spinel-Account': user.id,
      },
      ...(method === 'POST' ? { body } : {}),
    });
  try {
    expect((await request('/sign-out-others', { token: '' })).status).toBe(401);
    expect((await request('/sign-out-others', { origin: 'https://evil.example' })).status).toBe(
      403,
    );
    expect((await request('/sign-out-others', { content: 'text/plain' })).status).toBe(403);
    for (const body of ['[]', '{"userId":"other"}', 'null'])
      expect((await request('/sign-out-others', { body })).status).toBe(400);
    expect((await request('/passkeys/lost/remove')).status).toBe(428);
    expect((await request('/registration/options')).status).toBe(428);
    const options = await request('/reauthentication/options');
    expect(options.status).toBe(200);
    const ceremony = await options.json();
    expect(ceremony.options.userVerification).toBe('required');
    expect(ceremony.options.allowCredentials.map((key: { id: string }) => key.id)).toEqual([
      'current',
      'lost',
    ]);
    expect((await request('/reauthentication/verify', { body: '{}' })).status).toBe(400);
    expect((await request('/reauthentication/options', { token: '' })).status).toBe(401);
    store.markVerified(current.session, 'current');
    const list = await request('/passkeys', { method: 'GET' });
    expect(list.headers.get('cache-control')).toBe('no-store');
    const listed = await list.json();
    expect(listed.verifiedUntil).toBe(now + VERIFICATION_MS);
    expect(listed.passkeys).toEqual([
      expect.objectContaining({ id: 'current', current: true }),
      expect.objectContaining({ id: 'lost', current: false }),
    ]);
    expect(JSON.stringify(listed)).not.toMatch(/public_key|token_hash|verified_passkey_id/);
    expect((await request('/passkeys/other/remove')).status).toBe(404);
    const before = store.passkeys(user.id);
    now += VERIFICATION_MS;
    expect((await request('/sign-out-others')).status).toBe(428);
    expect(store.passkeys(user.id)).toEqual(before);
    store.markVerified(current.session, 'current');
    const signedOut = await request('/sign-out-others');
    expect(signedOut.status).toBe(200);
    expect(await signedOut.json()).toEqual({ signedOutOthers: true });
    expect(store.session(current.token)).toBeDefined();
    expect(store.session(lost.token)).toBeUndefined();
    expect(store.session(otherSession.token)).toBeDefined();
    expect(changes).toBe(1);
    // Hook failure occurs after a committed removal; response must describe the durable result.
    refreshFails = true;
    const removed = await request('/passkeys/lost/remove');
    expect(removed.status).toBe(503);
    expect((await removed.json()).error).toMatch(/Passkey removed and its sessions ended/);
    expect(store.passkey('lost')).toBeUndefined();
    expect((await request('/passkeys/current/remove')).status).toBe(409);
    expect(changes).toBe(2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
  }
});

test('a stale profile cannot read or change the replacement cookie account', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const store = new AuthStore(db);
  const first = store.createUser('First account');
  const second = store.createUser('Second account');
  for (const user of [first, second])
    for (const suffix of ['current', 'other'])
      db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
        `${user.id}-${suffix}`,
        user.id,
        new Uint8Array([1]),
        0,
        '[]',
        suffix,
        'Passkey',
        store.now(),
        null,
        0,
        'singleDevice',
      );
  const firstSession = store.createSession(first.id, undefined, `${first.id}-current`);
  const secondSession = store.createSession(second.id, undefined, `${second.id}-current`);
  const secondOther = store.createSession(second.id, undefined, `${second.id}-other`);
  store.markVerified(firstSession.session, `${first.id}-current`);
  store.markVerified(secondSession.session, `${second.id}-current`);
  let changes = 0;
  const app = express();
  app.use(
    '/api/auth',
    authRoutes(store, 'http://localhost:3000', async () => {
      changes++;
    }),
  );
  const server = createServer(app);
  await new Promise<void>((ready, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`;
  const verification = JSON.stringify({
    challengeId: 'a'.repeat(43),
    response: { id: `${second.id}-current`, response: {} },
  });
  const routes = [
    ['/passkeys', 'GET', undefined],
    ['/reauthentication/options', 'POST', '{}'],
    ['/reauthentication/verify', 'POST', verification],
    [`/passkeys/${second.id}-other/remove`, 'POST', '{}'],
    ['/sign-out-others', 'POST', '{}'],
    ['/registration/options', 'POST', '{}'],
    ['/registration/verify', 'POST', verification],
  ] as const;
  const request = (
    path: string,
    method: string,
    body: string | undefined,
    expected: string | null,
    token = secondSession.token,
  ) =>
    fetch(root + path, {
      method,
      headers: {
        Cookie: `${COOKIE_NAME}=${token}`,
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
        ...(expected === null ? {} : { 'X-Spinel-Account': expected }),
      },
      body,
    });
  try {
    const sessions = db.prepare('SELECT * FROM auth_sessions ORDER BY token_hash').all();
    const passkeys = db.prepare('SELECT * FROM auth_passkeys ORDER BY id').all();
    const challenges = db.prepare('SELECT * FROM auth_challenges ORDER BY id').all();
    for (const [path, method, body] of routes) {
      // A fresh proof in B must not authorize a tab still presenting account A.
      for (const expected of [first.id, '', `${second.id}, ${second.id}`, null]) {
        const response = await request(path, method, body, expected);
        expect(response.status, `${method} ${path}; expected account ${String(expected)}`).toBe(
          expected === null ? 400 : 409,
        );
        expect(await response.json()).toEqual({
          error: 'Your account changed. Reload your profile before changing access.',
          code: 'account_changed',
        });
      }
    }
    // Supplying B's ID with A's cookie cannot select B's authority either.
    expect(
      (await request('/sign-out-others', 'POST', '{}', second.id, firstSession.token)).status,
    ).toBe(409);
    expect(db.prepare('SELECT * FROM auth_sessions ORDER BY token_hash').all()).toEqual(sessions);
    expect(db.prepare('SELECT * FROM auth_passkeys ORDER BY id').all()).toEqual(passkeys);
    expect(db.prepare('SELECT * FROM auth_challenges ORDER BY id').all()).toEqual(challenges);
    expect(changes).toBe(0);

    const current = await request('/passkeys', 'GET', undefined, second.id);
    expect(current.status).toBe(200);
    expect((await current.json()).passkeys.map((key: { id: string }) => key.id)).toEqual([
      `${second.id}-current`,
      `${second.id}-other`,
    ]);
    const signedOut = await request('/sign-out-others', 'POST', '{}', second.id);
    expect(signedOut.status).toBe(200);
    expect(store.session(secondSession.token)).toBeDefined();
    expect(store.session(secondOther.token)).toBeUndefined();
    expect(store.session(firstSession.token)).toBeDefined();
    expect(store.passkeys(second.id)).toHaveLength(2);
    expect(changes).toBe(1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
  }
});
