import { DatabaseSync } from '../../../server/database.ts';
import { receiveWorkspaceOwnership } from './ownership.ts';

// This worker is started only by the local supervisor with its fixed workspace path.
let database: DatabaseSync | undefined;
let ok = false;
const disconnected = () => process.exit(1);
try {
  if (!process.send || !process.env.DATABASE_PATH)
    throw new Error('Private verifier channel required.');
  process.on('disconnect', disconnected);
  await receiveWorkspaceOwnership(process.env.DATABASE_PATH);
  database = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true });
  const result = database.prepare('PRAGMA quick_check(1)').all();
  if (result.length !== 1 || result[0].quick_check !== 'ok')
    throw new Error('Integrity check failed.');
  for (const row of database.iterate('PRAGMA foreign_key_check'))
    if (row) throw new Error('Reference check failed.');
  ok = true;
} catch {
  // Raw database errors, table names and paths do not leave this process.
} finally {
  database?.close();
}
process.off('disconnect', disconnected);
process.send?.({ ok }, () => process.disconnect?.());
process.exitCode = ok ? 0 : 1;
