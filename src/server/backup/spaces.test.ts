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
const artifact = () => `test/2026-10-27T02-00-00.000Z-${randomUUID()}.spinel`;
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
    key = artifact();
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
        CopySource: `${config.bucket}/${encodeURIComponent(`${key}.pending`)}`,
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
test('readback mismatch never publishes and removes only its pending object', async () => {
  const f = await fixture(),
    calls: string[] = [];
  vi.spyOn(f.remote.client, 'send').mockImplementation(async (command) => {
    calls.push(command.constructor.name);
    if (command instanceof PutObjectCommand) {
      for await (const chunk of command.input.Body as Readable) void chunk;
      return {};
    }
    if (command instanceof GetObjectCommand)
      return { Body: Readable.from([Buffer.alloc(f.bytes.length, 0x78)]) };
    if (command instanceof DeleteObjectCommand) {
      expect(command.input.Key).toMatch(/\.spinel\.pending$/);
      return {};
    }
    throw new Error('No publication allowed');
  });
  await expect(f.remote.put(artifact(), f.path, f.hash, AbortSignal.timeout(1000))).rejects.toThrow(
    'checksum',
  );
  expect(calls).toEqual(['PutObjectCommand', 'GetObjectCommand', 'DeleteObjectCommand']);
});
test('listing follows every continuation page and fails closed on incomplete/error pages', async () => {
  const f = await fixture();
  const first = artifact(),
    second = artifact();
  const send = vi.spyOn(f.remote.client, 'send').mockImplementation(async (command) => {
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    const input = (command as ListObjectsV2Command).input;
    expect(input.Prefix).toBe('test/');
    return input.ContinuationToken
      ? {
          Contents: [{ Key: second }, { Key: `${second}.pending` }, { Key: 'other/unknown' }],
          IsTruncated: false,
        }
      : { Contents: [{ Key: first }], IsTruncated: true, NextContinuationToken: 'next' };
  });
  expect(await f.remote.list(AbortSignal.timeout(1000))).toEqual([first, second]);
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

test.each(['truncated', 'oversized', 'aborted'] as const)(
  'uploaded readback is bounded and closed when %s, without publishing or pruning',
  async (mode) => {
    const f = await fixture();
    const controller = new AbortController();
    const body =
      mode === 'aborted'
        ? new Readable({ read() {} })
        : Readable.from([f.bytes.subarray(0, f.bytes.length - 1)]);
    const calls: string[] = [];
    vi.spyOn(f.remote.client, 'send').mockImplementation(async (command) => {
      calls.push(command.constructor.name);
      if (command instanceof PutObjectCommand) {
        for await (const chunk of command.input.Body as Readable) void chunk;
        return {};
      }
      if (command instanceof GetObjectCommand) {
        if (mode === 'aborted') setImmediate(() => controller.abort());
        return {
          Body: body,
          ...(mode === 'oversized' && { ContentLength: 5 * 1024 ** 3 + 1 }),
        };
      }
      if (command instanceof DeleteObjectCommand) {
        expect(command.input.Key).toMatch(/\.spinel\.pending$/);
        return {};
      }
      throw new Error('No publication allowed');
    });
    const operation = f.remote.put(artifact(), f.path, f.hash, controller.signal);
    if (mode === 'oversized')
      await expect(operation).rejects.toMatchObject({
        name: 'RecoveryResourceError',
        code: 'archive-size',
      });
    else if (mode === 'truncated') await expect(operation).rejects.toThrow('incomplete');
    else await expect(operation).rejects.toThrow();
    expect(body.destroyed).toBe(true);
    expect(calls).toEqual(['PutObjectCommand', 'GetObjectCommand', 'DeleteObjectCommand']);
  },
);

test('catalog bounds apply across pages and cancellation prevents another listing request', async () => {
  const f = await fixture();
  const send = vi.spyOn(f.remote.client, 'send').mockImplementation(async (command) => {
    const next = (command as ListObjectsV2Command).input.ContinuationToken;
    return {
      Contents: Array.from({ length: next ? 4001 : 6000 }, (_, i) => ({
        Key: `test/${next ?? 'first'}-${i}`,
      })),
      IsTruncated: !next,
      ...(!next && { NextContinuationToken: 'next' }),
    };
  });
  await expect(f.remote.list(AbortSignal.timeout(1000))).rejects.toThrow('entry limit');
  expect(send).toHaveBeenCalledTimes(2);
  const controller = new AbortController();
  send.mockClear().mockImplementation(async () => {
    controller.abort();
    return { Contents: [{ Key: artifact() }], IsTruncated: true, NextContinuationToken: 'next' };
  });
  await expect(f.remote.list(controller.signal)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});

test('restart cleanup removes only recognized pending keys after a complete bounded listing', async () => {
  const f = await fixture(),
    complete = artifact(),
    pending = `${artifact()}.pending`,
    foreign = pending.replace('test/', 'other/');
  const removed: string[] = [];
  const send = vi.spyOn(f.remote.client, 'send').mockImplementation(async (command) => {
    if (command instanceof ListObjectsV2Command)
      return {
        Contents: [complete, pending, foreign, 'test/operator.pending'].map((Key) => ({ Key })),
      };
    if (command instanceof DeleteObjectCommand) {
      removed.push(command.input.Key!);
      return {};
    }
    throw new Error('Unexpected operation');
  });
  expect(await f.remote.list(AbortSignal.timeout(1000))).toEqual([complete]);
  await f.remote.cleanup(AbortSignal.timeout(1000));
  expect(removed).toEqual([pending]);
  send.mockImplementation(async (command) => {
    if (command instanceof ListObjectsV2Command) {
      if (command.input.ContinuationToken) throw new Error('Listing interrupted');
      return { Contents: [{ Key: pending }], IsTruncated: true, NextContinuationToken: 'next' };
    }
    throw new Error('Deletion must wait for the entire catalog');
  });
  await expect(f.remote.cleanup(AbortSignal.timeout(1000))).rejects.toThrow('Listing interrupted');
  expect(removed).toEqual([pending]);
});

test('Spaces signs requests for its pinned endpoint and ignores generic endpoint overrides', async () => {
  vi.stubEnv('AWS_ENDPOINT_URL_S3', 'https://untrusted.invalid');
  cleanups.push(() => vi.unstubAllEnvs());
  const f = await fixture();
  const handler = vi
    .spyOn(f.remote.client.config.requestHandler, 'handle')
    .mockImplementation(async (request) => {
      expect(request.hostname).toBe('test-bucket.sfo3.digitaloceanspaces.com');
      expect(request.protocol).toBe('https:');
      expect(request.headers.authorization).toContain('/us-east-1/s3/aws4_request');
      return {
        response: {
          statusCode: 200,
          headers: { 'content-length': String(f.bytes.length) },
          body: Readable.from([f.bytes]),
        },
      };
    });
  const result = await f.remote.client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: artifact() }),
  );
  expect(await result.Body!.transformToByteArray()).toEqual(new Uint8Array(f.bytes));
  expect(handler).toHaveBeenCalledTimes(1);
});

test('destination operations reject foreign, incomplete and arbitrary artifact keys before transport', async () => {
  const f = await fixture(),
    send = vi.spyOn(f.remote.client, 'send');
  for (const key of [
    '../outside',
    artifact().replace('test/', 'other/'),
    `${artifact()}.pending`,
  ]) {
    await expect(f.remote.put(key, f.path, f.hash, AbortSignal.timeout(1000))).rejects.toThrow(
      'instance prefix',
    );
    await expect(
      f.remote.download(key, `${f.path}-bad`, AbortSignal.timeout(1000)),
    ).rejects.toThrow('instance prefix');
  }
  await expect(
    f.remote.remove('other/operator.pending', AbortSignal.timeout(1000)),
  ).rejects.toThrow('instance prefix');
  expect(send).not.toHaveBeenCalled();
});
