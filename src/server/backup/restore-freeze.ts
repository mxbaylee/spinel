import { chmod, lstat, mkdtemp, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './archive.ts';
import { checkVerificationHeadroom, runRecoveryWorker } from './recovery-worker.ts';
import { RecoveryResourceError } from './resource-error.ts';
import {
  assertSelfContained,
  copyRestoreInputFile,
  validateClosedRestoreInput,
} from './restore-input.ts';
import type { ClosedRestoreInput, RestoreInputFile } from './restore-input.ts';

interface FrozenEvidence {
  databaseBytes: number;
  databaseSha256: string;
  fingerprint: string;
}
export interface FrozenRestore extends ClosedRestoreInput {
  fingerprint: string;
  dispose(): Promise<void>;
}

/** Requires immutable original custody and an independently captured, durable
 * pre-shutdown drain witness. Never derive fingerprint from the recovered tuple.
 * Neither raw original nor its SHM is opened by SQLite. This does not activate
 * the result or substitute for supervisor job/epoch/authority validation. */
export async function freezeCurrentRestore(options: {
  database: RestoreInputFile;
  wal?: RestoreInputFile;
  fingerprint: string;
  stagingRoot: string;
  maxDatabaseBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<FrozenRestore> {
  options.signal?.throwIfAborted();
  const maximum = options.maxDatabaseBytes ?? 8 * 1024 ** 3;
  const limit = options.timeoutMs ?? 120_000;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 4096 ||
    maximum > 8 * 1024 ** 3 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 600_000 ||
    !/^[a-f0-9]{64}$/.test(options.fingerprint)
  )
    throw new Error('Invalid frozen current input.');
  validateClosedRestoreInput(
    {
      databasePath: options.database.path,
      databaseBytes: options.database.bytes,
      databaseSha256: options.database.sha256,
    },
    maximum,
  );
  if (
    options.wal &&
    (options.wal.path !== options.database.path + '-wal' ||
      !Number.isSafeInteger(options.wal.bytes) ||
      options.wal.bytes < 0 ||
      options.wal.bytes > 8 * 1024 ** 3 ||
      !/^[a-f0-9]{64}$/.test(options.wal.sha256))
  )
    throw new Error('Invalid frozen WAL input.');
  const deadline = Date.now() + limit;
  const signal = AbortSignal.any([
    AbortSignal.timeout(limit),
    ...(options.signal ? [options.signal] : []),
  ]);
  const assertTuple = async () => {
    for (const suffix of ['-wal', '-journal']) {
      let exists = true;
      try {
        await lstat(options.database.path + suffix);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        exists = false;
      }
      if (exists !== (suffix === '-wal' && !!options.wal))
        throw new Error('Original recovery tuple is incomplete or changed.');
    }
  };
  await assertTuple();
  await checkVerificationHeadroom('start');
  const directory = await mkdtemp(join(options.stagingRoot, '.restore-frozen-'));
  let retained = false;
  try {
    await chmod(directory, 0o700);
    const space = await statfs(directory, { bigint: true });
    if (
      space.bavail * space.bsize <
      BigInt(3 * (options.database.bytes + (options.wal?.bytes ?? 0)) + 256 * 1024 ** 2)
    )
      throw new RecoveryResourceError('disk-space');
    const source = join(directory, 'source.sqlite');
    await copyRestoreInputFile(options.database, source, signal);
    if (options.wal) await copyRestoreInputFile(options.wal, source + '-wal', signal);
    await assertTuple();
    signal.throwIfAborted();
    const result = await runRecoveryWorker<FrozenEvidence>({
      directory,
      signal,
      timeoutMs: Math.max(1, deadline - Date.now()),
      input: {
        kind: 'freeze',
        maxDatabaseBytes: maximum,
        fingerprint: options.fingerprint,
        database: { bytes: options.database.bytes, sha256: options.database.sha256 },
        ...(options.wal && { wal: { bytes: options.wal.bytes, sha256: options.wal.sha256 } }),
      },
      validate(value): value is FrozenEvidence {
        const result = value as FrozenEvidence | undefined;
        return (
          !!result &&
          Number.isSafeInteger(result.databaseBytes) &&
          result.databaseBytes >= 4096 &&
          result.databaseBytes <= maximum &&
          typeof result.databaseSha256 === 'string' &&
          /^[a-f0-9]{64}$/.test(result.databaseSha256) &&
          result.fingerprint === options.fingerprint
        );
      },
    });
    const databasePath = join(directory, 'frozen.sqlite');
    const info = await lstat(databasePath);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0 ||
      info.size !== result.databaseBytes
    )
      throw new Error('Frozen current output is unavailable.');
    await assertSelfContained(databasePath);
    if ((await digest(databasePath, signal)) !== result.databaseSha256)
      throw new Error('Frozen current output changed.');
    for (const suffix of ['', '-wal', '-shm', '-journal'])
      await rm(source + suffix, { force: true });
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
