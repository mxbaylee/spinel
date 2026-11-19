import { createHash, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { restoreBarrierPath } from './restore-barrier.ts';
import {
  activatePreparedRestoreOriginal,
  captureColdRestoreCustody,
  captureRestoreOriginals,
  coldRestoreCustodyInputs,
  commitRestoreFiles,
  preserveColdRestoreCustody,
  preserveRestoreOriginals,
  stagePreparedRestoreOriginal,
  validColdRestoreCustody,
} from './restore-files.ts';
import type {
  ColdRestoreCustodyOptions,
  RestoreFileControl,
  RestoreFilePhase,
} from './restore-files.ts';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const evidence = (bytes: Uint8Array) => ({
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-cold-custody-')));
  directories.push(directory);
  const root = join(directory, 'recovery'),
    databasePath = join(directory, 'live.sqlite'),
    prepared = join(directory, 'prepared.sqlite');
  await mkdir(root, { mode: 0o700 });
  const original = Buffer.alloc(160_003, 0x41),
    interrupted = Buffer.alloc(131_079, 0x42),
    replacement = Buffer.alloc(70_001, 0x43),
    wal = Buffer.from('interrupted private trial WAL');
  await writeFile(databasePath, original, { mode: 0o600 });
  const id = randomUUID(),
    assertClosed = vi.fn();
  const originals = await preserveRestoreOriginals({ root, databasePath, id, assertClosed });
  // Custody must handle an interrupted overwrite without assuming valid SQLite.
  await writeFile(databasePath, interrupted);
  await writeFile(databasePath + '-wal', wal, { mode: 0o600 });
  await writeFile(databasePath + '-shm', '', { mode: 0o600 });
  await writeFile(prepared, replacement, { mode: 0o600 });
  const marker = restoreBarrierPath(databasePath);
  await writeFile(
    marker,
    JSON.stringify({ version: 1, operationId: id, identity: originals.identity }) + '\n',
    { mode: 0o600 },
  );
  const options: ColdRestoreCustodyOptions = {
    root,
    databasePath,
    id,
    captureId: randomUUID(),
    identity: originals.identity,
    deadline: Date.now() + 60_000,
    assertClosed,
  };
  const phases: RestoreFilePhase[] = [];
  const control: RestoreFileControl = {
    root,
    databasePath,
    deadline: options.deadline,
    assertClosed,
    readPhase: () => phases.at(-1),
    async persist(phase) {
      phases.push(phase);
    },
  };
  const job = join(root, `restore-${id}`),
    capture = join(job, `cold-${options.captureId}`),
    raw = join(capture, 'raw');
  return {
    root,
    databasePath,
    original,
    interrupted,
    replacement,
    wal,
    prepared,
    originals,
    marker,
    options,
    control,
    phases,
    job,
    capture,
    raw,
    files: { ...originals, candidate: evidence(replacement) },
  };
}

test('cold custody retains a partial closed tuple without claiming a logical witness or changing original custody', async () => {
  const f = await fixture(),
    manifest = await captureColdRestoreCustody(f.options);
  expect(existsSync(f.capture)).toBe(false);
  expect(validColdRestoreCustody(manifest)).toBe(true);
  expect(manifest.files['spinel.sqlite']).toEqual(evidence(f.interrupted));
  expect(manifest).not.toHaveProperty('witness');
  expect(manifest).not.toHaveProperty('fingerprint');
  await preserveColdRestoreCustody(f.options, manifest);
  const saved = join(f.raw, 'spinel.sqlite'),
    inode = (await lstat(saved)).ino;
  expect(await readFile(saved)).toEqual(f.interrupted);
  expect(await readFile(join(f.raw, 'spinel.sqlite-wal'))).toEqual(f.wal);
  expect(await readFile(join(f.raw, 'spinel.sqlite-shm'))).toHaveLength(0);
  expect(coldRestoreCustodyInputs(f.root, manifest)).toEqual({
    database: { path: saved, ...evidence(f.interrupted) },
    wal: { path: join(f.raw, 'spinel.sqlite-wal'), ...evidence(f.wal) },
  });
  await expect(preserveColdRestoreCustody(f.options, manifest)).resolves.toEqual(manifest);
  expect((await lstat(saved)).ino).toBe(inode);
  expect(await readFile(join(f.job, 'original', 'spinel.sqlite'))).toEqual(f.original);
  expect(await readFile(f.databasePath)).toEqual(f.interrupted);
  // The ordinary original-capture path must still refuse a restore barrier.
  await expect(captureRestoreOriginals(f.options)).rejects.toThrow('unfinished');
});

test.each([
  'missing-barrier',
  'wrong-barrier',
  'wrong-identity',
  'open-owner',
  'expired',
  'journal',
  'public-directory',
  'symlink',
  'hardlink',
])('cold capture refuses %s before creating custody', async (kind) => {
  const f = await fixture();
  if (kind === 'missing-barrier') await rm(f.marker);
  if (kind === 'wrong-barrier')
    await writeFile(
      f.marker,
      JSON.stringify({ version: 1, operationId: randomUUID(), identity: f.originals.identity }),
    );
  if (kind === 'wrong-identity') f.options.identity = { device: '1', inode: '2' };
  if (kind === 'open-owner')
    f.options.assertClosed = () => {
      throw new Error('Workspace owner is still open.');
    };
  if (kind === 'expired') f.options.deadline = Date.now() - 1;
  if (kind === 'journal') await writeFile(f.databasePath + '-journal', '', { mode: 0o600 });
  if (kind === 'public-directory') await chmod(dirname(f.databasePath), 0o755);
  if (kind === 'symlink') {
    await rename(f.databasePath + '-wal', f.databasePath + '-other');
    await symlink(f.databasePath + '-other', f.databasePath + '-wal');
  }
  if (kind === 'hardlink') await link(f.databasePath, f.databasePath + '-alias');
  await expect(captureColdRestoreCustody(f.options)).rejects.toThrow();
  expect(existsSync(f.capture)).toBe(false);
});

test('partial activation can retain original live modes inside its private directory', async () => {
  const f = await fixture();
  for (const suffix of ['', '-wal', '-shm']) await chmod(f.databasePath + suffix, 0o644);
  const manifest = await captureColdRestoreCustody(f.options);
  await preserveColdRestoreCustody(f.options, manifest);
  for (const name of ['spinel.sqlite', 'spinel.sqlite-wal', 'spinel.sqlite-shm']) {
    expect((await lstat(join(f.raw, name))).mode & 0o077).toBe(0);
    expect(await readFile(join(f.raw, name))).toEqual(
      await readFile(f.databasePath + name.slice('spinel.sqlite'.length)),
    );
  }
});

test.each(['changed-wal', 'missing-wal', 'new-sidecar', 'changed-manifest'])(
  'a persisted cold capture cannot be redefined after %s',
  async (kind) => {
    const f = await fixture();
    if (kind === 'new-sidecar') await rm(f.databasePath + '-shm');
    const manifest = await captureColdRestoreCustody(f.options);
    if (kind === 'changed-wal') await writeFile(f.databasePath + '-wal', 'different');
    if (kind === 'missing-wal') await rm(f.databasePath + '-wal');
    if (kind === 'new-sidecar') await writeFile(f.databasePath + '-shm', '', { mode: 0o600 });
    if (kind === 'changed-manifest') manifest.captureId = randomUUID();
    await expect(preserveColdRestoreCustody(f.options, manifest)).rejects.toThrow();
    expect(existsSync(f.capture)).toBe(false);
  },
);

test('a cancelled cold copy preserves partial bytes and refuses an overwrite retry', async () => {
  const f = await fixture();
  await chmod(f.databasePath, 0o644);
  const manifest = await captureColdRestoreCustody(f.options),
    abort = new AbortController(),
    target = join(f.raw, 'spinel.sqlite');
  f.options.signal = abort.signal;
  f.options.assertAuthorized = () => {
    if (existsSync(target) && statSync(target).size >= 64 * 1024) abort.abort();
  };
  await expect(preserveColdRestoreCustody(f.options, manifest)).rejects.toThrow();
  expect((await lstat(target)).size).toBe(64 * 1024);
  f.options.signal = undefined;
  f.options.assertAuthorized = undefined;
  await expect(preserveColdRestoreCustody(f.options, manifest)).rejects.toThrow();
  expect((await lstat(target)).size).toBe(64 * 1024);
  expect(await readFile(f.databasePath)).toEqual(f.interrupted);
});

test('cold original activation uses the shared installer and preserves both raw generations', async () => {
  const f = await fixture(),
    manifest = await captureColdRestoreCustody(f.options),
    attempt = randomUUID(),
    inode = (await lstat(f.databasePath)).ino;
  await preserveColdRestoreCustody(f.options, manifest);
  await stagePreparedRestoreOriginal(f.control, f.files, manifest, attempt, f.prepared);
  await activatePreparedRestoreOriginal(f.control, f.files, manifest, attempt);
  expect(f.phases).toEqual(['rolling-back', 'rolled-back']);
  expect((await lstat(f.databasePath)).ino).toBe(inode);
  expect(await readFile(f.databasePath)).toEqual(f.replacement);
  expect(existsSync(f.databasePath + '-wal')).toBe(false);
  expect(existsSync(f.databasePath + '-shm')).toBe(false);
  expect(existsSync(f.marker)).toBe(true);
  expect(await readFile(join(f.job, 'original', 'spinel.sqlite'))).toEqual(f.original);
  expect(await readFile(join(f.raw, 'spinel.sqlite'))).toEqual(f.interrupted);
  expect(await readFile(join(f.raw, 'spinel.sqlite-wal'))).toEqual(f.wal);
  await commitRestoreFiles(f.control, f.files, 'original');
  await writeFile(f.databasePath, 'new acknowledged work');
  await expect(
    activatePreparedRestoreOriginal(f.control, f.files, manifest, attempt),
  ).rejects.toThrow('committed');
  await expect(
    stagePreparedRestoreOriginal(f.control, f.files, manifest, randomUUID(), f.prepared),
  ).rejects.toThrow('committed');
  expect(await readFile(f.databasePath, 'utf8')).toBe('new acknowledged work');
});

test.each(['live', 'captured', 'original', 'barrier', 'inode', 'public-capture', 'open-owner'])(
  'cold activation refuses changed %s evidence without replacing the live tuple',
  async (kind) => {
    const f = await fixture(),
      manifest = await captureColdRestoreCustody(f.options),
      attempt = randomUUID();
    await preserveColdRestoreCustody(f.options, manifest);
    await stagePreparedRestoreOriginal(f.control, f.files, manifest, attempt, f.prepared);
    if (kind === 'live') await writeFile(f.databasePath + '-wal', 'changed WAL');
    if (kind === 'captured') await writeFile(join(f.raw, 'spinel.sqlite'), 'changed capture');
    if (kind === 'original')
      await writeFile(join(f.job, 'original', 'spinel.sqlite'), 'changed original');
    if (kind === 'barrier') await rm(f.marker);
    if (kind === 'inode') {
      await rename(f.databasePath, f.databasePath + '-old');
      await writeFile(f.databasePath, f.interrupted, { mode: 0o600 });
    }
    if (kind === 'public-capture') await chmod(join(f.raw, 'spinel.sqlite'), 0o644);
    if (kind === 'open-owner')
      f.control.assertClosed = () => {
        throw new Error('Workspace owner is still open.');
      };
    const bytes = await readFile(f.databasePath);
    await expect(
      activatePreparedRestoreOriginal(f.control, f.files, manifest, attempt),
    ).rejects.toThrow();
    expect(await readFile(f.databasePath)).toEqual(bytes);
    expect(f.phases).toEqual([]);
  },
);

test('cold manifests have an exact schema and cannot acquire witness authority', async () => {
  const f = await fixture(),
    manifest = await captureColdRestoreCustody(f.options);
  for (const invalid of [
    { ...manifest, witness: { fingerprint: 'a'.repeat(64) } },
    { ...manifest, kind: 'failed' },
    { ...manifest, captureId: '../original' },
    { ...manifest, captureId: manifest.jobId },
    { ...manifest, jobId: '../job' },
    { ...manifest, files: { ...manifest.files, 'spinel.sqlite': null } },
  ])
    expect(validColdRestoreCustody(invalid)).toBe(false);
});
