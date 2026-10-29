import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { assertNoPendingRestore, restoreBarrierPath } from './restore-barrier.ts';
import {
  activateRestoreFiles,
  commitRestoreFiles,
  prepareRestoreFiles,
  preserveRestoreOriginals,
  stageRestoreCandidate,
  rollbackRestoreFiles,
} from './restore-files.ts';
import type { RestoreFileControl, RestoreFilePhase } from './restore-files.ts';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const fingerprint = (bytes: Uint8Array) => ({
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-restore-files-')));
  directories.push(directory);
  const root = join(directory, 'recovery');
  await mkdir(root, { mode: 0o700 });
  const databasePath = join(directory, 'live.sqlite');
  const candidatePath = join(directory, 'prepared.sqlite');
  const original = Buffer.alloc(160_003, 0x41);
  const candidate = Buffer.alloc(70_001, 0x42);
  const wal = Buffer.from('original committed WAL evidence');
  const shm = Buffer.from('original runtime index evidence');
  // Existing application files may rely on their private containing directory.
  // Copies in recovery custody must independently have private file modes.
  await writeFile(databasePath, original, { mode: 0o644 });
  await writeFile(databasePath + '-wal', wal, { mode: 0o600 });
  await writeFile(databasePath + '-shm', shm, { mode: 0o600 });
  await writeFile(candidatePath, candidate, { mode: 0o600 });
  const phases: RestoreFilePhase[] = [];
  let closed = true;
  let fail: RestoreFilePhase | undefined;
  const assertClosed = () => {
    if (!closed) throw new Error('A SQLite handle is still open.');
  };
  const control: RestoreFileControl = {
    root,
    databasePath,
    assertClosed,
    readPhase: () => phases.at(-1),
    async persist(phase) {
      if (phase === fail) throw new Error('Journal fsync failed.');
      phases.push(phase);
    },
  };
  const options = {
    root,
    databasePath,
    candidatePath,
    id: randomUUID(),
    expectedCandidate: fingerprint(candidate),
    assertClosed,
  };
  return {
    ...options,
    original,
    candidate,
    wal,
    shm,
    phases,
    control,
    prepare: () => prepareRestoreFiles(options),
    openHandle: () => {
      closed = false;
    },
    failJournal: (phase?: RestoreFilePhase) => {
      fail = phase;
    },
  };
}

test('custody preserves original bytes and activates through the leased inode, behind a durable opening barrier', async () => {
  const f = await fixture();
  const before = await lstat(f.databasePath);
  const files = await f.prepare();
  const custody = join(f.root, `restore-${f.id}`);
  expect(await readFile(f.databasePath)).toEqual(f.original);
  for (const [name, bytes] of [
    ['spinel.sqlite', f.original],
    ['spinel.sqlite-wal', f.wal],
    ['spinel.sqlite-shm', f.shm],
  ] as const) {
    const path = join(custody, 'original', name);
    expect(await readFile(path)).toEqual(bytes);
    expect((await lstat(path)).mode & 0o077).toBe(0);
  }
  expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
  await activateRestoreFiles(f.control, files);
  expect(f.phases).toEqual(['replacing', 'activated']);
  expect(await readFile(f.databasePath)).toEqual(f.candidate);
  expect((await lstat(f.databasePath)).ino).toBe(before.ino);
  await expect(lstat(f.databasePath + '-wal')).rejects.toHaveProperty('code', 'ENOENT');
  await expect(lstat(f.databasePath + '-shm')).rejects.toHaveProperty('code', 'ENOENT');
  expect(() => assertNoPendingRestore(f.databasePath)).toThrow('unfinished workspace restore');
  expect(await readFile(join(custody, 'original', 'spinel.sqlite'))).toEqual(f.original);
  // This filesystem test proves ordering, not SQLite or application health.
  // The supervisor must supply that separate verification before committing.
  await commitRestoreFiles(f.control, files, 'candidate');
  expect(f.phases.at(-1)).toBe('candidate-committed');
  expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
});

test('original custody precedes candidate generation and staging retries never replace a different attempt', async () => {
  const f = await fixture();
  await rm(f.candidatePath);
  const originals = await preserveRestoreOriginals(f);
  const custody = join(f.root, `restore-${f.id}`);
  expect(await readFile(join(custody, 'original', 'spinel.sqlite-wal'))).toEqual(f.wal);
  await expect(lstat(join(custody, 'candidate.sqlite'))).rejects.toHaveProperty('code', 'ENOENT');
  expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
  // The isolated reconciliation worker would produce this later closed file.
  await writeFile(f.candidatePath, f.candidate, { mode: 0o600 });
  const files = await stageRestoreCandidate(f, originals);
  expect(await stageRestoreCandidate(f, originals)).toEqual(files);
  const different = Buffer.from('different later candidate');
  await writeFile(f.candidatePath, different);
  await expect(
    stageRestoreCandidate({ ...f, expectedCandidate: fingerprint(different) }, originals),
  ).rejects.toThrow('changed');
  expect(await readFile(join(custody, 'candidate.sqlite'))).toEqual(f.candidate);
  expect(await readFile(join(custody, 'original', 'spinel.sqlite'))).toEqual(f.original);
  await activateRestoreFiles(f.control, files);
  expect(await readFile(f.databasePath)).toEqual(f.candidate);
});

test('a changed current WAL after custody refuses staging without changing retained originals', async () => {
  const f = await fixture(),
    originals = await preserveRestoreOriginals(f);
  await writeFile(f.databasePath + '-wal', 'later unbound WAL');
  await expect(stageRestoreCandidate(f, originals)).rejects.toThrow('changed');
  const custody = join(f.root, `restore-${f.id}`);
  expect(await readFile(join(custody, 'original', 'spinel.sqlite-wal'))).toEqual(f.wal);
  await expect(lstat(join(custody, 'candidate.sqlite'))).rejects.toHaveProperty('code', 'ENOENT');
});

test('unexpected rollback journals refuse custody and activation while preserving their evidence', async () => {
  const f = await fixture(),
    journal = f.databasePath + '-journal';
  await writeFile(journal, 'unhandled rollback evidence', { mode: 0o600 });
  await expect(preserveRestoreOriginals(f)).rejects.toThrow('rollback journal');
  expect(await readFile(journal, 'utf8')).toBe('unhandled rollback evidence');
  await rm(journal);
  const files = await f.prepare();
  await writeFile(journal, 'unexpected after custody', { mode: 0o600 });
  await expect(activateRestoreFiles(f.control, files)).rejects.toThrow('rollback journal');
  expect(await readFile(f.databasePath)).toEqual(f.original);
  expect(await readFile(journal, 'utf8')).toBe('unexpected after custody');
});

test.each(['replacing', 'activated'] as const)(
  'journal failure at %s retains originals and blocks all ordinary opens',
  async (phase) => {
    const f = await fixture();
    const files = await f.prepare();
    f.failJournal(phase);
    await expect(activateRestoreFiles(f.control, files)).rejects.toThrow('Journal fsync failed');
    expect(await readFile(f.databasePath)).toEqual(
      phase === 'replacing' ? f.original : f.candidate,
    );
    expect(() => assertNoPendingRestore(f.databasePath)).toThrow();
    f.failJournal();
    await rollbackRestoreFiles(f.control, files);
    expect(await readFile(f.databasePath)).toEqual(f.original);
    expect(await readFile(f.databasePath + '-wal')).toEqual(f.wal);
    await expect(lstat(f.databasePath + '-shm')).rejects.toHaveProperty('code', 'ENOENT');
    expect(() => assertNoPendingRestore(f.databasePath)).toThrow();
  },
);

test('partial overwrite and interrupted rollback replay from immutable originals and preserve the inode', async () => {
  const f = await fixture();
  const files = await f.prepare();
  await activateRestoreFiles(f.control, files);
  // Simulate interrupted data/sidecar writes. Real process-cut coverage is also
  // required when the supervisor operation integrates these file primitives.
  await writeFile(f.databasePath, Buffer.from('partial candidate'));
  await writeFile(f.databasePath + '-wal', Buffer.from('partial candidate WAL'));
  f.failJournal('rolled-back');
  await expect(rollbackRestoreFiles(f.control, files)).rejects.toThrow('Journal fsync failed');
  await writeFile(f.databasePath, Buffer.from('partial rollback'));
  f.failJournal();
  await rollbackRestoreFiles(f.control, files);
  await rollbackRestoreFiles(f.control, files);
  expect(await readFile(f.databasePath)).toEqual(f.original);
  expect(await readFile(f.databasePath + '-wal')).toEqual(f.wal);
  expect(String((await lstat(f.databasePath)).ino)).toBe(files.identity.inode);
  f.failJournal('original-committed');
  await expect(commitRestoreFiles(f.control, files, 'original')).rejects.toThrow(
    'Journal fsync failed',
  );
  expect(() => assertNoPendingRestore(f.databasePath)).toThrow();
  f.failJournal();
  await commitRestoreFiles(f.control, files, 'original');
  expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
  // A completed restore cannot later replay rollback over newly accepted work.
  await writeFile(f.databasePath, Buffer.from('newly accepted work'));
  await expect(rollbackRestoreFiles(f.control, files)).rejects.toThrow('committed');
  expect(await readFile(f.databasePath)).toEqual(Buffer.from('newly accepted work'));
});

test.each(['candidate', 'original'] as const)(
  'durable %s commitment forbids rollback even when marker cleanup has failed',
  async (outcome) => {
    const f = await fixture(),
      files = await f.prepare();
    await activateRestoreFiles(f.control, files);
    if (outcome === 'original') await rollbackRestoreFiles(f.control, files);
    const marker = restoreBarrierPath(f.databasePath),
      pending = `${marker}.${files.id}.pending`;
    // An unexpected temporary-marker inode makes cleanup fail AFTER persist.
    await writeFile(pending, 'unexpected pending marker', { mode: 0o600 });
    await expect(commitRestoreFiles(f.control, files, outcome)).rejects.toThrow('changed');
    expect(f.control.readPhase()).toBe(`${outcome}-committed`);
    expect(() => assertNoPendingRestore(f.databasePath)).toThrow();
    const selected = await readFile(f.databasePath);
    await expect(rollbackRestoreFiles(f.control, files)).rejects.toThrow('committed');
    await expect(activateRestoreFiles(f.control, files)).rejects.toThrow('committed');
    await expect(
      commitRestoreFiles(f.control, files, outcome === 'candidate' ? 'original' : 'candidate'),
    ).rejects.toThrow('committed');
    expect(await readFile(f.databasePath)).toEqual(selected);
    await rm(pending);
    await commitRestoreFiles(f.control, files, outcome);
    expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
    expect(await readFile(f.databasePath)).toEqual(selected);
    // Re-enter after unlink but before the original directory fsync completed.
    // Newly acknowledged bytes must never be replaced on terminal cleanup retry.
    await writeFile(f.databasePath, 'new acknowledged work');
    await commitRestoreFiles(f.control, files, outcome);
    expect(await readFile(f.databasePath)).toEqual(Buffer.from('new acknowledged work'));
  },
);

test.each(['changed original', 'changed candidate', 'replacement inode', 'open handle'] as const)(
  'rejects %s before the first destructive write',
  async (change) => {
    const f = await fixture();
    const files = await f.prepare();
    if (change === 'changed original') await writeFile(f.databasePath, 'newer work');
    if (change === 'changed candidate')
      await writeFile(join(f.root, `restore-${f.id}`, 'candidate.sqlite'), 'corrupt');
    if (change === 'replacement inode') {
      await rm(f.databasePath);
      await writeFile(f.databasePath, 'different database', { mode: 0o600 });
    }
    if (change === 'open handle') f.openHandle();
    const expected = await readFile(f.databasePath);
    await expect(activateRestoreFiles(f.control, files)).rejects.toThrow();
    expect(await readFile(f.databasePath)).toEqual(expected);
    expect(f.phases).toEqual([]);
    expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
  },
);

test('rejects candidate WAL and source aliases without changing current data', async () => {
  const f = await fixture();
  const originals = await preserveRestoreOriginals(f);
  await writeFile(f.candidatePath + '-wal', 'uncheckpointed content', { mode: 0o600 });
  await expect(stageRestoreCandidate(f, originals)).rejects.toThrow('self-contained');
  await rm(f.candidatePath + '-wal');
  await rm(f.candidatePath);
  await symlink(f.databasePath, f.candidatePath);
  await expect(stageRestoreCandidate(f, originals)).rejects.toThrow();
  await rm(f.candidatePath);
  await link(f.databasePath, f.candidatePath);
  await expect(stageRestoreCandidate(f, originals)).rejects.toThrow();
  await rm(f.candidatePath);
  await writeFile(f.candidatePath, f.candidate, { mode: 0o600 });
  await stageRestoreCandidate(f, originals);
  expect(await readFile(f.databasePath)).toEqual(f.original);
});

test('rejects reused operation IDs without replacing original custody', async () => {
  const f = await fixture();
  await f.prepare();
  await expect(f.prepare()).rejects.toHaveProperty('code', 'EEXIST');
  expect(await readFile(f.databasePath)).toEqual(f.original);
});

test('identical staging retry reserves no second candidate allocation', async () => {
  const f = await fixture();
  const originals = await preserveRestoreOriginals(f);
  const reserve = 256 * 1024 * 1024;
  const availableBytes = async () => BigInt(2 * reserve + 2 * f.candidate.length);
  await expect(stageRestoreCandidate({ ...f, availableBytes }, originals)).rejects.toThrow(
    'disk space',
  );
  const files = await stageRestoreCandidate(f, originals);
  expect(await stageRestoreCandidate({ ...f, availableBytes }, originals)).toEqual(files);
  expect(await readFile(f.databasePath)).toEqual(f.original);
});

test('missing original evidence and changed barrier identities cannot authorize rollback', async () => {
  const f = await fixture();
  const files = await f.prepare();
  await activateRestoreFiles(f.control, files);
  const marker = restoreBarrierPath(f.databasePath);
  await writeFile(marker, '{}');
  await expect(rollbackRestoreFiles(f.control, files)).rejects.toThrow();
  expect(await readFile(f.databasePath)).toEqual(f.candidate);
  await rm(join(f.root, `restore-${f.id}`, 'original', 'spinel.sqlite'));
  await expect(rollbackRestoreFiles(f.control, files)).rejects.toThrow();
  expect(() => assertNoPendingRestore(f.databasePath)).toThrow();
  await rm(marker);
  await symlink('missing-marker-target', marker);
  expect(() => assertNoPendingRestore(f.databasePath)).toThrow();
});

test.each(['', '{"version":', 'complete but not published'])(
  'an interrupted temporary marker (%s) never authorizes mutation and can be safely replaced',
  async (partial) => {
    const f = await fixture();
    const files = await f.prepare();
    const pending = `${restoreBarrierPath(f.databasePath)}.${files.id}.pending`;
    await writeFile(pending, partial, { mode: 0o600 });
    expect(await readFile(f.databasePath)).toEqual(f.original);
    expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
    await activateRestoreFiles(f.control, files);
    await expect(lstat(pending)).rejects.toHaveProperty('code', 'ENOENT');
    await rollbackRestoreFiles(f.control, files);
    expect(await readFile(f.databasePath)).toEqual(f.original);
  },
);

test('interruption after atomic marker publication leaves a readable barrier and removable temporary link', async () => {
  const f = await fixture();
  const files = await f.prepare();
  await activateRestoreFiles(f.control, files);
  const pending = `${restoreBarrierPath(f.databasePath)}.${files.id}.pending`;
  await link(restoreBarrierPath(f.databasePath), pending);
  await rollbackRestoreFiles(f.control, files);
  await commitRestoreFiles(f.control, files, 'original');
  await expect(lstat(pending)).rejects.toHaveProperty('code', 'ENOENT');
  expect(await readFile(f.databasePath)).toEqual(f.original);
});

test('capacity lost after preparation or before rollback refuses mutation and retains all source evidence', async () => {
  const f = await fixture();
  const files = await f.prepare();
  f.control.availableBytes = async () => 0n;
  await expect(activateRestoreFiles(f.control, files)).rejects.toThrow('Not enough disk space');
  expect(f.phases).toEqual([]);
  expect(await readFile(f.databasePath)).toEqual(f.original);
  expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
  f.control.availableBytes = undefined;
  await activateRestoreFiles(f.control, files);
  f.control.availableBytes = async () => 0n;
  await expect(rollbackRestoreFiles(f.control, files)).rejects.toThrow('Not enough disk space');
  expect(await readFile(f.databasePath)).toEqual(f.candidate);
  expect(await readFile(join(f.root, `restore-${files.id}`, 'original', 'spinel.sqlite'))).toEqual(
    f.original,
  );
  expect(() => assertNoPendingRestore(f.databasePath)).toThrow();
  f.control.availableBytes = undefined;
  await rollbackRestoreFiles(f.control, files);
  expect(await readFile(f.databasePath)).toEqual(f.original);
});
