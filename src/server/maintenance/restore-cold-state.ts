import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validColdRestoreCustody } from './restore-files.ts';
import type { ColdRestoreCustody } from './restore-files.ts';
import { validRestoreTrialPermit } from './restore-trial.ts';
import type { RestoreTrialPermit } from './restore-trial.ts';
import type { RestoreAttempt, RestoreJobRecord, RestorePreparedImage } from './restore-jobs.ts';

export const coldRecoveryPhases = [
  'original-capture-planned',
  'original-custody-planned',
  'original-custody-retained',
  'original-evidence-ready',
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
] as const;
export type ColdRecoveryPhase = (typeof coldRecoveryPhases)[number];
export interface ColdRecoveryAttempt {
  slot: string;
  grantedAt: number;
  deadline: number;
  bootEpoch: string;
  priorGenerationId: string;
  phase: ColdRecoveryPhase;
  attempt: RestoreAttempt;
  /** Each retired grant retains its own final authorized time. */
  updatedAt: number;
  custody?: ColdRestoreCustody;
  frozen?: { directory: string; bytes: number; sha256: string; fingerprint: string };
  image?: RestorePreparedImage;
  rehearsedAt?: number;
  trial?: RestoreTrialPermit;
  openingGrantedAt?: number;
  readiness?: { fingerprint: string; acceptedAt: number };
  outcome?: { role: 'original'; fingerprint: string; committedAt: number };
}
export interface RestoreColdRecovery {
  sourceRevision: number;
  sourceUpdatedAt: number;
  attempts: ColdRecoveryAttempt[];
}
export type ColdRecoveryGrant = Pick<
  ColdRecoveryAttempt,
  'slot' | 'grantedAt' | 'deadline' | 'bootEpoch' | 'priorGenerationId' | 'attempt'
>;
export type ColdRecoveryPatch = Partial<
  Pick<
    ColdRecoveryAttempt,
    | 'custody'
    | 'frozen'
    | 'image'
    | 'rehearsedAt'
    | 'trial'
    | 'openingGrantedAt'
    | 'readiness'
    | 'outcome'
  >
>;

const shape = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const sameFile = (a: { device: string; inode: string }, b: { device: string; inode: string }) =>
  a.device === b.device && a.inode === b.inode;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function currentRestoreRecovery(record: RestoreJobRecord) {
  return record.recovery?.attempts.at(-1);
}
export function restoreJobPhase(record: RestoreJobRecord) {
  return currentRestoreRecovery(record)?.phase ?? record.phase;
}
export function restoreJobDeadline(record: RestoreJobRecord) {
  return currentRestoreRecovery(record)?.deadline ?? record.intent.authority.expiresAt;
}
export function restoreJobOperation(record: RestoreJobRecord) {
  const recovery = currentRestoreRecovery(record);
  return recovery
    ? {
        actorId: 'cold-host',
        sessionHash: '0'.repeat(64),
        expiresAt: recovery.deadline,
        tokenHash: createHash('sha256')
          .update(`spinel-cold-original:${recovery.slot}`)
          .digest('hex'),
      }
    : {
        actorId: record.intent.authority.actorId,
        sessionHash: record.intent.authority.sessionHash,
        expiresAt: record.intent.authority.expiresAt,
        tokenHash: record.intent.continuationHash,
      };
}

/** The historical checkpoint remains authoritative about which generation could
 * have opened. A boot rotates only the epoch, not this durable selection. */
export function coldRecoveryPriorGenerations(
  record: RestoreJobRecord,
  attempts: readonly ColdRecoveryAttempt[] = record.recovery?.attempts ?? [],
): string[] {
  const previous = attempts.at(-1);
  if (previous) {
    const stage = coldRecoveryPhases.indexOf(previous.phase);
    if (stage < 0 || previous.phase === 'original-committed') return [];
    if (stage < coldRecoveryPhases.indexOf('original-trial-planned'))
      return [previous.priorGenerationId];
    return previous.phase === 'original-trial-planned'
      ? [previous.priorGenerationId, previous.attempt.generationId]
      : [previous.attempt.generationId];
  }
  const plan = record.execution;
  if (
    !plan?.originals ||
    !plan.frozen ||
    !plan.preparation?.candidate ||
    !plan.preparation.rollback
  )
    return [];
  if (record.phase === 'candidate-replacing' || record.phase === 'candidate-activated')
    return [record.intent.target.generationId];
  if (record.phase === 'trial-planned')
    return [record.intent.target.generationId, plan.attempt!.generationId];
  if (['original-trial-opening', 'original-trial-ready'].includes(record.phase))
    return [plan.rollback!.attempt!.generationId];
  if (record.phase === 'original-trial-planned')
    return [plan.attempt!.generationId, plan.rollback!.attempt!.generationId];
  if (
    record.phase === 'trial-opening' ||
    record.phase === 'trial-ready' ||
    record.phase.startsWith('trial-stop-') ||
    record.phase.startsWith('trial-witness') ||
    record.phase.startsWith('trial-capture-') ||
    record.phase.startsWith('trial-custody-') ||
    record.phase.startsWith('trial-freeze-') ||
    record.phase === 'trial-frozen' ||
    (record.phase.startsWith('original-') && record.phase !== 'original-committed')
  )
    return [plan.attempt!.generationId];
  return [];
}

function image(value: unknown, kind: 'frozen' | 'rollback'): value is RestorePreparedImage {
  return (
    shape(value, ['directory', 'bytes', 'sha256', 'fingerprint']) &&
    typeof value.directory === 'string' &&
    new RegExp(`^\\.restore-${kind}-[A-Za-z0-9]{6}$`).test(value.directory) &&
    Number.isSafeInteger(value.bytes) &&
    Number(value.bytes) >= 4096 &&
    Number(value.bytes) <= 8 * 1024 ** 3 &&
    hash(value.sha256) &&
    hash(value.fingerprint)
  );
}

/** Validates historical grants at their own timestamps; this does not authorize
 * current execution. The caller first validates the unchanged source record. */
export function validRestoreColdRecovery(record: RestoreJobRecord): boolean {
  const recovery = record.recovery;
  if (
    !shape(recovery, ['sourceRevision', 'sourceUpdatedAt', 'attempts']) ||
    !Number.isSafeInteger(recovery.sourceRevision) ||
    Number(recovery.sourceRevision) < 0 ||
    Number(recovery.sourceRevision) >= record.revision ||
    !Number.isSafeInteger(recovery.sourceUpdatedAt) ||
    Number(recovery.sourceUpdatedAt) > record.updatedAt ||
    !Array.isArray(recovery.attempts) ||
    recovery.attempts.length < 1 ||
    recovery.attempts.length > 8 ||
    !coldRecoveryPriorGenerations(record, []).length
  )
    return false;
  const plan = record.execution!;
  const used = new Set(
    [
      record.intent.id,
      record.intent.target.instanceId,
      record.intent.target.generationId,
      record.intent.target.epoch,
      plan.epoch,
      plan.child.token,
      plan.freezeSlot,
      plan.preparation!.slot,
      plan.trial?.child.token,
      plan.failure?.capture?.slot,
      plan.failure?.freeze?.slot,
      plan.rollback?.slot,
      plan.rollback?.trial?.child.token,
      ...Object.values(plan.attempt!),
      ...Object.values(plan.rollback?.attempt ?? {}),
    ].filter((value): value is string => typeof value === 'string'),
  );
  const attempts = recovery.attempts as ColdRecoveryAttempt[];
  let previousTime = Number(recovery.sourceUpdatedAt);
  let expectedRevision = Number(recovery.sourceRevision);
  for (const [index, attempt] of attempts.entries()) {
    if (!attempt || typeof attempt !== 'object') return false;
    const stage = coldRecoveryPhases.indexOf(attempt.phase);
    const has = (phase: ColdRecoveryPhase) => stage >= coldRecoveryPhases.indexOf(phase);
    const keys = [
      'slot',
      'grantedAt',
      'deadline',
      'bootEpoch',
      'priorGenerationId',
      'phase',
      'attempt',
      'updatedAt',
    ];
    if (has('original-custody-planned')) keys.push('custody');
    if (Object.hasOwn(attempt, 'frozen')) keys.push('frozen');
    if (has('original-prepared')) keys.push('image');
    if (has('original-rehearsed')) keys.push('rehearsedAt');
    if (has('original-trial-planned')) keys.push('trial');
    if (has('original-trial-opening')) keys.push('openingGrantedAt');
    if (has('original-trial-ready')) keys.push('readiness');
    if (has('original-committed')) keys.push('outcome');
    if (
      stage < 0 ||
      !shape(attempt, keys) ||
      !uuid(attempt.slot) ||
      used.has(attempt.slot) ||
      !uuid(attempt.bootEpoch) ||
      !uuid(attempt.priorGenerationId) ||
      attempt.slot === attempt.bootEpoch ||
      attempt.slot === attempt.priorGenerationId ||
      !coldRecoveryPriorGenerations(record, attempts.slice(0, index)).includes(
        attempt.priorGenerationId,
      ) ||
      !Number.isSafeInteger(attempt.grantedAt) ||
      attempt.grantedAt < previousTime ||
      !Number.isSafeInteger(attempt.updatedAt) ||
      attempt.updatedAt < attempt.grantedAt ||
      !Number.isSafeInteger(attempt.deadline) ||
      attempt.deadline <= attempt.updatedAt ||
      attempt.deadline - attempt.grantedAt > 600_000 ||
      (index < attempts.length - 1 && attempt.phase === 'original-committed') ||
      !shape(attempt.attempt, ['attemptId', 'generationId', 'epoch', 'nonce'])
    )
      return false;
    used.add(attempt.bootEpoch);
    used.add(attempt.slot);
    for (const value of Object.values(attempt.attempt)) {
      if (
        !uuid(value) ||
        used.has(value) ||
        value === attempt.bootEpoch ||
        value === attempt.priorGenerationId
      )
        return false;
      used.add(value);
    }
    if (
      has('original-custody-planned') &&
      (!validColdRestoreCustody(attempt.custody) ||
        attempt.custody.jobId !== record.intent.id ||
        attempt.custody.captureId !== attempt.slot ||
        !sameFile(attempt.custody.identity, record.intent.target.identity))
    )
      return false;
    if (
      Object.hasOwn(attempt, 'frozen') &&
      (!has('original-evidence-ready') || !image(attempt.frozen, 'frozen'))
    )
      return false;
    if (has('original-prepared') && !image(attempt.image, 'rollback')) return false;
    if (
      has('original-rehearsed') &&
      (!Number.isSafeInteger(attempt.rehearsedAt) ||
        attempt.rehearsedAt! < attempt.grantedAt ||
        attempt.rehearsedAt! > attempt.updatedAt)
    )
      return false;
    if (has('original-trial-planned')) {
      const permit = attempt.trial;
      if (
        !validRestoreTrialPermit(permit) ||
        permit.role !== 'original' ||
        permit.jobId !== record.intent.id ||
        permit.intentHash !== record.intentHash ||
        !Object.entries(attempt.attempt).every(
          ([key, value]) => permit[key as keyof RestoreTrialPermit] === value,
        ) ||
        permit.databasePath !== record.intent.target.databasePath ||
        !sameFile(permit.identity, record.intent.target.identity) ||
        !isDeepStrictEqual(permit.policy, record.intent.policy) ||
        permit.output.bytes !== attempt.image!.bytes ||
        permit.output.sha256 !== attempt.image!.sha256 ||
        permit.output.fingerprint !== attempt.image!.fingerprint ||
        permit.deadline > attempt.deadline ||
        permit.deadline <= attempt.updatedAt ||
        used.has(permit.child.token)
      )
        return false;
      used.add(permit.child.token);
    }
    if (
      has('original-trial-opening') &&
      (!Number.isSafeInteger(attempt.openingGrantedAt) ||
        attempt.openingGrantedAt! < attempt.rehearsedAt! ||
        attempt.openingGrantedAt! > attempt.updatedAt)
    )
      return false;
    if (
      has('original-trial-ready') &&
      (!shape(attempt.readiness, ['fingerprint', 'acceptedAt']) ||
        attempt.readiness.fingerprint !== attempt.image!.fingerprint ||
        !Number.isSafeInteger(attempt.readiness.acceptedAt) ||
        Number(attempt.readiness.acceptedAt) < attempt.openingGrantedAt! ||
        Number(attempt.readiness.acceptedAt) > attempt.updatedAt)
    )
      return false;
    if (
      has('original-committed') &&
      (!shape(attempt.outcome, ['role', 'fingerprint', 'committedAt']) ||
        attempt.outcome.role !== 'original' ||
        attempt.outcome.fingerprint !== attempt.image!.fingerprint ||
        !Number.isSafeInteger(attempt.outcome.committedAt) ||
        Number(attempt.outcome.committedAt) < attempt.readiness!.acceptedAt ||
        Number(attempt.outcome.committedAt) > attempt.updatedAt)
    )
      return false;
    previousTime = attempt.updatedAt;
    expectedRevision += stage + 1;
  }
  return previousTime === record.updatedAt && expectedRevision === record.revision;
}
