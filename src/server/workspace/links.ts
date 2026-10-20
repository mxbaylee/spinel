import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { AuthError } from '../auth/store.ts';
import type { AuthStore } from '../auth/store.ts';
import type { GrantRole } from '../../shared/workspace.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const GUEST_TTL = 24 * 60 * 60 * 1000;
export const linkGone = () => new AuthError(404, 'This link no longer works.');
export const guestCookieName = (id: string) => `__Host-spinel-guest-${id}`;
export function guestCookie(headers: IncomingHttpHeaders, id: string) {
  if (!/^[a-f\d-]{36}$/.test(id)) return undefined;
  const prefix = `${guestCookieName(id)}=`;
  const values = (headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));
  return values.length === 1 ? values[0].slice(prefix.length) : undefined;
}

/** Capabilities are independent of accounts, and never resolve to the document owner. */
export class LinkAccess {
  readonly auth: AuthStore;
  constructor(auth: AuthStore) {
    this.auth = auth;
    auth.database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_links (
        item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
        epoch INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('off','pending','active')),
        role TEXT NOT NULL CHECK(role IN ('viewer','editor')), token_hash TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workspace_guest_sessions (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        item_id TEXT NOT NULL REFERENCES workspace_links(item_id) ON DELETE CASCADE,
        epoch INTEGER NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workspace_guest_item ON workspace_guest_sessions(item_id);
    `);
    if (
      !auth.database
        .prepare('PRAGMA table_info(workspace_links)')
        .all()
        .some((column) => column.name === 'preview_hash')
    )
      auth.database.exec('ALTER TABLE workspace_links ADD COLUMN preview_hash TEXT');
  }
  /** This separate capability reveals only the shared title/kind, never content. */
  preview(id: unknown, secret: unknown) {
    if (typeof id !== 'string' || typeof secret !== 'string' || !/^[\w-]{43}$/.test(secret))
      return undefined;
    return this.auth.database
      .prepare(
        `SELECT i.name,i.kind FROM workspace_links l
      JOIN workspace_items i ON i.id=l.item_id JOIN auth_users u ON u.id=i.owner_id
      WHERE l.item_id=? AND l.preview_hash=? AND l.state='active'
      AND i.trashed_at IS NULL AND u.disabled=0 AND i.kind IN ('sheet','doc')`,
      )
      .get(id, hash(secret)) as { name: string; kind: 'sheet' | 'doc' } | undefined;
  }
  state(id: string) {
    return this.auth.database
      .prepare('SELECT epoch,state,role FROM workspace_links WHERE item_id=?')
      .get(id) as
      { epoch: number; state: 'off' | 'pending' | 'active'; role: GrantRole } | undefined;
  }
  epoch(id: string) {
    return this.state(id)?.epoch ?? 0;
  }
  assertEpoch(id: string, epoch: unknown) {
    const state = this.state(id);
    if (state?.state === 'pending' || (state?.epoch ?? 0) !== epoch) throw linkGone();
  }
  begin(id: string, role: GrantRole | null) {
    return this.auth.transaction(() => {
      if (this.state(id)?.state === 'pending')
        throw new AuthError(409, 'Sharing is changing. Try again shortly.');
      const epoch = this.epoch(id) + 1;
      const token = role ? randomBytes(32).toString('base64url') : null;
      const previewToken = role ? randomBytes(32).toString('base64url') : null;
      this.auth.database
        .prepare(
          `INSERT INTO workspace_links (item_id,epoch,state,role,token_hash,preview_hash) VALUES(?,?,?,?,?,?)
        ON CONFLICT(item_id) DO UPDATE SET epoch=excluded.epoch,state=excluded.state,role=excluded.role,token_hash=excluded.token_hash,preview_hash=excluded.preview_hash`,
        )
        .run(
          id,
          epoch,
          'pending',
          role ?? 'viewer',
          token ? hash(token) : null,
          previewToken ? hash(previewToken) : null,
        );
      this.auth.database.prepare('DELETE FROM workspace_guest_sessions WHERE item_id=?').run(id);
      return { epoch, token, previewToken };
    });
  }
  finish(id: string, epoch: number, enabled: boolean) {
    this.auth.database
      .prepare(
        "UPDATE workspace_links SET state=?,token_hash=CASE WHEN ? THEN token_hash ELSE NULL END,preview_hash=CASE WHEN ? THEN preview_hash ELSE NULL END WHERE item_id=? AND epoch=? AND state='pending'",
      )
      .run(enabled ? 'active' : 'off', Number(enabled), Number(enabled), id, epoch);
  }
  recover() {
    // A crash during eviction must never publish a partially activated capability.
    this.auth.database.exec(
      "UPDATE workspace_links SET state='off',token_hash=NULL,preview_hash=NULL WHERE state='pending'",
    );
  }
  exchange(id: string, secret: unknown, currentToken?: string) {
    if (typeof secret !== 'string' || !/^[\w-]{43}$/.test(secret)) throw linkGone();
    return this.auth.transaction(() => {
      const link = this.auth.database
        .prepare(
          `SELECT l.epoch FROM workspace_links l
        JOIN workspace_items i ON i.id=l.item_id JOIN auth_users u ON u.id=i.owner_id
        WHERE l.item_id=? AND l.state='active' AND l.token_hash=? AND i.trashed_at IS NULL AND u.disabled=0`,
        )
        .get(id, hash(secret));
      if (!link) throw linkGone();
      // A second tab must keep the same authenticated subject for HTTP and socket ACKs.
      // Validate the fragment above even when a current cookie exists: old links stay revoked.
      if (currentToken && /^[\w-]{43}$/.test(currentToken)) {
        const existing = this.auth.database
          .prepare(
            'SELECT id,expires_at FROM workspace_guest_sessions WHERE token_hash=? AND item_id=? AND epoch=? AND expires_at>?',
          )
          .get(hash(currentToken), id, link.epoch as number, this.auth.now());
        if (existing)
          return {
            token: currentToken,
            expires: Number(existing.expires_at),
            userId: `guest:${existing.id}`,
          };
      }

      this.auth.database
        .prepare('DELETE FROM workspace_guest_sessions WHERE expires_at<=?')
        .run(this.auth.now());
      const count = this.auth.database
        .prepare('SELECT count(*) AS n FROM workspace_guest_sessions')
        .get()!;
      if (Number(count.n) >= 128)
        throw new AuthError(429, 'Too many guest sessions. Try again later.');
      const token = randomBytes(32).toString('base64url'),
        sessionId = randomUUID(),
        expires = this.auth.now() + GUEST_TTL;
      this.auth.database
        .prepare('INSERT INTO workspace_guest_sessions VALUES(?,?,?,?,?)')
        .run(sessionId, hash(token), id, link.epoch as number, expires);
      return { token, expires, userId: `guest:${sessionId}` };
    });
  }
  principal(headers: IncomingHttpHeaders, id: string) {
    const token = guestCookie(headers, id);
    if (!token || !/^[\w-]{43}$/.test(token)) throw linkGone();
    const session = this.auth.database
      .prepare('SELECT id FROM workspace_guest_sessions WHERE token_hash=? AND item_id=?')
      .get(hash(token), id);
    const userId = session ? `guest:${session.id}` : '';
    if (!this.access(userId, id)) throw linkGone();
    return { userId, guestHash: hash(token), itemId: id };
  }
  access(userId: string, itemId?: string) {
    if (!userId.startsWith('guest:')) return undefined;
    const session = this.auth.database
      .prepare(
        `SELECT s.item_id AS itemId,l.role,s.token_hash AS tokenHash,s.expires_at AS expires
      FROM workspace_guest_sessions s JOIN workspace_links l ON l.item_id=s.item_id AND l.epoch=s.epoch
      JOIN workspace_items i ON i.id=s.item_id JOIN auth_users u ON u.id=i.owner_id
      WHERE s.id=? AND s.expires_at>? AND l.state='active' AND i.trashed_at IS NULL AND u.disabled=0`,
      )
      .get(userId.slice(6), this.auth.now()) as
      { itemId: string; role: GrantRole; tokenHash: string; expires: number } | undefined;
    return session && (!itemId || session.itemId === itemId) ? session : undefined;
  }
  session(userId: string, suppliedHash: unknown) {
    const session = this.access(userId);
    if (!session || session.tokenHash !== suppliedHash) throw linkGone();
    return session;
  }
}
