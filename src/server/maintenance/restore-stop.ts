import type { RestoreStopRequest } from '../../shared/maintenance.ts';
import type { FileIdentity, ProcessIdentity } from './journal.ts';

export interface RestoreStopRecord {
  request: RestoreStopRequest;
  databaseIdentity: FileIdentity;
  child: ProcessIdentity;
  fingerprint: string | null;
  acceptedAt: number | null;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const validRestoreFingerprint = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function validRestoreStopRequest(value: unknown): value is RestoreStopRequest {
  return (
    record(value) &&
    Object.keys(value).length === 5 &&
    [value.jobId, value.challengeId, value.generationId, value.epoch].every(uuid) &&
    Number.isSafeInteger(value.deadline) &&
    Number(value.deadline) > 0
  );
}
export function sameRestoreStopRequest(a: RestoreStopRequest, b: RestoreStopRequest) {
  return (
    a.jobId === b.jobId &&
    a.challengeId === b.challengeId &&
    a.generationId === b.generationId &&
    a.epoch === b.epoch &&
    a.deadline === b.deadline
  );
}
export function validRestoreStopRecord(value: unknown): value is RestoreStopRecord {
  if (
    !record(value) ||
    Object.keys(value).length !== 5 ||
    !validRestoreStopRequest(value.request) ||
    !record(value.databaseIdentity) ||
    Object.keys(value.databaseIdentity).length !== 2 ||
    ![value.databaseIdentity.device, value.databaseIdentity.inode].every(
      (v) => typeof v === 'string' && /^\d+$/.test(v),
    ) ||
    !record(value.child) ||
    Object.keys(value.child).length !== 4 ||
    !Number.isInteger(value.child.pid) ||
    Number(value.child.pid) <= 1 ||
    typeof value.child.start !== 'string' ||
    !/^\d+$/.test(value.child.start) ||
    !uuid(value.child.boot) ||
    !uuid(value.child.token)
  )
    return false;
  return value.fingerprint === null
    ? value.acceptedAt === null
    : validRestoreFingerprint(value.fingerprint) &&
        Number.isSafeInteger(value.acceptedAt) &&
        Number(value.acceptedAt) > 0 &&
        Number(value.acceptedAt) <= value.request.deadline;
}
