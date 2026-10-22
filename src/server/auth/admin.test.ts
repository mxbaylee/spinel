import { DatabaseSync } from '../../../server/database.ts';
import { afterEach, expect, test } from 'vitest';
import { AuthStore } from './store.ts';
import { AdminStore } from './admin.ts';
import { InvitationService } from './invitations.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { AssistantOAuth } from './oauth.ts';
import { AccessTokens } from './tokens.ts';
import { randomToken } from './store.ts';
import type { Response } from 'express';
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('PRAGMA foreign_keys=ON');
  const auth = new AuthStore(db),
    invites = new InvitationService(auth, 'http://localhost:3000');
  const admin = new AdminStore(auth, invites),
    operator = auth.createUser('Operator', true),
    owner = auth.createUser('Owner'),
    collaborator = auth.createUser('Collaborator');
  const key = (user: string, id: string) => {
    db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      id,
      user,
      Buffer.from([1]),
      0,
      '[]',
      id,
      'Browser',
      auth.now(),
      null,
      0,
      'singleDevice',
    );
    return id;
  };
  key(operator.id, 'operator-key');
  return { db, auth, invites, admin, operator, owner, collaborator, key };
}

test('legacy session schema is migrated idempotently without losing active sessions', () => {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(
    'CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER NOT NULL) STRICT;',
  );
  db.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run('old', null, Date.now() + 60_000);
  const auth = new AuthStore(db);
  expect(auth.sessionByHash('old')?.passkey_id).toBeNull();
  new AuthStore(db);
  expect(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()?.n).toBe(1);
  expect(
    db
      .prepare('PRAGMA table_info(auth_sessions)')
      .all()
      .filter((c) => c.name === 'passkey_id'),
  ).toHaveLength(1);
});

test('removing a passkey revokes bound and legacy sessions, preserving other keys and accounts', () => {
  const f = fixture();
  const first = f.key(f.owner.id, 'lost'),
    second = f.key(f.owner.id, 'kept');
  const lost = f.auth.createSession(f.owner.id, undefined, first),
    kept = f.auth.createSession(f.owner.id, undefined, second),
    legacy = f.auth.createSession(f.owner.id),
    other = f.auth.createSession(f.collaborator.id);
  f.auth.addChallenge(lost.session, 'registration', 'pending');
  expect(() => f.admin.removePasskey(f.collaborator.id, f.owner.id, first)).toThrow('Not found');
  expect(() => f.admin.removePasskey(f.operator.id, f.collaborator.id, first)).toThrow(
    'Passkey not found',
  );
  f.admin.removePasskey(f.operator.id, f.owner.id, first);
  expect(f.auth.session(lost.token)).toBeUndefined();
  expect(f.auth.session(legacy.token)).toBeUndefined();
  expect(f.auth.session(kept.token)?.passkey_id).toBe(second);
  expect(f.auth.session(other.token)).toBeDefined();
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM auth_challenges').get()?.n).toBe(0);
  expect(f.auth.passkey(first)).toBeUndefined();
  expect(() => f.auth.createSession(f.owner.id, undefined, first)).toThrow('no longer available');
  expect(() => f.auth.createSession(f.collaborator.id, undefined, second)).toThrow(
    'no longer available',
  );
});

test('disabled accounts retain ownership and shares while losing sessions and unused invites', () => {
  const f = fixture(),
    workspace = new WorkspaceStore(f.auth);
  const item = workspace.create(f.owner.id, { kind: 'sheet', name: 'Private', parentId: null });
  workspace.share(f.owner.id, item.id, f.collaborator.id, 'editor');
  const session = f.auth.createSession(f.owner.id);
  const recovery = f.invites.create(f.operator.id, 24, f.owner.id);
  const otherInvite = f.invites.create(f.operator.id, 24, f.collaborator.id);
  f.admin.disable(f.operator.id, f.owner.id);
  expect(f.auth.session(session.token)).toBeUndefined();
  expect(f.auth.user(f.owner.id)).toBeUndefined();
  expect(f.db.prepare('SELECT disabled FROM auth_users WHERE id=?').get(f.owner.id)?.disabled).toBe(
    1,
  );
  expect(workspace.get(f.collaborator.id, item.id, 'edit').access).toBe('editor');
  expect(
    f.db.prepare('SELECT owner_id FROM workspace_items WHERE id=?').get(item.id)?.owner_id,
  ).toBe(f.owner.id);
  expect(() => workspace.get(f.operator.id, item.id)).toThrow();
  expect(f.invites.list().find((i) => i.id === recovery.id)?.status).toBe('Revoked');
  expect(f.invites.list().find((i) => i.id === otherInvite.id)?.status).toBe('Available');
  const list = f.admin.list(f.operator.id);
  expect(list.find((u) => u.id === f.owner.id)?.disabled).toBe(true);
  expect(JSON.stringify(list)).not.toMatch(/public_key|token_hash|Private/);
});

test('operator lockout guards preserve self and the last active admin passkey', () => {
  const f = fixture();
  expect(() => f.admin.disable(f.operator.id, f.operator.id)).toThrow('own admin');
  expect(() => f.admin.removePasskey(f.operator.id, f.operator.id, 'operator-key')).toThrow(
    'last passkey',
  );
  const extra = f.key(f.operator.id, 'backup-admin');
  f.admin.removePasskey(f.operator.id, f.operator.id, extra);
  const secondary = f.auth.createUser('Second admin', true);
  f.key(secondary.id, 'secondary-key');
  const issued = f.invites.create(secondary.id);
  f.admin.disable(f.operator.id, secondary.id);
  expect(f.invites.list().find((i) => i.id === issued.id)?.status).toBe('Revoked');
  expect(() => f.admin.list(secondary.id)).toThrow('Not found');
  expect(() => f.admin.disable(f.owner.id, f.operator.id)).toThrow('Not found');
});

test('reactivation preserves account and document permissions but permanently invalidates prior credentials', async () => {
  const f = fixture();
  const workspace = new WorkspaceStore(f.auth);
  const item = workspace.create(f.owner.id, { kind: 'doc', name: 'Private', parentId: null });
  workspace.share(f.owner.id, item.id, f.collaborator.id, 'editor');
  const link = workspace.links.begin(item.id, 'viewer');
  workspace.links.finish(item.id, link.epoch, true);
  const guest = workspace.links.exchange(item.id, link.token!);
  const oldKey = f.key(f.owner.id, 'old-key');
  const session = f.auth.createSession(f.owner.id, undefined, oldKey);
  f.auth.addChallenge(session.session, 'registration', 'old-add-key');
  const invite = f.invites.create(f.operator.id, 24, f.owner.id);
  const inviteToken = new URL(invite.url).searchParams.get('token')!;
  const anonymous = f.auth.createSession(null).session;
  const ceremony = await f.invites.options(anonymous, inviteToken, '');
  const tokens = new AccessTokens(f.auth);
  const oldToken = tokens.create(f.owner.id, 'Old assistant');
  const otherToken = tokens.create(f.collaborator.id, 'Kept assistant');
  const oauth = new AssistantOAuth(f.auth, 'https://spinel.example');
  const client = oauth.clientsStore.registerClient({
    client_name: 'Assistant',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  const resource = new URL(oauth.resource);
  const pending = async () => {
    let destination = '';
    await oauth.authorize(
      client,
      {
        redirectUri: client.redirect_uris[0],
        codeChallenge: randomToken(),
        scopes: ['documents:read'],
        resource,
      },
      {
        redirect(_status: number, url: string) {
          destination = url;
        },
      } as unknown as Response,
    );
    const id = new URL(destination, oauth.origin).searchParams.get('request')!;
    oauth.details(id, session.session);
    return id;
  };
  const approved = await pending();
  const code = new URL(oauth.consent(approved, session.session, true).redirect).searchParams.get(
    'code',
  )!;
  const oauthTokens = await oauth.exchangeAuthorizationCode(
    client,
    code,
    undefined,
    client.redirect_uris[0],
    resource,
  );
  const pendingApproval = await pending();
  expect(oauth.authenticate(oauthTokens.access_token).userId).toBe(f.owner.id);
  expect(tokens.authenticate(oldToken.token).userId).toBe(f.owner.id);
  const data = {
    items: f.db.prepare('SELECT * FROM workspace_items').all(),
    grants: f.db.prepare('SELECT * FROM workspace_grants').all(),
    links: f.db.prepare('SELECT * FROM workspace_links').all(),
  };
  f.admin.disable(f.operator.id, f.owner.id);
  expect(workspace.links.access(guest.userId)).toBeUndefined();
  f.admin.reactivate(f.operator.id, f.owner.id);
  expect(f.auth.user(f.owner.id)).toMatchObject({ id: f.owner.id, name: 'Owner', disabled: 0 });
  expect(f.auth.passkeys(f.owner.id)).toEqual([]);
  expect(f.auth.session(session.token)).toBeUndefined();
  expect(
    f.db.prepare('SELECT 1 FROM auth_challenges WHERE id=?').get(ceremony.challengeId),
  ).toBeUndefined();
  expect(() => f.invites.active(inviteToken)).toThrow('unavailable');
  expect(() => tokens.authenticate(oldToken.token)).toThrow('no longer available');
  expect(tokens.authenticate(otherToken.token).userId).toBe(f.collaborator.id);
  expect(() => oauth.authenticate(oauthTokens.access_token)).toThrow('no longer available');
  await expect(
    oauth.exchangeRefreshToken(client, oauthTokens.refresh_token!, undefined, resource),
  ).rejects.toThrow();
  expect(
    f.db.prepare('SELECT * FROM oauth_pending WHERE id=?').get(pendingApproval),
  ).toBeUndefined();
  expect(f.db.prepare('SELECT * FROM oauth_codes').all()).toEqual([]);
  expect(oauth.list(f.owner.id)).toEqual([expect.objectContaining({ revoked: true })]);
  expect({
    items: f.db.prepare('SELECT * FROM workspace_items').all(),
    grants: f.db.prepare('SELECT * FROM workspace_grants').all(),
    links: f.db.prepare('SELECT * FROM workspace_links').all(),
  }).toEqual(data);
  // Same-owner reactivation restores deliberate sharing, not account sign-ins.
  expect(workspace.links.access(guest.userId)?.itemId).toBe(item.id);
  expect(workspace.links.exchange(item.id, link.token!).userId).toMatch(/^guest:/);
  expect(workspace.get(f.collaborator.id, item.id, 'edit').access).toBe('editor');
  expect(
    new URL(f.invites.create(f.operator.id, 24, f.owner.id).url).searchParams.has('token'),
  ).toBe(true);
});

test('reactivation remains atomic, rejects active/missing targets, and permits recovery of a disabled secondary admin', () => {
  const f = fixture();
  const key = f.key(f.owner.id, 'old-key');
  f.admin.disable(f.operator.id, f.owner.id);
  f.db.exec(
    "CREATE TRIGGER fail_reactivate BEFORE UPDATE OF disabled ON auth_users WHEN NEW.disabled=0 BEGIN SELECT RAISE(ABORT, 'fixture activation failure'); END",
  );
  expect(() => f.admin.reactivate(f.operator.id, f.owner.id)).toThrow('fixture activation failure');
  expect(f.auth.passkey(key)).toBeDefined();
  expect(f.auth.user(f.owner.id)).toBeUndefined();
  f.db.exec('DROP TRIGGER fail_reactivate');
  expect(() => f.admin.reactivate(f.collaborator.id, f.owner.id)).toThrow('Not found');
  expect(() => f.admin.reactivate(f.operator.id, 'missing')).toThrow('User not found');
  f.admin.reactivate(f.operator.id, f.owner.id);
  const fresh = f.key(f.owner.id, 'fresh-key');
  expect(() => f.admin.reactivate(f.operator.id, f.owner.id)).toThrow('already active');
  expect(f.auth.passkey(fresh)).toBeDefined();
  const secondary = f.auth.createUser('Second Operator', true);
  f.key(secondary.id, 'old-admin-key');
  f.admin.disable(f.operator.id, secondary.id);
  f.admin.reactivate(f.operator.id, secondary.id);
  expect(f.auth.user(secondary.id)?.is_admin).toBe(1);
  expect(f.auth.passkeys(secondary.id)).toEqual([]);
  expect(() => f.invites.create(f.operator.id, 24, secondary.id)).not.toThrow();
});
