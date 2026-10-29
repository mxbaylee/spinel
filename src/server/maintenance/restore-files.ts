import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdir, open, realpath, rm, statfs } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { FileIdentity } from './journal.ts';
import { assertNoPendingRestore, restoreBarrierPath } from './restore-barrier.ts';

const RESERVE = 256 * 1024 ** 2;
const MAX_DATABASE = 8 * 1024 ** 3;
const names = ['spinel.sqlite', 'spinel.sqlite-wal', 'spinel.sqlite-shm'] as const;
type Name = (typeof names)[number];
export interface RestoreFileEvidence {
  bytes: number;
  sha256: string;
}
export interface RestoreFiles {
  id: string;
  identity: FileIdentity;
  original: Record<Name, RestoreFileEvidence | null>;
  candidate: RestoreFileEvidence;
}
export type RestoreOriginals = Omit<RestoreFiles, 'candidate'>;
export type RestoreFilePhase =
  | 'replacing'
  | 'activated'
  | 'rolling-back'
  | 'rolled-back'
  | 'candidate-committed'
  | 'original-committed';
export interface RestoreFileControl {
  root: string;
  databasePath: string;
  /** Caller holds the workspace path/inode leases and checks all SQLite owners. */
  assertClosed(): void;
  /** Must fsync the independent journal before resolving; never just notify UI. */
  persist(phase: RestoreFilePhase): Promise<void>;
  /** Read the durable decision for this exact job under the caller's serial
   * control lock. A surviving barrier never overrides a committed outcome. */
  readPhase(): RestoreFilePhase | undefined;
  /** Test-only resource probe; never accepted through a control request. */
  availableBytes?: (path: string) => Promise<bigint>;
}

const unavailable = () => new Error('Restore generation files are unavailable or changed.');
const identity = (info: { dev: number; ino: number }): FileIdentity => ({
  device: String(info.dev),
  inode: String(info.ino),
});
const same = (a: FileIdentity, b: FileIdentity) => a.device === b.device && a.inode === b.inode;

async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function privateDirectory(path: string) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid?.() ||
    (await realpath(path)) !== resolve(path)
  )
    throw unavailable();
}
async function ownedFile(path: string) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.uid !== process.getuid?.() ||
    (await realpath(path)) !== resolve(path) ||
    !Number.isSafeInteger(info.dev) ||
    !Number.isSafeInteger(info.ino) ||
    !Number.isSafeInteger(info.size) ||
    info.size > MAX_DATABASE
  )
    throw unavailable();
  return info;
}
async function syncDirectory(path: string) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function evidence(path: string): Promise<RestoreFileEvidence> {
  const before = await ownedFile(path);
  const sha256 = await digest(path);
  const after = await ownedFile(path);
  if (
    !same(identity(before), identity(after)) ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw unavailable();
  return { bytes: after.size, sha256 };
}
async function requireEvidence(path: string, expected: RestoreFileEvidence) {
  const actual = await evidence(path);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw unavailable();
}
function directory(root: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw unavailable();
  return join(root, `restore-${id}`);
}
async function copy(source: string, target: string) {
  const before = await ownedFile(source);
  await copyFile(source, target, constants.COPYFILE_EXCL);
  await chmod(target, 0o600);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const after = await ownedFile(source);
  if (
    !same(identity(before), identity(after)) ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw unavailable();
  return evidence(target);
}

function requireSameEvidence(actual: RestoreFileEvidence, expected: RestoreFileEvidence) {
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw unavailable();
}

/** Stage immutable originals and candidate. No live workspace bytes are written.
 * Caller must durably journal the returned manifest before calling activate.
 * Failed/abandoned directories remain private evidence; never reuse an ID.
 */
export async function prepareRestoreFiles(options: {
  root: string;
  id: string;
  databasePath: string;
  candidatePath: string;
  expectedCandidate: RestoreFileEvidence;
  assertClosed(): void;
}): Promise<RestoreFiles> {
  const originals = await preserveRestoreOriginals(options);
  return stageRestoreCandidate(options, originals);
}

/** Preserve the closed raw tuple BEFORE opening a disposable clone or generating
 * the final reconciled candidate. Journal this manifest before advancing. */
export async function preserveRestoreOriginals(options: {
  root: string;
  id: string;
  databasePath: string;
  assertClosed(): void;
}): Promise<RestoreOriginals> {
  options.assertClosed();
  assertNoPendingRestore(options.databasePath);
  await privateDirectory(options.root);
  const source = await ownedFile(options.databasePath);
  await noRollbackJournal(options.databasePath);
  const original = {} as RestoreFiles['original'];
  for (const name of names) {
    try {
      original[name] = await evidence(options.databasePath + name.slice('spinel.sqlite'.length));
    } catch (error) {
      if (name === 'spinel.sqlite' || (error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
      original[name] = null;
    }
  }
  const originalBytes = Object.values(original).reduce((sum, file) => sum + (file?.bytes ?? 0), 0);
  const space = await statfs(options.root, { bigint: true });
  if (space.bavail * space.bsize < BigInt(originalBytes + RESERVE))
    throw new Error('Not enough disk space to retain the original generation.');
  const target = directory(options.root, options.id);
  await mkdir(target, { mode: 0o700 });
  await mkdir(join(target, 'original'), { mode: 0o700 });
  for (const name of names) {
    if (original[name]) {
      const sourcePath = options.databasePath + name.slice('spinel.sqlite'.length);
      requireSameEvidence(await copy(sourcePath, join(target, 'original', name)), original[name]!);
    }
  }
  await syncDirectory(join(target, 'original'));
  await syncDirectory(target);
  await syncDirectory(options.root);
  options.assertClosed();
  if (!same(identity(source), identity(await ownedFile(options.databasePath)))) throw unavailable();
  const result = { id: options.id, identity: identity(source), original };
  await unchangedOriginal(options.databasePath, result);
  return result;
}

/** Stage the fully reconciled output while retaining the earlier original
 * manifest. Repeating exactly this file is safe; different output never replaces
 * an existing attempt. This operation does not authorize activation. */
export async function stageRestoreCandidate(
  options: {
    root: string;
    databasePath: string;
    candidatePath: string;
    expectedCandidate: RestoreFileEvidence;
    assertClosed(): void;
    availableBytes?: RestoreFileControl['availableBytes'];
  },
  originals: RestoreOriginals,
): Promise<RestoreFiles> {
  const target = await retained(options, originals);
  assertNoPendingRestore(options.databasePath);
  await unchangedOriginal(options.databasePath, originals);
  const source = await ownedFile(options.databasePath),
    candidate = await ownedFile(options.candidatePath);
  if (same(identity(source), identity(candidate))) throw unavailable();
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      await lstat(options.candidatePath + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('The restore candidate must be a closed, self-contained database.');
  }
  await requireEvidence(options.candidatePath, options.expectedCandidate);
  const staged = join(target, 'candidate.sqlite');
  let exists = true;
  try {
    await lstat(staged);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    exists = false;
  }
  // A prior attempt may have copied every byte but failed before file fsync.
  // Matching page-cache contents alone are not durable custody.
  if (exists) await syncExistingCandidate(staged, options.expectedCandidate);
  // Retained originals already consume space. Reserve the additional candidate,
  // in-place growth and WAL/startup allowance on the appropriate filesystem.
  const recoveryNeed = (exists ? 0 : candidate.size) + RESERVE;
  const workspaceNeed =
    Math.max(0, candidate.size - source.size) +
    Math.max(2 * candidate.size, originals.original['spinel.sqlite-wal']?.bytes ?? 0) +
    RESERVE;
  const rootInfo = await lstat(options.root);
  const available = options.availableBytes ?? availableBytes;
  const shared = rootInfo.dev === source.dev;
  if (
    (await available(options.root)) < BigInt(recoveryNeed + (shared ? workspaceNeed : 0)) ||
    (!shared && (await available(dirname(options.databasePath))) < BigInt(workspaceNeed))
  )
    throw new Error('Not enough disk space to retain both generations and recovery working space.');
  if (!exists) {
    try {
      requireSameEvidence(await copy(options.candidatePath, staged), options.expectedCandidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await syncExistingCandidate(staged, options.expectedCandidate);
    }
  }
  await syncDirectory(target);
  await syncDirectory(options.root);
  options.assertClosed();
  if (!same(identity(source), identity(await ownedFile(options.databasePath)))) throw unavailable();
  await unchangedOriginal(options.databasePath, originals);
  return { ...originals, candidate: { ...options.expectedCandidate } };
}

async function syncExistingCandidate(path: string, expected: RestoreFileEvidence) {
  const before = await ownedFile(path);
  if (before.mode & 0o077) throw unavailable();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const unchanged = async () => {
      for (const info of [await handle.stat(), await ownedFile(path)]) {
        if (
          !same(identity(before), identity(info)) ||
          before.size !== info.size ||
          before.mtimeMs !== info.mtimeMs ||
          before.ctimeMs !== info.ctimeMs
        )
          throw unavailable();
      }
    };
    await requireEvidence(path, expected);
    await unchanged();
    await handle.sync();
    await unchanged();
  } finally {
    await handle.close();
  }
}

async function availableBytes(path: string) {
  const info = await statfs(path, { bigint: true });
  return info.bavail * info.bsize;
}

async function noRollbackJournal(databasePath: string) {
  try {
    await lstat(databasePath + '-journal');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Unexpected rollback journal evidence requires independent recovery.');
}
async function unchangedOriginal(databasePath: string, files: RestoreOriginals) {
  await noRollbackJournal(databasePath);
  for (const name of names) {
    const path = databasePath + name.slice('spinel.sqlite'.length);
    if (files.original[name]) await requireEvidence(path, files.original[name]!);
    else {
      try {
        await lstat(path);
        throw unavailable();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
}

async function barrier(control: RestoreFileControl, files: RestoreFiles, create = false) {
  const path = restoreBarrierPath(control.databasePath);
  const pending = `${path}.${files.id}.pending`;
  const expected =
    JSON.stringify({ version: 1, operationId: files.id, identity: files.identity }) + '\n';
  if (create) {
    assertNoPendingRestore(control.databasePath);
    // A crash before publication may leave a partial temporary marker. It never
    // authorized mutation and may be replaced under the same exclusive leases.
    try {
      const info = await ownedFile(pending);
      if (info.size > 1024 || info.mode & 0o077) throw unavailable();
      await rm(pending);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const handle = await open(
    create ? pending : path,
    constants.O_NOFOLLOW |
      (create ? constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY : constants.O_RDONLY),
    0o600,
  );
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      (create && info.nlink !== 1) ||
      info.uid !== process.getuid?.() ||
      info.mode & 0o077 ||
      info.size > 1024
    )
      throw unavailable();
    if (create) {
      await handle.writeFile(expected);
      await handle.sync();
    } else if ((await handle.readFile('utf8')) !== expected) throw unavailable();
  } finally {
    await handle.close();
  }
  if (create) {
    // link publishes the complete fsynced bytes atomically without replacing a
    // competing marker. A crash can leave two names for this immutable marker;
    // readers accept that harmless temporary link, never partial contents.
    await link(pending, path);
    await syncDirectory(dirname(path));
    await rm(pending);
    await syncDirectory(dirname(path));
  }
}

async function admitMutation(control: RestoreFileControl, files: RestoreFiles, rollback: boolean) {
  const current = await ownedFile(control.databasePath);
  const desired = rollback ? files.original['spinel.sqlite']!.bytes : files.candidate.bytes;
  const wal = files.original['spinel.sqlite-wal']?.bytes ?? 0;
  const workspaceNeed =
    Math.max(0, desired - current.size) + (rollback ? wal : Math.max(2 * desired, wal)) + RESERVE;
  const available = control.availableBytes ?? availableBytes;
  const shared = (await lstat(control.root)).dev === current.dev;
  if (
    (await available(control.root)) < BigInt(RESERVE + (shared ? workspaceNeed : 0)) ||
    (!shared && (await available(dirname(control.databasePath))) < BigInt(workspaceNeed))
  )
    throw new Error('Not enough disk space to safely change or roll back this generation.');
}

async function retained(
  control: Pick<RestoreFileControl, 'root' | 'databasePath' | 'assertClosed'>,
  files: RestoreOriginals,
) {
  control.assertClosed();
  await privateDirectory(control.root);
  const root = directory(control.root, files.id);
  await privateDirectory(root);
  await privateDirectory(join(root, 'original'));
  if (!same(files.identity, identity(await ownedFile(control.databasePath)))) throw unavailable();
  await noRollbackJournal(control.databasePath);
  if (!files.original['spinel.sqlite']) throw unavailable();
  for (const name of names)
    if (files.original[name])
      await requireEvidence(join(root, 'original', name), files.original[name]!);
  return root;
}

/** Keep the leased inode. Never unlink/rename it or truncate before ownership checks. */
async function overwrite(source: string, target: string, expected: FileIdentity) {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const output = await open(target, constants.O_WRONLY | constants.O_NOFOLLOW);
    try {
      const info = await output.stat();
      if (!info.isFile() || info.nlink !== 1 || !same(expected, identity(info)))
        throw unavailable();
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let offset = 0;
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        if (offset + bytesRead > MAX_DATABASE) throw unavailable();
        let written = 0;
        while (written < bytesRead) {
          const result = await output.write(buffer, written, bytesRead - written, offset + written);
          if (!result.bytesWritten) throw unavailable();
          written += result.bytesWritten;
        }
        offset += bytesRead;
      }
      await output.truncate(offset);
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}
async function removeSidecars(databasePath: string) {
  for (const suffix of ['-wal', '-shm']) {
    try {
      await ownedFile(databasePath + suffix);
      await rm(databasePath + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export async function activateRestoreFiles(control: RestoreFileControl, files: RestoreFiles) {
  assertUncommitted(control);
  const root = await retained(control, files);
  // Initial activation requires exactly the frozen original, including absent WAL.
  await unchangedOriginal(control.databasePath, files);
  const candidate = join(root, 'candidate.sqlite');
  await requireEvidence(candidate, files.candidate);
  control.assertClosed();
  await admitMutation(control, files, false);
  assertUncommitted(control);
  await barrier(control, files, true);
  await control.persist('replacing');
  await overwrite(candidate, control.databasePath, files.identity);
  await removeSidecars(control.databasePath);
  await syncDirectory(dirname(control.databasePath));
  await requireEvidence(control.databasePath, files.candidate);
  control.assertClosed();
  await control.persist('activated');
}

/** Replayable after any interrupted write. SQLite must verify before reopening.
 * SHM is preserved as evidence but rebuilt by SQLite, never restored as lock state.
 */
export async function rollbackRestoreFiles(control: RestoreFileControl, files: RestoreFiles) {
  assertUncommitted(control);
  const root = await retained(control, files);
  await barrier(control, files);
  control.assertClosed();
  await admitMutation(control, files, true);
  assertUncommitted(control);
  await control.persist('rolling-back');
  await overwrite(join(root, 'original', 'spinel.sqlite'), control.databasePath, files.identity);
  await removeSidecars(control.databasePath);
  if (files.original['spinel.sqlite-wal'])
    requireSameEvidence(
      await copy(join(root, 'original', 'spinel.sqlite-wal'), control.databasePath + '-wal'),
      files.original['spinel.sqlite-wal'],
    );
  await syncDirectory(dirname(control.databasePath));
  await requireEvidence(control.databasePath, files.original['spinel.sqlite']!);
  control.assertClosed();
  await control.persist('rolled-back');
}

/** Caller first verifies the selected generation and child health under maintenance.
 * Commit durably before removing the opening barrier. Never roll back a committed
 * candidate on restart: it may already contain newly acknowledged writes.
 */
export async function commitRestoreFiles(
  control: RestoreFileControl,
  files: RestoreFiles,
  outcome: 'candidate' | 'original',
) {
  const phase = control.readPhase();
  const selected = outcome === 'candidate' ? 'candidate-committed' : 'original-committed';
  if (phase?.endsWith('-committed') && phase !== selected)
    throw new Error('This restore already has a different committed outcome.');
  let marked = true;
  try {
    await barrier(control, files);
  } catch (error) {
    if (phase !== selected || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    marked = false;
  }
  if (!same(files.identity, identity(await ownedFile(control.databasePath)))) throw unavailable();
  if (phase !== selected) await control.persist(selected);
  const pending = `${restoreBarrierPath(control.databasePath)}.${files.id}.pending`;
  if (!marked) {
    // Normal commit removes pending first. An unexplained residual file still
    // needs recovery; never delete it based only on a terminal phase.
    try {
      await lstat(pending);
      throw unavailable();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await syncDirectory(dirname(control.databasePath));
    return;
  }
  try {
    const old = await lstat(pending),
      current = await lstat(restoreBarrierPath(control.databasePath));
    if (!same(identity(old), identity(current))) throw unavailable();
    await rm(pending);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rm(restoreBarrierPath(control.databasePath));
  await syncDirectory(dirname(control.databasePath));
}

function assertUncommitted(control: RestoreFileControl) {
  if (control.readPhase()?.endsWith('-committed'))
    throw new Error('A committed restore cannot replace or roll back the workspace.');
}
