import {
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  verify as verifySignature,
} from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthError, AuthStore, randomToken } from './store.ts';
import type { Session } from './store.ts';
import { authOrigin, saveRegistration } from './service.ts';
import { setupProofMessage } from '../../shared/setup-proof.ts';

export const SETUP_MS = 30 * 60_000;
interface Setup {
  id: string;
  public_key: Uint8Array;
  user_id: string;
  expires_at: number;
}
export class SetupService {
  store: AuthStore;
  origin: string;
  rpID: string;
  verifyRegistration: typeof verifyRegistrationResponse;
  constructor(store: AuthStore, origin: string, verifyRegistration = verifyRegistrationResponse) {
    this.store = store;
    ({ origin: this.origin, rpID: this.rpID } = authOrigin(origin));
    this.verifyRegistration = verifyRegistration;
    store.database.exec(`CREATE TABLE IF NOT EXISTS auth_setup (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL,
      public_key BLOB NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT`);
  }
  assertUnclaimed() {
    if (this.store.userCount() !== 0)
      throw new AuthError(409, 'This instance is already claimed. Setup is closed.');
  }
  issue() {
    return this.store.transaction(() => {
      this.assertUnclaimed();
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const id = randomToken();
      const expiresAt = this.store.now() + SETUP_MS;
      this.store.database
        .prepare(`INSERT OR REPLACE INTO auth_setup VALUES(1,?,?,?,?)`)
        .run(id, publicKey.export({ type: 'spki', format: 'der' }), randomUUID(), expiresAt);
      const secret = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url');
      return { url: `${this.origin}/setup#${id}.${secret}`, expiresAt };
    });
  }
  active(id: string): Setup {
    this.assertUnclaimed();
    const setup = this.store.database
      .prepare('SELECT * FROM auth_setup WHERE id=? AND expires_at>?')
      .get(id, this.store.now()) as unknown as Setup | undefined;
    if (!setup)
      throw new AuthError(
        400,
        'This setup link expired or was replaced. Run the setup command again.',
      );
    return setup;
  }
  async options(session: Session, id: string) {
    const setup = this.active(id);
    const options = await generateRegistrationOptions({
      rpName: 'Spinel',
      rpID: this.rpID,
      userName: 'Operator',
      userID: Buffer.from(setup.user_id),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    this.active(id);
    const challenge = this.store.addChallenge(session, 'setup', options.challenge);
    return { options, challengeId: challenge.id };
  }
  async claim(
    session: Session,
    id: string,
    challengeId: string,
    response: RegistrationResponseJSON,
    proof: string,
  ) {
    const challenge = this.store.takeChallenge(challengeId, session, 'setup');
    try {
      const setup = this.active(id);
      const key = createPublicKey({
        key: Buffer.from(setup.public_key),
        format: 'der',
        type: 'spki',
      });
      const message = setupProofMessage(this.origin, id, challenge.challenge, response);
      if (
        !/^[A-Za-z0-9_-]{86}$/.test(proof) ||
        !verifySignature(null, Buffer.from(message), key, Buffer.from(proof, 'base64url'))
      ) {
        throw new AuthError(403, 'Open the setup link printed on the server and try again.');
      }
      const result = await this.verifyRegistration({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
      if (!result.verified) throw new AuthError(400, 'Could not verify this passkey. Try again.');
      return this.store.transaction(() => {
        // Recheck after asynchronous verification and while holding the write lock.
        this.active(id);
        this.store.assertPending(challenge);
        this.store.database
          .prepare('INSERT INTO auth_users(id,name,is_admin) VALUES(?,?,1)')
          .run(setup.user_id, 'Operator');
        saveRegistration(this.store, setup.user_id, result.registrationInfo);
        this.store.database.exec('DELETE FROM auth_setup');
        const next = this.store.createSession(setup.user_id);
        this.store.revokeSession(session.token_hash);
        return next;
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(400, 'Could not finish setup. Try again with the console link.');
    } finally {
      this.store.finish(challengeId);
    }
  }
}
