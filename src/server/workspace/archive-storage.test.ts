import { chmod, lstat, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { archiveCapacity, archiveDirectory } from './archive-storage.ts';

test('archive staging uses the private database volume and reclaims only expired import directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-archive-storage-'));
  const db = new DatabaseSync(join(directory, 'app.sqlite'));
  try {
    const first = await archiveDirectory(db);
    const parent = join(directory, '.archive-imports');
    expect(first.startsWith(join(parent, 'import-'))).toBe(true);
    expect((await lstat(parent)).mode & 0o077).toBe(0);
    expect((await lstat(first)).mode & 0o077).toBe(0);
    const stale = join(parent, 'import-ABC123');
    const unrelated = join(parent, 'unrelated');
    await mkdir(stale, { mode: 0o700 });
    await writeFile(join(stale, 'archive.zip'), 'incomplete');
    await mkdir(unrelated, { mode: 0o700 });
    const old = new Date(Date.now() - 3 * 60 * 60_000);
    await utimes(stale, old, old);
    await utimes(unrelated, old, old);
    const second = await archiveDirectory(db);
    expect((await readdir(parent)).sort()).toEqual(
      [first.split('/').at(-1)!, second.split('/').at(-1)!, 'unrelated'].sort(),
    );
    await expect(archiveCapacity(second, Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({
      status: 507,
    });
    await chmod(parent, 0o755);
    await expect(archiveDirectory(db)).rejects.toMatchObject({ status: 503 });
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
