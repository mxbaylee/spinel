import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import type { IDocumentData } from '@univerjs/core';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DocumentStore } from '../workspace/documents.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { makeArchive, restoreArchive } from '../backup/archive.ts';
import { HistoryStore } from './store.ts';
import { DAY, MINUTE } from './policy.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

// Native persistence must work without invoking the SDK. The real SDK path and
// migration are tested separately in store.test.ts; this fixture deliberately forbids it.
function nativeHistory(workspace: WorkspaceStore) {
  workspace.auth.database.exec(`CREATE TABLE IF NOT EXISTS workspace_collaboration (
    item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE, state TEXT NOT NULL
  ) STRICT;`);
  const subscribe = () => ({ dispose() {} });
  const collaboration = {
    onPrepared: subscribe,
    service: { use: subscribe, on: subscribe },
    load: () => {
      throw new Error('A native save must not call the collaboration runtime.');
    },
  } as unknown as CollaborationStore;
  const history = new HistoryStore(workspace, collaboration);
  cleanup.push(() => history.close());
  return history;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-native-history-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite');
  const db = openDatabase(path);
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  let clock = Date.UTC(2026, 9, 1);
  auth.now = () => clock;
  const owner = auth.createUser('Owner'),
    viewer = auth.createUser('Viewer');
  const item = workspace.create(owner.id, { kind: 'doc', name: 'Native history', parentId: null });
  workspace.share(owner.id, item.id, viewer.id, 'viewer');
  const docs = new DocumentStore(workspace);
  const history = nativeHistory(workspace);
  let revision = 0;
  const save = (text: string, extra: Partial<IDocumentData> = {}) => {
    const snapshot = { id: item.id, body: { dataStream: text + '\r\n' }, ...extra };
    const result = docs.save(owner.id, item.id, { snapshot, revision, writeId: randomUUID() });
    revision = result.revision;
    return snapshot;
  };
  return {
    directory,
    path,
    db,
    auth,
    workspace,
    owner,
    viewer,
    item,
    docs,
    history,
    save,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

test('native saves preserve a baseline, idle and five-minute checkpoints without weakening stale-write checks', async () => {
  const f = await fixture();
  f.save('first');
  f.save('second');
  expect(f.history.list(f.owner.id, f.item.id).map((p) => p.revision)).toEqual([1]);
  f.advance(MINUTE);
  await f.history.tick();
  expect(f.history.list(f.owner.id, f.item.id).map((p) => p.revision)).toEqual([2, 1]);
  const old = f.history.list(f.owner.id, f.item.id)[1];
  expect(
    ((await f.history.load(f.viewer.id, f.item.id, old.id)) as IDocumentData).body?.dataStream,
  ).toBe('first\r\n');
  for (let i = 1; i <= 10; i++) {
    f.advance(30_000);
    f.save(`continuous ${i}`);
    await f.history.tick();
    expect(f.history.list(f.owner.id, f.item.id)).toHaveLength(i === 10 ? 3 : 2);
  }
  const snapshot = { id: f.item.id, body: { dataStream: 'stale\r\n' } };
  expect(() =>
    f.docs.save(f.owner.id, f.item.id, { snapshot, revision: 1, writeId: randomUUID() }),
  ).toThrow('newer version');
  expect(f.docs.load(f.owner.id, f.item.id).snapshot?.body?.dataStream).toBe('continuous 10\r\n');
  f.workspace.share(f.owner.id, f.item.id, f.viewer.id, null);
  await expect(f.history.load(f.viewer.id, f.item.id, old.id)).rejects.toThrow();
});

test('a pre-existing native snapshot is preserved before its first overwritten save', async () => {
  const f = await fixture();
  await f.history.close();
  f.save('before history was installed');
  const history = nativeHistory(f.workspace);
  f.save('after installation');
  const points = history.list(f.owner.id, f.item.id);
  expect(points.map((p) => p.revision)).toEqual([1]);
  expect(
    ((await history.load(f.owner.id, f.item.id, points[0].id)) as IDocumentData).body?.dataStream,
  ).toBe('before history was installed\r\n');
});

test('an edit during compression stays dirty and access is rechecked after decompression', async () => {
  const f = await fixture();
  f.save('baseline');
  f.advance(MINUTE);
  f.save('capturing');
  const capture = f.history.capture(f.owner.id, f.item.id, 'native');
  f.save('newer edit while compressing');
  await capture;
  expect(f.history.list(f.owner.id, f.item.id)[0].revision).toBe(2);
  f.advance(MINUTE);
  await f.history.tick();
  const point = f.history.list(f.owner.id, f.item.id)[0];
  expect(point.revision).toBe(3);
  expect(
    ((await f.history.load(f.owner.id, f.item.id, point.id)) as IDocumentData).body?.dataStream,
  ).toBe('newer edit while compressing\r\n');
  const reading = f.history.load(f.viewer.id, f.item.id, point.id);
  f.workspace.share(f.owner.id, f.item.id, f.viewer.id, null);
  await expect(reading).rejects.toThrow();
});

test('native capture respects a migration fence installed during compression and stale scheduler selection', async () => {
  const f = await fixture();
  f.save('baseline');
  f.save('second');
  const capturing = f.history.capture(f.owner.id, f.item.id, 'native');
  f.save('third');
  // This is the same synchronous fence written before the SDK migration first yields.
  f.db.prepare("INSERT INTO workspace_collaboration VALUES(?,'preparing')").run(f.item.id);
  await capturing;
  expect(f.history.list(f.owner.id, f.item.id).map((p) => p.revision)).toEqual([1]);
  f.db.prepare("UPDATE workspace_collaboration SET state='ready' WHERE item_id=?").run(f.item.id);
  await f.history.capture(f.owner.id, f.item.id, 'native');
  expect(f.history.list(f.owner.id, f.item.id).map((p) => p.revision)).toEqual([1]);
});

test('retained history and its removed image survive pruning and an authenticated backup restore', async () => {
  const f = await fixture();
  const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#8833bb' } })
    .png()
    .toBuffer();
  const image = await f.docs.upload(f.owner.id, f.item.id, png, 'image/png');
  const drawing = { drawingType: 0, imageSourceType: 'URL', source: image.url };
  f.save('with image', {
    resources: [{ name: 'DOC_DRAWING_PLUGIN', data: JSON.stringify({ image: drawing }) }],
  });
  const point = f.history.list(f.owner.id, f.item.id)[0];
  // A named version is never pruned, even when a newer snapshot replaces its daily slot.
  f.db.prepare('UPDATE history_checkpoints SET name=? WHERE id=?').run('Original image', point.id);
  f.advance(MINUTE);
  f.save('image removed');
  f.advance(MINUTE);
  await f.history.tick();
  f.advance(7 * DAY);
  await f.history.tick();
  expect(f.docs.load(f.owner.id, f.item.id).snapshot?.resources).toBeUndefined();
  expect(
    ((await f.history.load(f.viewer.id, f.item.id, point.id)) as IDocumentData).resources?.[0].data,
  ).toContain(image.url);
  const key = randomBytes(32);
  const archive = await makeArchive(f.db, f.directory, key, {
    format: 1,
    createdAt: new Date(f.now()).toISOString(),
    origin: 'https://spinel.example.test',
    image: `sha256:${'a'.repeat(64)}`,
    runtimeEnvironment: 'NODE_ENV=production',
  });
  cleanup.push(() => archive.dispose());
  const destination = join(f.directory, 'restored');
  await restoreArchive(archive.archive, key, f.directory, destination);
  const restored = openDatabase(join(destination, 'spinel.sqlite'));
  cleanup.push(() => restored.close());
  const auth = new AuthStore(restored),
    workspace = new WorkspaceStore(auth);
  const history = nativeHistory(workspace),
    docs = new DocumentStore(workspace);
  expect(
    ((await history.load(f.viewer.id, f.item.id, point.id)) as IDocumentData).resources?.[0].data,
  ).toContain(image.url);
  expect(Buffer.from(docs.image(f.viewer.id, f.item.id, image.id).data)).toEqual(
    Buffer.from(f.docs.image(f.owner.id, f.item.id, image.id).data),
  );
  restored.prepare('DELETE FROM workspace_items WHERE id=?').run(f.item.id);
  expect(restored.prepare('SELECT count(*) AS n FROM history_checkpoints').get()?.n).toBe(0);
  expect(restored.prepare('SELECT count(*) AS n FROM doc_images').get()?.n).toBe(0);
});

test('a busy week of 64 KiB native documents stays below the documented history storage budget', async () => {
  const f = await fixture();
  const text = Array.from({ length: 1024 }, (_, i) =>
    createHash('sha256').update(String(i)).digest('hex'),
  ).join('');
  expect(Buffer.byteLength(text)).toBe(64 * 1024);
  f.save(text);
  for (let i = 0; i < (7 * DAY) / (5 * MINUTE); i++) {
    f.advance(5 * MINUTE);
    f.save(text + i);
    await f.history.tick();
  }
  const stored = f.db
    .prepare('SELECT count(*) AS n,sum(length(snapshot)) AS bytes FROM history_checkpoints')
    .get() as { n: number; bytes: number };
  expect(stored.n).toBeLessThanOrEqual(64);
  expect(stored.bytes).toBeLessThan(4 * 1024 * 1024);
  f.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  // This is a representative history-overhead budget, not a limit on SDK operational data or images.
  expect((await stat(join(dirname(f.path), 'app.sqlite'))).size).toBeLessThan(8 * 1024 * 1024);
}, 30_000);

test('naming captures the current confirmed state, renaming pins history, and unname returns to pruning', async () => {
  const f = await fixture();
  f.save('original');
  const original = f.history.list(f.owner.id, f.item.id)[0];
  f.history.rename(f.owner.id, f.item.id, original.id, 'Original');
  f.save('before pending background capture');
  const background = f.history.capture(f.owner.id, f.item.id, 'native');
  f.save('named current state');
  const named = await f.history.nameCurrent(f.owner.id, f.item.id, '  Q3 Final Lock  ');
  await background;
  expect(named.name).toBe('Q3 Final Lock');
  expect(named.revision).toBe(3);
  expect(
    ((await f.history.load(f.viewer.id, f.item.id, named.id)) as IDocumentData).body?.dataStream,
  ).toBe('named current state\r\n');
  const renamed = await f.history.nameCurrent(f.owner.id, f.item.id, 'Final');
  expect(renamed.id).toBe(named.id);
  f.advance(10 * MINUTE);
  f.save('later');
  const newest = await f.history.nameCurrent(f.owner.id, f.item.id, 'Later');
  f.history.rename(f.owner.id, f.item.id, newest.id, null);
  f.advance(2 * DAY);
  f.history.prune();
  // Named entries never occupy the unnamed daily retention slot (decision #56).
  expect(f.history.list(f.owner.id, f.item.id).map((p) => p.id)).toEqual([
    newest.id,
    named.id,
    original.id,
  ]);
  f.history.rename(f.owner.id, f.item.id, named.id, null);
  f.history.rename(f.owner.id, f.item.id, original.id, null);
  f.history.prune();
  expect(f.history.list(f.owner.id, f.item.id).map((p) => p.id)).toEqual([newest.id]);
});

test('version names enforce edit permission, bounded names and current access after compression', async () => {
  const f = await fixture();
  f.save('protected');
  const point = f.history.list(f.owner.id, f.item.id)[0];
  for (const invalid of ['', '   ', 'x'.repeat(121), 4, undefined]) {
    await expect(f.history.nameCurrent(f.owner.id, f.item.id, invalid)).rejects.toThrow(
      'version name',
    );
    expect(() => f.history.rename(f.owner.id, f.item.id, point.id, invalid)).toThrow(
      'version name',
    );
  }
  await expect(f.history.nameCurrent(f.viewer.id, f.item.id, 'Denied')).rejects.toThrow();
  expect(() => f.history.rename(f.viewer.id, f.item.id, point.id, 'Denied')).toThrow();
  expect(() => f.history.rename(f.owner.id, f.item.id, 'missing', 'Denied')).toThrow(
    'Version not found',
  );
  f.workspace.share(f.owner.id, f.item.id, f.viewer.id, 'editor');
  const pending = f.history.nameCurrent(f.viewer.id, f.item.id, 'Revoked');
  f.workspace.share(f.owner.id, f.item.id, f.viewer.id, 'viewer');
  await expect(pending).rejects.toThrow();
  await expect(
    f.history.nameCurrent(f.owner.id, f.item.id, 'Expired', () => {
      throw new Error('Expired session');
    }),
  ).rejects.toThrow('Expired session');
  expect(f.history.list(f.owner.id, f.item.id)[0].name).toBeNull();
});

test('naming retries a migration race instead of pinning an obsolete native copy', async () => {
  const f = await fixture();
  f.save('native');
  const pending = f.history.nameCurrent(f.owner.id, f.item.id, 'Racing');
  f.db.prepare("INSERT INTO workspace_collaboration VALUES(?,'preparing')").run(f.item.id);
  await expect(pending).rejects.toThrow('finished opening');
  await expect(f.history.nameCurrent(f.owner.id, f.item.id, 'Still preparing')).rejects.toThrow(
    'still opening',
  );
  expect(f.history.list(f.owner.id, f.item.id)[0].name).toBeNull();
});
