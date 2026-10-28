import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { filesystemIdentity } from './filesystem.ts';
import { createDestination } from './destination.ts';
import { BackupService } from './service.ts';
import type { BackupConfig } from './config.ts';
import * as verification from './verification.ts';
import * as archives from './archive.ts';
import { RecoveryResourceError } from './resource-error.ts';

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
const image = `sha256:${'a'.repeat(64)}`;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-scheduled-recovery-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'backups');
  await mkdir(root, { mode: 0o700 });
  const path = join(directory, 'spinel.sqlite'),
    db = openDatabase(path);
  cleanups.push(() => {
    if (db.isOpen) db.close();
  });
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner'),
    collaborator = auth.createUser('Collaborator');
  auth.createUser('Operator', true);
  const sheets = new SheetStore(workspace),
    documents = new DocumentStore(workspace);
  const sheet = workspace.create(owner.id, {
    name: 'Recoverable budget',
    kind: 'sheet',
    parentId: null,
  });
  const doc = workspace.create(owner.id, {
    name: 'Recoverable notes',
    kind: 'doc',
    parentId: null,
  });
  sheets.save(owner.id, sheet.id, {
    revision: 0,
    writeId: randomUUID(),
    snapshot: {
      id: sheet.id,
      name: 'Budget',
      sheetOrder: ['first'],
      sheets: { first: { id: 'first', cellData: { 0: { 0: { v: 42 } } } } },
    },
  });
  documents.save(owner.id, doc.id, {
    revision: 0,
    writeId: randomUUID(),
    snapshot: {
      id: doc.id,
      body: { dataStream: 'Private recovery fixture\r\n' },
    },
  });
  workspace.share(owner.id, doc.id, collaborator.id, 'viewer');
  const keyFile = join(directory, 'key'),
    configPath = join(directory, 'backup.json'),
    runtimeEnvironmentFile = join(directory, 'runtime');
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
  await writeFile(runtimeEnvironmentFile, 'NODE_ENV=production\n', { mode: 0o600 });
  const config = {
    type: 'filesystem' as const,
    ...(await filesystemIdentity(root)),
    prefix: 'local',
    keyFile,
    keyId: 'first',
    runtimeEnvironmentFile,
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  let now = Date.parse('2026-10-25T03:00:00Z');
  const options = {
    databasePath: path,
    configPath,
    origin: 'https://spinel.example',
    image,
    now: () => now,
  };
  const service = new BackupService(db, options);
  cleanups.push(() => service.close());
  return {
    directory,
    root,
    db,
    service,
    config,
    configPath,
    keyFile,
    options,
    advance: (ms: number) => {
      now += ms;
    },
    files: () => readdir(join(root, config.prefix)),
  };
}

test('verification requires the running application image and preserves its source when absent', async () => {
  const f = await fixture();
  expect(await f.service.run()).toBe(true);
  const files = await f.files();
  const unknownImage = new BackupService(f.db, { ...f.options, image: undefined });
  cleanups.push(() => unknownImage.close());
  expect(await unknownImage.verify()).toBe(false);
  expect(unknownImage.status().verification).toMatchObject({
    lastGood: null,
    error: expect.stringContaining('Recovery verification failed'),
  });
  expect(await f.files()).toEqual(files);
});

test('actual scheduling publishes and verifies encrypted local archives, catches up and avoids duplicate jobs', async () => {
  const f = await fixture();
  await f.service.start();
  await f.service.tick();
  const first = f.service.status();
  expect(first).toMatchObject({
    destination: 'filesystem',
    offsite: false,
    lastGood: f.options.now(),
    error: null,
    verification: { lastGood: f.options.now(), keyId: 'first', error: null, running: false },
  });
  expect(await f.files()).toHaveLength(1);
  await f.service.tick();
  expect(await f.files()).toHaveLength(1);
  f.advance(24 * 3600_000);
  await f.service.tick();
  expect(await f.files()).toHaveLength(2);
  expect(f.service.status().verification.lastGood).toBe(first.verification.lastGood);
  await f.service.close();
  f.advance(7 * 24 * 3600_000);
  const restarted = new BackupService(f.db, f.options);
  cleanups.push(() => restarted.close());
  await restarted.start();
  await restarted.tick();
  expect(restarted.status()).toMatchObject({
    lastGood: f.options.now(),
    verification: { lastGood: f.options.now(), error: null },
  });
  expect((await readdir(f.directory)).filter((name) => name.startsWith('.recovery-job-'))).toEqual(
    [],
  );
}, 60_000);

test.each(['backup', 'verification'] as const)(
  '%s results retain their captured Spaces destination when catalog refresh changes deployment policy',
  async (kind) => {
    const f = await fixture();
    const config = {
      type: 'spaces' as const,
      prefix: 'destination-a',
      region: 'nyc3',
      bucket: 'recovery-fixture',
      accessKeyId: 'fixture',
      secretAccessKey: 'fixture-secret',
      keyFile: f.keyFile,
      runtimeEnvironmentFile: f.config.runtimeEnvironmentFile,
      keyId: 'first',
    };
    await writeFile(f.configPath, JSON.stringify(config), { mode: 0o600 });
    let entered!: () => void, release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    // This test isolates destination attribution. The existing service tests
    // separately exercise real isolated restore; no verifier budget is bypassed.
    if (kind === 'verification')
      vi.spyOn(verification, 'verifyArchive').mockResolvedValue({
        tables: 1, rows: 1, snapshots: 0, images: 0, keyId: 'first',
      });
    const service = new BackupService(f.db, {
      ...f.options,
      remote(current) {
        const key = `${current.prefix}/2026-10-25T02-00-00.000Z-00000000-0000-4000-8000-000000000000.spinel`;
        return {
          async put() { entered(); await pending; },
          async list() { return [key]; },
          async remove() {},
          async download(_key, destination) {
            entered(); await pending;
            await writeFile(destination, 'opaque verifier fixture', { mode: 0o600 });
            return 'fixture';
          },
        };
      },
    });
    cleanups.push(() => service.close());
    const operation = kind === 'backup' ? service.run() : service.verify();
    try {
      await started;
      await writeFile(f.configPath, JSON.stringify({ ...config, prefix: 'destination-b' }), { mode: 0o600 });
      await service.exports.catalog();
      release();
      expect(await operation).toBe(true);
      // Both destinations have the same provider type; provider equality cannot
      // turn an operation against A into protection or verification of B.
      expect(service.status().destination).toBe('spaces');
      if (kind === 'backup')
        expect(service.status()).toMatchObject({ lastGood: null, offsite: false });
      else expect(service.status().verification.lastGood).toBeNull();
      await writeFile(f.configPath, JSON.stringify(config), { mode: 0o600 });
      await service.exports.catalog();
      if (kind === 'backup')
        expect(service.status()).toMatchObject({ lastGood: f.options.now(), offsite: true });
      else expect(service.status().verification.lastGood).toBe(f.options.now());
    } finally {
      release();
      await operation;
    }
  },
);

test('overlapping configuration validation returns its own policy and an older read cannot replace current readiness', async () => {
  const f = await fixture();
  const config = {
    type: 'spaces' as const,
    prefix: 'destination-a',
    region: 'nyc3',
    bucket: 'recovery-fixture',
    accessKeyId: 'fixture',
    secretAccessKey: 'fixture-secret',
    keyFile: f.keyFile,
    runtimeEnvironmentFile: f.config.runtimeEnvironmentFile,
    keyId: 'first',
  };
  const invalidKey = join(f.directory, 'invalid-key');
  await writeFile(invalidKey, 'invalid key', { mode: 0o600 });
  await writeFile(f.configPath, JSON.stringify(config), { mode: 0o600 });
  let entered!: () => void, release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const readKey = archives.readKey;
  vi.spyOn(archives, 'readKey').mockImplementationOnce(async (path) => {
    entered(); await pending; return readKey(path);
  });
  const used: string[] = [];
  const service = new BackupService(f.db, {
    ...f.options,
    remote(current) {
      return {
        async put() { used.push(current.prefix); },
        async list() { return []; },
        async remove() {},
      };
    },
  });
  cleanups.push(() => service.close());
  const operation = service.run();
  try {
    await started;
    await writeFile(f.configPath, JSON.stringify({
      ...config, prefix: 'destination-b', keyFile: invalidKey, keyId: 'second',
    }), { mode: 0o600 });
    await service.exports.catalog();
    expect(service.status()).toMatchObject({ keyId: 'second', policy: { manualReady: false } });
    release();
    expect(await operation).toBe(true);
    expect(used).toEqual(['destination-a']);
    expect(service.status()).toMatchObject({
      keyId: 'second', lastGood: null, offsite: false, policy: { manualReady: false },
    });
  } finally {
    release();
    await operation;
  }
});

test('failed newest recovery retains source and last success; old and new keys remain verifiable after rotation', async () => {
  const f = await fixture();
  expect(await f.service.run()).toBe(true);
  expect(await f.service.verify()).toBe(true);
  const good = f.service.status().verification.lastGood;
  const name = (await f.files())[0],
    path = join(f.root, f.config.prefix, name);
  const original = await readFile(path),
    corrupt = Buffer.from(original);
  corrupt[corrupt.length - 1] ^= 1;
  await writeFile(path, corrupt);
  f.advance(3600_000);
  expect(await f.service.verify()).toBe(false);
  expect(f.service.status().verification).toMatchObject({ lastGood: good, running: false });
  expect(f.service.status().verification.error).toContain('failed');
  expect(await readFile(path)).toEqual(corrupt);
  expect(JSON.stringify(f.service.status())).not.toContain('Private recovery fixture');
  await writeFile(path, original);
  const secondKey = join(f.directory, 'second-key');
  await writeFile(secondKey, randomBytes(32), { mode: 0o600 });
  await writeFile(
    f.configPath,
    JSON.stringify({
      ...f.config,
      keyFile: secondKey,
      keyId: 'second',
      retainedKeyFiles: { first: f.keyFile },
    }),
  );
  expect(await f.service.verify()).toBe(true);
  expect(f.service.status().verification).toMatchObject({ keyId: 'first', error: null });
  expect(await f.service.run()).toBe(true);
  expect(await f.service.verify()).toBe(true);
  expect(f.service.status().verification).toMatchObject({ keyId: 'second', error: null });
}, 60_000);

test('resource refusal reports a safe reason, stops key retries and preserves the last recovery point', async () => {
  const f = await fixture();
  expect(await f.service.run()).toBe(true);
  expect(await f.service.verify()).toBe(true);
  const good = f.service.status().verification.lastGood;
  const path = join(f.root, f.config.prefix, (await f.files())[0]);
  const source = await readFile(path);
  await writeFile(
    f.configPath,
    JSON.stringify({ ...f.config, retainedKeyFiles: { older: f.keyFile } }),
  );
  const attempt = vi.spyOn(verification, 'verifyArchive');
  for (const code of ['memory-headroom', 'memory-limit', 'time-limit', 'disk-space'] as const) {
    attempt.mockClear().mockRejectedValue(new RecoveryResourceError(code));
    expect(await f.service.verify()).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(f.service.status().verification).toMatchObject({
      lastGood: good,
      running: false,
      error: new RecoveryResourceError(code).message,
    });
  }
  expect(await readFile(path)).toEqual(source);
  expect((await readdir(f.directory)).filter((name) => name.startsWith('.recovery-job-'))).toEqual(
    [],
  );
}, 60_000);

test('backup and verifier share a real lease, and shutdown drains active retrieval', async () => {
  const f = await fixture();
  expect(await f.service.run()).toBe(true);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    blocked = new Promise<void>((r) => {
      release = r;
    });
  const remote = (config: BackupConfig) => {
    const destination = createDestination(config);
    return {
      put: destination.put.bind(destination),
      list: destination.list.bind(destination),
      remove: destination.remove.bind(destination),
      close: destination.close.bind(destination),
      async download(key: string, path: string, signal?: AbortSignal) {
        entered();
        await blocked;
        return destination.download(key, path, signal);
      },
    };
  };
  const verifier = new BackupService(f.db, { ...f.options, remote });
  cleanups.push(() => verifier.close());
  const checking = verifier.verify();
  await started;
  expect(verifier.verify()).toBe(checking);
  expect(await f.service.run()).toBe(false);
  expect(await verifier.run()).toBe(false);
  let closed = false;
  const closing = verifier.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  expect(await checking).toBe(true);
  await closing;
  expect(verifier.status().verification.running).toBe(false);
}, 60_000);

test('a destination cleanup failure releases the lease and keeps the published backup recoverable', async () => {
  const f = await fixture();
  const service = new BackupService(f.db, {
    ...f.options,
    remote(config) {
      const destination = createDestination(config);
      const close = destination.close.bind(destination);
      destination.close = async () => {
        await close();
        throw new Error('Private destination details must stay hidden');
      };
      return destination;
    },
  });
  cleanups.push(() => service.close());
  expect(await service.run()).toBe(false);
  expect(service.status()).toMatchObject({
    running: false,
    lastGood: f.options.now(),
    error: expect.stringContaining('Recovery staging cleanup failed'),
  });
  expect(service.state()).toMatchObject({ lease: 0, owner: null, job: null });
  expect(JSON.stringify(service.status())).not.toContain('Private destination details');
  expect(await f.files()).toHaveLength(1);
  expect(await f.service.verify()).toBe(true);
}, 60_000);

test('expired verification is visible, retry reconciles only owned staging and preserves foreign paths', async () => {
  const f = await fixture();
  expect(await f.service.run()).toBe(true);
  expect(await f.service.verify()).toBe(true);
  const previousGood = f.service.status().verification.lastGood;
  f.advance(30 * 60_000);
  const abandoned = await mkdtemp(join(f.directory, `.recovery-job-${randomUUID()}-`));
  await chmod(abandoned, 0o700);
  await writeFile(join(abandoned, 'partial'), 'not a recovery point');
  const foreign = join(f.directory, 'keep');
  await mkdir(foreign);
  await writeFile(join(foreign, 'evidence'), 'untouched');
  const alias = join(f.directory, `.recovery-job-${randomUUID()}-alias`);
  await symlink(foreign, alias);
  f.db
    .prepare("UPDATE backup_state SET job='verify',owner='interrupted',lease=? WHERE id=1")
    .run(f.options.now() - 1);
  f.db
    .prepare("UPDATE verification_state SET owner='interrupted',lease=?,last_attempt=? WHERE id=1")
    .run(f.options.now() - 1, f.options.now() - 2 * 3600_000);
  expect(f.service.status().verification.error).toContain('interrupted');
  expect(f.service.status().verification.lastGood).toBe(previousGood);
  await f.service.tick();
  expect(f.service.status().verification).toMatchObject({
    lastGood: f.options.now(),
    error: null,
    running: false,
  });
  expect(await readdir(f.directory)).not.toContain(abandoned.split('/').at(-1));
  expect(await readFile(join(foreign, 'evidence'), 'utf8')).toBe('untouched');
}, 60_000);
