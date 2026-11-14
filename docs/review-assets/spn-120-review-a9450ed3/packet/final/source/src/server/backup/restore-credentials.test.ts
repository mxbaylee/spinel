import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { backup, DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { Profiles } from '../auth/profile.ts';
import { AccessTokens } from '../auth/tokens.ts';
import { InvitationService } from '../auth/invitations.ts';
import { SetupService } from '../auth/setup.ts';
import { ConsoleRecovery } from '../auth/console-recovery.ts';
import { AssistantOAuth } from '../auth/oauth.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { writeInventory } from './inventory.ts';
import {
  reconcileRestoreCredentials,
  requireCompatibleRestoreSchema,
} from './restore-credentials.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const origin = 'https://spinel.example';
function key(db: DatabaseSync, id: string, user: string, counter: number) {
  db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    id,
    user,
    Buffer.from([1, 2, 3, 4]),
    counter,
    '[]',
    'Fixture credential',
    'fixture',
    1000,
    null,
    0,
    'singleDevice',
  );
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-authority-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const current = openDatabase(join(directory, 'current.sqlite'));
  cleanup.push(() => current.close());
  const auth = new AuthStore(current);
  const owner = auth.createUser('Owner'),
    admin = auth.createUser('Operator', true),
    removed = auth.createUser('Removed account');
  const profiles = new Profiles(auth);
  const tokens = new AccessTokens(auth);
  const invites = new InvitationService(auth, origin);
  new SetupService(auth, origin);
  const recovery = new ConsoleRecovery(auth, origin);
  new AssistantOAuth(auth, origin);
  const workspace = new WorkspaceStore(auth);
  const item = workspace.create(owner.id, {
    kind: 'doc',
    name: 'Keep this document',
    parentId: null,
  });
  const removedItem = workspace.create(removed.id, {
    kind: 'doc',
    name: 'Keep removed-account data',
    parentId: null,
  });
  key(current, 'kept', owner.id, 7);
  key(current, 'revoked', owner.id, 1);
  key(current, 'removed-account-key', removed.id, 1);
  profiles.save(owner.id, profiles.get(owner.id));
  const session = auth.createSession(owner.id).session;
  const challenge = auth.addChallenge(session, 'invite', 'challenge');
  invites.create(admin.id);
  // Use persisted IDs rather than assuming an API token's serialization shape.
  const inviteId = current.prepare('SELECT id FROM auth_invites').get()!.id;
  current
    .prepare('INSERT INTO auth_invite_ceremonies VALUES(?,?,?)')
    .run(challenge.id, inviteId, 'Invitee');
  tokens.create(owner.id, 'Old token');
  recovery.issue({ id: admin.id });
  const adminRecovery = current.prepare('SELECT id FROM auth_admin_recovery').get()!.id;
  current
    .prepare('INSERT INTO auth_admin_recovery_ceremonies VALUES(?,?)')
    .run(challenge.id, adminRecovery);
  current.exec("INSERT INTO auth_setup VALUES(1,'old-setup',x'01','old-user',9999999999999)");
  current.prepare(`INSERT INTO oauth_clients VALUES('client','{}',1000)`).run();
  current
    .prepare(
      `INSERT INTO oauth_pending VALUES('pending','client','https://client.example/callback','challenge','read',NULL,9999999999999,NULL,0)`,
    )
    .run();
  current
    .prepare(
      `INSERT INTO oauth_connections VALUES('connection',?,'client','Old connection','https://client.example','read',?,1000,NULL,0)`,
    )
    .run(owner.id, origin + '/mcp');
  current.exec(`INSERT INTO oauth_codes VALUES('code','connection','https://client.example/callback','challenge','session',9999999999999);
    INSERT INTO oauth_access VALUES('access','access-hash','connection','read',9999999999999,0);
    INSERT INTO oauth_refresh VALUES('refresh','connection','read',9999999999999,0)`);
  current
    .prepare(
      `INSERT INTO workspace_links(item_id,epoch,state,role,token_hash,preview_hash) VALUES(?,9,'active','viewer',?,?)`,
    )
    .run(item.id, 'a'.repeat(64), 'b'.repeat(64));
  current
    .prepare('INSERT INTO workspace_guest_sessions VALUES(?,?,?,?,?)')
    .run(randomUUID(), 'guest-hash', item.id, 9, Date.now() + 60_000);
  const path = join(directory, 'candidate.sqlite');
  await backup(current, path);
  const candidate = new DatabaseSync(path);
  cleanup.push(() => candidate.close());
  return { current, candidate, auth, owner, admin, removed, item, removedItem, profiles };
}

test('copies current credentials and roles, keeps removed identities disabled and preserves FK-bound document rows', async () => {
  const f = await fixture();
  f.auth.removePasskey(f.owner.id, 'revoked');
  f.current.prepare('UPDATE auth_passkeys SET counter=99 WHERE id=?').run('kept');
  f.current.prepare('DELETE FROM auth_users WHERE id=?').run(f.removed.id);
  f.profiles.save(f.owner.id, {
    ...f.profiles.get(f.owner.id),
    name: 'Current display name',
    icon: 'lucide:accessibility',
  });
  f.current.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  f.current.prepare('UPDATE auth_users SET disabled=1,is_admin=0 WHERE id=?').run(f.admin.id);
  const replacement = f.auth.createUser('Current Operator', true);
  key(f.current, 'current-admin-key', replacement.id, 23);
  const expectedKeys = f.current.prepare('SELECT * FROM auth_passkeys ORDER BY id').all();
  const currentBefore = f.current.prepare('SELECT * FROM auth_users ORDER BY id').all();
  const docsBefore = f.candidate.prepare('SELECT * FROM workspace_items ORDER BY id').all();
  reconcileRestoreCredentials(f.current, f.candidate);
  expect(f.candidate.prepare('SELECT * FROM auth_passkeys ORDER BY id').all()).toEqual(
    expectedKeys,
  );
  expect(f.candidate.prepare('SELECT * FROM auth_users WHERE id=?').get(replacement.id)).toEqual(
    f.auth.user(replacement.id),
  );
  expect(
    f.candidate.prepare('SELECT is_admin,disabled FROM auth_users WHERE id=?').get(f.removed.id),
  ).toEqual({ is_admin: 0, disabled: 1 });
  expect(f.candidate.prepare('SELECT disabled FROM auth_users WHERE id=?').get(f.admin.id)).toEqual(
    { disabled: 1 },
  );
  expect(f.candidate.prepare('SELECT * FROM workspace_items ORDER BY id').all()).toEqual(
    docsBefore,
  );
  expect(f.current.prepare('SELECT * FROM auth_users ORDER BY id').all()).toEqual(currentBefore);
  expect(
    f.candidate.prepare('SELECT name,disabled FROM auth_users WHERE id=?').get(f.owner.id),
  ).toEqual({ name: 'Current display name', disabled: 1 });
  expect(
    f.candidate.prepare('SELECT is_admin FROM auth_users WHERE id=?').get(f.admin.id)!.is_admin,
  ).toBe(0);
  expect(f.candidate.prepare('SELECT * FROM auth_profiles ORDER BY user_id').all()).toEqual(
    f.current.prepare('SELECT * FROM auth_profiles ORDER BY user_id').all(),
  );
  expect(f.current.prepare('SELECT * FROM auth_passkeys ORDER BY id').all()).toEqual(expectedKeys);
});

test('expires populated session, invite, recovery, integration and guest capability families', async () => {
  const f = await fixture();
  const credentialTables = [
    'auth_sessions',
    'auth_challenges',
    'auth_invites',
    'auth_invite_ceremonies',
    'auth_setup',
    'auth_admin_recovery',
    'auth_admin_recovery_ceremonies',
    'auth_access_tokens',
    'oauth_clients',
    'oauth_pending',
    'oauth_connections',
    'oauth_codes',
    'oauth_access',
    'oauth_refresh',
    'workspace_guest_sessions',
  ];
  for (const table of credentialTables)
    expect(f.candidate.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBeGreaterThan(0);
  f.candidate.prepare('UPDATE workspace_links SET enabled_at=1000,expires_at=2000').run();
  f.current
    .prepare("UPDATE workspace_links SET epoch=20,state='off',token_hash=NULL,preview_hash=NULL")
    .run();
  reconcileRestoreCredentials(f.current, f.candidate);
  for (const table of credentialTables)
    expect(f.candidate.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(0);
  expect(
    f.candidate.prepare('SELECT epoch,state,token_hash,preview_hash FROM workspace_links').get(),
  ).toEqual({ epoch: 21, state: 'off', token_hash: null, preview_hash: null });
  expect(f.candidate.prepare('SELECT enabled_at,expires_at FROM workspace_links').get()).toEqual({
    enabled_at: null,
    expires_at: null,
  });
  expect(f.current.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n).toBeGreaterThan(0);
});

test('rolls every credential change back if reconciliation fails late', async () => {
  const f = await fixture();
  f.current.prepare('UPDATE auth_passkeys SET counter=99').run();
  f.current.prepare('UPDATE workspace_links SET epoch=?').run(Number.MAX_SAFE_INTEGER);
  const before = f.candidate.prepare('SELECT * FROM auth_passkeys ORDER BY id').all();
  expect(() => reconcileRestoreCredentials(f.current, f.candidate)).toThrow('reconciliation');
  expect(f.candidate.prepare('SELECT * FROM auth_passkeys ORDER BY id').all()).toEqual(before);
  expect(f.candidate.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n).toBeGreaterThan(
    0,
  );
  expect(f.candidate.prepare('SELECT state FROM workspace_links').get()!.state).toBe('active');
});

test('allows only canonical archive metadata and rejects extra executable schema before copying current keys', async () => {
  const f = await fixture();
  f.candidate.exec(
    'CREATE TABLE spinel_recovery (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL) STRICT',
  );
  f.candidate.prepare('INSERT INTO spinel_recovery VALUES(1,?)').run('{}');
  writeInventory(f.candidate);
  expect(() => requireCompatibleRestoreSchema(f.current, f.candidate)).not.toThrow();
  f.candidate.exec(
    `CREATE TRIGGER forged_recovery_authority AFTER UPDATE ON spinel_recovery BEGIN UPDATE auth_users SET is_admin=1; END`,
  );
  const before = f.candidate.prepare('SELECT * FROM auth_users ORDER BY id').all();
  expect(() => reconcileRestoreCredentials(f.current, f.candidate)).toThrow('compatible authority');
  expect(f.candidate.prepare('SELECT * FROM auth_users ORDER BY id').all()).toEqual(before);
});

test.each(['auth_future_credentials', 'AUTH_future_credentials', 'OAuth_future_credentials'])(
  'a future authority table %s requires an explicit policy even if both schemas match',
  async (table) => {
    const f = await fixture();
    for (const db of [f.current, f.candidate]) db.exec(`CREATE TABLE ${table} (secret TEXT)`);
    expect(() => reconcileRestoreCredentials(f.current, f.candidate)).toThrow(
      'compatible authority',
    );
  },
);

test('refuses two connections to the same source before any credential is cleared', async () => {
  const f = await fixture();
  const alias = new DatabaseSync(f.current.path);
  cleanup.push(() => alias.close());
  expect(() => reconcileRestoreCredentials(f.current, alias)).toThrow('compatible authority');
  expect(f.current.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n).toBeGreaterThan(0);
  expect(
    f.current.prepare('SELECT count(*) AS n FROM auth_access_tokens').get()!.n,
  ).toBeGreaterThan(0);
});

test.each(['row', 'aggregate'] as const)(
  'refuses oversized authority %s bytes before materializing the keys',
  async (kind) => {
    const f = await fixture();
    if (kind === 'row')
      f.current
        .prepare('UPDATE auth_passkeys SET public_key=zeroblob(?) WHERE id=?')
        .run(8 * 1024 ** 2 + 1, 'kept');
    else f.current.prepare('UPDATE auth_passkeys SET public_key=zeroblob(?)').run(3 * 1024 ** 2);
    const iterator = vi.spyOn(f.current, 'iterate');
    try {
      expect(() => reconcileRestoreCredentials(f.current, f.candidate)).toThrow('reconciliation');
      expect(iterator.mock.calls.some(([sql]) => sql.includes('auth_passkeys'))).toBe(false);
      expect(
        f.candidate.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n,
      ).toBeGreaterThan(0);
      expect(
        f.candidate
          .prepare('SELECT length(public_key) AS n FROM auth_passkeys WHERE id=?')
          .get('kept')!.n,
      ).toBe(4);
    } finally {
      iterator.mockRestore();
    }
  },
);

test('clears large inactive guest secrets without selecting those bytes into Node', async () => {
  const f = await fixture();
  f.candidate
    .prepare(
      `UPDATE workspace_links SET state='off',token_hash=hex(zeroblob(?)),preview_hash=hex(zeroblob(?)),enabled_at=1000,expires_at=9999999999999`,
    )
    .run(3 * 1024 ** 2, 3 * 1024 ** 2);
  const iterator = vi.spyOn(f.candidate, 'iterate');
  try {
    reconcileRestoreCredentials(f.current, f.candidate);
    const linkReads = iterator.mock.calls.filter(([sql]) => sql.includes('workspace_links'));
    expect(linkReads).toHaveLength(1);
    expect(linkReads[0][0]).toContain('SELECT "item_id","epoch"');
    expect(
      f.candidate
        .prepare('SELECT token_hash,preview_hash,enabled_at,expires_at FROM workspace_links')
        .get(),
    ).toEqual({ token_hash: null, preview_hash: null, enabled_at: null, expires_at: null });
  } finally {
    iterator.mockRestore();
  }
});
