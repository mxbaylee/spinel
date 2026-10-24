import { createPublicKey, generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthError, AuthStore, randomToken } from './store.ts';
import type { Session, User } from './store.ts';
import { authOrigin, saveRegistration } from './service.ts';
import { SETUP_MS } from './setup.ts';
import { setupProofMessage } from '../../shared/setup-proof.ts';

interface Recovery {
  id: string;
  public_key: Uint8Array;
  user_id: string;
  expires_at: number;
}

export class ConsoleRecovery {
  store: AuthStore;
  origin: string;
  rpID: string;
  verifyRegistration: typeof verifyRegistrationResponse;

  constructor(store: AuthStore, origin: string, verifyRegistration = verifyRegistrationResponse) {
    this.store = store;
    ({ origin: this.origin, rpID: this.rpID } = authOrigin(origin));
    this.verifyRegistration = verifyRegistration;
    store.database.exec(`CREATE TABLE IF NOT EXISTS auth_admin_recovery (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL UNIQUE,
      public_key BLOB NOT NULL, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS auth_admin_recovery_ceremonies (
      challenge_id TEXT PRIMARY KEY REFERENCES auth_challenges(id) ON DELETE CASCADE,
      recovery_id TEXT NOT NULL REFERENCES auth_admin_recovery(id) ON DELETE CASCADE
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS invalidate_admin_recovery
    AFTER UPDATE OF disabled,is_admin ON auth_users
    WHEN NEW.disabled=1 OR NEW.is_admin=0
    BEGIN DELETE FROM auth_admin_recovery WHERE user_id=NEW.id; END;`);
  }

  issue(selection?: { id: string } | { name: string }) {
    return this.store.transaction(() => {
      const admins = this.store.database
        .prepare('SELECT * FROM auth_users WHERE is_admin=1 AND disabled=0 ORDER BY name,id')
        .all() as unknown as User[];
      const candidates = selection
        ? admins.filter((user) =>
            'id' in selection ? user.id === selection.id : user.name === selection.name,
          )
        : admins;
      if (candidates.length !== 1)
        throw new AuthError(
          400,
          `Choose one active admin with --id or an unambiguous --name. Active admins: ${JSON.stringify(admins.map(({ id, name }) => ({ id, name })))}`,
        );
      const user = candidates[0];
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const id = randomToken();
      const expiresAt = this.store.now() + SETUP_MS;
      this.store.database
        .prepare('INSERT OR REPLACE INTO auth_admin_recovery VALUES(1,?,?,?,?)')
        .run(id, publicKey.export({ type: 'spki', format: 'der' }), user.id, expiresAt);
      const secret = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url');
      return { url: `${this.origin}/recover-admin#${id}.${secret}`, expiresAt, user };
    });
  }

  active(id: string) {
    const recovery = this.store.database
      .prepare('SELECT * FROM auth_admin_recovery WHERE id=? AND expires_at>?')
      .get(id, this.store.now()) as unknown as Recovery | undefined;
    const user = recovery && this.store.user(recovery.user_id);
    if (!recovery || !user?.is_admin)
      throw new AuthError(
        400,
        'This recovery link is unavailable or expired. Run the console recovery command again.',
      );
    return { recovery, user };
  }

  async options(session: Session, id: string) {
    const { user } = this.active(id);
    const options = await generateRegistrationOptions({
      rpName: 'Spinel',
      rpID: this.rpID,
      userName: user.name,
      userID: Buffer.from(user.id),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: this.store
        .passkeys(user.id)
        .map((key) => ({ id: key.id, transports: this.store.transports(key) })),
    });
    this.active(id);
    const challenge = this.store.addChallenge(session, 'admin-recovery', options.challenge);
    this.store.database
      .prepare('INSERT INTO auth_admin_recovery_ceremonies VALUES(?,?)')
      .run(challenge.id, id);
    return { options, challengeId: challenge.id };
  }

  async claim(
    session: Session,
    id: string,
    challengeId: string,
    response: RegistrationResponseJSON,
    proof: string,
  ) {
    const challenge = this.store.takeChallenge(challengeId, session, 'admin-recovery');
    try {
      const { recovery, user } = this.active(id);
      if (
        !this.store.database
          .prepare(
            'SELECT 1 FROM auth_admin_recovery_ceremonies WHERE challenge_id=? AND recovery_id=?',
          )
          .get(challengeId, id)
      )
        throw new AuthError(
          400,
          'This request belongs to another recovery link. Open the console link again.',
        );
      const key = createPublicKey({
        key: Buffer.from(recovery.public_key),
        format: 'der',
        type: 'spki',
      });
      const message = setupProofMessage(this.origin, id, challenge.challenge, response, true);
      if (
        !/^[A-Za-z0-9_-]{86}$/.test(proof) ||
        !verifySignature(null, Buffer.from(message), key, Buffer.from(proof, 'base64url'))
      )
        throw new AuthError(403, 'Open the recovery link printed on the server and try again.');
      const result = await this.verifyRegistration({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
      if (!result.verified) throw new AuthError(400, 'Could not verify this passkey. Try again.');
      const next = this.store.transaction(() => {
        this.active(id);
        // Check before revocation: this browser may still have a target-admin session.
        this.store.assertPending(challenge);
        // Reject reused credential IDs before deleting the old keys, including this account's.
        if (result.registrationInfo && this.store.passkey(result.registrationInfo.credential.id))
          throw new AuthError(400, 'This passkey is already registered. Create a new passkey.');
        this.store.database.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(user.id);
        this.store.database.prepare('DELETE FROM auth_passkeys WHERE user_id=?').run(user.id);
        saveRegistration(this.store, user.id, result.registrationInfo);
        // Older recovery invitations must not restore authority after console recovery.
        if (
          this.store.database
            .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='auth_invites'")
            .get()
        )
          this.store.database
            .prepare(
              'UPDATE auth_invites SET revoked_at=? WHERE recovery_user_id=? AND used_at IS NULL AND revoked_at IS NULL',
            )
            .run(this.store.now(), user.id);
        this.store.database.exec('DELETE FROM auth_admin_recovery');
        const created = this.store.createSession(
          user.id,
          undefined,
          result.registrationInfo!.credential.id,
        );
        this.store.revokeSession(session.token_hash);
        return created;
      });
      console.info(
        JSON.stringify({
          event: 'admin.recovered',
          userID: user.id,
          at: new Date(this.store.now()).toISOString(),
        }),
      );
      return next;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(400, 'Could not recover this admin. Try again with the console link.');
    } finally {
      this.store.finish(challengeId);
    }
  }
}
