import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/** A trusted, closed, self-contained snapshot, not a live DB or a raw DB/WAL
 * rollback tuple. The supervisor must snapshot all acknowledged WAL changes
 * under the maintenance barrier before deriving this evidence. */
export interface ClosedRestoreInput {
  databasePath: string;
  databaseSha256: string;
  databaseBytes: number;
}
const changed = () => new Error('The frozen recovery input is unavailable or changed.');
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
  const source = await open(input.databasePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await source.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.uid !== process.getuid?.() ||
      (before.mode & 0o077) !== 0 ||
      before.size !== input.databaseBytes
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
          Math.min(buffer.length, input.databaseBytes + 1 - offset),
          offset,
        );
        if (!bytesRead) break;
        if (offset + bytesRead > input.databaseBytes) throw changed();
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
        path = await lstat(input.databasePath);
      if (
        offset !== input.databaseBytes ||
        hash.digest('hex') !== input.databaseSha256 ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        !path.isFile() ||
        path.dev !== before.dev ||
        path.ino !== before.ino
      )
        throw changed();
      await assertSelfContained(input.databasePath);
      await target.sync();
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}
