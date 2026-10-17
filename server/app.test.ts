import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test } from 'vitest';
import { createApp } from './app.ts';
import { openDatabase } from './database.ts';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('creates SQLite in a new directory and preserves data when reopened', async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, 'nested', 'spinel.sqlite');
  let database = openDatabase(path);
  try {
    expect(database.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 });
    database.exec(
      "PRAGMA user_version = 7; CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES ('kept');",
    );
  } finally {
    database.close();
  }
  database = openDatabase(path);
  try {
    expect(database.prepare('SELECT value FROM fixture').get()).toMatchObject({ value: 'kept' });
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 7 });
  } finally {
    database.close();
  }
});

test('serves only built assets and health, and creates a valid database at first startup', async () => {
  const directory = await temporaryDirectory();
  const databasePath = join(directory, 'private', 'spinel.sqlite');
  const staticDirectory = join(directory, 'public');
  await mkdir(staticDirectory);
  await writeFile(join(staticDirectory, 'index.html'), '<h1>Dashboard fixture</h1>');
  const app = await createApp({ databasePath, staticDirectory });
  cleanups.push(() => app.close());
  await new Promise<void>((resolveListen) => app.server.listen(0, '127.0.0.1', resolveListen));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  expect((await readFile(databasePath)).subarray(0, 16).toString()).toBe('SQLite format 3\0');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    expect(database.prepare('PRAGMA integrity_check').get()).toMatchObject({
      integrity_check: 'ok',
    });
  } finally {
    database.close();
  }
  expect(await (await fetch(url)).text()).toContain('Dashboard fixture');
  expect(await (await fetch(`${url}/api/health`)).json()).toEqual({ status: 'ok' });
  expect((await fetch(`${url}/api/missing`)).status).toBe(404);
  expect((await fetch(`${url}/missing.js`)).status).toBe(404);
  expect((await fetch(`${url}/.env`)).status).toBe(404);
  expect((await fetch(`${url}/private/spinel.sqlite`)).status).toBe(404);
  expect((await fetch(`${url}/%2e%2e%2fprivate/spinel.sqlite`)).status).toBe(404);
});

test('fails startup when the production app has not been built', async () => {
  const directory = await temporaryDirectory();
  await expect(
    createApp({ databasePath: join(directory, 'spinel.sqlite'), staticDirectory: directory }),
  ).rejects.toThrow();
});
