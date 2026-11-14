import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { AuthError } from '../auth/store.ts';
import type { AuthStore } from '../auth/store.ts';
import type { GuestRole } from '../../shared/workspace.ts';
import type { GuestLinkExpiryDays } from '../../shared/guestLinks.ts';
import { isOrdinaryItem } from './ordinary-scope.ts';
import { currentGuestSession } from './guest-session.ts';
import { resolveSpaceScope } from './space-scope.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const GUEST_TTL = 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
export function linkExpiryDays(value: unknown): GuestLinkExpiryDays {
  if (value !== null && value !== 1 && value !== 7 && value !== 30)
    throw new AuthError(400, 'Choose never, one day, seven days or 30 days.');
  return value;
}
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
  private readonly spacesEnabled: boolean;
  constructor(auth: AuthStore, spacesEnabled = false) {
    this.auth = auth;
    this.spacesEnabled = spacesEnabled;
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
    const columns = new Set(
      auth.database
        .prepare('PRAGMA table_info(workspace_links)')
        .all()
        .map((column) => column.name),
    );
    // Missing dates are genuinely unknown. Migration cannot rotate a capability
    // or manufacture a historical enable date from document timestamps.
    for (const [name, type] of [
      ['preview_hash', 'TEXT'],
      ['enabled_at', 'INTEGER'],
      ['expires_at', 'INTEGER'],
    ])
      if (!columns.has(name))
        auth.database.exec(`ALTER TABLE workspace_links ADD COLUMN ${name} ${type}`);
    auth.database.exec(`CREATE INDEX IF NOT EXISTS workspace_links_expiry
      ON workspace_links(expires_at) WHERE state IN ('active','pending') AND expires_at IS NOT NULL`);
  }
  private available(id: string) {
    if (isOrdinaryItem(this.auth.database, id)) return true;
    if (!this.spacesEnabled) return false;
    const root = this.auth.database
      .prepare("SELECT owner_id FROM workspace_items WHERE id=? AND kind='space'")
      .get(id) as { owner_id: string } | undefined;
    if (!root) return false;
    try {
      resolveSpaceScope(this.auth, root.owner_id, id, id, 'owner');
      return true;
    } catch (error) {
      if (error instanceof AuthError) return false;
      throw error;
    }
  }
  /** This separate capability reveals only the shared title/kind, never content. */
  preview(id: unknown, secret: unknown) {
    if (typeof id !== 'string' || typeof secret !== 'string' || !/^[\w-]{43}$/.test(secret))
      return undefined;
    if (!this.available(id)) return undefined;
    return this.auth.database
      .prepare(
        `SELECT i.name,i.kind FROM workspace_links l
      JOIN workspace_items i ON i.id=l.item_id JOIN auth_users u ON u.id=i.owner_id
      WHERE l.item_id=? AND l.preview_hash=? AND l.state='active'
      AND (l.expires_at IS NULL OR l.expires_at>?)
      AND i.trashed_at IS NULL AND u.disabled=0 AND i.kind IN ('sheet','doc','space')`,
      )
      .get(id, hash(secret), this.auth.now()) as
      { name: string; kind: 'sheet' | 'doc' | 'space' } | undefined;
  }
  state(id: string) {
    if (!this.available(id)) return undefined;
    return this.auth.database
      .prepare(
        'SELECT epoch,state,role,enabled_at AS enabledAt,expires_at AS expiresAt FROM workspace_links WHERE item_id=?',
      )
      .get(id) as
      | {
          epoch: number;
          state: 'off' | 'pending' | 'active';
          role: GuestRole;
          enabledAt: number | null;
          expiresAt: number | null;
        }
      | undefined;
  }
  metadata(id: string) {
    const state = this.state(id);
    const expired =
      state?.expiresAt !== null &&
      state?.expiresAt !== undefined &&
      state.expiresAt <= this.auth.now();
    return {
      enabled: state?.state === 'active' && !expired,
      role: state?.role ?? 'viewer',
      epoch: state?.epoch ?? 0,
      enabledAt: state?.enabledAt ?? null,
      expiresAt: state?.expiresAt ?? null,
      expired,
    };
  }
  epoch(id: string) {
    return this.state(id)?.epoch ?? 0;
  }
  assertEpoch(id: string, epoch: unknown) {
    if (!this.available(id)) throw linkGone();
    const state = this.state(id);
    if (state?.state === 'pending' || (state?.epoch ?? 0) !== epoch) throw linkGone();
  }
  begin(
    id: string,
    role: GuestRole | null,
    expiryDays: GuestLinkExpiryDays = null,
    expectedEpoch?: number,
    expectedExpiresAt?: number | null,
  ) {
    return this.auth.transaction(() => {
      if (!this.available(id)) throw linkGone();
      const state = this.state(id);
      if (
        expectedEpoch !== undefined &&
        (state?.epoch !== expectedEpoch ||
          (expectedExpiresAt !== undefined && state.expiresAt !== expectedExpiresAt))
      )
        throw new AuthError(409, 'This link changed. Refresh Guest links and try again.');
      if (state?.state === 'pending')
        throw new AuthError(409, 'Sharing is changing. Try again shortly.');
      linkExpiryDays(expiryDays);
      return this.transition(id, role, state?.epoch ?? 0, expiryDays);
    });
  }
  private transition(
    id: string,
    role: GuestRole | null,
    previousEpoch: number,
    expiryDays: GuestLinkExpiryDays,
    expired?: { role: GuestRole; enabledAt: number | null; expiresAt: number },
  ) {
    const epoch = previousEpoch + 1;
    const token = role ? randomBytes(32).toString('base64url') : null;
    const previewToken = role ? randomBytes(32).toString('base64url') : null;
    const now = this.auth.now();
    this.auth.database
      .prepare(
        `INSERT INTO workspace_links (item_id,epoch,state,role,token_hash,preview_hash,enabled_at,expires_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(item_id) DO UPDATE SET epoch=excluded.epoch,state=excluded.state,role=excluded.role,token_hash=excluded.token_hash,preview_hash=excluded.preview_hash,enabled_at=excluded.enabled_at,expires_at=excluded.expires_at`,
      )
      .run(
        id,
        epoch,
        'pending',
        role ?? expired?.role ?? 'viewer',
        token ? hash(token) : null,
        previewToken ? hash(previewToken) : null,
        expired ? expired.enabledAt : role ? now : null,
        expired ? expired.expiresAt : role && expiryDays !== null ? now + expiryDays * DAY : null,
      );
    this.auth.database.prepare('DELETE FROM workspace_guest_sessions WHERE item_id=?').run(id);
    return { epoch, token, previewToken };
  }
  changeExpiry(
    id: string,
    epoch: number,
    expiryDays: GuestLinkExpiryDays,
    expectedExpiresAt?: number | null,
  ) {
    this.auth.transaction(() => {
      linkExpiryDays(expiryDays);
      const state = this.state(id);
      if (
        state?.epoch !== epoch ||
        (expectedExpiresAt !== undefined && state.expiresAt !== expectedExpiresAt)
      )
        throw new AuthError(409, 'This link changed. Refresh Guest links and try again.');
      if (
        state.state !== 'active' ||
        (state.expiresAt !== null && state.expiresAt <= this.auth.now())
      )
        throw new AuthError(409, 'This link is no longer active. Create a fresh link from Share.');
      this.auth.database
        .prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=? AND epoch=?')
        .run(expiryDays === null ? null : this.auth.now() + expiryDays * DAY, id, epoch);
    });
  }
  expiring() {
    return this.auth.database
      .prepare(
        `SELECT item_id AS id FROM workspace_links
      WHERE state IN ('active','pending') AND expires_at IS NOT NULL AND expires_at<=?
        AND (state='active' OR token_hash IS NULL)`,
      )
      .all(this.auth.now()) as { id: string }[];
  }
  /** Fence one root independently; a failed root cannot starve unrelated expiry. */
  beginExpiry(id: string) {
    return this.auth.transaction(() => {
      const row = this.auth.database
        .prepare(
          `SELECT epoch,state,role,enabled_at AS enabledAt,expires_at AS expiresAt
        FROM workspace_links WHERE item_id=? AND state IN ('active','pending')
          AND expires_at IS NOT NULL AND expires_at<=? AND (state='active' OR token_hash IS NULL)`,
        )
        .get(id, this.auth.now()) as
        | {
            epoch: number;
            state: string;
            role: GuestRole;
            enabledAt: number | null;
            expiresAt: number;
          }
        | undefined;
      if (!row) return undefined;
      // A previous eviction may have succeeded before its final state write
      // failed. Retrying that fence keeps the epoch instead of rotating again.
      return row.state === 'pending'
        ? { id, epoch: row.epoch }
        : { id, epoch: this.transition(id, null, row.epoch, null, row).epoch };
    });
  }
  finish(id: string, epoch: number, enabled: boolean) {
    // Recheck the complete target after admission drains. Revocation remains
    // allowed so failure cleanup can always close a pending capability.
    if (enabled && !this.available(id)) throw linkGone();
    this.auth.database
      .prepare(
        `UPDATE workspace_links SET state=?,
          enabled_at=CASE WHEN ? OR token_hash IS NULL THEN enabled_at ELSE NULL END,
          expires_at=CASE WHEN ? OR token_hash IS NULL THEN expires_at ELSE NULL END,
          token_hash=CASE WHEN ? THEN token_hash ELSE NULL END,
          preview_hash=CASE WHEN ? THEN preview_hash ELSE NULL END
        WHERE item_id=? AND epoch=? AND state='pending'`,
      )
      .run(
        enabled ? 'active' : 'off',
        Number(enabled),
        Number(enabled),
        Number(enabled),
        Number(enabled),
        id,
        epoch,
      );
  }
  recover() {
    // A crash during eviction must never publish a partially activated capability.
    this.auth.database.exec(
      `UPDATE workspace_links SET state='off',
        enabled_at=CASE WHEN token_hash IS NULL THEN enabled_at ELSE NULL END,
        expires_at=CASE WHEN token_hash IS NULL THEN expires_at ELSE NULL END,
        token_hash=NULL,preview_hash=NULL WHERE state='pending'`,
    );
  }
  exchange(id: string, secret: unknown, currentToken?: string) {
    if (typeof secret !== 'string' || !/^[\w-]{43}$/.test(secret)) throw linkGone();
    return this.auth.transaction(() => {
      if (!this.available(id)) throw linkGone();
      const link = this.auth.database
        .prepare(
          `SELECT l.epoch FROM workspace_links l
        JOIN workspace_items i ON i.id=l.item_id JOIN auth_users u ON u.id=i.owner_id
        WHERE l.item_id=? AND l.state='active' AND l.token_hash=?
          AND (l.expires_at IS NULL OR l.expires_at>?) AND i.trashed_at IS NULL AND u.disabled=0`,
        )
        .get(id, hash(secret), this.auth.now());
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
    const session = currentGuestSession(this.auth, userId);
    return session && (!itemId || session.itemId === itemId) && this.available(session.itemId)
      ? session
      : undefined;
  }
  session(userId: string, suppliedHash: unknown) {
    const session = this.access(userId);
    if (!session || session.tokenHash !== suppliedHash) throw linkGone();
    return session;
  }
}
