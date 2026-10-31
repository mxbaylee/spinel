/** Seed exits to release native SQLite handles before the recovery fixture starts. */
import { AuthStore } from '../auth/store.ts';
import { captureRestoreAuthority } from './restore-authority.ts';
import { openDatabase } from '../../../server/database.ts';
if (!process.send || !process.env.DATABASE_PATH) throw new Error('Private fixture required.');
const database = openDatabase(process.env.DATABASE_PATH);
database.exec('CREATE TABLE writes (value TEXT NOT NULL)');
database.prepare('INSERT INTO writes VALUES(?)').run('original');
if (process.env.SPINEL_TEST_AUTHORITY_SEED === '1') {
  const auth = new AuthStore(database);
  const operator = auth.createUser('Operator', true);
  const now = Date.now();
  database
    .prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      'first',
      operator.id,
      Buffer.from([1]),
      0,
      '[]',
      'first',
      'Browser',
      now,
      null,
      0,
      'singleDevice',
    );
  const session = auth.createSession(operator.id, undefined, 'first').session;
  auth.markVerified(session, 'first');
  process.send({
    restoreAuthority: captureRestoreAuthority(database, {
      actorId: operator.id,
      sessionHash: session.token_hash,
      expiresAt: now + 60_000,
    }),
  });
}
database.close();
process.disconnect?.();
