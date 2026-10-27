import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';

export const MAX_ARCHIVE_BYTES = 5 * 1024 ** 3;

export async function* fileChunks(input: FileHandle, signal: AbortSignal) {
  const buffer = Buffer.alloc(128 * 1024);
  let position = 0;
  for (;;) {
    signal.throwIfAborted();
    const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
    if (!bytesRead) return;
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}

export async function fileDigest(input: FileHandle, signal: AbortSignal) {
  const checksum = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fileChunks(input, signal)) {
    bytes += chunk.byteLength;
    if (bytes > MAX_ARCHIVE_BYTES) throw new Error('Backup exceeds transfer size limit.');
    checksum.update(chunk);
  }
  return checksum.digest('hex');
}

// Await each bounded write: no whole-archive buffering and no implicit ownership
// transfer of FileHandles to streams. Callers close and sync their own handles.
export async function transferArchive(
  chunks: AsyncIterable<Uint8Array>,
  output: FileHandle,
  signal: AbortSignal,
  expectedSize?: number,
) {
  const checksum = createHash('sha256');
  let bytes = 0;
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    bytes += chunk.byteLength;
    if (bytes > MAX_ARCHIVE_BYTES) throw new Error('Backup exceeds transfer size limit.');
    checksum.update(chunk);
    for (let offset = 0; offset < chunk.byteLength;) {
      signal.throwIfAborted();
      const result = await output.write(chunk, offset, chunk.byteLength - offset, null);
      if (!result.bytesWritten) throw new Error('Backup write made no progress.');
      offset += result.bytesWritten;
    }
  }
  signal.throwIfAborted();
  if (expectedSize !== undefined && bytes !== expectedSize)
    throw new Error('Backup transfer is incomplete.');
  return checksum.digest('hex');
}
