import { createPrivateKey, sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import type {
  RegistrationResponseJSON,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { AuthStore, CHALLENGE_MS } from './store.ts';
import { SetupService, SETUP_MS } from './setup.ts';
import { setupProofMessage } from '../../shared/setup-proof.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  databases.push(db);
  let now = 1000;
  const store = new AuthStore(db, () => now);
  const result: VerifiedRegistrationResponse = {
    verified: true,
    registrationInfo: {
      fmt: 'none',
      aaguid: '',
      credential: { id: 'admin-key', publicKey: new Uint8Array([1, 2]), counter: 0 },
      credentialType: 'public-key',
      attestationObject: new Uint8Array(),
      userVerified: true,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      origin: 'http://localhost:3000',
      rpID: 'localhost',
    },
  };
  const verifier = vi.fn(async () => result);
  const service = new SetupService(store, 'http://localhost:3000', verifier);
  const issue = service.issue();
  const [id, secret] = new URL(issue.url).hash.slice(1).split('.');
  const response = {
    id: 'admin-key',
    response: { attestationObject: 'attestation', clientDataJSON: 'client' },
  } as RegistrationResponseJSON;
  async function ceremony() {
    const { token, session } = store.createSession(null);
    const { options, challengeId } = await service.options(session, id);
    const message = setupProofMessage(service.origin, id, options.challenge, response);
    const proof = sign(
      null,
      Buffer.from(message),
      createPrivateKey({ key: Buffer.from(secret, 'base64url'), type: 'pkcs8', format: 'der' }),
    ).toString('base64url');
    return {
      token,
      session,
      options,
      challengeId,
      proof,
      claim: () => service.claim(session, id, challengeId, response, proof),
    };
  }
  return {
    db,
    store,
    service,
    issue,
    id,
    secret,
    response,
    verifier,
    result,
    ceremony,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('only public setup key is stored; link expires in30minutes and reissue replaces it', () => {
  const f = fixture();
  expect(f.issue.expiresAt).toBe(1000 + SETUP_MS);
  expect(f.issue.url).toContain('/setup#');
  expect(JSON.stringify(f.db.prepare('SELECT * FROM auth_setup').all())).not.toContain(f.secret);
  f.service.issue();
  expect(() => f.service.active(f.id)).toThrow('replaced');
  const next = f.service.issue();
  const id = new URL(next.url).hash.slice(1).split('.')[0];
  f.advance(SETUP_MS);
  expect(() => f.service.active(id)).toThrow('expired');
});

test('claim atomically creates an admin and passkey, rotates session and closes setup permanently', async () => {
  const f = fixture();
  const c = await f.ceremony();
  const next = await c.claim();
  expect(f.store.userCount()).toBe(1);
  expect(f.store.user(next.session.user_id!)?.is_admin).toBe(1);
  expect(f.store.passkeys(next.session.user_id!)).toHaveLength(1);
  expect(f.store.session(c.token)).toBeUndefined();
  expect(f.store.session(next.token)?.user_id).toBe(next.session.user_id);
  expect(() => f.service.issue()).toThrow('already claimed');
  await expect(c.claim()).rejects.toThrow();
  expect(f.verifier).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedOrigin: f.service.origin,
      expectedRPID: 'localhost',
      requireUserVerification: true,
    }),
  );
});

test('any existing user including a disabled non-admin prevents issuance', () => {
  const f = fixture();
  f.store.createUser('Everyday');
  f.db.exec('UPDATE auth_users SET disabled=1');
  expect(() => f.service.issue()).toThrow('already claimed');
});

test('proof cannot be forged, moved to another challenge or reused after rejection', async () => {
  const f = fixture();
  const first = await f.ceremony();
  const second = await f.ceremony();
  await expect(
    f.service.claim(second.session, f.id, second.challengeId, f.response, first.proof),
  ).rejects.toThrow('setup link');
  await expect(second.claim()).rejects.toThrow('expired');
  expect(f.verifier).not.toHaveBeenCalled();
  expect(f.store.userCount()).toBe(0);
});

test.each(['cancel', 'expired', 'reissue', 'claimed'] as const)(
  'claim rechecks %s after verification',
  async (action) => {
    const f = fixture();
    const c = await f.ceremony();
    f.verifier.mockImplementationOnce(async () => {
      if (action === 'cancel') f.store.cancel(c.challengeId, c.session);
      if (action === 'expired') f.advance(CHALLENGE_MS);
      if (action === 'reissue') f.service.issue();
      if (action === 'claimed') f.store.createUser('Another winner', true);
      return f.result;
    });
    await expect(c.claim()).rejects.toThrow();
    expect(f.store.userCount()).toBe(action === 'claimed' ? 1 : 0);
    expect(f.store.passkey('admin-key')).toBeUndefined();
  },
);

test('concurrent claims have exactly one winner', async () => {
  const f = fixture();
  const a = await f.ceremony();
  const b = await f.ceremony();
  const results = await Promise.allSettled([a.claim(), b.claim()]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(f.store.userCount()).toBe(1);
});

test('a credential write failure rolls back the user and leaves setup retryable', async () => {
  const f = fixture();
  const c = await f.ceremony();
  f.db.exec(
    "CREATE TRIGGER fail_key BEFORE INSERT ON auth_passkeys BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END",
  );
  await expect(c.claim()).rejects.toThrow('Could not finish');
  expect(f.store.userCount()).toBe(0);
  expect(f.service.active(f.id)).toBeDefined();
  f.db.exec('DROP TRIGGER fail_key');
  await expect((await f.ceremony()).claim()).resolves.toBeDefined();
});
