import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  readDocCallbackProto,
  validateDocCallbackProto,
} from '../../e2e/doc-responsiveness-callback-proto.ts';

const identity = (bytes: Uint8Array) => ({
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
async function* chunks(bytes: Uint8Array, size = 1) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}
const packet = Buffer.from([0x0a, 2, 0x08, 1]);

test('binds complete repeated packet framing to the received bytes across every boundary', async () => {
  const raw = Buffer.concat([packet, Buffer.from([0x0a, 0x80, 1]), Buffer.alloc(128)]);
  for (const size of [1, 2, 3, 7, 64 * 1024])
    assert.deepEqual(await validateDocCallbackProto(chunks(raw, size), identity(raw)), {
      ...identity(raw),
      packets: 2,
      emptyPackets: 0,
    });
});

test('rejects the first converter-accepted truncation before any conversion can be admitted', async () => {
  // SPN-144's first real converter returned success for this 268435455-byte claim.
  const raw = Buffer.from([0x0a, 0xff, 0xff, 0xff, 0x7f, 1]);
  let admitted = false;
  await assert.rejects(async () => {
    await validateDocCallbackProto(chunks(raw), identity(raw));
    admitted = true;
  }, /exceeds captured input/);
  assert.equal(admitted, false);
});

test('rejects truncated lengths and payloads, forbidden fields and trailing garbage', async () => {
  for (const raw of [
    [0x0a],
    [0x0a, 0x80],
    [0x0a, 2, 1],
    [0x12, 0],
    [0x08, 1],
    [0x80],
    [...packet, 0x0a],
    [...packet, 0],
  ]) {
    const bytes = Buffer.from(raw);
    await assert.rejects(validateDocCallbackProto(chunks(bytes), identity(bytes)));
  }
});

test('rejects overflowing and unterminated uint32 lengths without unsafe accumulation', async () => {
  for (const fifth of [0x10, 0x80, 0xff]) {
    const raw = Buffer.from([0x0a, 0xff, 0xff, 0xff, 0xff, fifth, 0]);
    await assert.rejects(validateDocCallbackProto(chunks(raw, 2), identity(raw)), /overflows/);
  }
});

test('wrong hashes, appended bytes and a dropped complete packet cannot match capture identity', async () => {
  const two = Buffer.concat([packet, packet]);
  await assert.rejects(
    validateDocCallbackProto(chunks(packet), { ...identity(packet), sha256: '0'.repeat(64) }),
    /captured hash/,
  );
  await assert.rejects(validateDocCallbackProto(chunks(two), identity(packet)), /byte count/);
  await assert.rejects(validateDocCallbackProto(chunks(packet), identity(two)), /byte count/);
  // Framing alone cannot detect a lost whole packet if the capture identity is also replaced.
  assert.equal((await validateDocCallbackProto(chunks(packet), identity(packet))).packets, 1);
});

test('empty, malformed or excessive capture identities cannot authorize input', async () => {
  for (const expected of [
    identity(Buffer.alloc(0)),
    { bytes: -1, sha256: '0'.repeat(64) },
    { bytes: 1.5, sha256: '0'.repeat(64) },
    { bytes: 2 * 1024 ** 3 + 1, sha256: '0'.repeat(64) },
    { bytes: 4, sha256: 'missing' },
  ])
    await assert.rejects(validateDocCallbackProto(chunks(packet), expected), /Invalid captured/);
  await assert.rejects(
    validateDocCallbackProto(chunks(Buffer.alloc(0)), identity(packet)),
    /Empty/,
  );
});

test('zero-length packets, nonminimal lengths and opaque payloads are not semantic approval', async () => {
  const raw = Buffer.from([0x0a, 0, 0x0a, 0x81, 0, 0xff]);
  assert.deepEqual(await validateDocCallbackProto(chunks(raw), identity(raw)), {
    ...identity(raw),
    packets: 2,
    emptyPackets: 1,
  });
  // The converter/statistics/attribution layers must reject invalid inner semantics.
});

test('retains input failures and cancellation even at a complete final packet boundary', async () => {
  async function* failed() {
    yield packet;
    throw new Error('original stream failure');
  }
  await assert.rejects(
    validateDocCallbackProto(failed(), identity(packet)),
    /original stream failure/,
  );
  const controller = new AbortController();
  async function* cancelled() {
    yield packet;
    controller.abort(new Error('original observation deadline'));
  }
  await assert.rejects(
    validateDocCallbackProto(cancelled(), identity(packet), controller.signal),
    /original observation deadline/,
  );
});

test('gzip EOF, corruption and missing files remain failures before protobuf acceptance', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'spinel-callback-proto-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'trace.gz');
  const gz = gzipSync(packet);
  await writeFile(path, gz);
  assert.equal((await readDocCallbackProto(path, identity(packet))).packets, 1);
  await writeFile(path, gz.subarray(0, gz.length - 1));
  await assert.rejects(readDocCallbackProto(path, identity(packet)), /unexpected end/i);
  const damaged = Buffer.from(gz);
  damaged[damaged.length - 8] ^= 1;
  await writeFile(path, damaged);
  await assert.rejects(readDocCallbackProto(path, identity(packet)), /incorrect data check/i);
  await assert.rejects(readDocCallbackProto(join(dir, 'missing.gz'), identity(packet)), /ENOENT/);
});
