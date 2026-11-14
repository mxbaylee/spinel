import { createPrivateKey, sign } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import type {
  RegistrationResponseJSON,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, CHALLENGE_MS } from './store.ts';
import { ConsoleRecovery } from './console-recovery.ts';
import { InvitationService } from './invitations.ts';
import { SETUP_MS } from './setup.ts';
import { saveRegistration } from './service.ts';
import { setupProofMessage } from '../../shared/setup-proof.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.restoreAllMocks();
});
function fixture(origin = 'https://new.spinel.example') {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  databases.push(db);
  let now = 1000;
  const store = new AuthStore(db, () => now);
  const admin = store.createUser('Operator', true);
  const member = store.createUser('Everyday');
  const result: VerifiedRegistrationResponse = {
    verified: true,
    registrationInfo: {
      fmt: 'none',
      aaguid: '',
      credential: { id: 'new-key', publicKey: new Uint8Array([1, 2]), counter: 0 },
      credentialType: 'public-key',
      attestationObject: new Uint8Array(),
      userVerified: true,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      origin,
      rpID: new URL(origin).hostname,
    },
  };
  saveRegistration(store, admin.id, {
    ...result.registrationInfo!,
    credential: { ...result.registrationInfo!.credential, id: 'old-key' },
  });
  const old = store.createSession(admin.id, undefined, 'old-key');
  const legacy = store.createSession(admin.id);
  const memberSession = store.createSession(member.id);
  const invites = new InvitationService(store, origin);
  const invite = invites.create(admin.id, 24, admin.id);
  const memberInvite = invites.create(admin.id, 24, member.id);
  const verifier = vi.fn(async () => result);
  const audit = vi.spyOn(console, 'info').mockImplementation(() => {});
  const service = new ConsoleRecovery(store, origin, verifier);
  const issue = service.issue();
  const [id, secret] = new URL(issue.url).hash.slice(1).split('.');
  const response = {
    id: 'new-key',
    response: { attestationObject: 'attestation', clientDataJSON: 'client' },
  } as RegistrationResponseJSON;
  const proofFor = (challenge: string, selector = id, key = secret, recovery = true) =>
    sign(
      null,
      Buffer.from(setupProofMessage(origin, selector, challenge, response, recovery)),
      createPrivateKey({ key: Buffer.from(key, 'base64url'), type: 'pkcs8', format: 'der' }),
    ).toString('base64url');
  async function ceremony(signed = false) {
    const { token, session } = signed ? old : store.createSession(null);
    const { options, challengeId } = await service.options(session, id);
    const proof = proofFor(options.challenge);
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
    admin,
    member,
    old,
    legacy,
    memberSession,
    invites,
    invite,
    memberInvite,
    service,
    issue,
    id,
    secret,
    response,
    result,
    verifier,
    audit,
    ceremony,
    proofFor,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('console selects only an active admin by exact ID or unambiguous name, with or without keys', () => {
  const f = fixture();
  expect(f.issue.user.id).toBe(f.admin.id);
  f.db.exec('DELETE FROM auth_passkeys');
  expect(f.service.issue({ id: f.admin.id }).user.id).toBe(f.admin.id);
  expect(f.service.issue({ name: 'Operator' }).user.id).toBe(f.admin.id);
  expect(() => f.service.issue({ id: f.member.id })).toThrow('Choose one active admin');
  expect(() => f.service.issue({ name: 'operator' })).toThrow('Choose one active admin');
  const second = f.store.createUser('Operator', true);
  expect(() => f.service.issue()).toThrow(second.id);
  expect(() => f.service.issue({ name: 'Operator' })).toThrow('Choose one active admin');
  expect(f.service.issue({ id: second.id }).user.id).toBe(second.id);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(second.id);
  expect(() => f.service.issue({ id: second.id })).toThrow('Choose one active admin');
  f.db.exec('UPDATE auth_users SET disabled=1');
  expect(() => f.service.issue()).toThrow('Choose one active admin');
});

test('issuing stores only public material, expires at 30 minutes, and replaces the prior link without revocation', () => {
  const f = fixture();
  // Console recovery deliberately shares setup's 30-minute operator window.
  expect(f.issue.expiresAt).toBe(1000 + SETUP_MS);
  expect(JSON.stringify(f.db.prepare('SELECT * FROM auth_admin_recovery').all())).not.toContain(
    f.secret,
  );
  const next = f.service.issue();
  expect(() => f.service.active(f.id)).toThrow('unavailable');
  expect(f.store.session(f.old.token)).toBeDefined();
  expect(f.store.passkey('old-key')).toBeDefined();
  f.advance(SETUP_MS);
  expect(() => f.service.active(new URL(next.url).hash.slice(1).split('.')[0])).toThrow('expired');
});

test.each([false, true])(
  'claim preserves identity and swaps credentials atomically (old admin session: %s)',
  async (signed) => {
    const f = fixture();
    const before = f.db.prepare('SELECT * FROM auth_users ORDER BY id').all();
    const c = await f.ceremony(signed);
    expect(c.options.rp.id).toBe('new.spinel.example');
    expect(Buffer.from(c.options.user.id, 'base64url').toString()).toBe(f.admin.id);
    const next = await c.claim();
    expect(f.db.prepare('SELECT * FROM auth_users ORDER BY id').all()).toEqual(before);
    expect(f.store.session(f.old.token)).toBeUndefined();
    expect(f.store.session(f.legacy.token)).toBeUndefined();
    expect(f.store.session(c.token)).toBeUndefined();
    expect(f.store.session(f.memberSession.token)).toBeDefined();
    expect(f.store.passkeys(f.admin.id).map((key) => key.id)).toEqual(['new-key']);
    expect(f.store.session(next.token)?.user_id).toBe(f.admin.id);
    expect(f.invites.list().find((i) => i.id === f.invite.id)?.status).toBe('Revoked');
    expect(f.invites.list().find((i) => i.id === f.memberInvite.id)?.status).toBe('Available');
    expect(() => f.service.active(f.id)).toThrow('unavailable');
    await expect(c.claim()).rejects.toThrow();
    expect(f.audit).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'admin.recovered',
        userID: f.admin.id,
        at: new Date(1000).toISOString(),
      }),
    );
    expect(f.verifier).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: 'https://new.spinel.example',
        expectedRPID: 'new.spinel.example',
        requireUserVerification: true,
      }),
    );
  },
);

test.each(['forged', 'setup-domain', 'response', 'challenge', 'session'] as const)(
  'rejects %s without revoking access or logging recovery',
  async (attack) => {
    const f = fixture();
    const c = await f.ceremony();
    const other = await f.ceremony();
    await expect(
      f.service.claim(
        attack === 'session' ? other.session : c.session,
        f.id,
        c.challengeId,
        attack === 'response' ? { ...f.response, id: 'different-key' } : f.response,
        attack === 'forged'
          ? 'x'.repeat(86)
          : attack === 'setup-domain'
            ? f.proofFor(c.options.challenge, f.id, f.secret, false)
            : attack === 'challenge'
              ? other.proof
              : c.proof,
      ),
    ).rejects.toThrow();
    expect(f.store.session(f.old.token)).toBeDefined();
    expect(f.store.passkey('old-key')).toBeDefined();
    expect(f.audit).not.toHaveBeenCalled();
  },
);

test('registration challenge cannot be retargeted to a new console link even with its private key', async () => {
  const f = fixture();
  const c = await f.ceremony();
  const other = f.store.createUser('Second operator', true);
  const issued = f.service.issue({ id: other.id });
  const [id, secret] = new URL(issued.url).hash.slice(1).split('.');
  await expect(
    f.service.claim(
      c.session,
      id,
      c.challengeId,
      f.response,
      f.proofFor(c.options.challenge, id, secret),
    ),
  ).rejects.toThrow('another recovery link');
  expect(f.verifier).not.toHaveBeenCalled();
  expect(f.store.passkeys(other.id)).toHaveLength(0);
});

test.each([
  'cancel',
  'expired',
  'replaced',
  'disabled',
  'demoted',
  'reactivated',
  'session-revoked',
] as const)('transaction rechecks %s after WebAuthn verification', async (action) => {
  const f = fixture();
  const c = await f.ceremony();
  f.verifier.mockImplementationOnce(async () => {
    if (action === 'cancel') f.store.cancel(c.challengeId, c.session);
    if (action === 'expired') f.advance(CHALLENGE_MS);
    if (action === 'replaced') f.service.issue();
    if (action === 'disabled' || action === 'reactivated')
      f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.admin.id);
    if (action === 'reactivated')
      f.db.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(f.admin.id);
    if (action === 'demoted')
      f.db.prepare('UPDATE auth_users SET is_admin=0 WHERE id=?').run(f.admin.id);
    if (action === 'session-revoked') f.store.revokeSession(c.session.token_hash);
    return f.result;
  });
  await expect(c.claim()).rejects.toThrow();
  expect(f.store.passkey('old-key')).toBeDefined();
  expect(f.store.passkey('new-key')).toBeUndefined();
  expect(f.audit).not.toHaveBeenCalled();
});

test('concurrent claims have one winner and one recovery event', async () => {
  const f = fixture();
  const a = await f.ceremony();
  const b = await f.ceremony();
  const results = await Promise.allSettled([a.claim(), b.claim()]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(f.store.userCount()).toBe(2);
  expect(f.audit).toHaveBeenCalledTimes(1);
});

test('failed credential write rolls back all revocation and permits a fresh retry', async () => {
  const f = fixture();
  const c = await f.ceremony(true);
  f.db.exec(
    "CREATE TRIGGER fail_key BEFORE INSERT ON auth_passkeys BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  await expect(c.claim()).rejects.toThrow('Could not recover');
  expect(f.store.session(f.old.token)).toBeDefined();
  expect(f.store.session(f.legacy.token)).toBeDefined();
  expect(f.store.passkey('old-key')).toBeDefined();
  expect(f.service.active(f.id).user.id).toBe(f.admin.id);
  expect(f.invites.list().find((i) => i.id === f.invite.id)?.status).toBe('Available');
  expect(f.audit).not.toHaveBeenCalled();
  f.db.exec('DROP TRIGGER fail_key');
  await expect((await f.ceremony()).claim()).resolves.toBeDefined();
});

test('existing credential IDs cannot replace credentials, including the target admin’s own key', async () => {
  const f = fixture();
  f.result.registrationInfo!.credential.id = 'old-key';
  await expect((await f.ceremony()).claim()).rejects.toThrow('already registered');
  expect(f.store.session(f.old.token)).toBeDefined();
  expect(f.store.passkeys(f.admin.id)).toHaveLength(1);
});
