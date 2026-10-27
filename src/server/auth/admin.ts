import { AuthError } from './store.ts';
import type { AuthStore, User } from './store.ts';
import type { InvitationService } from './invitations.ts';

export class AdminStore {
  private readonly auth: AuthStore;
  private readonly invites: InvitationService;
  constructor(auth: AuthStore, invites: InvitationService) {
    this.auth = auth;
    this.invites = invites;
  }

  private requireAdmin(actor: string) {
    if (!this.auth.user(actor)?.is_admin) throw new AuthError(404, 'Not found.');
  }

  list(actor: string) {
    this.requireAdmin(actor);
    const users = this.auth.database
      .prepare('SELECT id,name,is_admin,disabled FROM auth_users ORDER BY name,id')
      .all() as unknown as User[];
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      isAdmin: Boolean(user.is_admin),
      disabled: Boolean(user.disabled),
      passkeys: this.auth.passkeys(user.id).map((key) => ({
        id: key.id,
        name: key.name,
        provider: key.provider,
        createdAt: key.created_at,
        lastUsedAt: key.last_used_at,
      })),
    }));
  }

  disable(actor: string, id: string) {
    this.auth.transaction(() => {
      this.requireAdmin(actor);
      if (id === actor) throw new AuthError(409, 'You cannot disable your own admin account.');
      const result = this.auth.database
        .prepare('UPDATE auth_users SET disabled=1 WHERE id=?')
        .run(id);
      if (!result.changes) throw new AuthError(404, 'User not found.');
      // Keep the source-session association until its pending approvals have
      // been removed. Other accounts' approvals remain unchanged.
      if (
        this.auth.database
          .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='oauth_pending'")
          .get()
      )
        this.auth.database
          .prepare(
            `DELETE FROM oauth_pending WHERE session_hash IN
          (SELECT token_hash FROM auth_sessions WHERE user_id=?)`,
          )
          .run(id);
      this.auth.database.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);
      this.invites.revokeForUser(id);
    });
  }

  reactivate(actor: string, id: string) {
    this.auth.transaction(() => {
      this.requireAdmin(actor);
      const target = this.auth.database
        .prepare('SELECT disabled FROM auth_users WHERE id=?')
        .get(id);
      if (!target) throw new AuthError(404, 'User not found.');
      if (!target.disabled) throw new AuthError(409, 'This account is already active.');
      const db = this.auth.database;
      const exists = (table: string) =>
        Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));
      // Disable blocks credentials by account state; activation must not turn
      // that old authority back on. Keep connection/token metadata as revoked.
      if (exists('oauth_connections')) {
        if (exists('oauth_codes'))
          db.prepare(
            `DELETE FROM oauth_codes WHERE connection_id IN
            (SELECT id FROM oauth_connections WHERE user_id=?)`,
          ).run(id);
        if (exists('oauth_access'))
          db.prepare(
            `UPDATE oauth_access SET revoked=1 WHERE connection_id IN
            (SELECT id FROM oauth_connections WHERE user_id=?)`,
          ).run(id);
        if (exists('oauth_refresh'))
          db.prepare(
            `DELETE FROM oauth_refresh WHERE connection_id IN
            (SELECT id FROM oauth_connections WHERE user_id=?)`,
          ).run(id);
        db.prepare('UPDATE oauth_connections SET revoked=1 WHERE user_id=?').run(id);
      }
      if (exists('oauth_pending'))
        db.prepare(
          `DELETE FROM oauth_pending WHERE session_hash IN
          (SELECT token_hash FROM auth_sessions WHERE user_id=?)`,
        ).run(id);
      if (exists('auth_access_tokens'))
        db.prepare('UPDATE auth_access_tokens SET revoked=1 WHERE user_id=?').run(id);
      db.prepare(
        `DELETE FROM auth_challenges WHERE id IN (
        SELECT c.challenge_id FROM auth_invite_ceremonies c JOIN auth_invites i ON i.id=c.invite_id
        WHERE (i.recovery_user_id=? OR i.created_by=?) AND i.used_at IS NULL
      )`,
      ).run(id, id);
      this.invites.revokeForUser(id);
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM auth_passkeys WHERE user_id=?').run(id);
      db.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(id);
    });
  }

  removePasskey(actor: string, user: string, id: string) {
    this.auth.transaction(() => {
      this.requireAdmin(actor);
      const key = this.auth.passkey(id);
      if (!key || key.user_id !== user) throw new AuthError(404, 'Passkey not found.');
      const target = this.auth.user(user);
      if (target?.is_admin && this.auth.passkeys(user).length <= 1)
        throw new AuthError(
          409,
          'Add another passkey before removing an active admin’s last passkey.',
        );
      this.auth.removePasskey(user, id);
    });
  }
}
