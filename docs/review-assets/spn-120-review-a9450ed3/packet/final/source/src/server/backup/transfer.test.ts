import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStatsFs } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FilesystemStore, filesystemIdentity } from './filesystem.ts';
import { SpacesStore } from './spaces.ts';
import { MAX_ARCHIVE_BYTES, TRANSFER_DISK_RESERVE, transferArchive } from './transfer.ts';

// Only capacity is simulated. Opening, streaming, publication and cleanup all
// use real files, so a refusal must leave the existing recovery point intact.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, statfs: vi.fn(actual.statfs) };
});
const cleanups: (() => unknown | Promise<unknown>)[] = [];
const disk = vi.mocked(statfs);
const chunkBytes = 128 * 1024;
const ample = 16 * 1024 ** 3;
function space(bytes: number): BigIntStatsFs {
  const blocks = BigInt(Math.floor(bytes / 4096));
  return {
    type: 0n,
    bsize: 4096n,
    frsize: 4096n,
    blocks,
    bfree: blocks,
    bavail: blocks,
    files: 1000n,
    ffree: 1000n,
  };
}
beforeEach(() => disk.mockReset().mockResolvedValue(space(ample)));
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const signal = () => AbortSignal.timeout(5000);
const key = () => `fixture/2026-10-27T02-00-00.000Z-${randomUUID()}.spinel`;
async function directory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'spinel-transfer-')));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function fixture() {
  const path = await directory();
  const root = join(path, 'backups');
  await mkdir(root, { mode: 0o700 });
  const store = new FilesystemStore({
    type: 'filesystem',
    ...(await filesystemIdentity(root)),
    prefix: 'fixture',
    keyFile: join(path, 'key'),
    runtimeEnvironmentFile: join(path, 'runtime'),
  });
  const source = join(path, 'source');
  const bytes = Buffer.alloc(2 * chunkBytes, 0x31);
  await writeFile(source, bytes, { mode: 0o600 });
  return {
    path,
    root,
    store,
    source,
    bytes,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}
function refuse(phase: 'preflight' | 'stream') {
  disk.mockReset().mockResolvedValue(space(TRANSFER_DISK_RESERVE));
  if (phase === 'stream')
    disk.mockResolvedValueOnce(space(ample)).mockResolvedValueOnce(space(ample));
}

test('known-size transfers reserve the complete local copy before consuming input or writing bytes', async () => {
  const path = join(await directory(), 'output');
  const output = await open(path, 'wx', 0o600);
  cleanups.push(() => output.close());
  let consumed = false;
  async function* input() {
    consumed = true;
    yield Buffer.alloc(4096);
  }
  disk.mockResolvedValue(space(TRANSFER_DISK_RESERVE + 4095));
  await expect(transferArchive(input(), output, signal(), 4096, path)).rejects.toMatchObject({
    name: 'RecoveryResourceError',
    code: 'disk-space',
  });
  expect(consumed).toBe(false);
  expect((await output.stat()).size).toBe(0);
  expect(disk).toHaveBeenCalledWith(
    process.platform === 'linux' ? `/proc/self/fd/${output.fd}` : path,
    { bigint: true },
  );
  await expect(
    transferArchive(input(), output, signal(), MAX_ARCHIVE_BYTES + 1, path),
  ).rejects.toMatchObject({ name: 'RecoveryResourceError', code: 'archive-size' });
  expect(consumed).toBe(false);
});

test.each([false, true])(
  'free-space loss stops a bounded write during a transfer (known size: %s)',
  async (known) => {
    const path = join(await directory(), 'output');
    const output = await open(path, 'wx', 0o600);
    cleanups.push(() => output.close());
    // A single large source chunk must still be split into capacity-checked writes.
    const bytes = Buffer.alloc(2 * chunkBytes, 0x32);
    refuse('stream');
    await expect(
      transferArchive(
        Readable.from([bytes]),
        output,
        signal(),
        known ? bytes.length : undefined,
        path,
      ),
    ).rejects.toMatchObject({ code: 'disk-space' });
    expect(await readFile(path)).toEqual(bytes.subarray(0, chunkBytes));
    expect(disk).toHaveBeenCalledTimes(3);
  },
);

test.each(['preflight', 'stream'] as const)(
  'filesystem publication under disk pressure (%s) removes only its partial copy',
  async (phase) => {
    const f = await fixture(),
      existing = key(),
      candidate = key();
    await f.store.put(existing, f.source, f.hash, signal());
    refuse(phase);
    await expect(f.store.put(candidate, f.source, f.hash, signal())).rejects.toMatchObject({
      code: 'disk-space',
    });
    expect(await f.store.list(signal())).toEqual([existing]);
    expect(await readdir(join(f.root, 'fixture'))).toEqual([existing.split('/')[1]]);
    expect(await readFile(join(f.root, existing))).toEqual(f.bytes);
    expect(await readFile(f.source)).toEqual(f.bytes);
  },
);

test.each(['preflight', 'stream'] as const)(
  'filesystem retrieval under disk pressure (%s) deletes the partial download and preserves its source',
  async (phase) => {
    const f = await fixture(),
      id = key();
    await f.store.put(id, f.source, f.hash, signal());
    const destination = join(f.path, 'download');
    refuse(phase);
    await expect(f.store.download(id, destination, signal())).rejects.toMatchObject({
      code: 'disk-space',
    });
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(f.root, id))).toEqual(f.bytes);
    expect(await f.store.list(signal())).toEqual([id]);
  },
);

test.each(['preflight', 'stream'] as const)(
  'Spaces retrieval under disk pressure (%s) destroys its input and removes the partial output',
  async (phase) => {
    const path = await directory();
    const remote = new SpacesStore({
      region: 'sfo3',
      bucket: 'fixture-backups',
      prefix: 'fixture',
      accessKeyId: 'fixture',
      secretAccessKey: 'fixture',
      keyFile: join(path, 'key'),
      runtimeEnvironmentFile: join(path, 'runtime'),
    });
    cleanups.push(() => remote.close());
    const bytes = Buffer.alloc(2 * chunkBytes, 0x33);
    const body = Readable.from([bytes]);
    vi.spyOn(remote.client, 'send').mockImplementation(async () => ({
      Body: body,
      // Exercise the unadvertised-length path as well as known-size preflight.
      ...(phase === 'preflight' && { ContentLength: bytes.length }),
    }));
    const destination = join(path, 'download');
    refuse(phase);
    await expect(remote.download(key(), destination, signal())).rejects.toMatchObject({
      code: 'disk-space',
    });
    expect(body.destroyed).toBe(true);
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
