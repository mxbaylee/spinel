import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { OwnershipTransfer } from '../auth/ownership.ts';
import { WorkspaceStore } from './store.ts';
import { SpaceStore } from './spaces.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { SpaceLifecycleStore } from './space-lifecycle.ts';
import { SpaceExpiry } from './space-expiry.ts';
import { DAY_MS, TrashStore } from './trash.ts';
import { cleanRecoveryHolds, holdRestoredTrash, recoveryHeld } from './recovery-holds.ts';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture(spacesEnabled = true) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  let now = Date.UTC(2026, 9, 22);
  const auth = new AuthStore(db, () => now),
    workspace = new WorkspaceStore(auth, { spacesEnabled });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    other = auth.createUser('Other owner'),
    operator = auth.createUser('Operator', true);
  const trash = new TrashStore(workspace),
    spaces = new SpaceStore(workspace),
    recovery = new SpaceRecoveryStore(workspace),
    lifecycle = new SpaceLifecycleStore(workspace);
  const file = (kind: 'doc' | 'folder' = 'doc', parentId: string | null = null) =>
    workspace.create(owner.id, { kind, parentId, name: 'Retained work' });
  const space = () => spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space;
  const child = (root: string) =>
    spaces.createChild(owner.id, root, { kind: 'doc', parentId: root, name: 'Retained page' }).item;
  const row = (id: string) => db.prepare('SELECT * FROM workspace_items WHERE id=?').get(id);
  const held = (id: string) => recoveryHeld(db, String(row(id)!.trash_batch));
  return {
    db,
    auth,
    workspace,
    owner,
    other,
    operator,
    trash,
    spaces,
    recovery,
    lifecycle,
    file,
    space,
    child,
    row,
    held,
    advance: () => {
      now += 40 * DAY_MS;
    },
  };
}

test.each([false, true])(
  'held ordinary trash stays recoverable beyond its deadline (Spaces enabled: %s)',
  (enabled) => {
    const f = fixture(enabled),
      item = f.file();
    f.trash.trash(f.owner.id, item.id);
    const before = f.row(item.id);
    holdRestoredTrash(f.db);
    holdRestoredTrash(f.db);
    f.advance();
    expect(f.trash.purgeExpired()).toBe(0);
    expect(f.row(item.id)).toEqual(before);
    expect(f.trash.list(f.owner.id).items[0]).toMatchObject({
      heldAfterRecovery: true,
      trashedAt: before!.trashed_at,
    });
    expect(() => f.trash.restore(f.other.id, item.id)).toThrow();
    expect(() => f.trash.restore(f.operator.id, item.id)).toThrow();
    f.trash.restore(f.owner.id, item.id);
    expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual([]);
    f.trash.trash(f.owner.id, item.id);
    expect(f.held(item.id)).toBe(false);
    f.advance();
    expect(f.trash.purgeExpired()).toBe(1);
    expect(f.row(item.id)).toBeUndefined();
  },
);

test.each([false, true])(
  'automatic cleanup retains ancestors of held children and expires unrelated trash (%s)',
  (enabled) => {
    const f = fixture(enabled),
      parent = f.file('folder'),
      child = f.file('doc', parent.id);
    f.trash.trash(f.owner.id, child.id);
    holdRestoredTrash(f.db);
    f.trash.trash(f.owner.id, parent.id);
    const unrelated = f.file();
    f.trash.trash(f.owner.id, unrelated.id);
    f.advance();
    expect(f.trash.purgeExpired()).toBe(1);
    expect(f.row(parent.id)).toBeDefined();
    expect(f.row(child.id)).toBeDefined();
    expect(f.row(unrelated.id)).toBeUndefined();
    // Explicit, exactly confirmed permanent deletion is still available.
    const listing = f.trash.list(f.owner.id);
    expect(() => f.trash.empty(f.owner.id, 'stale')).toThrow();
    expect(f.trash.empty(f.owner.id, listing.version).count).toBe(2);
    expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual([]);
  },
);

test('a non-held expired whole Space cannot destroy a held internal batch', () => {
  const f = fixture(),
    root = f.space(),
    child = f.child(root.id);
  f.recovery.trash(f.owner.id, root.id, child.id);
  holdRestoredTrash(f.db);
  f.lifecycle.trash(f.owner.id, root.id);
  const unrelated = f.space();
  f.child(unrelated.id);
  f.lifecycle.trash(f.owner.id, unrelated.id);
  f.advance();
  const expiry = new SpaceExpiry(f.workspace);
  // Sweep again if the wall-clock budget ended before the second Space.
  const first = expiry.purgeExpired(),
    second = expiry.purgeExpired();
  expect(first.failed + second.failed).toBe(0);
  expect(first.count + second.count).toBe(2);
  expect(f.row(root.id)).toBeDefined();
  expect(f.row(child.id)).toBeDefined();
  expect(f.row(unrelated.id)).toBeUndefined();
  expect(f.trash.list(f.owner.id).items.find((item) => item.id === root.id)).toMatchObject({
    heldAfterRecovery: true,
  });
  f.lifecycle.restore(f.owner.id, root.id);
  expect(f.held(child.id)).toBe(true);
  f.recovery.restore(f.owner.id, root.id, child.id);
  expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual([]);
});

test.each([false, true])(
  'held rows beyond one expiry page cannot starve unrelated cleanup (%s)',
  (enabled) => {
    const f = fixture(enabled);
    f.db
      .prepare(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10001)
    INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at,trashed_at,trash_batch)
    SELECT 'held-'||x,?,NULL,'doc','Retained',0,0,?,'held-batch' FROM n`,
      )
      .run(f.owner.id, f.auth.now());
    holdRestoredTrash(f.db);
    const unrelated = f.file();
    f.trash.trash(f.owner.id, unrelated.id);
    f.advance();
    expect(f.trash.purgeExpired()).toBe(1);
    expect(f.row(unrelated.id)).toBeUndefined();
    expect(f.db.prepare('SELECT count(*) AS n FROM workspace_items').get()!.n).toBe(10001);
  },
);

test('an ordinary expired container remains recoverable while it protects held descendants', () => {
  const f = fixture(),
    parent = f.file('folder'),
    child = f.file('doc', parent.id);
  f.trash.trash(f.owner.id, child.id);
  holdRestoredTrash(f.db);
  f.trash.trash(f.owner.id, parent.id);
  f.advance();
  expect(f.trash.list(f.owner.id).items.find((item) => item.id === parent.id)).toMatchObject({
    heldAfterRecovery: true,
  });
  f.trash.restore(f.owner.id, parent.id);
  expect(f.held(child.id)).toBe(true);
  f.trash.restore(f.owner.id, child.id);
  expect(f.workspace.get(f.owner.id, child.id).parentId).toBe(parent.id);
});

test('explicit whole-Space deletion still removes held content with exact confirmation', () => {
  const f = fixture(),
    root = f.space(),
    child = f.child(root.id);
  f.recovery.trash(f.owner.id, root.id, child.id);
  f.lifecycle.trash(f.owner.id, root.id);
  holdRestoredTrash(f.db);
  f.advance();
  const preview = f.lifecycle.previewDelete(f.owner.id, root.id);
  expect(() => f.lifecycle.delete(f.owner.id, root.id, 'stale')).toThrow();
  expect(f.lifecycle.delete(f.owner.id, root.id, preview.version).count).toBe(2);
  expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual([]);
});

test('whole-Space recovery leaves an earlier held internal batch available for explicit restore', () => {
  const f = fixture(),
    root = f.space(),
    child = f.child(root.id);
  f.recovery.trash(f.owner.id, root.id, child.id);
  f.lifecycle.trash(f.owner.id, root.id);
  holdRestoredTrash(f.db);
  f.advance();
  expect(new SpaceExpiry(f.workspace).purgeExpired()).toEqual({ count: 0, failed: 0 });
  expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toHaveLength(2);
  f.lifecycle.restore(f.owner.id, root.id);
  expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toHaveLength(1);
  expect(f.recovery.list(f.owner.id, root.id).items[0]).toMatchObject({ heldAfterRecovery: true });
  expect(() => f.recovery.restore(f.other.id, root.id, child.id)).toThrow();
  f.recovery.restore(f.owner.id, root.id, child.id);
  expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual([]);
  expect(f.row(child.id)!.trashed_at).toBeNull();
});

test('live Space expiry skips a held batch but removes an independent unheld batch', () => {
  const f = fixture(),
    root = f.space(),
    held = f.child(root.id),
    expired = f.child(root.id);
  f.recovery.trash(f.owner.id, root.id, held.id);
  holdRestoredTrash(f.db);
  f.recovery.trash(f.owner.id, root.id, expired.id);
  f.advance();
  expect(new SpaceExpiry(f.workspace).purgeExpired()).toEqual({ count: 1, failed: 0 });
  expect(f.row(held.id)).toBeDefined();
  expect(f.row(expired.id)).toBeUndefined();
  const preview = f.recovery.previewDelete(f.owner.id, root.id, held.id);
  expect(f.recovery.delete(f.owner.id, root.id, held.id, preview.version).count).toBe(1);
  expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual([]);
});

test('a split batch stays held across owners until the final component is restored', () => {
  const f = fixture(),
    parent = f.file('folder'),
    child = f.file('doc', parent.id);
  f.trash.trash(f.owner.id, parent.id);
  const batch = String(f.row(parent.id)!.trash_batch);
  holdRestoredTrash(f.db);
  // Supervised ownership reconciliation may detach a component without changing
  // its original deletion identity. The hold is global to that identity.
  f.db
    .prepare('UPDATE workspace_items SET parent_id=NULL,owner_id=? WHERE id=?')
    .run(f.other.id, child.id);
  f.advance();
  f.trash.restore(f.owner.id, parent.id);
  expect(recoveryHeld(f.db, batch)).toBe(true);
  f.trash.restore(f.other.id, child.id);
  expect(recoveryHeld(f.db, batch)).toBe(false);
});

test('handover preserves whole and internal holds, including recovery after 30 days', () => {
  const f = fixture(),
    root = f.space(),
    child = f.child(root.id);
  f.recovery.trash(f.owner.id, root.id, child.id);
  f.lifecycle.trash(f.owner.id, root.id);
  holdRestoredTrash(f.db);
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  const transfer = new OwnershipTransfer(f.auth),
    preview = transfer.preview(f.operator.id, f.owner.id);
  transfer.transfer(f.operator.id, f.owner.id, f.other.id, preview.confirmation);
  expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toHaveLength(2);
  f.advance();
  f.lifecycle.restore(f.other.id, root.id);
  f.recovery.restore(f.other.id, root.id, child.id);
  expect(f.row(child.id)!.owner_id).toBe(f.other.id);
  expect(f.db.prepare('SELECT * FROM workspace_recovery_holds').all()).toEqual([]);
});

test('hold cleanup retains standalone recovery evidence and rolls back with the explicit mutation', () => {
  const f = fixture(),
    root = f.space(),
    child = f.child(root.id);
  f.recovery.trash(f.owner.id, root.id, child.id);
  holdRestoredTrash(f.db);
  const batch = String(f.row(child.id)!.trash_batch);
  expect(() =>
    f.auth.transaction(() => {
      f.db
        .prepare('UPDATE workspace_items SET trashed_at=NULL,trash_batch=NULL WHERE id=?')
        .run(child.id);
      cleanRecoveryHolds(f.db);
      expect(recoveryHeld(f.db, batch)).toBe(true);
      f.db.prepare('DELETE FROM workspace_space_trash WHERE item_id=?').run(child.id);
      cleanRecoveryHolds(f.db);
      expect(recoveryHeld(f.db, batch)).toBe(false);
      throw new Error('fixture rollback');
    }),
  ).toThrow('fixture rollback');
  expect(recoveryHeld(f.db, batch)).toBe(true);
  expect(f.row(child.id)!.trash_batch).toBe(batch);
});
