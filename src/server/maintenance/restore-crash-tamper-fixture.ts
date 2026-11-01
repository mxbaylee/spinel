/** Change only a disposable copied private trial. Exiting this process closes
 * every native SQLite handle before the test installs its deliberately bad copy. */
import { realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { openDatabase } from '../../../server/database.ts';
import { restoreSnapshotFingerprint } from '../backup/inventory.ts';

const path = process.env.DATABASE_PATH,
  folder = process.env.SPINEL_TEST_FOLDER_ID;
if (
  !process.send ||
  !path ||
  !folder ||
  realpathSync(path) !== path ||
  !/^closed-probe-[A-Za-z0-9]+$/.test(basename(dirname(path))) ||
  basename(path) !== 'workspace.sqlite'
)
  throw new Error('A disposable crash probe is required.');
let fingerprint: string;
const database = openDatabase(path);
try {
  const changed = database
    .prepare('UPDATE workspace_items SET name=? WHERE id=?')
    .run('Unexpected private-trial content', folder);
  if (Number(changed.changes) !== 1) throw new Error('Missing private-trial fixture folder.');
  const checkpoint = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  if (Number(checkpoint?.busy) !== 0) throw new Error('Private fixture checkpoint is busy.');
  fingerprint = restoreSnapshotFingerprint(database);
} finally {
  database.close();
}
await new Promise<void>((resolve, reject) =>
  process.send!({ fingerprint }, (error) => (error ? reject(error) : resolve())),
);
process.disconnect?.();
