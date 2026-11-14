import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import type { ItemKind } from '../../shared/workspace.ts';
import { AuthStore } from '../auth/store.ts';
import { OwnershipTransfer } from '../auth/ownership.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { HistoryStore } from '../history/store.ts';
import { SQLiteSyncStorage } from '../sync/store.ts';
import { DocumentStore } from './documents.ts';
import { SheetStore } from './sheets.ts';
import {
  MAX_SPACE_EXPIRY_CANDIDATES,
  MAX_SPACE_EXPIRY_ROOTS,
  SpaceExpiry,
} from './space-expiry.ts';
import { SpaceLifecycleStore } from './space-lifecycle.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { MAX_SPACE_ITEMS } from './space-structure.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';
import { DAY_MS, TRASH_RETENTION_MS, TrashStore, startTrashCleanup } from './trash.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const close of cleanup.splice(0).reverse()) await close();
});

function fixture(path = ':memory:') {
  const db = new DatabaseSync(path);
  cleanup.push(() => db.close());
  // This 30-day interval crosses the autumn DST change. Retention is elapsed UTC.
  let now = Date.UTC(2026, 9, 15, 12);
  const auth = new AuthStore(db, () => now);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  new DocumentStore(workspace);
  new SheetStore(workspace);
  new CollaborationGenerations(workspace);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const other = auth.createUser('Other owner');
  const operator = auth.createUser('Operator', true);
  const spaces = new SpaceStore(workspace);
  const recovery = new SpaceRecoveryStore(workspace);
  const lifecycle = new SpaceLifecycleStore(workspace);
  const trash = new TrashStore(workspace);
  const expiry = new SpaceExpiry(workspace);
  const root = (name = 'Project', parentId: string | null = null) =>
    spaces.createRoot(owner.id, { name, parentId }).space;
  const child = (spaceId: string, name = 'Page', kind: ItemKind = 'doc', parentId = spaceId) =>
    spaces.createChild(owner.id, spaceId, { name, kind, parentId }).item;
  const file = (name = 'Ordinary', kind: ItemKind = 'doc', parentId: string | null = null) =>
    workspace.create(owner.id, { name, kind, parentId });
  return {
    db,
    auth,
    workspace,
    owner,
    editor,
    other,
    operator,
    spaces,
    recovery,
    lifecycle,
    trash,
    expiry,
    root,
    child,
    file,
    setTime: (time: number) => {
      now = time;
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
const item = (f: Fixture, id: string) =>
  f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(id);
const recoveryRecord = (f: Fixture, id: string) =>
  f.db.prepare('SELECT * FROM workspace_space_trash WHERE item_id=?').get(id);
const assertForeignKeys = (f: Fixture) =>
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

function beforeNextTransaction(f: Fixture, change: () => void) {
  const transaction = f.auth.transaction.bind(f.auth);
  vi.spyOn(f.auth, 'transaction').mockImplementationOnce(<T>(action: () => T): T => {
    change();
    return transaction(action);
  });
}

test.each(['internal', 'space', 'folder'] as const)(
  '%s recovery is allowed one millisecond before its actual 30-day deadline',
  (scope) => {
    const f = fixture();
    const outer = f.file('Container', 'folder');
    const root = f.root('Project', outer.id);
    const doc = f.child(root.id);
    f.child(root.id, 'Nested Sheet', 'sheet', doc.id);
    f.spaces.share(f.owner.id, root.id, f.editor.id, 'editor');
    if (scope === 'internal') f.recovery.trash(f.editor.id, root.id, doc.id);
    else f.trash.trash(f.owner.id, scope === 'space' ? root.id : outer.id);
    const deadline = f.auth.now() + TRASH_RETENTION_MS;
    const listing =
      scope === 'internal' ? f.recovery.list(f.editor.id, root.id) : f.trash.list(f.owner.id);
    expect(listing.items.every((entry) => entry.expiresAt === deadline)).toBe(true);
    f.setTime(deadline - 1);
    expect(f.trash.purgeExpired()).toBe(0);
    if (scope === 'internal')
      expect(f.recovery.restore(f.editor.id, root.id, doc.id).restoredCount).toBe(2);
    else f.trash.restore(f.owner.id, scope === 'space' ? root.id : outer.id);
    expect(f.spaces.get(f.editor.id, root.id, doc.id).item.id).toBe(doc.id);
    assertForeignKeys(f);
  },
);

test.each(['internal', 'space', 'folder'] as const)(
  '%s recovery refuses the exact deadline and cleanup removes only that expired closure',
  (scope) => {
    const f = fixture();
    const outer = f.file('Container', 'folder');
    const root = f.root('Project', outer.id);
    const doc = f.child(root.id);
    const sheet = f.child(root.id, 'Nested Sheet', 'sheet', doc.id);
    const unrelated = f.file('Still live');
    if (scope === 'internal') f.recovery.trash(f.owner.id, root.id, doc.id);
    else {
      f.trash.trash(f.owner.id, scope === 'space' ? root.id : outer.id);
      // Existing retained batches use their original age, including pre-activation data.
      f.db
        .prepare('INSERT INTO workspace_retained_trash_batches VALUES(?)')
        .run(item(f, root.id)!.trash_batch);
    }
    f.advance(TRASH_RETENTION_MS);
    const restore = () =>
      scope === 'internal'
        ? f.recovery.restore(f.owner.id, root.id, doc.id)
        : f.trash.restore(f.owner.id, scope === 'space' ? root.id : outer.id);
    expect(restore).toThrow('30-day recovery period has ended');
    expect(f.trash.purgeExpired()).toBe(scope === 'internal' ? 2 : scope === 'space' ? 3 : 4);
    expect(item(f, doc.id)).toBeUndefined();
    expect(item(f, sheet.id)).toBeUndefined();
    expect(item(f, unrelated.id)?.trashed_at).toBeNull();
    if (scope === 'internal') expect(item(f, root.id)).toBeDefined();
    if (scope !== 'folder') expect(item(f, outer.id)).toBeDefined();
    assertForeignKeys(f);
  },
);

test.each(['internal', 'space'] as const)(
  'an earlier independent nested batch expires without extending or deleting a later %s deletion',
  (later) => {
    const f = fixture();
    const root = f.root();
    const parent = f.child(root.id, 'Parent');
    const early = f.child(root.id, 'Earlier folder', 'folder', parent.id);
    const leaf = f.child(root.id, 'Earlier Sheet', 'sheet', early.id);
    f.recovery.trash(f.owner.id, root.id, early.id);
    const first = recoveryRecord(f, early.id)!;
    f.advance(DAY_MS);
    if (later === 'internal') f.recovery.trash(f.owner.id, root.id, parent.id);
    else f.trash.trash(f.owner.id, root.id);
    const retained = item(f, later === 'internal' ? parent.id : root.id)!;
    expect(recoveryRecord(f, early.id)).toEqual(first);
    f.setTime(Number(first.trashed_at) + TRASH_RETENTION_MS);
    expect(f.trash.purgeExpired()).toBe(2);
    expect(item(f, early.id)).toBeUndefined();
    expect(item(f, leaf.id)).toBeUndefined();
    expect(item(f, retained.id as string)).toEqual(retained);
    if (later === 'internal') f.recovery.restore(f.owner.id, root.id, parent.id);
    else f.trash.restore(f.owner.id, root.id);
    expect(f.spaces.get(f.owner.id, root.id, parent.id).item.id).toBe(parent.id);
    assertForeignKeys(f);
  },
);

test('a separately restored Space survives expiry of its former containing folder and sibling', () => {
  const f = fixture();
  const outer = f.file('Container', 'folder');
  const root = f.root('Keep Project', outer.id);
  const doc = f.child(root.id);
  const sibling = f.file('Deleted sibling', 'doc', outer.id);
  f.trash.trash(f.owner.id, outer.id);
  const deadline = f.auth.now() + TRASH_RETENTION_MS;
  f.advance(DAY_MS);
  expect(f.trash.restore(f.owner.id, root.id).parentId).toBeNull();
  f.setTime(deadline);
  expect(f.trash.purgeExpired()).toBe(2);
  expect(item(f, outer.id)).toBeUndefined();
  expect(item(f, sibling.id)).toBeUndefined();
  expect(f.spaces.get(f.owner.id, root.id, doc.id).item.id).toBe(doc.id);
  assertForeignKeys(f);
});

test.each([false, true])(
  'a selected outer deletion cannot purge a later restore (retrash=%s)',
  (retrash) => {
    const f = fixture();
    const root = f.root();
    const doc = f.child(root.id);
    f.trash.trash(f.owner.id, root.id);
    const original = item(f, root.id)!;
    const expiredAt = f.auth.now() + TRASH_RETENTION_MS;
    f.setTime(expiredAt);
    beforeNextTransaction(f, () => {
      // Deliberately equal timestamps isolate batch identity from the clock check.
      // This simulates a stale selection spanning a restore and a clock rollback.
      f.setTime(Number(original.trashed_at));
      f.trash.restore(f.owner.id, root.id);
      if (retrash) f.trash.trash(f.owner.id, root.id);
      f.setTime(expiredAt);
    });
    expect(f.expiry.purgeExpired()).toEqual({ count: 0, failed: 0 });
    expect(item(f, doc.id)).toBeDefined();
    const current = item(f, root.id)!;
    expect(current.trash_batch).not.toBe(original.trash_batch);
    if (retrash) {
      expect(current.trashed_at).toBe(original.trashed_at);
      expect(f.expiry.purgeExpired()).toEqual({ count: 2, failed: 0 });
    } else {
      expect(current.trashed_at).toBeNull();
      expect(f.spaces.get(f.owner.id, root.id, doc.id).item.id).toBe(doc.id);
    }
    assertForeignKeys(f);
  },
);

test('an internal restore/retrash after selection preserves the fresh batch and deadline', () => {
  const f = fixture();
  const root = f.root();
  const doc = f.child(root.id);
  f.recovery.trash(f.owner.id, root.id, doc.id);
  const original = recoveryRecord(f, doc.id)!;
  const expiredAt = f.auth.now() + TRASH_RETENTION_MS;
  f.setTime(expiredAt);
  beforeNextTransaction(f, () => {
    f.setTime(expiredAt - 1);
    f.recovery.restore(f.owner.id, root.id, doc.id);
    f.recovery.trash(f.owner.id, root.id, doc.id);
    f.setTime(expiredAt);
  });
  expect(f.expiry.purgeExpired()).toEqual({ count: 0, failed: 0 });
  expect(recoveryRecord(f, doc.id)!.trash_batch).not.toBe(original.trash_batch);
  expect(f.recovery.list(f.owner.id, root.id).items[0].expiresAt).toBe(
    expiredAt - 1 + TRASH_RETENTION_MS,
  );
});

test('handover invalidates a selected owner identity without resetting outer or internal deletion age', () => {
  const f = fixture();
  const root = f.root();
  const doc = f.child(root.id);
  f.recovery.trash(f.owner.id, root.id, doc.id);
  const internal = recoveryRecord(f, doc.id);
  f.advance(DAY_MS);
  f.trash.trash(f.owner.id, root.id);
  const original = item(f, root.id)!;
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  const transfer = new OwnershipTransfer(f.auth);
  const preview = transfer.preview(f.operator.id, f.owner.id);
  f.advance(TRASH_RETENTION_MS);
  beforeNextTransaction(f, () => {
    transfer.transfer(f.operator.id, f.owner.id, f.other.id, preview.confirmation);
  });
  expect(f.expiry.purgeExpired()).toEqual({ count: 0, failed: 0 });
  expect(item(f, root.id)).toMatchObject({
    owner_id: f.other.id,
    trashed_at: original.trashed_at,
    trash_batch: original.trash_batch,
  });
  expect(item(f, doc.id)?.owner_id).toBe(f.other.id);
  expect(recoveryRecord(f, doc.id)).toEqual(internal);
  expect(() => f.trash.restore(f.other.id, root.id)).toThrow('30-day recovery period');
  expect(f.expiry.purgeExpired()).toEqual({ count: 2, failed: 0 });
  assertForeignKeys(f);
});

test('disabled owners cannot restore but their expired Space content still receives bounded cleanup', () => {
  const f = fixture();
  const root = f.root();
  f.child(root.id);
  f.trash.trash(f.owner.id, root.id);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.trash.restore(f.owner.id, root.id)).toThrow('Sign in');
  f.advance(TRASH_RETENTION_MS);
  expect(f.trash.purgeExpired()).toBe(2);
  expect(item(f, root.id)).toBeUndefined();
  expect(f.db.prepare('SELECT disabled FROM auth_users WHERE id=?').get(f.owner.id)?.disabled).toBe(
    1,
  );
  assertForeignKeys(f);
});

test('disabled exposure retains a maximum hidden Space and its containing folder without starving ordinary expiry', () => {
  const f = fixture();
  const outer = f.file('Hidden container', 'folder');
  const root = f.root('Hidden Project', outer.id);
  const internal = f.child(root.id, 'Hidden deleted subtree', 'folder');
  f.recovery.trash(f.owner.id, root.id, internal.id);
  const record = recoveryRecord(f, internal.id)!;
  f.db
    .prepare(
      `WITH RECURSIVE sequence(n) AS (
    SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<?
  ) INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position,trashed_at,trash_batch)
    SELECT 'hidden-expiry-'||n,?,?,'doc','Hidden',0,0,?,n,?,? FROM sequence`,
    )
    .run(
      MAX_SPACE_ITEMS - 1,
      f.owner.id,
      internal.id,
      root.id,
      record.trashed_at,
      record.trash_batch,
    );
  // Model a retained complete group, without relying on the retired exemption table.
  f.db
    .prepare('UPDATE workspace_items SET trashed_at=?,trash_batch=? WHERE id IN (?,?)')
    .run(f.auth.now(), 'outer-group', outer.id, root.id);
  const ordinary = f.file('Unrelated ordinary deletion');
  f.trash.trash(f.owner.id, ordinary.id);
  f.advance(TRASH_RETENTION_MS);
  const hiddenWorkspace = new WorkspaceStore(f.auth, { spacesEnabled: false });
  expect(new TrashStore(hiddenWorkspace).purgeExpired()).toBe(1);
  expect(item(f, ordinary.id)).toBeUndefined();
  expect(item(f, outer.id)).toBeDefined();
  expect(item(f, root.id)).toBeDefined();
  expect(
    f.db.prepare('SELECT count(*) AS n FROM workspace_items WHERE space_id=?').get(root.id)?.n,
  ).toBe(MAX_SPACE_ITEMS);
  expect(recoveryRecord(f, internal.id)).toEqual(record);
  assertForeignKeys(f);
});

test.each(['foreign-owner', 'missing-membership', 'batch-mismatch', 'cycle', 'oversized'] as const)(
  'a %s recovery tree is retained atomically while unrelated Space and ordinary cleanup progresses',
  (malformation) => {
    const f = fixture();
    const bad = f.root('Secret malformed Space');
    const parent = f.child(bad.id, 'Secret parent');
    const leaf = f.child(bad.id, 'Secret leaf', 'sheet', parent.id);
    f.trash.trash(f.owner.id, bad.id);
    if (malformation === 'foreign-owner')
      f.db.prepare('UPDATE workspace_items SET owner_id=? WHERE id=?').run(f.other.id, leaf.id);
    if (malformation === 'missing-membership')
      f.db
        .prepare('UPDATE workspace_items SET space_id=NULL,space_position=NULL WHERE id=?')
        .run(leaf.id);
    if (malformation === 'batch-mismatch')
      f.db.prepare("UPDATE workspace_items SET trash_batch='unexpected' WHERE id=?").run(leaf.id);
    if (malformation === 'cycle')
      f.db.prepare('UPDATE workspace_items SET parent_id=? WHERE id=?').run(leaf.id, parent.id);
    if (malformation === 'oversized')
      f.db
        .prepare(
          `WITH RECURSIVE sequence(n) AS (
        SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<?
      ) INSERT INTO workspace_items
        (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
        SELECT 'oversized-expiry-'||n,?,?,'doc','Kept',0,0,?,n FROM sequence`,
        )
        .run(MAX_SPACE_ITEMS, f.owner.id, bad.id, bad.id);
    const retained = () =>
      f.db
        .prepare('SELECT * FROM workspace_items WHERE id=? OR space_id=? OR id=? ORDER BY id')
        .all(bad.id, bad.id, leaf.id);
    const before = retained();
    const good = f.root('Healthy Space');
    const goodDoc = f.child(good.id);
    f.trash.trash(f.owner.id, good.id);
    const ordinary = f.file('Unrelated ordinary');
    f.trash.trash(f.owner.id, ordinary.id);
    f.advance(TRASH_RETENTION_MS);
    expect(() => f.trash.purgeExpired()).toThrow('invalid Space groups');
    expect(retained()).toEqual(before);
    expect(item(f, good.id)).toBeUndefined();
    expect(item(f, goodDoc.id)).toBeUndefined();
    expect(item(f, ordinary.id)).toBeUndefined();
    assertForeignKeys(f);
  },
);

test('a failed root deletion rolls back native/history cascades, then native purge retries across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-space-expiry-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite');
  const f = fixture(path);
  const root = f.root();
  const doc = f.child(root.id, 'Secret Doc');
  const sheet = f.child(root.id, 'Secret Sheet', 'sheet', doc.id);
  const unrelated = f.file('Keep native');
  let collaboration = new CollaborationStore(f.workspace, path);
  let history = new HistoryStore(f.workspace, collaboration);
  cleanup.push(async () => {
    await history.close();
    await collaboration.close();
  });
  const session = f.auth.createSession(f.owner.id);
  const custom = (id: string) => ({
    sessionHash: session.session.token_hash,
    ...(id === unrelated.id ? {} : { spaceId: root.id, spaceItem: id }),
  });
  for (const current of [doc, sheet, unrelated])
    await collaboration.prepare(f.owner.id, current.id, custom(current.id));
  const docSnapshot = (await collaboration.load(f.owner.id, doc.id, custom(doc.id))).snapshot;
  const sheetSnapshot = (await collaboration.load(f.owner.id, sheet.id, custom(sheet.id))).snapshot;
  f.db
    .prepare('INSERT OR REPLACE INTO doc_snapshots VALUES(?,?,1,?)')
    .run(doc.id, JSON.stringify(docSnapshot), randomUUID());
  f.db
    .prepare('INSERT OR REPLACE INTO sheet_snapshots VALUES(?,?,1,?)')
    .run(sheet.id, JSON.stringify(sheetSnapshot), randomUUID());
  f.db
    .prepare('INSERT INTO doc_images VALUES(?,?,?,?)')
    .run(doc.id, 'a'.repeat(64), 'image/png', Buffer.from('opaque retained image bytes'));
  const tables = [
    'workspace_items',
    'workspace_space_trash',
    'doc_snapshots',
    'sheet_snapshots',
    'doc_images',
    'history_checkpoints',
    'history_progress',
    'spinel_live_units',
    'spinel_restore_jobs',
    'collaboration_purge',
    'spinel_sync_units',
  ];
  const state = () =>
    tables.map((table) => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  expect(f.db.prepare('SELECT count(*) AS n FROM history_checkpoints').get()?.n).toBe(3);
  f.trash.trash(f.owner.id, root.id);
  f.advance(TRASH_RETENTION_MS);
  f.db.exec(`CREATE TRIGGER fail_expiry_root BEFORE DELETE ON workspace_items
    WHEN OLD.kind='space' BEGIN SELECT RAISE(ABORT,'Secret Doc SQL failure'); END`);
  const before = state();
  expect(() => f.trash.purgeExpired()).toThrow('invalid Space groups');
  expect(state()).toEqual(before);
  f.db.exec('DROP TRIGGER fail_expiry_root');
  expect(f.trash.purgeExpired()).toBe(3);
  for (const table of [
    'doc_snapshots',
    'sheet_snapshots',
    'doc_images',
    'history_checkpoints',
    'history_progress',
  ]) {
    expect(
      f.db.prepare(`SELECT 1 FROM ${table} WHERE item_id IN (?,?)`).all(doc.id, sheet.id),
      table,
    ).toEqual([]);
  }
  const units = () => f.db.prepare('SELECT unit_id FROM spinel_sync_units ORDER BY unit_id').all();
  expect(units()).toHaveLength(3);
  const remove = vi.spyOn(SQLiteSyncStorage.prototype, 'remove').mockImplementationOnce(() => {
    throw new Error('interrupted native purge');
  });
  await expect(collaboration.purgeDeleted()).rejects.toThrow('interrupted native purge');
  expect(f.db.prepare('SELECT count(*) AS n FROM collaboration_purge').get()?.n).toBe(2);
  remove.mockRestore();
  await history.close();
  await collaboration.close();
  collaboration = new CollaborationStore(f.workspace, path);
  history = new HistoryStore(f.workspace, collaboration);
  await collaboration.purgeDeleted();
  expect(units()).toEqual([{ unit_id: unrelated.id }]);
  expect(f.db.prepare('SELECT * FROM collaboration_purge').all()).toEqual([]);
  expect(item(f, unrelated.id)).toBeDefined();
  assertForeignKeys(f);
}, 20_000);

test('bounded sweeps progress past a malformed first candidate and revisit it without changing its age', () => {
  const f = fixture();
  // Test the row budget independently of host speed; runtime yielding has its own case.
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const roots = Array.from({ length: MAX_SPACE_EXPIRY_ROOTS + 3 }, (_, n) =>
    f.root(`Project ${n}`),
  );
  for (const root of roots) f.trash.trash(f.owner.id, root.id);
  roots.sort((a, b) => a.id.localeCompare(b.id));
  f.db.prepare('UPDATE workspace_items SET trash_batch=NULL WHERE id=?').run(roots[0].id);
  const bad = item(f, roots[0].id);
  f.advance(TRASH_RETENTION_MS);
  expect(f.expiry.purgeExpired()).toEqual({ count: MAX_SPACE_EXPIRY_ROOTS - 1, failed: 1 });
  expect(item(f, roots[MAX_SPACE_EXPIRY_ROOTS].id)).toBeDefined();
  expect(f.expiry.purgeExpired()).toEqual({ count: 3, failed: 0 });
  expect(f.db.prepare('SELECT id FROM workspace_items').all()).toEqual([{ id: roots[0].id }]);
  expect(f.expiry.purgeExpired()).toEqual({ count: 0, failed: 1 });
  expect(item(f, roots[0].id)).toEqual(bad);
});

test('elapsed runtime yields only between complete transactions and resumes the remaining candidates', () => {
  const f = fixture();
  const roots = [f.root('First'), f.root('Second'), f.root('Third')];
  for (const root of roots) f.trash.trash(f.owner.id, root.id);
  f.advance(TRASH_RETENTION_MS);
  const elapsed = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(1_000);
  expect(f.expiry.purgeExpired()).toEqual({ count: 1, failed: 0 });
  expect(f.db.prepare('SELECT count(*) AS n FROM workspace_items').get()?.n).toBe(2);
  elapsed.mockReturnValue(0);
  expect(f.expiry.purgeExpired()).toEqual({ count: 2, failed: 0 });
  assertForeignKeys(f);
});

test('candidate discovery scans an indexed bounded page even when the first Spaces are all live', () => {
  const f = fixture();
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const insert = f.db.prepare(`INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,NULL,?,'Fixture',0,0)`);
  f.auth.transaction(() => {
    for (let index = 0; index < MAX_SPACE_EXPIRY_CANDIDATES; index++) {
      insert.run('live-space-' + String(index).padStart(4, '0'), f.owner.id, 'space');
      insert.run('ordinary-' + index, f.owner.id, 'doc');
    }
    insert.run('zz-expired-space', f.owner.id, 'space');
    f.db
      .prepare(
        "UPDATE workspace_items SET trashed_at=0,trash_batch='old' WHERE id='zz-expired-space'",
      )
      .run();
  });
  const query = `SELECT id,owner_id,trashed_at,trash_batch FROM workspace_items INDEXED BY workspace_space_expiry_roots
    WHERE kind='space' AND space_id IS NULL AND space_position IS NULL AND id>?
    ORDER BY id LIMIT ?`;
  const plan = f.db.prepare('EXPLAIN QUERY PLAN ' + query).all('', MAX_SPACE_EXPIRY_CANDIDATES);
  expect(plan.map((row) => row.detail).join(' ')).toContain(
    'USING INDEX workspace_space_expiry_roots',
  );
  expect(plan.map((row) => row.detail).join(' ')).not.toContain('TEMP B-TREE');
  expect(f.expiry.purgeExpired()).toEqual({ count: 0, failed: 0 });
  expect(item(f, 'zz-expired-space')).toBeDefined();
  expect(f.expiry.purgeExpired()).toEqual({ count: 1, failed: 0 });
  expect(f.db.prepare("SELECT count(*) AS n FROM workspace_items WHERE kind='doc'").get()?.n).toBe(
    MAX_SPACE_EXPIRY_CANDIDATES,
  );
});

test('startup and daily cleanup share Space expiry, stop cleanly, and report only status on failure', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const f = fixture();
  const expired = f.root('Startup expired');
  f.trash.trash(f.owner.id, expired.id);
  f.advance(TRASH_RETENTION_MS);
  const finish = vi.fn();
  const spaceFinish = vi.fn();
  const stop = startTrashCleanup(
    f.trash,
    () => finish,
    () => spaceFinish,
  );
  cleanup.push(stop);
  expect(item(f, expired.id)).toBeUndefined();
  expect(finish).toHaveBeenLastCalledWith(true);
  expect(spaceFinish).toHaveBeenLastCalledWith(true);
  const daily = f.root('Daily expired');
  f.trash.trash(f.owner.id, daily.id);
  f.advance(TRASH_RETENTION_MS);
  vi.advanceTimersByTime(DAY_MS - 1);
  expect(item(f, daily.id)).toBeDefined();
  vi.advanceTimersByTime(1);
  expect(item(f, daily.id)).toBeUndefined();
  const privateName = 'Do not log this document or SQL content';
  const failed = f.root(privateName);
  f.trash.trash(f.owner.id, failed.id);
  f.advance(TRASH_RETENTION_MS);
  f.db.exec(`CREATE TRIGGER private_expiry_error BEFORE DELETE ON workspace_items
    WHEN OLD.kind='space' BEGIN SELECT RAISE(ABORT,'${privateName}'); END`);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.advanceTimersByTime(DAY_MS);
  expect(finish).toHaveBeenLastCalledWith(false);
  expect(spaceFinish).toHaveBeenLastCalledWith(false);
  expect(log.mock.calls).toEqual([
    ['Trash cleanup failed; retained items will be retried on the next daily run.'],
  ]);
  expect(JSON.stringify(log.mock.calls)).not.toContain(privateName);
  expect(JSON.stringify(log.mock.calls)).not.toContain(failed.id);
  stop();
  f.db.exec('DROP TRIGGER private_expiry_error');
  vi.advanceTimersByTime(DAY_MS);
  expect(item(f, failed.id)).toBeDefined();
});
