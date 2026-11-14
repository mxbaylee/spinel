import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { verifyClosedRestoreInput } from '../backup/restore-input.ts';
import { activateRestoreFiles, stageRestoreCandidate } from './restore-files.ts';
import type { RestoreFiles, RestoreFilePhase } from './restore-files.ts';
import type { RestoreJobRecord, RestoreJobs } from './restore-jobs.ts';

/** Select and install the already-rehearsed candidate under the existing inode
 * and barrier. The original main generation stays selected and stopped; this
 * helper neither launches a child nor grants trial/public admission. Interrupted
 * attempts retain their one reservation and refuse automatic replay. */
export async function activateRestoreAttempt(options: {
  jobs: RestoreJobs;
  record: RestoreJobRecord;
  root: string;
  databasePath: string;
  now(): number;
  signal: AbortSignal;
  assertClosed(): void;
  deadline: number;
}): Promise<RestoreJobRecord> {
  const { jobs, root, databasePath, now, deadline } = options;
  if (
    !isAbsolute(root) ||
    resolve(root) !== root ||
    root.includes('\0') ||
    !Number.isSafeInteger(deadline) ||
    deadline <= Date.now()
  )
    throw new Error('Invalid restore activation boundary.');
  let record = structuredClone(options.record);
  let signal = options.signal;
  // File helpers invoke this at each I/O boundary. It deliberately avoids the
  // expensive full process/descriptor scan retained at orchestration boundaries.
  const assertAuthorized = () => {
    signal.throwIfAborted();
    const time = now();
    if (
      databasePath !== record.intent.target.databasePath ||
      !Number.isSafeInteger(time) ||
      time < record.updatedAt ||
      time >= record.intent.authority.expiresAt ||
      Date.now() >= deadline
    )
      throw new Error('The original restore activation boundary changed or expired.');
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
  record = jobs.planActivation(record.intent.id, record.intentHash, record.revision, {
    attemptId: randomUUID(),
    generationId: randomUUID(),
    epoch: randomUUID(),
    nonce: randomUUID(),
  });
  const budget = Math.min(
    600_000,
    deadline - Date.now(),
    record.intent.authority.expiresAt - now(),
  );
  if (!Number.isSafeInteger(budget) || budget <= 0)
    throw new Error('The original restore activation deadline expired.');
  signal = AbortSignal.any([signal, AbortSignal.timeout(budget)]);
  assertActive();
  const execution = record.execution!,
    preparation = execution.preparation!;
  const candidate = preparation.candidate!;
  const candidatePath = join(
    root,
    `restore-${record.intent.id}`,
    `prepare-${preparation.slot}`,
    candidate.directory,
    'restored',
    'spinel.sqlite',
  );
  const files: RestoreFiles = {
    ...structuredClone(execution.originals!),
    candidate: { bytes: candidate.bytes, sha256: candidate.sha256 },
  };
  const staged = await step(() =>
    stageRestoreCandidate(
      {
        root,
        databasePath,
        candidatePath,
        expectedCandidate: files.candidate,
        assertClosed: assertActive,
        assertAuthorized,
        signal,
        deadline,
      },
      execution.originals!,
    ),
  );
  if (!isDeepStrictEqual(staged, files)) throw new Error('Staged restore evidence changed.');
  record = jobs.markCandidateStaged(record.intent.id, record.intentHash, record.revision);
  assertActive();
  const readPhase = (): RestoreFilePhase | undefined => {
    const durable = jobs.read(record.intent.id);
    if (
      !durable ||
      durable.intentHash !== record.intentHash ||
      durable.revision !== record.revision ||
      !isDeepStrictEqual(durable.execution, record.execution)
    )
      throw new Error('Durable restore activation evidence changed.');
    if (durable.phase === 'candidate-staged') return undefined;
    if (durable.phase === 'candidate-replacing') return 'replacing';
    if (durable.phase === 'candidate-activated') return 'activated';
    throw new Error('The restore attempt is not eligible for candidate activation.');
  };
  await step(() =>
    activateRestoreFiles(
      {
        root,
        databasePath,
        signal,
        deadline,
        assertClosed: assertActive,
        assertAuthorized,
        readPhase,
        persist: async (phase) => {
          assertActive();
          if (phase === 'replacing')
            record = jobs.markCandidateReplacing(
              record.intent.id,
              record.intentHash,
              record.revision,
            );
          else if (phase === 'activated')
            record = jobs.markCandidateActivated(
              record.intent.id,
              record.intentHash,
              record.revision,
            );
          else throw new Error('Unexpected restore activation transition.');
          assertActive();
        },
      },
      files,
    ),
  );
  await step(() =>
    verifyClosedRestoreInput(
      {
        databasePath,
        databaseBytes: candidate.bytes,
        databaseSha256: candidate.sha256,
      },
      signal,
    ),
  );
  return record;
}
