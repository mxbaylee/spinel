import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from './database.ts';
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
    expect(database.prepare('PRAGMA busy_timeout').get()).toMatchObject({ timeout: 5000 });
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
  const database = new DatabaseSync(databasePath);
  try {
    expect(database.prepare('PRAGMA integrity_check').get()).toMatchObject({
      integrity_check: 'ok',
    });
  } finally {
    database.close();
  }
  expect((await fetch(url, { redirect: 'manual' })).headers.get('location')).toBe('/sign-in');
  expect((await fetch(`${url}/preview`, { redirect: 'manual' })).headers.get('location')).toBe(
    '/sign-in',
  );
  expect(await (await fetch(`${url}/sign-in`)).text()).toContain('Dashboard fixture');
  expect((await fetch(`${url}/api/health`)).status).toBe(401);
  expect((await fetch(`${url}/api/missing`)).status).toBe(401);
  const writable = openDatabase(databasePath);
  const store = new AuthStore(writable);
  const user = store.createUser('Test');
  const { token } = store.createSession(user.id);
  const headers = { Cookie: `${COOKIE_NAME}=${token}` };
  const preview = await fetch(`${url}/preview?item=example&version=example`, { headers });
  expect(preview.status).toBe(200);
  expect(preview.headers.get('cache-control')).toBe('no-store');
  expect(await preview.text()).toContain('Dashboard fixture');
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

test('backup health is admin-only, noncacheable and retains last success after failure', async () => {
  const directory = await temporaryDirectory(),
    databasePath = join(directory, 'spinel.sqlite');
  await writeFile(join(directory, 'index.html'), '<h1>fixture</h1>');
  const app = await createApp({ databasePath, staticDirectory: directory });
  cleanups.push(() => app.close());
  await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/admin/backups`;
  const db = openDatabase(databasePath);
  cleanups.push(async () => db.close());
  const auth = new AuthStore(db),
    owner = auth.createUser('Owner'),
    admin = auth.createUser('Operator', true);
  const cookie = (id: string) => ({ Cookie: `${COOKIE_NAME}=${auth.createSession(id).token}` });
  expect((await fetch(url)).status).toBe(401);
  expect((await fetch(url, { headers: cookie(owner.id) })).status).toBe(404);
  db.prepare('UPDATE backup_state SET last_good=?, error=?').run(1234, 'Backup failed.');
  const headers = cookie(admin.id),
    response = await fetch(url, { headers });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({
    lastGood: 1234,
    error: 'Backup failed.',
    configured: false,
  });
  db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(admin.id);
  expect((await fetch(url, { headers })).status).toBe(401);
});

for (const development of [false, true]) {
  test(`page metadata stays generic with configured-origin assets (${development ? 'development' : 'production'})`, async () => {
    const directory = await temporaryDirectory();
    const databasePath = join(directory, 'spinel.sqlite');
    await writeFile(
      join(directory, 'index.html'),
      await readFile(join(projectRoot, 'web/index.html')),
    );
    const app = await createApp({
      databasePath,
      staticDirectory: directory,
      development,
      origin: 'https://spinel.example',
    });
    cleanups.push(() => app.close());
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const inspect = async (path: string, headers: Record<string, string> = {}) => {
      const response = await fetch(`${url}${path}`, {
        headers: { ...headers, 'X-Forwarded-Host': 'attacker.example' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const html = await response.text();
      for (const text of [
        '<title>Spinel</title>',
        'name="description"',
        'name="robots" content="noindex"',
        'property="og:title" content="Spinel"',
        'property="og:description"',
        'content="https://spinel.example/social-preview.png"',
        'name="twitter:card" content="summary_large_image"',
        'href="/favicon.svg"',
        'href="/favicon-32.png"',
        'href="/favicon.ico"',
      ])
        expect(html).toContain(text);
      expect(html).not.toMatch(/Private sentinel|secret-token|attacker\.example|__SPINEL_ORIGIN__/);
    };
    await inspect('/setup');
    const db = openDatabase(databasePath);
    cleanups.push(async () => db.close());
    const auth = new AuthStore(db);
    const owner = auth.createUser('Private sentinel owner');
    const { WorkspaceStore } = await import('../src/server/workspace/store.ts');
    const workspace = new WorkspaceStore(auth);
    const item = workspace.create(owner.id, {
      name: 'Private sentinel document',
      kind: 'doc',
      parentId: null,
    });
    for (const path of [
      '/sign-in',
      '/invite?token=secret-token',
      `/share/${item.id}?token=secret-token`,
    ])
      await inspect(path);
    await inspect(`/?item=${item.id}`, {
      Cookie: `${COOKIE_NAME}=${auth.createSession(owner.id).token}`,
    });
  });
}
