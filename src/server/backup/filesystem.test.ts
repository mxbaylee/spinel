import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { FilesystemStore, filesystemIdentity } from './filesystem.ts';
import type { FilesystemConfig } from './config.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const signal = () => AbortSignal.timeout(5000);
const key = () => `fixture/2026-10-27T02-00-00.000Z-${randomUUID()}.spinel`;
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-filesystem-')));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'backups');
  await mkdir(root, { mode: 0o700 });
  const config: FilesystemConfig = {
    type: 'filesystem',
    ...(await filesystemIdentity(root)),
    prefix: 'fixture',
    keyFile: join(directory, 'key'),
    runtimeEnvironmentFile: join(directory, 'runtime'),
  };
  const bytes = Buffer.from('opaque encrypted archive fixture');
  const source = join(directory, 'source');
  await writeFile(source, bytes, { mode: 0o600 });
  return {
    directory,
    root,
    config,
    bytes,
    source,
    hash: createHash('sha256').update(bytes).digest('hex'),
    store: new FilesystemStore(config),
  };
}

test('filesystem publishes immutable private bytes and supports real list/download/remove', async () => {
  const f = await fixture(),
    id = key();
  await f.store.put(id, f.source, f.hash, signal());
  expect(await f.store.list(signal())).toEqual([id]);
  expect((await lstat(join(f.root, id))).mode & 0o777).toBe(0o600);
  expect((await lstat(join(f.root, 'fixture'))).mode & 0o777).toBe(0o700);
  expect(await readdir(join(f.root, 'fixture'))).toEqual([id.split('/')[1]]);
  const destination = join(f.directory, 'download');
  expect(await f.store.download(id, destination, signal())).toBe(f.hash);
  expect(await readFile(destination)).toEqual(f.bytes);
  expect((await lstat(destination)).mode & 0o777).toBe(0o600);
  await expect(f.store.download(id, destination, signal())).rejects.toThrow();
  expect(await readFile(destination)).toEqual(f.bytes);
  await f.store.remove(id, signal());
  expect(await f.store.list(signal())).toEqual([]);
});

test('checksum failures and key collisions never publish partial bytes or overwrite a point', async () => {
  const f = await fixture(),
    id = key();
  await expect(f.store.put(id, f.source, '0'.repeat(64), signal())).rejects.toThrow('checksum');
  expect(await f.store.list(signal())).toEqual([]);
  expect(await readdir(join(f.root, 'fixture'))).toEqual([]);
  await f.store.put(id, f.source, f.hash, signal());
  await expect(f.store.put(id, f.source, f.hash, signal())).rejects.toThrow();
  expect(await readFile(join(f.root, id))).toEqual(f.bytes);
  expect(await readdir(join(f.root, 'fixture'))).toEqual([id.split('/')[1]]);
});

test('missing, replaced and incorrectly identified roots fail without creating fallback storage', async () => {
  const f = await fixture();
  const wrong = new FilesystemStore({ ...f.config, rootDevice: '0', rootInode: '0' });
  await expect(wrong.list(signal())).rejects.toThrow('missing or changed');
  await rename(f.root, `${f.root}-mounted`);
  await expect(f.store.put(key(), f.source, f.hash, signal())).rejects.toThrow();
  await expect(lstat(f.root)).rejects.toThrow();
  await mkdir(f.root, { mode: 0o700 });
  await expect(f.store.list(signal())).rejects.toThrow('missing or changed');
  expect(await readdir(f.root)).toEqual([]);
});

test('private root and namespace permissions are enforced and symlink paths cannot escape', async () => {
  const f = await fixture();
  await chmod(f.root, 0o755);
  await expect(f.store.list(signal())).rejects.toThrow('private');
  await chmod(f.root, 0o700);
  const external = join(f.directory, 'external');
  await mkdir(external, { mode: 0o700 });
  await symlink(external, join(f.root, 'fixture'));
  await expect(f.store.put(key(), f.source, f.hash, signal())).rejects.toThrow();
  expect(await readdir(external)).toEqual([]);
  await rm(join(f.root, 'fixture'));
  await f.store.list(signal());
  await chmod(join(f.root, 'fixture'), 0o755);
  await expect(f.store.list(signal())).rejects.toThrow('private');
});

test('invalid keys and symlink artifacts are refused for reads and deletion', async () => {
  const f = await fixture();
  for (const id of [
    '../outside',
    '/absolute',
    'other/2026-10-27T02-00-00.000Z-x.spinel',
    'fixture/../source',
  ]) {
    await expect(f.store.put(id, f.source, f.hash, signal())).rejects.toThrow('instance prefix');
    await expect(f.store.download(id, join(f.directory, 'download'), signal())).rejects.toThrow(
      'instance prefix',
    );
    await expect(f.store.remove(id, signal())).rejects.toThrow('instance prefix');
  }
  await f.store.list(signal());
  const id = key();
  await symlink(f.source, join(f.root, id));
  await expect(f.store.list(signal())).rejects.toThrow('Invalid published');
  await expect(f.store.download(id, join(f.directory, 'download'), signal())).rejects.toThrow();
  await expect(f.store.remove(id, signal())).rejects.toThrow('Invalid backup');
  expect(await readFile(f.source)).toEqual(f.bytes);
});

test('aborted operations are inert and lease-owned cleanup removes only abandoned pending files', async () => {
  const f = await fixture(),
    id = key();
  await expect(f.store.put(id, f.source, f.hash, AbortSignal.abort())).rejects.toThrow();
  expect(await readdir(f.root)).toEqual([]);
  await f.store.put(id, f.source, f.hash, signal());
  const pending = join(f.root, 'fixture', `.pending-${randomUUID()}`);
  await writeFile(pending, 'interrupted transfer', { mode: 0o600 });
  const unrelated = join(f.root, 'fixture', 'operator-note');
  await writeFile(unrelated, 'keep');
  expect(await f.store.list(signal())).toEqual([id]);
  await f.store.cleanup(signal());
  await expect(lstat(pending)).rejects.toThrow();
  expect(await readFile(unrelated, 'utf8')).toBe('keep');
  expect(await readFile(join(f.root, id))).toEqual(f.bytes);
  const linkedPending = join(f.root, 'fixture', `.pending-${randomUUID()}`);
  await symlink(f.source, linkedPending);
  await expect(f.store.cleanup(signal())).rejects.toThrow('Invalid pending');
  expect(await readFile(f.source)).toEqual(f.bytes);
});
test('a killed publisher leaves no visible point and restart cleanup removes its abandoned bytes', async () => {
  const f = await fixture(),
    id = key();
  await f.store.list(signal());
  // Sparse input keeps the fixture cheap while ensuring publication cannot finish
  // before the parent observes the real pending-file creation and kills the child.
  const source = join(f.directory, 'large-source');
  const handle = await open(source, 'wx', 0o600);
  await handle.truncate(64 * 1024 ** 2);
  await handle.close();
  const configPath = join(f.directory, 'config');
  await writeFile(configPath, JSON.stringify(f.config), { mode: 0o600 });
  const child = fork(
    fileURLToPath(new URL('./filesystem-crash-fixture.ts', import.meta.url)),
    [configPath, source, id],
    {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  try {
    const killed = await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Publisher did not reach pending transfer.'));
      }, 8000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('message', () => child.kill('SIGKILL'));
      child.once('exit', (_code, exitSignal) => {
        clearTimeout(timer);
        resolve(exitSignal === 'SIGKILL');
      });
    });
    expect(killed).toBe(true);
    expect(await f.store.list(signal())).toEqual([]);
    expect(
      (await readdir(join(f.root, 'fixture'))).some((name) => name.startsWith('.pending-')),
    ).toBe(true);
    await f.store.cleanup(signal());
    expect(await readdir(join(f.root, 'fixture'))).toEqual([]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
}, 10_000);
