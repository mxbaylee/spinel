import { createHash } from 'node:crypto';
import { chmod, link, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { copyClosedRestoreInput } from './restore-input.ts';

const cleanup: string[] = [];
afterEach(async () => {
  for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spinel-restore-input-'));
  cleanup.push(root);
  const databasePath = join(root, 'source.sqlite'),
    target = join(root, 'target.sqlite');
  const bytes = Buffer.alloc(130_049, 31);
  await writeFile(databasePath, bytes, { mode: 0o600 });
  return {
    root,
    target,
    bytes,
    input: {
      databasePath,
      databaseBytes: bytes.length,
      databaseSha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}
test('copies bounded exact bytes into an exclusive private file without altering original evidence', async () => {
  const f = await fixture();
  await copyClosedRestoreInput(f.input, f.target);
  expect(await readFile(f.target)).toEqual(f.bytes);
  expect((await stat(f.target)).mode & 0o077).toBe(0);
  expect((await stat(f.target)).ino).not.toBe((await stat(f.input.databasePath)).ino);
  await expect(copyClosedRestoreInput(f.input, f.target)).rejects.toThrow();
  expect(await readFile(f.input.databasePath)).toEqual(f.bytes);
});
test.each(['-wal', '-shm', '-journal'])(
  'refuses even an empty %s sidecar instead of silently losing committed WAL or rollback state',
  async (suffix) => {
    const f = await fixture();
    await writeFile(f.input.databasePath + suffix, '', { mode: 0o600 });
    await expect(copyClosedRestoreInput(f.input, f.target)).rejects.toThrow('changed');
    expect(await readFile(f.input.databasePath)).toEqual(f.bytes);
  },
);
test('wrong evidence, unsafe permissions, hard links and symlinks never become trusted copies', async () => {
  const f = await fixture();
  await expect(
    copyClosedRestoreInput({ ...f.input, databaseSha256: '0'.repeat(64) }, f.target),
  ).rejects.toThrow('changed');
  await rm(f.target);
  await chmod(f.input.databasePath, 0o644);
  await expect(copyClosedRestoreInput(f.input, f.target)).rejects.toThrow('changed');
  await chmod(f.input.databasePath, 0o600);
  const alias = join(f.root, 'alias.sqlite');
  await symlink(f.input.databasePath, alias);
  await expect(
    copyClosedRestoreInput({ ...f.input, databasePath: alias }, f.target),
  ).rejects.toThrow();
  await rm(alias);
  await link(f.input.databasePath, alias);
  await expect(copyClosedRestoreInput(f.input, f.target)).rejects.toThrow('changed');
  expect(await readFile(f.input.databasePath)).toEqual(f.bytes);
});
test('cancellation before copying creates no output', async () => {
  const f = await fixture(),
    controller = new AbortController();
  controller.abort();
  await expect(copyClosedRestoreInput(f.input, f.target, controller.signal)).rejects.toThrow();
  await expect(stat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
});
