import { DatabaseSync } from '../../../server/database.ts';
import { afterEach, expect, test, vi } from 'vitest';
import type {
  AuthenticationResponseJSON,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import { AuthStore, VERIFICATION_MS, AuthError } from './store.ts';
import { AuthService } from './service.ts';
import { AdminStore } from './admin.ts';
import { InvitationService } from './invitations.ts';
import { AssistantOAuth } from './oauth.ts';
import { AccessTokens } from './tokens.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture(admin = false) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('PRAGMA foreign_keys=ON');
  let now = 1_000_000;
  const store = new AuthStore(db, () => now);
  const user = store.createUser('Owner', admin);
  const other = store.createUser('Other');
  const addKey = (id: string, userId = user.id) =>
    db
      .prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, userId, new Uint8Array([1]), 0, '[]', id, 'Passkey', now, null, 0, 'singleDevice');
  addKey('current');
  addKey('lost');
  addKey('other', other.id);
  const current = store.createSession(user.id, undefined, 'current');
  const lost = store.createSession(user.id, undefined, 'lost');
  const sameKey = store.createSession(user.id, undefined, 'current');
  const legacy = store.createSession(user.id);
  const otherSession = store.createSession(other.id, undefined, 'other');
  const verified: VerifiedAuthenticationResponse = {
    verified: true,
    authenticationInfo: {
      credentialID: 'current',
      newCounter: 1,
      userVerified: true,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      origin: 'http://localhost:3000',
      rpID: 'localhost',
    },
  };
  const verify = {
    verifyAuthenticationResponse: vi.fn(async () => verified),
    verifyRegistrationResponse: vi.fn(),
  };
  const service = new AuthService(store, 'http://localhost:3000', verify);
  const response = {
    id: 'current',
    response: { userHandle: Buffer.from(user.id).toString('base64url') },
  } as AuthenticationResponseJSON;
  return {
    db,
    store,
    user,
    other,
    addKey,
    current,
    lost,
    sameKey,
    legacy,
    otherSession,
    service,
    verify,
    verified,
    response,
    advance: (ms: number) => {
      now += ms;
    },
    fresh: () => store.markVerified(current.session, 'current'),
  };
}

test('proof belongs to one current session; legacy, stale, future and revoked proofs fail closed', () => {
  const f = fixture();
  expect(() => f.store.signOutOthers(f.current.session)).toThrow(AuthError);
  f.fresh();
  expect(f.store.verifiedUntil(f.current.session)).toBe(1_000_000 + VERIFICATION_MS);
  expect(f.store.verifiedUntil(f.sameKey.session)).toBeNull();
  expect(() => f.store.signOutOthers(f.sameKey.session)).toThrow('Verify with a passkey');
  f.advance(VERIFICATION_MS);
  expect(() => f.store.removeOwnPasskey(f.current.session, 'lost')).toThrow(
    'Verify with a passkey',
  );
  expect(f.store.passkey('lost')).toBeDefined();
  f.fresh();
  f.advance(-1);
  expect(f.store.verifiedUntil(f.current.session)).toBeNull();
  f.advance(1);
  f.store.revokeSession(f.current.session.token_hash);
  expect(() => f.store.signOutOthers(f.current.session)).toThrow('session expired');
});

test('self removal shares credential revocation, preserves other authority, and refuses foreign keys', () => {
  const f = fixture();
  f.fresh();
  f.store.addChallenge(f.lost.session, 'registration', 'pending');
  expect(() => f.store.removeOwnPasskey(f.current.session, 'other')).toThrow('not found');
  expect(f.store.removeOwnPasskey(f.current.session, 'lost')).toEqual({ signedOut: false });
  expect(f.store.passkey('lost')).toBeUndefined();
  expect(f.store.session(f.lost.token)).toBeUndefined();
  expect(f.store.session(f.legacy.token)).toBeUndefined();
  expect(f.store.session(f.current.token)).toBeDefined();
  expect(f.store.session(f.sameKey.token)).toBeDefined();
  expect(f.store.session(f.otherSession.token)).toBeDefined();
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM auth_challenges').get()?.n).toBe(0);
});

test.each([false, true])('last-key guard is atomic for member/operator (%s)', (admin) => {
  const f = fixture(admin);
  f.fresh();
  f.store.removeOwnPasskey(f.current.session, 'lost');
  expect(() => f.store.removeOwnPasskey(f.current.session, 'current')).toThrow(
    'Add another passkey',
  );
  expect(f.store.passkey('current')).toBeDefined();
  expect(f.store.session(f.current.token)).toBeDefined();
});

test.each(['current', 'legacy'] as const)(
  'removing a key reports the caller %s session signed out',
  (kind) => {
    const f = fixture();
    const session = kind === 'current' ? f.current : f.legacy;
    f.store.markVerified(session.session, 'current');
    expect(f.store.removeOwnPasskey(session.session, 'current')).toEqual({ signedOut: true });
    expect(f.store.session(session.token)).toBeUndefined();
    expect(f.store.session(f.lost.token)).toBeDefined();
  },
);

test('failed credential deletion rolls back its associated legacy-session revocation', () => {
  const f = fixture();
  f.fresh();
  f.db.exec(
    "CREATE TRIGGER fail_remove BEFORE DELETE ON auth_passkeys BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END",
  );
  expect(() => f.store.removeOwnPasskey(f.current.session, 'lost')).toThrow('fixture disk failure');
  expect(f.store.session(f.legacy.token)).toBeDefined();
  expect(f.store.session(f.lost.token)).toBeDefined();
  expect(f.store.passkey('lost')).toBeDefined();
});

test('other-session sign-out retains this session and keys, assistant grants, tokens and pending consent', () => {
  const f = fixture();
  f.fresh();
  const tokens = new AccessTokens(f.store);
  tokens.create(f.user.id, 'Kept token');
  new AssistantOAuth(f.store, 'http://localhost:3000');
  f.db.prepare('INSERT INTO oauth_clients VALUES(?,?,?)').run('fixture', '{}', 1_000_000);
  f.db
    .prepare('INSERT INTO oauth_connections VALUES(?,?,?,?,?,?,?,?,?,0)')
    .run(
      'connection',
      f.user.id,
      'fixture',
      'Assistant',
      'https://example.test',
      '["read"]',
      'http://localhost:3000/mcp',
      1_000_000,
      null,
    );
  const connections = f.db.prepare('SELECT * FROM oauth_connections').all();
  f.db
    .prepare(
      'INSERT INTO oauth_pending(id,client_id,redirect_uri,challenge,scopes,state,expires_at,session_hash,used) VALUES(?,?,?,?,?,?,?,?,0)',
    )
    .run(
      'pending',
      'fixture',
      'https://example.test/callback',
      'challenge',
      'resource',
      null,
      9_000_000,
      f.current.session.token_hash,
    );
  const before = f.db.prepare('SELECT * FROM oauth_pending').all();
  f.store.addChallenge(f.lost.session, 'registration', 'pending');
  f.store.signOutOthers(f.current.session);
  expect(f.store.session(f.current.token)).toBeDefined();
  for (const session of [f.lost, f.sameKey, f.legacy])
    expect(f.store.session(session.token)).toBeUndefined();
  expect(f.store.session(f.otherSession.token)).toBeDefined();
  expect(f.store.passkeys(f.user.id).map((key) => key.id)).toEqual(['current', 'lost']);
  expect(tokens.list(f.user.id)).toHaveLength(1);
  expect(f.db.prepare('SELECT * FROM oauth_pending').all()).toEqual(before);
  expect(f.db.prepare('SELECT * FROM oauth_connections').all()).toEqual(connections);
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM auth_challenges').get()?.n).toBe(0);
});

test('reauthentication requires account-bound UV and preserves source credential and session', async () => {
  const f = fixture();
  const options = await f.service.reauthenticationOptions(f.current.session);
  expect(options.options.userVerification).toBe('required');
  expect(options.options.allowCredentials?.map((key) => key.id)).toEqual(['current', 'lost']);
  const result = await f.service.reauthenticate(f.current.session, options.challengeId, {
    ...f.response,
    id: 'lost',
    response: { ...f.response.response, userHandle: undefined },
  });
  expect(result.verifiedUntil).toBe(1_000_000 + VERIFICATION_MS);
  expect(f.store.session(f.current.token)).toMatchObject({
    passkey_id: 'current',
    verified_passkey_id: 'lost',
  });
  expect(f.verify.verifyAuthenticationResponse).toHaveBeenCalledWith(
    expect.objectContaining({
      requireUserVerification: true,
      expectedOrigin: 'http://localhost:3000',
      expectedRPID: 'localhost',
    }),
  );
  await expect(
    f.service.reauthenticate(f.current.session, options.challengeId, f.response),
  ).rejects.toThrow('expired');
  // The verification credential's removal invalidates proof without changing attribution.
  f.store.transaction(() => f.store.removePasskey(f.user.id, 'lost'));
  expect(f.store.session(f.current.token)).toBeDefined();
  expect(f.store.verifiedUntil(f.current.session)).toBeNull();
});

test.each(['foreign', 'handle', 'no-uv', 'signature'] as const)(
  'reauthentication rejects %s without granting proof',
  async (failure) => {
    const f = fixture();
    const { challengeId } = await f.service.reauthenticationOptions(f.current.session);
    let response = f.response;
    if (failure === 'foreign') response = { ...response, id: 'other' };
    if (failure === 'handle')
      response = { ...response, response: { ...response.response, userHandle: 'wrong' } };
    if (failure === 'no-uv') f.verified.authenticationInfo.userVerified = false;
    if (failure === 'signature')
      f.verify.verifyAuthenticationResponse.mockRejectedValueOnce(
        new Error('secret signature detail'),
      );
    await expect(
      f.service.reauthenticate(f.current.session, challengeId, response),
    ).rejects.toThrow();
    expect(f.store.verifiedUntil(f.current.session)).toBeNull();
    expect(f.store.passkey('current')?.counter).toBe(0);
  },
);

test.each(['counter', 'remove', 'cancel', 'revoke', 'expire', 'disable'] as const)(
  'reauthentication rechecks %s races after crypto',
  async (action) => {
    const f = fixture();
    const { challengeId } = await f.service.reauthenticationOptions(f.current.session);
    f.verify.verifyAuthenticationResponse.mockImplementationOnce(async () => {
      if (action === 'counter') f.db.exec('UPDATE auth_passkeys SET counter=10');
      if (action === 'remove') f.db.prepare('DELETE FROM auth_passkeys WHERE id=?').run('current');
      if (action === 'cancel') f.store.cancel(challengeId, f.current.session);
      if (action === 'revoke') f.store.revokeSession(f.current.session.token_hash);
      if (action === 'expire') f.advance(VERIFICATION_MS);
      if (action === 'disable')
        f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.user.id);
      return f.verified;
    });
    await expect(
      f.service.reauthenticate(f.current.session, challengeId, f.response),
    ).rejects.toThrow();
    expect(f.store.verifiedUntil(f.current.session)).toBeNull();
  },
);

test('own deletion defeats an anonymous in-flight sign-in with the removed passkey', async () => {
  const f = fixture();
  f.fresh();
  const anonymous = f.store.createSession(null);
  const { challengeId } = await f.service.authenticationOptions(anonymous.session);
  f.verify.verifyAuthenticationResponse.mockImplementationOnce(async () => {
    f.store.removeOwnPasskey(f.current.session, 'lost');
    return f.verified;
  });
  await expect(
    f.service.authenticate(anonymous.session, challengeId, { ...f.response, id: 'lost' }),
  ).rejects.toThrow('removed');
  expect(f.store.session(anonymous.token)?.user_id).toBeNull();
});

test('admin removal uses the same revocation primitive and invalidates a different-key verification proof', () => {
  const f = fixture();
  f.store.markVerified(f.current.session, 'lost');
  const operator = f.store.createUser('Operator', true);
  const admin = new AdminStore(f.store, new InvitationService(f.store, 'http://localhost:3000'));
  admin.removePasskey(operator.id, f.user.id, 'lost');
  expect(f.store.session(f.current.token)).toBeDefined();
  expect(f.store.verifiedUntil(f.current.session)).toBeNull();
});

test('stale unlocked sessions cannot enroll a new credential to bypass access verification', async () => {
  const f = fixture();
  await expect(f.service.registrationOptions(f.current.session)).rejects.toMatchObject({
    status: 428,
  });
  f.fresh();
  const { challengeId } = await f.service.registrationOptions(f.current.session);
  f.advance(VERIFICATION_MS);
  await expect(
    f.service.register(f.current.session, challengeId, {} as never),
  ).rejects.toMatchObject({ status: 428 });
  expect(f.verify.verifyRegistrationResponse).not.toHaveBeenCalled();
  expect(f.store.passkeys(f.user.id)).toHaveLength(2);
});

test.each(['proof-expiry', 'verification-key-removal', 'sign-out-others'] as const)(
  'registration rechecks %s after asynchronous verification without admitting a new key',
  async (action) => {
    const f = fixture();
    f.store.markVerified(f.current.session, 'lost');
    // Keep the challenge live while the older session verification expires.
    f.advance(VERIFICATION_MS / 2);
    const { challengeId } = await f.service.registrationOptions(f.current.session);
    f.verify.verifyRegistrationResponse.mockImplementationOnce(async () => {
      if (action === 'proof-expiry') f.advance(VERIFICATION_MS / 2);
      if (action === 'verification-key-removal')
        f.store.transaction(() => f.store.removePasskey(f.user.id, 'lost'));
      if (action === 'sign-out-others') {
        f.store.markVerified(f.sameKey.session, 'current');
        f.store.signOutOthers(f.sameKey.session);
      }
      return {
        verified: true,
        registrationInfo: {
          credential: { id: 'new-key', publicKey: new Uint8Array([1]), counter: 0 },
          aaguid: '',
          userVerified: true,
          credentialBackedUp: false,
          credentialDeviceType: 'singleDevice',
        },
      };
    });
    await expect(f.service.register(f.current.session, challengeId, {} as never)).rejects.toThrow();
    expect(f.store.passkey('new-key')).toBeUndefined();
  },
);

test('signing out other devices fences their in-flight reauthentication', async () => {
  const f = fixture();
  f.fresh();
  const { challengeId } = await f.service.reauthenticationOptions(f.sameKey.session);
  f.verify.verifyAuthenticationResponse.mockImplementationOnce(async () => {
    f.store.signOutOthers(f.current.session);
    return f.verified;
  });
  await expect(
    f.service.reauthenticate(f.sameKey.session, challengeId, f.response),
  ).rejects.toThrow('expired');
  expect(f.store.session(f.sameKey.token)).toBeUndefined();
  expect(f.store.session(f.current.token)).toBeDefined();
});
