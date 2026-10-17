import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthenticatorTransport } from '@simplewebauthn/server';

export const CHALLENGE_MS = 5 * 60_000;
export const SESSION_MS = 30 * 24 * 60 * 60_000;
export const COOKIE_NAME = '__Host-spinel-session';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export interface User {
  id: string;
  name: string;
  is_admin: number;
  disabled: number;
}
export interface Session {
  token_hash: string;
  user_id: string | null;
  expires_at: number;
}
export interface Challenge {
  id: string;
  session_hash: string;
  kind: 'authentication' | 'registration' | 'setup' | 'invite';
  challenge: string;
  expires_at: number;
  used: number;
}
export interface Passkey {
  id: string;
  user_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string;
  name: string;
  provider: string;
  created_at: number;
  last_used_at: number | null;
  backed_up: number;
  device_type: string;
}

export class AuthStore {
  database: DatabaseSync;
  now: () => number;
  constructor(database: DatabaseSync, now = Date.now) {
    this.database = database;
    this.now = now;
    database.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)),
        disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS auth_passkeys (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL,
        name TEXT NOT NULL, provider TEXT NOT NULL, created_at INTEGER NOT NULL,
        last_used_at INTEGER, backed_up INTEGER NOT NULL, device_type TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS auth_passkeys_user ON auth_passkeys(user_id);
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
        kind TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE INDEX IF NOT EXISTS auth_challenges_session ON auth_challenges(session_hash);
    `);
  }
  userCount() {
    return Number(this.database.prepare('SELECT COUNT(*) AS total FROM auth_users').get()!.total);
  }
  transaction<T>(action: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  // Internal seam for first-admin/invite tickets and isolated test fixtures, never an HTTP signup.
  createUser(name: string, admin = false): User {
    const id = randomUUID();
    this.database
      .prepare('INSERT INTO auth_users(id,name,is_admin) VALUES(?,?,?)')
      .run(id, name, Number(admin));
    return this.user(id)!;
  }
  user(id: string): User | undefined {
    return this.database
      .prepare('SELECT * FROM auth_users WHERE id=? AND disabled=0')
      .get(id) as unknown as User | undefined;
  }
  createSession(userId: string | null, lifetime = userId ? SESSION_MS : CHALLENGE_MS) {
    this.prune();
    const token = randomToken();
    const session: Session = {
      token_hash: hashToken(token),
      user_id: userId,
      expires_at: this.now() + lifetime,
    };
    this.database
      .prepare('INSERT INTO auth_sessions VALUES(?,?,?)')
      .run(session.token_hash, userId, session.expires_at);
    return { token, session };
  }
  session(token: string | undefined): Session | undefined {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    return this.sessionByHash(hashToken(token));
  }
  sessionByHash(hash: string): Session | undefined {
    const row = this.database
      .prepare('SELECT * FROM auth_sessions WHERE token_hash=? AND expires_at>?')
      .get(hash, this.now()) as unknown as Session | undefined;
    return row && (!row.user_id || this.user(row.user_id)) ? row : undefined;
  }
  revokeSession(hash: string) {
    this.database.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash);
  }
  prune() {
    this.database.prepare('DELETE FROM auth_challenges WHERE expires_at<=?').run(this.now());
    this.database.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(this.now());
  }
  checkCapacity() {
    this.prune();
    const count = this.database.prepare('SELECT COUNT(*) AS total FROM auth_challenges').get()!;
    // The reference caps pending ceremonies to bound unauthenticated resource use.
    if (Number(count.total) >= 1000)
      throw new AuthError(429, 'Too many passkey requests. Try again shortly.');
  }
  addChallenge(session: Session, kind: Challenge['kind'], challenge: string) {
    this.checkCapacity();
    if (!this.sessionByHash(session.token_hash))
      throw new AuthError(401, 'Your session expired. Sign in again.');
    this.database
      .prepare('DELETE FROM auth_challenges WHERE session_hash=?')
      .run(session.token_hash);
    const row: Challenge = {
      id: randomToken(),
      session_hash: session.token_hash,
      kind,
      challenge,
      expires_at: this.now() + CHALLENGE_MS,
      used: 0,
    };
    this.database
      .prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,?)')
      .run(row.id, row.session_hash, row.kind, row.challenge, row.expires_at, row.used);
    return row;
  }
  takeChallenge(id: string, session: Session, kind: Challenge['kind']): Challenge {
    const row = this.database
      .prepare(
        `UPDATE auth_challenges SET used=1
      WHERE id=? AND session_hash=? AND kind=? AND used=0 AND expires_at>?
      RETURNING *`,
      )
      .get(id, session.token_hash, kind, this.now()) as unknown as Challenge | undefined;
    if (!row) throw new AuthError(400, 'Passkey request expired. Try again.');
    return row;
  }
  assertPending(row: Challenge) {
    if (
      !this.sessionByHash(row.session_hash) ||
      row.expires_at <= this.now() ||
      !this.database.prepare('SELECT id FROM auth_challenges WHERE id=? AND used=1').get(row.id)
    ) {
      throw new AuthError(400, 'Passkey request expired. Try again.');
    }
  }
  cancel(id: string, session: Session) {
    this.database
      .prepare('DELETE FROM auth_challenges WHERE id=? AND session_hash=?')
      .run(id, session.token_hash);
  }
  finish(id: string) {
    this.database.prepare('DELETE FROM auth_challenges WHERE id=?').run(id);
  }
  passkey(id: string): Passkey | undefined {
    return this.database.prepare('SELECT * FROM auth_passkeys WHERE id=?').get(id) as unknown as
      Passkey | undefined;
  }
  passkeys(userId: string): Passkey[] {
    return this.database
      .prepare('SELECT * FROM auth_passkeys WHERE user_id=? ORDER BY created_at,id')
      .all(userId) as unknown as Passkey[];
  }
  transports(key: Passkey): AuthenticatorTransport[] {
    return JSON.parse(key.transports);
  }
}
