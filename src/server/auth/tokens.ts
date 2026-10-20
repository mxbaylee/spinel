import { randomUUID } from 'node:crypto';
import { AuthError, hashToken, randomToken } from './store.ts';
import type { AuthStore } from './store.ts';

export interface AccessToken {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
}
const fields =
  'id,user_id AS userId,name,created_at AS createdAt,last_used_at AS lastUsedAt,revoked';

/** Recheck at asynchronous and durable boundaries without updating usage metadata. */
export function accessTokenIdentity(auth: AuthStore, hash: string) {
  const row = auth.database
    .prepare(
      `SELECT t.id,t.user_id AS userId FROM auth_access_tokens t
      JOIN auth_users u ON u.id=t.user_id WHERE t.token_hash=? AND t.revoked=0 AND u.disabled=0 AND u.is_admin=0`,
    )
    .get(hash) as { id: string; userId: string } | undefined;
  if (!row) throw new AuthError(401, 'This access token is no longer available.');
  return row;
}

/** Only hashes persist. Token authentication never grants a browser session. */
export class AccessTokens {
  private readonly auth: AuthStore;
  constructor(auth: AuthStore) {
    this.auth = auth;
    auth.database.exec(`CREATE TABLE IF NOT EXISTS auth_access_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL,
      last_used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS auth_access_tokens_user ON auth_access_tokens(user_id);`);
  }
  private member(userId: string) {
    const user = this.auth.user(userId);
    if (!user || user.is_admin)
      throw new AuthError(403, 'Use your everyday account for access tokens.');
  }
  create(userId: string, name: unknown) {
    this.member(userId);
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
      throw new AuthError(400, 'Name the token using 1–80 characters.');
    return this.auth.transaction(() => {
      const count = this.auth.database
        .prepare('SELECT count(*) AS n FROM auth_access_tokens WHERE user_id=? AND revoked=0')
        .get(userId)!;
      // Ten assistants are ample for a two-person workspace; revoke unused keys first.
      if (Number(count.n) >= 10)
        throw new AuthError(409, 'Revoke an unused token before creating another (limit 10).');
      const id = randomUUID(),
        token = `spinel_${randomToken()}`;
      this.auth.database
        .prepare(
          'INSERT INTO auth_access_tokens(id,user_id,token_hash,name,created_at) VALUES(?,?,?,?,?)',
        )
        .run(id, userId, hashToken(token), name.trim(), this.auth.now());
      return { id, token };
    });
  }
  list(userId: string): AccessToken[] {
    this.member(userId);
    return this.auth.database
      .prepare(
        `SELECT ${fields} FROM auth_access_tokens WHERE user_id=? ORDER BY created_at DESC,id`,
      )
      .all(userId)
      .map((row) => ({ ...row, revoked: Boolean(row.revoked) })) as unknown as AccessToken[];
  }
  adminList(userId: string) {
    if (!this.auth.user(userId)?.is_admin) throw new AuthError(404, 'Not found.');
    return this.auth.database
      .prepare(
        `SELECT t.id,t.user_id AS userId,u.name AS userName,t.name,t.created_at AS createdAt,t.last_used_at AS lastUsedAt,t.revoked
      FROM auth_access_tokens t JOIN auth_users u ON u.id=t.user_id ORDER BY t.created_at DESC,t.id`,
      )
      .all()
      .map((row) => ({ ...row, revoked: Boolean(row.revoked) }));
  }
  revoke(userId: string, id: string) {
    this.member(userId);
    const result = this.auth.database
      .prepare('UPDATE auth_access_tokens SET revoked=1 WHERE id=? AND user_id=?')
      .run(id, userId);
    if (!result.changes) throw new AuthError(404, 'Token not found.');
  }
  authenticate(token: string | undefined) {
    if (!token || !/^spinel_[A-Za-z0-9_-]{43}$/.test(token))
      throw new AuthError(401, 'A valid Spinel access token is required.');
    const hash = hashToken(token);
    const identity = this.byHash(hash);
    this.auth.database
      .prepare('UPDATE auth_access_tokens SET last_used_at=? WHERE id=?')
      .run(this.auth.now(), identity.id);
    return { ...identity, hash };
  }
  byHash(hash: string) {
    return accessTokenIdentity(this.auth, hash);
  }
}
