import type { RestoreStopRequest } from '../../shared/maintenance.ts';
import type { ProcessIdentity } from './journal.ts';
import { sameRestoreStopRequest, validRestoreStopRequest } from './restore-stop.ts';
import { sameRestoreTrialReference } from './restore-trial.ts';
import type { RestoreTrialPermit, RestoreTrialRelease } from './restore-trial.ts';

/** Evidence-only shutdown of one privately opened attempt. Its fresh deadline
 * never renews the opening permit, original authority, or release capability. */
export interface RestoreTrialStopRequest {
  reference: RestoreTrialRelease;
  child: ProcessIdentity;
  request: RestoreStopRequest;
}
export const RESTORE_TRIAL_STOP_MS = 30_000;
const shape = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function validRestoreTrialStopRequest(value: unknown): value is RestoreTrialStopRequest {
  if (
    !shape(value, ['reference', 'child', 'request']) ||
    !validRestoreStopRequest(value.request) ||
    !shape(value.reference, [
      'jobId',
      'intentHash',
      'attemptId',
      'nonce',
      'role',
      'generationId',
      'epoch',
    ]) ||
    ![
      value.reference.jobId,
      value.reference.attemptId,
      value.reference.nonce,
      value.reference.generationId,
      value.reference.epoch,
    ].every(uuid) ||
    typeof value.reference.intentHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.reference.intentHash) ||
    (value.reference.role !== 'candidate' && value.reference.role !== 'original') ||
    value.reference.jobId !== value.request.jobId ||
    value.reference.generationId !== value.request.generationId ||
    value.reference.epoch !== value.request.epoch ||
    !shape(value.child, ['pid', 'start', 'boot', 'token']) ||
    !Number.isInteger(value.child.pid) ||
    Number(value.child.pid) <= 1 ||
    Number(value.child.pid) > 2 ** 31 - 1 ||
    typeof value.child.start !== 'string' ||
    !/^[0-9]{1,20}$/.test(value.child.start) ||
    !uuid(value.child.boot) ||
    !uuid(value.child.token)
  )
    return false;
  return true;
}
export function sameRestoreTrialStopRequest(
  a: RestoreTrialStopRequest,
  b: RestoreTrialStopRequest,
) {
  return (
    sameRestoreStopRequest(a.request, b.request) &&
    Object.entries(a.reference).every(
      ([key, value]) => b.reference[key as keyof RestoreTrialRelease] === value,
    ) &&
    Object.entries(a.child).every(([key, value]) => b.child[key as keyof ProcessIdentity] === value)
  );
}
export function matchesRestoreTrialStop(stop: RestoreTrialStopRequest, permit: RestoreTrialPermit) {
  return (
    validRestoreTrialStopRequest(stop) &&
    sameRestoreTrialReference(stop.reference, permit) &&
    Object.entries(permit.child).every(
      ([key, value]) => stop.child[key as keyof ProcessIdentity] === value,
    )
  );
}
