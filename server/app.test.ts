import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test } from 'vitest';
import { createApp, projectRoot } from './app.ts';
import { openDatabase } from './database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

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

test('protects pages and APIs while keeping database files private', async () => {
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
  expect((await fetch(url, { redirect: 'manual' })).headers.get('location')).toBe('/sign-in');
  expect(await (await fetch(`${url}/sign-in`)).text()).toContain('Dashboard fixture');
  expect((await fetch(`${url}/api/health`)).status).toBe(401);
  expect((await fetch(`${url}/api/missing`)).status).toBe(401);
  const writable = openDatabase(databasePath);
  const store = new AuthStore(writable);
  const user = store.createUser('Test');
  const { token } = store.createSession(user.id);
  const headers = { Cookie: `${COOKIE_NAME}=${token}` };
  expect(await (await fetch(`${url}/api/health`, { headers })).json()).toEqual({ status: 'ok' });
  for (const path of [
    '/api/missing',
    '/missing.js',
    '/.env',
    '/private/spinel.sqlite',
    '/%2e%2e%2fprivate/spinel.sqlite',
  ]) {
    expect((await fetch(`${url}${path}`, { headers })).status).toBe(404);
  }
  expect(
    (
      await fetch(`${url}/api/auth/registration/options`, {
        method: 'POST',
        headers: { ...headers, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(403);
  expect((await fetch(`${url}/api/auth/passkeys`)).status).toBe(401);
  const options = await fetch(`${url}/api/auth/authentication/options`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(options.status).toBe(200);
  expect(options.headers.get('set-cookie')).toMatch(
    /__Host-spinel-session=.+; Path=\/; Expires=.+; HttpOnly; Secure; SameSite=Strict/,
  );
  expect(options.headers.get('cache-control')).toBe('no-store');
  store.revokeSession(store.session(token)!.token_hash);
  expect((await fetch(`${url}/api/health`, { headers })).status).toBe(401);
  writable.close();
});

test('fails startup when the production app has not been built', async () => {
  const directory = await temporaryDirectory();
  await expect(
    createApp({ databasePath: join(directory, 'spinel.sqlite'), staticDirectory: directory }),
  ).rejects.toThrow();
});

test('Vite cannot serve database files, sidecars or server source through its filesystem routes', async () => {
  await mkdir(join(projectRoot, 'test-results'), { recursive: true });
  const directory = await mkdtemp(join(projectRoot, 'test-results/auth-boundary-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'private.sqlite');
  const app = await createApp({ databasePath, development: true });
  cleanups.push(() => app.close());
  await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const files = [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
    join(projectRoot, 'server/app.ts'),
  ];
  for (const file of files) {
    for (const path of [
      `/@fs/${file}`,
      `/@fs/${file}?raw`,
      `/@fs/${encodeURIComponent(file)}?import`,
    ]) {
      const response = await fetch(`${url}${path}`, { redirect: 'manual' });
      expect(response.status, path).not.toBe(200);
    }
  }
  const html = await (await fetch(`${url}/sign-in`)).text();
  expect(html).toContain('/main.tsx');
  expect((await fetch(`${url}/main.tsx`)).status).toBe(200);
});
