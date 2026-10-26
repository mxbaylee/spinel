import { lstat, mkdir, mkdtemp, readdir, rm, statfs } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { DatabaseSync } from '../../../server/database.ts';
import { AuthError } from '../auth/store.ts';

const HEADROOM = 64 * 1024 * 1024;
const STALE_AFTER = 2 * 60 * 60_000;

/** Production /tmp is a tiny tmpfs. Imports belong on the private database volume. */
export async function archiveDirectory(database: DatabaseSync) {
  const parent =
    database.path === ':memory:'
      ? join(tmpdir(), `spinel-archives-${process.pid}`)
      : join(dirname(resolve(database.path)), '.archive-imports');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const info = await lstat(parent);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0)
    throw new AuthError(503, 'Archive storage is not private. Ask the Operator to check it.');
  // A crashed upload has no live receipt after restart. Only our aged, private
  // directories are removed; the age exceeds the hard transfer timeout.
  for (const name of await readdir(parent)) {
    if (!/^import-[A-Za-z0-9]{6}$/.test(name)) continue;
    const path = join(parent, name);
    const entry = await lstat(path);
    if (entry.isDirectory() && entry.mtimeMs < Date.now() - STALE_AFTER)
      await rm(path, { recursive: true, force: true });
  }
  return mkdtemp(join(parent, 'import-'));
}

/** Reserve working space as well as a small floor for unrelated database writes. */
export async function archiveCapacity(path: string, bytes: number) {
  const space = await statfs(path);
  if (Number(space.bavail) * Number(space.bsize) < bytes + HEADROOM)
    throw new AuthError(
      507,
      'There is not enough temporary storage for this archive. No files were added.',
    );
}
