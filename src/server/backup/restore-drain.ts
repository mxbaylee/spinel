import type { DatabaseSync } from '../../../server/database.ts';
import { restoreSnapshotFingerprint } from './inventory.ts';

/** Terminal application shutdown only, after every storage owner has flushed
 * and closed. The supervisor must persist and bind the returned witness before
 * acknowledging it. The database remains sealed even when capture fails. */
export function captureTerminalRestoreFingerprint(database: DatabaseSync): string {
  database.setWriteGuard(() => {
    throw new Error('The final restore snapshot is sealed against further writes.');
  });
  database.assertQuiescent();
  database.exec('BEGIN');
  try {
    const fingerprint = restoreSnapshotFingerprint(database);
    database.exec('COMMIT');
    return fingerprint;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
