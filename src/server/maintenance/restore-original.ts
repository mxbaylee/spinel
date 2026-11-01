import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { prepareRestoreRollback } from '../backup/restore-rollback.ts';
import { rehearseRestoreStartup } from '../backup/restore-startup.ts';
import {
  syncRestoreDirectory,
  syncClosedRestoreInput,
  verifyClosedRestoreInput,
} from '../backup/restore-input.ts';
import type { ClosedRestoreInput } from '../backup/restore-input.ts';
import { stagePreparedRestoreOriginal, activatePreparedRestoreOriginal } from './restore-files.ts';
import type { RestoreFileControl, RestoreFiles, RestoreFilePhase } from './restore-files.ts';
import type { RestoreJobRecord, RestoreJobs, RestorePreparedImage } from './restore-jobs.ts';

/** One fresh original-content image, never raw rollback. Original authority and
 * content come only from the witnessed frozen original. Every attempted image
 * contributes negative receipt/identity/revision evidence, never authority. */
export async function prepareAndActivateRestoreOriginal(options: {
  jobs: RestoreJobs;
  record: RestoreJobRecord;
  root: string;
  databasePath: string;
  now(): number;
  signal: AbortSignal;
  deadline: number;
  assertClosed(): void;
}): Promise<RestoreJobRecord> {
  const { jobs, root, databasePath, now } = options;
  if (
    !isAbsolute(root) ||
    resolve(root) !== root ||
    root.includes('\0') ||
    !Number.isSafeInteger(options.deadline)
  )
    throw new Error('Invalid original recovery boundary.');
  let record = structuredClone(options.record),
    signal = options.signal;
  const deadline = Math.min(options.deadline, record.intent.authority.expiresAt);
  const assertAuthorized = () => {
    signal.throwIfAborted();
    const time = now();
    if (
      databasePath !== record.intent.target.databasePath ||
      !Number.isSafeInteger(time) ||
      time < record.updatedAt ||
      time >= deadline ||
      Date.now() >= deadline
    )
      throw new Error('Original recovery authority expired or changed.');
  };
  const assertActive = () => {
    assertAuthorized();
    options.assertClosed();
    assertAuthorized();
  };
  const step = async <T>(work: () => Promise<T>): Promise<T> => {
    assertActive();
    try {
      return await work();
    } finally {
      assertActive();
    }
  };
  assertActive();
  record = jobs.planOriginalPreparation(
    record.intent.id,
    record.intentHash,
    record.revision,
    randomUUID(),
    deadline,
  );
  const remaining = () => Math.min(600_000, deadline - Date.now(), deadline - now());
  signal = AbortSignal.any([signal, AbortSignal.timeout(remaining())]);
  const execution = record.execution!,
    rollback = execution.rollback!,
    retained = join(root, `restore-${record.intent.id}`),
    stagingRoot = join(retained, `original-${rollback.slot}`);
  mkdirSync(stagingRoot, { mode: 0o700 });
  await step(() => syncRestoreDirectory(stagingRoot, signal));
  await step(() => syncRestoreDirectory(retained, signal));
  const input = (path: string, image: RestorePreparedImage): ClosedRestoreInput => ({
    databasePath: path,
    databaseBytes: image.bytes,
    databaseSha256: image.sha256,
  });
  const preparation = execution.preparation!,
    priorRoot = join(retained, `prepare-${preparation.slot}`),
    failed = execution.failure!,
    failedImage = failed.freeze!.output!;
  const frozen = input(
    join(retained, `freeze-${execution.freezeSlot}`, execution.frozen!.directory, 'frozen.sqlite'),
    execution.frozen!,
  );
  const output = await step(() =>
    prepareRestoreRollback({
      current: { ...frozen, fingerprint: execution.stop!.fingerprint! },
      authority: record.intent.authority,
      additional: [
        input(
          join(priorRoot, preparation.candidate!.directory, 'restored', 'spinel.sqlite'),
          preparation.candidate!,
        ),
        input(
          join(priorRoot, preparation.rollback!.directory, 'rollback.sqlite'),
          preparation.rollback!,
        ),
        input(
          join(
            retained,
            `failed-freeze-${failed.freeze!.slot}`,
            failedImage.directory,
            'frozen.sqlite',
          ),
          failedImage,
        ),
      ],
      stagingRoot,
      spacesEnabled: record.intent.policy.spacesEnabled,
      now: rollback.preparedAt,
      timeoutMs: remaining(),
      signal,
    }),
  );
  // Successful output is retained even if any later publication is uncertain.
  if (
    output.originalFingerprint !== execution.stop!.fingerprint ||
    dirname(dirname(output.databasePath)) !== stagingRoot ||
    basename(output.databasePath) !== 'rollback.sqlite'
  )
    throw new Error('Original recovery output lost its sealed origin.');
  await step(() => syncClosedRestoreInput(output, signal));
  await step(() => syncRestoreDirectory(dirname(output.databasePath), signal));
  await step(() => syncRestoreDirectory(stagingRoot, signal));
  record = jobs.markOriginalPrepared(record.intent.id, record.intentHash, record.revision, {
    directory: basename(dirname(output.databasePath)),
    bytes: output.databaseBytes,
    sha256: output.databaseSha256,
    fingerprint: output.logicalFingerprint,
  });
  await step(() =>
    rehearseRestoreStartup({
      candidate: output,
      stagingRoot,
      expectedOrigin: record.intent.policy.origin,
      expectedImage: record.intent.policy.image,
      spacesEnabled: record.intent.policy.spacesEnabled,
      staticDirectory: record.intent.policy.staticDirectory,
      signal,
      timeoutMs: remaining(),
    }),
  );
  record = jobs.markOriginalRehearsed(record.intent.id, record.intentHash, record.revision);
  record = jobs.planOriginalActivation(record.intent.id, record.intentHash, record.revision, {
    attemptId: randomUUID(),
    generationId: randomUUID(),
    epoch: randomUUID(),
    nonce: randomUUID(),
  });
  const files: RestoreFiles = {
    ...execution.originals!,
    candidate: {
      bytes: output.databaseBytes,
      sha256: output.databaseSha256,
    },
  };
  const readPhase = (): RestoreFilePhase | undefined => {
    const durable = jobs.read(record.intent.id);
    if (!durable || durable.revision !== record.revision || !isDeepStrictEqual(durable, record))
      throw new Error('Original recovery durable evidence changed.');
    if (record.phase === 'original-activation-planned' || record.phase === 'original-staged')
      return undefined;
    if (record.phase === 'original-replacing') return 'rolling-back';
    if (record.phase === 'original-activated') return 'rolled-back';
    throw new Error('Original recovery cannot replace a terminal attempt.');
  };
  const control: RestoreFileControl = {
    root,
    databasePath,
    signal,
    deadline,
    assertAuthorized,
    assertClosed: assertActive,
    readPhase,
    persist: async (phase) => {
      assertActive();
      if (phase === 'rolling-back')
        record = jobs.markOriginalReplacing(record.intent.id, record.intentHash, record.revision);
      else if (phase === 'rolled-back')
        record = jobs.markOriginalActivated(record.intent.id, record.intentHash, record.revision);
      else throw new Error('Unexpected original recovery file transition.');
      assertActive();
    },
  };
  await step(() =>
    stagePreparedRestoreOriginal(
      control,
      files,
      failed.capture!.manifest!,
      record.execution!.rollback!.attempt!.attemptId,
      output.databasePath,
    ),
  );
  record = jobs.markOriginalStaged(record.intent.id, record.intentHash, record.revision);
  await step(() =>
    activatePreparedRestoreOriginal(
      control,
      files,
      failed.capture!.manifest!,
      record.execution!.rollback!.attempt!.attemptId,
    ),
  );
  await step(() =>
    verifyClosedRestoreInput(
      { databasePath, databaseBytes: output.databaseBytes, databaseSha256: output.databaseSha256 },
      signal,
    ),
  );
  return record;
}
