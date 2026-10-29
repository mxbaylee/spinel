import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, expect, test } from 'vitest';
import type { DiagnosticContext, DiagnosticEvent } from '@spinel/diagnostics';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceSearch } from './search.ts';
import { TrashStore } from './trash.ts';
import { DocumentStore } from './documents.ts';
import { workspaceRoutes } from './routes.ts';
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('PRAGMA foreign_keys=ON');
  let time = Date.UTC(2026, 9, 18, 12);
  const auth = new AuthStore(db, () => time),
    store = new WorkspaceStore(auth),
    search = new WorkspaceSearch(store),
    trash = new TrashStore(store);
  const owner = auth.createUser('Owner'),
    viewer = auth.createUser('Viewer'),
    other = auth.createUser('Other'),
    admin = auth.createUser('Operator', true);
  const secret = store.create(owner.id, {
    name: 'Secret ancestor',
    kind: 'folder',
    parentId: null,
  });
  const sheet = store.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: secret.id });
  const mine = store.create(viewer.id, {
    name: 'Personal planning',
    kind: 'folder',
    parentId: null,
  });
  store.share(owner.id, sheet.id, viewer.id, 'viewer');
  return {
    db,
    auth,
    store,
    search,
    trash,
    owner,
    viewer,
    other,
    admin,
    secret,
    sheet,
    mine,
    tick: (n: number) => {
      time += n;
    },
  };
}

test('search observations preserve authorized results and have one outcome before response delivery', async () => {
  const f = fixture();
  const observations: { event: DiagnosticEvent; context: DiagnosticContext; actorId?: string }[] =
    [];
  let brokenObserver = false;
  let rejectResponse = false;
  const app = express();
  app.use((_request, response, next) => {
    const json = response.json;
    response.json = (body: unknown) => {
      if (rejectResponse) {
        rejectResponse = false;
        throw new Error('Injected response failure after catalog success.');
      }
      return json.call(response, body);
    };
    next();
  });
  app.use(
    '/api/items',
    workspaceRoutes(
      f.auth,
      'https://spinel.example',
      f.store,
      undefined,
      undefined,
      (event, context, actorId) => {
        if (brokenObserver) throw new Error('Injected observer failure.');
        observations.push({ event, context, actorId });
      },
    ),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/items/search`;
  const cookie = `${COOKIE_NAME}=${f.auth.createSession(f.viewer.id).token}`;
  const search = (query: string, session = cookie) =>
    fetch(base + query, { headers: { Cookie: session } });
  const results = () => observations.filter(({ event }) => event.name === 'operation.result');
  const outcomes = () =>
    observations.flatMap(({ event }) =>
      event.name === 'operation.result' ? [event.details.outcome] : [],
    );
  try {
    const response = await search('?q=Budget');
    expect(response.status).toBe(200);
    expect((await response.json()).items.map((item: { id: string }) => item.id)).toEqual([
      f.sheet.id,
    ]);
    expect(results()).toMatchObject([
      {
        event: { details: { operation: 'search', outcome: 'success' } },
        context: { component: 'server', route: '/api/items' },
        actorId: f.viewer.id,
      },
    ]);
    expect((await search('?owner=invalid')).status).toBe(400);
    expect(outcomes()).toEqual(['success', 'failure']);
    expect((await search('?q=Budget', '')).status).toBe(401);
    expect(results()).toHaveLength(2);
    rejectResponse = true;
    expect((await search('?q=Budget')).status).toBe(400);
    // Catalog timing ends before response delivery, so a send failure is not a
    // second, contradictory catalog-query outcome.
    expect(outcomes()).toEqual(['success', 'failure', 'success']);
    brokenObserver = true;
    const preserved = await search('?q=Budget');
    expect((await preserved.json()).items.map((item: { id: string }) => item.id)).toEqual([
      f.sheet.id,
    ]);
    expect((await search('?owner=invalid')).status).toBe(400);
    expect(f.search.find(f.other.id, { q: 'Budget' })).toEqual([]);
    expect(JSON.stringify(observations)).not.toContain('Budget');
    expect(results()).toHaveLength(3);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});

test('search excludes private ancestors, other users tags and inaccessible exact titles', () => {
  const f = fixture();
  f.store.changeTag(f.owner.id, f.sheet.id, 'owner-secret-tag');
  f.store.changeTag(f.viewer.id, f.sheet.id, 'planning');
  f.store.place(f.viewer.id, f.sheet.id, f.mine.id);
  expect(f.search.find(f.viewer.id, { q: 'Secret ancestor' })).toEqual([]);
  expect(f.search.find(f.viewer.id, { q: 'owner-secret-tag' })).toEqual([]);
  expect(f.search.find(f.other.id, { q: 'Budget' })).toEqual([]);
  expect(f.search.find(f.owner.id, { q: 'secret ancestor budget' }).map((i) => i.id)).toEqual([
    f.sheet.id,
  ]);
  const results = f.search.find(f.viewer.id, {
    q: 'personal planning',
    type: 'sheet',
    owner: 'shared',
    tag: 'planning',
    modified: 'day',
  });
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    id: f.sheet.id,
    parentId: null,
    ownerName: 'Owner',
    tags: ['planning'],
    paths: ['Personal planning'],
  });
  expect(f.store.get(f.owner.id, f.sheet.id).parentId).toBe(f.secret.id);
  expect(f.search.find(f.owner.id, { tag: 'planning' })).toEqual([]);
});
test('current direct and inherited grants, moves, revoke/regrant and trash govern search', () => {
  const f = fixture();
  f.store.share(f.owner.id, f.secret.id, f.viewer.id, 'viewer');
  f.store.place(f.viewer.id, f.secret.id, f.mine.id);
  expect(f.search.find(f.viewer.id, { q: 'Budget' })).toHaveLength(1);
  expect(f.search.find(f.viewer.id, { q: 'personal planning budget' })).toHaveLength(1);
  f.store.share(f.owner.id, f.sheet.id, f.viewer.id, null);
  expect(f.search.find(f.viewer.id, { q: 'Budget' })).toHaveLength(1);
  f.store.update(f.owner.id, f.sheet.id, { parentId: null });
  expect(f.search.find(f.viewer.id, { q: 'Budget' })).toEqual([]);
  f.store.share(f.owner.id, f.sheet.id, f.viewer.id, 'editor');
  f.store.place(f.viewer.id, f.sheet.id, f.mine.id);
  expect(f.search.find(f.viewer.id, { q: 'personal planning budget' })).toHaveLength(1);
  f.store.share(f.owner.id, f.sheet.id, f.viewer.id, null);
  expect(f.search.find(f.viewer.id, { q: 'Budget' })).toEqual([]);
  f.store.share(f.owner.id, f.sheet.id, f.viewer.id, 'viewer');
  expect(f.search.find(f.viewer.id, { q: 'personal planning budget' })).toEqual([]);
  expect(f.search.find(f.viewer.id, { q: 'Budget' })).toHaveLength(1);
  f.trash.trash(f.owner.id, f.sheet.id);
  expect(f.search.find(f.owner.id, { q: 'Budget' })).toEqual([]);
  expect(f.search.find(f.viewer.id, { q: 'Budget' })).toEqual([]);
});
test('search rechecks account state and input instead of trusting a cached catalog', () => {
  const f = fixture();
  expect(f.search.find(f.viewer.id, { q: 'Budget' })).toHaveLength(1);
  for (const who of [f.admin.id, 'guest:invalid', 'missing'])
    expect(() => f.search.find(who, {})).toThrow();
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.viewer.id);
  expect(() => f.search.find(f.viewer.id, {})).toThrow();
  expect(() => f.search.find(f.owner.id, { owner: 'other-person' })).toThrow(
    'Invalid search filters.',
  );
  expect(() => f.search.find(f.owner.id, { q: ['a', 'b'] })).toThrow('Invalid search filters.');
  // Slides were never in production; there is no legacy search filter to retain.
  expect(() => f.search.find(f.owner.id, { type: 'slides' })).toThrow('Invalid search filters.');
});
test('modified filters use item timestamps and exclude trashed ancestor anomalies', () => {
  const f = fixture();
  f.tick(86400001);
  expect(f.search.find(f.owner.id, { q: 'Budget', modified: 'day' })).toEqual([]);
  f.store.update(f.owner.id, f.sheet.id, { name: 'Current budget' });
  expect(f.search.find(f.owner.id, { q: 'budget', modified: 'day' })).toHaveLength(1);
  // Even an inconsistent legacy row must pass the normal ancestor access resolver.
  f.db.prepare('UPDATE workspace_items SET trashed_at=? WHERE id=?').run(f.auth.now(), f.secret.id);
  expect(f.search.find(f.owner.id, { q: 'budget' })).toEqual([]);
  expect(f.search.find(f.viewer.id, { q: 'budget' })).toEqual([]);
});

test('search never matches document body text, even for a current reader', () => {
  const f = fixture();
  const doc = f.store.create(f.owner.id, { name: 'Journal', kind: 'doc', parentId: null });
  new DocumentStore(f.store).save(f.owner.id, doc.id, {
    snapshot: { id: doc.id, body: { dataStream: 'Private medical phrase\r\n' } },
    revision: 0,
    writeId: randomUUID(),
  });
  f.store.share(f.owner.id, doc.id, f.viewer.id, 'viewer');
  // SPN-022 limits discovery to titles, visible paths and personal tags.
  for (const reader of [f.owner.id, f.viewer.id]) {
    expect(f.search.find(reader, { q: 'Private medical phrase' })).toEqual([]);
    expect(f.search.find(reader, { q: 'Journal' }).map((item) => item.id)).toEqual([doc.id]);
  }
});
