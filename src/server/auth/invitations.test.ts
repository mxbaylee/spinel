import { DatabaseSync } from '../../../server/database.ts';
import { afterEach, expect, test, vi } from 'vitest';
import type {
  RegistrationResponseJSON,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { AuthStore, hashToken } from './store.ts';
import { InvitationService } from './invitations.ts';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  databases.push(db);
  let now = 1000;
  const store = new AuthStore(db, () => now);
  const admin = store.createUser('Operator', true);
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
      origin: 'http://localhost:3000',
      rpID: 'localhost',
    },
  };
  const verifier = vi.fn(async () => result);
  const service = new InvitationService(store, 'http://localhost:3000', verifier);
  function create(recoveryId?: string, hours = 168) {
    const invite = service.create(admin.id, hours, recoveryId);
    return { ...invite, token: new URL(invite.url).searchParams.get('token')! };
  }
  async function ceremony(token: string, name = 'Teammate') {
    const session = store.createSession(null).session;
    const { challengeId, options } = await service.options(session, token, name);
    return {
      session,
      challengeId,
      options,
      accept: () => service.accept(session, token, challengeId, {} as RegistrationResponseJSON),
    };
  }
  return {
    db,
    store,
    admin,
    service,
    verifier,
    result,
    create,
    ceremony,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('invites use random hashed tokens, default7days, and management metadata never exposes tokens', () => {
  const f = fixture();
  const a = f.create();
  const b = f.create();
  expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(a.token).not.toBe(b.token);
  expect(a.expiresAt).toBe(1000 + 7 * 24 * 60 * 60_000);
  expect(f.db.prepare('SELECT token_hash FROM auth_invites WHERE id=?').get(a.id)?.token_hash).toBe(
    hashToken(a.token),
  );
  expect(JSON.stringify(f.service.list())).not.toContain(a.token);
  expect(JSON.stringify(f.service.list())).not.toContain(hashToken(a.token));
  expect(() => f.service.create(f.store.createUser('Ordinary').id)).toThrow('Only an admin');
  expect(() => f.service.create(f.admin.id, Infinity)).toThrow('expiry');
});

test('acceptance creates an everyday account exactly once and records its identity', async () => {
  const f = fixture();
  const invite = f.create();
  const c = await f.ceremony(invite.token);
  expect(f.store.userCount()).toBe(1);
  const result = await c.accept();
  expect(result.user).toMatchObject({ name: 'Teammate', is_admin: 0 });
  expect(f.service.list()[0]).toMatchObject({ status: 'Used', usedBy: 'Teammate' });
  expect(f.store.passkeys(result.user.id)).toHaveLength(1);
  expect(f.store.session(result.token)?.passkey_id).toBe(f.store.passkeys(result.user.id)[0].id);
  expect(() => f.service.active(invite.token)).toThrow('unavailable');
  await expect(c.accept()).rejects.toThrow();
  expect(f.store.userCount()).toBe(2);
});

test.each(['missing', 'expired', 'revoked'] as const)(
  '%s invitations create no account or ceremony',
  async (state) => {
    const f = fixture();
    const invite = f.create(undefined, 1);
    if (state === 'expired') f.advance(60 * 60_000);
    if (state === 'revoked') f.service.revoke(invite.id);
    await expect(f.ceremony(state === 'missing' ? '' : invite.token)).rejects.toThrow(
      'unavailable',
    );
    expect(f.store.userCount()).toBe(1);
    expect(f.verifier).not.toHaveBeenCalled();
  },
);

test('ceremonies are bound to the exact invitation', async () => {
  const f = fixture();
  const a = f.create();
  const b = f.create();
  const c = await f.ceremony(a.token);
  await expect(
    f.service.accept(c.session, b.token, c.challengeId, {} as RegistrationResponseJSON),
  ).rejects.toThrow('another invite');
  expect(f.verifier).not.toHaveBeenCalled();
  expect(f.store.userCount()).toBe(1);
});

test.each(['revoke', 'expire', 'cancel'] as const)(
  'acceptance rechecks %s after verification',
  async (action) => {
    const f = fixture();
    const invite = f.create(undefined, 1);
    const c = await f.ceremony(invite.token);
    f.verifier.mockImplementationOnce(async () => {
      if (action === 'revoke') f.service.revoke(invite.id);
      if (action === 'expire') f.advance(60 * 60_000);
      if (action === 'cancel') f.store.cancel(c.challengeId, c.session);
      return f.result;
    });
    await expect(c.accept()).rejects.toThrow();
    expect(f.store.userCount()).toBe(1);
  },
);

test('simultaneous acceptance has one winner', async () => {
  const f = fixture();
  const invite = f.create();
  const a = await f.ceremony(invite.token);
  const b = await f.ceremony(invite.token);
  const results = await Promise.allSettled([a.accept(), b.accept()]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(f.store.userCount()).toBe(2);
});

test('recovery preserves identity and role, replaces keys/sessions and closes other recovery links', async () => {
  const f = fixture();
  const old = f.store.createSession(f.admin.id);
  f.db
    .prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      'old-key',
      f.admin.id,
      new Uint8Array([1]),
      1,
      '[]',
      'Old',
      'Old',
      1,
      null,
      0,
      'singleDevice',
    );
  const invite = f.create(f.admin.id);
  const other = f.create(f.admin.id);
  const c = await f.ceremony(invite.token, 'Cannot rename account');
  expect(c.options.user.name).toBe('Operator');
  expect(f.store.session(old.token)).toBeDefined();
  expect(f.store.passkey('old-key')).toBeDefined();
  const result = await c.accept();
  expect(result.user).toMatchObject({ id: f.admin.id, name: 'Operator', is_admin: 1 });
  expect(f.store.userCount()).toBe(1);
  expect(f.store.session(old.token)).toBeUndefined();
  expect(f.store.passkey('old-key')).toBeUndefined();
  expect(f.store.passkeys(f.admin.id)).toHaveLength(1);
  expect(f.store.session(result.token)?.user_id).toBe(f.admin.id);
  expect(() => f.service.active(other.token)).toThrow('unavailable');
});

test('recovery does not reactivate disabled users and credential-write failure preserves old access', async () => {
  const f = fixture();
  const target = f.store.createUser('Owner');
  const session = f.store.createSession(target.id);
  const invite = f.create(target.id);
  const c = await f.ceremony(invite.token);
  f.db.exec(
    "CREATE TRIGGER fail_key BEFORE INSERT ON auth_passkeys BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  await expect(c.accept()).rejects.toThrow('Could not accept');
  expect(f.store.session(session.token)).toBeDefined();
  expect(f.service.active(invite.token)).toBeDefined();
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(target.id);
  expect(() => f.service.active(invite.token)).toThrow('unavailable');
  expect(() => f.create(target.id)).toThrow('active account');
});
