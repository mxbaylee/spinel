import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { IWorkbookData } from '@univerjs/core';
import { UniverType } from '@univerjs/protocol';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { HistoryStore } from './store.ts';
import { MINUTE } from './policy.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { randomUUID } from 'node:crypto';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-history-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  let clock = Date.UTC(2026, 9, 1);
  auth.now = () => clock;
  const owner = auth.createUser('Owner'),
    viewer = auth.createUser('Viewer'),
    outsider = auth.createUser('Other'),
    admin = auth.createUser('Operator', true);
  const item = workspace.create(owner.id, { kind: 'sheet', name: 'History', parentId: null });
  workspace.share(owner.id, item.id, viewer.id, 'viewer');
  const collaboration = new CollaborationStore(workspace, path);
  cleanup.push(() => collaboration.close());
  const history = new HistoryStore(workspace, collaboration);
  cleanup.push(() => history.close());
  await collaboration.prepare(owner.id, item.id);
  let request = 0;
  const edit = async (value: string, user = owner.id) => {
    const data = await collaboration.load(user, item.id);
    const result = await collaboration.service.submitChangeset(
      {
        changeset: {
          unitID: item.id,
          type: UniverType.UNIVER_SHEET,
          baseRev: data.revision,
          revision: 0,
          userID: user,
          memberID: 'history-test',
          sid: 'history-test',
          reqId: ++request,
          mutations: [
            {
              id: SetRangeValuesMutation.id,
              data: JSON.stringify({
                unitId: item.id,
                subUnitId: 'first',
                cellValue: { 0: { 0: { v: value } } },
              }),
            },
          ],
        },
      },
      { userID: user, memberID: 'history-test' },
    );
    expect(result.status).toBe('committed');
  };
  return {
    path,
    db,
    auth,
    workspace,
    owner,
    viewer,
    outsider,
    admin,
    item,
    collaboration,
    history,
    edit,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

test('captures a baseline before editing, every five minutes of work, and at idle breaks; rejects unauthorized reads', async () => {
  const f = await fixture();
  expect(f.history.list(f.owner.id, f.item.id).map((p) => p.revision)).toEqual([1]);
  await f.edit('first');
  f.advance(59_000);
  await f.history.tick();
  expect(f.history.list(f.owner.id, f.item.id)).toHaveLength(1);
  f.advance(1000);
  await f.history.tick();
  expect(f.history.list(f.owner.id, f.item.id).map((p) => p.revision)).toEqual([2, 1]);
  for (let i = 1; i <= 10; i++) {
    f.advance(30_000);
    await f.edit(`continuous ${i}`);
    await f.history.tick();
    expect(f.history.list(f.owner.id, f.item.id)).toHaveLength(i === 10 ? 3 : 2);
  }
  const latest = f.history.list(f.owner.id, f.item.id)[0];
  const snapshot = (await f.history.load(f.viewer.id, f.item.id, latest.id)) as IWorkbookData;
  expect(snapshot.sheets.first.cellData?.[0]?.[0]?.v).toBe('continuous 10');
  f.advance(30_000);
  await f.edit('last before break');
  f.advance(MINUTE);
  await f.history.tick();
  expect(f.history.list(f.owner.id, f.item.id)).toHaveLength(4);
  await f.history.tick();
  expect(f.history.list(f.owner.id, f.item.id)).toHaveLength(4);
  for (const user of [f.outsider, f.admin]) {
    expect(() => f.history.list(user.id, f.item.id)).toThrow();
    await expect(f.history.load(user.id, f.item.id, latest.id)).rejects.toThrow();
  }
  f.workspace.share(f.owner.id, f.item.id, f.viewer.id, null);
  await expect(f.history.load(f.viewer.id, f.item.id, latest.id)).rejects.toThrow();
}, 40_000);

test('a missed commit event is recovered from public revision metadata and failed captures retry', async () => {
  const f = await fixture();
  await f.history.close();
  await f.edit('while history was interrupted');
  const history = new HistoryStore(f.workspace, f.collaboration);
  cleanup.push(() => history.close());
  await history.tick();
  expect(history.list(f.owner.id, f.item.id)).toHaveLength(1);
  f.advance(MINUTE);
  const failure = vi.spyOn(f.collaboration, 'load').mockRejectedValueOnce(new Error('interrupted'));
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  await history.tick();
  expect(history.list(f.owner.id, f.item.id)).toHaveLength(1);
  expect(warn).toHaveBeenCalledWith('History checkpoint could not be saved; it will retry.');
  failure.mockRestore();
  await history.tick();
  expect(history.list(f.owner.id, f.item.id)[0].revision).toBe(2);
  const snapshot = (await history.load(
    f.owner.id,
    f.item.id,
    history.list(f.owner.id, f.item.id)[0].id,
  )) as IWorkbookData;
  expect(snapshot.sheets.first.cellData?.[0]?.[0]?.v).toBe('while history was interrupted');
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(f.item.id);
  expect(f.db.prepare('SELECT count(*) AS n FROM history_checkpoints').get()?.n).toBe(0);
  expect(f.db.prepare('SELECT count(*) AS n FROM history_progress').get()?.n).toBe(0);
}, 30_000);

test('an active collaborator keeps idle history after the owner is disabled', async () => {
  const f = await fixture();
  f.workspace.share(f.owner.id, f.item.id, f.viewer.id, 'editor');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  await f.edit('still protected', f.viewer.id);
  f.advance(MINUTE);
  await f.history.tick();
  const points = f.history.list(f.viewer.id, f.item.id);
  expect(points.map((p) => p.revision)).toEqual([2, 1]);
  expect(
    ((await f.history.load(f.viewer.id, f.item.id, points[0].id)) as IWorkbookData).sheets.first
      .cellData?.[0]?.[0]?.v,
  ).toBe('still protected');
  expect(() => f.history.list(f.owner.id, f.item.id)).toThrow();
}, 30_000);

test('migration preserves native history and starts a separate collaboration revision sequence', async () => {
  const f = await fixture();
  const item = f.workspace.create(f.owner.id, { kind: 'sheet', name: 'Legacy', parentId: null });
  const sheets = new SheetStore(f.workspace);
  const original = (await f.collaboration.load(f.owner.id, f.item.id)).snapshot as IWorkbookData;
  const snapshot = { ...original, id: item.id };
  sheets.save(f.owner.id, item.id, { snapshot, revision: 0, writeId: randomUUID() });
  sheets.save(f.owner.id, item.id, {
    snapshot: { ...snapshot, name: 'Saved twice' },
    revision: 1,
    writeId: randomUUID(),
  });
  f.advance(MINUTE);
  await f.history.tick();
  sheets.save(f.owner.id, item.id, {
    snapshot: { ...snapshot, name: 'Third' },
    revision: 2,
    writeId: randomUUID(),
  });
  const capturing = f.history.capture(f.owner.id, item.id, 'native');
  sheets.save(f.owner.id, item.id, {
    snapshot: { ...snapshot, name: 'Latest before migration' },
    revision: 3,
    writeId: randomUUID(),
  });
  // prepare installs its fence synchronously, before pending native gzip can finish.
  const migrating = f.collaboration.prepare(f.owner.id, item.id);
  await Promise.all([capturing, migrating]);
  expect(f.history.list(f.owner.id, item.id).map((p) => [p.source, p.revision])).toEqual([
    ['collaboration', 1],
    ['native', 2],
    ['native', 1],
  ]);
  const latest = f.history.list(f.owner.id, item.id)[0];
  expect(((await f.history.load(f.owner.id, item.id, latest.id)) as IWorkbookData).name).toBe(
    'Latest before migration',
  );
  expect(() =>
    sheets.save(f.owner.id, item.id, { snapshot, revision: 2, writeId: randomUUID() }),
  ).toThrow('live collaboration');
}, 30_000);

test('a generation switch during metadata scan cannot mix an old SDK head with the new offset', async () => {
  const f = await fixture();
  await f.edit('Before restoration');
  const baseline = f.history.list(f.owner.id, f.item.id).at(-1)!;
  const adapter = f.collaboration.service.dbAdapter;
  const original = adapter.getUnit.bind(adapter);
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let once = true;
  vi.spyOn(adapter, 'getUnit').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (once && args[1] === f.item.id) {
      once = false;
      entered();
      await gate;
    }
    return result;
  });
  const scan = f.history.tick();
  await reading;
  await f.history.restore(f.owner.id, f.item.id, baseline.id, f.item.id, randomUUID());
  release();
  await scan;
  const row = f.db
    .prepare("SELECT revision FROM history_progress WHERE item_id=? AND source='collaboration'")
    .get(f.item.id);
  expect(row?.revision).toBe(2); // The interrupted scan must not invent old head 2 + new offset 2 = 4.
  await f.history.tick();
  expect(
    f.db
      .prepare("SELECT revision FROM history_progress WHERE item_id=? AND source='collaboration'")
      .get(f.item.id)?.revision,
  ).toBe(3);
});
