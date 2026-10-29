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
import type { DiagnosticEvent, DiagnosticContext } from '@spinel/diagnostics';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(
  diagnostics?: (event: DiagnosticEvent, context: DiagnosticContext, actorId?: string) => void,
) {
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
  const collaboration = new CollaborationStore(workspace, path, { diagnostics });
  cleanup.push(() => collaboration.close());
  const history = new HistoryStore(workspace, collaboration, undefined, diagnostics);
  cleanup.push(() => history.close());
  await collaboration.prepare(owner.id, item.id);
  let request = 0;
  const edit = async (value: string, user = owner.id) => {
    const data = await collaboration.load(user, item.id);
    const result = await collaboration.submitChangeset(
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

test('checkpoint outcomes and one restore outcome preserve content across concurrent and receipt retries', async () => {
  const observations: { event: DiagnosticEvent; context: DiagnosticContext; actorId?: string }[] =
    [];
  let broken = false;
  const f = await fixture((event, context, actorId) => {
    if (broken) throw new Error('Observer failure must not change history.');
    observations.push({ event, context, actorId });
  });
  const baseline = f.history.list(f.owner.id, f.item.id)[0];
  await f.edit('Private edited content');
  await f.history.capture(f.owner.id, f.item.id);
  await f.history.capture(f.owner.id, f.item.id);
  const captured = observations.filter(({ event }) => event.name === 'history.checkpoint');
  expect(captured.map(({ event }) => event.details)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ outcome: 'captured', reason: 'capture' }),
      expect.objectContaining({ outcome: 'skipped', reason: 'unchanged' }),
    ]),
  );
  expect(captured.every(({ actorId }) => actorId === undefined)).toBe(true);
  broken = true;
  await f.edit('Saved even when observations throw');
  await expect(f.history.capture(f.owner.id, f.item.id)).resolves.toBeUndefined();
  const latest = f.history.list(f.owner.id, f.item.id)[0];
  const snapshot = (await f.history.load(f.owner.id, f.item.id, latest.id)) as IWorkbookData;
  expect(snapshot.sheets.first.cellData?.[0]?.[0]?.v).toBe('Saved even when observations throw');
  broken = false;
  const requestId = randomUUID();
  const restore = () => f.history.restore(f.owner.id, f.item.id, baseline.id, f.item.id, requestId);
  const [one, two] = await Promise.all([restore(), restore()]);
  expect(two).toEqual(one);
  expect(await restore()).toEqual(one);
  const restored = observations.filter(
    ({ event }) =>
      event.name === 'operation.result' && event.details.operation === 'snapshot-restore',
  );
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({
    actorId: f.owner.id,
    context: { fileId: f.item.id },
    event: { details: { outcome: 'success' } },
  });
  expect(JSON.stringify(observations)).not.toContain('Private edited content');
});

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

test('a generation switch during metadata scan cannot mix an old sync head with the new offset', async () => {
  const f = await fixture();
  await f.edit('Before restoration');
  const baseline = f.history.list(f.owner.id, f.item.id).at(-1)!;
  const original = f.collaboration.headRevision.bind(f.collaboration);
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let once = true;
  vi.spyOn(f.collaboration, 'headRevision').mockImplementation(async (...args) => {
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
