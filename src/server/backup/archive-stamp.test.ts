import { randomBytes } from 'node:crypto';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { makeArchive, readImageStamp, restoreArchive, STAMP_HEAD_BYTES } from './archive.ts';
import type { Recovery } from './archive.ts';

// Contract: the image stamp in an archive header is written at backup time,
// readable without decrypting, and trusted only when its MAC verifies under a
// configured key. Missing, forged and replayed stamps are never trusted, and a
// stamp cannot change what full restore verification accepts.
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const image = `sha256:${'a'.repeat(64)}`;
const recovery: Recovery = {
  format: 1,
  createdAt: '2026-10-18T02:00:00.000Z',
  origin: 'https://spinel.example',
  image,
  runtimeEnvironment: 'LICENSE_KEY=private-fixture\n',
  keyId: 'primary',
};
async function archive(key: Buffer, overrides: Partial<Recovery> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-archive-stamp-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, 'source.sqlite'));
  cleanups.push(() => db.close());
  const made = await makeArchive(db, directory, key, { ...recovery, ...overrides });
  const path = join(directory, 'copy.spinel');
  await writeFile(path, await readFile(made.archive));
  await made.dispose();
  return { directory, path };
}
// What the catalog reads: a bounded prefix, which may run past a short header.
async function prefix(path: string) {
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(STAMP_HEAD_BYTES);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
// Exactly the SPINEL02 header: magic, IV, length, stamp, MAC.
async function header(path: string) {
  const bytes = await prefix(path);
  return bytes.subarray(0, 22 + bytes.readUInt16BE(20) + 32);
}

test('backup time stamps the image, readable without decrypting and without secrets', async () => {
  const key = randomBytes(32);
  const made = await archive(key);
  const head = await prefix(made.path);
  expect(readImageStamp(head, [key])).toEqual({
    image,
    createdAt: recovery.createdAt,
    keyId: 'primary',
  });
  // Non-secret by construction: no origin, runtime environment or key material.
  const text = head.toString('latin1');
  expect(text).not.toContain('spinel.example');
  expect(text).not.toContain('LICENSE_KEY');
  expect(text).not.toContain(key.toString('latin1'));
});

test('a stamp is trusted only under a configured key', async () => {
  const key = randomBytes(32),
    retained = randomBytes(32);
  const head = await header((await archive(key)).path);
  expect(readImageStamp(head, [randomBytes(32)])).toBeUndefined();
  expect(readImageStamp(head, [])).toBeUndefined();
  // A rotation key still works, in any position.
  expect(readImageStamp(head, [retained, key])?.image).toBe(image);
});

test('forged, altered, truncated and malformed stamps are never trusted', async () => {
  const key = randomBytes(32);
  const head = await header((await archive(key)).path);
  // Forged: an attacker who cannot derive the MAC key changes the claimed image.
  const forged = Buffer.from(head);
  const at = forged.indexOf('aaaa');
  forged[at] = 'b'.charCodeAt(0);
  expect(readImageStamp(forged, [key])).toBeUndefined();
  // Altered MAC.
  const mac = Buffer.from(head);
  mac[mac.length - 1] ^= 1;
  expect(readImageStamp(mac, [key])).toBeUndefined();
  // Truncated mid-stamp and shorter than the fixed header.
  expect(readImageStamp(head.subarray(0, head.length - 1), [key])).toBeUndefined();
  expect(readImageStamp(head.subarray(0, 10), [key])).toBeUndefined();
  // A length field larger than the bound.
  const long = Buffer.from(head);
  long.writeUInt16BE(0xffff, 20);
  expect(readImageStamp(long, [key])).toBeUndefined();
  // Not an archive at all.
  expect(readImageStamp(randomBytes(STAMP_HEAD_BYTES), [key])).toBeUndefined();
});

test('an image name too long to stamp writes the original header, which is unstamped and restorable', async () => {
  const key = randomBytes(32);
  const long = `${'x'.repeat(500)}@sha256:${'c'.repeat(64)}`;
  const made = await archive(key, { image: long });
  const head = await prefix(made.path);
  expect(head.subarray(0, 8).toString()).toBe('SPINEL01');
  expect(readImageStamp(head, [key])).toBeUndefined();
  const restored = await restoreArchive(
    made.path,
    key,
    made.directory,
    join(made.directory, 'out'),
  );
  expect(restored.image).toBe(long);
});

test('a stamped archive restores, and a stamp spliced onto other bytes fails full verification', async () => {
  const key = randomBytes(32);
  const made = await archive(key);
  const restored = await restoreArchive(made.path, key, made.directory, join(made.directory, 'ok'));
  expect(restored).toMatchObject({ image, keyId: 'primary' });

  // Replay: a valid stamp (valid MAC) from this archive on a different archive.
  const other = await archive(key, { image: `sha256:${'d'.repeat(64)}` });
  const stamped = await readFile(made.path);
  const foreign = await readFile(other.path);
  const donor = (await header(made.path)).length;
  const spliced = Buffer.concat([stamped.subarray(0, donor), foreign.subarray(donor)]);
  await writeFile(other.path, spliced);
  expect(readImageStamp(await prefix(other.path), [key])?.image).toBe(image);
  await expect(
    restoreArchive(other.path, key, other.directory, join(other.directory, 'out')),
  ).rejects.toMatchObject({ code: 'backup-unreadable' });
});
