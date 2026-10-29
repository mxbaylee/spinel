import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  chmod,
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
import { afterEach, expect, test, vi } from 'vitest';
import { assertNoPendingRestore, restoreBarrierPath } from './restore-barrier.ts';
import {
  activateRestoreFiles,
  commitRestoreFiles,
  prepareRestoreFiles,
  preserveRestoreOriginals,
  captureRestoreOriginals,
  validRestoreOriginals,
  stageRestoreCandidate,
  rollbackRestoreFiles,
  retainRestoreSource,
  readRetainedRestoreSource,
  validRestoreSourceManifest,
} from './restore-files.ts';
import type { RestoreFileControl, RestoreFilePhase } from './restore-files.ts';
import type { PreparedRestoreSource } from '../backup/verification.ts';

const copyBoundary = vi.hoisted(() => ({
  afterCopy: undefined as undefined | ((source: unknown, target: unknown) => void | Promise<void>),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    async copyFile(...args: Parameters<typeof actual.copyFile>) {
      await actual.copyFile(...args);
      await copyBoundary.afterCopy?.(args[0], args[1]);
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  copyBoundary.afterCopy = undefined;
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

async function sourceFixture() {
  const f = await fixture();
  const archive = Buffer.from('already authenticated encrypted source fixture');
  const path = join(f.root, 'application-upload.spinel.enc');
  await writeFile(path, archive, { mode: 0o600 });
  const source: PreparedRestoreSource = {
    tables: 0,
    rows: 0,
    images: 0,
    snapshots: 0,
    archive: { path, ...fingerprint(archive) },
    databasePath: f.candidatePath,
    databaseBytes: f.candidate.length,
    databaseSha256: fingerprint(f.candidate).sha256,
    logicalFingerprint: 'd'.repeat(64),
    recovery: {
      createdAt: '2026-10-29T00:00:00.000Z',
      origin: 'https://spinel.example',
      image: 'sha256:' + 'a'.repeat(64),
    },
    async dispose() {
      await rm(path);
      await rm(f.candidatePath);
    },
  };
  return {
    ...f,
    archive,
    source,
    options: { root: f.root, id: f.id, source, assertRoot() {} },
    target: join(f.root, `restore-${f.id}-source`),
  };
}

test('source custody retains independent private bytes after application staging is released', async () => {
  const f = await sourceFixture();
  const saved = await retainRestoreSource(f.options);
  expect(validRestoreSourceManifest(saved.manifest)).toBe(true);
  expect(await readFile(saved.archive.path)).toEqual(f.archive);
  expect(await readFile(saved.candidate.databasePath)).toEqual(f.candidate);
  for (const path of [
    saved.archive.path,
    saved.candidate.databasePath,
    join(f.target, 'intent.json'),
    join(f.target, 'ready'),
  ]) {
    const info = await lstat(path);
    expect(info.mode & 0o077).toBe(0);
    expect(info.nlink).toBe(1);
  }
  expect(await readFile(join(f.target, 'intent.json'), 'utf8')).not.toContain(
    f.source.databasePath,
  );
  await f.source.dispose();
  expect(
    await readRetainedRestoreSource({ root: f.root, manifest: saved.manifest, assertRoot() {} }),
  ).toEqual(saved);
  expect(await retainRestoreSource(f.options)).toEqual(saved);
  // This byte-custody test does not establish cryptographic preparation,
  // authorize a target, pause an app, or mutate the live DB/WAL tuple.
  expect(await readFile(f.databasePath)).toEqual(f.original);
  expect(await readFile(f.databasePath + '-wal')).toEqual(f.wal);
  expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
});

test('an interrupted source transfer resumes the same intent, without replacing retained bytes', async () => {
  const f = await sourceFixture();
  let calls = 0;
  await expect(
    retainRestoreSource({
      ...f.options,
      assertRoot() {
        if (++calls === 3) throw new Error('Simulated interruption');
      },
    }),
  ).rejects.toThrow('Simulated interruption');
  const path = join(f.target, 'source.spinel.enc');
  const retained = await lstat(path);
  await expect(lstat(join(f.target, 'ready'))).rejects.toHaveProperty('code', 'ENOENT');
  await expect(lstat(join(f.target, 'candidate.sqlite'))).rejects.toHaveProperty('code', 'ENOENT');
  const saved = await retainRestoreSource(f.options);
  expect((await lstat(saved.archive.path)).ino).toBe(retained.ino);
  expect(await readFile(saved.candidate.databasePath)).toEqual(f.candidate);
  await expect(
    retainRestoreSource({
      ...f.options,
      source: { ...f.source, archive: { ...f.source.archive, sha256: 'f'.repeat(64) } },
    }),
  ).rejects.toThrow('unavailable or changed');
  expect(await readFile(saved.archive.path)).toEqual(f.archive);
});

test('partial source custody with mismatching bytes refuses repair by overwrite', async () => {
  const f = await sourceFixture();
  let calls = 0;
  await expect(
    retainRestoreSource({
      ...f.options,
      assertRoot() {
        if (++calls === 3) throw new Error('Interrupted');
      },
    }),
  ).rejects.toThrow('Interrupted');
  const path = join(f.target, 'source.spinel.enc');
  await writeFile(path, Buffer.alloc(f.archive.length, 0x7a));
  await expect(retainRestoreSource(f.options)).rejects.toThrow('unavailable or changed');
  expect(await readFile(path)).toEqual(Buffer.alloc(f.archive.length, 0x7a));
  expect(await readFile(f.source.archive.path)).toEqual(f.archive);
  await expect(lstat(join(f.target, 'ready'))).rejects.toHaveProperty('code', 'ENOENT');
});

test('manifest field order does not change the retained source identity', async () => {
  const f = await sourceFixture(),
    saved = await retainRestoreSource(f.options);
  const { manifest } = saved;
  const reordered = {
    recovery: {
      image: manifest.recovery.image,
      origin: manifest.recovery.origin,
      createdAt: manifest.recovery.createdAt,
    },
    candidate: { sha256: manifest.candidate.sha256, bytes: manifest.candidate.bytes },
    archive: { sha256: manifest.archive.sha256, bytes: manifest.archive.bytes },
    id: manifest.id,
    version: 1 as const,
  };
  expect(
    await readRetainedRestoreSource({ root: f.root, manifest: reordered, assertRoot() {} }),
  ).toEqual(saved);
  expect(
    await retainRestoreSource({
      ...f.options,
      source: { ...f.source, recovery: reordered.recovery },
    }),
  ).toEqual(saved);
});

test('an interruption after ready publication still permits a full custody retry', async () => {
  const f = await sourceFixture();
  let calls = 0;
  await expect(
    retainRestoreSource({
      ...f.options,
      assertRoot() {
        if (++calls === 5) throw new Error('Interrupted before acknowledgment');
      },
    }),
  ).rejects.toThrow('Interrupted before acknowledgment');
  expect((await lstat(join(f.target, 'ready'))).isFile()).toBe(true);
  await f.source.dispose();
  const saved = await retainRestoreSource(f.options);
  expect(await readFile(saved.candidate.databasePath)).toEqual(f.candidate);
});

test.each(['intent.json', 'candidate.sqlite', 'ready'])(
  'truncated %s custody evidence refuses this attempt without overwrite',
  async (name) => {
    const f = await sourceFixture(),
      saved = await retainRestoreSource(f.options);
    const path = join(f.target, name),
      partial = Buffer.from('partial');
    await writeFile(path, partial);
    await expect(retainRestoreSource(f.options)).rejects.toThrow('unavailable or changed');
    await expect(
      readRetainedRestoreSource({ root: f.root, manifest: saved.manifest, assertRoot() {} }),
    ).rejects.toThrow('unavailable or changed');
    expect(await readFile(path)).toEqual(partial);
    expect(await readFile(f.source.archive.path)).toEqual(f.archive);
    expect(await readFile(f.candidatePath)).toEqual(f.candidate);
  },
);

test('cancellation after the copies cannot acknowledge completed source custody', async () => {
  const f = await sourceFixture(),
    controller = new AbortController();
  let calls = 0;
  await expect(
    retainRestoreSource({
      ...f.options,
      signal: controller.signal,
      assertRoot() {
        if (++calls === 4) controller.abort();
      },
    }),
  ).rejects.toThrow();
  await expect(lstat(join(f.target, 'ready'))).rejects.toHaveProperty('code', 'ENOENT');
  await f.source.dispose();
  const saved = await retainRestoreSource(f.options);
  expect(await readFile(saved.archive.path)).toEqual(f.archive);
  await expect(
    readRetainedRestoreSource({
      root: f.root,
      manifest: saved.manifest,
      signal: AbortSignal.abort(),
      assertRoot() {},
    }),
  ).rejects.toThrow();
});

test('custody read refuses sidecars, permissive files, aliases and a changed ready record', async () => {
  const f = await sourceFixture(),
    saved = await retainRestoreSource(f.options);
  const read = () =>
    readRetainedRestoreSource({ root: f.root, manifest: saved.manifest, assertRoot() {} });
  for (const suffix of ['-wal', '-shm', '-journal']) {
    await writeFile(saved.candidate.databasePath + suffix, '');
    await expect(read()).rejects.toThrow('unavailable or changed');
    await rm(saved.candidate.databasePath + suffix);
  }
  await chmod(saved.candidate.databasePath, 0o644);
  await expect(read()).rejects.toThrow('unavailable or changed');
  await chmod(saved.candidate.databasePath, 0o600);
  await rm(saved.archive.path);
  await symlink(f.source.archive.path, saved.archive.path);
  await expect(read()).rejects.toThrow('unavailable or changed');
  await rm(saved.archive.path);
  await link(f.source.archive.path, saved.archive.path);
  await expect(read()).rejects.toThrow('unavailable or changed');
  await rm(saved.archive.path);
  await writeFile(saved.archive.path, f.archive, { mode: 0o600 });
  await writeFile(join(f.target, 'ready'), '0'.repeat(64) + '\n');
  await expect(read()).rejects.toThrow('unavailable or changed');
  expect(await readFile(f.source.archive.path)).toEqual(f.archive);
});

test('source manifests are bounded and reject extra fields or changed provenance', async () => {
  const f = await sourceFixture(),
    saved = await retainRestoreSource(f.options);
  for (const changed of [
    { ...saved.manifest, id: '../foreign' },
    { ...saved.manifest, path: '/foreign' },
    { ...saved.manifest, archive: { ...saved.manifest.archive, bytes: 5 * 1024 ** 3 + 1 } },
    { ...saved.manifest, candidate: { ...saved.manifest.candidate, bytes: 8 * 1024 ** 3 + 1 } },
    { ...saved.manifest, recovery: { ...saved.manifest.recovery, origin: 'x'.repeat(4097) } },
    { ...saved.manifest, recovery: { ...saved.manifest.recovery, image: 'latest' } },
  ])
    expect(validRestoreSourceManifest(changed)).toBe(false);
  await expect(
    readRetainedRestoreSource({
      root: f.root,
      manifest: {
        ...saved.manifest,
        recovery: { ...saved.manifest.recovery, origin: 'https://different.example' },
      },
      assertRoot() {},
    }),
  ).rejects.toThrow('unavailable or changed');
});

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
  expect((await lstat(f.databasePath)).mode & 0o077).toBe(0);
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

test('a pre-captured original manifest resumes only exact completed copies and fills missing files', async () => {
  const f = await fixture(),
    manifest = await captureRestoreOriginals(f);
  expect(validRestoreOriginals(manifest)).toBe(true);
  const custody = join(f.root, `restore-${f.id}`),
    original = join(custody, 'original');
  await expect(lstat(custody)).rejects.toHaveProperty('code', 'ENOENT');
  await mkdir(original, { recursive: true, mode: 0o700 });
  const copied = join(original, 'spinel.sqlite');
  await writeFile(copied, f.original, { mode: 0o600 });
  const before = await lstat(copied);
  expect(await preserveRestoreOriginals(f, manifest)).toEqual(manifest);
  expect(await preserveRestoreOriginals(f, manifest)).toEqual(manifest);
  expect((await lstat(copied)).ino).toBe(before.ino);
  expect(await readFile(join(original, 'spinel.sqlite-wal'))).toEqual(f.wal);
  expect(await readFile(join(original, 'spinel.sqlite-shm'))).toEqual(f.shm);
  await expect(preserveRestoreOriginals(f)).rejects.toHaveProperty('code', 'EEXIST');
  expect(await readFile(f.databasePath)).toEqual(f.original);
});

test.each([null, false, 0, {}, { original: null }])(
  'malformed supplied custody manifest %j cannot become a fresh capture',
  async (value) => {
    const f = await fixture();
    await expect(
      preserveRestoreOriginals(
        f,
        value as unknown as Parameters<typeof preserveRestoreOriginals>[1],
      ),
    ).rejects.toThrow('changed');
    await expect(lstat(join(f.root, `restore-${f.id}`))).rejects.toHaveProperty('code', 'ENOENT');
    expect(await readFile(f.databasePath)).toEqual(f.original);
  },
);

test('original custody cancellation is checked before copying and after final closure verification', async () => {
  const f = await fixture(),
    manifest = await captureRestoreOriginals(f);
  const early = new AbortController();
  early.abort();
  await expect(
    preserveRestoreOriginals({ ...f, signal: early.signal }, manifest),
  ).rejects.toThrow();
  await expect(lstat(join(f.root, `restore-${f.id}`))).rejects.toHaveProperty('code', 'ENOENT');
  const late = new AbortController();
  let closures = 0;
  await expect(
    preserveRestoreOriginals(
      {
        ...f,
        signal: late.signal,
        assertClosed() {
          f.assertClosed();
          if (++closures === 4) late.abort();
        },
      },
      manifest,
    ),
  ).rejects.toThrow();
  expect(closures).toBe(4);
  // Completed copies survive an unacknowledged attempt; retry must authenticate and sync them.
  expect(await preserveRestoreOriginals(f, manifest)).toEqual(manifest);
  expect(await readFile(f.databasePath)).toEqual(f.original);
});

test('cancellation during native copy waits for private durable output before permitting exact retry', async () => {
  const f = await fixture(),
    manifest = await captureRestoreOriginals(f),
    controller = new AbortController();
  let copied!: () => void, release!: () => void;
  const reachedCopy = new Promise<void>((resolve) => {
    copied = resolve;
  });
  const releaseCopy = new Promise<void>((resolve) => {
    release = resolve;
  });
  copyBoundary.afterCopy = async (source) => {
    if (source === f.databasePath) {
      copied();
      await releaseCopy;
    }
  };
  let settled = false;
  const pending = preserveRestoreOriginals({ ...f, signal: controller.signal }, manifest);
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  try {
    await reachedCopy;
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
  } finally {
    release();
  }
  await expect(pending).rejects.toThrow();
  const copiedPath = join(f.root, `restore-${f.id}`, 'original', 'spinel.sqlite');
  expect((await lstat(copiedPath)).mode & 0o077).toBe(0);
  expect(await readFile(copiedPath)).toEqual(f.original);
  expect(await preserveRestoreOriginals(f, manifest)).toEqual(manifest);
});

test('retry never overwrites a partial original or redefines it after current content changes', async () => {
  const f = await fixture(),
    manifest = await captureRestoreOriginals(f);
  const original = join(f.root, `restore-${f.id}`, 'original');
  await mkdir(original, { recursive: true, mode: 0o700 });
  const copied = join(original, 'spinel.sqlite');
  await writeFile(copied, 'partial retained evidence', { mode: 0o600 });
  await expect(preserveRestoreOriginals(f, manifest)).rejects.toThrow('changed');
  expect(await readFile(copied, 'utf8')).toBe('partial retained evidence');
  await expect(lstat(join(original, 'spinel.sqlite-wal'))).rejects.toHaveProperty('code', 'ENOENT');
  await writeFile(f.databasePath + '-wal', 'later current writes');
  await expect(preserveRestoreOriginals(f, manifest)).rejects.toThrow('changed');
  expect(await readFile(copied, 'utf8')).toBe('partial retained evidence');
});

test('explicit absent-sidecar custody and its private directory cannot be replaced on retry', async () => {
  const f = await fixture();
  await rm(f.databasePath + '-wal');
  const manifest = await captureRestoreOriginals(f);
  expect(manifest.original['spinel.sqlite-wal']).toBeNull();
  await preserveRestoreOriginals(f, manifest);
  const original = join(f.root, `restore-${f.id}`, 'original'),
    extra = join(original, 'spinel.sqlite-wal');
  await writeFile(extra, 'unbound evidence', { mode: 0o600 });
  await expect(preserveRestoreOriginals(f, manifest)).rejects.toThrow('changed');
  expect(await readFile(extra, 'utf8')).toBe('unbound evidence');
  await rm(extra);
  await chmod(original, 0o755);
  await expect(preserveRestoreOriginals(f, manifest)).rejects.toThrow('changed');
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

test.each(['cancel', 'deadline'] as const)(
  'candidate staging %s after the first chunk preserves the immutable inputs and refuses partial retry',
  async (boundary) => {
    const f = await fixture();
    const originals = await captureRestoreOriginals(f);
    await preserveRestoreOriginals(f, originals);
    const staged = join(f.root, `restore-${f.id}`, 'candidate.sqlite');
    const controller = new AbortController();
    const now = Date.now;
    const deadline = now() + 60_000;
    const written = () => {
      try {
        return readFileSync(staged).length > 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    };
    if (boundary === 'cancel') {
      const check = controller.signal.throwIfAborted.bind(controller.signal);
      vi.spyOn(controller.signal, 'throwIfAborted').mockImplementation(() => {
        if (written()) controller.abort();
        check();
      });
    } else {
      vi.spyOn(Date, 'now').mockImplementation(() => now() + (written() ? 60_001 : 0));
    }
    await expect(
      stageRestoreCandidate({ ...f, signal: controller.signal, deadline }, originals),
    ).rejects.toThrow();
    expect(await readFile(staged)).toEqual(f.candidate.subarray(0, 64 * 1024));
    expect((await lstat(staged)).mode & 0o777).toBe(0o600);
    expect(await readFile(f.candidatePath)).toEqual(f.candidate);
    expect(await readFile(f.databasePath)).toEqual(f.original);
    expect(await readFile(f.databasePath + '-wal')).toEqual(f.wal);
    expect(() => assertNoPendingRestore(f.databasePath)).not.toThrow();
    vi.restoreAllMocks();
    await expect(stageRestoreCandidate(f, originals)).rejects.toThrow('changed');
  },
);

test.each(['cancel', 'deadline'] as const)(
  'activation %s after the first write retains the barrier, partial inode and original custody',
  async (boundary) => {
    const f = await fixture();
    const files = await f.prepare();
    const controller = new AbortController();
    const now = Date.now;
    f.control.signal = controller.signal;
    f.control.deadline = now() + 60_000;
    const written = () => readFileSync(f.databasePath)[0] === f.candidate[0];
    if (boundary === 'cancel') {
      const check = controller.signal.throwIfAborted.bind(controller.signal);
      vi.spyOn(controller.signal, 'throwIfAborted').mockImplementation(() => {
        if (written()) controller.abort();
        check();
      });
    } else {
      vi.spyOn(Date, 'now').mockImplementation(() => now() + (written() ? 60_001 : 0));
    }
    await expect(activateRestoreFiles(f.control, files)).rejects.toThrow();
    expect(f.phases).toEqual(['replacing']);
    const partial = await readFile(f.databasePath);
    expect(partial).toEqual(
      Buffer.concat([f.candidate.subarray(0, 64 * 1024), f.original.subarray(64 * 1024)]),
    );
    expect((await lstat(f.databasePath)).ino.toString()).toBe(files.identity.inode);
    expect(() => assertNoPendingRestore(f.databasePath)).toThrow('unfinished workspace restore');
    expect(await readFile(join(f.root, `restore-${f.id}`, 'original', 'spinel.sqlite'))).toEqual(
      f.original,
    );
    expect(await readFile(join(f.root, `restore-${f.id}`, 'candidate.sqlite'))).toEqual(
      f.candidate,
    );
  },
);

test('cancellation during replacing publication cannot start the destructive write', async () => {
  const f = await fixture();
  const files = await f.prepare();
  const controller = new AbortController();
  f.control.signal = controller.signal;
  const persist = f.control.persist.bind(f.control);
  f.control.persist = async (phase) => {
    await persist(phase);
    if (phase === 'replacing') controller.abort();
  };
  await expect(activateRestoreFiles(f.control, files)).rejects.toThrow();
  expect(f.phases).toEqual(['replacing']);
  expect(await readFile(f.databasePath)).toEqual(f.original);
  expect(() => assertNoPendingRestore(f.databasePath)).toThrow('unfinished workspace restore');
});

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
