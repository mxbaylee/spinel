import { createHash } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { RecoveryResourceError } from './resource-error.ts';

export const MAX_ARCHIVE_BYTES = 5 * 1024 ** 3;
export const TRANSFER_DISK_RESERVE = 256 * 1024 ** 2;
const WRITE_BYTES = 128 * 1024;

export async function* fileChunks(input: FileHandle, signal: AbortSignal) {
  const buffer = Buffer.alloc(WRITE_BYTES);
  let position = 0;
  for (;;) {
    signal.throwIfAborted();
    const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
    if (!bytesRead) return;
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}

function expectedSizeWithinLimit(size: number | undefined) {
  if (size === undefined) return;
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid backup transfer size.');
  if (size > MAX_ARCHIVE_BYTES) throw new RecoveryResourceError('archive-size');
}

export async function archiveDigest(
  chunks: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  expectedSize?: number,
) {
  expectedSizeWithinLimit(expectedSize);
  const checksum = createHash('sha256');
  let bytes = 0;
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    bytes += chunk.byteLength;
    if (bytes > MAX_ARCHIVE_BYTES) throw new RecoveryResourceError('archive-size');
    if (expectedSize !== undefined && bytes > expectedSize)
      throw new Error('Backup transfer is incomplete.');
    checksum.update(chunk);
  }
  signal.throwIfAborted();
  if (expectedSize !== undefined && bytes !== expectedSize)
    throw new Error('Backup transfer is incomplete.');
  return checksum.digest('hex');
}

export function fileDigest(input: FileHandle, signal: AbortSignal) {
  return archiveDigest(fileChunks(input, signal), signal);
}

// Await each bounded write: no whole-archive buffering and no implicit ownership
// transfer of FileHandles to streams. Callers close and sync their own handles.
export async function transferArchive(
  chunks: AsyncIterable<Uint8Array>,
  output: FileHandle,
  signal: AbortSignal,
  expectedSize?: number,
  outputPath?: string,
) {
  signal.throwIfAborted();
  expectedSizeWithinLimit(expectedSize);
  // The open file pins the actual destination filesystem on Linux, even if an
  // ancestor path is replaced. Other platforms retain Spaces' explicit path.
  const probe = process.platform === 'linux' ? `/proc/self/fd/${output.fd}` : outputPath;
  if (!probe) throw new Error('Backup transfer requires a destination path.');
  const requireSpace = async (length: number) => {
    signal.throwIfAborted();
    const space = await statfs(probe, { bigint: true });
    const block = space.bsize;
    if (block <= 0n || space.bavail < 0n) throw new RecoveryResourceError('disk-space');
    const allocation = ((BigInt(length) + block - 1n) / block) * block;
    if (space.bavail * block < BigInt(TRANSFER_DISK_RESERVE) + allocation)
      throw new RecoveryResourceError('disk-space');
    signal.throwIfAborted();
  };
  // Account for the entire additional local copy before consuming any input.
  // Recheck before each bounded write because other writers can use free space.
  await requireSpace(expectedSize ?? 0);
  const checksum = createHash('sha256');
  let bytes = 0;
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    bytes += chunk.byteLength;
    if (bytes > MAX_ARCHIVE_BYTES) throw new RecoveryResourceError('archive-size');
    if (expectedSize !== undefined && bytes > expectedSize)
      throw new Error('Backup transfer is incomplete.');
    checksum.update(chunk);
    for (let offset = 0; offset < chunk.byteLength;) {
      const length = Math.min(WRITE_BYTES, chunk.byteLength - offset);
      await requireSpace(length);
      const result = await output.write(chunk, offset, length, null).catch((error: unknown) => {
        if (['ENOSPC', 'EDQUOT'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw new RecoveryResourceError('disk-space');
        throw error;
      });
      if (!result.bytesWritten) throw new Error('Backup write made no progress.');
      offset += result.bytesWritten;
    }
  }
  signal.throwIfAborted();
  if (expectedSize !== undefined && bytes !== expectedSize)
    throw new Error('Backup transfer is incomplete.');
  await requireSpace(0);
  return checksum.digest('hex');
}
