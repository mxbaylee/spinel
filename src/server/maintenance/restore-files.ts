import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rm,
  statfs,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { FileIdentity } from './journal.ts';
import { assertNoPendingRestore, restoreBarrierPath } from './restore-barrier.ts';
import { copyClosedRestoreInput, copyRestoreInputFile } from '../backup/restore-input.ts';
import type { PreparedRestoreSource } from '../backup/verification.ts';
import { MAX_ARCHIVE_BYTES } from '../backup/transfer.ts';

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
/** Trusted verifier output needed for custody; never accepted from HTTP. */
export type RestoreSourceInput = Pick<
  PreparedRestoreSource,
  'archive' | 'databasePath' | 'databaseBytes' | 'databaseSha256' | 'recovery'
>;
export interface RestoreSourceManifest {
  version: 1;
  id: string;
  archive: RestoreFileEvidence;
  candidate: RestoreFileEvidence;
  recovery: PreparedRestoreSource['recovery'];
}
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
  /** Controller-owned cancellation and absolute wall-clock budget. */
  signal?: AbortSignal;
  deadline?: number;
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

async function digest(path: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
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
async function evidence(path: string, signal?: AbortSignal): Promise<RestoreFileEvidence> {
  const before = await ownedFile(path);
  const sha256 = await digest(path, signal);
  const after = await ownedFile(path);
  if (
    !same(identity(before), identity(after)) ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw unavailable();
  return { bytes: after.size, sha256 };
}
async function requireEvidence(path: string, expected: RestoreFileEvidence, signal?: AbortSignal) {
  const actual = await evidence(path, signal);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw unavailable();
}
function directory(root: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw unavailable();
  return join(root, `restore-${id}`);
}
async function copy(source: string, target: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const before = await ownedFile(source);
  signal?.throwIfAborted();
  await copyFile(source, target, constants.COPYFILE_EXCL);
  // Native copying is not abortable. Settle it, harden and sync its completed
  // output before reporting cancellation, so exact custody retry remains valid.
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
  signal?.throwIfAborted();
  return evidence(target, signal);
}

function requireSameEvidence(actual: RestoreFileEvidence, expected: RestoreFileEvidence) {
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw unavailable();
}

const sourceShape = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
export function validRestoreSourceManifest(value: unknown): value is RestoreSourceManifest {
  if (
    !sourceShape(value, ['version', 'id', 'archive', 'candidate', 'recovery']) ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
  )
    return false;
  for (const [name, minimum, maximum] of [
    ['archive', 1, MAX_ARCHIVE_BYTES],
    ['candidate', 4096, MAX_DATABASE],
  ] as const) {
    const file = value[name];
    if (
      !sourceShape(file, ['bytes', 'sha256']) ||
      !Number.isSafeInteger(file.bytes) ||
      Number(file.bytes) < minimum ||
      Number(file.bytes) > maximum ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      return false;
  }
  const recovery = value.recovery;
  return (
    sourceShape(recovery, ['createdAt', 'origin', 'image']) &&
    typeof recovery.createdAt === 'string' &&
    recovery.createdAt.length <= 64 &&
    Number.isFinite(Date.parse(recovery.createdAt)) &&
    typeof recovery.origin === 'string' &&
    recovery.origin.length > 0 &&
    recovery.origin.length <= 4096 &&
    typeof recovery.image === 'string' &&
    recovery.image.length <= 1024 &&
    /^(sha256:[a-f0-9]{64}|\S+@sha256:[a-f0-9]{64})$/.test(recovery.image)
  );
}
function sourceManifest(value: RestoreSourceManifest): RestoreSourceManifest {
  if (!validRestoreSourceManifest(value)) throw unavailable();
  return {
    version: 1,
    id: value.id,
    archive: { bytes: value.archive.bytes, sha256: value.archive.sha256 },
    candidate: { bytes: value.candidate.bytes, sha256: value.candidate.sha256 },
    recovery: {
      createdAt: value.recovery.createdAt,
      origin: value.recovery.origin,
      image: value.recovery.image,
    },
  };
}
function sourceFiles(root: string, manifest: RestoreSourceManifest) {
  const target = directory(root, manifest.id) + '-source';
  const text = JSON.stringify(manifest) + '\n';
  return {
    target,
    text,
    ready: createHash('sha256').update(text).digest('hex') + '\n',
    archive: join(target, 'source.spinel.enc'),
    candidate: join(target, 'candidate.sqlite'),
  };
}
async function sourceFileExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function checkSourceFile(path: string, expected: RestoreFileEvidence, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const info = await ownedFile(path);
  if (info.mode & 0o077 || info.size !== expected.bytes) throw unavailable();
  await syncExistingCandidate(path, expected, signal);
  signal?.throwIfAborted();
}
async function sourceMarker(path: string, text: string, create: boolean, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (create) {
    try {
      const file = await open(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(text);
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  await checkSourceFile(
    path,
    { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') },
    signal,
  );
}

/** The independent journal must bind this exact manifest to the job/target.
 * Rechecking private bytes also repairs a prior fsync interruption; a ready marker
 * alone never proves durable custody. No application staging path is needed. */
export async function readRetainedRestoreSource(options: {
  root: string;
  manifest: RestoreSourceManifest;
  assertRoot(): void;
  signal?: AbortSignal;
}) {
  const manifest = sourceManifest(options.manifest),
    files = sourceFiles(options.root, manifest);
  options.assertRoot();
  await privateDirectory(options.root);
  await privateDirectory(files.target);
  await sourceMarker(join(files.target, 'intent.json'), files.text, false, options.signal);
  await checkSourceFile(files.archive, manifest.archive, options.signal);
  await checkSourceFile(files.candidate, manifest.candidate, options.signal);
  for (const suffix of ['-wal', '-shm', '-journal'])
    if (await sourceFileExists(files.candidate + suffix)) throw unavailable();
  await sourceMarker(join(files.target, 'ready'), files.ready, false, options.signal);
  await syncDirectory(files.target);
  await syncDirectory(options.root);
  options.assertRoot();
  options.signal?.throwIfAborted();
  return {
    manifest,
    archive: { path: files.archive, ...manifest.archive },
    candidate: {
      databasePath: files.candidate,
      databaseBytes: manifest.candidate.bytes,
      databaseSha256: manifest.candidate.sha256,
      recovery: { ...manifest.recovery },
    },
  };
}

/** Transfer verified source custody BEFORE pause. The immutable intent precedes
 * copies, so identical retries reuse complete files and copy missing ones. An
 * interrupted partial file or marker refuses this attempt, without overwrite;
 * the controller must report failure and owns cancellation/retention. Caller keeps application and
 * catalog custody until this returns AND its independent job record is fsynced. */
export async function retainRestoreSource(options: {
  root: string;
  id: string;
  source: RestoreSourceInput;
  assertRoot(): void;
  signal?: AbortSignal;
}) {
  const source = options.source;
  const archive = {
    path: source.archive.path,
    bytes: source.archive.bytes,
    sha256: source.archive.sha256,
  };
  const candidate = {
    databasePath: source.databasePath,
    databaseBytes: source.databaseBytes,
    databaseSha256: source.databaseSha256,
  };
  const manifest = sourceManifest({
    version: 1,
    id: options.id,
    archive: { bytes: archive.bytes, sha256: archive.sha256 },
    candidate: { bytes: candidate.databaseBytes, sha256: candidate.databaseSha256 },
    recovery: { ...source.recovery },
  });
  const files = sourceFiles(options.root, manifest);
  options.assertRoot();
  options.signal?.throwIfAborted();
  await privateDirectory(options.root);
  await mkdir(files.target, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await privateDirectory(files.target);
  await sourceMarker(join(files.target, 'intent.json'), files.text, true, options.signal);
  await syncDirectory(files.target);
  await syncDirectory(options.root);
  options.assertRoot();
  const archiveExists = await sourceFileExists(files.archive),
    candidateExists = await sourceFileExists(files.candidate);
  const space = await statfs(options.root, { bigint: true });
  if (
    (!archiveExists || !candidateExists) &&
    space.bavail * space.bsize <
      BigInt(
        (archiveExists ? 0 : archive.bytes) +
          (candidateExists ? 0 : candidate.databaseBytes) +
          RESERVE,
      )
  )
    throw new Error('Not enough disk space to retain the verified restore source.');
  if (archiveExists) await checkSourceFile(files.archive, manifest.archive, options.signal);
  else await copyRestoreInputFile(archive, files.archive, options.signal);
  options.assertRoot();
  if (candidateExists) await checkSourceFile(files.candidate, manifest.candidate, options.signal);
  else await copyClosedRestoreInput(candidate, files.candidate, options.signal);
  options.assertRoot();
  await sourceMarker(join(files.target, 'ready'), files.ready, true, options.signal);
  return readRetainedRestoreSource({ ...options, manifest });
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
interface RestoreOriginalOptions {
  /** One controller deadline/cancellation signal covers the complete raw tuple. */
  signal?: AbortSignal;
  root: string;
  id: string;
  databasePath: string;
  assertClosed(): void;
}

export function validRestoreOriginals(value: unknown): value is RestoreOriginals {
  if (
    !sourceShape(value, ['id', 'identity', 'original']) ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id) ||
    !sourceShape(value.identity, ['device', 'inode']) ||
    ![value.identity.device, value.identity.inode].every(
      (n) => typeof n === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(n),
    ) ||
    !sourceShape(value.original, [...names])
  )
    return false;
  const original = value.original;
  return names.every((name) => {
    const file = original[name];
    if (file === null) return name !== 'spinel.sqlite';
    return (
      sourceShape(file, ['bytes', 'sha256']) &&
      Number.isSafeInteger(file.bytes) &&
      Number(file.bytes) >= (name === 'spinel.sqlite' ? 1 : 0) &&
      Number(file.bytes) <= MAX_DATABASE &&
      typeof file.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(file.sha256)
    );
  });
}

/** Read only, under exclusive closure. Persist this manifest before copying when
 * the controller needs crash-safe retry; later copies never redefine originals. */
export async function captureRestoreOriginals(
  options: RestoreOriginalOptions,
): Promise<RestoreOriginals> {
  options.signal?.throwIfAborted();
  options.assertClosed();
  assertNoPendingRestore(options.databasePath);
  directory(options.root, options.id);
  await privateDirectory(options.root);
  const source = await ownedFile(options.databasePath);
  await noRollbackJournal(options.databasePath);
  const original = {} as RestoreOriginals['original'];
  for (const name of names) {
    try {
      original[name] = await evidence(
        options.databasePath + name.slice('spinel.sqlite'.length),
        options.signal,
      );
    } catch (error) {
      if (name === 'spinel.sqlite' || (error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
      original[name] = null;
    }
  }
  const result = { id: options.id, identity: identity(source), original };
  if (!validRestoreOriginals(result)) throw unavailable();
  await unchangedOriginal(options.databasePath, result, options.signal);
  if (!same(result.identity, identity(await ownedFile(options.databasePath)))) throw unavailable();
  options.signal?.throwIfAborted();
  options.assertClosed();
  assertNoPendingRestore(options.databasePath);
  options.signal?.throwIfAborted();
  return result;
}

export async function preserveRestoreOriginals(
  options: RestoreOriginalOptions,
  expected?: RestoreOriginals,
): Promise<RestoreOriginals> {
  const snapshot = expected === undefined ? undefined : structuredClone(expected);
  if (snapshot !== undefined && (!validRestoreOriginals(snapshot) || snapshot.id !== options.id))
    throw unavailable();
  const current = await captureRestoreOriginals(options);
  options.signal?.throwIfAborted();
  if (snapshot) {
    if (!same(current.identity, snapshot.identity)) throw unavailable();
    for (const name of names) {
      const a = current.original[name],
        b = snapshot.original[name];
      if (a === null || b === null) {
        if (a !== b) throw unavailable();
      } else requireSameEvidence(a, b);
    }
  }
  const result = snapshot ?? current;
  const target = directory(options.root, options.id),
    originalDirectory = join(target, 'original');
  for (const path of [target, originalDirectory]) {
    options.signal?.throwIfAborted();
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      // An existing directory alone never proves that this is the same attempt.
      if (!snapshot || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await privateDirectory(path);
  }
  const present = new Set<string>();
  for await (const entry of await opendir(originalDirectory, { bufferSize: 4 })) {
    if (!names.includes(entry.name as Name) || !result.original[entry.name as Name])
      throw unavailable();
    present.add(entry.name);
  }
  let missingBytes = 0;
  for (const name of names) {
    const file = result.original[name];
    if (!file) continue;
    if (present.has(name))
      await syncExistingCandidate(join(originalDirectory, name), file, options.signal);
    else missingBytes += file.bytes;
  }
  const space = await statfs(options.root, { bigint: true });
  if (space.bavail * space.bsize < BigInt(missingBytes + RESERVE))
    throw new Error('Not enough disk space to retain the original generation.');
  for (const name of names) {
    if (result.original[name] && !present.has(name)) {
      const sourcePath = options.databasePath + name.slice('spinel.sqlite'.length);
      requireSameEvidence(
        await copy(sourcePath, join(originalDirectory, name), options.signal),
        result.original[name]!,
      );
    }
  }
  await syncDirectory(originalDirectory);
  await syncDirectory(target);
  await syncDirectory(options.root);
  options.signal?.throwIfAborted();
  options.assertClosed();
  assertNoPendingRestore(options.databasePath);
  if (!same(result.identity, identity(await ownedFile(options.databasePath)))) throw unavailable();
  await unchangedOriginal(options.databasePath, result, options.signal);
  if (!same(result.identity, identity(await ownedFile(options.databasePath)))) throw unavailable();
  options.signal?.throwIfAborted();
  options.assertClosed();
  assertNoPendingRestore(options.databasePath);
  options.signal?.throwIfAborted();
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

async function syncExistingCandidate(
  path: string,
  expected: RestoreFileEvidence,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
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
    await requireEvidence(path, expected, signal);
    await unchanged();
    await handle.sync();
    await unchanged();
    signal?.throwIfAborted();
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
async function unchangedOriginal(
  databasePath: string,
  files: RestoreOriginals,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  await noRollbackJournal(databasePath);
  for (const name of names) {
    const path = databasePath + name.slice('spinel.sqlite'.length);
    if (files.original[name]) await requireEvidence(path, files.original[name]!, signal);
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
  control: Pick<RestoreFileControl, 'root' | 'databasePath' | 'assertClosed' | 'signal'>,
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
      await requireEvidence(join(root, 'original', name), files.original[name]!, control.signal);
  return root;
}

/** Keep the leased inode. Never unlink/rename it or truncate before ownership checks. */
async function overwrite(
  source: string,
  target: string,
  expected: FileIdentity,
  assertActive: () => void,
) {
  assertActive();
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assertActive();
    const output = await open(target, constants.O_WRONLY | constants.O_NOFOLLOW);
    try {
      const info = await output.stat();
      assertActive();
      if (!info.isFile() || info.nlink !== 1 || !same(expected, identity(info)))
        throw unavailable();
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let offset = 0;
      for (;;) {
        assertActive();
        const { bytesRead } = await input.read(buffer, 0, buffer.length, offset);
        assertActive();
        if (!bytesRead) break;
        if (offset + bytesRead > MAX_DATABASE) throw unavailable();
        let written = 0;
        while (written < bytesRead) {
          assertActive();
          const result = await output.write(buffer, written, bytesRead - written, offset + written);
          assertActive();
          if (!result.bytesWritten) throw unavailable();
          written += result.bytesWritten;
        }
        offset += bytesRead;
      }
      assertActive();
      await output.truncate(offset);
      assertActive();
      await output.chmod(0o600);
      assertActive();
      await output.sync();
      assertActive();
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
  const active = () => assertMutationActive(control);
  active();
  assertUncommitted(control);
  const root = await retained(control, files);
  active();
  // Initial activation requires exactly the frozen original, including absent WAL.
  await unchangedOriginal(control.databasePath, files, control.signal);
  active();
  const candidate = join(root, 'candidate.sqlite');
  await requireEvidence(candidate, files.candidate, control.signal);
  active();
  control.assertClosed();
  await admitMutation(control, files, false);
  active();
  assertUncommitted(control);
  await barrier(control, files, true);
  active();
  await control.persist('replacing');
  active();
  await overwrite(candidate, control.databasePath, files.identity, active);
  await removeSidecars(control.databasePath);
  active();
  await syncDirectory(dirname(control.databasePath));
  active();
  await requireEvidence(control.databasePath, files.candidate, control.signal);
  active();
  control.assertClosed();
  await control.persist('activated');
  active();
}

/** Replayable after any interrupted write. SQLite must verify before reopening.
 * SHM is preserved as evidence but rebuilt by SQLite, never restored as lock state.
 */
export async function rollbackRestoreFiles(control: RestoreFileControl, files: RestoreFiles) {
  const active = () => assertMutationActive(control);
  active();
  assertUncommitted(control);
  const root = await retained(control, files);
  await barrier(control, files);
  control.assertClosed();
  await admitMutation(control, files, true);
  active();
  assertUncommitted(control);
  await control.persist('rolling-back');
  active();
  await overwrite(
    join(root, 'original', 'spinel.sqlite'),
    control.databasePath,
    files.identity,
    active,
  );
  await removeSidecars(control.databasePath);
  active();
  if (files.original['spinel.sqlite-wal'])
    requireSameEvidence(
      await copy(
        join(root, 'original', 'spinel.sqlite-wal'),
        control.databasePath + '-wal',
        control.signal,
      ),
      files.original['spinel.sqlite-wal'],
    );
  active();
  await syncDirectory(dirname(control.databasePath));
  active();
  await requireEvidence(control.databasePath, files.original['spinel.sqlite']!, control.signal);
  active();
  control.assertClosed();
  await control.persist('rolled-back');
  active();
}

function assertMutationActive(control: RestoreFileControl) {
  control.signal?.throwIfAborted();
  if (
    control.deadline !== undefined &&
    (!Number.isSafeInteger(control.deadline) || control.deadline <= Date.now())
  )
    throw new Error('Restore file mutation exceeded its deadline.');
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
