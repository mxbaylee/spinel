import { isIP } from 'node:net';
import * as webauthn from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { AuthError, AuthStore } from './store.ts';
import type { Session } from './store.ts';
import { availablePasskeyName, passkeyProviderName } from './passkey-names.ts';

export function authOrigin(value: string) {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    isIP(url.hostname) ||
    url.hostname.startsWith('[') ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))
  ) {
    throw new Error(
      'APP_ORIGIN must be an HTTPS hostname, or http://localhost:PORT for local development.',
    );
  }
  return { origin: url.origin, rpID: url.hostname };
}

type Verifiers = Pick<
  typeof webauthn,
  'verifyRegistrationResponse' | 'verifyAuthenticationResponse'
>;
export class AuthService {
  store: AuthStore;
  origin: string;
  rpID: string;
  verify: Verifiers;
  constructor(store: AuthStore, origin: string, verify: Verifiers = webauthn) {
    this.store = store;
    ({ origin: this.origin, rpID: this.rpID } = authOrigin(origin));
    this.verify = verify;
  }
  async authenticationOptions(session: Session) {
    const options = await webauthn.generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
    });
    const challenge = this.store.addChallenge(session, 'authentication', options.challenge);
    return { options, challengeId: challenge.id };
  }
  async registrationOptions(session: Session) {
    const user = session.user_id && this.store.user(session.user_id);
    if (!user) throw new AuthError(401, 'Sign in before adding a passkey.');
    const options = await webauthn.generateRegistrationOptions({
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
    const challenge = this.store.addChallenge(session, 'registration', options.challenge);
    return { options, challengeId: challenge.id };
  }
  async register(session: Session, id: string, response: RegistrationResponseJSON) {
    const challenge = this.store.takeChallenge(id, session, 'registration');
    try {
      if (!session.user_id || !this.store.user(session.user_id))
        throw new AuthError(401, 'Sign in before adding a passkey.');
      const result = await this.verify.verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
      if (!result.verified) throw new AuthError(400, 'Could not verify this passkey. Try again.');
      this.store.assertPending(challenge);
      return saveRegistration(this.store, session.user_id, result.registrationInfo);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(400, 'Could not verify this passkey. Try again.');
    } finally {
      this.store.finish(id);
    }
  }
  async authenticate(session: Session, id: string, response: AuthenticationResponseJSON) {
    const challenge = this.store.takeChallenge(id, session, 'authentication');
    try {
      const key = this.store.passkey(response.id);
      const user = key && this.store.user(key.user_id);
      if (
        !key ||
        !user ||
        response.response.userHandle !== Buffer.from(user.id).toString('base64url')
      ) {
        throw new AuthError(
          400,
          'This passkey is not available. Try another passkey or contact the operator.',
        );
      }
      const result = await this.verify.verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: key.id,
          publicKey: new Uint8Array(key.public_key),
          counter: key.counter,
          transports: this.store.transports(key),
        },
      });
      if (!result.verified) throw new AuthError(400, 'Could not verify this passkey. Try again.');
      this.store.assertPending(challenge);
      if (!this.store.user(user.id))
        throw new AuthError(401, 'This account is no longer available.');
      const update = this.store.database
        .prepare(
          `UPDATE auth_passkeys SET counter=?,last_used_at=?,backed_up=?
        WHERE id=? AND user_id=? AND counter=?`,
        )
        .run(
          result.authenticationInfo.newCounter,
          this.store.now(),
          Number(result.authenticationInfo.credentialBackedUp),
          key.id,
          user.id,
          key.counter,
        );
      if (update.changes !== 1)
        throw new AuthError(409, 'This passkey changed or was removed. Try again.');
      const next = this.store.createSession(user.id, undefined, key.id);
      this.store.revokeSession(session.token_hash);
      return { ...next, user };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(400, 'Could not verify this passkey. Try again.');
    } finally {
      this.store.finish(id);
    }
  }
}

export function saveRegistration(
  store: AuthStore,
  userId: string,
  info: NonNullable<VerifiedRegistrationResponse['registrationInfo']>,
) {
  const { credential, aaguid, credentialBackedUp, credentialDeviceType } = info;
  if (store.passkey(credential.id)) throw new AuthError(409, 'This passkey is already registered.');
  const provider = passkeyProviderName(aaguid);
  const name = availablePasskeyName(
    provider,
    store.passkeys(userId).map((key) => key.name),
  );
  store.database
    .prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      credential.id,
      userId,
      credential.publicKey,
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      name,
      provider,
      store.now(),
      null,
      Number(credentialBackedUp),
      credentialDeviceType,
    );
  return { name, provider };
}
