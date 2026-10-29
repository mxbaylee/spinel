import type { DatabaseSync } from '../../../server/database.ts';
import { VERIFICATION_MS } from '../auth/store.ts';
import type { MaintenanceAuthority } from '../../shared/maintenance.ts';

/** Private immutable job evidence, never browser-supplied authority. */
export interface RestoreAuthority extends MaintenanceAuthority {
  verifiedPasskeyId: string;
  verifiedAt: number;
}
const keys = ['actorId', 'sessionHash', 'expiresAt', 'verifiedPasskeyId', 'verifiedAt'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const refused = () => new Error('The original restore authorization is no longer valid.');

export function validRestoreAuthority(value: unknown): value is RestoreAuthority {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  return (
    Object.keys(proof).length === keys.length &&
    keys.every((key) => Object.hasOwn(proof, key)) &&
    typeof proof.actorId === 'string' &&
    uuid.test(proof.actorId) &&
    typeof proof.sessionHash === 'string' &&
    /^[a-f0-9]{64}$/.test(proof.sessionHash) &&
    typeof proof.verifiedPasskeyId === 'string' &&
    /^[A-Za-z0-9_-]{1,4096}$/.test(proof.verifiedPasskeyId) &&
    Number.isSafeInteger(proof.verifiedAt) &&
    Number(proof.verifiedAt) > 0 &&
    Number(proof.verifiedAt) <= Number.MAX_SAFE_INTEGER - VERIFICATION_MS &&
    Number.isSafeInteger(proof.expiresAt) &&
    Number(proof.expiresAt) > Number(proof.verifiedAt) &&
    Number(proof.expiresAt) <= Number(proof.verifiedAt) + VERIFICATION_MS
  );
}

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
    if (!Number.isSafeInteger(current) || proof.verifiedAt > current || proof.expiresAt <= current)
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

/** Called only after the application's authenticated account/CSRF checks. The
 * caller supplies its current session hash and the original confirmation expiry;
 * this function captures the precise server-owned verification, not a new one.
 */
export function captureRestoreAuthority(
  database: DatabaseSync,
  intent: MaintenanceAuthority,
  now: () => number = Date.now,
): RestoreAuthority {
  const row = currentAuthorization(database, intent.actorId, intent.sessionHash);
  const proof: RestoreAuthority = {
    actorId: intent.actorId,
    sessionHash: intent.sessionHash,
    expiresAt: intent.expiresAt,
    verifiedPasskeyId: row?.verified_passkey_id as string,
    verifiedAt: row?.verified_at as number,
  };
  assertRestoreAuthority(database, proof, now);
  return proof;
}
