/** A completed, read-only process observes prepared content without leaving
 * deferred native statements/handles in the supervisor test process. */
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from '../../../server/database.ts';

if (!process.send || !process.env.DATABASE_PATH || !process.env.SPINEL_TEST_FOLDER_ID)
  throw new Error('Private prepared-content observer required.');
const uri = pathToFileURL(process.env.DATABASE_PATH);
// Use SQLite's actual open mode, including before the SPN-118 adapter lands.
uri.searchParams.set('mode', 'ro');
const database = new DatabaseSync(uri.href);
try {
  const row = database
    .prepare('SELECT name FROM workspace_items WHERE id=?')
    .get(process.env.SPINEL_TEST_FOLDER_ID);
  const sessions = database.prepare('SELECT count(*) AS count FROM auth_sessions').get()!.count;
  process.send({ name: row?.name, sessions });
} finally {
  database.close();
  process.disconnect?.();
}
