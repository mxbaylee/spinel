import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Collaborator');
  const admin = auth.createUser('Operator', true);
  const store = new WorkspaceStore(auth);
  const folder = (name: string, parentId: string | null = null) =>
    store.create(owner.id, { name, parentId, kind: 'folder' });
  return { db, auth, owner, other, admin, store, folder };
}
test('nested moves retain descendants and identities; rename changes only the selected item', () => {
  const f = fixture();
  const root = f.folder('Personal');
  const child = f.folder('Finance', root.id);
  const leaf = f.folder('2026', child.id);
  const doc = f.store.create(f.owner.id, { name: 'Budget', kind: 'sheet', parentId: leaf.id });
  const other = f.folder('Work');
  f.store.update(f.owner.id, child.id, { parentId: other.id, name: 'Accounts' });
  expect(f.store.get(f.owner.id, child.id)).toMatchObject({ name: 'Accounts', parentId: other.id });
  expect(f.store.get(f.owner.id, leaf.id).parentId).toBe(child.id);
  expect(f.store.get(f.owner.id, doc.id)).toEqual(doc);
  f.store.update(f.owner.id, doc.id, { parentId: null });
  expect(f.store.get(f.owner.id, doc.id)).toMatchObject({
    name: 'Budget',
    kind: 'sheet',
    parentId: null,
  });
});
test('self and descendant moves are rejected atomically, including a combined rename', () => {
  const f = fixture();
  const root = f.folder('Personal');
  const child = f.folder('Finance', root.id);
  const leaf = f.folder('2026', child.id);
  const before = f.store.list(f.owner.id);
  for (const destination of [root.id, child.id, leaf.id])
    expect(() =>
      f.store.update(f.owner.id, root.id, { parentId: destination, name: 'Must not save' }),
    ).toThrow('subfolders');
  expect(f.store.list(f.owner.id)).toEqual(before);
});
test('another owner cannot list, open, rename, move into or create inside private items', () => {
  const f = fixture();
  const privateFolder = f.folder('Private');
  const own = f.store.create(f.other.id, { name: 'Mine', kind: 'doc', parentId: null });
  expect(f.store.list(f.other.id)).toEqual([own]);
  for (const id of [privateFolder.id, 'missing-id']) {
    expect(() => f.store.get(f.other.id, id)).toThrow('not available');
    expect(() => f.store.update(f.other.id, id, { name: 'Hijacked' })).toThrow('not available');
    expect(() => f.store.update(f.other.id, own.id, { parentId: id })).toThrow('not available');
    expect(() => f.store.create(f.other.id, { name: 'Hidden', kind: 'doc', parentId: id })).toThrow(
      'not available',
    );
  }
  expect(f.store.list(f.other.id)).toEqual([own]);
  expect(f.store.list(f.owner.id)).toEqual([privateFolder]);
});
test('admins and disabled owners cannot use document storage', () => {
  const f = fixture();
  const item = f.folder('Private');
  for (const id of [f.admin.id, 'missing']) {
    expect(() => f.store.list(id)).toThrow();
    expect(() => f.store.get(id, item.id)).toThrow();
    expect(() => f.store.create(id, { name: 'X', kind: 'doc', parentId: null })).toThrow();
    expect(() => f.store.update(id, item.id, { name: 'X' })).toThrow();
  }
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.store.get(f.owner.id, item.id)).toThrow('Sign in');
});
test('only folders can contain items, all document kinds remain distinct, names are validated', () => {
  const f = fixture();
  for (const kind of ['sheet', 'doc', 'slides']) {
    const doc = f.store.create(f.owner.id, { name: '  Untitled  ', kind, parentId: null });
    expect(doc).toMatchObject({ name: 'Untitled', kind });
    expect(() => f.folder('Bad', doc.id)).toThrow('folder');
  }
  for (const name of ['', '  ', 'x'.repeat(121), 'a/b', 'a\\b', 'a\n'])
    expect(() => f.folder(name)).toThrow('name');
  expect(() => f.store.create(f.owner.id, { name: 'x', kind: 'unknown', parentId: null })).toThrow(
    'Choose',
  );
  expect(() => f.store.create(f.owner.id, { name: 'x', kind: 'doc' })).toThrow('destination');
  // Duplicate names are allowed by decision #14; identity and destinations use IDs.
  expect(f.folder('Same').id).not.toBe(f.folder('Same').id);
});
test('SQLite reopen preserves the tree and empty document records without a schema reset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-tree-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'db.sqlite');
  let db = openDatabase(path);
  let auth = new AuthStore(db);
  const user = auth.createUser('Owner');
  let store = new WorkspaceStore(auth);
  const root = store.create(user.id, { kind: 'folder', name: 'Personal', parentId: null });
  const doc = store.create(user.id, { kind: 'doc', name: 'Journal', parentId: root.id });
  store.update(user.id, doc.id, { parentId: null });
  db.close();
  db = openDatabase(path);
  cleanup.push(() => db.close());
  auth = new AuthStore(db);
  store = new WorkspaceStore(auth);
  expect(store.get(user.id, root.id)).toEqual(root);
  expect(store.get(user.id, doc.id)).toMatchObject({
    parentId: null,
    kind: 'doc',
    name: 'Journal',
  });
});
test('HTTP boundaries reject missing/admin/disabled sessions, CSRF and ownership injection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-tree-http-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const path = join(directory, 'db.sqlite');
  const app = await createApp({ databasePath: path, staticDirectory: directory });
  cleanup.push(() => app.close());
  await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/items`;
  const db = openDatabase(path);
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const store = new WorkspaceStore(auth);
  const user = auth.createUser('Owner');
  const other = auth.createUser('Other');
  const admin = auth.createUser('Admin', true);
  const token = auth.createSession(user.id).token;
  const headers = {
    Cookie: `${COOKIE_NAME}=${token}`,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
  };
  const call = (method: string, suffix = '', body?: unknown, supplied = headers) =>
    fetch(url + suffix, {
      method,
      headers: supplied,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const created = await call('POST', '', { name: 'Budget', kind: 'sheet', parentId: null });
  expect(created.status).toBe(201);
  const { item } = await created.json();
  const foreign = store.create(other.id, { name: 'Secret', kind: 'doc', parentId: null });
  expect((await (await call('GET')).json()).items).toHaveLength(1);
  expect((await call('GET')).headers.get('cache-control')).toBe('no-store');
  expect((await call('GET', `/${foreign.id}`)).status).toBe(404);
  expect((await call('PATCH', `/${foreign.id}`, { name: 'Stolen' })).status).toBe(404);
  expect((await call('PATCH', `/${item.id}`, { owner_id: other.id })).status).toBe(400);
  expect((await call('PATCH', `/${item.id}`, { kind: 'slides' })).status).toBe(400);
  expect((await call('POST', `/${item.id}/tags`, { tag: 'budget', userId: other.id })).status).toBe(
    400,
  );
  expect((await call('POST', `/${foreign.id}/tags`, { tag: 'budget' })).status).toBe(404);
  expect(
    (
      await call(
        'POST',
        `/${item.id}/tags`,
        { tag: 'budget' },
        { ...headers, Origin: 'https://evil.example' },
      )
    ).status,
  ).toBe(403);
  expect((await call('POST', `/${item.id}/tags`, { tag: '#BUDGET' })).status).toBe(200);
  expect((await (await call('GET', `/${item.id}`)).json()).item.tags).toEqual(['budget']);
  expect((await (await call('GET', '/tags')).json()).tags).toEqual(['budget']);
  expect((await call('DELETE', `/${item.id}/tags`, { tag: 'budget' })).status).toBe(200);
  expect((await (await call('GET', `/${item.id}`)).json()).item.tags).toEqual([]);
  expect((await call('POST', '/pins', { id: item.id, userId: other.id })).status).toBe(400);
  expect((await call('POST', '/pins', { id: foreign.id })).status).toBe(404);
  expect(
    (await call('POST', '/pins', { id: item.id }, { ...headers, Origin: 'https://evil.example' }))
      .status,
  ).toBe(403);
  expect((await call('POST', '/pins', { id: item.id })).status).toBe(200);
  expect(
    (await (await call('GET', '/pins')).json()).items.map((entry: { id: string }) => entry.id),
  ).toEqual([item.id]);
  expect((await call('PUT', '/pins', { ids: [foreign.id] })).status).toBe(409);
  expect((await call('PUT', '/pins', { ids: [item.id] })).status).toBe(200);
  expect((await call('DELETE', '/pins', { id: item.id })).status).toBe(200);
  expect((await (await call('GET', '/pins')).json()).items).toEqual([]);
  expect(
    (
      await call(
        'POST',
        '',
        { name: 'x', kind: 'doc', parentId: null },
        { ...headers, Origin: 'https://evil.example' },
      )
    ).status,
  ).toBe(403);
  for (const denied of [
    undefined,
    auth.createSession(null).token,
    auth.createSession(admin.id).token,
  ]) {
    const supplied = { ...headers, Cookie: denied ? `${COOKIE_NAME}=${denied}` : '' };
    for (const [method, suffix, body] of [
      ['GET', '', undefined],
      ['GET', `/${item.id}`, undefined],
      ['POST', '', { name: 'x', kind: 'doc', parentId: null }],
      ['PATCH', `/${item.id}`, { name: 'x' }],
      ['GET', '/pins', undefined],
      ['POST', '/pins', { id: item.id }],
      ['PUT', '/pins', { ids: [] }],
      ['DELETE', '/pins', { id: item.id }],
      ['GET', '/tags', undefined],
      ['POST', `/${item.id}/tags`, { tag: 'denied' }],
    ] as const)
      expect((await call(method, suffix, body, supplied)).status).toBe(
        !denied || !auth.session(denied)?.user_id ? 401 : 403,
      );
  }
  auth.database.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(user.id);
  expect((await call('GET')).status).toBe(401);
  expect((await call('PATCH', `/${item.id}`, { name: 'x' })).status).toBe(401);
});
