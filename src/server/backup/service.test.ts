import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { filesystemIdentity } from './filesystem.ts';
import { createDestination } from './destination.ts';
import { BackupService } from './service.ts';
import type { BackupConfig } from './config.ts';

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
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

test('expired verification is visible, retry reconciles only owned staging and preserves foreign paths', async () => {
  const f = await fixture();
  expect(await f.service.run()).toBe(true);
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
  await f.service.tick();
  expect(f.service.status().verification).toMatchObject({
    lastGood: f.options.now(),
    error: null,
    running: false,
  });
  expect(await readdir(f.directory)).not.toContain(abandoned.split('/').at(-1));
  expect(await readFile(join(foreign, 'evidence'), 'utf8')).toBe('untouched');
}, 60_000);
