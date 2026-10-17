import { resolve } from 'node:path';
import { openDatabase } from './database.ts';
import { AuthStore } from '../src/server/auth/store.ts';
import { SetupService } from '../src/server/auth/setup.ts';

const database = openDatabase(resolve(process.env.DATABASE_PATH ?? 'data/spinel.sqlite'));
try {
  const setup = new SetupService(
    new AuthStore(database),
    process.env.APP_ORIGIN ?? `http://localhost:${process.env.PORT ?? '3000'}`,
  );
  const { url, expiresAt } = setup.issue();
  console.log(
    `Open this one-time link to set up the first admin (expires ${new Date(expiresAt).toISOString()}):\n${url}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not issue a setup link.');
  process.exitCode = 1;
} finally {
  database.close();
}
