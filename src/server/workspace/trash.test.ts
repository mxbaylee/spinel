import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import sharp from 'sharp';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { DocumentStore } from './documents.ts';
import { SheetStore } from './sheets.ts';
import { DAY_MS, TRASH_RETENTION_MS, TrashStore, startTrashCleanup } from './trash.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close());
  vi.useRealTimers();
});
function fixture() {
  let now = Date.UTC(2026, 9, 17);
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db, () => now),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner'),
    other = auth.createUser('Collaborator'),
    admin = auth.createUser('Operator', true);
  const trash = new TrashStore(workspace),
    docs = new DocumentStore(workspace),
    sheets = new SheetStore(workspace);
  const create = (name: string, kind = 'folder', parentId: string | null = null) =>
    workspace.create(owner.id, { name, kind, parentId });
  return {
    db,
    auth,
    workspace,
    trash,
    docs,
    sheets,
    owner,
    other,
    admin,
    create,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test('soft deletion hides an entire shared subtree and preserves native snapshots, images and grants', async () => {
  const f = fixture(),
    root = f.create('Root'),
    sub = f.create('Nested', 'folder', root.id);
  const doc = f.create('Doc', 'doc', sub.id),
    sheet = f.create('Sheet', 'sheet', sub.id);
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#e4a' } })
    .png()
    .toBuffer();
  const image = await f.docs.upload(f.owner.id, doc.id, bytes, 'image/png');
  const docData = {
    id: doc.id,
    body: { dataStream: 'Keep this\r\n' },
    drawings: { image: { source: image.url } },
  };
  const sheetData = {
    id: sheet.id,
    name: 'Budget',
    sheetOrder: ['a'],
    sheets: { a: { id: 'a', cellData: { 0: { 0: { v: 42 } } } } },
  };
  f.docs.save(f.owner.id, doc.id, { snapshot: docData, revision: 0, writeId: randomUUID() });
  f.sheets.save(f.owner.id, sheet.id, { snapshot: sheetData, revision: 0, writeId: randomUUID() });
  f.workspace.share(f.owner.id, root.id, f.other.id, 'editor');
  expect(f.trash.trash(f.owner.id, root.id).count).toBe(4);
  expect(f.workspace.list(f.owner.id)).toEqual([]);
  for (const user of [f.owner.id, f.other.id]) {
    for (const item of [root, sub, doc, sheet])
      expect(() => f.workspace.get(user, item.id)).toThrow('not available');
    expect(() => f.docs.image(user, doc.id, image.id)).toThrow('not available');
    expect(() =>
      f.docs.save(user, doc.id, { snapshot: docData, revision: 1, writeId: randomUUID() }),
    ).toThrow('not available');
  }
  f.trash.restore(f.owner.id, root.id);
  expect(f.docs.load(f.other.id, doc.id)).toMatchObject({
    snapshot: docData,
    revision: 1,
    access: 'editor',
  });
  expect(f.sheets.load(f.other.id, sheet.id).snapshot).toEqual(sheetData);
  expect(Buffer.from(f.docs.image(f.other.id, doc.id, image.id).data)).toEqual(bytes);
  expect(f.workspace.get(f.owner.id, doc.id).parentId).toBe(sub.id);
  expect(f.trash.list(f.owner.id).items).toEqual([]);
});
test('restoring a parent never resurrects an earlier deletion; restoring one child leaves siblings trashed', () => {
  const f = fixture(),
    root = f.create('Root'),
    old = f.create('Earlier', 'doc', root.id);
  const sub = f.create('Sub', 'folder', root.id),
    leaf = f.create('Leaf', 'doc', sub.id),
    sibling = f.create('Sibling', 'doc', root.id);
  f.trash.trash(f.owner.id, old.id);
  f.advance(1000);
  f.trash.trash(f.owner.id, root.id);
  // Decision #30: an individual subtree recovers at root while its parent is still trashed.
  expect(f.trash.restore(f.owner.id, sub.id).parentId).toBeNull();
  expect(f.workspace.get(f.owner.id, leaf.id).parentId).toBe(sub.id);
  expect(() => f.workspace.get(f.owner.id, sibling.id)).toThrow('not available');
  f.trash.restore(f.owner.id, root.id);
  expect(f.workspace.get(f.owner.id, sibling.id).parentId).toBe(root.id);
  expect(f.trash.list(f.owner.id).items.map((item) => item.id)).toEqual([old.id]);
  expect(f.trash.restore(f.owner.id, old.id).parentId).toBe(root.id);
});
test('only owners can trash, inspect or restore their own items; trashed parents reject new children and moves', () => {
  const f = fixture(),
    root = f.create('Root'),
    doc = f.create('Doc', 'doc', root.id),
    other = f.create('Other');
  f.workspace.share(f.owner.id, root.id, f.other.id, 'editor');
  expect(() => f.trash.trash(f.other.id, doc.id)).toThrow('Only the owner');
  expect(() => f.trash.trash(f.admin.id, doc.id)).toThrow('everyday');
  f.trash.trash(f.owner.id, root.id);
  expect(f.trash.list(f.other.id).items).toEqual([]);
  expect(() => f.trash.restore(f.other.id, root.id)).toThrow('not in your trash');
  expect(() => f.trash.list(f.admin.id)).toThrow('everyday');
  expect(() => f.create('Bad', 'doc', root.id)).toThrow('not available');
  expect(() => f.workspace.update(f.owner.id, other.id, { parentId: root.id })).toThrow(
    'not available',
  );
  expect(() => f.workspace.share(f.owner.id, root.id, f.other.id, null)).toThrow('not available');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.trash.restore(f.owner.id, root.id)).toThrow('Sign in');
});
test('empty trash binds confirmation to its exact set, even same-count replacement; purge cascades content only', () => {
  const f = fixture(),
    root = f.create('Root'),
    doc = f.create('Doc', 'doc', root.id),
    live = f.create('Live', 'doc');
  f.docs.save(f.owner.id, doc.id, {
    snapshot: { id: doc.id, body: { dataStream: 'Saved\r\n' } },
    revision: 0,
    writeId: randomUUID(),
  });
  f.db
    .prepare('INSERT INTO doc_images VALUES(?,?,?,?)')
    .run(doc.id, 'image', 'image/png', new Uint8Array([1, 2]));
  f.workspace.share(f.owner.id, root.id, f.other.id, 'viewer');
  f.trash.trash(f.owner.id, root.id);
  const before = f.trash.list(f.owner.id);
  f.trash.restore(f.owner.id, root.id);
  f.trash.trash(f.owner.id, root.id);
  expect(f.trash.list(f.owner.id).items).toHaveLength(before.items.length);
  expect(() => f.trash.empty(f.owner.id, before.version)).toThrow('trash changed');
  expect(f.trash.empty(f.owner.id, f.trash.list(f.owner.id).version)).toEqual({ count: 2 });
  for (const table of ['doc_snapshots', 'doc_images', 'workspace_grants'])
    expect(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(0);
  expect(f.workspace.get(f.owner.id, live.id).name).toBe('Live');
});
test('30 elapsed UTC days is the boundary, expired descendants purge before parents and live content survives', () => {
  const f = fixture(),
    root = f.create('Root'),
    child = f.create('Child', 'doc', root.id),
    live = f.create('Live');
  // Exercise the future history cascade contract without introducing a history implementation.
  f.db.exec(
    'CREATE TABLE history_fixture(item_id TEXT REFERENCES workspace_items(id) ON DELETE CASCADE)',
  );
  f.db.prepare('INSERT INTO history_fixture VALUES(?)').run(child.id);
  f.trash.trash(f.owner.id, child.id);
  f.advance(DAY_MS);
  f.trash.trash(f.owner.id, root.id);
  f.advance(TRASH_RETENTION_MS - DAY_MS - 1);
  expect(f.trash.purgeExpired()).toBe(0);
  f.advance(1);
  expect(() => f.trash.restore(f.owner.id, child.id)).toThrow('recovery period');
  expect(f.trash.purgeExpired()).toBe(1);
  expect(f.db.prepare('SELECT count(*) AS n FROM history_fixture').get()!.n).toBe(0);
  expect(f.trash.list(f.owner.id).items.map((item) => item.id)).toEqual([root.id]);
  f.advance(DAY_MS);
  expect(f.trash.purgeExpired()).toBe(1);
  expect(f.workspace.list(f.owner.id)).toEqual([live]);
});
test('startup and daily cleanup remove expired data; stopping the job prevents later runs', () => {
  vi.useFakeTimers();
  const f = fixture(),
    old = f.create('Old');
  f.trash.trash(f.owner.id, old.id);
  f.advance(TRASH_RETENTION_MS);
  const stop = startTrashCleanup(f.trash);
  cleanup.push(stop);
  expect(f.trash.list(f.owner.id).items).toEqual([]);
  const next = f.create('Next');
  f.trash.trash(f.owner.id, next.id);
  f.advance(TRASH_RETENTION_MS);
  vi.advanceTimersByTime(DAY_MS - 1);
  expect(f.trash.list(f.owner.id).items).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(f.trash.list(f.owner.id).items).toEqual([]);
  stop();
  const kept = f.create('Stopped');
  f.trash.trash(f.owner.id, kept.id);
  f.advance(TRASH_RETENTION_MS);
  vi.advanceTimersByTime(DAY_MS);
  expect(f.trash.list(f.owner.id).items).toHaveLength(1);
});
test('additive migration preserves the original workspace schema and is repeatable', () => {
  const db = new DatabaseSync(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    user = auth.createUser('Existing');
  db.exec(`CREATE TABLE workspace_items (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES workspace_items(id) ON DELETE RESTRICT, kind TEXT NOT NULL,
    name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT`);
  db.prepare('INSERT INTO workspace_items VALUES(?,?,NULL,?,?,?,?)').run(
    'legacy',
    user.id,
    'doc',
    'Kept',
    1,
    1,
  );
  const first = new WorkspaceStore(auth),
    second = new WorkspaceStore(auth);
  expect(first.get(user.id, 'legacy')).toEqual(second.get(user.id, 'legacy'));
  const trash = new TrashStore(second);
  trash.trash(user.id, 'legacy');
  expect(trash.restore(user.id, 'legacy').name).toBe('Kept');
});
