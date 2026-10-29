import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { acquireColdWorkspace } from './journal.ts';

const run = promisify(execFile);
test('cold setup and backup failures exit promptly and release ownership of a corrupt file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-cold-cli-'));
  const databasePath = join(directory, 'invalid.sqlite');
  try {
    await writeFile(databasePath, 'This disposable file is not a database.');
    for (const args of [['server/setup.ts'], ['scripts/deploy/backup.ts', 'run']]) {
      await expect(
        run(process.execPath, ['--max-old-space-size=128', ...args], {
          cwd: resolve(import.meta.dirname, '../../..'),
          env: { ...process.env, DATABASE_PATH: databasePath },
          timeout: 5000,
        }),
      ).rejects.toMatchObject({ code: 1, killed: false });
      const release = await acquireColdWorkspace(databasePath);
      await release();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
