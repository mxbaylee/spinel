import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import { AuthStore, CHALLENGE_MS, SESSION_MS, hashToken } from './store.ts';
import { AuthService, authOrigin } from './service.ts';
import { passkeyProviderName, availablePasskeyName } from './passkey-names.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});
function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('PRAGMA foreign_keys=ON');
  let now = 1_000_000;
  const store = new AuthStore(db, () => now);
  const user = store.createUser('Owner');
  const signed = store.createSession(user.id);
  const anonymous = store.createSession(null);
  const registration: VerifiedRegistrationResponse = {
    verified: true,
    registrationInfo: {
      fmt: 'none',
      aaguid: 'bada5566-a7aa-401f-bd96-45619a55120d',
      credential: {
        id: 'credential',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ['internal'],
      },
      credentialType: 'public-key',
      attestationObject: new Uint8Array(),
      userVerified: true,
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
      origin: 'http://localhost:3000',
      rpID: 'localhost',
    },
  };
  const authentication: VerifiedAuthenticationResponse = {
    verified: true,
    authenticationInfo: {
      credentialID: 'credential',
      newCounter: 1,
      userVerified: true,
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
      origin: 'http://localhost:3000',
      rpID: 'localhost',
    },
  };
  const verify = {
    verifyRegistrationResponse: vi.fn(async () => registration),
    verifyAuthenticationResponse: vi.fn(async () => authentication),
  };
  const service = new AuthService(store, 'http://localhost:3000', verify);
  const authResponse = {
    id: 'credential',
    response: { userHandle: Buffer.from(user.id).toString('base64url') },
  } as AuthenticationResponseJSON;
  const registerResponse = {} as RegistrationResponseJSON;
  async function register() {
    const { challengeId } = await service.registrationOptions(signed.session);
    return service.register(signed.session, challengeId, registerResponse);
  }
  return {
    db,
    store,
    user,
    signed,
    anonymous,
    service,
    verify,
    registration,
    authentication,
    authResponse,
    registerResponse,
    register,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('session tokens are hashed, survive store reopen, expire and can be revoked', () => {
  const f = fixture();
  expect(f.signed.session.token_hash).toBe(hashToken(f.signed.token));
  expect(JSON.stringify(f.db.prepare('SELECT * FROM auth_sessions').all())).not.toContain(
    f.signed.token,
  );
  expect(new AuthStore(f.db, f.store.now).session(f.signed.token)?.user_id).toBe(f.user.id);
  f.advance(CHALLENGE_MS);
  expect(f.store.session(f.anonymous.token)).toBeUndefined();
  expect(f.store.session(f.signed.token)).toBeDefined();
  f.advance(SESSION_MS - CHALLENGE_MS);
  expect(f.store.session(f.signed.token)).toBeUndefined();
  const next = f.store.createSession(f.user.id);
  f.store.revokeSession(next.session.token_hash);
  expect(f.store.session(next.token)).toBeUndefined();
});

test('challenges bind to session and ceremony, expire, cannot replay, and cap at 1000', () => {
  const f = fixture();
  const challenge = f.store.addChallenge(f.signed.session, 'registration', 'challenge');
  expect(() => f.store.takeChallenge(challenge.id, f.anonymous.session, 'registration')).toThrow(
    'expired',
  );
  expect(() => f.store.takeChallenge(challenge.id, f.signed.session, 'authentication')).toThrow(
    'expired',
  );
  expect(f.store.takeChallenge(challenge.id, f.signed.session, 'registration').used).toBe(1);
  expect(() => f.store.takeChallenge(challenge.id, f.signed.session, 'registration')).toThrow(
    'expired',
  );
  f.store.cancel(challenge.id, f.anonymous.session);
  expect(() => f.store.assertPending(challenge)).not.toThrow();
  f.advance(CHALLENGE_MS);
  expect(() => f.store.assertPending(challenge)).toThrow('expired');
  for (let i = 0; i < 1000; i++)
    f.store.addChallenge(f.store.createSession(null).session, 'authentication', `c${i}`);
  expect(() => f.store.checkCapacity()).toThrow('Too many');
  f.advance(CHALLENGE_MS);
  expect(() => f.store.checkCapacity()).not.toThrow();
});

test('registration and discoverable sign-in require user verification and fixed origin', async () => {
  const f = fixture();
  const options = await f.service.registrationOptions(f.signed.session);
  expect(options.options).toMatchObject({
    rp: { name: 'Spinel', id: 'localhost' },
    user: { id: Buffer.from(f.user.id).toString('base64url') },
    attestation: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await f.service.register(f.signed.session, options.challengeId, f.registerResponse);
  expect(f.verify.verifyRegistrationResponse).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedOrigin: 'http://localhost:3000',
      expectedRPID: 'localhost',
      expectedChallenge: options.options.challenge,
      requireUserVerification: true,
    }),
  );
  expect(f.store.passkeys(f.user.id)[0]).toMatchObject({
    provider: '1Password',
    name: '1Password',
  });
  const second = await f.service.registrationOptions(f.signed.session);
  expect(second.options.excludeCredentials).toEqual([
    { id: 'credential', type: 'public-key', transports: ['internal'] },
  ]);
  const signin = await f.service.authenticationOptions(f.anonymous.session);
  expect(signin.options.allowCredentials).toBeUndefined();
  expect(signin.options.userVerification).toBe('required');
  const result = await f.service.authenticate(
    f.anonymous.session,
    signin.challengeId,
    f.authResponse,
  );
  expect(f.verify.verifyAuthenticationResponse).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedOrigin: 'http://localhost:3000',
      expectedRPID: 'localhost',
      requireUserVerification: true,
      credential: expect.objectContaining({ counter: 0 }),
    }),
  );
  expect(f.store.passkey('credential')?.counter).toBe(1);
  expect(f.store.session(f.anonymous.token)).toBeUndefined();
  expect(f.store.session(result.token)?.user_id).toBe(f.user.id);
});

test('duplicate registration and wrong user handles fail without a session', async () => {
  const f = fixture();
  await f.register();
  await expect(f.register()).rejects.toThrow('already registered');
  const { challengeId } = await f.service.authenticationOptions(f.anonymous.session);
  await expect(
    f.service.authenticate(f.anonymous.session, challengeId, {
      ...f.authResponse,
      response: { ...f.authResponse.response, userHandle: 'wrong' },
    }),
  ).rejects.toThrow('not available');
  expect(f.verify.verifyAuthenticationResponse).not.toHaveBeenCalled();
  expect(f.store.session(f.anonymous.token)?.user_id).toBeNull();
});

test.each(['cancel', 'expire', 'revoke', 'disable'] as const)(
  'registration rejects %s during asynchronous verification',
  async (action) => {
    const f = fixture();
    const { challengeId } = await f.service.registrationOptions(f.signed.session);
    f.verify.verifyRegistrationResponse.mockImplementationOnce(async () => {
      if (action === 'cancel') f.store.cancel(challengeId, f.signed.session);
      if (action === 'expire') f.advance(CHALLENGE_MS);
      if (action === 'revoke') f.store.revokeSession(f.signed.session.token_hash);
      if (action === 'disable')
        f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.user.id);
      return f.registration;
    });
    await expect(
      f.service.register(f.signed.session, challengeId, f.registerResponse),
    ).rejects.toThrow('expired');
    expect(f.store.passkeys(f.user.id)).toHaveLength(0);
  },
);

test.each(['counter', 'remove', 'cancel', 'revoke'] as const)(
  'authentication rejects %s races',
  async (action) => {
    const f = fixture();
    await f.register();
    const { challengeId } = await f.service.authenticationOptions(f.anonymous.session);
    f.verify.verifyAuthenticationResponse.mockImplementationOnce(async () => {
      if (action === 'counter') f.db.exec('UPDATE auth_passkeys SET counter=10');
      if (action === 'remove') f.db.exec('DELETE FROM auth_passkeys');
      if (action === 'cancel') f.store.cancel(challengeId, f.anonymous.session);
      if (action === 'revoke') f.store.revokeSession(f.anonymous.session.token_hash);
      return f.authentication;
    });
    await expect(
      f.service.authenticate(f.anonymous.session, challengeId, f.authResponse),
    ).rejects.toThrow();
    expect(f.store.session(f.anonymous.token)?.user_id ?? null).toBeNull();
  },
);

test('synced zero counters are supported, invalid signatures consume the challenge', async () => {
  const f = fixture();
  await f.register();
  f.authentication.authenticationInfo.newCounter = 0;
  let { challengeId } = await f.service.authenticationOptions(f.anonymous.session);
  expect(
    (await f.service.authenticate(f.anonymous.session, challengeId, f.authResponse)).user.id,
  ).toBe(f.user.id);
  const anon = f.store.createSession(null);
  ({ challengeId } = await f.service.authenticationOptions(anon.session));
  f.verify.verifyAuthenticationResponse.mockRejectedValueOnce(
    new Error('private cryptographic detail'),
  );
  await expect(f.service.authenticate(anon.session, challengeId, f.authResponse)).rejects.toThrow(
    'Could not verify',
  );
  await expect(f.service.authenticate(anon.session, challengeId, f.authResponse)).rejects.toThrow(
    'expired',
  );
});

test('provider names are display hints and unknown/duplicate names stay usable', () => {
  expect(passkeyProviderName('BADA5566-A7AA-401F-BD96-45619A55120D')).toBe('1Password');
  expect(passkeyProviderName('__proto__')).toBe('Passkey');
  expect(passkeyProviderName(null)).toBe('Passkey');
  expect(availablePasskeyName('Passkey', ['passkey', ' Passkey 2 '])).toBe('Passkey 3');
});

test('origin configuration rejects IPs, insecure remote hosts and path suffixes', () => {
  for (const value of [
    'http://127.0.0.1:3000',
    'http://spinel.example',
    'https://spinel.example/path',
    'https://user:pass@spinel.example',
  ])
    expect(() => authOrigin(value)).toThrow();
  expect(authOrigin('https://spinel.example')).toEqual({
    origin: 'https://spinel.example',
    rpID: 'spinel.example',
  });
});
