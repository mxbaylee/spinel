/** Real disposable process used only for kernel lease lifetime regression tests. */
import { openDatabase } from '../../../server/database.ts';
import { acquireColdWorkspace, acquireLiveWorkspace } from './journal.ts';

if (!process.send || !process.env.DATABASE_PATH) throw new Error('Private lease fixture required.');
if (process.env.SPINEL_TEST_LEASE === 'live') {
  // Closing SQLite must not release live ownership while this process remains.
  await acquireLiveWorkspace(process.env.DATABASE_PATH);
  const database = openDatabase(process.env.DATABASE_PATH);
  database.close();
  process.on('message', () => process.disconnect?.());
} else if (process.env.SPINEL_TEST_LEASE === 'cold') {
  await acquireColdWorkspace(process.env.DATABASE_PATH);
  process.exitCode = 1;
} else throw new Error('Unknown lease fixture.');
process.send({ ready: true }, () => {
  if (process.env.SPINEL_TEST_LEASE === 'cold') process.disconnect?.();
});
