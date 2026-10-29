import { checkVerificationHeadroom, runRecoveryWorker } from './recovery-worker.ts';
export { checkVerificationHeadroom } from './recovery-worker.ts';
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, stat, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RecoveryResourceError } from './resource-error.ts';
import { digest } from './archive.ts';
import {
  assertSelfContained,
  copyClosedRestoreInput,
  copyRestoreInputFile,
  restoreOutputLimit,
  validateClosedRestoreInput,
} from './restore-input.ts';
import type { ClosedRestoreInput, RestoreInputFile } from './restore-input.ts';
import { MAX_ARCHIVE_BYTES } from './transfer.ts';
import type { reconcileRestoreCandidate } from './restore-candidate.ts';

export type RestoreReconciliationSummary = Omit<
  Awaited<ReturnType<typeof reconcileRestoreCandidate>>,
  'inventory' | 'semantics'
>;

export interface PreparedRestore extends VerificationResult {
  /** Private staging only. This is not permission to activate the database. */
  databasePath: string;
  databaseSha256: string;
  databaseBytes: number;
  recovery: { createdAt: string; origin: string; image: string };
  reconciliation?: RestoreReconciliationSummary;
  /** Present only for source preparation; never serialize private paths to HTTP. */
  archive?: RestoreInputFile;
  dispose(): Promise<void>;
}
export interface PreparedRestoreSource extends PreparedRestore {
  archive: RestoreInputFile;
}
export interface RestoreArchiveOptions extends VerificationOptions {
  expectedImage: string;
  /** Immutable completed transfer/held-catalog evidence, not browser assertions. */
  expectedArchive: { bytes: number; sha256: string };
}

interface PreparedEvidence {
  databaseSha256: string;
  databaseBytes: number;
  recovery: PreparedRestore['recovery'];
  reconciliation?: RestoreReconciliationSummary;
}
type WorkerResult = VerificationResult & { prepared?: PreparedEvidence };

export interface VerificationResult {
  tables: number;
  rows: number;
  snapshots: number;
  images: number;
  keyId?: string;
}
export interface VerificationOptions {
  archive: string;
  keyFile: string;
  stagingRoot: string;
  expectedOrigin: string;
  expectedImage?: string;
  maxDatabaseBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface ReconcileRestoreOptions extends Omit<
  VerificationOptions,
  'archive' | 'keyFile' | 'expectedImage'
> {
  expectedImage: string;
  /** Already authenticated and semantically verified archive output. */
  candidate: ClosedRestoreInput & { recovery: PreparedRestore['recovery'] };
  /** New closed snapshot made after drain, including acknowledged WAL writes. */
  current: ClosedRestoreInput;
  spacesEnabled: boolean;
  now: number;
}

/** Prepare a new output in isolation. Neither input is modified or consumed.
 * The supervisor still owns source custody, epoch fencing, rollback and health.
 */
export async function reconcilePreparedRestore(
  options: ReconcileRestoreOptions,
): Promise<PreparedRestore> {
  if (
    !/^(sha256:[a-f0-9]{64}|\S+@sha256:[a-f0-9]{64})$/.test(options.expectedImage) ||
    !validPreparedEvidence(options.candidate, options) ||
    typeof options.spacesEnabled !== 'boolean' ||
    !Number.isSafeInteger(options.now) ||
    options.now < 0
  )
    throw new Error('Invalid frozen recovery preparation.');
  const result = await inspectArchive(options, true);
  if (!('databasePath' in result))
    throw new Error('Restore reconciliation did not retain a candidate.');
  return result;
}

/** The parent owns cleanup even if the worker is killed. The worker receives
 * paths by IPC, never secret bytes or user content on the command line. */
export async function verifyArchive(options: VerificationOptions): Promise<VerificationResult> {
  return inspectArchive(options, false);
}

/** Both catalog selection and upload use the same isolated preparation. Retain
 * the verified database and exact encrypted bundle, never a deployment env file.
 * The caller owns both until a supervisor durably accepts custody. */
export async function prepareRestoreArchive(
  options: RestoreArchiveOptions,
): Promise<PreparedRestoreSource> {
  if (!/^(sha256:[a-f0-9]{64}|\S+@sha256:[a-f0-9]{64})$/.test(options.expectedImage))
    throw new Error('Restore preparation requires the current immutable application image.');
  const result = await inspectArchive(options, true);
  if (!('databasePath' in result) || !result.archive)
    throw new Error('Restore preparation did not retain a candidate.');
  return { ...result, archive: result.archive };
}

async function inspectArchive(
  options: VerificationOptions | ReconcileRestoreOptions | RestoreArchiveOptions,
  retain: boolean,
): Promise<VerificationResult | PreparedRestore> {
  options.signal?.throwIfAborted();
  const limit = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10 * 60_000)
    throw new Error('Invalid recovery verification time limit.');
  const deadline = Date.now() + limit;
  const operationSignal = AbortSignal.any([
    AbortSignal.timeout(limit),
    ...(options.signal ? [options.signal] : []),
  ]);
  await checkVerificationHeadroom('start');
  const reconciliation = 'current' in options ? options : undefined;
  const directory = await mkdtemp(
    join(
      options.stagingRoot,
      reconciliation ? '.restore-reconciled-' : retain ? '.restore-candidate-' : '.verify-',
    ),
  );
  let retained = false;
  try {
    await chmod(directory, 0o700);
    const inputReads: string[] = [];
    let input: Record<string, unknown>;
    let outputMaximum = options.maxDatabaseBytes;
    let verifiedArchive: RestoreInputFile | undefined;
    if ('current' in options) {
      const maximum = options.maxDatabaseBytes ?? 8 * 1024 ** 3;
      if (!Number.isSafeInteger(maximum) || maximum < 4096 || maximum > 8 * 1024 ** 3)
        throw new Error('Invalid recovery database limit.');
      validateClosedRestoreInput(options.current, maximum);
      validateClosedRestoreInput(options.candidate, maximum);
      const space = await statfs(directory, { bigint: true });
      outputMaximum = restoreOutputLimit(
        space.bavail * space.bsize,
        options.current.databaseBytes,
        options.candidate.databaseBytes,
        maximum,
      );
      await mkdir(join(directory, 'restored'), { mode: 0o700 });
      const currentPath = join(directory, 'current.sqlite'),
        candidatePath = join(directory, 'restored', 'spinel.sqlite');
      await copyClosedRestoreInput(options.current, currentPath, operationSignal);
      await copyClosedRestoreInput(options.candidate, candidatePath, operationSignal);
      input = {
        kind: 'reconcile',
        current: {
          databasePath: resolve(currentPath),
          databaseSha256: options.current.databaseSha256,
          databaseBytes: options.current.databaseBytes,
        },
        candidate: {
          databasePath: resolve(candidatePath),
          databaseSha256: options.candidate.databaseSha256,
          databaseBytes: options.candidate.databaseBytes,
          recovery: {
            createdAt: options.candidate.recovery.createdAt,
            origin: options.candidate.recovery.origin,
            image: options.candidate.recovery.image,
          },
        },
        spacesEnabled: options.spacesEnabled,
        now: options.now,
      };
    } else {
      let archive = await realpath(options.archive);
      // Preserve the final component for readKey's O_NOFOLLOW boundary.
      const keyFile = resolve(options.keyFile);
      const archiveInfo = await stat(archive);
      if (!archiveInfo.isFile()) throw new Error('Recovery archive must be a regular file.');
      if (archiveInfo.size > MAX_ARCHIVE_BYTES) throw new RecoveryResourceError('archive-size');
      if (retain) {
        if (
          !('expectedArchive' in options) ||
          !options.expectedArchive ||
          !Number.isSafeInteger(options.expectedArchive.bytes) ||
          options.expectedArchive.bytes < 1 ||
          options.expectedArchive.bytes > MAX_ARCHIVE_BYTES ||
          options.expectedArchive.bytes !== archiveInfo.size ||
          !/^[a-f0-9]{64}$/.test(options.expectedArchive.sha256)
        )
          throw new Error('Restore preparation requires completed source transfer evidence.');
        const space = await statfs(directory, { bigint: true });
        if (space.bavail * space.bsize < BigInt(options.expectedArchive.bytes + 256 * 1024 ** 2))
          throw new RecoveryResourceError('disk-space');
        const path = resolve(directory, 'source.spinel.enc');
        await copyRestoreInputFile(
          {
            path: archive,
            bytes: options.expectedArchive.bytes,
            sha256: options.expectedArchive.sha256,
          },
          path,
          operationSignal,
        );
        verifiedArchive = {
          path,
          bytes: options.expectedArchive.bytes,
          sha256: options.expectedArchive.sha256,
        };
        archive = path;
      }
      inputReads.push(archive, keyFile, await realpath(keyFile));
      input = { kind: 'archive', archive, keyFile };
    }
    const result = await runRecoveryWorker<WorkerResult>({
      directory,
      reads: inputReads,
      signal: operationSignal,
      timeoutMs: Math.max(1, deadline - Date.now()),
      input: {
        ...input,
        expectedOrigin: options.expectedOrigin,
        expectedImage: options.expectedImage,
        maxDatabaseBytes: outputMaximum,
        retain,
      },
      validate(value): value is WorkerResult {
        const result = value as WorkerResult | undefined;
        return (
          !!result &&
          ['tables', 'rows', 'snapshots', 'images'].every((key) => {
            const count = result[key as keyof VerificationResult];
            return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
          }) &&
          (result.keyId === undefined || /^[a-zA-Z0-9_-]{1,80}$/.test(result.keyId)) &&
          (!retain ||
            validPreparedEvidence(result.prepared, {
              ...options,
              maxDatabaseBytes: outputMaximum,
            })) &&
          (!reconciliation || validReconciliationSummary(result.prepared?.reconciliation))
        );
      },
    });
    operationSignal.throwIfAborted();
    const { prepared, ...verification } = result;
    if (!retain || !prepared) return verification;
    const databasePath = join(directory, 'restored', 'spinel.sqlite');
    const info = await lstat(databasePath);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      info.size !== prepared.databaseBytes ||
      (info.mode & 0o077) !== 0
    )
      throw new Error('The prepared restore database is unavailable.');
    await assertSelfContained(databasePath);
    if ((await digest(databasePath, operationSignal)) !== prepared.databaseSha256)
      throw new Error('The prepared restore database changed.');
    if (verifiedArchive) {
      const source = await lstat(verifiedArchive.path);
      if (
        !source.isFile() ||
        source.nlink !== 1 ||
        source.uid !== process.getuid?.() ||
        (source.mode & 0o077) !== 0 ||
        source.size !== verifiedArchive.bytes ||
        (await digest(verifiedArchive.path, operationSignal)) !== verifiedArchive.sha256
      )
        throw new Error('The prepared restore source changed.');
    }
    if (reconciliation) {
      for (const suffix of ['', '-wal', '-shm', '-journal'])
        await rm(join(directory, 'current.sqlite') + suffix, { force: true });
    }
    operationSignal.throwIfAborted();
    if (Date.now() >= deadline) throw new RecoveryResourceError('time-limit');
    retained = true;
    return {
      ...verification,
      ...prepared,
      databasePath,
      ...(verifiedArchive && { archive: verifiedArchive }),
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    if (operationSignal.aborted && !options.signal?.aborted)
      throw new RecoveryResourceError('time-limit');
    throw error;
  } finally {
    if (!retained) await rm(directory, { recursive: true, force: true });
  }
}

function validPreparedEvidence(
  value: unknown,
  options: Pick<VerificationOptions, 'expectedOrigin' | 'expectedImage' | 'maxDatabaseBytes'>,
): value is PreparedEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as PreparedEvidence;
  return (
    typeof evidence.databaseSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(evidence.databaseSha256) &&
    Number.isSafeInteger(evidence.databaseBytes) &&
    evidence.databaseBytes >= 4096 &&
    evidence.databaseBytes <= (options.maxDatabaseBytes ?? 8 * 1024 ** 3) &&
    (evidence.reconciliation === undefined ||
      validReconciliationSummary(evidence.reconciliation)) &&
    !!evidence.recovery &&
    typeof evidence.recovery.createdAt === 'string' &&
    Number.isFinite(Date.parse(evidence.recovery.createdAt)) &&
    evidence.recovery.origin === options.expectedOrigin &&
    evidence.recovery.image === options.expectedImage
  );
}

function validReconciliationSummary(value: unknown): value is RestoreReconciliationSummary {
  const fields: Record<keyof RestoreReconciliationSummary, readonly string[]> = {
    credentials: ['currentAccounts', 'currentPasskeys'],
    ownership: [
      'currentItems',
      'isolatedItems',
      'isolatedGroups',
      'detachedRoots',
      'heldTrashBatches',
    ],
    grants: ['copied', 'removed', 'downgraded'],
    receipts: ['copied', 'matched'],
    operations: ['copied', 'defaulted'],
    generations: ['rotated', 'initialized', 'revisionOffset'],
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const groups = value as Record<string, unknown>;
  if (Object.keys(groups).length !== Object.keys(fields).length) return false;
  return Object.entries(fields).every(([group, keys]) => {
    const values = groups[group];
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      Object.keys(values).length !== keys.length
    )
      return false;
    const counts = values as Record<string, unknown>;
    return keys.every(
      (key) =>
        typeof counts[key] === 'number' &&
        Number.isSafeInteger(counts[key]) &&
        Number(counts[key]) >= 0,
    );
  });
}
