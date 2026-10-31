/** Disposable selected-file mutation proving terminal recovery never reinstalls
 * its old prepared bytes. This is not a browser acknowledgement fixture. */
import { DatabaseSync } from '../../../server/database.ts';
import { acquireColdWorkspace } from './journal.ts';

if (!process.send || !process.env.DATABASE_PATH || !process.env.SPINEL_TEST_FOLDER_ID)
  throw new Error('Private postcommit fixture required.');
const release = await acquireColdWorkspace(process.env.DATABASE_PATH);
const database = new DatabaseSync(process.env.DATABASE_PATH);
try {
  const result = database
    .prepare('UPDATE workspace_items SET name=? WHERE id=?')
    .run('Post-commit edit', process.env.SPINEL_TEST_FOLDER_ID);
  if (result.changes !== 1) throw new Error('Expected one selected folder.');
  process.send({ edited: true });
} finally {
  database.close();
  await release();
  process.disconnect?.();
}
