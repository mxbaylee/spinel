import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { reconcilePreparedRestore } from '../backup/verification.ts';
import { prepareRestoreRollback } from '../backup/restore-rollback.ts';
import { rehearseRestoreStartup } from '../backup/restore-startup.ts';
import { syncClosedRestoreInput, syncRestoreDirectory } from '../backup/restore-input.ts';
import type { ClosedRestoreInput } from '../backup/restore-input.ts';
import { readRetainedRestoreSource } from './restore-files.ts';
import type { RestoreJobRecord, RestoreJobs, RestorePreparedImage } from './restore-jobs.ts';

/** Continue this same supervisor-owned queue from witnessed frozen custody. This
 * is preparation, not permission to open the live database. One immutable slot
 * owns every successful output; an interrupted/uncertain slot is never retried
 * automatically, even when its worker cleaned up an incomplete private output.
 */
export async function prepareRestoreAttempt(options: {
  jobs: RestoreJobs;
  record: RestoreJobRecord;
  root: string;
  now(): number;
  signal: AbortSignal;
  assertClosed(): void;
  /** Absolute wall-clock deadline shared with original custody and freezing. */
  deadline: number;
}): Promise<RestoreJobRecord> {
  const { jobs, root, now, deadline } = options;
  if (
    !isAbsolute(root) ||
    resolve(root) !== root ||
    root.includes('\0') ||
    !Number.isSafeInteger(deadline) ||
    deadline <= Date.now()
  )
    throw new Error('Invalid restore preparation boundary.');
  let record = structuredClone(options.record);
  const remaining = () =>
    Math.min(600_000, deadline - Date.now(), record.intent.authority.expiresAt - now());
  let signal = options.signal;
  const assertActive = () => {
    const check = () => {
      signal.throwIfAborted();
      const time = now();
      if (
        !Number.isSafeInteger(time) ||
        time < record.updatedAt ||
        time >= record.intent.authority.expiresAt ||
        Date.now() >= deadline
      )
        throw new Error('The original restore preparation deadline expired.');
    };
    check();
    options.assertClosed();
    check();
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
  // This synchronous store read/publication authenticates the supplied revision
  // and immutable intent before any worker or preparation-directory mutation.
  record = jobs.planPreparation(
    record.intent.id,
    record.intentHash,
    record.revision,
    randomUUID(),
    now(),
  );
  const budget = remaining();
  if (!Number.isSafeInteger(budget) || budget <= 0)
    throw new Error('The original restore preparation deadline expired.');
  signal = AbortSignal.any([options.signal, AbortSignal.timeout(budget)]);
  assertActive();
  const plan = record.execution!,
    preparation = plan.preparation!;
  const retained = join(root, `restore-${record.intent.id}`);
  const stagingRoot = join(retained, `prepare-${preparation.slot}`);
  const frozen: ClosedRestoreInput = {
    databasePath: join(
      retained,
      `freeze-${plan.freezeSlot!}`,
      plan.frozen!.directory,
      'frozen.sqlite',
    ),
    databaseBytes: plan.frozen!.bytes,
    databaseSha256: plan.frozen!.sha256,
  };
  // Existing directories are evidence of an earlier attempt, never permission to
  // allocate another worker output. Sync the directory entry before worker use.
  mkdirSync(stagingRoot, { mode: 0o700 });
  await step(() => syncRestoreDirectory(stagingRoot, signal));
  await step(() => syncRestoreDirectory(retained, signal));
  const source = await step(() =>
    readRetainedRestoreSource({
      root,
      manifest: record.intent.source,
      assertRoot: assertActive,
      signal,
    }),
  );
  const policy = record.intent.policy;
  const prepared = await step(() =>
    reconcilePreparedRestore({
      candidate: source.candidate,
      current: frozen,
      stagingRoot,
      expectedOrigin: policy.origin,
      expectedImage: policy.image,
      spacesEnabled: policy.spacesEnabled,
      now: preparation.preparedAt,
      timeoutMs: remaining(),
      signal,
    }),
  );
  const evidence = (
    output: ClosedRestoreInput & { logicalFingerprint: string },
    kind: 'reconciled' | 'rollback',
  ): RestorePreparedImage => {
    const path = relative(stagingRoot, output.databasePath);
    const suffix = kind === 'reconciled' ? '/restored/spinel.sqlite' : '/rollback.sqlite';
    const directory = path.split('/')[0];
    if (
      !new RegExp(`^\\.restore-${kind}-[A-Za-z0-9]{6}$`).test(directory) ||
      path !== directory + suffix ||
      resolve(output.databasePath) !== output.databasePath
    )
      throw new Error('Prepared restore output escaped its planned slot.');
    return {
      directory,
      bytes: output.databaseBytes,
      sha256: output.databaseSha256,
      fingerprint: output.logicalFingerprint,
    };
  };
  const publishOutput = async (output: ClosedRestoreInput, image: RestorePreparedImage) => {
    await step(() => syncClosedRestoreInput(output, signal));
    await step(() => syncRestoreDirectory(dirname(output.databasePath), signal));
    const directory = join(stagingRoot, image.directory);
    if (directory !== dirname(output.databasePath))
      await step(() => syncRestoreDirectory(directory, signal));
    await step(() => syncRestoreDirectory(stagingRoot, signal));
  };
  const candidate = evidence(prepared, 'reconciled');
  await publishOutput(prepared, candidate);
  record = jobs.markCandidatePrepared(
    record.intent.id,
    record.intentHash,
    record.revision,
    candidate,
  );
  assertActive();
  const rollback = await step(() =>
    prepareRestoreRollback({
      current: { ...frozen, fingerprint: plan.stop!.fingerprint! },
      // Only negative retry/native-generation evidence comes from the attempted
      // candidate. The frozen original remains the sole current authority/content.
      additional: [prepared],
      stagingRoot,
      spacesEnabled: policy.spacesEnabled,
      now: preparation.preparedAt,
      timeoutMs: remaining(),
      signal,
    }),
  );
  if (rollback.originalFingerprint !== plan.stop!.fingerprint)
    throw new Error('Prepared rollback lost its original witness binding.');
  const original = evidence(rollback, 'rollback');
  await publishOutput(rollback, original);
  record = jobs.markRollbackPrepared(
    record.intent.id,
    record.intentHash,
    record.revision,
    original,
  );
  assertActive();
  const rehearse = (output: ClosedRestoreInput & { logicalFingerprint: string }) =>
    step(() =>
      rehearseRestoreStartup({
        candidate: output,
        expectedOrigin: policy.origin,
        expectedImage: policy.image,
        spacesEnabled: policy.spacesEnabled,
        staticDirectory: policy.staticDirectory,
        stagingRoot,
        timeoutMs: remaining(),
        signal,
      }),
    );
  await rehearse(prepared);
  await step(() => syncClosedRestoreInput(prepared, signal));
  record = jobs.markCandidateRehearsed(record.intent.id, record.intentHash, record.revision);
  assertActive();
  await rehearse(rollback);
  await step(() => syncClosedRestoreInput(prepared, signal));
  await step(() => syncClosedRestoreInput(rollback, signal));
  record = jobs.markPrepared(record.intent.id, record.intentHash, record.revision);
  assertActive();
  return record;
}
