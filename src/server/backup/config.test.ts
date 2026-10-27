import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { loadConfig } from './config.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const common = {
  prefix: 'instance',
  keyFile: '/private/key',
  runtimeEnvironmentFile: '/private/runtime',
};
async function config(value: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-backup-config-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config');
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}
test('legacy Spaces configuration remains valid with explicit recovery defaults', async () => {
  const value = {
    ...common,
    region: 'sfo3',
    bucket: 'test-bucket',
    accessKeyId: 'fixture',
    secretAccessKey: 'fixture-secret',
  };
  expect(await loadConfig(await config(value))).toMatchObject({
    ...value,
    type: 'spaces',
    keyId: 'default',
    backupHourUtc: 2,
    verificationDayUtc: 0,
    verificationHourUtc: 3,
  });
});
test('filesystem config needs no cloud credentials and retains exact device/inode identities', async () => {
  const value = {
    ...common,
    type: 'filesystem',
    root: '/private/backups',
    rootDevice: '2097152',
    rootInode: '18014398509481984',
    keyId: 'current',
    retainedKeyFiles: { old: '/private/old-key' },
    backupHourUtc: 8,
    verificationDayUtc: 4,
    verificationHourUtc: 9,
  };
  const loaded = await loadConfig(await config(value));
  expect(loaded).toMatchObject(value);
  expect(loaded).not.toHaveProperty('region');
  expect(loaded).not.toHaveProperty('accessKeyId');
});
test('unknown destinations, unsafe roots/identities and invalid schedules/keys fail closed', async () => {
  const value = {
    ...common,
    type: 'filesystem',
    root: '/private/backups',
    rootDevice: '2097152',
    rootInode: '123',
  };
  for (const change of [
    { type: 'anything' },
    { prefix: '../escape' },
    { root: '/' },
    { root: 'relative' },
    { root: '/private/../backups' },
    { rootDevice: 2097152 },
    { rootInode: '' },
    { backupHourUtc: 24 },
    { verificationDayUtc: 7 },
    { verificationHourUtc: -1 },
    { retainedKeyFiles: [] },
    { retainedKeyFiles: { old: 42 } },
    { retainedKeyFiles: { default: '/private/conflicting' } },
  ])
    await expect(loadConfig(await config({ ...value, ...change }))).rejects.toThrow();
  const path = await config(value);
  await chmod(path, 0o644);
  await expect(loadConfig(path)).rejects.toThrow('private');
});
