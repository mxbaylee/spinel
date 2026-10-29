import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { RecoveryResourceError } from './resource-error.ts';

/** Leave room for immutable source copies plus three bounded output-sized
 * allocations (database, journal, temporary work). This is an admission limit,
 * not a physical reservation against unrelated writers on the volume. */
export function restoreOutputLimit(
  available: bigint,
  sourceBytes: number,
  initialBytes: number,
  maximum: number,
) {
  if (
    ![sourceBytes, initialBytes, maximum].every(Number.isSafeInteger) ||
    sourceBytes < 0 ||
    initialBytes < 4096 ||
    maximum < initialBytes ||
    maximum > 8 * 1024 ** 3
  )
    throw new Error('Invalid recovery output budget.');
  const remaining = available - BigInt(sourceBytes) - BigInt(256 * 1024 ** 2);
  const bound = remaining / 3n;
  const result = Number(bound < BigInt(maximum) ? bound : BigInt(maximum));
  if (result < initialBytes) throw new RecoveryResourceError('disk-space');
  return result;
}

/** A trusted, closed, self-contained snapshot, not a live DB or a raw DB/WAL
 * rollback tuple. The supervisor must snapshot all acknowledged WAL changes
 * under the maintenance barrier before deriving this evidence. */
export interface ClosedRestoreInput {
  databasePath: string;
  databaseSha256: string;
  databaseBytes: number;
}
const changed = () => new Error('The recovery input is unavailable or changed.');
export function validateClosedRestoreInput(input: ClosedRestoreInput, maximum: number) {
  if (
    !isAbsolute(input.databasePath) ||
    !/^[a-f0-9]{64}$/.test(input.databaseSha256) ||
    !Number.isSafeInteger(input.databaseBytes) ||
    input.databaseBytes < 4096 ||
    input.databaseBytes > maximum
  )
    throw changed();
}
export async function assertSelfContained(path: string) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      await lstat(path + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw changed();
  }
}

/** Pin the source descriptor, stream a bounded exclusive private copy, and
 * authenticate its exact bytes. Never open original evidence with SQLite.
 * Caller owns target-directory cleanup on every error or cancellation. */
export async function copyClosedRestoreInput(
  input: ClosedRestoreInput,
  destination: string,
  signal?: AbortSignal,
) {
  validateClosedRestoreInput(input, 8 * 1024 ** 3);
  signal?.throwIfAborted();
  await assertSelfContained(input.databasePath);
  await copyRestoreInputFile(
    { path: input.databasePath, bytes: input.databaseBytes, sha256: input.databaseSha256 },
    destination,
    signal,
  );
  await assertSelfContained(input.databasePath);
}

/** Exact raw evidence, including an empty WAL. This does not establish a closed
 * SQLite snapshot or authorize recovery of a DB/WAL tuple. Its caller owns
 * tuple completeness, WAL validation and cleanup on every failure. */
export interface RestoreInputFile {
  path: string;
  bytes: number;
  sha256: string;
}
export async function copyRestoreInputFile(
  input: RestoreInputFile,
  destination: string,
  signal?: AbortSignal,
) {
  if (
    !isAbsolute(input.path) ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 0 ||
    input.bytes > 8 * 1024 ** 3
  )
    throw changed();
  signal?.throwIfAborted();
  const source = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await source.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.uid !== process.getuid?.() ||
      (before.mode & 0o077) !== 0 ||
      before.size !== input.bytes
    )
      throw changed();
    const target = await open(
      destination,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const hash = createHash('sha256'),
        buffer = Buffer.alloc(64 * 1024);
      let offset = 0;
      for (;;) {
        signal?.throwIfAborted();
        const { bytesRead } = await source.read(
          buffer,
          0,
          Math.min(buffer.length, input.bytes + 1 - offset),
          offset,
        );
        if (!bytesRead) break;
        if (offset + bytesRead > input.bytes) throw changed();
        hash.update(buffer.subarray(0, bytesRead));
        let written = 0;
        while (written < bytesRead) {
          signal?.throwIfAborted();
          const result = await target.write(buffer, written, bytesRead - written, offset + written);
          if (!result.bytesWritten) throw changed();
          written += result.bytesWritten;
        }
        offset += bytesRead;
      }
      const after = await source.stat(),
        path = await lstat(input.path);
      if (
        offset !== input.bytes ||
        hash.digest('hex') !== input.sha256 ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        !path.isFile() ||
        path.dev !== before.dev ||
        path.ino !== before.ino
      )
        throw changed();
      await target.sync();
      signal?.throwIfAborted();
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}
