import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { fileIdentity } from './journal.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { captureRestoreOriginals } from './restore-files.ts';
import { restoreBarrierPath } from './restore-barrier.ts';
import { restoreTrialReference } from './restore-trial.ts';
import type { RestoreTrialPermit } from './restore-trial.ts';
import {
  captureFailedRestoreCustody,
  failedRestoreCustodyInputs,
  preserveFailedRestoreCustody,
  validFailedRestoreCustody,
} from './restore-failed-custody.ts';
import type { FailedRestoreCustodyOptions } from './restore-failed-custody.ts';

const cleanup: string[] = [];
afterEach(async () => {
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-failed-custody-')));
  cleanup.push(directory);
  const root = join(directory, 'recovery'),
    data = join(directory, 'data');
  for (const path of [root, data]) await mkdir(path, { mode: 0o700 });
  const databasePath = join(data, 'workspace.sqlite');
  // File custody only; these bytes are never asserted to be valid SQLite.
  const bytes = Buffer.alloc(131_079, 17),
    wal = Buffer.alloc(70003, 42);
  await writeFile(databasePath, bytes, { mode: 0o600 });
  await writeFile(databasePath + '-wal', wal, { mode: 0o600 });
  await writeFile(databasePath + '-shm', '', { mode: 0o600 });
  const now = Date.now(),
    intent = restoreJobIntentFixture(now);
  const permit: RestoreTrialPermit = {
    version: 1,
    jobId: intent.id,
    intentHash: 'a'.repeat(64),
    attemptId: randomUUID(),
    nonce: randomUUID(),
    role: 'candidate',
    child: { pid: 321, start: '123', boot: randomUUID(), token: randomUUID() },
    generationId: randomUUID(),
    epoch: randomUUID(),
    databasePath,
    identity: fileIdentity(databasePath),
    output: { bytes: 4096, sha256: 'b'.repeat(64), fingerprint: 'c'.repeat(64) },
    policy: intent.policy,
    maximumBytes: 1024 ** 2,
    deadline: now - 2000,
  };
  const stop = {
    reference: restoreTrialReference(permit),
    child: permit.child,
    request: {
      jobId: permit.jobId,
      challengeId: randomUUID(),
      generationId: permit.generationId,
      epoch: permit.epoch,
      deadline: now - 500,
    },
  };
  const marker = restoreBarrierPath(databasePath);
  await writeFile(
    marker,
    JSON.stringify({ version: 1, operationId: permit.jobId, identity: permit.identity }) + '\n',
    { mode: 0o600 },
  );
  const job = join(root, `restore-${permit.jobId}`);
  await mkdir(job, { mode: 0o700 });
  await mkdir(join(job, 'original'), { mode: 0o700 });
  await writeFile(join(job, 'original', 'spinel.sqlite'), 'immutable original', { mode: 0o600 });
  const options: FailedRestoreCustodyOptions = {
    root,
    databasePath,
    permit,
    stop,
    witness: { fingerprint: 'd'.repeat(64), acceptedAt: now - 1000 },
    captureId: randomUUID(),
    now: () => now,
    deadline: now + 60_000,
    assertClosed: vi.fn(),
  };
  const capture = join(job, `failed-${options.captureId}`),
    raw = join(capture, 'raw');
  return { options, root, databasePath, bytes, wal, marker, job, capture, raw, now };
}

test('separately captures exact failed tuple, retains original bytes and retries only its persisted manifest', async () => {
  const f = await fixture();
  const manifest = await captureFailedRestoreCustody(f.options);
  expect(existsSync(f.capture)).toBe(false);
  expect(validFailedRestoreCustody(manifest)).toBe(true);
  expect(manifest.witness.fingerprint).not.toBe(f.options.permit.output.fingerprint);
  await preserveFailedRestoreCustody(f.options, manifest);
  expect(await readFile(join(f.raw, 'spinel.sqlite'))).toEqual(f.bytes);
  expect(await readFile(join(f.raw, 'spinel.sqlite-wal'))).toEqual(f.wal);
  expect(await readFile(join(f.raw, 'spinel.sqlite-shm'))).toHaveLength(0);
  const inode = (await stat(join(f.raw, 'spinel.sqlite'))).ino;
  await expect(preserveFailedRestoreCustody(f.options, manifest)).resolves.toEqual(manifest);
  expect((await stat(join(f.raw, 'spinel.sqlite'))).ino).toBe(inode);
  expect(await readFile(join(f.job, 'original', 'spinel.sqlite'), 'utf8')).toBe(
    'immutable original',
  );
  expect(await readFile(f.databasePath)).toEqual(f.bytes);
  expect(failedRestoreCustodyInputs(f.root, manifest)).toEqual({
    database: { path: join(f.raw, 'spinel.sqlite'), ...manifest.files['spinel.sqlite'] },
    wal: { path: join(f.raw, 'spinel.sqlite-wal'), ...manifest.files['spinel.sqlite-wal'] },
    fingerprint: manifest.witness.fingerprint,
  });
  await expect(
    captureRestoreOriginals({
      root: f.root,
      id: f.options.permit.jobId,
      databasePath: f.databasePath,
      assertClosed() {},
    }),
  ).rejects.toThrow('unfinished');
});

test.each([
  'late-witness',
  'wrong-attempt',
  'wrong-child',
  'missing-barrier',
  'wrong-barrier',
  'open-owner',
  'journal',
])('refuses %s before creating failed custody', async (kind) => {
  const f = await fixture();
  if (kind === 'late-witness') f.options.witness.acceptedAt = f.options.stop.request.deadline;
  if (kind === 'wrong-attempt')
    f.options.stop.reference = { ...f.options.stop.reference, attemptId: randomUUID() };
  if (kind === 'wrong-child') f.options.stop.child = { ...f.options.stop.child, start: '124' };
  if (kind === 'missing-barrier') await rm(f.marker);
  if (kind === 'wrong-barrier')
    await writeFile(
      f.marker,
      JSON.stringify({
        version: 1,
        operationId: randomUUID(),
        identity: f.options.permit.identity,
      }),
    );
  if (kind === 'open-owner')
    f.options.assertClosed = () => {
      throw new Error('An owner is still open');
    };
  if (kind === 'journal') await writeFile(f.databasePath + '-journal', '', { mode: 0o600 });
  await expect(captureFailedRestoreCustody(f.options)).rejects.toThrow();
  expect(existsSync(f.capture)).toBe(false);
});

test.each(['wal-changed', 'wal-missing', 'new-sidecar', 'manifest-changed'])(
  'cannot redefine the persisted failed tuple after %s',
  async (kind) => {
    const f = await fixture();
    if (kind === 'new-sidecar') await rm(f.databasePath + '-shm');
    const manifest = await captureFailedRestoreCustody(f.options);
    if (kind === 'wal-changed') await writeFile(f.databasePath + '-wal', 'different');
    if (kind === 'wal-missing') await rm(f.databasePath + '-wal');
    if (kind === 'new-sidecar') await writeFile(f.databasePath + '-shm', '', { mode: 0o600 });
    if (kind === 'manifest-changed') manifest.witness.fingerprint = 'e'.repeat(64);
    await expect(preserveFailedRestoreCustody(f.options, manifest)).rejects.toThrow();
    expect(existsSync(f.capture)).toBe(false);
  },
);

test.each(['clock', 'abort'])(
  'a %s boundary after first chunk leaves partial evidence that cannot be overwritten',
  async (kind) => {
    const f = await fixture(),
      manifest = await captureFailedRestoreCustody(f.options);
    const controller = new AbortController(),
      target = join(f.raw, 'spinel.sqlite');
    f.options.signal = controller.signal;
    f.options.now = () => {
      if (existsSync(target) && statSync(target).size >= 64 * 1024) {
        if (kind === 'abort') controller.abort();
        else return f.options.deadline;
      }
      return f.now;
    };
    await expect(preserveFailedRestoreCustody(f.options, manifest)).rejects.toThrow();
    expect((await stat(target)).size).toBe(64 * 1024);
    f.options.signal = undefined;
    f.options.now = () => f.now;
    await expect(preserveFailedRestoreCustody(f.options, manifest)).rejects.toThrow();
    expect((await stat(target)).size).toBe(64 * 1024);
    expect(await readFile(f.databasePath)).toEqual(f.bytes);
    expect(existsSync(f.marker)).toBe(true);
  },
);

test('complete copied evidence survives a later closure failure and can be resynced without replacement', async () => {
  const f = await fixture(),
    manifest = await captureFailedRestoreCustody(f.options);
  const target = join(f.raw, 'spinel.sqlite');
  f.options.assertClosed = () => {
    if (existsSync(target) && statSync(target).size === f.bytes.length)
      throw new Error('Injected late closure failure');
  };
  await expect(preserveFailedRestoreCustody(f.options, manifest)).rejects.toThrow('late closure');
  const inode = (await stat(target)).ino;
  f.options.assertClosed = () => {};
  await preserveFailedRestoreCustody(f.options, manifest);
  expect((await stat(target)).ino).toBe(inode);
  await writeFile(join(f.raw, 'unexpected'), 'untrusted', { mode: 0o600 });
  await expect(preserveFailedRestoreCustody(f.options, manifest)).rejects.toThrow();
});

test('historical failed custody has a strict schema and cannot claim a late accepted witness', async () => {
  const f = await fixture(),
    manifest = await captureFailedRestoreCustody(f.options);
  for (const invalid of [
    { ...manifest, extra: true },
    { ...manifest, captureId: '../original' },
    { ...manifest, witness: { ...manifest.witness, acceptedAt: manifest.stop.request.deadline } },
    { ...manifest, witness: { ...manifest.witness, source: 'readiness' } },
    { ...manifest, files: { ...manifest.files, 'spinel.sqlite': null } },
  ])
    expect(validFailedRestoreCustody(invalid)).toBe(false);
});
