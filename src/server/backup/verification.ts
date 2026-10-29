import { fork } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  statfs,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecoveryResourceCode, RecoveryResourceError } from './resource-error.ts';
import { digest } from './archive.ts';
import {
  assertSelfContained,
  copyClosedRestoreInput,
  validateClosedRestoreInput,
} from './restore-input.ts';
import type { ClosedRestoreInput } from './restore-input.ts';
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
  dispose(): Promise<void>;
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

/** A child heap cap alone cannot protect a smaller application cgroup. Linux
 * probes are best-effort; missing cgroup files still leave the host check, child
 * RSS watchdog and V8/time bounds in force. Tests supply the kernel file reader. */
export async function checkVerificationHeadroom(
  phase: 'start' | 'running',
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
  platform: string = process.platform,
) {
  if (platform !== 'linux') return;
  const probes = await Promise.allSettled([
    read('/sys/fs/cgroup/memory.max'),
    read('/sys/fs/cgroup/memory.current'),
    read('/proc/meminfo'),
  ]);
  const values = probes.map((probe) => (probe.status === 'fulfilled' ? probe.value.trim() : ''));
  const bytes = (text: string) => {
    const value = /^\d+$/.test(text) ? Number(text) : NaN;
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const maximum = bytes(values[0]),
    used = bytes(values[1]);
  const availableKiB = bytes(/^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(values[2])?.[1] ?? '');
  const MiB = 1024 ** 2;
  if (
    (maximum !== undefined &&
      used !== undefined &&
      maximum - used < (phase === 'start' ? 640 : 128) * MiB) ||
    (availableKiB !== undefined && availableKiB * 1024 < (phase === 'start' ? 768 : 256) * MiB)
  )
    throw new RecoveryResourceError('memory-headroom');
}

/** The parent owns cleanup even if the worker is killed. The worker receives
 * paths by IPC, never secret bytes or user content on the command line. */
export async function verifyArchive(options: VerificationOptions): Promise<VerificationResult> {
  return inspectArchive(options, false);
}

/** Both catalog selection and upload will use this same isolated preparation.
 * Keep only the verified database, never an archived deployment environment.
 * The caller owns disposal until a supervisor durably accepts custody. */
export async function prepareRestoreArchive(
  options: VerificationOptions & { expectedImage: string },
): Promise<PreparedRestore> {
  if (!/^(sha256:[a-f0-9]{64}|\S+@sha256:[a-f0-9]{64})$/.test(options.expectedImage))
    throw new Error('Restore preparation requires the current immutable application image.');
  const result = await inspectArchive(options, true);
  if (!('databasePath' in result))
    throw new Error('Restore preparation did not retain a candidate.');
  return result;
}

async function inspectArchive(
  options: VerificationOptions | ReconcileRestoreOptions,
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
    if ('current' in options) {
      const maximum = options.maxDatabaseBytes ?? 8 * 1024 ** 3;
      if (!Number.isSafeInteger(maximum) || maximum < 4096 || maximum > 8 * 1024 ** 3)
        throw new Error('Invalid recovery database limit.');
      validateClosedRestoreInput(options.current, maximum);
      validateClosedRestoreInput(options.candidate, maximum);
      const space = await statfs(directory, { bigint: true });
      if (
        space.bavail * space.bsize <
        BigInt(
          3 * (options.current.databaseBytes + options.candidate.databaseBytes) + 256 * 1024 ** 2,
        )
      )
        throw new RecoveryResourceError('disk-space');
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
      const archive = await realpath(options.archive);
      // Preserve the final component for readKey's O_NOFOLLOW boundary.
      const keyFile = resolve(options.keyFile);
      const archiveInfo = await stat(archive);
      if (!archiveInfo.isFile()) throw new Error('Recovery archive must be a regular file.');
      if (archiveInfo.size > 5 * 1024 ** 3) throw new RecoveryResourceError('archive-size');
      inputReads.push(archive, keyFile, await realpath(keyFile));
      input = { kind: 'archive', archive, keyFile };
    }
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const reads = new Set([
      join(root, 'server'),
      join(root, 'src'),
      join(root, 'lib'),
      join(root, 'package.json'),
      join(root, 'node_modules'),
      await realpath(join(root, 'node_modules')),
      directory,
      ...inputReads,
    ]);
    for (const name of [
      '@spinel/sync-server',
      '@spinel/sync-transform',
      '@spinel/doc-formulas',
      '@spinel/diagnostics',
    ])
      reads.add(dirname(fileURLToPath(import.meta.resolve(name))));
    operationSignal.throwIfAborted();
    const timeoutMs = Math.max(1, deadline - Date.now());
    const result = await new Promise<WorkerResult>((resolveResult, reject) => {
      let result: WorkerResult | undefined;
      let failure: Error | undefined;
      const deadline = Date.now() + timeoutMs;
      const child = fork(new URL('./verification-worker.ts', import.meta.url), [], {
        cwd: directory,
        env: {
          TZ: 'Etc/UTC',
          TMPDIR: directory,
          ...(process.env.SPINEL_PROCESS_GROUP_TOKEN && {
            SPINEL_PROCESS_GROUP_TOKEN: process.env.SPINEL_PROCESS_GROUP_TOKEN,
          }),
        },
        // Native SQLite/sharp require trusted addons. Archive data never supplies
        // code, module paths, output paths or process commands. Network is denied.
        execArgv: [
          '--max-old-space-size=256',
          '--max-semi-space-size=8',
          `--process-timeout=${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
          '--permission',
          '--allow-addons',
          ...[...reads].map((path) => `--allow-fs-read=${path}`),
          `--allow-fs-write=${directory}`,
        ],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const stop = (error: Error) => {
        failure ??= error;
        child.kill('SIGKILL');
      };
      const abort = () => stop(new Error('Recovery verification was cancelled.'));
      options.signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => stop(new RecoveryResourceError('time-limit')), timeoutMs);
      let sampling = false;
      const memory = setInterval(async () => {
        if (sampling || !child.pid || process.platform !== 'linux') return;
        sampling = true;
        try {
          const [usage, headroom] = await Promise.allSettled([
            readFile(`/proc/${child.pid}/status`, 'utf8'),
            checkVerificationHeadroom('running'),
          ]);
          if (usage.status === 'fulfilled') {
            const rss = Number(/^VmRSS:\s+(\d+)/m.exec(usage.value)?.[1] ?? 0);
            if (rss > 512 * 1024) stop(new RecoveryResourceError('memory-limit'));
          } // A missing PID can race normal exit; success still requires its IPC result.
          if (headroom.status === 'rejected') stop(new RecoveryResourceError('memory-headroom'));
        } finally {
          sampling = false;
        }
      }, 100);
      child.on('message', (message: unknown) => {
        const value = message as {
          ok?: unknown;
          result?: WorkerResult;
          resourceCode?: unknown;
        };
        if (value?.ok === false && isRecoveryResourceCode(value.resourceCode)) {
          stop(new RecoveryResourceError(value.resourceCode));
          return;
        }
        if (
          value?.ok !== true ||
          !value.result ||
          !['tables', 'rows', 'snapshots', 'images'].every((key) => {
            const count = value.result![key as keyof VerificationResult];
            return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
          }) ||
          (value.result.keyId !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(value.result.keyId)) ||
          (retain && !validPreparedEvidence(value.result.prepared, options)) ||
          (reconciliation && !validReconciliationSummary(value.result.prepared?.reconciliation))
        ) {
          stop(
            new Error(
              'Recovery verification failed. Check the backup, recovery key and compatible application version.',
            ),
          );
        } else result = value.result;
      });
      child.once('error', () => stop(new Error('Recovery verification could not start.')));
      child.once('close', (code) => {
        clearInterval(memory);
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        if (!failure && code === 0 && result) resolveResult(result);
        else
          reject(
            failure ??
              (Date.now() >= deadline
                ? new RecoveryResourceError('time-limit')
                : new Error('Recovery verification was interrupted or failed.')),
          );
      });
      child.send(
        {
          ...input,
          directory: resolve(directory),
          expectedOrigin: options.expectedOrigin,
          expectedImage: options.expectedImage,
          maxDatabaseBytes: options.maxDatabaseBytes,
          retain,
        },
        (error) => {
          if (error) stop(new Error('Recovery verification could not start.'));
        },
      );
      if (options.signal?.aborted) abort();
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
