import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { freezeCurrentRestore } from '../backup/restore-freeze.ts';
import {
  syncClosedRestoreInput,
  syncRestoreDirectory,
  verifyClosedRestoreInput,
} from '../backup/restore-input.ts';
import type { ClosedRestoreInput } from '../backup/restore-input.ts';
import { prepareRestoreRollback } from '../backup/restore-rollback.ts';
import { rehearseRestoreStartup } from '../backup/restore-startup.ts';
import {
  activatePreparedRestoreOriginal,
  captureColdRestoreCustody,
  coldRestoreCustodyInputs,
  preserveColdRestoreCustody,
  stagePreparedRestoreOriginal,
} from './restore-files.ts';
import type { RestoreFileControl, RestoreFilePhase } from './restore-files.ts';
import { currentRestoreRecovery, restoreJobPhase } from './restore-jobs.ts';
import type { RestoreJobRecord, RestoreJobs, RestorePreparedImage } from './restore-jobs.ts';

type Image = Pick<RestorePreparedImage, 'directory' | 'bytes' | 'sha256' | 'fingerprint'>;
const input = (databasePath: string, image: Image): ClosedRestoreInput => ({
  databasePath,
  databaseBytes: image.bytes,
  databaseSha256: image.sha256,
});

/** A granted opening can have produced a WAL, but cannot accept public work.
 * Freeze only against an already sealed fingerprint. A mixed replacement is
 * never opened as SQLite, and a changed private trial remains unresolved. */
function interruptedTrialFingerprint(record: RestoreJobRecord): string | undefined {
  for (const attempt of (record.recovery?.attempts.slice(0, -1) ?? []).toReversed()) {
    if (['original-trial-opening', 'original-trial-ready'].includes(attempt.phase))
      return attempt.image!.fingerprint;
    if (
      ['original-replacing', 'original-activated', 'original-trial-planned'].includes(attempt.phase)
    )
      return undefined;
  }
  if (record.phase === 'candidate-replacing' || record.phase === 'original-replacing')
    return undefined;
  if (['original-trial-opening', 'original-trial-ready'].includes(record.phase))
    return record.execution!.rollback!.image!.fingerprint;
  if (['original-activated', 'original-trial-planned'].includes(record.phase)) return undefined;
  if (record.execution!.failure?.stop.fingerprint)
    return record.execution!.failure.stop.fingerprint;
  if (record.execution!.openingGrantedAt !== undefined)
    return record.execution!.preparation!.candidate!.fingerprint;
  return undefined;
}

/** Enumerate every known image; caller authenticates even transitive inputs.
 * A completed cold output already contains all earlier negative evidence. */
function evidenceInputs(root: string, record: RestoreJobRecord) {
  const execution = record.execution!,
    retained = join(root, `restore-${record.intent.id}`),
    preparation = execution.preparation!,
    prepared = join(retained, `prepare-${preparation.slot}`);
  const original = input(
    join(retained, `freeze-${execution.freezeSlot}`, execution.frozen!.directory, 'frozen.sqlite'),
    execution.frozen!,
  );
  const base = [
    input(
      join(prepared, preparation.candidate!.directory, 'restored', 'spinel.sqlite'),
      preparation.candidate!,
    ),
    input(
      join(prepared, preparation.rollback!.directory, 'rollback.sqlite'),
      preparation.rollback!,
    ),
  ];
  const failed = execution.failure?.freeze;
  if (failed?.output)
    base.push(
      input(
        join(retained, `failed-freeze-${failed.slot}`, failed.output.directory, 'frozen.sqlite'),
        failed.output,
      ),
    );
  if (execution.rollback?.image)
    base.push(
      input(
        join(
          retained,
          `original-${execution.rollback.slot}`,
          execution.rollback.image.directory,
          'rollback.sqlite',
        ),
        execution.rollback.image,
      ),
    );
  const known: ClosedRestoreInput[] = [...base],
    accumulated: ClosedRestoreInput[] = [];
  let lastWasFrozen = false;
  for (const attempt of record.recovery!.attempts) {
    const directory = join(retained, `cold-${attempt.slot}`);
    if (attempt.frozen) {
      const frozen = input(
        join(directory, 'negative', attempt.frozen.directory, 'frozen.sqlite'),
        attempt.frozen,
      );
      known.push(frozen);
      // Several interrupted preparations may observe the same still-closed
      // trial. Keep only the latest observation with that exact fingerprint.
      if (lastWasFrozen) accumulated.pop();
      accumulated.push(frozen);
      lastWasFrozen = true;
    }
    if (attempt.image) {
      const image = input(
        join(directory, 'work', attempt.image.directory, 'rollback.sqlite'),
        attempt.image,
      );
      known.push(image);
      accumulated.splice(0, accumulated.length, image);
      lastWasFrozen = false;
    }
  }
  return { original, known, additional: [...base, ...accumulated] };
}

/** Cold authority is supplied by the owning supervisor, never by restored
 * credentials. Content reconciliation and the installer are the same as the
 * in-flight original path; only custody and authorization differ. */
export async function prepareColdRestoreOriginal(options: {
  jobs: RestoreJobs;
  record: RestoreJobRecord;
  root: string;
  databasePath: string;
  now(): number;
  signal: AbortSignal;
  assertClosed(): void;
}): Promise<RestoreJobRecord> {
  const { jobs, root, databasePath, signal } = options;
  let record = structuredClone(options.record);
  const initial = currentRestoreRecovery(record)!;
  if (!initial || initial.phase !== 'original-capture-planned')
    throw new Error('Cold recovery has no fresh journaled grant.');
  const { slot, deadline } = initial;
  const assertAuthorized = () => {
    signal.throwIfAborted();
    const now = options.now();
    if (
      !Number.isSafeInteger(now) ||
      now < record.updatedAt ||
      now >= deadline ||
      Date.now() >= deadline
    )
      throw new Error('Cold recovery authority or durable evidence changed.');
  };
  const active = () => {
    assertAuthorized();
    if (!isDeepStrictEqual(jobs.read(record.intent.id), record))
      throw new Error('Cold recovery durable evidence changed.');
    options.assertClosed();
    assertAuthorized();
  };
  const step = async <T>(action: () => Promise<T>) => {
    active();
    let result: T;
    try {
      result = await action();
    } catch (error) {
      try {
        active();
      } catch (postcheck) {
        throw new AggregateError(
          [error, postcheck],
          'Cold recovery operation and authorization postcheck failed.',
          { cause: error },
        );
      }
      throw error;
    }
    active();
    return result;
  };
  const checkpoint = (
    phase: Parameters<RestoreJobs['checkpointOriginalRecovery']>[3],
    patch = {},
  ) => {
    active();
    record = jobs.checkpointOriginalRecovery(
      record.intent.id,
      record.intentHash,
      record.revision,
      phase,
      patch,
    );
    active();
  };
  const custody = {
    root,
    databasePath,
    id: record.intent.id,
    captureId: slot,
    identity: record.intent.target.identity,
    assertClosed: active,
    signal,
    deadline,
    assertAuthorized,
  };
  const captured = await step(() => captureColdRestoreCustody(custody));
  checkpoint('original-custody-planned', { custody: captured });
  await step(() => preserveColdRestoreCustody(custody, captured));
  checkpoint('original-custody-retained');
  const retained = join(root, `restore-${record.intent.id}`),
    directory = join(retained, `cold-${slot}`),
    fingerprint = interruptedTrialFingerprint(record);
  let frozen: Image | undefined;
  const remaining = () =>
    Math.max(1, Math.min(600_000, deadline - Date.now(), deadline - options.now()));
  if (fingerprint) {
    const stagingRoot = join(directory, 'negative');
    active();
    mkdirSync(stagingRoot, { mode: 0o700 });
    await step(() => syncRestoreDirectory(directory, signal));
    const result = await step(() =>
      freezeCurrentRestore({
        ...coldRestoreCustodyInputs(root, captured),
        fingerprint,
        stagingRoot,
        timeoutMs: remaining(),
        signal,
      }),
    );
    if (
      dirname(dirname(result.databasePath)) !== stagingRoot ||
      basename(result.databasePath) !== 'frozen.sqlite'
    )
      throw new Error('Cold recovery evidence escaped its reserved slot.');
    await step(() => syncRestoreDirectory(stagingRoot, signal));
    frozen = {
      directory: basename(dirname(result.databasePath)),
      bytes: result.databaseBytes,
      sha256: result.databaseSha256,
      fingerprint: result.fingerprint,
    };
  }
  checkpoint('original-evidence-ready', frozen ? { frozen } : {});
  const evidence = evidenceInputs(root, record);
  for (const source of [evidence.original, ...evidence.known])
    await step(() => verifyClosedRestoreInput(source, signal));
  checkpoint('original-preparation-planned');
  const stagingRoot = join(directory, 'work');
  mkdirSync(stagingRoot, { mode: 0o700 });
  await step(() => syncRestoreDirectory(directory, signal));
  const output = await step(() =>
    prepareRestoreRollback({
      current: { ...evidence.original, fingerprint: record.execution!.stop!.fingerprint! },
      additional: evidence.additional,
      stagingRoot,
      spacesEnabled: record.intent.policy.spacesEnabled,
      now: initial.grantedAt,
      timeoutMs: remaining(),
      signal,
    }),
  );
  if (
    output.originalFingerprint !== record.execution!.stop!.fingerprint ||
    dirname(dirname(output.databasePath)) !== stagingRoot ||
    basename(output.databasePath) !== 'rollback.sqlite'
  )
    throw new Error('Cold recovery lost its independently witnessed original.');
  await step(() => syncClosedRestoreInput(output, signal));
  await step(() => syncRestoreDirectory(stagingRoot, signal));
  checkpoint('original-prepared', {
    image: {
      directory: basename(dirname(output.databasePath)),
      bytes: output.databaseBytes,
      sha256: output.databaseSha256,
      fingerprint: output.logicalFingerprint,
    },
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
  checkpoint('original-rehearsed', { rehearsedAt: options.now() });
  checkpoint('original-activation-planned');
  const files = {
    ...record.execution!.originals!,
    candidate: { bytes: output.databaseBytes, sha256: output.databaseSha256 },
  };
  const readPhase = (): RestoreFilePhase | undefined => {
    assertAuthorized();
    const phase = restoreJobPhase(record);
    if (phase === 'original-activation-planned' || phase === 'original-staged') return undefined;
    if (phase === 'original-replacing') return 'rolling-back';
    if (phase === 'original-activated') return 'rolled-back';
    throw new Error('Cold recovery cannot replace a committed generation.');
  };
  const control: RestoreFileControl = {
    root,
    databasePath,
    signal,
    deadline,
    assertAuthorized,
    assertClosed: active,
    readPhase,
    persist: async (phase) => {
      if (phase === 'rolling-back') checkpoint('original-replacing');
      else if (phase === 'rolled-back') checkpoint('original-activated');
      else throw new Error('Unexpected cold recovery file transition.');
    },
  };
  await step(() =>
    stagePreparedRestoreOriginal(
      control,
      files,
      captured,
      initial.attempt.attemptId,
      output.databasePath,
    ),
  );
  checkpoint('original-staged');
  await step(() =>
    activatePreparedRestoreOriginal(control, files, captured, initial.attempt.attemptId),
  );
  await step(() => verifyClosedRestoreInput({ ...output, databasePath }, signal));
  return record;
}
