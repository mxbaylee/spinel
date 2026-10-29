import { chmod, lstat, mkdtemp, rm, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { checkVerificationHeadroom, runRecoveryWorker } from './recovery-worker.ts';
import { RecoveryResourceError } from './resource-error.ts';
import { MAX_RESTORE_EVIDENCE_INPUTS } from './restore-evidence.ts';
import {
  syncClosedRestoreInput,
  syncRestoreDirectory,
  copyClosedRestoreInput,
  restoreOutputLimit,
  validateClosedRestoreInput,
} from './restore-input.ts';
import type { ClosedRestoreInput } from './restore-input.ts';
import type { reconcileRestoreRollback } from './restore-candidate.ts';

export type RollbackSummary = Omit<
  Awaited<ReturnType<typeof reconcileRestoreRollback>>,
  'inventory' | 'semantics'
>;
export interface RollbackEvidence {
  databaseSha256: string;
  databaseBytes: number;
  logicalFingerprint: string;
  originalFingerprint: string;
  tables: number;
  rows: number;
  snapshots: number;
  images: number;
  reconciliation: RollbackSummary;
}
export interface PreparedRollback extends ClosedRestoreInput, RollbackEvidence {
  dispose(): Promise<void>;
}
export interface RollbackWorkerInput {
  kind: 'rollback';
  directory: string;
  current: ClosedRestoreInput & { fingerprint: string };
  additional: ClosedRestoreInput[];
  maxDatabaseBytes: number;
  spacesEnabled: boolean;
  now: number;
}

function validResult(
  value: unknown,
  fingerprint: string,
  maximum: number,
): value is RollbackEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as RollbackEvidence;
  if (
    Object.keys(result).length !== 9 ||
    typeof result.logicalFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(result.logicalFingerprint) ||
    result.originalFingerprint !== fingerprint ||
    typeof result.databaseSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(result.databaseSha256) ||
    !Number.isSafeInteger(result.databaseBytes) ||
    result.databaseBytes < 4096 ||
    result.databaseBytes > maximum
  )
    return false;
  for (const key of ['tables', 'rows', 'snapshots', 'images'] as const)
    if (!Number.isSafeInteger(result[key]) || result[key] < 0) return false;
  const fields: Record<keyof RollbackSummary, readonly string[]> = {
    credentials: ['currentAccounts', 'currentPasskeys'],
    receipts: ['copied', 'matched'],
    operations: ['copied', 'defaulted'],
    generations: ['rotated', 'initialized', 'revisionOffset'],
  };
  const groups = result.reconciliation;
  if (
    !groups ||
    typeof groups !== 'object' ||
    Array.isArray(groups) ||
    Object.keys(groups).length !== 4
  )
    return false;
  return Object.entries(fields).every(([name, keys]) => {
    const group = (groups as unknown as Record<string, Record<string, unknown>>)[name];
    return (
      !!group &&
      typeof group === 'object' &&
      !Array.isArray(group) &&
      Object.keys(group).length === keys.length &&
      keys.every(
        (key) =>
          typeof group[key] === 'number' &&
          Number.isSafeInteger(group[key]) &&
          Number(group[key]) >= 0,
      )
    );
  });
}

/** Prepare rollback before an attempt can become eligible for activation. All
 * inputs are closed supervisor-custodied files; current's witness must already
 * be independently persisted. No source file is opened by SQLite in this parent.
 * The result is private evidence, never authority to reopen or replace a file.
 */
export async function prepareRestoreRollback(options: {
  current: ClosedRestoreInput & { fingerprint: string };
  additional: readonly ClosedRestoreInput[];
  stagingRoot: string;
  spacesEnabled: boolean;
  now: number;
  maxDatabaseBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<PreparedRollback> {
  options.signal?.throwIfAborted();
  const requested = options.maxDatabaseBytes ?? 8 * 1024 ** 3;
  const limit = options.timeoutMs ?? 120_000;
  if (
    !Number.isSafeInteger(requested) ||
    requested < 4096 ||
    requested > 8 * 1024 ** 3 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 600_000 ||
    !Array.isArray(options.additional) ||
    options.additional.length > MAX_RESTORE_EVIDENCE_INPUTS ||
    !/^[a-f0-9]{64}$/.test(options.current.fingerprint) ||
    typeof options.spacesEnabled !== 'boolean' ||
    !Number.isSafeInteger(options.now) ||
    options.now < 0
  )
    throw new Error('Invalid rollback preparation.');
  const inputs = [options.current, ...options.additional];
  const identities = new Set<string>();
  for (const input of inputs) {
    validateClosedRestoreInput(input, requested);
    const file = await lstat(input.databasePath);
    const identity = `${file.dev}:${file.ino}`;
    if (identities.has(identity)) throw new Error('Rollback sources must be independent files.');
    identities.add(identity);
  }
  const deadline = Date.now() + limit;
  const signal = AbortSignal.any([
    AbortSignal.timeout(limit),
    ...(options.signal ? [options.signal] : []),
  ]);
  await checkVerificationHeadroom('start');
  const directory = await mkdtemp(join(resolve(options.stagingRoot), '.restore-rollback-'));
  let retained = false;
  try {
    await chmod(directory, 0o700);
    const space = await statfs(directory, { bigint: true });
    const copiedBytes = inputs.reduce((sum, input) => sum + input.databaseBytes, 0);
    // Bound output growth, journal and temporary SQLite work, not just initial
    // input size. Rebased resources may expand far beyond the original bytes.
    const maximum = restoreOutputLimit(
      space.bavail * space.bsize,
      copiedBytes,
      options.current.databaseBytes,
      requested,
    );
    const copies: ClosedRestoreInput[] = [];
    for (const [index, input] of inputs.entries()) {
      const databasePath = resolve(
        directory,
        index === 0 ? 'current.sqlite' : `attempt-${index - 1}.sqlite`,
      );
      await copyClosedRestoreInput(input, databasePath, signal);
      copies.push({
        databasePath,
        databaseBytes: input.databaseBytes,
        databaseSha256: input.databaseSha256,
      });
    }
    const databasePath = join(directory, 'rollback.sqlite');
    await copyClosedRestoreInput(options.current, databasePath, signal);
    signal.throwIfAborted();
    const result = await runRecoveryWorker<RollbackEvidence>({
      directory,
      signal,
      timeoutMs: Math.max(1, deadline - Date.now()),
      input: {
        kind: 'rollback',
        current: { ...copies[0], fingerprint: options.current.fingerprint },
        additional: copies.slice(1),
        maxDatabaseBytes: maximum,
        spacesEnabled: options.spacesEnabled,
        now: options.now,
      },
      validate: (value): value is RollbackEvidence =>
        validResult(value, options.current.fingerprint, maximum),
    });
    await syncClosedRestoreInput(
      { databasePath, databaseBytes: result.databaseBytes, databaseSha256: result.databaseSha256 },
      signal,
    );
    for (const copy of copies)
      for (const suffix of ['', '-wal', '-shm', '-journal'])
        await rm(copy.databasePath + suffix, { force: true });
    await syncRestoreDirectory(directory, signal);
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new RecoveryResourceError('time-limit');
    retained = true;
    return {
      ...result,
      databasePath,
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    if (signal.aborted && !options.signal?.aborted) throw new RecoveryResourceError('time-limit');
    throw error;
  } finally {
    if (!retained) await rm(directory, { recursive: true, force: true });
  }
}
