import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { CollaborationGenerations } from './generations.ts';

const close: (() => void)[] = [];
afterEach(() => {
  for (const fn of close.splice(0).reverse()) fn();
});
function fixture() {
  const db = openDatabase(':memory:');
  close.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner'),
    collaborator = auth.createUser('Collaborator');
  const item = workspace.create(owner.id, { kind: 'sheet', name: 'Budget', parentId: null });
  const generations = new CollaborationGenerations(workspace);
  db.exec('CREATE TABLE before_state (revision INTEGER PRIMARY KEY) STRICT;');
  return { db, auth, workspace, owner, collaborator, item, generations };
}

test('switch, pre-state, receipt and purge are atomic; retries cannot restore twice', () => {
  const f = fixture(),
    request = randomUUID();
  const job = f.generations.begin(f.owner.id, f.item.id, f.item.id, request);
  expect(f.generations.restoring(f.item.id)).toBe(true);
  expect(() => f.generations.begin(f.owner.id, f.item.id, f.item.id, randomUUID())).toThrow(
    'in progress',
  );
  expect(f.generations.resolve(job.nextUnit)).toBeUndefined();
  const saved = f.generations.finish(
    job.id,
    7,
    () => {
      f.db.prepare('INSERT INTO before_state VALUES(?)').run(7);
    },
    () => {},
  );
  expect(saved).toMatchObject({ status: 'complete', revision: 8 });
  expect(f.generations.active(f.item.id)).toEqual({
    itemId: f.item.id,
    unitId: job.nextUnit,
    offset: 7,
  });
  expect(f.generations.resolve(f.item.id)).toBeUndefined();
  expect(f.generations.resolve(job.nextUnit)?.itemId).toBe(f.item.id);
  expect(f.generations.restoring(f.item.id)).toBe(false);
  expect(f.db.prepare('SELECT item_id FROM collaboration_purge').all()).toEqual([
    { item_id: f.item.id },
  ]);
  // A lost HTTP response must not cause another replacement, even with an old expected ID.
  expect(f.generations.begin(f.owner.id, f.item.id, f.item.id, request)).toEqual(saved);
  expect(
    f.generations.finish(
      job.id,
      20,
      () => {
        throw new Error('must not repeat');
      },
      () => {},
    ),
  ).toEqual(saved);
  expect(f.db.prepare('SELECT revision FROM before_state').all()).toEqual([{ revision: 7 }]);
  expect(() => f.generations.begin(f.owner.id, f.item.id, f.item.id, randomUUID())).toThrow(
    'changed',
  );
});

test('a failed atomic switch keeps the old generation and rolls back partial pre-state writes', () => {
  const f = fixture();
  const job = f.generations.begin(f.owner.id, f.item.id, f.item.id, randomUUID());
  expect(() =>
    f.generations.finish(
      job.id,
      3,
      () => {
        f.db.exec('INSERT INTO before_state VALUES(3)');
        throw new Error('disk failure');
      },
      () => {},
    ),
  ).toThrow('disk failure');
  expect(f.generations.active(f.item.id).unitId).toBe(f.item.id);
  expect(f.db.prepare('SELECT * FROM before_state').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM collaboration_purge').all()).toEqual([]);
  expect(f.generations.restoring(f.item.id)).toBe(true);
  f.generations.cancel(job.id);
  expect(f.generations.restoring(f.item.id)).toBe(false);
  expect(f.db.prepare('SELECT item_id FROM collaboration_purge').all()).toEqual([
    { item_id: job.nextUnit },
  ]);
});

test('current editor/session authority is required before switching and cancelled jobs cannot resume', () => {
  const f = fixture();
  f.workspace.share(f.owner.id, f.item.id, f.collaborator.id, 'viewer');
  expect(() =>
    f.generations.begin(f.collaborator.id, f.item.id, f.item.id, randomUUID()),
  ).toThrow();
  f.workspace.share(f.owner.id, f.item.id, f.collaborator.id, 'editor');
  const job = f.generations.begin(f.collaborator.id, f.item.id, f.item.id, randomUUID());
  expect(() =>
    f.generations.finish(
      job.id,
      2,
      () => {},
      () => {
        throw new Error('expired session');
      },
    ),
  ).toThrow('expired session');
  f.workspace.share(f.owner.id, f.item.id, f.collaborator.id, null);
  expect(() =>
    f.generations.finish(
      job.id,
      2,
      () => {},
      () => {},
    ),
  ).toThrow();
  f.generations.cancel(job.id);
  f.workspace.share(f.owner.id, f.item.id, f.collaborator.id, 'editor');
  expect(() =>
    f.generations.finish(
      job.id,
      2,
      () => {},
      () => {},
    ),
  ).toThrow('cancelled');
  expect(f.generations.active(f.item.id).unitId).toBe(f.item.id);
});

test('restart cancels only pre-switch stages; deletion enqueues active and staged SDK units', () => {
  const f = fixture();
  const first = f.generations.begin(f.owner.id, f.item.id, f.item.id, randomUUID());
  f.generations.finish(
    first.id,
    4,
    () => {},
    () => {},
  );
  const pending = f.generations.begin(f.owner.id, f.item.id, first.nextUnit, randomUUID());
  const reopened = new CollaborationGenerations(f.workspace);
  reopened.recoverBeforeServing();
  expect(reopened.active(f.item.id).unitId).toBe(first.nextUnit);
  expect(reopened.restoring(f.item.id)).toBe(false);
  expect(
    f.db
      .prepare('SELECT item_id FROM collaboration_purge ORDER BY item_id')
      .all()
      .map((r) => r.item_id)
      .sort(),
  ).toEqual([f.item.id, pending.nextUnit].sort());
  const next = reopened.begin(f.owner.id, f.item.id, first.nextUnit, randomUUID());
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(f.item.id);
  expect(
    f.db
      .prepare('SELECT item_id FROM collaboration_purge')
      .all()
      .map((r) => r.item_id)
      .sort(),
  ).toEqual([f.item.id, pending.nextUnit, first.nextUnit, next.nextUnit].sort());
  expect(reopened.resolve(first.nextUnit)).toBeUndefined();
});
