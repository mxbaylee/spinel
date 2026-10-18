import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from '../../../server/database.ts';
import { afterEach, expect, test, vi } from 'vitest';
import sharp from 'sharp';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { digest, makeArchive, readKey, restoreArchive } from './archive.ts';
import { expiredBackups } from './spaces.ts';
import { BackupService } from './service.ts';
import type { Recovery } from './archive.ts';
import type { RemoteStore } from './spaces.ts';

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanups.splice(0).reverse()) await close();
});
const image = `sha256:${'a'.repeat(64)}`;
const recovery: Recovery = {
  format: 1,
  createdAt: '2026-10-18T02:00:00.000Z',
  origin: 'https://spinel.example',
  image,
  runtimeEnvironment: 'LICENSE_KEY=private-fixture\n',
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-backup-test-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'source.sqlite');
  const db = openDatabase(path);
  cleanups.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner'),
    other = auth.createUser('Collaborator');
  auth.createUser('Operator', true);
  const sheet = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  const doc = workspace.create(owner.id, { name: 'Journal', kind: 'doc', parentId: null });
  const sheets = new SheetStore(workspace),
    docs = new DocumentStore(workspace);
  sheets.save(owner.id, sheet.id, {
    revision: 0,
    writeId: randomUUID(),
    snapshot: {
      id: sheet.id,
      name: 'Budget',
      sheetOrder: ['a'],
      sheets: { a: { id: 'a', cellData: { 0: { 0: { v: 42 } } } } },
    },
  });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#e4a' } })
    .png()
    .toBuffer();
  const picture = await docs.upload(owner.id, doc.id, bytes, 'image/png');
  docs.save(owner.id, doc.id, {
    revision: 0,
    writeId: randomUUID(),
    snapshot: {
      id: doc.id,
      body: { dataStream: 'Private journal\r\n' },
      drawings: { image: { source: picture.url } },
    },
  });
  workspace.share(owner.id, doc.id, other.id, 'viewer');
  db.prepare(
    "INSERT INTO auth_passkeys VALUES (?, ?, ?, 7, '[]', 'Browser', 'browser', 100, NULL, 1, 'multiDevice')",
  ).run('credential', owner.id, Buffer.from('public-key'));
  // History has not shipped yet; preserving unknown tables prevents future snapshots being omitted.
  db.exec(
    "CREATE TABLE future_history (id TEXT PRIMARY KEY, data TEXT); INSERT INTO future_history VALUES ('version', 'older content')",
  );
  return { directory, path, db };
}
function allRows(db: DatabaseSync) {
  return Object.fromEntries(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('spinel_recovery','backup_state') ORDER BY name",
      )
      .all()
      .map(({ name }) => [
        String(name),
        db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`).all(),
      ]),
  );
}
test('online WAL backup restores every table, native snapshots, image bytes, credentials, grants and recovery configuration', async () => {
  const f = await fixture(),
    key = randomBytes(32),
    before = allRows(f.db);
  const backup = await makeArchive(f.db, f.directory, key, recovery);
  cleanups.push(backup.dispose);
  const bytes = await readFile(backup.archive);
  expect(bytes.includes(Buffer.from('Private journal'))).toBe(false);
  expect(bytes.includes(Buffer.from('private-fixture'))).toBe(false);
  expect((await stat(backup.archive)).mode & 0o777).toBe(0o600);
  expect(await digest(backup.archive)).toBe(backup.sha256);
  f.db.exec("UPDATE future_history SET data='after backup'");
  const destination = join(f.directory, 'restored');
  expect(await restoreArchive(backup.archive, key, f.directory, destination)).toEqual(recovery);
  const restored = new DatabaseSync(join(destination, 'spinel.sqlite'));
  cleanups.push(() => restored.close());
  expect(allRows(restored)).toEqual(before);
  expect(JSON.parse(await readFile(join(destination, 'recovery.json'), 'utf8'))).toEqual(recovery);
  expect((await stat(destination)).mode & 0o777).toBe(0o700);
  await expect(restoreArchive(backup.archive, key, f.directory, destination)).rejects.toThrow();
  expect(allRows(restored)).toEqual(before);
});
test('wrong keys, ciphertext/tag/header tampering and truncation never publish a restore or leave plaintext staging', async () => {
  const f = await fixture(),
    key = randomBytes(32),
    backup = await makeArchive(f.db, f.directory, key, recovery);
  cleanups.push(backup.dispose);
  const bytes = await readFile(backup.archive),
    output = join(f.directory, 'bad');
  await expect(
    restoreArchive(backup.archive, randomBytes(32), f.directory, output),
  ).rejects.toThrow();
  for (const index of [0, 8, 30, bytes.length - 1]) {
    const changed = Buffer.from(bytes);
    changed[index] ^= 1;
    const corrupt = join(f.directory, `corrupt-${index}`);
    await writeFile(corrupt, changed);
    await expect(restoreArchive(corrupt, key, f.directory, output)).rejects.toThrow();
  }
  const truncated = join(f.directory, 'truncated');
  await writeFile(truncated, bytes.subarray(0, 25));
  await expect(restoreArchive(truncated, key, f.directory, output)).rejects.toThrow();
  expect(
    (await readdir(f.directory)).filter((x) => x.startsWith('.restore-') || x === 'bad'),
  ).toEqual([]);
});
const objectKey = (date: string) =>
  `instance/${date}T02-00-00.000Z-00000000-0000-4000-8000-000000000000.spinel`;
test('calendar retention keeps 7 daily, 4 weekly and 6 monthly points, plus newest and unknown objects', () => {
  const now = new Date('2026-10-18T03:00:00Z'),
    keys: string[] = [];
  for (let i = 0; i < 240; i++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - i);
    keys.push(objectKey(date.toISOString().slice(0, 10)));
  }
  const keep = keys
    .filter((k) => !expiredBackups(keys, 'instance', now).includes(k))
    .map((k) => k.slice(9, 19))
    .sort();
  // Monday weeks, UTC calendar months, and overlapping tiers intentionally share a backup.
  expect(keep).toEqual([
    '2026-05-31',
    '2026-06-30',
    '2026-07-31',
    '2026-08-31',
    '2026-09-27',
    '2026-09-30',
    '2026-10-04',
    '2026-10-11',
    '2026-10-12',
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
  ]);
  expect(
    expiredBackups(
      [
        objectKey('2020-01-01'),
        'other/file',
        'instance/not-backup',
        `${objectKey('2020-01-02')}.pending`,
      ],
      'instance',
      now,
    ),
  ).toEqual([]);
});
async function serviceFixture(remote: RemoteStore) {
  const f = await fixture(),
    keyPath = join(f.directory, 'key'),
    configPath = join(f.directory, 'config'),
    runtime = join(f.directory, 'runtime');
  await writeFile(keyPath, randomBytes(32), { mode: 0o600 });
  await writeFile(runtime, '', { mode: 0o600 });
  await writeFile(
    configPath,
    JSON.stringify({
      region: 'nyc3',
      bucket: 'test-bucket',
      prefix: 'instance',
      accessKeyId: 'fixture',
      secretAccessKey: 'SECRET-NOT-IN-STATUS',
      keyFile: keyPath,
      runtimeEnvironmentFile: runtime,
    }),
    { mode: 0o600 },
  );
  let now = Date.parse('2026-10-18T03:00:00Z');
  const options = {
    databasePath: f.path,
    configPath,
    origin: recovery.origin,
    image,
    remote: () => remote,
    now: () => now,
  };
  const service = new BackupService(f.db, options);
  cleanups.push(() => service.close());
  return {
    ...f,
    service,
    options,
    keyPath,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test('failed upload preserves last good time and objects, errors survive restart without secrets; retry succeeds', async () => {
  let fail = false;
  const uploaded: string[] = [],
    removed: string[] = [];
  const remote: RemoteStore = {
    async put(key) {
      if (fail) throw new Error('SECRET-NOT-IN-STATUS');
      uploaded.push(key);
    },
    async list() {
      return [objectKey('2020-01-01'), ...uploaded];
    },
    async remove(key) {
      removed.push(key);
    },
  };
  const f = await serviceFixture(remote);
  expect(await f.service.run()).toBe(true);
  const good = f.service.status().lastGood;
  expect(removed).toEqual([objectKey('2020-01-01')]);
  fail = true;
  removed.length = 0;
  f.advance(27 * 3600_000);
  expect(await f.service.run()).toBe(false);
  expect(f.service.status()).toMatchObject({ lastGood: good, running: false, overdue: true });
  expect(JSON.stringify(f.service.status())).not.toContain('SECRET');
  expect(removed).toEqual([]);
  const restarted = new BackupService(f.db, f.options);
  expect(restarted.status().error).toContain('failed');
  fail = false;
  expect(await restarted.run()).toBe(true);
  expect(restarted.status()).toMatchObject({ error: null, overdue: false });
  expect((await readdir(f.directory)).filter((x) => x.startsWith('.backup-'))).toEqual([]);
});
test('shared lease prevents overlap and shutdown waits for an in-flight upload', async () => {
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    });
  const f = await serviceFixture({
    async put() {
      entered();
      await blocked;
    },
    async list() {
      return [];
    },
    async remove() {},
  });
  const run = f.service.run();
  await started;
  const second = new BackupService(f.db, f.options);
  expect(await second.run()).toBe(false);
  expect(f.service.run()).toBe(run);
  let closed = false;
  const close = f.service.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  expect(await run).toBe(true);
  await close;
  expect(f.service.status().running).toBe(false);
});
test('scheduler catches missed nights, avoids duplicate runs and retries failures hourly', async () => {
  const f = await serviceFixture({
    async put() {},
    async list() {
      return [];
    },
    async remove() {},
  });
  vi.useFakeTimers();
  const run = vi.spyOn(f.service, 'run').mockImplementation(async () => {
    f.db
      .prepare('UPDATE backup_state SET last_attempt=?, last_good=? WHERE id=1')
      .run(f.options.now(), f.options.now());
    return true;
  });
  f.service.start();
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(1);
  f.advance(24 * 3600_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(2);
  f.db.exec('UPDATE backup_state SET last_good=NULL');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(2);
  f.advance(3600_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(3);
  await f.service.close();
});
test('private keys reject permissive permissions and invalid length', async () => {
  const f = await fixture(),
    path = join(f.directory, 'key');
  await writeFile(path, randomBytes(32), { mode: 0o600 });
  expect((await readKey(path)).length).toBe(32);
  await chmod(path, 0o644);
  await expect(readKey(path)).rejects.toThrow('private');
  await chmod(path, 0o600);
  await writeFile(path, 'short');
  await expect(readKey(path)).rejects.toThrow('32');
});

test('retention failure retries hourly even after a verified upload sets lastGood', async () => {
  let fail = true,
    puts = 0,
    lists = 0;
  const f = await serviceFixture({
    async put() {
      puts++;
    },
    async list() {
      lists++;
      if (fail) throw new Error('retention unavailable');
      return [];
    },
    async remove() {},
  });
  expect(await f.service.run()).toBe(false);
  const good = f.service.status().lastGood;
  expect(good).not.toBeNull();
  expect(f.service.status().error).toContain('failed');
  vi.useFakeTimers();
  f.service.start();
  expect(puts).toBe(1);
  f.advance(3600_000);
  fail = false;
  await vi.advanceTimersByTimeAsync(60_000);
  await f.service.active;
  expect({ puts, lists }).toEqual({ puts: 2, lists: 2 });
  expect(f.service.status().error).toBeNull();
  await f.service.close();
});
