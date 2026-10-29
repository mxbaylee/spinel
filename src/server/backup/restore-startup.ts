import { chmod, mkdtemp, realpath, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVerificationHeadroom, runRecoveryWorker } from './recovery-worker.ts';
import {
  copyClosedRestoreInput,
  restoreOutputLimit,
  validateClosedRestoreInput,
} from './restore-input.ts';
import type { ClosedRestoreInput } from './restore-input.ts';
import { RecoveryResourceError } from './resource-error.ts';

export interface StartupWorkerInput {
  kind: 'startup';
  directory: string;
  candidate: ClosedRestoreInput & { logicalFingerprint: string };
  expectedOrigin: string;
  expectedImage: string;
  spacesEnabled: boolean;
  staticDirectory: string;
  maxDatabaseBytes: number;
}

/** Exercise real app initialization and shutdown on a disposable copy inside the
 * existing restricted worker. No listener, deployment key/config or network is
 * available. This proves server startup inertness for these bytes, not activation,
 * actual host/provider acceptance or browser rendering. The controller must still
 * revalidate authority, target and output bindings after this asynchronous check. */
export async function rehearseRestoreStartup(options: {
  candidate: StartupWorkerInput['candidate'];
  expectedOrigin: string;
  expectedImage: string;
  spacesEnabled: boolean;
  stagingRoot: string;
  /** Trusted host/test configuration; never restored archive or request input. */
  staticDirectory?: string;
  maxDatabaseBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const candidate = {
    databasePath: options.candidate.databasePath,
    databaseBytes: options.candidate.databaseBytes,
    databaseSha256: options.candidate.databaseSha256,
    logicalFingerprint: options.candidate.logicalFingerprint,
  };
  const { expectedOrigin, expectedImage, spacesEnabled } = options;
  const maximum = options.maxDatabaseBytes ?? 8 * 1024 ** 3,
    limit = options.timeoutMs ?? 120_000;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 4096 ||
    maximum > 8 * 1024 ** 3 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 600_000 ||
    typeof expectedOrigin !== 'string' ||
    !expectedOrigin ||
    expectedOrigin.length > 4096 ||
    typeof expectedImage !== 'string' ||
    !/^(sha256:[a-f0-9]{64}|\S+@sha256:[a-f0-9]{64})$/.test(expectedImage) ||
    !/^[a-f0-9]{64}$/.test(candidate.logicalFingerprint) ||
    typeof spacesEnabled !== 'boolean'
  )
    throw new Error('Invalid restore startup input.');
  validateClosedRestoreInput(candidate, maximum);
  const deadline = Date.now() + limit;
  const signal = AbortSignal.any([
    AbortSignal.timeout(limit),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  await checkVerificationHeadroom('start');
  const staticDirectory = await realpath(
    options.staticDirectory ?? fileURLToPath(new URL('../../../dist', import.meta.url)),
  );
  const directory = await mkdtemp(join(options.stagingRoot, '.restore-startup-'));
  try {
    await chmod(directory, 0o700);
    const space = await statfs(directory, { bigint: true });
    const bound = restoreOutputLimit(
      space.bavail * space.bsize,
      0,
      candidate.databaseBytes,
      maximum,
    );
    const databasePath = join(directory, 'startup.sqlite');
    await copyClosedRestoreInput(candidate, databasePath, signal);
    await runRecoveryWorker({
      directory,
      reads: [staticDirectory],
      signal,
      timeoutMs: Math.max(1, deadline - Date.now()),
      input: {
        kind: 'startup',
        candidate: {
          databasePath,
          databaseBytes: candidate.databaseBytes,
          databaseSha256: candidate.databaseSha256,
          logicalFingerprint: candidate.logicalFingerprint,
        },
        expectedOrigin,
        expectedImage,
        spacesEnabled,
        staticDirectory,
        maxDatabaseBytes: bound,
      },
      validate(value): value is { logicalFingerprint: string } {
        return (
          !!value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 1 &&
          'logicalFingerprint' in value &&
          value.logicalFingerprint === candidate.logicalFingerprint
        );
      },
    });
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new RecoveryResourceError('time-limit');
  } catch (error) {
    if (signal.aborted && !options.signal?.aborted) throw new RecoveryResourceError('time-limit');
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  if (signal.aborted && !options.signal?.aborted) throw new RecoveryResourceError('time-limit');
  signal.throwIfAborted();
  if (Date.now() >= deadline) throw new RecoveryResourceError('time-limit');
}
