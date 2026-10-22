import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { MAX_ANCESTOR_READS } from '../workspace/ordinary-scope.ts';
import { HistoryStore } from './store.ts';
import { DAY } from './policy.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

function fixture() {
  const db = new DatabaseSync(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  auth.now = () => Date.UTC(2026, 9, 22, 12);
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  db.exec(`CREATE TABLE workspace_collaboration (
    item_id TEXT PRIMARY KEY REFERENCES workspace_items(id), state TEXT NOT NULL
  ) STRICT;`);
  // These tests exercise application maintenance, not the native engine. The
  // subscription/metadata port keeps the real SQLite and access boundaries in
  // process without importing the collaboration service runtime.
  const getUnit = vi.fn(async (_context: unknown, _unit: string) => ({ headRevision: 1 }));
  const load = vi.fn(async () => {
    throw new Error('Unexpected native capture');
  });
  const collaboration = {
    onPrepared: () => ({ dispose() {} }),
    service: {
      use: () => ({ dispose() {} }),
      on: () => ({ dispose() {} }),
      dbAdapter: { getUnit },
    },
    generations: { active: (id: string) => ({ itemId: id, unitId: id, offset: 0 }) },
    load,
  } as unknown as CollaborationStore;
  const history = new HistoryStore(workspace, collaboration);
  cleanup.push(() => history.close());
  const insert = db.prepare(`INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
    VALUES(?,?,?,?,?,0,0,?,?)`);
  const add = (
    kind: 'doc' | 'folder' | 'space',
    parent: string | null = null,
    space: string | null = null,
    id: string = randomUUID(),
  ) => {
    insert.run(id, owner.id, parent, kind, kind, space, space ? 0 : null);
    return id;
  };
  const checkpoint = (id: string, revision: number, name: string | null = null) => {
    db.prepare('INSERT INTO history_checkpoints VALUES(?,?,?,?,?,?,?)').run(
      randomUUID(),
      id,
      'collaboration',
      revision,
      auth.now() - 2 * DAY,
      name,
      gzipSync('{}'),
    );
  };
  const checkpoints = () => db.prepare('SELECT * FROM history_checkpoints ORDER BY id').all();
  return { db, auth, workspace, owner, history, add, checkpoint, checkpoints, getUnit, load };
}

function countAncestorReads(db: DatabaseSync) {
  const prepare = db.prepare.bind(db);
  let count = 0;
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql !== 'SELECT * FROM workspace_items WHERE id=?') return statement;
    return {
      ...statement,
      get: (...values: Parameters<typeof statement.get>) => {
        count++;
        return statement.get(...values);
      },
    };
  });
  return {
    value: () => count,
    reset: () => {
      count = 0;
    },
  };
}

test('retention shares deep ordinary ancestry once and preserves every Space checkpoint', () => {
  const f = fixture();
  const depth = 128;
  let parent: string | null = null;
  const docs: string[] = [];
  f.auth.transaction(() => {
    for (let index = 0; index < depth; index++) parent = f.add('folder', parent);
    for (let index = 0; index < 80; index++) {
      const id = f.add('doc', parent);
      docs.push(id);
      f.checkpoint(id, 1);
      f.checkpoint(id, 2);
      f.checkpoint(id, 3, 'Kept by the owner');
    }
  });
  const space = f.add('space', parent);
  const member = f.add('doc', space, space);
  const unmarked = f.add('doc', space);
  const hidden = new Set([space, member, unmarked]);
  for (const id of hidden) {
    f.checkpoint(id, 1);
    f.checkpoint(id, 2);
    f.checkpoint(id, 3, 'Existing Space checkpoint');
  }
  const spaceBefore = f.checkpoints().filter((row) => hidden.has(String(row.item_id)));
  const reads = countAncestorReads(f.db);
  f.history.prune();
  // The old per-document classifier did roughly docs.length * depth reads.
  expect(reads.value()).toBeLessThanOrEqual(depth + docs.length + 5);
  for (const id of docs)
    expect(
      f.db
        .prepare('SELECT revision FROM history_checkpoints WHERE item_id=? ORDER BY revision')
        .all(id),
    ).toEqual([{ revision: 2 }, { revision: 3 }]);
  expect(f.checkpoints().filter((row) => hidden.has(String(row.item_id)))).toEqual(spaceBefore);
});

test('a full Space checkpoint population cannot starve an ordinary sibling', async () => {
  const f = fixture();
  const ordinary = f.add('doc');
  f.checkpoint(ordinary, 1);
  f.checkpoint(ordinary, 2);
  f.db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(ordinary);
  f.db
    .prepare("INSERT INTO history_progress VALUES(?,'collaboration',1,?,?)")
    .run(ordinary, f.auth.now(), f.auth.now());
  const space = f.add('space');
  f.auth.transaction(() => {
    for (let index = 0; index <= MAX_ANCESTOR_READS; index++) {
      const member = f.add('doc', space, space);
      f.checkpoint(member, 1);
    }
  });
  const before = f.checkpoints().filter((row) => row.item_id !== ordinary);
  const reads = countAncestorReads(f.db);
  f.history.prune();
  expect(reads.value()).toBe(1);
  await f.history.tick();
  expect(f.getUnit.mock.calls.map(([, id]) => id)).toEqual([ordinary]);
  expect(f.checkpoints().filter((row) => row.item_id !== ordinary)).toEqual(before);
  expect(f.checkpoints().filter((row) => row.item_id === ordinary)).toEqual([
    expect.objectContaining({ revision: 2 }),
  ]);
});

test('an aggregate ancestry-budget refusal leaves every checkpoint untouched and scan admits no partial batch', async () => {
  const f = fixture();
  const first = f.add('doc', null, null, '00000000-0000-4000-8000-000000000001');
  const leaves = [first];
  f.auth.transaction(() => {
    // Each chain fits the one-item budget, but their combined walk does not.
    for (let branch = 1; branch <= 2; branch++) {
      let parent: string | null = null;
      for (let depth = 0; depth < 6000; depth++) parent = f.add('folder', parent);
      leaves.push(f.add('doc', parent, null, `${branch}0000000-0000-4000-8000-000000000001`));
    }
    for (const id of leaves) {
      f.checkpoint(id, 1);
      f.checkpoint(id, 2);
    }
  });
  const before = f.checkpoints();
  const reads = countAncestorReads(f.db);
  expect(() => f.history.prune()).toThrow('too large');
  expect(reads.value()).toBe(MAX_ANCESTOR_READS);
  expect(f.checkpoints()).toEqual(before);
  reads.reset();
  const access = vi.spyOn(f.workspace, 'get');
  await expect(f.history.tick()).rejects.toThrow('too large');
  expect(reads.value()).toBe(MAX_ANCESTOR_READS);
  expect(access).not.toHaveBeenCalled();
  expect(f.getUnit).not.toHaveBeenCalled();
  expect(f.checkpoints()).toEqual(before);
  // The cache cannot survive a maintenance call: a smaller current graph can
  // be pruned on the next attempt without losing the prior retained records.
  for (const id of leaves)
    f.db.prepare('UPDATE workspace_items SET parent_id=NULL WHERE id=?').run(id);
  f.history.prune();
  expect(f.checkpoints()).toHaveLength(leaves.length);
  expect(f.checkpoints().every((row) => row.revision === 2)).toBe(true);
});

test('batched structural filtering does not reuse access after an awaited metadata read', async () => {
  const f = fixture();
  const viewer = f.auth.createUser('Collaborator');
  const first = f.add('doc', null, null, '00000000-0000-4000-8000-000000000001');
  const second = f.add('doc', null, null, '10000000-0000-4000-8000-000000000001');
  for (const id of [first, second]) {
    f.workspace.share(f.owner.id, id, viewer.id, 'viewer');
    f.db.prepare("INSERT INTO workspace_collaboration VALUES(?,'ready')").run(id);
    f.db
      .prepare("INSERT INTO history_progress VALUES(?,'collaboration',1,?,?)")
      .run(id, f.auth.now(), f.auth.now());
    f.checkpoint(id, 1);
  }
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  const release = Promise.withResolvers<void>();
  f.getUnit.mockImplementation(async (_context, id) => {
    if (id === first) await release.promise;
    return { headRevision: 1 };
  });
  const access = vi.spyOn(f.workspace, 'get');
  const tick = f.history.tick();
  try {
    await vi.waitFor(() => expect(f.getUnit).toHaveBeenCalledWith(expect.anything(), first));
    f.db
      .prepare('DELETE FROM workspace_grants WHERE item_id=? AND user_id=?')
      .run(second, viewer.id);
  } finally {
    release.resolve();
  }
  await tick;
  expect(access).toHaveBeenCalledWith(viewer.id, second);
  expect(f.getUnit.mock.calls.map(([, id]) => id)).toEqual([first]);
  expect(f.load).not.toHaveBeenCalled();
  expect(f.checkpoints()).toHaveLength(2);
});
