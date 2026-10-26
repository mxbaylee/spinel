import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { LocaleType } from '@univerjs/core';
import { MAX_RETAINED_BYTES, MAX_RETAINED_REVISIONS, SyncError } from '@spinel/sync-server';
import type { SyncCommit, SyncRevision, SyncUnit } from '@spinel/sync-server';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { resolveDocument } from '../workspace/document-access.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { CollaborationGenerations } from '../collaboration/generations.ts';
import { SQLiteSyncStorage } from './store.ts';

const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-sync-storage-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'application.sqlite');
  let database = openDatabase(path);
  cleanup.push(() => {
    if (database.isOpen) database.close();
  });
  const auth = new AuthStore(database);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const item = workspace.create(owner.id, { name: 'Notes', kind: 'sheet', parentId: null });
  workspace.share(owner.id, item.id, editor.id, 'editor');
  const session = auth.createSession(editor.id);
  const store = new SQLiteSyncStorage(auth);
  const unit = makeUnit(item.id);
  store.create(unit, () => {});
  const guard = () => {
    resolveDocument(workspace, editor.id, item.id, 'edit', {
      sessionHash: session.session.token_hash,
    });
  };
  const reopen = () => {
    database.close();
    database = openDatabase(path);
    return new SQLiteSyncStorage(new AuthStore(database));
  };
  return { auth, database, workspace, owner, editor, item, session, store, unit, guard, reopen };
}

function makeUnit(unitId: string): SyncUnit {
  return {
    unitId,
    kind: 'sheet',
    revision: 1,
    retainedFrom: 1,
    snapshot: {
      id: unitId,
      name: 'Notes',
      appVersion: '1.1.0',
      locale: 'enUS' as LocaleType,
      styles: {},
      sheetOrder: ['first'],
      sheets: {
        first: {
          id: 'first',
          name: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          cellData: {},
        },
      },
    },
  };
}

function next(unit: SyncUnit, actorId: string, mutationId: string = randomUUID()): SyncCommit {
  const revision = unit.revision + 1;
  const edit: SyncRevision = {
    unitId: unit.unitId,
    revision,
    baseRevision: unit.revision,
    actorId,
    mutationId,
    requestHash: 'a'.repeat(64),
    mutations: [
      {
        id: 'sheet.mutation.set-range-values',
        params: {
          unitId: unit.unitId,
          subUnitId: 'first',
          trigger: 'sheet.command.set-range-values',
          cellValue: { 0: { 0: { v: revision } } },
        },
      },
    ],
    beforeCells: [{ sheetId: 'first', row: 0, column: 0, value: null }],
    touched: { kind: 'sheet', cells: [{ sheetId: 'first', row: 0, column: 0 }] },
    hash: 'b'.repeat(64),
  };
  return {
    expectedRevision: unit.revision,
    unit: { ...unit, revision, snapshot: { ...unit.snapshot, rev: revision } },
    edit,
  };
}

test('the live head, exact output and retry identity survive reopening the application database', async () => {
  const f = await fixture();
  const edit = next(f.unit, f.editor.id);
  f.store.commit(edit, f.guard);
  const reopened = f.reopen();
  expect(reopened.load(f.item.id)).toEqual(edit.unit);
  expect(reopened.receipt(f.item.id, f.editor.id, edit.edit.mutationId)).toEqual(edit.edit);
  expect(reopened.revisions(f.item.id, 1, 2)).toEqual([edit.edit]);
  expect(reopened.receipt(f.item.id, f.owner.id, edit.edit.mutationId)).toBeUndefined();
});

test('a failed commit rolls back its log, receipt, retention and head together', async () => {
  const f = await fixture();
  const edit = next(f.unit, f.editor.id);
  f.database.exec(`CREATE TEMP TRIGGER fail_sync_head BEFORE UPDATE ON spinel_sync_units
    BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END;`);
  expect(() => f.store.commit(edit, f.guard)).toThrow('simulated storage failure');
  expect(f.store.load(f.item.id)).toEqual(f.unit);
  expect(f.store.revisions(f.item.id, 1, 2)).toEqual([]);
  expect(f.store.receipt(f.item.id, f.editor.id, edit.edit.mutationId)).toBeUndefined();
  f.database.exec('DROP TRIGGER fail_sync_head');
  f.store.commit(edit, f.guard);
  expect(f.store.load(f.item.id)?.revision).toBe(2);
});

test('the compare-and-swap head rejects a second writer and a used retry identity', async () => {
  const f = await fixture();
  const first = next(f.unit, f.editor.id);
  const second = next(f.unit, f.owner.id);
  f.store.commit(first, f.guard);
  expect(() => f.store.commit(second, f.guard)).toThrow(SyncError);
  expect(f.store.receipt(f.item.id, f.owner.id, second.edit.mutationId)).toBeUndefined();
  const reused = next(first.unit, f.editor.id, first.edit.mutationId);
  expect(() => f.store.commit(reused, f.guard)).toThrow('retry-conflict');
  expect(f.store.load(f.item.id)?.revision).toBe(2);
  expect(f.store.receipt(f.item.id, f.editor.id, first.edit.mutationId)).toEqual(first.edit);
});

test.each(['session', 'grant'] as const)(
  'a %s revoked after materialization is refused by the final transaction guard',
  async (revoked) => {
    const f = await fixture();
    f.guard(); // The earlier admission check succeeded.
    const edit = next(f.unit, f.editor.id);
    if (revoked === 'session') f.auth.revokeSession(f.session.session.token_hash);
    else f.workspace.share(f.owner.id, f.item.id, f.editor.id, null);
    expect(() => f.store.commit(edit, f.guard)).toThrow();
    expect(f.store.load(f.item.id)).toEqual(f.unit);
    expect(f.store.receipt(f.item.id, f.editor.id, edit.edit.mutationId)).toBeUndefined();
  },
);

test('the final guard runs inside the same rollback boundary as log persistence', async () => {
  const f = await fixture();
  const edit = next(f.unit, f.editor.id);
  expect(() =>
    f.store.commit(edit, () => {
      f.guard();
      f.auth.database.prepare('UPDATE workspace_items SET updated_at=17 WHERE id=?').run(f.item.id);
      throw new Error('rejected at final boundary');
    }),
  ).toThrow('rejected at final boundary');
  expect(f.store.load(f.item.id)).toEqual(f.unit);
  expect(f.workspace.get(f.owner.id, f.item.id).updatedAt).not.toBe(17);
});

test('a competing SQLite writer cannot revoke access between authorization and commit', async () => {
  const f = await fixture();
  const path = String(
    f.database
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main')!.file,
  );
  const other = openDatabase(path);
  cleanup.push(() => other.close());
  other.exec('PRAGMA busy_timeout=1');
  const revoke = () =>
    other.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(f.session.session.token_hash);
  const edit = next(f.unit, f.editor.id);
  f.store.commit(edit, () => {
    f.guard();
    expect(revoke).toThrow();
  });
  expect(f.store.load(f.item.id)?.revision).toBe(2);
  revoke();
  expect(f.guard).toThrow();
}, 10_000); // libsql's competing writer can use its five-second driver busy wait.

test.each(['wrong-root', 'wrong-child', 'grant', 'epoch', 'generation', 'ancestry'] as const)(
  'the final Space guard rejects %s changes before any edit becomes durable',
  async (changed) => {
    const f = await fixture();
    const workspace = new WorkspaceStore(f.auth, { spacesEnabled: true });
    migrateSpaceSchema(f.database);
    const spaces = new SpaceStore(workspace);
    const root = spaces.createRoot(f.owner.id, { name: 'Project', parentId: null }).space;
    const other = spaces.createRoot(f.owner.id, { name: 'Other project', parentId: null }).space;
    const child = spaces.createChild(f.owner.id, root.id, {
      kind: 'sheet',
      name: 'Page',
      parentId: root.id,
    }).item;
    spaces.share(f.owner.id, root.id, f.editor.id, 'editor');
    const generations = new CollaborationGenerations(workspace);
    const unit = makeUnit(child.id);
    f.store.create(unit, () => {});
    const scope = {
      sessionHash: f.session.session.token_hash,
      spaceId: root.id,
      spaceItem: child.id,
    };
    const privacyEpoch = workspace.links.epoch(root.id);
    const guard = () => {
      resolveDocument(workspace, f.editor.id, child.id, 'edit', scope);
      workspace.links.assertEpoch(root.id, privacyEpoch);
      if (generations.active(child.id).unitId !== unit.unitId || generations.restoring(child.id))
        throw new Error('generation changed');
    };
    guard();
    const edit = next(unit, f.editor.id);
    if (changed === 'wrong-root') scope.spaceId = other.id;
    if (changed === 'wrong-child') scope.spaceItem = root.id;
    if (changed === 'grant') spaces.share(f.owner.id, root.id, f.editor.id, null);
    if (changed === 'epoch') workspace.links.begin(root.id, null);
    if (changed === 'generation') {
      const job = generations.begin(f.editor.id, child.id, child.id, randomUUID(), 'saved', scope);
      generations.finish(
        job.id,
        1,
        () => {},
        () => {},
        scope,
      );
    }
    if (changed === 'ancestry')
      f.database
        .prepare('UPDATE workspace_items SET parent_id=? WHERE id=?')
        .run(other.id, child.id);
    expect(() => f.store.commit(edit, guard)).toThrow();
    expect(f.store.load(child.id)).toEqual(unit);
    expect(f.store.receipt(child.id, f.editor.id, edit.edit.mutationId)).toBeUndefined();
  },
);

test('an asynchronous guard cannot authorize a durable write', async () => {
  const f = await fixture();
  const edit = next(f.unit, f.editor.id);
  expect(() => f.store.commit(edit, async () => {})).toThrow('synchronously');
  expect(f.store.load(f.item.id)).toEqual(f.unit);
});

test('retention bounds before-images while durable edits and retry identities remain', async () => {
  const f = await fixture();
  let unit = f.unit;
  const edits: SyncRevision[] = [];
  for (let n = 0; n < MAX_RETAINED_REVISIONS + 2; n++) {
    const commit = next(unit, f.editor.id);
    f.store.commit(commit, f.guard);
    edits.push(commit.edit);
    unit = f.store.load(f.item.id)!;
  }
  expect(unit.retainedFrom).toBe(3);
  expect(f.store.receipt(f.item.id, f.editor.id, edits[0].mutationId)).toEqual({
    ...edits[0],
    beforeCells: null,
  });
  const retained = f.store.revisions(f.item.id, 3, unit.revision);
  expect(retained).toHaveLength(MAX_RETAINED_REVISIONS);
  expect(retained.every((edit) => edit.beforeCells !== null)).toBe(true);
  expect(() => f.store.revisions(f.item.id, 1, unit.revision)).toThrow('stale');
  expect(f.database.prepare('SELECT count(*) AS n FROM spinel_sync_units').get()!.n).toBe(1);
  expect(f.database.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(
    MAX_RETAINED_REVISIONS + 2,
  );
});

test('byte retention also bounds a few large before-images, without discarding their edits', async () => {
  const f = await fixture();
  const first = next(f.unit, f.editor.id);
  const half = 'x'.repeat(Math.floor(MAX_RETAINED_BYTES / 2));
  first.edit.beforeCells![0].value = { v: half };
  f.store.commit(first, f.guard);
  const second = next(f.store.load(f.item.id)!, f.editor.id);
  second.edit.beforeCells![0].value = { v: half };
  f.store.commit(second, f.guard);
  expect(f.store.load(f.item.id)?.retainedFrom).toBe(2);
  expect(f.store.receipt(f.item.id, f.editor.id, first.edit.mutationId)?.beforeCells).toBeNull();
  expect(f.store.receipt(f.item.id, f.editor.id, first.edit.mutationId)?.mutations).toEqual(
    first.edit.mutations,
  );
  expect(
    f.store.receipt(f.item.id, f.editor.id, second.edit.mutationId)?.beforeCells,
  ).not.toBeNull();
});

test('creation is guarded and idempotent; purge removes only its own generation and receipts', async () => {
  const f = await fixture();
  const edit = next(f.unit, f.editor.id);
  f.store.commit(edit, f.guard);
  f.store.create(f.unit, f.guard);
  expect(f.store.load(f.item.id)?.revision).toBe(2);
  expect(() =>
    f.store.create(f.unit, () => {
      throw new Error('revoked');
    }),
  ).toThrow('revoked');
  const other = makeUnit(randomUUID());
  f.store.create(other, () => {});
  f.store.remove(f.item.id);
  expect(f.store.has(f.item.id)).toBe(false);
  expect(f.store.revisions(f.item.id, 1, 2)).toEqual([]);
  expect(f.store.receipt(f.item.id, f.editor.id, edit.edit.mutationId)).toBeUndefined();
  expect(f.store.load(other.unitId)).toEqual(other);
  f.store.remove(f.item.id); // A retried purge is harmless.
});
