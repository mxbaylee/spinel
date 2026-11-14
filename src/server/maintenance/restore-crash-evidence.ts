/** Safe receipts for the disposable Linux crash drill, never raw recovery journals. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecoveryJournalState } from './journal.ts';
import type { RestoreJobRecord } from './restore-jobs.ts';

export const restoreCrashCases = [
  'admission',
  'custody',
  'freeze',
  'activation-plan',
  'staging',
  'activation',
  'private-open',
  'commit',
  'postcommit',
  'original-activation',
  'original-commit',
  'cold-admission',
  'cold-prepared',
  'cold-activation',
  'cold-trial-planned',
  'cold-private-open',
  'cold-commit',
] as const;
export type RestoreCrashCase = (typeof restoreCrashCases)[number];
export interface CrashSource {
  head: string;
  tested: string;
  tree: string;
  run: string | null;
  attempt: string | null;
}
export function crashSource(): CrashSource {
  const tested = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  return {
    head: process.env.SPINEL_CRASH_EVIDENCE_HEAD ?? tested,
    tested,
    tree,
    run: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
}
export function crashFailure(error: unknown) {
  const name =
    error instanceof Error &&
    [
      'Error',
      'AssertionError',
      'AggregateError',
      'TypeError',
      'TimeoutError',
      'AbortError',
    ].includes(error.name)
      ? error.name
      : 'unclassified';
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['ENOENT', 'EACCES', 'EIO', 'ENOSPC', 'ECONNRESET', 'EPIPE', 'ERR_ASSERTION'].includes(
      String(error.code),
    )
      ? String(error.code)
      : null;
  return { name, code };
}
export function crashSnapshot(
  stage: 'cut' | 'cold-cut' | 'recovered' | 'completed',
  record: RestoreJobRecord,
  main: RecoveryJournalState,
  liveFingerprint: string | null = null,
) {
  const current = record.recovery?.attempts.at(-1);
  const child = main.child;
  const planned =
    current?.trial?.child ??
    record.execution?.rollback?.trial?.child ??
    record.execution?.trial?.child;
  return {
    stage,
    phase: current?.phase ?? record.phase,
    operationId: record.intent.id,
    intentHash: record.intentHash,
    generation: {
      original: record.intent.target.generationId,
      current: main.generationId,
      selected:
        current?.attempt.generationId ??
        record.execution?.rollback?.attempt?.generationId ??
        record.execution?.attempt?.generationId ??
        null,
    },
    fingerprints: {
      stopped: record.execution?.stop?.fingerprint ?? null,
      frozen: record.execution?.frozen?.fingerprint ?? null,
      frozenBoundary: record.execution?.frozen ? 'created' : 'not-created-at-this-journal-phase',
      preparedOriginal:
        current?.image?.fingerprint ?? record.execution?.rollback?.image?.fingerprint ?? null,
      outcome:
        current?.outcome?.fingerprint ??
        record.execution?.rollback?.outcome?.fingerprint ??
        record.execution?.outcome?.fingerprint ??
        null,
      live: liveFingerprint,
      liveBoundary: liveFingerprint ? 'closed-read-only-probe' : 'not-opened-at-this-boundary',
    },
    authority: {
      confirmedAt: record.intent.confirmedAt,
      originalExpiresAt: record.intent.authority.expiresAt,
      currentOperationMatches: main.operation?.id === record.intent.id,
      currentAuthority: main.operation
        ? main.operation.actorId === 'cold-host'
          ? 'private-host'
          : 'original-session'
        : 'none',
      currentExpiresAt: main.operation?.expiresAt ?? null,
      cold:
        record.recovery?.attempts.map((a) => ({
          grantedAt: a.grantedAt,
          deadline: a.deadline,
          priorGeneration: a.priorGenerationId,
          generation: a.attempt.generationId,
          bootEpoch: a.bootEpoch,
          phase: a.phase,
        })) ?? [],
    },
    plannedChild: planned ? { pid: planned.pid, boot: planned.boot, start: planned.start } : null,
    child: child ? { pid: child.pid, boot: child.boot, start: child.start } : null,
  };
}
export interface RestoreCrashReceipt {
  version: 1;
  case: RestoreCrashCase;
  source: CrashSource;
  result: 'failed' | 'passed';
  snapshots: ReturnType<typeof crashSnapshot>[];
  observedFrozen: string | null;
  controllers: Array<{
    pid: number | null;
    initial: boolean;
    cold: boolean;
    cleanup: boolean;
    exitCode: number | null;
    signal: string | null;
  }>;
  resources: Array<{ pid: number; boundary: 'cold-restart' | 'cold-recovered'; released: boolean }>;
  cuts: Array<{ name: string; pid: number; bytesWritten: number | null }>;
  terminations: Array<{
    pid: number;
    action: 'sigkill' | 'already-exited';
    signal: string | null;
    released: boolean;
  }>;
  primaryFailure: ReturnType<typeof crashFailure> | null;
  secondaryFailures: ReturnType<typeof crashFailure>[];
  cleanup: { closure: 'not-reached' | 'passed' | 'failed'; temporaryData: 'retained' | 'removed' };
}
export async function writeCrashReceipt(directory: string, receipt: RestoreCrashReceipt) {
  assert.ok(restoreCrashCases.includes(receipt.case));
  const bytes = JSON.stringify(receipt, null, 2) + '\n';
  assert.ok(Buffer.byteLength(bytes) <= 64 * 1024, 'Crash receipt exceeded its bound.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, receipt.case + '.json');
  await writeFile(path + '.pending', bytes, { flag: 'wx', mode: 0o600 });
  await rename(path + '.pending', path);
}
/** Persist before removing private data. Secondary failures never replace the original test error. */
export async function finishCrashReceipt(
  receipt: RestoreCrashReceipt,
  close: () => Promise<void>,
  remove: () => Promise<void>,
  persist: () => Promise<void>,
  primary?: { error: unknown },
) {
  const failures: unknown[] = [];
  const failed = (error: unknown) => {
    failures.push(error);
    receipt.secondaryFailures.push(crashFailure(error));
    receipt.result = 'failed';
  };
  receipt.primaryFailure = primary ? crashFailure(primary.error) : null;
  if (primary) receipt.result = 'failed';
  try {
    await close();
    receipt.cleanup.closure = 'passed';
  } catch (error) {
    receipt.cleanup.closure = 'failed';
    failed(error);
  }
  // The first receipt contains the actual test and closure outcome even if deletion fails.
  try {
    await persist();
  } catch (error) {
    failed(error);
  }
  if (!primary && !failures.length && receipt.result === 'passed') {
    try {
      await remove();
      receipt.cleanup.temporaryData = 'removed';
    } catch (error) {
      failed(error);
    }
    try {
      await persist();
    } catch (error) {
      failed(error);
    }
  }
  if (failures.length)
    throw new AggregateError(
      primary ? [primary.error, ...failures] : failures,
      'Crash receipt or cleanup failed; original failure preserved.',
      { cause: primary?.error ?? failures[0] },
    );
}
