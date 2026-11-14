import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  canonicalDatabasePath,
  fileIdentity,
  processIdentity,
  sameFile,
  workspaceOwnershipRoles,
} from './journal.ts';
import type { FileIdentity, ProcessIdentity, WorkspaceOwnership } from './journal.ts';
import type { RestoreJobIntent } from './restore-job-intent.ts';
import { restoreBarrierPath } from './restore-barrier.ts';
import { verifyClosedRestoreInput } from '../backup/restore-input.ts';

/** Private parent-to-child authorization. The supervisor must durably record this
 * exact attempt/process before handing over any workspace listeners. */
export interface RestoreTrialPermit {
  version: 1;
  jobId: string;
  intentHash: string;
  attemptId: string;
  role: 'candidate' | 'original';
  nonce: string;
  child: ProcessIdentity;
  generationId: string;
  epoch: string;
  databasePath: string;
  identity: FileIdentity;
  output: { bytes: number; sha256: string; fingerprint: string };
  policy: RestoreJobIntent['policy'];
  maximumBytes: number;
  deadline: number;
}
const refused = () => new Error('Restore trial opening is unavailable or changed.');
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const path = (v: unknown) =>
  typeof v === 'string' &&
  !v.includes('\0') &&
  Buffer.byteLength(v) <= 4096 &&
  isAbsolute(v) &&
  resolve(v) === v;
const identity = (v: unknown): v is FileIdentity =>
  shape(v, ['device', 'inode']) &&
  [v.device, v.inode].every((n) => typeof n === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(n));

export function validRestoreTrialPermit(v: unknown): v is RestoreTrialPermit {
  if (
    !shape(v, [
      'version',
      'jobId',
      'intentHash',
      'attemptId',
      'role',
      'nonce',
      'child',
      'generationId',
      'epoch',
      'databasePath',
      'identity',
      'output',
      'policy',
      'maximumBytes',
      'deadline',
    ]) ||
    v.version !== 1 ||
    ![v.jobId, v.attemptId, v.nonce, v.generationId, v.epoch].every(uuid) ||
    !hash(v.intentHash) ||
    (v.role !== 'candidate' && v.role !== 'original') ||
    !path(v.databasePath) ||
    !identity(v.identity) ||
    !shape(v.child, ['pid', 'start', 'boot', 'token']) ||
    !Number.isInteger(v.child.pid) ||
    Number(v.child.pid) <= 1 ||
    Number(v.child.pid) > 2 ** 31 - 1 ||
    typeof v.child.start !== 'string' ||
    !/^[0-9]{1,20}$/.test(v.child.start) ||
    !uuid(v.child.boot) ||
    !uuid(v.child.token) ||
    !shape(v.output, ['bytes', 'sha256', 'fingerprint']) ||
    !Number.isSafeInteger(v.output.bytes) ||
    Number(v.output.bytes) < 4096 ||
    !hash(v.output.sha256) ||
    !hash(v.output.fingerprint) ||
    !Number.isSafeInteger(v.maximumBytes) ||
    Number(v.maximumBytes) < Number(v.output.bytes) ||
    Number(v.maximumBytes) > 8 * 1024 ** 3 ||
    !Number.isSafeInteger(v.deadline) ||
    Number(v.deadline) <= 0 ||
    !shape(v.policy, [
      'origin',
      'image',
      'spacesEnabled',
      'staticDirectory',
      'consequencesVersion',
    ]) ||
    typeof v.policy.origin !== 'string' ||
    v.policy.origin.length > 2048 ||
    typeof v.policy.image !== 'string' ||
    v.policy.image.length > 1024 ||
    !/^(sha256:[a-f0-9]{64}|\S+@sha256:[a-f0-9]{64})$/.test(v.policy.image) ||
    typeof v.policy.spacesEnabled !== 'boolean' ||
    !path(v.policy.staticDirectory) ||
    v.policy.consequencesVersion !== 1
  )
    return false;
  try {
    return new URL(v.policy.origin).origin === v.policy.origin && /^https?:/.test(v.policy.origin);
  } catch {
    return false;
  }
}

/** A trial requires this exact private marker, not merely the presence of a file. */
function assertBarrier(permit: RestoreTrialPermit) {
  const marker = restoreBarrierPath(permit.databasePath);
  const fd = openSync(marker, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid!()) ||
      before.mode & 0o077n ||
      before.nlink < 1n ||
      before.nlink > 2n ||
      before.size < 1n ||
      before.size > 1024n
    )
      throw refused();
    const bytes = Buffer.alloc(1025);
    let count = 0;
    for (;;) {
      const read = readSync(fd, bytes, count, bytes.length - count, count);
      count += read;
      if (count > 1024) throw refused();
      if (!read) break;
    }
    if (BigInt(count) !== before.size) throw refused();
    const value: unknown = JSON.parse(bytes.subarray(0, count).toString('utf8'));
    if (
      !shape(value, ['version', 'operationId', 'identity']) ||
      value.version !== 1 ||
      value.operationId !== permit.jobId ||
      !identity(value.identity) ||
      !sameFile(value.identity, permit.identity)
    )
      throw refused();
    for (const after of [fstatSync(fd, { bigint: true }), lstatSync(marker, { bigint: true })])
      if (
        !after.isFile() ||
        ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'nlink'].some(
          (k) => before[k as keyof typeof before] !== after[k as keyof typeof after],
        )
      )
        throw refused();
  } finally {
    closeSync(fd);
  }
}

/** Recheck at every handoff boundary and immediately around first-open hashing.
 * A caller-supplied durable-stage assertion remains independently necessary. */
/** Historical file/barrier binding only. This grants no opening, execution or
 * release authority and intentionally does not require a live child/deadline. */
export function assertRestoreTrialEvidenceTarget(
  permit: RestoreTrialPermit,
  databasePath: string,
  databaseIdentity: FileIdentity,
) {
  if (
    !validRestoreTrialPermit(permit) ||
    databasePath !== permit.databasePath ||
    canonicalDatabasePath(permit.databasePath) !== permit.databasePath ||
    !sameFile(databaseIdentity, permit.identity) ||
    !sameFile(fileIdentity(permit.databasePath), permit.identity)
  )
    throw refused();
  assertBarrier(permit);
}
export function assertRestoreTrialTarget(
  permit: RestoreTrialPermit,
  databasePath: string,
  databaseIdentity: FileIdentity,
  pid: number,
) {
  const now = Date.now();
  if (
    !validRestoreTrialPermit(permit) ||
    now >= permit.deadline ||
    permit.deadline - now > 10 * 60_000 ||
    permit.child.pid !== pid ||
    (pid === process.pid && process.env.SPINEL_PROCESS_GROUP_TOKEN !== permit.child.token)
  )
    throw refused();
  assertRestoreTrialEvidenceTarget(permit, databasePath, databaseIdentity);
  const actual = processIdentity(pid, permit.child.token);
  if (
    !actual ||
    actual.pid !== permit.child.pid ||
    actual.start !== permit.child.start ||
    actual.boot !== permit.child.boot ||
    actual.token !== permit.child.token
  )
    throw refused();
  if (Date.now() >= permit.deadline) throw refused();
}
export function assertRestoreTrialBinding(
  permit: RestoreTrialPermit,
  ownership: WorkspaceOwnership,
  pid: number,
) {
  assertRestoreTrialTarget(permit, ownership.databasePath, ownership.databaseIdentity, pid);
  if (workspaceOwnershipRoles.some((role) => !ownership.handles[role]?.listening)) throw refused();
}

declare const openingBrand: unique symbol;
export interface RestoreOpening {
  readonly [openingBrand]: true;
}
let registered = false;
const openings = new WeakMap<
  object,
  { permit: RestoreTrialPermit; ownership: WorkspaceOwnership }
>();

/** Ownership receiver only, after all four exact kernel listeners are held.
 * The returned object never crosses IPC and cannot be recreated from JSON. */
export function registerRestoreOpening(
  permit: RestoreTrialPermit,
  ownership: WorkspaceOwnership,
): RestoreOpening {
  if (registered) throw refused();
  const snapshot = structuredClone(permit);
  assertRestoreTrialBinding(snapshot, ownership, process.pid);
  registered = true;
  const opening = Object.freeze({}) as RestoreOpening;
  openings.set(opening, { permit: snapshot, ownership });
  return opening;
}

/** Spend before asynchronous work; failure cannot rearm this process's attempt. */
export async function consumeRestoreOpening(
  opening: RestoreOpening,
  databasePath: string,
  policy: RestoreJobIntent['policy'],
): Promise<RestoreTrialPermit> {
  const binding = openings.get(opening);
  if (!binding) throw refused();
  openings.delete(opening);
  const { permit, ownership } = binding;
  if (
    databasePath !== permit.databasePath ||
    Object.keys(permit.policy).some(
      (k) => permit.policy[k as keyof typeof policy] !== policy[k as keyof typeof policy],
    )
  )
    throw refused();
  assertRestoreTrialBinding(permit, ownership, process.pid);
  const signal = AbortSignal.timeout(Math.max(1, permit.deadline - Date.now()));
  await verifyClosedRestoreInput(
    { databasePath, databaseBytes: permit.output.bytes, databaseSha256: permit.output.sha256 },
    signal,
  );
  assertRestoreTrialBinding(permit, ownership, process.pid);
  signal.throwIfAborted();
  return structuredClone(permit);
}

export interface RestoreTrialRelease {
  jobId: string;
  intentHash: string;
  attemptId: string;
  nonce: string;
  role: RestoreTrialPermit['role'];
  generationId: string;
  epoch: string;
}
export function restoreTrialReference(permit: RestoreTrialPermit): RestoreTrialRelease {
  return {
    jobId: permit.jobId,
    intentHash: permit.intentHash,
    attemptId: permit.attemptId,
    nonce: permit.nonce,
    role: permit.role,
    generationId: permit.generationId,
    epoch: permit.epoch,
  };
}
export function sameRestoreTrialReference(
  value: unknown,
  permit: RestoreTrialPermit,
): value is RestoreTrialRelease {
  const expected = restoreTrialReference(permit);
  return (
    shape(value, Object.keys(expected)) &&
    Object.entries(expected).every(([key, item]) => value[key] === item)
  );
}
