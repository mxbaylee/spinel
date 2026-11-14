import { RecoveryResourceError, isRecoveryResourceCode } from '../backup/resource-error.ts';

const preparationSteps = [
  'boundary',
  'deadline',
  'authority',
  'plan',
  'directory-create',
  'directory-sync',
  'retained-source',
  'candidate-reconcile',
  'candidate-publish',
  'rollback-prepare',
  'rollback-publish',
  'candidate-rehearse',
  'rollback-rehearse',
  'finish',
] as const;
export type RestorePreparationStep = (typeof preparationSteps)[number];
const phases = new Set([
  'accepted',
  'source-retained',
  'failed',
  'pause-planned',
  'paused',
  'stop-requested',
  'witness-accepted',
  'witnessed-stopped',
  'originals-planned',
  'originals-retained',
  'freeze-planned',
  'frozen',
  'preparation-planned',
  'candidate-prepared',
  'rollback-prepared',
  'candidate-rehearsed',
  'prepared',
  'activation-planned',
  'candidate-staged',
  'candidate-replacing',
  'candidate-activated',
  'trial-planned',
  'trial-opening',
  'trial-ready',
  'candidate-committed',
  'trial-stop-requested',
  'trial-witness-accepted',
  'trial-witnessed-stopped',
  'trial-capture-planned',
  'trial-custody-planned',
  'trial-custody-retained',
  'trial-freeze-planned',
  'trial-frozen',
  'original-preparation-planned',
  'original-prepared',
  'original-rehearsed',
  'original-activation-planned',
  'original-staged',
  'original-replacing',
  'original-activated',
  'original-trial-planned',
  'original-trial-opening',
  'original-trial-ready',
  'original-committed',
]);
const filesystemCodes = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EDQUOT',
  'EIO',
  'EBUSY',
  'EINVAL',
  'EEXIST',
]);
function safeCode(error: unknown): string {
  try {
    if (error instanceof RecoveryResourceError && isRecoveryResourceCode(error.code))
      return error.code;
    if (error instanceof Error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (typeof code === 'string' && filesystemCodes.has(code)) return code.toLowerCase();
      if (error.name === 'AbortError') return 'cancelled';
      if (error.name === 'TimeoutError') return 'time-limit';
    }
  } catch {
    /* Error accessors are untrusted diagnostic input too. */
  }
  return 'unknown';
}
/** Only fixed labels survive. In particular, do not retain the native cause,
 * message, stack, filename, SQL or recovered content in durable diagnostics. */
export class RestorePreparationFailure extends Error {
  readonly step: RestorePreparationStep | 'unknown';
  readonly code: string;
  constructor(step: RestorePreparationStep, error: unknown) {
    super('Restore preparation failed.');
    this.name = 'RestorePreparationFailure';
    this.step = preparationSteps.includes(step) ? step : 'unknown';
    this.code = safeCode(error);
  }
}
const preparationPhaseAliases: Record<string, string> = {
  'preparation-planned': 'prep-planned',
  'candidate-prepared': 'cand-prepared',
  'rollback-prepared': 'roll-prepared',
  'candidate-rehearsed': 'cand-rehearsed',
};
export function restoreExecutionFailureReason(phase: unknown, error: unknown): string {
  try {
    const stage = typeof phase === 'string' && phases.has(phase) ? phase : 'unknown';
    const wrapped = error instanceof RestorePreparationFailure;
    const step =
      wrapped && [...preparationSteps, 'unknown'].includes(error.step) ? error.step : 'unknown';
    const code =
      wrapped &&
      (isRecoveryResourceCode(error.code) ||
        [...filesystemCodes].some((value) => value.toLowerCase() === error.code) ||
        ['unknown', 'cancelled'].includes(error.code))
        ? error.code
        : safeCode(error);
    const value = wrapped
      ? `restore-${preparationPhaseAliases[stage] ?? stage}-${step}-${code}`
      : `restore-${stage}-${code}`;
    return /^[a-z-]{1,64}$/.test(value) ? value : 'restore-execution-unresolved';
  } catch {
    return 'restore-execution-unresolved';
  }
}
