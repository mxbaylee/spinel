import { statSync } from 'node:fs';
import type { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { restoreSnapshotFingerprint, verifyInventory, writeInventory } from './inventory.ts';
import {
  reconcileRestoreCredentials,
  requireCompatibleRestoreSchema,
  restoreMetadataSchema,
} from './restore-credentials.ts';
import { reconcileRestoreOwnership } from './restore-ownership.ts';
import { reconcileRestoreGrants } from './restore-grants.ts';
import { reconcileRestoreReceipts } from './restore-receipts.ts';
import { reconcileRestoreOperations } from './restore-operations.ts';
import { rotateRestoreGenerations } from './restore-generations.ts';
import { verifySemantics } from './verification-semantics.ts';
import { restoreEvidenceSources } from './restore-evidence.ts';

const incompatible = () => new Error('This backup needs compatible recovery preparation.');
const frozen = () => new Error('The frozen authority copy cannot be changed.');

/** Admission for the only two service constructors used during preparation.
 * No migrations are permitted here, even when both copies need the same one.
 * The after-construction proof also catches future constructor side effects.
 */
function resolverSchema(db: DatabaseSync) {
  const names = new Set(
    db
      .prepare('SELECT name FROM sqlite_schema')
      .all()
      .map((row) => row.name),
  );
  for (const name of [
    'auth_users',
    'auth_passkeys',
    'auth_sessions',
    'auth_challenges',
    'auth_passkeys_user',
    'auth_sessions_expiry',
    'auth_challenges_session',
    'workspace_items',
    'workspace_item_creators',
    'workspace_tags',
    'workspace_tag_assignments',
    'workspace_grants',
    'workspace_placements',
    'workspace_items_owner_parent',
    'workspace_items_parent',
    'workspace_tag_assignments_item',
    'workspace_tag_assignments_user_name',
    'workspace_grants_user_item',
    'workspace_placements_parent',
    'workspace_items_trash',
    'item_appearance',
    'cover_assets',
    'workspace_recovery_holds',
    'workspace_items_recovery_batch',
    'workspace_links',
    'workspace_guest_sessions',
    'workspace_guest_item',
    'workspace_links_expiry',
  ])
    if (!names.has(name)) throw incompatible();
  for (const [table, required] of [
    ['auth_sessions', ['passkey_id', 'verified_at', 'verified_passkey_id']],
    ['workspace_items', ['trashed_at', 'trash_batch']],
    ['workspace_grants', ['shared_at']],
    ['workspace_links', ['preview_hash', 'enabled_at', 'expires_at']],
  ] as const) {
    const fields = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name),
    );
    if (required.some((field) => !fields.has(field))) throw incompatible();
  }
  if (
    !String(
      db.prepare("SELECT sql FROM sqlite_schema WHERE name='workspace_grants'").get()?.sql,
    ).includes("'admin'")
  )
    throw incompatible();
}

function constructionMark(db: DatabaseSync) {
  return JSON.stringify({
    schema: db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(),
    version: db.prepare('PRAGMA schema_version').get(),
    changes: db.prepare('SELECT total_changes() AS n').get(),
  });
}

function integrity(db: DatabaseSync) {
  const check = db.prepare('PRAGMA quick_check').all();
  if (
    check.length !== 1 ||
    check[0].quick_check !== 'ok' ||
    db.prepare('PRAGMA foreign_key_check').all().length
  )
    throw incompatible();
}

/** Internal restricted-worker step on TWO DISPOSABLE copies with no other
 * connections. The caller authenticates the archive and binds both closed files
 * to trusted hashes before opening them. Candidate input must already have
 * passed the authenticated archive's original semantic verification. Never pass the live database or raw
 * rollback evidence. The current copy's embedded inventory may be stale after
 * an earlier restore; its new frozen-file hash is the authority boundary.
 *
 * A failure invalidates the WHOLE candidate, including any committed helper
 * steps. Discard it; do not retry in place. No service starts, schedules, external
 * effects, epoch changes, source custody, activation or rollback occur here.
 */
export async function reconcileRestoreCandidate(
  current: DatabaseSync,
  candidate: DatabaseSync,
  options: { spacesEnabled: boolean; now: number },
) {
  if (!Number.isSafeInteger(options.now) || options.now < 0) throw incompatible();
  current.assertQuiescent();
  candidate.assertQuiescent();
  const a = statSync(current.path, { bigint: true }),
    b = statSync(candidate.path, { bigint: true });
  if (a.dev === b.dev && a.ino === b.ino) throw incompatible();
  requireCompatibleRestoreSchema(current, candidate);
  verifyInventory(candidate);
  for (const db of [current, candidate]) {
    integrity(db);
    resolverSchema(db);
  }
  const stores = [current, candidate].map((db) => {
    const before = constructionMark(db);
    const workspace = new WorkspaceStore(new AuthStore(db, () => options.now), {
      spacesEnabled: options.spacesEnabled,
    });
    if (constructionMark(db) !== before) throw incompatible();
    return workspace;
  });
  const sourceChanges = current.prepare('SELECT total_changes() AS n').get()!.n;
  current.setWriteGuard(() => {
    throw frozen();
  });
  const credentials = reconcileRestoreCredentials(current, candidate);
  const ownership = reconcileRestoreOwnership(current, candidate);
  const grants = reconcileRestoreGrants(stores[0], stores[1]);
  const receipts = reconcileRestoreReceipts(current, candidate);
  const operations = reconcileRestoreOperations(current, candidate);
  const generations = rotateRestoreGenerations(current, candidate);
  integrity(candidate);
  writeInventory(candidate);
  const semantics = await verifySemantics(candidate);
  const inventory = verifyInventory(candidate)!;
  current.assertQuiescent();
  candidate.assertQuiescent();
  if (current.prepare('SELECT total_changes() AS n').get()!.n !== sourceChanges) throw frozen();
  return {
    credentials,
    ownership,
    grants,
    receipts,
    operations,
    generations,
    inventory,
    semantics,
  };
}

/** Original-content rollback preparation, NOT forward archive admission. The
 * caller binds current to the independent terminal witness and supplies a second
 * disposable copy of that exact frozen original. Its embedded inventory may be
 * stale after legitimate serving writes. Full logical equality (including that
 * metadata) is required instead of weakening authenticated archive validation.
 *
 * Attempt copies contribute only negative evidence. Original ownership, grants,
 * placements, trash/holds and content remain intact; sessions/capabilities and
 * native generations still rotate. Never use a failed attempt as current. Any
 * failure invalidates this entire working copy. Admission and durable custody of
 * a usable rollback must precede activation; this function authorizes neither.
 */
export async function reconcileRestoreRollback(
  current: DatabaseSync,
  candidate: DatabaseSync,
  additional: readonly DatabaseSync[],
  options: { spacesEnabled: boolean; now: number },
) {
  if (!Number.isSafeInteger(options.now) || options.now < 0) throw incompatible();
  const { sources } = restoreEvidenceSources(current, candidate, additional);
  candidate.assertQuiescent();
  for (const db of [...sources, candidate]) integrity(db);
  const originalFingerprint = restoreSnapshotFingerprint(current);
  if (originalFingerprint !== restoreSnapshotFingerprint(candidate))
    throw new Error('Rollback content does not match the frozen original.');
  for (const db of [current, candidate]) {
    resolverSchema(db);
    const before = constructionMark(db);
    new WorkspaceStore(new AuthStore(db, () => options.now), {
      spacesEnabled: options.spacesEnabled,
    });
    if (constructionMark(db) !== before) throw incompatible();
  }
  const marks = sources.map((db) => {
    const changes = db.prepare('SELECT total_changes() AS n').get()!.n;
    db.setWriteGuard(() => {
      throw frozen();
    });
    return changes;
  });
  const credentials = reconcileRestoreCredentials(current, candidate);
  const receipts = reconcileRestoreReceipts(current, candidate, additional);
  const operations = reconcileRestoreOperations(current, candidate);
  const generations = rotateRestoreGenerations(current, candidate, additional);
  integrity(candidate);
  // A never-restored serving original has no archive metadata table. Establish
  // canonical inventory storage only AFTER equality with the sealed original;
  // this is rollback provenance, not a claim that a new backup was created.
  if (!candidate.prepare("SELECT 1 FROM sqlite_schema WHERE name='spinel_recovery'").get())
    candidate.exec(restoreMetadataSchema);
  if (!candidate.prepare('SELECT 1 FROM spinel_recovery WHERE id=1').get())
    candidate.prepare('INSERT INTO spinel_recovery(id,metadata) VALUES(1,?)').run(
      JSON.stringify({
        format: 1,
        kind: 'supervised-rollback',
        originalFingerprint,
        preparedAt: options.now,
      }),
    );
  writeInventory(candidate);
  const semantics = await verifySemantics(candidate);
  const inventory = verifyInventory(candidate)!;
  for (const [index, db] of sources.entries()) {
    db.assertQuiescent();
    if (db.prepare('SELECT total_changes() AS n').get()!.n !== marks[index]) throw frozen();
  }
  candidate.assertQuiescent();
  return { credentials, receipts, operations, generations, inventory, semantics };
}
