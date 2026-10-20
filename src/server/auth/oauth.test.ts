import type { Response } from 'express';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, randomToken } from './store.ts';
import { AssistantOAuth } from './oauth.ts';
import { currentMcpIdentity } from './mcpIdentity.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
function fixture() {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  let now = 1_000_000;
  const auth = new AuthStore(db, () => now);
  const oauth = new AssistantOAuth(auth, 'https://spinel.example');
  const owner = auth.createUser('Owner');
  const stranger = auth.createUser('Other member');
  const admin = auth.createUser('Operator', true);
  const session = auth.createSession(owner.id).session;
  const client = oauth.clientsStore.registerClient({
    client_name: 'OpenAI test client',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  const resource = new URL(oauth.resource);
  async function pending(scopes = ['documents:read', 'documents:write']) {
    let destination = '';
    const response = {
      redirect(_status: number, url: string) {
        destination = url;
      },
    } as unknown as Response;
    const challenge = randomToken();
    await oauth.authorize(
      client,
      {
        redirectUri: client.redirect_uris[0],
        codeChallenge: challenge,
        state: 'client-state',
        scopes,
        resource,
      },
      response,
    );
    const id = new URL(destination, oauth.origin).searchParams.get('request')!;
    return { id, challenge };
  }
  async function approved(scopes?: string[]) {
    const request = await pending(scopes);
    const details = oauth.details(request.id, session);
    const callback = new URL(oauth.consent(request.id, session, true).redirect);
    return { ...request, details, callback, code: callback.searchParams.get('code')! };
  }
  async function connected(scopes?: string[]) {
    const approval = await approved(scopes);
    const tokens = await oauth.exchangeAuthorizationCode(
      client,
      approval.code,
      undefined,
      client.redirect_uris[0],
      resource,
    );
    return { ...approval, tokens };
  }
  return {
    db,
    auth,
    oauth,
    owner,
    stranger,
    admin,
    session,
    client,
    resource,
    pending,
    approved,
    connected,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

test('connection metadata follows the client and last authenticated use across refresh', async () => {
  const f = fixture();
  const connection = await f.connected();
  expect(connection.callback.origin).toBe('https://client.example');
  expect(connection.callback.searchParams.get('state')).toBe('client-state');
  const before = f.oauth.list(f.owner.id)[0];
  expect(before).toMatchObject({
    name: 'OpenAI test client',
    redirectOrigin: 'https://client.example',
    createdAt: f.now(),
    lastUsedAt: null,
    revoked: false,
  });
  f.advance(1000);
  const first = f.oauth.authenticate(connection.tokens.access_token);
  const firstUsed = f.now();
  expect(f.oauth.list(f.owner.id)[0].lastUsedAt).toBe(firstUsed);
  f.advance(1000);
  const refreshed = await f.oauth.exchangeRefreshToken(
    f.client,
    connection.tokens.refresh_token!,
    undefined,
    f.resource,
  );
  // Refresh is credential maintenance, not document use or a new connection.
  expect(f.oauth.list(f.owner.id)).toHaveLength(1);
  expect(f.oauth.list(f.owner.id)[0].lastUsedAt).toBe(firstUsed);
  const next = f.oauth.authenticate(refreshed.access_token);
  expect(next.connectionId).toBe(first.connectionId);
  expect(next.id).not.toBe(first.id);
  expect(f.oauth.list(f.owner.id)[0].lastUsedAt).toBe(f.now());
  expect(f.oauth.list(f.stranger.id)).toEqual([]);
  expect(() => f.oauth.list(f.owner.id, true)).toThrow('Not found');
  const metadata = JSON.stringify(f.oauth.list(f.admin.id, true));
  expect(metadata).toContain('OpenAI test client');
  expect(metadata).not.toMatch(/spinel_oauth_|token_hash|refresh_token/);
  const stored = JSON.stringify([
    f.db.prepare('SELECT * FROM oauth_codes').all(),
    f.db.prepare('SELECT * FROM oauth_access').all(),
    f.db.prepare('SELECT * FROM oauth_refresh').all(),
  ]);
  for (const secret of [
    connection.code,
    connection.tokens.access_token,
    connection.tokens.refresh_token!,
  ])
    expect(stored).not.toContain(secret);
});

test('consent is single-use, bound to the reviewing session, and can be cancelled', async () => {
  const f = fixture();
  const request = await f.pending();
  expect(() => f.oauth.consent(request.id, f.session, true)).toThrow('Review');
  f.oauth.details(request.id, f.session);
  const other = f.auth.createSession(f.stranger.id).session;
  expect(() => f.oauth.details(request.id, other)).toThrow('browser');
  expect(() => f.oauth.consent(request.id, other, true)).toThrow('browser');
  const cancelled = new URL(f.oauth.consent(request.id, f.session, false).redirect);
  expect(cancelled.searchParams.get('error')).toBe('access_denied');
  expect(cancelled.searchParams.get('state')).toBe('client-state');
  expect(cancelled.searchParams.has('code')).toBe(false);
  expect(f.oauth.list(f.owner.id)).toEqual([]);
  expect(() => f.oauth.consent(request.id, f.session, true)).toThrow('expired');
  const next = await f.pending();
  expect(() => f.oauth.details(next.id, f.auth.createSession(f.admin.id).session)).toThrow(
    'everyday',
  );
  f.advance(10 * 60_000 + 1);
  expect(() => f.oauth.details(next.id, f.session)).toThrow('expired');
});

test('codes bind client, callback and resource, then allow only one concurrent redemption', async () => {
  const f = fixture();
  const approval = await f.approved();
  expect(await f.oauth.challengeForAuthorizationCode(f.client, approval.code)).toBe(
    approval.challenge,
  );
  const other = f.oauth.clientsStore.registerClient({
    client_name: 'Other client',
    redirect_uris: ['https://other.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  await expect(
    f.oauth.exchangeAuthorizationCode(
      other,
      approval.code,
      undefined,
      f.client.redirect_uris[0],
      f.resource,
    ),
  ).rejects.toThrow();
  await expect(
    f.oauth.exchangeAuthorizationCode(
      f.client,
      approval.code,
      undefined,
      'https://evil.example/callback',
      f.resource,
    ),
  ).rejects.toThrow('callback');
  await expect(
    f.oauth.exchangeAuthorizationCode(
      f.client,
      approval.code,
      undefined,
      f.client.redirect_uris[0],
    ),
  ).rejects.toThrow('endpoint');
  await expect(
    f.oauth.exchangeAuthorizationCode(
      f.client,
      approval.code,
      undefined,
      f.client.redirect_uris[0],
      new URL('https://other.example/mcp'),
    ),
  ).rejects.toThrow('endpoint');
  const redeem = () =>
    f.oauth.exchangeAuthorizationCode(
      f.client,
      approval.code,
      undefined,
      f.client.redirect_uris[0],
      f.resource,
    );
  const results = await Promise.allSettled([redeem(), redeem()]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  await expect(f.oauth.challengeForAuthorizationCode(f.client, approval.code)).rejects.toThrow(
    'already used',
  );
});

test('sign-out, account changes and code expiry prevent completing stale approvals', async () => {
  const f = fixture();
  const approval = await f.approved();
  f.auth.revokeSession(f.session.token_hash);
  await expect(
    f.oauth.exchangeAuthorizationCode(
      f.client,
      approval.code,
      undefined,
      f.client.redirect_uris[0],
      f.resource,
    ),
  ).rejects.toThrow();
  const g = fixture();
  const expired = await g.approved();
  g.advance(60_001);
  await expect(
    g.oauth.exchangeAuthorizationCode(
      g.client,
      expired.code,
      undefined,
      g.client.redirect_uris[0],
      g.resource,
    ),
  ).rejects.toThrow('expired');
  const h = fixture();
  const swapped = await h.approved();
  h.db
    .prepare('UPDATE auth_sessions SET user_id=? WHERE token_hash=?')
    .run(h.stranger.id, h.session.token_hash);
  await expect(
    h.oauth.exchangeAuthorizationCode(
      h.client,
      swapped.code,
      undefined,
      h.client.redirect_uris[0],
      h.resource,
    ),
  ).rejects.toThrow();
});

test('refresh is resource and client bound, cannot expand scope, and detects reuse', async () => {
  const f = fixture();
  const { tokens } = await f.connected(['documents:read']);
  const other = f.oauth.clientsStore.registerClient({
    client_name: 'Other client',
    redirect_uris: ['https://other.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  await expect(f.oauth.exchangeRefreshToken(f.client, tokens.refresh_token!)).rejects.toThrow(
    'endpoint',
  );
  await expect(
    f.oauth.exchangeRefreshToken(
      f.client,
      tokens.refresh_token!,
      undefined,
      new URL('https://other.example/mcp'),
    ),
  ).rejects.toThrow('endpoint');
  await expect(
    f.oauth.exchangeRefreshToken(other, tokens.refresh_token!, undefined, f.resource),
  ).rejects.toThrow();
  await expect(
    f.oauth.exchangeRefreshToken(
      f.client,
      tokens.refresh_token!,
      ['documents:read', 'documents:write'],
      f.resource,
    ),
  ).rejects.toThrow('access');
  const next = await f.oauth.exchangeRefreshToken(
    f.client,
    tokens.refresh_token!,
    undefined,
    f.resource,
  );
  expect(f.oauth.authenticate(next.access_token).scopes).toEqual(['documents:read']);
  await expect(
    f.oauth.exchangeRefreshToken(f.client, tokens.refresh_token!, undefined, f.resource),
  ).rejects.toThrow('reuse');
  expect(() => f.oauth.authenticate(tokens.access_token)).toThrow('no longer');
  expect(() => f.oauth.authenticate(next.access_token)).toThrow('no longer');
  await expect(
    f.oauth.exchangeRefreshToken(f.client, next.refresh_token!, undefined, f.resource),
  ).rejects.toThrow('no longer');
});

test('current identity checks scope, expiry, account and connection revocation at use time', async () => {
  const f = fixture();
  const { tokens } = await f.connected(['documents:read']);
  const identity = f.oauth.authenticate(tokens.access_token);
  const custom = {
    mcpTokenHash: identity.hash,
    mcpConnectionId: identity.connectionId,
    mcpResource: f.oauth.resource,
  };
  expect(currentMcpIdentity(f.auth, custom).userId).toBe(f.owner.id);
  expect(() => currentMcpIdentity(f.auth, custom, true)).toThrow('required document access');
  expect(() => currentMcpIdentity(f.auth, { ...custom, mcpConnectionId: 'other' })).toThrow();
  expect(() =>
    currentMcpIdentity(f.auth, { ...custom, mcpResource: 'https://other.example/mcp' }),
  ).toThrow();
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => currentMcpIdentity(f.auth, custom)).toThrow('no longer');
  f.db.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(f.owner.id);
  f.advance(15 * 60_000 + 1);
  expect(() => currentMcpIdentity(f.auth, custom)).toThrow('no longer');
  const next = await f.oauth.exchangeRefreshToken(
    f.client,
    tokens.refresh_token!,
    undefined,
    f.resource,
  );
  const renewed = f.oauth.authenticate(next.access_token);
  expect(() => f.oauth.disconnect(f.stranger.id, renewed.connectionId)).toThrow('not found');
  f.oauth.disconnect(f.owner.id, renewed.connectionId);
  expect(() => currentMcpIdentity(f.auth, { ...custom, mcpTokenHash: renewed.hash })).toThrow(
    'no longer',
  );
  await expect(
    f.oauth.exchangeRefreshToken(f.client, next.refresh_token!, undefined, f.resource),
  ).rejects.toThrow('no longer');
});

test('disconnect also prevents redeeming outstanding codes and refresh tokens expire', async () => {
  const f = fixture();
  const approval = await f.approved();
  f.oauth.disconnect(f.owner.id, String(f.oauth.list(f.owner.id)[0].id));
  await expect(
    f.oauth.exchangeAuthorizationCode(
      f.client,
      approval.code,
      undefined,
      f.client.redirect_uris[0],
      f.resource,
    ),
  ).rejects.toThrow('no longer');
  const g = fixture();
  const { tokens } = await g.connected();
  g.advance(30 * 24 * 60 * 60_000 + 1);
  await expect(
    g.oauth.exchangeRefreshToken(g.client, tokens.refresh_token!, undefined, g.resource),
  ).rejects.toThrow('expired');
});

test('registration rejects unsafe callback schemes and prunes unused registrations', async () => {
  const f = fixture();
  for (const callback of [
    'http://remote.example/callback',
    'javascript:alert(1)',
    'https://client.example/callback#fragment',
    'https://user:password@client.example/callback',
  ]) {
    expect(() =>
      f.oauth.clientsStore.registerClient({
        client_name: 'Client',
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
      }),
    ).toThrow('valid HTTPS');
  }
  await f.connected();
  const unused = f.oauth.clientsStore.registerClient({
    client_name: 'Unused',
    redirect_uris: ['http://127.0.0.1:12345/callback'],
    token_endpoint_auth_method: 'none',
  });
  f.advance(24 * 60 * 60_000 + 1);
  f.oauth.clientsStore.registerClient({
    client_name: 'New',
    redirect_uris: ['https://new.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  expect(f.oauth.clientsStore.getClient(unused.client_id)).toBeUndefined();
  expect(f.oauth.clientsStore.getClient(f.client.client_id)?.client_name).toBe(
    'OpenAI test client',
  );
});

test('authorization requires this resource and only the supported document scopes', async () => {
  const f = fixture();
  await expect(f.pending(['documents:write'])).rejects.toThrow('read access');
  await expect(f.pending(['documents:read', 'admin'])).rejects.toThrow('read access');
  for (const resource of [undefined, new URL('https://other.example/mcp')]) {
    await expect(
      f.oauth.authorize(
        f.client,
        {
          redirectUri: f.client.redirect_uris[0],
          codeChallenge: randomToken(),
          resource,
        },
        {} as Response,
      ),
    ).rejects.toThrow('endpoint');
  }
  expect(f.db.prepare('SELECT count(*) AS n FROM oauth_pending').get()!.n).toBe(0);
});
