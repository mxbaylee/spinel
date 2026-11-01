import type { DatabaseSync } from '../../../server/database.ts';
import { VERIFICATION_MS } from '../auth/store.ts';
import type { MaintenanceAuthority, RestoreAuthority } from '../../shared/maintenance.ts';
export type { RestoreAuthority } from '../../shared/maintenance.ts';

export const RESTORE_OPERATION_MS = 30 * 60_000;
const legacyKeys = ['actorId', 'sessionHash', 'expiresAt', 'verifiedPasskeyId', 'verifiedAt'];
const keys = [...legacyKeys, 'verifiedUntil', 'authorizedAt'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const refused = () => new Error('The original restore authorization is no longer valid.');

export function validRestoreAuthority(value: unknown): value is RestoreAuthority {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  const legacy = Object.keys(proof).length === legacyKeys.length;
  const shape = legacy ? legacyKeys : keys;
  const authorizedAt = legacy ? proof.verifiedAt : proof.authorizedAt;
  const verifiedUntil = legacy ? proof.expiresAt : proof.verifiedUntil;
  return (
    Object.keys(proof).length === shape.length &&
    shape.every((key) => Object.hasOwn(proof, key)) &&
    typeof proof.actorId === 'string' &&
    uuid.test(proof.actorId) &&
    typeof proof.sessionHash === 'string' &&
    /^[a-f0-9]{64}$/.test(proof.sessionHash) &&
    typeof proof.verifiedPasskeyId === 'string' &&
    /^[A-Za-z0-9_-]{1,4096}$/.test(proof.verifiedPasskeyId) &&
    Number.isSafeInteger(proof.verifiedAt) &&
    Number(proof.verifiedAt) > 0 &&
    Number(proof.verifiedAt) <= Number.MAX_SAFE_INTEGER - VERIFICATION_MS &&
    Number.isSafeInteger(verifiedUntil) &&
    Number(verifiedUntil) > Number(proof.verifiedAt) &&
    Number(verifiedUntil) <= Number(proof.verifiedAt) + VERIFICATION_MS &&
    Number.isSafeInteger(authorizedAt) &&
    Number(authorizedAt) >= Number(proof.verifiedAt) &&
    Number(authorizedAt) < Number(verifiedUntil) &&
    Number(authorizedAt) <= Number.MAX_SAFE_INTEGER - RESTORE_OPERATION_MS &&
    Number.isSafeInteger(proof.expiresAt) &&
    Number(proof.expiresAt) > Number(authorizedAt) &&
    Number(proof.expiresAt) <= Number(authorizedAt) + RESTORE_OPERATION_MS
  );
}

export const restoreAuthorizedAt = (proof: RestoreAuthority) =>
  proof.authorizedAt ?? proof.verifiedAt;
export const restoreVerifiedUntil = (proof: RestoreAuthority) =>
  proof.verifiedUntil ?? proof.expiresAt;

function currentAuthorization(database: DatabaseSync, actorId: string, sessionHash: string) {
  // One read observes the account, session and verifying credential together.
  // Never construct AuthStore here: frozen-current inspection must not migrate.
  return database
    .prepare(
      `SELECT s.verified_at, s.verified_passkey_id, s.expires_at
       FROM auth_sessions s
       JOIN auth_users u ON u.id = s.user_id
       JOIN auth_passkeys p ON p.id = s.verified_passkey_id AND p.user_id = u.id
       WHERE s.token_hash = ? AND u.id = ? AND u.disabled = 0 AND u.is_admin = 1`,
    )
    .get(sessionHash, actorId);
}

/** Recheck against live authority or its independently witnessed frozen current
 * image, never the archive/candidate. Call again with the actual clock after
 * asynchronous work; re-verification cannot renew this original intent. This
 * proves neither source/target bindings nor permission to activate a database.
 */
export function assertRestoreAuthority(
  database: DatabaseSync,
  proof: RestoreAuthority,
  now: () => number = Date.now,
) {
  if (!validRestoreAuthority(proof)) throw refused();
  const assertTime = () => {
    const current = now();
    if (
      !Number.isSafeInteger(current) ||
      restoreAuthorizedAt(proof) > current ||
      proof.expiresAt <= current
    )
      throw refused();
  };
  assertTime();
  const row = currentAuthorization(database, proof.actorId, proof.sessionHash);
  if (
    !row ||
    row.verified_at !== proof.verifiedAt ||
    row.verified_passkey_id !== proof.verifiedPasskeyId ||
    !Number.isSafeInteger(row.expires_at) ||
    Number(row.expires_at) < proof.expiresAt
  )
    throw refused();
  // SQLite can block synchronously across the deadline; an entry-time clock is
  // insufficient even when there was no await in this function.
  assertTime();
}

/** Only admission needs a fresh passkey check. Keep this separate from ongoing
 * operation checks so a slow copy cannot renew or exhaust the verification. */
export function assertFreshRestoreAuthority(
  database: DatabaseSync,
  proof: RestoreAuthority,
  now: () => number = Date.now,
) {
  const assertFresh = () => {
    const time = now();
    if (
      !Number.isSafeInteger(time) ||
      time < restoreAuthorizedAt(proof) ||
      time >= restoreVerifiedUntil(proof)
    )
      throw refused();
  };
  assertFresh();
  assertRestoreAuthority(database, proof, now);
  assertFresh();
}

/** Called only after the application's authenticated account/CSRF checks. The
 * caller supplies its current session hash and verification expiry. Capture one
 * session-capped operation deadline now; retries retain it, never recapture it.
 */
export function captureRestoreAuthority(
  database: DatabaseSync,
  intent: MaintenanceAuthority,
  now: () => number = Date.now,
): RestoreAuthority {
  const row = currentAuthorization(database, intent.actorId, intent.sessionHash);
  const authorizedAt = now();
  if (!row || !Number.isSafeInteger(row.expires_at) || intent.expiresAt > Number(row.expires_at))
    throw refused();
  const proof: RestoreAuthority = {
    actorId: intent.actorId,
    sessionHash: intent.sessionHash,
    expiresAt: Math.min(Number(row?.expires_at), authorizedAt + RESTORE_OPERATION_MS),
    verifiedUntil: intent.expiresAt,
    authorizedAt,
    verifiedPasskeyId: row?.verified_passkey_id as string,
    verifiedAt: row?.verified_at as number,
  };
  assertFreshRestoreAuthority(database, proof, now);
  return proof;
}
