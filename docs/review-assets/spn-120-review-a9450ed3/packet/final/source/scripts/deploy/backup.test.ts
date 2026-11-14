import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { FilesystemStore, filesystemIdentity } from '../../src/server/backup/filesystem.ts';

const script = fileURLToPath(new URL('./backup.ts', import.meta.url));
function run(args: string[], environment: NodeJS.ProcessEnv = {}) {
  const childEnvironment = { ...process.env, ...environment };
  // This is an ordinary CLI invocation, not a nested node:test worker.
  delete childEnvironment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: childEnvironment,
    timeout: 30_000,
  });
  assert.ifError(result.error);
  return result;
}
test('manual-only CLI operations fail before opening data and never expose configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-cli-manual-'));
  try {
    const config = join(directory, 'config');
    const output = join(directory, 'output');
    const database = join(directory, 'must-not-create.sqlite');
    await writeFile(
      config,
      JSON.stringify({
        type: 'manual',
        prefix: 'fixture',
        keyFile: '/private/secret-recovery-key-path',
        runtimeEnvironmentFile: '/private/secret-runtime-path',
      }),
      { mode: 0o600 },
    );
    for (const args of [
      ['list', config],
      ['download', config, 'arbitrary', output],
      ['run'],
      ['verify'],
    ]) {
      const result = run(args, { BACKUP_CONFIG_PATH: config, DATABASE_PATH: database });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /This policy has no backup destination/);
      assert.match(result.stderr, /Offline restore remains available/);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /secret-recovery|secret-runtime|must-not-create/);
    }
    assert.deepEqual(await readdir(directory), ['config']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'independent CLI filesystem listing/download preserve complete encrypted bytes and refuse overwrite',
  {
    skip: process.platform !== 'linux',
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spinel-cli-filesystem-'));
    try {
      const root = join(directory, 'destination');
      await mkdir(root, { mode: 0o700 });
      const config = {
        type: 'filesystem' as const,
        ...(await filesystemIdentity(root)),
        prefix: 'fixture',
        keyFile: '/unavailable-offline-key',
        runtimeEnvironmentFile: '/unavailable-runtime',
      };
      const path = join(directory, 'config');
      await writeFile(path, JSON.stringify(config), { mode: 0o600 });
      const store = new FilesystemStore(config);
      const source = join(directory, 'encrypted-source');
      const bytes = Buffer.from('already encrypted portable recovery bytes');
      await writeFile(source, bytes, { mode: 0o600 });
      const id = `fixture/2026-10-27T02-00-00.000Z-${randomUUID()}.spinel`;
      await store.put(
        id,
        source,
        createHash('sha256').update(bytes).digest('hex'),
        AbortSignal.timeout(1000),
      );
      // Abandoned staging is never advertised as a selectable recovery point.
      await writeFile(join(root, 'fixture', `.pending-${randomUUID()}`), 'incomplete', {
        mode: 0o600,
      });
      const list = run(['list', path]);
      assert.equal(list.status, 0, list.stderr);
      assert.equal(list.stdout.trim(), id);
      const output = join(directory, 'download.spinel');
      const downloaded = run(['download', path, id, output]);
      assert.equal(downloaded.status, 0, downloaded.stderr);
      assert.deepEqual(await readFile(output), bytes);
      await writeFile(output, 'retained local file');
      const repeated = run(['download', path, id, output]);
      assert.equal(repeated.status, 1);
      assert.equal(await readFile(output, 'utf8'), 'retained local file');
      const foreign = run([
        'download',
        path,
        id.replace('fixture/', 'other/'),
        join(directory, 'foreign'),
      ]);
      assert.equal(foreign.status, 1);
      assert.equal((await readdir(directory)).includes('foreign'), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
