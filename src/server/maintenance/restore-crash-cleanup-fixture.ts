/** Failure cleanup for the disposable restore crash harness, never a host command. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProcessIdentity } from './journal.ts';
import { processResourcesReleased } from './process-exit.ts';
import { currentRestoreRecovery, validRestoreJobRecord } from './restore-jobs.ts';
import type { MaintenanceSupervisor } from './supervisor.ts';

export async function cleanupPlannedRestoreTrial(
  supervisor: MaintenanceSupervisor,
  operationId: string,
) {
  assert.match(
    operationId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const { journal } = supervisor;
  let bytes: string;
  try {
    bytes = await readFile(join(journal.root, 'restore-jobs', operationId, 'state.json'), 'utf8');
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' &&
      journal.state.restoreJob?.jobId !== operationId
    )
      return;
    throw error;
  }
  const record = JSON.parse(bytes);
  assert.ok(
    validRestoreJobRecord(record, operationId),
    'Cleanup requires the exact valid restore record.',
  );
  const recovery = currentRestoreRecovery(record);
  if (recovery?.phase !== 'original-trial-planned') return;
  assert.equal(record.intent.target.databasePath, journal.databasePath);
  assert.deepEqual(journal.state.restoreJob, { jobId: operationId, intentHash: record.intentHash });
  assert.equal(journal.state.operation?.id, operationId);
  assert.equal(journal.state.child, null, 'Close the adopted child before planned-child cleanup.');
  assert.ok(
    [recovery.priorGenerationId, recovery.attempt.generationId].includes(
      journal.state.generationId,
    ),
  );
  assert.ok(recovery.trial);
  // Reuse production's boot/start/UID/session/token inventory and its bounded
  // TERM/KILL/descriptor closure. Do not recover/install content or grant authority.
  await (
    supervisor as unknown as {
      stopGroup(identity: ProcessIdentity): Promise<void>;
    }
  ).stopGroup(recovery.trial.child);
  assert.ok(
    processResourcesReleased(String(recovery.trial.child.pid)),
    'Planned child resources remain live.',
  );
  assert.equal(
    await readFile(join(journal.root, 'restore-jobs', operationId, 'state.json'), 'utf8'),
    bytes,
  );
}

export async function finishRestoreCrashCleanup(
  actions: Array<() => Promise<unknown>>,
  primary?: { error: unknown },
) {
  const failures: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(
      primary ? [primary.error, ...failures] : failures,
      'Restore crash cleanup failed; retained evidence was not removed.',
      { cause: primary ? primary.error : failures[0] },
    );
}
