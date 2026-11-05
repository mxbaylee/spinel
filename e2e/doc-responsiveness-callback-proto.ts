import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export interface DocCallbackProtoIdentity {
  bytes: number;
  sha256: string;
}

/**
 * Perfetto's saved Trace wrapper contains only repeated TracePacket field 1.
 * Validate its complete framing independently: the pinned converter accepts a
 * truncated final packet. Payloads remain opaque and are never rewritten.
 */
export async function validateDocCallbackProto(
  chunks: AsyncIterable<Uint8Array>,
  expected: DocCallbackProtoIdentity,
  signal?: AbortSignal,
) {
  if (
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes <= 0 ||
    expected.bytes > 2 * 1024 ** 3 ||
    !/^[a-f0-9]{64}$/.test(expected.sha256)
  )
    throw new Error('Invalid captured protobuf identity or 2 GiB input bound.');
  signal?.throwIfAborted();
  let state: 'tag' | 'length' | 'payload' = 'tag';
  let length = 0;
  let lengthBytes = 0;
  let remaining = 0;
  let bytes = 0;
  let packets = 0;
  let emptyPackets = 0;
  const hash = createHash('sha256');
  for await (const chunk of chunks) {
    signal?.throwIfAborted();
    bytes += chunk.length;
    if (bytes > expected.bytes) throw new Error('Protobuf exceeds its captured byte count.');
    hash.update(chunk);
    let offset = 0;
    while (offset < chunk.length) {
      if (state === 'payload') {
        const consume = Math.min(remaining, chunk.length - offset);
        offset += consume;
        remaining -= consume;
        if (remaining === 0) {
          packets++;
          state = 'tag';
        }
        continue;
      }
      const byte = chunk[offset++]!;
      if (state === 'tag') {
        if (byte !== 0x0a) throw new Error('Unexpected Trace wrapper field or wire type.');
        state = 'length';
        length = 0;
        lengthBytes = 0;
        continue;
      }
      if (lengthBytes === 4 && byte > 0x0f)
        throw new Error('Trace packet length overflows uint32.');
      length += (byte & 0x7f) * 2 ** (7 * lengthBytes++);
      if (byte & 0x80) continue;
      if (length > expected.bytes) throw new Error('Trace packet exceeds captured input.');
      remaining = length;
      if (remaining === 0) {
        packets++;
        emptyPackets++;
        state = 'tag';
      } else state = 'payload';
    }
  }
  signal?.throwIfAborted();
  if (state !== 'tag') throw new Error('Truncated Trace wrapper at EOF.');
  if (packets === 0) throw new Error('Empty Trace wrapper.');
  const sha256 = hash.digest('hex');
  if (bytes !== expected.bytes || sha256 !== expected.sha256)
    throw new Error('Protobuf differs from its captured hash or byte count.');
  return { bytes, sha256, packets, emptyPackets };
}

/** The captured gzip identity is checked separately from these decoded bytes. */
export async function readDocCallbackProto(
  path: string,
  expected: DocCallbackProtoIdentity,
  signal?: AbortSignal,
) {
  const source = createReadStream(path, { highWaterMark: 64 * 1024, signal });
  const input = source.pipe(createGunzip());
  const settled = [source, input].map((stream) => finished(stream).catch(() => {}));
  source.once('error', (error) => input.destroy(error));
  try {
    return await validateDocCallbackProto(input, expected, signal);
  } finally {
    input.destroy();
    source.destroy();
    await Promise.all(settled);
  }
}

/** Own and close the working file while preserving validation's first failure. */
export async function materializeDocCallbackProto(
  path: string,
  output: FileHandle,
  expected: DocCallbackProtoIdentity,
  signal: AbortSignal,
) {
  const result = {
    framing: undefined as Awaited<ReturnType<typeof validateDocCallbackProto>> | undefined,
    failed: false,
    failure: undefined as unknown,
    closeFailure: undefined as unknown,
  };
  const source = createReadStream(path, { signal });
  const input = source.pipe(createGunzip());
  const settled = [source, input].map((stream) => finished(stream).catch(() => {}));
  source.once('error', (error) => input.destroy(error));
  try {
    async function* retained() {
      for await (const chunk of input) {
        await output.writeFile(chunk);
        yield chunk;
      }
    }
    result.framing = await validateDocCallbackProto(retained(), expected, signal);
  } catch (error) {
    result.failed = true;
    result.failure = error;
  } finally {
    input.destroy();
    source.destroy();
    await Promise.all(settled);
    try {
      await output.close();
    } catch (error) {
      result.closeFailure = error;
      if (!result.failed) result.failure = error;
      result.failed = true;
    }
  }
  return result;
}
