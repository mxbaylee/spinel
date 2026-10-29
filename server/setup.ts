import { resolve } from 'node:path';
import { openDatabase } from './database.ts';
import { AuthStore } from '../src/server/auth/store.ts';
import { SetupService } from '../src/server/auth/setup.ts';
import { ConsoleRecovery } from '../src/server/auth/console-recovery.ts';
import {
  acquireColdWorkspaceLease,
  canonicalDatabasePath,
} from '../src/server/maintenance/journal.ts';
import { closeSync, constants, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

const databasePath = canonicalDatabasePath(
  resolve(process.env.DATABASE_PATH ?? 'data/spinel.sqlite'),
);
mkdirSync(dirname(databasePath), { recursive: true });
const lease =
  process.platform === 'linux' ? await acquireColdWorkspaceLease(databasePath) : undefined;
let database: ReturnType<typeof openDatabase> | undefined;
let opened = false;
try {
  if (lease) {
    try {
      closeSync(
        openSync(
          databasePath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600,
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await lease.bindFile();
  }
  opened = true;
  database = openDatabase(databasePath);
  const args = process.argv.slice(2);
  const recovery = args[0] === '--recover-admin';
  if (
    args.length &&
    (!recovery ||
      (args.length !== 1 &&
        !(args.length === 3 && ['--id', '--name'].includes(args[1]) && args[2])))
  )
    throw new Error('Usage: npm run setup -- [--recover-admin [--id ID | --name NAME]]');
  const store = new AuthStore(database);
  const origin = process.env.APP_ORIGIN ?? `http://localhost:${process.env.PORT ?? '3000'}`;
  const { url, expiresAt } = recovery
    ? new ConsoleRecovery(store, origin).issue(
        args[1] === '--id' ? { id: args[2] } : args[1] === '--name' ? { name: args[2] } : undefined,
      )
    : new SetupService(store, origin).issue();
  console.log(
    `Open this one-time link to ${recovery ? 'recover the existing admin' : 'set up the first admin'} (expires ${new Date(expiresAt).toISOString()}):\n${url}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not issue a setup link.');
  process.exitCode = 1;
} finally {
  try {
    database?.close();
  } finally {
    // A native descriptor may survive close(). After an attempted SQLite open,
    // only process exit ends ownership; unref'd leases cannot keep this CLI alive.
    if (!opened) await lease?.release();
  }
}
