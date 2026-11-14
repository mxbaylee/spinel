import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { AuthError, hashToken, randomToken } from './store.ts';
import type { AuthStore, Session } from './store.ts';

export const MCP_SCOPES = ['documents:read', 'documents:write'];
const ACCESS_MS = 15 * 60_000;
const REFRESH_MS = 30 * 24 * 60 * 60_000;
type Pending = {
  id: string;
  client_id: string;
  redirect_uri: string;
  challenge: string;
  scopes: string;
  state: string | null;
  expires_at: number;
  session_hash: string | null;
  used: number;
};
type Grant = {
  id: string;
  user_id: string;
  client_id: string;
  name: string;
  redirect_origin: string;
  scopes: string;
  resource: string;
  created_at: number;
  last_used_at: number | null;
  revoked: number;
};

/** Every bearer and durable commit reads current account, connection, expiry and scope. */
export function oauthAccessIdentity(auth: AuthStore, hash: string) {
  const row = auth.database
    .prepare(
      `SELECT a.id,g.id AS connectionId,g.user_id AS userId,a.scopes,g.resource
       FROM oauth_access a JOIN oauth_connections g ON g.id=a.connection_id
       JOIN auth_users u ON u.id=g.user_id
       WHERE a.token_hash=? AND a.expires_at>? AND a.revoked=0 AND g.revoked=0
       AND u.disabled=0 AND u.is_admin=0`,
    )
    .get(hash, auth.now()) as
    | { id: string; connectionId: string; userId: string; scopes: string; resource: string }
    | undefined;
  if (!row) throw new AuthError(401, 'This assistant connection is no longer available.');
  return { ...row, scopes: JSON.parse(row.scopes) as string[] };
}

/** Same-process OAuth authorization server; no new accounts or external identity provider. */
export class AssistantOAuth implements OAuthServerProvider {
  readonly auth: AuthStore;
  readonly origin: string;
  readonly resource: string;
  constructor(auth: AuthStore, origin: string) {
    this.auth = auth;
    this.origin = new URL(origin).origin;
    this.resource = `${this.origin}/mcp`;
    auth.database.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        id TEXT PRIMARY KEY, metadata TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS oauth_pending (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES oauth_clients(id),
        redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, scopes TEXT NOT NULL,
        state TEXT, expires_at INTEGER NOT NULL, session_hash TEXT, used INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS oauth_connections (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES oauth_clients(id), name TEXT NOT NULL,
        redirect_origin TEXT NOT NULL, scopes TEXT NOT NULL, resource TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS oauth_codes (
        code_hash TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES oauth_connections(id) ON DELETE CASCADE,
        redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, session_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS oauth_access (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        connection_id TEXT NOT NULL REFERENCES oauth_connections(id) ON DELETE CASCADE,
        scopes TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS oauth_refresh (
        token_hash TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES oauth_connections(id) ON DELETE CASCADE,
        scopes TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
      ) STRICT;
    `);
  }
  private member(userId: string) {
    const user = this.auth.user(userId);
    if (!user || user.is_admin)
      throw new AuthError(403, 'Sign in with your everyday account to connect an assistant.');
  }
  private scopes(input: string[], allowed = MCP_SCOPES) {
    const scopes = [...new Set(input)].sort();
    if (!scopes.includes('documents:read') || scopes.some((scope) => !allowed.includes(scope)))
      throw new InvalidScopeError('Choose document read access, with optional edit access.');
    return scopes;
  }
  private target(resource: URL | undefined) {
    if (!resource || resource.href !== this.resource)
      throw new InvalidTargetError('This authorization is only for this Spinel MCP endpoint.');
  }
  readonly clientsStore = {
    getClient: (id: string): OAuthClientInformationFull | undefined => {
      const row = this.auth.database
        .prepare('SELECT metadata FROM oauth_clients WHERE id=?')
        .get(id);
      return row ? JSON.parse(String(row.metadata)) : undefined;
    },
    registerClient: (
      input: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
    ): OAuthClientInformationFull => {
      // Public clients use PKCE. No secret persistence or remote metadata/logo fetching.
      if (input.token_endpoint_auth_method !== 'none')
        throw new InvalidClientMetadataError('Use public-client authentication with PKCE.');
      if (
        typeof input.client_name !== 'string' ||
        !input.client_name.trim() ||
        input.client_name.length > 80 ||
        input.redirect_uris.length < 1 ||
        input.redirect_uris.length > 5 ||
        input.redirect_uris.some((value) => {
          const url = new URL(value);
          return (
            Boolean(url.hash || url.username || url.password) ||
            (url.protocol !== 'https:' &&
              !(
                url.protocol === 'http:' &&
                ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
              ))
          );
        })
      )
        throw new InvalidClientMetadataError(
          'Provide an app name and valid HTTPS or loopback callbacks.',
        );
      this.auth.database
        .prepare('DELETE FROM oauth_pending WHERE expires_at<?')
        .run(this.auth.now());
      this.auth.database
        .prepare(
          `DELETE FROM oauth_clients WHERE created_at<? AND
         NOT EXISTS(SELECT 1 FROM oauth_pending p WHERE p.client_id=oauth_clients.id) AND
         NOT EXISTS(SELECT 1 FROM oauth_connections g WHERE g.client_id=oauth_clients.id)`,
        )
        .run(this.auth.now() - 24 * 60 * 60_000);
      if (
        Number(this.auth.database.prepare('SELECT count(*) AS n FROM oauth_clients').get()!.n) >=
        1000
      )
        throw new InvalidClientMetadataError(
          'This instance has reached its registered client limit.',
        );
      const client: OAuthClientInformationFull = {
        client_id: randomUUID(),
        client_id_issued_at: Math.floor(this.auth.now() / 1000),
        client_name: input.client_name.trim(),
        redirect_uris: input.redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };
      this.auth.database
        .prepare('INSERT INTO oauth_clients VALUES(?,?,?)')
        .run(client.client_id, JSON.stringify(client), this.auth.now());
      return client;
    },
  };
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    response: Response,
  ) {
    this.target(params.resource);
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) || (params.state?.length ?? 0) > 1024)
      throw new InvalidGrantError('Invalid authorization request.');
    const scopes = this.scopes(params.scopes?.length ? params.scopes : MCP_SCOPES);
    const id = randomUUID();
    this.auth.database.prepare('DELETE FROM oauth_pending WHERE expires_at<?').run(this.auth.now());
    if (
      Number(this.auth.database.prepare('SELECT count(*) AS n FROM oauth_pending').get()!.n) >= 1000
    )
      throw new InvalidGrantError('Too many pending connections. Try again later.');
    this.auth.database
      .prepare(
        'INSERT INTO oauth_pending(id,client_id,redirect_uri,challenge,scopes,state,expires_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        id,
        client.client_id,
        params.redirectUri,
        params.codeChallenge,
        JSON.stringify(scopes),
        params.state ?? null,
        this.auth.now() + 10 * 60_000,
      );
    response.redirect(302, `/connect?request=${id}`);
  }
  private pending(id: string, session: Session) {
    this.member(session.user_id!);
    const row = this.auth.database.prepare('SELECT * FROM oauth_pending WHERE id=?').get(id) as
      Pending | undefined;
    if (!row || row.used || row.expires_at <= this.auth.now())
      throw new AuthError(410, 'This connection request expired. Start again from your assistant.');
    if (row.session_hash && row.session_hash !== session.token_hash)
      throw new AuthError(403, 'Open this request in the browser where you started approval.');
    return row;
  }
  details(id: string, session: Session) {
    return this.auth.transaction(() => {
      const row = this.pending(id, session);
      this.auth.database
        .prepare('UPDATE oauth_pending SET session_hash=? WHERE id=?')
        .run(session.token_hash, id);
      return {
        request: id,
        name: this.clientsStore.getClient(row.client_id)!.client_name!,
        redirectOrigin: new URL(row.redirect_uri).origin,
        scopes: JSON.parse(row.scopes) as string[],
        expiresAt: row.expires_at,
      };
    });
  }
  consent(id: string, session: Session, allow: unknown) {
    if (typeof allow !== 'boolean') throw new AuthError(400, 'Choose Allow or Cancel.');
    return this.auth.transaction(() => {
      const row = this.pending(id, session);
      if (row.session_hash !== session.token_hash)
        throw new AuthError(403, 'Review this connection request before approving it.');
      const redirect = new URL(row.redirect_uri);
      if (row.state !== null) redirect.searchParams.set('state', row.state);
      if (allow) {
        const count = this.auth.database
          .prepare('SELECT count(*) AS n FROM oauth_connections WHERE user_id=? AND revoked=0')
          .get(session.user_id!)!;
        if (Number(count.n) >= 10)
          throw new AuthError(409, 'Disconnect an old assistant in settings first (limit 10).');
        const connection = randomUUID(),
          code = randomToken();
        this.auth.database
          .prepare(
            'INSERT INTO oauth_connections(id,user_id,client_id,name,redirect_origin,scopes,resource,created_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .run(
            connection,
            session.user_id!,
            row.client_id,
            this.clientsStore.getClient(row.client_id)!.client_name!,
            redirect.origin,
            row.scopes,
            this.resource,
            this.auth.now(),
          );
        this.auth.database
          .prepare('INSERT INTO oauth_codes VALUES(?,?,?,?,?,?)')
          .run(
            hashToken(code),
            connection,
            row.redirect_uri,
            row.challenge,
            session.token_hash,
            this.auth.now() + 60_000,
          );
        redirect.searchParams.set('code', code);
      } else redirect.searchParams.set('error', 'access_denied');
      this.auth.database.prepare('UPDATE oauth_pending SET used=1 WHERE id=?').run(id);
      return { redirect: redirect.href };
    });
  }
  private grant(id: string, client: OAuthClientInformationFull) {
    const row = this.auth.database.prepare('SELECT * FROM oauth_connections WHERE id=?').get(id) as
      Grant | undefined;
    if (!row || row.revoked || row.client_id !== client.client_id)
      throw new InvalidGrantError('This connection is no longer available.');
    if (!this.auth.user(row.user_id) || this.auth.user(row.user_id)?.is_admin)
      throw new InvalidGrantError('This account is no longer available.');
    if (row.resource !== this.resource)
      throw new InvalidGrantError('The connection resource changed.');
    return row;
  }
  private code(client: OAuthClientInformationFull, code: string) {
    const row = this.auth.database
      .prepare('SELECT * FROM oauth_codes WHERE code_hash=?')
      .get(hashToken(code)) as
      | {
          connection_id: string;
          redirect_uri: string;
          challenge: string;
          session_hash: string;
          expires_at: number;
        }
      | undefined;
    if (!row || row.expires_at <= this.auth.now() || !this.auth.sessionByHash(row.session_hash))
      throw new InvalidGrantError('This authorization code expired or was already used.');
    const grant = this.grant(row.connection_id, client);
    if (this.auth.sessionByHash(row.session_hash)?.user_id !== grant.user_id)
      throw new InvalidGrantError('This authorization session is no longer available.');
    return { ...row, grant };
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    return this.code(client, code).challenge;
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ) {
    this.target(resource);
    return this.auth.transaction(() => {
      const row = this.code(client, code);
      if (redirectUri !== row.redirect_uri)
        throw new InvalidGrantError('The callback does not match.');
      this.auth.database.prepare('DELETE FROM oauth_codes WHERE code_hash=?').run(hashToken(code));
      return this.issue(row.grant, JSON.parse(row.grant.scopes) as string[]);
    });
  }
  private issue(grant: Grant, scopes: string[]) {
    const access = `spinel_oauth_${randomToken()}`,
      refresh = randomToken();
    this.auth.database.prepare('DELETE FROM oauth_access WHERE expires_at<?').run(this.auth.now());
    this.auth.database.prepare('DELETE FROM oauth_refresh WHERE expires_at<?').run(this.auth.now());
    this.auth.database.prepare('DELETE FROM oauth_codes WHERE expires_at<?').run(this.auth.now());
    this.auth.database
      .prepare(
        'INSERT INTO oauth_access(id,token_hash,connection_id,scopes,expires_at) VALUES(?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        hashToken(access),
        grant.id,
        JSON.stringify(scopes),
        this.auth.now() + ACCESS_MS,
      );
    this.auth.database
      .prepare(
        'INSERT INTO oauth_refresh(token_hash,connection_id,scopes,expires_at) VALUES(?,?,?,?)',
      )
      .run(hashToken(refresh), grant.id, JSON.stringify(scopes), this.auth.now() + REFRESH_MS);
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_MS / 1000,
      refresh_token: refresh,
      scope: scopes.join(' '),
    };
  }
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    token: string,
    requested?: string[],
    resource?: URL,
  ) {
    this.target(resource);
    const result = this.auth.transaction(() => {
      const row = this.auth.database
        .prepare('SELECT * FROM oauth_refresh WHERE token_hash=?')
        .get(hashToken(token)) as
        { connection_id: string; scopes: string; expires_at: number; used: number } | undefined;
      if (!row || row.expires_at <= this.auth.now())
        throw new InvalidGrantError('This refresh token expired.');
      const grant = this.grant(row.connection_id, client);
      if (row.used) {
        this.auth.database
          .prepare('UPDATE oauth_connections SET revoked=1 WHERE id=?')
          .run(grant.id);
        return null;
      }
      const scopes = this.scopes(
        requested ?? JSON.parse(row.scopes),
        JSON.parse(row.scopes) as string[],
      );
      this.auth.database
        .prepare('UPDATE oauth_refresh SET used=1 WHERE token_hash=?')
        .run(hashToken(token));
      return this.issue(grant, scopes);
    });
    if (!result) throw new InvalidGrantError('Refresh token reuse disconnected this assistant.');
    return result;
  }
  authenticate(token: string) {
    const hash = hashToken(token);
    const identity = oauthAccessIdentity(this.auth, hash);
    if (identity.resource !== this.resource)
      throw new AuthError(401, 'Invalid assistant endpoint.');
    this.auth.database
      .prepare('UPDATE oauth_connections SET last_used_at=? WHERE id=?')
      .run(this.auth.now(), identity.connectionId);
    return { ...identity, hash };
  }
  async verifyAccessToken(token: string) {
    const identity = this.authenticate(token);
    const row = this.auth.database
      .prepare(
        'SELECT a.expires_at,g.client_id FROM oauth_access a JOIN oauth_connections g ON g.id=a.connection_id WHERE a.id=?',
      )
      .get(identity.id)!;
    return {
      token,
      clientId: String(row.client_id),
      scopes: identity.scopes,
      expiresAt: Number(row.expires_at) / 1000,
      resource: new URL(this.resource),
    };
  }
  async revokeToken(client: OAuthClientInformationFull, request: { token: string }) {
    const hash = hashToken(request.token);
    this.auth.database
      .prepare(
        `UPDATE oauth_connections SET revoked=1 WHERE client_id=? AND id IN (
        SELECT connection_id FROM oauth_access WHERE token_hash=?
        UNION SELECT connection_id FROM oauth_refresh WHERE token_hash=?)`,
      )
      .run(client.client_id, hash, hash);
  }
  list(userId: string, admin = false) {
    if (admin) {
      if (!this.auth.user(userId)?.is_admin) throw new AuthError(404, 'Not found.');
    } else this.member(userId);
    const rows = this.auth.database
      .prepare(
        `SELECT g.id,g.name,g.redirect_origin AS redirectOrigin,g.scopes,g.created_at AS createdAt,
       g.last_used_at AS lastUsedAt,g.revoked,u.name AS userName
       FROM oauth_connections g JOIN auth_users u ON u.id=g.user_id
       ${admin ? '' : 'WHERE g.user_id=?'} ORDER BY g.created_at DESC,g.id`,
      )
      .all(...(admin ? [] : [userId]));
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      redirectOrigin: String(row.redirectOrigin),
      createdAt: Number(row.createdAt),
      lastUsedAt: row.lastUsedAt === null ? null : Number(row.lastUsedAt),
      userName: String(row.userName),
      revoked: Boolean(row.revoked),
      scopes: JSON.parse(String(row.scopes)) as string[],
    }));
  }
  disconnect(userId: string, id: string) {
    this.member(userId);
    if (
      !this.auth.database
        .prepare('UPDATE oauth_connections SET revoked=1 WHERE id=? AND user_id=?')
        .run(id, userId).changes
    )
      throw new AuthError(404, 'Connection not found.');
  }
}
