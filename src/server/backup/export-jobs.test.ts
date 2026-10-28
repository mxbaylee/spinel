import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync, openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { makeArchive, privateFile, readKey, restoreArchive } from './archive.ts';
import * as archives from './archive.ts';
import { filesystemIdentity } from './filesystem.ts';
import { BackupService } from './service.ts';

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const image = `sha256:${'a'.repeat(64)}`;
async function fixture(filesystem = false) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-manual-backup-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'spinel.sqlite'),
    db = openDatabase(databasePath);
  cleanups.push(() => {
    if (db.isOpen) db.close();
  });
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner');
  workspace.create(owner.id, { name: 'Private workspace document', kind: 'doc', parentId: null });
  const key = randomBytes(32),
    keyFile = join(directory, 'key');
  const runtimeEnvironmentFile = join(directory, 'runtime.env'),
    configPath = join(directory, 'backups.json');
  await writeFile(keyFile, key, { mode: 0o600 });
  await writeFile(runtimeEnvironmentFile, 'RECOVERY_SENTINEL=private-runtime\n', { mode: 0o600 });
  const root = join(directory, 'destination');
  if (filesystem) await mkdir(root, { mode: 0o700 });
  const config = {
    version: 1,
    type: filesystem ? 'filesystem' : 'manual',
    ...(filesystem ? await filesystemIdentity(root) : {}),
    prefix: 'workspace',
    keyFile,
    runtimeEnvironmentFile,
    keyId: 'active-key',
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  let now = Date.parse('2020-01-01T02:00:00.000Z');
  const options = {
    databasePath,
    origin: 'https://spinel.example',
    image,
    configPath,
    now: () => now,
  };
  const service = new BackupService(db, options);
  cleanups.push(() => service.close());
  return {
    directory,
    db,
    options,
    service,
    key,
    keyFile,
    config,
    configPath,
    root,
    advance: (ms: number) => {
      now += ms;
    },
    staging: async () =>
      (await readdir(directory)).filter((name) => name.startsWith('.backup-export-')),
  };
}
async function settled(service: BackupService, session = 'session-a') {
  await expect
    .poll(async () => (await service.exports.current(session))?.state, { timeout: 10_000 })
    .not.toBe('preparing');
  return (await service.exports.current(session))!;
}

test('manual-only workspace export restores real WAL data and never claims automatic publication or offsite coverage', async () => {
  const f = await fixture();
  await f.service.start();
  await f.service.tick();
  expect(f.service.status()).toMatchObject({
    destination: null,
    offsite: false,
    lastGood: null,
    policy: { automatic: false, manualReady: true, manualDownload: true },
    overdue: false,
  });
  const job = await f.service.exports.create('session-a');
  expect(job.state).toBe('preparing');
  expect(await f.service.exports.current('session-b')).toBeNull();
  expect((await settled(f.service)).state).toBe('ready');
  const delivery = await f.service.exports.claim('session-a', job.id);
  const bytes = await readFile(delivery.path);
  expect(bytes.subarray(0, 8).toString()).toBe('SPINEL01');
  expect(bytes.includes(Buffer.from('Private workspace document'))).toBe(false);
  expect(bytes.includes(f.key)).toBe(false);
  expect((await stat(delivery.path)).mode & 0o777).toBe(0o600);
  const destination = join(f.directory, 'restored');
  const recovery = await restoreArchive(delivery.path, f.key, f.directory, destination, {
    requireInventory: true,
  });
  expect(recovery.keyId).toBe('active-key');
  const restored = new DatabaseSync(join(destination, 'spinel.sqlite'));
  try {
    expect(restored.prepare('SELECT name FROM workspace_items').all()).toEqual([
      { name: 'Private workspace document' },
    ]);
  } finally {
    restored.close();
  }
  await delivery.finish(true);
  expect((await f.service.exports.current('session-a'))?.state).toBe('delivered');
  expect(await f.staging()).toEqual([]);
  expect(f.service.state()).toMatchObject({
    last_good: null,
    last_attempt: null,
    lease: 0,
    owner: null,
  });
});

test('session ownership, concurrent creates and the shared scheduled-job lease protect the single staged archive', async () => {
  const f = await fixture(true);
  const results = await Promise.allSettled([
    f.service.exports.create('session-a'),
    f.service.exports.create('session-b'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const session = results[0].status === 'fulfilled' ? 'session-a' : 'session-b';
  const other = session === 'session-a' ? 'session-b' : 'session-a';
  const job = await settled(f.service, session);
  const second = new BackupService(f.db, f.options);
  cleanups.push(() => second.close());
  await second.start();
  expect(await f.service.run()).toBe(false);
  expect(await second.run()).toBe(false);
  await expect(f.service.exports.claim(other, job.id)).rejects.toMatchObject({ status: 404 });
  await expect(f.service.exports.cancel(other, job.id)).rejects.toMatchObject({ status: 404 });
  await expect(second.exports.create('another-session')).rejects.toMatchObject({ status: 409 });
  const download = await f.service.exports.claim(session, job.id);
  await expect(f.service.exports.claim(session, job.id)).rejects.toMatchObject({ status: 409 });
  await download.finish(true);
  expect(await f.service.run()).toBe(true);
});

test('cancel during real preparation, delivery abort and ready expiry clean private staging and preserve terminal outcomes', async () => {
  const f = await fixture();
  const original = archives.makeArchive;
  let entered!: () => void, release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const spy = vi.spyOn(archives, 'makeArchive').mockImplementationOnce(async (...args) => {
    entered();
    await barrier;
    return original(...args);
  });
  const first = await f.service.exports.create('session-a');
  await started;
  const cancelling = f.service.exports.cancel('session-a', first.id);
  release();
  expect((await cancelling).state).toBe('cancelled');
  expect(await f.staging()).toEqual([]);
  spy.mockRestore();
  const second = await f.service.exports.create('session-a');
  await settled(f.service);
  const claim = await f.service.exports.claim('session-a', second.id);
  await f.service.exports.cancel('session-a', second.id);
  expect(claim.signal.aborted).toBe(true);
  await claim.finish(false);
  expect((await f.service.exports.current('session-a'))?.state).toBe('cancelled');
  const third = await f.service.exports.create('session-a');
  await settled(f.service);
  f.advance(10 * 60_000 + 1);
  expect((await f.service.exports.current('session-a'))?.state).toBe('expired');
  await expect(f.service.exports.claim('session-a', third.id)).rejects.toMatchObject({
    status: 409,
  });
  expect(await f.staging()).toEqual([]);
});

test('key and image failures stay private and bounded archive creation removes partial ciphertext and plaintext', async () => {
  const f = await fixture();
  await writeFile(f.keyFile, 'bad key');
  await f.service.exports.create('session-a');
  const failed = await settled(f.service);
  expect(failed.state).toBe('failed');
  expect(JSON.stringify(failed)).not.toContain(f.directory);
  expect(await f.staging()).toEqual([]);
  expect(f.service.status().policy.manualReady).toBe(false);
  await writeFile(f.keyFile, f.key);
  const noImage = new BackupService(f.db, { ...f.options, image: undefined });
  cleanups.push(() => noImage.close());
  await noImage.exports.create('session-b');
  expect((await settled(noImage, 'session-b')).state).toBe('failed');
  f.db.exec('CREATE TABLE large_fixture (id INTEGER PRIMARY KEY, payload BLOB)');
  f.db.prepare('INSERT INTO large_fixture VALUES(?,?)').run(1, randomBytes(256 * 1024));
  await expect(
    makeArchive(
      f.db,
      f.directory,
      f.key,
      {
        format: 1,
        createdAt: new Date().toISOString(),
        origin: f.options.origin,
        image,
        runtimeEnvironment: '',
      },
      { maxArchiveBytes: 64 * 1024 },
    ),
  ).rejects.toMatchObject({ code: 'archive-size' });
  expect((await readdir(f.directory)).filter((name) => name.startsWith('.backup-'))).toEqual([]);
});

test('complete catalog points have opaque identity and selected artifacts stay held against retention until delivery finishes', async () => {
  const f = await fixture(true);
  expect(await f.service.run()).toBe(true);
  const source = (await readdir(join(f.root, 'workspace'))).find((name) =>
    name.endsWith('.spinel'),
  )!;
  await writeFile(join(f.root, 'workspace', 'incomplete.spinel.pending'), 'partial');
  await writeFile(join(f.root, 'workspace', 'not-a-backup.spinel'), 'partial');
  f.advance(365 * 24 * 3600_000);
  const catalog = await f.service.exports.catalog();
  expect(catalog.entries).toHaveLength(1);
  expect(catalog.entries[0]).toEqual({
    id: expect.stringMatching(/^[a-f0-9]{64}$/),
    createdAt: Date.parse('2020-01-01T02:00:00.000Z'),
  });
  expect(JSON.stringify(catalog)).not.toContain(source);
  const selected = await f.service.exports.create('session-a', catalog.entries[0].id);
  expect((await settled(f.service)).state).toBe('ready');
  expect(await f.service.run()).toBe(false);
  const delivery = await f.service.exports.claim('session-a', selected.id);
  expect(await readFile(delivery.path)).toEqual(await readFile(join(f.root, 'workspace', source)));
  await delivery.finish(true);
  expect(await f.service.run()).toBe(true);
  expect(await readdir(join(f.root, 'workspace'))).not.toContain(source);
  await expect(f.service.exports.create('session-a', '../arbitrary')).rejects.toMatchObject({
    status: 400,
  });
});

test('changed or corrupt catalog bytes cannot be delivered, and old recovery keys remain usable', async () => {
  const f = await fixture(true);
  expect(await f.service.run()).toBe(true);
  const entry = (await f.service.exports.catalog()).entries[0];
  const newKeyFile = join(f.directory, 'new-key');
  await writeFile(newKeyFile, randomBytes(32), { mode: 0o600 });
  await writeFile(
    f.configPath,
    JSON.stringify({
      ...f.config,
      keyFile: newKeyFile,
      keyId: 'new-key',
      retainedKeyFiles: { 'active-key': f.keyFile },
    }),
    { mode: 0o600 },
  );
  const retained = await f.service.exports.create('session-a', entry.id);
  expect(await settled(f.service)).toMatchObject({ state: 'ready', keyId: 'active-key' });
  await f.service.exports.cancel('session-a', retained.id);
  const source = (await readdir(join(f.root, 'workspace'))).find((name) =>
    name.endsWith('.spinel'),
  )!;
  const path = join(f.root, 'workspace', source),
    damaged = await readFile(path);
  damaged[30] ^= 1;
  await writeFile(path, damaged);
  const corrupt = await f.service.exports.create('session-a', entry.id);
  expect((await settled(f.service)).state).toBe('failed');
  await expect(f.service.exports.claim('session-a', corrupt.id)).rejects.toMatchObject({
    status: 409,
  });
  expect(await f.staging()).toEqual([]);
  expect(await readFile(path)).toEqual(damaged);
});

test('restart reconciles dead job staging without touching another database, live job or symlink', async () => {
  const f = await fixture();
  const job = await f.service.exports.create('session-a');
  await settled(f.service);
  const staging = (await f.staging())[0];
  const otherDbPath = join(f.directory, 'other.sqlite'),
    otherDb = openDatabase(otherDbPath);
  cleanups.push(() => otherDb.close());
  const other = new BackupService(otherDb, { ...f.options, databasePath: otherDbPath });
  cleanups.push(() => other.close());
  await other.exports.create('other-session');
  await settled(other, 'other-session');
  const names = await f.staging();
  const otherStaging = names.find((name) => name !== staging)!;
  // Model a killed process's persisted lease and existing directory. The new
  // service may clean only this database's generated namespace after claiming it.
  f.db
    .prepare(
      "UPDATE backup_state SET owner='export:2147483647:00000000-0000-4000-8000-000000000000' WHERE id=1",
    )
    .run();
  const outside = join(f.directory, 'unrelated');
  await mkdir(outside);
  await writeFile(join(outside, 'keep'), 'retained');
  const alias = `${staging.replace(/-[A-Za-z0-9]+$/, '')}-alias`;
  await symlink(outside, join(f.directory, alias));
  const restarted = new BackupService(f.db, f.options);
  cleanups.push(() => restarted.close());
  await restarted.start();
  expect(await f.staging()).not.toContain(staging);
  expect(await f.staging()).toContain(otherStaging);
  expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('retained');
  expect(await restarted.exports.current('session-a')).toBeNull();
  await f.service.exports.cancel('session-a', job.id);
});

test('policy disable blocks downloads and disabling automatic policy preserves independently requested CLI backup', async () => {
  const f = await fixture(true);
  await f.service.start();
  await f.service.tick();
  expect(f.service.status().lastGood).toBeNull();
  expect(await f.service.run()).toBe(true);
  const ready = await f.service.exports.create('session-a');
  await settled(f.service);
  await writeFile(f.configPath, JSON.stringify({ ...f.config, manualDownload: false }), {
    mode: 0o600,
  });
  await expect(f.service.exports.claim('session-a', ready.id)).rejects.toMatchObject({
    status: 403,
  });
  expect((await f.service.exports.current('session-a'))?.state).toBe('cancelled');
  expect(await f.staging()).toEqual([]);
  await f.service.tick();
  expect(f.service.status().policy).toMatchObject({
    automatic: false,
    manualDownload: false,
    manualReady: false,
  });
  await expect(f.service.exports.create('session-a')).rejects.toMatchObject({ status: 403 });
  await expect(f.service.exports.catalog()).rejects.toMatchObject({ status: 403 });
});

test('SIGKILL leaves a real ready archive which the next process startup removes without changing workspace data', async () => {
  const f = await fixture();
  const child = spawn(
    process.execPath,
    [
      '--max-old-space-size=128',
      new URL('./export-process-fixture.ts', import.meta.url).pathname,
      f.options.databasePath,
      f.configPath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk).slice(0, 1_000);
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    const state = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Fixture did not prepare a backup.')),
        15_000,
      );
      child.once('message', (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error(`Fixture exited before ready: ${stderr}`));
      });
    });
    expect(state).toEqual({ state: 'ready' });
    expect(await f.staging()).toHaveLength(1);
    const before = f.db.prepare('SELECT * FROM workspace_items').all();
    child.kill('SIGKILL');
    await exited;
    const restarted = new BackupService(f.db, f.options);
    cleanups.push(() => restarted.close());
    await restarted.start();
    expect(await f.staging()).toEqual([]);
    expect(restarted.state()).toMatchObject({ lease: 0, owner: null, last_good: null });
    expect(f.db.prepare('SELECT * FROM workspace_items').all()).toEqual(before);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
});

test('oversized private recovery files fail before snapshot creation and never allocate their full sparse size', async () => {
  const f = await fixture();
  // Sparse deployment files exercise the size boundary without allocating their
  // contents in the test or relaxing the application's memory budget.
  await truncate(f.keyFile, 32 * 1024 ** 2);
  await expect(readKey(f.keyFile)).rejects.toThrow('size limit');
  await f.service.exports.create('session-a');
  expect((await settled(f.service)).state).toBe('failed');
  expect(await f.staging()).toEqual([]);
  await writeFile(f.keyFile, f.key);
  const runtime = f.config.runtimeEnvironmentFile;
  await truncate(runtime, 64 * 1024 ** 2);
  await expect(privateFile(runtime)).rejects.toThrow('size limit');
  await f.service.exports.create('session-a');
  expect((await settled(f.service)).state).toBe('failed');
  expect(await f.staging()).toEqual([]);
  expect(f.service.status().policy.manualReady).toBe(false);
});

test('a source beyond the restore envelope is refused before a snapshot can consume disk', async () => {
  const f = await fixture();
  const original = f.db.prepare.bind(f.db);
  const prepare = vi.spyOn(f.db, 'prepare').mockImplementation((sql) => {
    const statement = original(sql);
    // The concrete SQLite source reports logical pages. Substitute that one
    // measurement to exercise the 8 GiB preflight without allocating an 8 GiB DB.
    return sql === 'PRAGMA page_count'
      ? { ...statement, get: () => ({ page_count: 8 * 1024 ** 3 / 4096 + 1 }) }
      : sql === 'PRAGMA page_size'
        ? { ...statement, get: () => ({ page_size: 4096 }) }
        : statement;
  });
  await expect(makeArchive(f.db, f.directory, f.key, {
    format: 1, createdAt: new Date().toISOString(), origin: f.options.origin, image,
    runtimeEnvironment: '',
  })).rejects.toMatchObject({ code: 'database-size' });
  expect(prepare.mock.calls.some(([sql]) => sql.startsWith('VACUUM'))).toBe(false);
  expect((await readdir(f.directory)).some(name => name.startsWith('.backup-'))).toBe(false);
  prepare.mockRestore();
});
