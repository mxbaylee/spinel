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
      this.auth.database.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);
      this.invites.revokeForUser(id);
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
      // Bound sessions cascade with the credential. Legacy sessions cannot be attributed safely.
      this.auth.database
        .prepare('DELETE FROM auth_sessions WHERE user_id=? AND passkey_id IS NULL')
        .run(user);
      this.auth.database
        .prepare('DELETE FROM auth_passkeys WHERE id=? AND user_id=?')
        .run(id, user);
    });
  }
}
