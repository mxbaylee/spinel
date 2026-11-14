import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from './store.ts';
import { authRoutes } from './routes.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner'),
    other = auth.createUser('Other');
  const signed = auth.createSession(owner.id),
    second = auth.createSession(other.id);
  const anonymous = auth.createSession(null);
  const app = express();
  const origin = 'http://localhost:3000';
  app.use('/api/auth', authRoutes(auth, origin));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const root = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const signOut = (token: string, expected?: string, overrides: Record<string, string> = {}) =>
    fetch(root + '/api/auth/sign-out', {
      method: 'POST',
      headers: {
        Cookie: COOKIE_NAME + '=' + token,
        Origin: origin,
        'Content-Type': 'application/json',
        ...(expected === undefined ? {} : { 'X-Spinel-Offline-Account': expected }),
        ...overrides,
      },
      body: '{}',
    });
  return { auth, owner, other, signed, second, anonymous, signOut };
}

test('logout revokes only the expected presented session, confirms with 204 and never clears a later cookie', async () => {
  const f = await fixture();
  const otherDevice = f.auth.createSession(f.owner.id);
  const response = await f.signOut(f.signed.token, f.owner.id);
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(f.auth.session(f.signed.token)).toBeUndefined();
  expect(f.auth.session(otherDevice.token)?.user_id).toBe(f.owner.id);
  expect(f.auth.session(f.second.token)?.user_id).toBe(f.other.id);
  // Repeating a lost-response request has no cookie mutation either.
  const retry = await f.signOut(f.signed.token, f.owner.id);
  expect(retry.status).toBe(204);
  expect(retry.headers.get('set-cookie')).toBeNull();
});

test('a replaced account or new anonymous ceremony is not revoked by the earlier account exit', async () => {
  const f = await fixture();
  for (const token of [f.second.token, f.anonymous.token]) {
    const response = await f.signOut(token, f.owner.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'The account changed before sign-out finished.',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(f.auth.session(token)).toBeDefined();
  }
});

test('missing or expired credentials already satisfy logout; malformed fences and unsafe requests do not', async () => {
  const f = await fixture();
  const expired = f.auth.createSession(f.owner.id, -1);
  for (const token of ['', 'invalid', expired.token]) {
    const response = await f.signOut(token, f.owner.id);
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toBeNull();
  }
  expect((await f.signOut(f.signed.token, 'not-an-account')).status).toBe(400);
  for (const headers of [
    { Origin: 'https://another.example' },
    { 'Content-Type': 'text/plain' },
  ] as Record<string, string>[])
    expect((await f.signOut(f.signed.token, f.owner.id, headers)).status).toBe(403);
  expect(f.auth.session(f.signed.token)).toBeDefined();
});

test('an anonymous exit cannot revoke a later account or an unrelated anonymous ceremony', async () => {
  const f = await fixture();
  const challenge = f.auth.addChallenge(f.anonymous.session, 'authentication', 'new-ceremony');
  const taken = f.auth.takeChallenge(challenge.id, f.anonymous.session, 'authentication');
  for (const token of ['', 'invalid', f.anonymous.token]) {
    const response = await f.signOut(token, 'anonymous');
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toBeNull();
  }
  expect(f.auth.session(f.anonymous.token)).toBeDefined();
  expect(() => f.auth.assertPending(taken)).not.toThrow();
  for (const token of [f.signed.token, f.second.token]) {
    const response = await f.signOut(token, 'anonymous');
    expect(response.status).toBe(409);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(f.auth.session(token)).toBeDefined();
  }
});

test('legacy explicit online logout still works and an in-flight challenge cannot finish after revocation', async () => {
  const f = await fixture();
  const challenge = f.auth.addChallenge(f.signed.session, 'authentication', 'challenge');
  const taken = f.auth.takeChallenge(challenge.id, f.signed.session, 'authentication');
  expect((await f.signOut(f.signed.token)).status).toBe(204);
  expect(() => f.auth.assertPending(taken)).toThrow('Passkey request expired');
});
