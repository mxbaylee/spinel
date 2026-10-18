import { DatabaseSync } from '../../../server/database.ts';
import { afterEach, expect, test } from 'vitest';
import { AuthStore } from './store.ts';
import { AdminStore } from './admin.ts';
import { InvitationService } from './invitations.ts';
import { WorkspaceStore } from '../workspace/store.ts';
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
