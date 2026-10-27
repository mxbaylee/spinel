import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { FilesystemConfig } from './config.ts';
import type { BackupDestination } from './destination.ts';
import { RecoveryResourceError } from './resource-error.ts';
import { backupTime } from './spaces.ts';
import { fileChunks, fileDigest, MAX_ARCHIVE_BYTES, transferArchive } from './transfer.ts';

const TRANSFER_MS = 30 * 60_000;
const MAX_ENTRIES = 10_000;
const pendingName = /^\.pending-[a-f0-9-]{36}$/;
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

function same(a: { dev: bigint; ino: bigint }, b: { dev: bigint; ino: bigint }) {
  return a.dev === b.dev && a.ino === b.ino;
}
async function privateDirectory(handle: FileHandle) {
  const info = await handle.stat({ bigint: true });
  if (!info.isDirectory() || info.uid !== BigInt(process.getuid!()) || (info.mode & 0o077n) !== 0n)
    throw new Error('Backup directory must be owned by this user and private (0700).');
  return info;
}
function supported() {
  // Descriptor-relative paths prevent path replacement from redirecting file operations.
  if (process.platform !== 'linux' || !process.getuid)
    throw new Error('Filesystem backups require Linux; use the local production container.');
}
export async function filesystemIdentity(root: string) {
  supported();
  if (
    !isAbsolute(root) ||
    root === '/' ||
    resolve(root) !== root ||
    (await realpath(root)) !== root
  )
    throw new Error('Use an existing canonical absolute backup directory.');
  const handle = await open(root, directoryFlags);
  try {
    const info = await privateDirectory(handle);
    if (!same(info, await lstat(root, { bigint: true })))
      throw new Error('Backup directory changed.');
    return { root, rootDevice: String(info.dev), rootInode: String(info.ino) };
  } finally {
    await handle.close();
  }
}

export class FilesystemStore implements BackupDestination {
  config: FilesystemConfig;
  constructor(config: FilesystemConfig) {
    this.config = config;
  }
  private async directory() {
    supported();
    const { root, rootDevice, rootInode, prefix } = this.config;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(prefix) || (await realpath(root)) !== root)
      throw new Error('Invalid filesystem destination.');
    const rootHandle = await open(root, directoryFlags);
    let namespace: FileHandle | undefined;
    try {
      const rootInfo = await privateDirectory(rootHandle);
      if (String(rootInfo.dev) !== rootDevice || String(rootInfo.ino) !== rootInode)
        throw new Error('The configured backup filesystem is missing or changed.');
      const namespacePath = `/proc/self/fd/${rootHandle.fd}/${prefix}`;
      try {
        await mkdir(namespacePath, { mode: 0o700 });
        await rootHandle.sync();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      namespace = await open(namespacePath, directoryFlags);
      const namespaceInfo = await privateDirectory(namespace);
      if (namespaceInfo.dev !== rootInfo.dev)
        throw new Error('Nested backup mounts are not supported.');
      const handle = namespace;
      const check = async () => {
        if (
          (await realpath(root)) !== root ||
          !same(rootInfo, await lstat(root, { bigint: true })) ||
          !same(namespaceInfo, await lstat(namespacePath, { bigint: true }))
        )
          throw new Error('The configured backup filesystem changed during the operation.');
        await privateDirectory(rootHandle);
        await privateDirectory(handle);
      };
      await check();
      return {
        path: `/proc/self/fd/${handle.fd}`,
        handle,
        check,
        close: async () => {
          try {
            await handle.close();
          } finally {
            await rootHandle.close();
          }
        },
      };
    } catch (error) {
      try {
        await namespace?.close();
      } finally {
        await rootHandle.close();
      }
      throw error;
    }
  }
  private name(key: string) {
    if (!backupTime(key, this.config.prefix))
      throw new Error('Not a backup in this instance prefix.');
    return key.slice(this.config.prefix.length + 1);
  }
  async put(key: string, source: string, expectedDigest: string, signal: AbortSignal) {
    const name = this.name(key);
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('Invalid backup checksum.');
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(TRANSFER_MS)]);
    bounded.throwIfAborted();
    const directory = await this.directory();
    const pending = join(directory.path, `.pending-${randomUUID()}`);
    let input: FileHandle | undefined, output: FileHandle | undefined;
    let created = false;
    try {
      input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await input.stat();
      if (!info.isFile()) throw new Error('Invalid backup file.');
      if (info.size > MAX_ARCHIVE_BYTES) throw new RecoveryResourceError('archive-size');
      output = await open(pending, 'wx+', 0o600);
      created = true;
      const checksum = await transferArchive(
        fileChunks(input, bounded),
        output,
        bounded,
        info.size,
        pending,
      );
      if (checksum !== expectedDigest) throw new Error('Backup checksum mismatch.');
      await output.sync();
      if ((await fileDigest(output, bounded)) !== expectedDigest)
        throw new Error('Stored backup checksum mismatch.');
      await directory.check();
      bounded.throwIfAborted();
      // link is atomic and refuses an existing name; rename would overwrite it.
      await link(pending, join(directory.path, name));
      await directory.handle.sync();
      await directory.check();
    } finally {
      try {
        await Promise.all([input?.close(), output?.close()]);
      } finally {
        try {
          if (created) {
            await unlink(pending);
            await directory.handle.sync();
          }
        } finally {
          await directory.close();
        }
      }
    }
  }
  async list(signal: AbortSignal) {
    signal.throwIfAborted();
    const directory = await this.directory();
    try {
      const keys: string[] = [];
      let entries = 0;
      for await (const entry of await opendir(directory.path)) {
        if (++entries > MAX_ENTRIES) throw new Error('Backup catalog exceeds its entry limit.');
        const name = entry.name;
        signal.throwIfAborted();
        const key = `${this.config.prefix}/${name}`;
        if (!backupTime(key, this.config.prefix)) continue;
        const info = await lstat(join(directory.path, name));
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
          throw new Error('Invalid published backup file.');
        keys.push(key);
      }
      await directory.check();
      return keys;
    } finally {
      await directory.close();
    }
  }
  async download(key: string, destination: string, signal = AbortSignal.timeout(TRANSFER_MS)) {
    const name = this.name(key);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(TRANSFER_MS)]);
    bounded.throwIfAborted();
    const directory = await this.directory();
    let input: FileHandle | undefined, output: FileHandle | undefined;
    let created = false;
    try {
      input = await open(join(directory.path, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await input.stat();
      if (!info.isFile() || (info.mode & 0o077) !== 0)
        throw new Error('Invalid published backup file.');
      if (info.size > MAX_ARCHIVE_BYTES) throw new RecoveryResourceError('archive-size');
      output = await open(destination, 'wx', 0o600);
      created = true;
      const checksum = await transferArchive(
        fileChunks(input, bounded),
        output,
        bounded,
        info.size,
        destination,
      );
      await directory.check();
      await output.sync();
      return checksum;
    } catch (error) {
      if (created) await unlink(destination);
      throw error;
    } finally {
      try {
        await Promise.all([input?.close(), output?.close()]);
      } finally {
        await directory.close();
      }
    }
  }
  async remove(key: string, signal: AbortSignal) {
    const name = this.name(key);
    signal.throwIfAborted();
    const directory = await this.directory();
    try {
      const path = join(directory.path, name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid backup file.');
      await directory.check();
      signal.throwIfAborted();
      await unlink(path);
      await directory.handle.sync();
      await directory.check();
    } finally {
      await directory.close();
    }
  }
  async cleanup(signal: AbortSignal) {
    // The service calls this only while holding its cross-process job lease.
    signal.throwIfAborted();
    const directory = await this.directory();
    try {
      let entries = 0;
      for await (const entry of await opendir(directory.path)) {
        if (++entries > MAX_ENTRIES) throw new Error('Backup catalog exceeds its entry limit.');
        const name = entry.name;
        if (!pendingName.test(name)) continue;
        signal.throwIfAborted();
        const path = join(directory.path, name);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error('Invalid pending backup file.');
        await directory.check();
        await unlink(path);
      }
      await directory.handle.sync();
      await directory.check();
    } finally {
      await directory.close();
    }
  }
  close() {
    // Every operation owns and closes its own pinned directory/file handles.
  }
}
