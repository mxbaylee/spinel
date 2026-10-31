import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, VERIFICATION_MS } from '../auth/store.ts';
import {
  assertRestoreAuthority,
  captureRestoreAuthority,
  validRestoreAuthority,
} from './restore-authority.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
function fixture() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys=ON');
  let now = 1_800_000_000_000;
  const auth = new AuthStore(database, () => now);
  const operator = auth.createUser('Operator', true);
  const other = auth.createUser('Owner');
  for (const id of ['first', 'second'])
    database
      .prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, operator.id, Buffer.from([1]), 0, '[]', id, 'Browser', now, null, 0, 'singleDevice');
  const session = auth.createSession(operator.id, undefined, 'first').session;
  auth.markVerified(session, 'first');
  const intent = {
    actorId: operator.id,
    sessionHash: session.token_hash,
    expiresAt: now + 60_000,
  };
  const proof = captureRestoreAuthority(database, intent, () => now);
  return {
    database,
    auth,
    operator,
    other,
    session,
    intent,
    proof,
    now: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

test('captures exact original verification using only guarded reads', () => {
  const f = fixture();
  f.database.setWriteGuard(() => {
    throw new Error('Unexpected write');
  });
  expect(captureRestoreAuthority(f.database, f.intent, f.now)).toEqual({
    ...f.intent,
    verifiedAt: f.now(),
    verifiedPasskeyId: 'first',
  });
  f.advance(59_999);
  expect(() => assertRestoreAuthority(f.database, f.proof, f.now)).not.toThrow();
  f.advance(1);
  expect(() => assertRestoreAuthority(f.database, f.proof, f.now)).toThrow('original restore');
});

test.each([
  'disabled',
  'role',
  'session',
  'credential',
  'credential-owner',
  'shortened-session',
  'changed-key',
  'renewed-verification',
])('refuses changed current authority: %s', (change) => {
  const f = fixture();
  switch (change) {
    case 'disabled':
      f.database.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.operator.id);
      break;
    case 'role':
      f.database.prepare('UPDATE auth_users SET is_admin=0 WHERE id=?').run(f.operator.id);
      break;
    case 'session':
      f.auth.revokeSession(f.session.token_hash);
      break;
    case 'credential':
      f.database.prepare('DELETE FROM auth_passkeys WHERE id=?').run('first');
      break;
    case 'credential-owner':
      f.database.prepare('UPDATE auth_passkeys SET user_id=? WHERE id=?').run(f.other.id, 'first');
      break;
    case 'shortened-session':
      f.database
        .prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?')
        .run(f.intent.expiresAt - 1, f.session.token_hash);
      break;
    case 'changed-key':
      f.auth.markVerified(f.session, 'second');
      break;
    case 'renewed-verification':
      f.advance(1);
      f.auth.markVerified(f.session, 'first');
      break;
  }
  f.database.setWriteGuard(() => {
    throw new Error('Unexpected write');
  });
  expect(() => assertRestoreAuthority(f.database, f.proof, f.now)).toThrow('original restore');
});

test('expiry and verification are bounded without extending an old intent', () => {
  const f = fixture();
  for (const expiresAt of [f.now(), f.now() - 1, f.now() + VERIFICATION_MS + 1, NaN])
    expect(() => captureRestoreAuthority(f.database, { ...f.intent, expiresAt }, f.now)).toThrow(
      'original restore',
    );
  expect(() =>
    captureRestoreAuthority(f.database, { ...f.intent, actorId: f.other.id }, f.now),
  ).toThrow('original restore');
  expect(() => assertRestoreAuthority(f.database, f.proof, () => f.now() - 1)).toThrow(
    'original restore',
  );
  f.advance(VERIFICATION_MS);
  f.auth.markVerified(f.session, 'second');
  expect(() => captureRestoreAuthority(f.database, f.intent, f.now)).toThrow('original restore');
  expect(() => assertRestoreAuthority(f.database, f.proof, f.now)).toThrow('original restore');
});

test('journal proofs have a closed bounded shape', () => {
  const f = fixture();
  expect(validRestoreAuthority(f.proof)).toBe(true);
  for (const proof of [
    null,
    [],
    {},
    { ...f.proof, renewed: true },
    { ...f.proof, verifiedPasskeyId: 'x'.repeat(4097) },
    { ...f.proof, verifiedAt: Number.MAX_SAFE_INTEGER },
    { ...f.proof, verifiedAt: -1 },
    { ...f.proof, sessionHash: 'not-a-hash' },
  ])
    expect(validRestoreAuthority(proof)).toBe(false);
});

test.each(['capture', 'assert'])('rejects expiry during synchronous %s inspection', (method) => {
  const f = fixture();
  const prepare = f.database.prepare.bind(f.database);
  vi.spyOn(f.database, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    const get = statement.get.bind(statement);
    vi.spyOn(statement, 'get').mockImplementation((...parameters) => {
      const row = get(...parameters);
      f.advance(60_000);
      return row;
    });
    return statement;
  });
  expect(() =>
    method === 'capture'
      ? captureRestoreAuthority(f.database, f.intent, f.now)
      : assertRestoreAuthority(f.database, f.proof, f.now),
  ).toThrow('original restore');
});
