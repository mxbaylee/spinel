import { randomUUID } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthError, AuthStore, hashToken, randomToken } from './store.ts';
import type { Session } from './store.ts';
import { authOrigin, saveRegistration } from './service.ts';

interface Invite {
  id: string;
  token_hash: string;
  created_by: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  used_at: number | null;
  used_by: string | null;
  recovery_user_id: string | null;
  for_user_id: string;
}
export class InvitationService {
  store: AuthStore;
  origin: string;
  rpID: string;
  verifyRegistration: typeof verifyRegistrationResponse;
  constructor(store: AuthStore, origin: string, verifyRegistration = verifyRegistrationResponse) {
    this.store = store;
    ({ origin: this.origin, rpID: this.rpID } = authOrigin(origin));
    this.verifyRegistration = verifyRegistration;
    store.database.exec(`CREATE TABLE IF NOT EXISTS auth_invites (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER,
      used_at INTEGER, used_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
      recovery_user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE, for_user_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS auth_invite_ceremonies (
      challenge_id TEXT PRIMARY KEY REFERENCES auth_challenges(id) ON DELETE CASCADE,
      invite_id TEXT NOT NULL REFERENCES auth_invites(id) ON DELETE CASCADE, name TEXT NOT NULL
    ) STRICT;`);
  }
  create(adminId: string, hours = 168, recoveryUserId?: string) {
    if (!this.store.user(adminId)?.is_admin)
      throw new AuthError(403, 'Only an admin can manage invites.');
    if (![1, 24, 168, 720].includes(hours))
      throw new AuthError(400, 'Choose one of the available expiry times.');
    const recovery = recoveryUserId ? this.store.user(recoveryUserId) : undefined;
    if (recoveryUserId && !recovery)
      throw new AuthError(400, 'Choose an active account to recover.');
    const token = randomToken();
    const id = randomUUID();
    const now = this.store.now();
    this.store.database
      .prepare('INSERT INTO auth_invites VALUES(?,?,?,?,?,NULL,NULL,NULL,?,?)')
      .run(
        id,
        hashToken(token),
        adminId,
        now,
        now + hours * 60 * 60_000,
        recovery?.id ?? null,
        recovery?.id ?? randomUUID(),
      );
    return {
      id,
      url: `${this.origin}/invite?token=${token}`,
      expiresAt: now + hours * 60 * 60_000,
    };
  }
  active(token: string): Invite {
    const row =
      typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
        ? (this.store.database
            .prepare('SELECT * FROM auth_invites WHERE token_hash=?')
            .get(hashToken(token)) as unknown as Invite | undefined)
        : undefined;
    if (
      !row ||
      row.used_at !== null ||
      row.revoked_at !== null ||
      row.expires_at <= this.store.now() ||
      (row.recovery_user_id && !this.store.user(row.recovery_user_id))
    ) {
      throw new AuthError(
        400,
        'This invite is unavailable or expired. Ask the operator for a new link.',
      );
    }
    return row;
  }
  details(token: string) {
    const invite = this.active(token);
    return {
      recovery: Boolean(invite.recovery_user_id),
      name: invite.recovery_user_id ? this.store.user(invite.recovery_user_id)!.name : '',
      expiresAt: invite.expires_at,
    };
  }
  list() {
    const rows = this.store.database
      .prepare(
        `SELECT i.*, u.name AS used_by_name, r.name AS recovery_name FROM auth_invites i
      LEFT JOIN auth_users u ON u.id=i.used_by LEFT JOIN auth_users r ON r.id=i.recovery_user_id ORDER BY i.created_at DESC,i.id`,
      )
      .all() as unknown as (Invite & {
      used_by_name: string | null;
      recovery_name: string | null;
    })[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      recoveryName: row.recovery_name,
      usedBy: row.used_by_name,
      status:
        row.used_at !== null
          ? 'Used'
          : row.revoked_at !== null
            ? 'Revoked'
            : row.expires_at <= this.store.now()
              ? 'Expired'
              : 'Available',
    }));
  }
  revoke(id: string) {
    const result = this.store.database
      .prepare(
        'UPDATE auth_invites SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL',
      )
      .run(this.store.now(), id);
    if (result.changes !== 1)
      throw new AuthError(
        409,
        'This invite was already used, revoked or removed. Refresh the list.',
      );
  }
  revokeForUser(id: string) {
    this.store.database
      .prepare(
        `UPDATE auth_invites SET revoked_at=?
      WHERE (recovery_user_id=? OR created_by=?) AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .run(this.store.now(), id, id);
  }
  async options(session: Session, token: string, suppliedName: unknown) {
    const invite = this.active(token);
    const user = invite.recovery_user_id ? this.store.user(invite.recovery_user_id) : undefined;
    const name = user?.name ?? (typeof suppliedName === 'string' ? suppliedName.trim() : '');
    if (!name || name.length > 80)
      throw new AuthError(400, 'Enter a name between 1 and 80 characters.');
    const options = await generateRegistrationOptions({
      rpName: 'Spinel',
      rpID: this.rpID,
      userName: name,
      userID: Buffer.from(invite.for_user_id),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: user
        ? this.store
            .passkeys(user.id)
            .map((key) => ({ id: key.id, transports: this.store.transports(key) }))
        : [],
    });
    this.active(token);
    const challenge = this.store.addChallenge(session, 'invite', options.challenge);
    this.store.database
      .prepare('INSERT INTO auth_invite_ceremonies VALUES(?,?,?)')
      .run(challenge.id, invite.id, name);
    return { options, challengeId: challenge.id };
  }
  async accept(
    session: Session,
    token: string,
    challengeId: string,
    response: RegistrationResponseJSON,
  ) {
    const challenge = this.store.takeChallenge(challengeId, session, 'invite');
    try {
      const invite = this.active(token);
      const ceremony = this.store.database
        .prepare('SELECT name FROM auth_invite_ceremonies WHERE challenge_id=? AND invite_id=?')
        .get(challengeId, invite.id);
      if (!ceremony)
        throw new AuthError(400, 'This request belongs to another invite. Open your link again.');
      const result = await this.verifyRegistration({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
      if (!result.verified) throw new AuthError(400, 'Could not verify this passkey. Try again.');
      return this.store.transaction(() => {
        this.active(token);
        this.store.assertPending(challenge);
        if (invite.recovery_user_id) {
          this.store.database
            .prepare('DELETE FROM auth_passkeys WHERE user_id=?')
            .run(invite.for_user_id);
          this.store.database
            .prepare('DELETE FROM auth_sessions WHERE user_id=?')
            .run(invite.for_user_id);
          this.store.database
            .prepare(
              'UPDATE auth_invites SET revoked_at=? WHERE recovery_user_id=? AND id<>? AND used_at IS NULL AND revoked_at IS NULL',
            )
            .run(this.store.now(), invite.for_user_id, invite.id);
        } else {
          this.store.database
            .prepare('INSERT INTO auth_users(id,name) VALUES(?,?)')
            .run(invite.for_user_id, String(ceremony.name));
        }
        saveRegistration(this.store, invite.for_user_id, result.registrationInfo);
        this.store.database
          .prepare('UPDATE auth_invites SET used_at=?,used_by=? WHERE id=?')
          .run(this.store.now(), invite.for_user_id, invite.id);
        const next = this.store.createSession(
          invite.for_user_id,
          undefined,
          result.registrationInfo!.credential.id,
        );
        this.store.revokeSession(session.token_hash);
        return { ...next, user: this.store.user(invite.for_user_id)! };
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(400, 'Could not accept this invite. Try again or contact the operator.');
    } finally {
      this.store.finish(challengeId);
    }
  }
}
