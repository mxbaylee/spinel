import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { backup, DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { reconcileRestoreFences } from './restore-fences.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spinel-restore-fences-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(join(root, 'current.sqlite'));
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    generations = new CollaborationGenerations(workspace);
  const owner = auth.createUser('Owner'),
    item = workspace.create(owner.id, { kind: 'doc', name: 'Private title', parentId: null });
  const snapshot = async () => {
    const path = join(root, `${randomUUID()}.sqlite`);
    await backup(db, path);
    const candidate = new DatabaseSync(path);
    cleanup.push(() => candidate.close());
    return candidate;
  };
  return { db, auth, workspace, generations, owner, item, snapshot };
}
const fences = (db: DatabaseSync) =>
  db.prepare('SELECT * FROM spinel_restore_fences ORDER BY kind,id').all();

test.each(['item_id', 'user_id', 'checkpoint_id', 'previous_unit', 'next_unit'] as const)(
  'detects a conflicting %s binding found only between two attempts',
  async (field) => {
    const f = await fixture();
    const other = f.workspace.create(f.owner.id, { kind: 'doc', name: 'Other', parentId: null });
    const a = await f.snapshot(),
      b = await f.snapshot(),
      c = await f.snapshot();
    const generations = new CollaborationGenerations(new WorkspaceStore(new AuthStore(a)));
    const job = generations.begin(f.owner.id, f.item.id, f.item.id, randomUUID(), 'checkpoint');
    const row = a.prepare('SELECT * FROM spinel_restore_jobs WHERE id=?').get(job.id)!;
    const keys = Object.keys(row);
    b.prepare(
      `INSERT INTO spinel_restore_jobs(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
    ).run(...keys.map((key) => row[key]));
    b.prepare(`UPDATE spinel_restore_jobs SET ${field}=? WHERE id=?`).run(
      field === 'item_id' ? other.id : randomUUID(),
      job.id,
    );
    const before = fences(c);
    expect(() => reconcileRestoreFences(f.db, c, [a, b])).toThrow('incompatible');
    expect(fences(c)).toEqual(before);
    expect(c.prepare('SELECT 1 FROM spinel_restore_jobs').get()).toBeUndefined();
  },
);

test('unions retired and current identities without copying absent-item jobs or changing the source', async () => {
  const f = await fixture(),
    archivedFence = randomUUID();
  f.db.prepare("INSERT INTO spinel_restore_fences VALUES('identity',?)").run(archivedFence);
  const archivedJob = f.generations.begin(
    f.owner.id,
    f.item.id,
    f.item.id,
    randomUUID(),
    'checkpoint',
  );
  const candidate = await f.snapshot();
  f.db.exec('DELETE FROM spinel_restore_fences');
  f.generations.cancel(archivedJob.id);
  const laterItem = f.workspace.create(f.owner.id, {
    kind: 'doc',
    name: 'Later file',
    parentId: null,
  });
  const laterJob = f.generations.begin(
    f.owner.id,
    laterItem.id,
    laterItem.id,
    randomUUID(),
    'later-checkpoint',
  );
  const before = fences(f.db),
    originalJobs = f.db.prepare('SELECT * FROM spinel_restore_jobs ORDER BY id').all();
  reconcileRestoreFences(f.db, candidate);
  const result = fences(candidate);
  for (const id of [
    f.item.id,
    laterItem.id,
    archivedFence,
    archivedJob.nextUnit,
    laterJob.nextUnit,
  ])
    expect(result).toContainEqual({ kind: 'identity', id });
  for (const id of [archivedJob.id, laterJob.id])
    expect(result).toContainEqual({ kind: 'request', id });
  expect(
    candidate.prepare('SELECT * FROM spinel_restore_jobs WHERE id=?').get(laterJob.id),
  ).toBeUndefined();
  expect(
    candidate.prepare('SELECT * FROM workspace_items WHERE id=?').get(laterItem.id),
  ).toBeUndefined();
  expect(fences(f.db)).toEqual(before);
  expect(f.db.prepare('SELECT * FROM spinel_restore_jobs ORDER BY id').all()).toEqual(originalJobs);
  candidate.exec(
    'DELETE FROM spinel_restore_jobs; DELETE FROM collaboration_purge; DELETE FROM workspace_items',
  );
  expect(fences(candidate)).toEqual(result);
  reconcileRestoreFences(f.db, candidate);
  expect(fences(candidate)).toEqual(result);
});

test('two successive preparations retain both generations of permanent evidence', async () => {
  const f = await fixture(),
    first = await f.snapshot(),
    firstId = randomUUID(),
    secondId = randomUUID();
  f.db.prepare('INSERT INTO collaboration_purge VALUES(?)').run(firstId);
  reconcileRestoreFences(f.db, first);
  f.db.exec('DELETE FROM collaboration_purge');
  f.db.prepare("INSERT INTO spinel_restore_fences VALUES('request',?)").run(secondId);
  reconcileRestoreFences(first, f.db);
  expect(fences(f.db)).toContainEqual({ kind: 'identity', id: firstId });
  expect(fences(f.db)).toContainEqual({ kind: 'request', id: secondId });
});

test.each(['item_id', 'user_id', 'checkpoint_id', 'previous_unit', 'next_unit'] as const)(
  'refuses contradictory %s for the same restore request before mutation',
  async (field) => {
    const f = await fixture(),
      other = f.workspace.create(f.owner.id, { kind: 'doc', name: 'Other', parentId: null });
    const job = f.generations.begin(f.owner.id, f.item.id, f.item.id, randomUUID(), 'checkpoint'),
      candidate = await f.snapshot();
    f.db
      .prepare(`UPDATE spinel_restore_jobs SET ${field}=? WHERE id=?`)
      .run(field === 'item_id' ? other.id : randomUUID(), job.id);
    const before = fences(candidate);
    expect(() => reconcileRestoreFences(f.db, candidate)).toThrow('incompatible');
    expect(fences(candidate)).toEqual(before);
  },
);

test('an insertion failure rolls back all candidate fences and leaves the source unchanged', async () => {
  const f = await fixture(),
    candidate = await f.snapshot(),
    source = fences(f.db),
    before = fences(candidate);
  f.generations.begin(f.owner.id, f.item.id, f.item.id, randomUUID(), 'checkpoint');
  const prepare = candidate.prepare.bind(candidate);
  vi.spyOn(candidate, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql.startsWith('INSERT OR IGNORE INTO spinel_restore_fences')) {
      const run = statement.run.bind(statement);
      vi.spyOn(statement, 'run').mockImplementation((...values) => {
        if (values[0] === 'request') throw new Error('fixture failure');
        return run(...values);
      });
    }
    return statement;
  });
  expect(() => reconcileRestoreFences(f.db, candidate)).toThrow('fixture failure');
  expect(fences(candidate)).toEqual(before);
  expect(fences(f.db)).toEqual(source);
});

test('refuses aliased files and oversized identities before publishing any fence', async () => {
  const f = await fixture(),
    candidate = await f.snapshot();
  expect(() => reconcileRestoreFences(f.db, f.db)).toThrow('incompatible');
  f.db.prepare('INSERT INTO collaboration_purge VALUES(?)').run('x'.repeat(257));
  expect(() => reconcileRestoreFences(f.db, candidate)).toThrow('incompatible');
  expect(fences(candidate)).toEqual([]);
});
