import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from './database.ts';
import { afterEach, expect, test } from 'vitest';
import { createApp, projectRoot } from './app.ts';
import { openDatabase } from './database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';

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

test('startup upgrades storage before SDK initialization and preserves Space data when explicitly disabled', async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, 'app.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  let db = openDatabase(path);
  let auth = new AuthStore(db);
  let workspace = new WorkspaceStore(auth);
  new DocumentStore(workspace);
  const owner = auth.createUser('Owner');
  const ordinary = workspace.create(owner.id, {
    name: 'Ordinary notes',
    kind: 'doc',
    parentId: null,
  });
  const native = JSON.stringify({
    id: ordinary.id,
    body: { dataStream: 'Keep ordinary data\r\n' },
  });
  db.prepare('INSERT INTO doc_snapshots VALUES(?,?,1,?)').run(
    ordinary.id,
    native,
    'original-write',
  );
  const session = auth.createSession(owner.id);
  expect(
    db
      .prepare('PRAGMA table_info(workspace_items)')
      .all()
      .map((row) => row.name),
  ).not.toContain('space_id');
  db.close();
  const first = await createApp({
    databasePath: path,
    staticDirectory: directory,
    spaceReview: false,
  });
  await first.close();
  db = openDatabase(path);
  auth = new AuthStore(db);
  workspace = new WorkspaceStore(auth);
  const spaces = new SpaceStore(workspace);
  const space = spaces.createRoot(owner.id, { name: 'Hidden Space', parentId: null }).space;
  const child = spaces.createChild(owner.id, space.id, {
    name: 'Hidden child',
    kind: 'doc',
    parentId: space.id,
  }).item;
  const hidden = JSON.stringify({ id: child.id, body: { dataStream: 'Keep hidden data\r\n' } });
  db.prepare('INSERT INTO doc_snapshots VALUES(?,?,1,?)').run(child.id, hidden, 'hidden-write');
  expect(
    db.prepare('SELECT snapshot FROM doc_snapshots WHERE item_id=?').get(ordinary.id)?.snapshot,
  ).toBe(native);
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='trigger' AND name='spinel_generation_deleted'",
      )
      .get(),
  ).toBeDefined();
  db.close();

  const reopened = await createApp({
    databasePath: path,
    staticDirectory: directory,
    spaceReview: false,
  });
  cleanups.push(() => reopened.close());
  await new Promise<void>((resolve) => reopened.server.listen(0, '127.0.0.1', resolve));
  const root = 'http://127.0.0.1:' + (reopened.server.address() as AddressInfo).port;
  const headers = { Cookie: COOKIE_NAME + '=' + session.token };
  const listing = await fetch(root + '/api/items', { headers });
  expect(listing.status).toBe(200);
  const listed = await listing.text();
  expect(JSON.parse(listed).spacesEnabled).toBe(false);
  expect(listed).toContain(ordinary.id);
  for (const value of [space.id, child.id, 'Hidden']) expect(listed).not.toContain(value);
  for (const id of [space.id, child.id])
    expect((await fetch(root + '/api/items/' + id, { headers })).status).toBe(404);
  const creation = await fetch(root + '/api/items', {
    method: 'POST',
    headers: { ...headers, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Not exposed', kind: 'space', parentId: null }),
  });
  // A disabled capability is unavailable, including through outer-file creation.
  expect(creation.status).toBe(404);
  db = openDatabase(path);
  try {
    expect(
      db.prepare('SELECT snapshot FROM doc_snapshots WHERE item_id=?').get(ordinary.id)?.snapshot,
    ).toBe(native);
    expect(
      db.prepare('SELECT snapshot FROM doc_snapshots WHERE item_id=?').get(child.id)?.snapshot,
    ).toBe(hidden);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
});

test('normal startup exposes Space roots while native children require their exact Space route', async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, 'app.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const app = await createApp({ databasePath: path, staticDirectory: directory });
  cleanups.push(() => app.close());
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const root = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port;
  const db = openDatabase(path);
  try {
    const auth = new AuthStore(db);
    const owner = auth.createUser('Owner');
    const session = auth.createSession(owner.id);
    const headers = {
      Cookie: COOKIE_NAME + '=' + session.token,
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
    };
    const created = await fetch(root + '/api/items', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Normal Space', kind: 'space', parentId: null }),
    });
    expect(created.status).toBe(201);
    const { item } = (await created.json()) as { item: { id: string; kind: string } };
    expect(item.kind).toBe('space');
    const createdChild = await fetch(root + '/api/spaces/' + item.id + '/items', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Scoped page', kind: 'doc', parentId: item.id }),
    });
    expect(createdChild.status).toBe(201);
    const listed = await (await fetch(root + '/api/items', { headers })).json();
    expect(listed.items).toContainEqual(expect.objectContaining({ id: item.id, kind: 'space' }));
    const tree = await (await fetch(root + '/api/spaces/' + item.id, { headers })).json();
    expect(tree.space.id).toBe(item.id);
    expect(tree.items).toHaveLength(1);
    const child = tree.items[0].id as string;
    expect(listed.items).not.toContainEqual(expect.objectContaining({ id: child }));
    expect((await fetch(root + '/api/items/' + child, { headers })).status).toBe(404);
    expect((await fetch(root + '/api/items/' + child + '/doc', { headers })).status).toBe(404);
    expect((await fetch(root + '/spaces/' + item.id, { headers })).status).toBe(200);
  } finally {
    db.close();
  }
});

test('startup refuses an incomplete Space migration before creating SDK generation storage', async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, 'app.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  let db = openDatabase(path);
  new WorkspaceStore(new AuthStore(db));
  db.exec('ALTER TABLE workspace_items ADD COLUMN space_id TEXT');
  db.close();
  await expect(createApp({ databasePath: path, staticDirectory: directory })).rejects.toThrow(
    'incomplete previous schema',
  );
  db = openDatabase(path);
  try {
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name='spinel_live_units'").get(),
    ).toBeUndefined();
    expect(
      db
        .prepare('PRAGMA table_info(workspace_items)')
        .all()
        .map((row) => row.name),
    ).not.toContain('space_position');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
});

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
    expect(
      database
        .prepare('PRAGMA table_info(workspace_items)')
        .all()
        .map((row) => row.name),
    ).toEqual(expect.arrayContaining(['space_id', 'space_position']));
    expect(
      database.prepare("SELECT name FROM sqlite_schema WHERE name='workspace_space_trash'").get(),
    ).toMatchObject({ name: 'workspace_space_trash' });
  } finally {
    database.close();
  }
  expect((await fetch(url, { redirect: 'manual' })).headers.get('location')).toBe('/sign-in');
  expect((await fetch(`${url}/preview`, { redirect: 'manual' })).headers.get('location')).toBe(
    '/sign-in',
  );
  for (const path of ['/sign-in', '/sign-in?connect=opaque', '/connect?request=opaque']) {
    const page = await fetch(`${url}${path}`);
    expect(page.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(await page.text()).toContain('Dashboard fixture');
  }
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
        'href="/favicon.svg?v=2"',
        'href="/favicon-32.png?v=2"',
        'href="/favicon.ico?v=2"',
      ])
        expect(html).toContain(text);
      expect(html).not.toMatch(/Private sentinel|secret-token|attacker\.example|__SPINEL_/);
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
    db.prepare('UPDATE workspace_items SET name=? WHERE id=?').run('Shared & <recipe>', item.id);
    const link = workspace.links.begin(item.id, 'viewer');
    workspace.links.finish(item.id, link.epoch, true);
    const address = `${url}/share/${item.id}?preview=${link.previewToken}`;
    const shared = await fetch(address);
    expect(shared.headers.get('cache-control')).toBe('no-store');
    expect(shared.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await shared.text();
    expect(html).toContain('<title>Shared &amp; &lt;recipe&gt; — Spinel</title>');
    expect(html).toContain('A document shared with you on Spinel.');
    expect(html).toContain(
      `https://spinel.example/share/${item.id}/preview.png?preview=${link.previewToken}`,
    );
    expect(html).not.toContain(link.token!);
    expect(html).not.toContain(owner.name);
    const off = workspace.links.begin(item.id, null);
    workspace.links.finish(item.id, off.epoch, false);
    expect(await (await fetch(address)).text()).not.toContain('Shared &amp;');
  });
}
