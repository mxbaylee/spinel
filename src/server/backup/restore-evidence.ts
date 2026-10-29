import { statSync } from 'node:fs';
import type { DatabaseSync } from '../../../server/database.ts';
import { requireCompatibleRestoreSchema } from './restore-credentials.ts';

// The supervisor must admit cumulative rollback capacity BEFORE every activation.
// Reaching this bound requires a closed recovery decision, never dropping an old
// attempt or treating its remaining identities as reusable.
export const MAX_RESTORE_EVIDENCE_INPUTS = 8;

/** Only distinct, disposable, hash-bound copies belong here. Additional sources
 * supply negative evidence, never account, ownership, content or grant authority.
 * Schema admission includes executable triggers/views, not just table names.
 */
export function restoreEvidenceSources(
  current: DatabaseSync,
  candidate: DatabaseSync,
  additional: readonly DatabaseSync[] = [],
) {
  if (additional.length > MAX_RESTORE_EVIDENCE_INPUTS)
    throw new Error('Too many retained recovery attempts.');
  const seen = new Set<string>();
  for (const db of [candidate, current, ...additional]) {
    const file = statSync(db.path, { bigint: true });
    const identity = `${file.dev}:${file.ino}`;
    if (seen.has(identity)) throw new Error('Recovery inputs have incompatible file identities.');
    seen.add(identity);
  }
  const tables = requireCompatibleRestoreSchema(current, candidate);
  for (const db of additional) requireCompatibleRestoreSchema(current, db);
  const sources = [current, ...additional];
  for (const db of sources) db.assertQuiescent();
  return { sources, tables };
}
