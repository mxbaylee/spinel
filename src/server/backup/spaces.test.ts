import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { afterEach, expect, test, vi } from 'vitest';
import { SpacesStore } from './spaces.ts';
const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const config = {
  region: 'sfo3',
  bucket: 'test-bucket',
  prefix: 'test',
  accessKeyId: 'fake',
  secretAccessKey: 'fake',
  keyFile: '/private/key',
  runtimeEnvironmentFile: '/private/runtime',
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-spaces-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'encrypted'),
    bytes = Buffer.from('encrypted fixture');
  await writeFile(path, bytes);
  const remote = new SpacesStore(config);
  cleanups.push(() => remote.close());
  return { remote, path, bytes, hash: createHash('sha256').update(bytes).digest('hex') };
}
test('Spaces publishes only after verified readback, sets private ACLs, then removes pending object', async () => {
  const f = await fixture(),
    calls: string[] = [],
    key = 'test/backup.spinel';
  vi.spyOn(f.remote.client, 'send').mockImplementation(async (command) => {
    calls.push(command.constructor.name);
    if (command instanceof PutObjectCommand) {
      expect(command.input).toMatchObject({
        Bucket: config.bucket,
        Key: `${key}.pending`,
        ACL: 'private',
        ContentLength: f.bytes.length,
      });
      const chunks = [];
      for await (const chunk of command.input.Body as Readable) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(f.bytes);
    } else if (command instanceof GetObjectCommand) {
      expect(command.input.Key).toBe(`${key}.pending`);
      return { Body: Readable.from([f.bytes]) };
    } else if (command instanceof CopyObjectCommand) {
      expect(command.input).toMatchObject({
        Key: key,
        CopySource: `${config.bucket}/test%2Fbackup.spinel.pending`,
        ACL: 'private',
      });
    } else if (command instanceof DeleteObjectCommand)
      expect(command.input.Key).toBe(`${key}.pending`);
    else throw new Error('Unexpected operation');
    return {};
  });
  await f.remote.put(key, f.path, f.hash, AbortSignal.timeout(1000));
  expect(calls).toEqual([
    'PutObjectCommand',
    'GetObjectCommand',
    'CopyObjectCommand',
    'DeleteObjectCommand',
  ]);
});
test('readback mismatch never publishes or deletes a backup', async () => {
  const f = await fixture(),
    calls: string[] = [];
  vi.spyOn(f.remote.client, 'send').mockImplementation(async (command) => {
    calls.push(command.constructor.name);
    if (command instanceof PutObjectCommand) {
      for await (const chunk of command.input.Body as Readable) void chunk;
      return {};
    }
    if (command instanceof GetObjectCommand)
      return { Body: Readable.from([Buffer.from('corrupt')]) };
    throw new Error('No copy or deletion allowed');
  });
  await expect(
    f.remote.put('test/backup.spinel', f.path, f.hash, AbortSignal.timeout(1000)),
  ).rejects.toThrow('checksum');
  expect(calls).toEqual(['PutObjectCommand', 'GetObjectCommand']);
});
test('listing follows every continuation page and fails closed on incomplete/error pages', async () => {
  const f = await fixture();
  const send = vi.spyOn(f.remote.client, 'send').mockImplementation(async (command) => {
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    const input = (command as ListObjectsV2Command).input;
    expect(input.Prefix).toBe('test/');
    return input.ContinuationToken
      ? { Contents: [{ Key: 'test/second' }], IsTruncated: false }
      : { Contents: [{ Key: 'test/first' }], IsTruncated: true, NextContinuationToken: 'next' };
  });
  expect(await f.remote.list(AbortSignal.timeout(1000))).toEqual(['test/first', 'test/second']);
  send.mockImplementation(async () => ({ IsTruncated: true }));
  await expect(f.remote.list(AbortSignal.timeout(1000))).rejects.toThrow('Incomplete');
  send.mockRejectedValue(new Error('network failure'));
  await expect(f.remote.list(AbortSignal.timeout(1000))).rejects.toThrow('network');
});
test('download streams bounded private bytes and preserves an existing destination', async () => {
  const f = await fixture();
  const id = `test/2026-10-27T02-00-00.000Z-${randomUUID()}.spinel`;
  const send = vi.spyOn(f.remote.client, 'send').mockImplementation(async (command) => {
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect((command as GetObjectCommand).input.Key).toBe(id);
    return { Body: Readable.from([f.bytes]), ContentLength: f.bytes.length };
  });
  const destination = `${f.path}-download`;
  expect(await f.remote.download(id, destination, AbortSignal.timeout(1000))).toBe(f.hash);
  expect(await readFile(destination)).toEqual(f.bytes);
  expect((await lstat(destination)).mode & 0o777).toBe(0o600);
  await expect(f.remote.download(id, destination)).rejects.toThrow();
  expect(await readFile(destination)).toEqual(f.bytes);
  send.mockImplementation(async () => ({
    Body: Readable.from([f.bytes]),
    ContentLength: f.bytes.length + 1,
  }));
  await expect(f.remote.download(id, `${destination}-partial`)).rejects.toThrow('incomplete');
  await expect(lstat(`${destination}-partial`)).rejects.toThrow();
  send.mockImplementation(async () => ({
    Body: Readable.from([f.bytes]),
    ContentLength: 5 * 1024 ** 3 + 1,
  }));
  await expect(f.remote.download(id, `${destination}-oversize`)).rejects.toThrow('size limit');
  await expect(lstat(`${destination}-oversize`)).rejects.toThrow();
});
