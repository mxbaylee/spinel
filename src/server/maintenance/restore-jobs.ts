import { randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  opendirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { sameFile } from './journal.ts';
import {
  validRestoreTrialPermit,
  sameRestoreTrialReference,
  assertRestoreTrialTarget,
} from './restore-trial.ts';
import type { RestoreTrialPermit, RestoreTrialRelease } from './restore-trial.ts';
import type { ProcessIdentity, RecoveryJournal } from './journal.ts';
import { sameRestoreStopRequest, validRestoreStopRecord } from './restore-stop.ts';
import type { RestoreStopRecord } from './restore-stop.ts';
import { validRestoreOriginals } from './restore-files.ts';
import type { RestoreOriginals } from './restore-files.ts';
import { restoreIntentHash, validRestoreJobIntent } from './restore-job-intent.ts';
import type { RestoreJobIntent } from './restore-job-intent.ts';

/** Closed prepared image inside the one durable preparation slot. The record
 * never accepts an arbitrary output path or permission to activate it. */
export interface RestorePreparedImage {
  directory: string;
  bytes: number;
  sha256: string;
  fingerprint: string;
}
export interface RestorePreparation {
  slot: string;
  preparedAt: number;
  candidate?: RestorePreparedImage;
  rollback?: RestorePreparedImage;
}
export interface RestoreAttempt {
  attemptId: string;
  generationId: string;
  epoch: string;
  nonce: string;
}
/** Durable original shutdown/preparation evidence. This store never opens SQLite. */
export interface RestorePausePlan {
  epoch: string;
  child: ProcessIdentity;
  stop: RestoreStopRecord | null;
  requestedAt: number | null;
  originals?: RestoreOriginals;
  freezeSlot?: string;
  frozen?: { directory: string; bytes: number; sha256: string; fingerprint: string };
  preparation?: RestorePreparation;
  attempt?: RestoreAttempt;
  trial?: RestoreTrialPermit;
  readiness?: { fingerprint: string; acceptedAt: number };
  outcome?: { role: 'candidate'; fingerprint: string; committedAt: number };
}
type ExecutionPhase =
  | 'pause-planned'
  | 'paused'
  | 'stop-requested'
  | 'witness-accepted'
  | 'witnessed-stopped'
  | 'originals-planned'
  | 'originals-retained'
  | 'freeze-planned'
  | 'frozen'
  | 'preparation-planned'
  | 'candidate-prepared'
  | 'rollback-prepared'
  | 'candidate-rehearsed'
  | 'prepared'
  | 'activation-planned'
  | 'candidate-staged'
  | 'candidate-replacing'
  | 'candidate-activated'
  | 'trial-planned'
  | 'trial-ready'
  | 'candidate-committed';
export interface RestoreJobRecord {
  version: 1;
  revision: number;
  intent: RestoreJobIntent;
  intentHash: string;
  phase: 'accepted' | 'source-retained' | 'failed' | ExecutionPhase;
  execution?: RestorePausePlan;
  updatedAt: number;
}
const MAX_JOB_BYTES = 64 * 1024;
const MAX_JOBS = 64;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const refused = () => new Error('Restore job custody is unavailable or changed.');
const executionPhases: readonly string[] = [
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
  'trial-ready',
  'candidate-committed',
];
const sameProcess = (a: ProcessIdentity | null, b: ProcessIdentity) =>
  !!a && a.pid === b.pid && a.start === b.start && a.boot === b.boot && a.token === b.token;
const sameStop = (a: RestoreStopRecord | null | undefined, b: RestoreStopRecord) =>
  !!a &&
  sameRestoreStopRequest(a.request, b.request) &&
  sameFile(a.databaseIdentity, b.databaseIdentity) &&
  sameProcess(a.child, b.child) &&
  a.fingerprint === b.fingerprint &&
  a.acceptedAt === b.acceptedAt;
function validPreparedImage(
  value: unknown,
  kind: 'reconciled' | 'rollback',
): value is RestorePreparedImage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const image = value as RestorePreparedImage;
  return (
    Object.keys(image).length === 4 &&
    typeof image.directory === 'string' &&
    new RegExp(`^\\.restore-${kind}-[A-Za-z0-9]{6}$`).test(image.directory) &&
    Number.isSafeInteger(image.bytes) &&
    image.bytes >= 4096 &&
    image.bytes <= 8 * 1024 ** 3 &&
    typeof image.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(image.sha256) &&
    typeof image.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(image.fingerprint)
  );
}
function validExecution(record: RestoreJobRecord) {
  if (!executionPhases.includes(record.phase)) return !Object.hasOwn(record, 'execution');
  const plan = record.execution;
  const stage = executionPhases.indexOf(record.phase);
  const hasOriginals = stage >= executionPhases.indexOf('originals-planned');
  const hasSlot = stage >= executionPhases.indexOf('freeze-planned');
  const hasFrozen = stage >= executionPhases.indexOf('frozen');
  const hasPreparation = stage >= executionPhases.indexOf('preparation-planned');
  const hasAttempt = stage >= executionPhases.indexOf('activation-planned');
  const hasTrial = stage >= executionPhases.indexOf('trial-planned');
  const hasReadiness = stage >= executionPhases.indexOf('trial-ready');
  const hasOutcome = record.phase === 'candidate-committed';
  if (
    !plan ||
    Object.keys(plan).length !==
      4 +
        Number(hasOriginals) +
        Number(hasSlot) +
        Number(hasFrozen) +
        Number(hasPreparation) +
        Number(hasAttempt) +
        Number(hasTrial) +
        Number(hasReadiness) +
        Number(hasOutcome) ||
    typeof plan.epoch !== 'string' ||
    !uuid.test(plan.epoch) ||
    plan.epoch === record.intent.target.epoch ||
    !plan.child ||
    Object.keys(plan.child).length !== 4 ||
    !Number.isInteger(plan.child.pid) ||
    plan.child.pid <= 1 ||
    plan.child.pid > 2147483647 ||
    typeof plan.child.start !== 'string' ||
    !/^\d{1,20}$/.test(plan.child.start) ||
    typeof plan.child.boot !== 'string' ||
    !uuid.test(plan.child.boot) ||
    typeof plan.child.token !== 'string' ||
    !uuid.test(plan.child.token)
  )
    return false;
  if (
    hasOriginals &&
    (!validRestoreOriginals(plan.originals) ||
      plan.originals.id !== record.intent.id ||
      !sameFile(plan.originals.identity, record.intent.target.identity))
  )
    return false;
  if (hasSlot && (typeof plan.freezeSlot !== 'string' || !uuid.test(plan.freezeSlot))) return false;
  if (hasFrozen) {
    const frozen = plan.frozen;
    if (
      !frozen ||
      Object.keys(frozen).length !== 4 ||
      typeof frozen.directory !== 'string' ||
      !/^\.restore-frozen-[A-Za-z0-9]{6}$/.test(frozen.directory) ||
      !Number.isSafeInteger(frozen.bytes) ||
      frozen.bytes < 4096 ||
      frozen.bytes > 8 * 1024 ** 3 ||
      typeof frozen.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(frozen.sha256) ||
      frozen.fingerprint !== plan.stop?.fingerprint
    )
      return false;
  }
  if (hasPreparation) {
    const preparation = plan.preparation;
    const hasCandidate = stage >= executionPhases.indexOf('candidate-prepared');
    const hasRollback = stage >= executionPhases.indexOf('rollback-prepared');
    if (
      !preparation ||
      Object.keys(preparation).length !== 2 + Number(hasCandidate) + Number(hasRollback) ||
      typeof preparation.slot !== 'string' ||
      !uuid.test(preparation.slot) ||
      preparation.slot === plan.freezeSlot ||
      !Number.isSafeInteger(preparation.preparedAt) ||
      preparation.preparedAt < record.intent.confirmedAt ||
      preparation.preparedAt < (plan.stop?.acceptedAt ?? Infinity) ||
      preparation.preparedAt > record.updatedAt ||
      preparation.preparedAt >= record.intent.authority.expiresAt ||
      record.updatedAt >= record.intent.authority.expiresAt ||
      (hasCandidate && !validPreparedImage(preparation.candidate, 'reconciled')) ||
      (hasRollback && !validPreparedImage(preparation.rollback, 'rollback'))
    )
      return false;
  }
  if (hasAttempt) {
    const attempt = plan.attempt;
    if (
      !attempt ||
      Object.keys(attempt).length !== 4 ||
      ![attempt.attemptId, attempt.generationId, attempt.epoch, attempt.nonce].every(
        (value) => typeof value === 'string' && uuid.test(value),
      ) ||
      new Set(Object.values(attempt)).size !== 4 ||
      Object.values(attempt).some((value) =>
        [
          record.intent.id,
          record.intent.target.generationId,
          record.intent.target.epoch,
          plan.epoch,
          plan.child.token,
          plan.preparation!.slot,
          plan.freezeSlot,
        ].includes(value),
      )
    )
      return false;
  }
  if (hasTrial) {
    const permit = plan.trial,
      attempt = plan.attempt!,
      candidate = plan.preparation!.candidate!;
    if (
      !validRestoreTrialPermit(permit) ||
      permit.role !== 'candidate' ||
      permit.jobId !== record.intent.id ||
      permit.intentHash !== record.intentHash ||
      permit.attemptId !== attempt.attemptId ||
      permit.generationId !== attempt.generationId ||
      permit.epoch !== attempt.epoch ||
      permit.nonce !== attempt.nonce ||
      permit.databasePath !== record.intent.target.databasePath ||
      !sameFile(permit.identity, record.intent.target.identity) ||
      sameProcess(permit.child, plan.child) ||
      permit.child.token === plan.child.token ||
      permit.output.bytes !== candidate.bytes ||
      permit.output.sha256 !== candidate.sha256 ||
      permit.output.fingerprint !== candidate.fingerprint ||
      permit.deadline > record.intent.authority.expiresAt ||
      permit.deadline <= record.updatedAt ||
      Object.keys(record.intent.policy).some(
        (key) =>
          permit.policy[key as keyof typeof permit.policy] !==
          record.intent.policy[key as keyof typeof permit.policy],
      )
    )
      return false;
  }
  if (hasReadiness) {
    const readiness = plan.readiness;
    if (
      !readiness ||
      Object.keys(readiness).length !== 2 ||
      readiness.fingerprint !== plan.trial!.output.fingerprint ||
      !Number.isSafeInteger(readiness.acceptedAt) ||
      readiness.acceptedAt < plan.preparation!.preparedAt ||
      readiness.acceptedAt > record.updatedAt ||
      readiness.acceptedAt >= plan.trial!.deadline
    )
      return false;
  }
  if (hasOutcome) {
    const outcome = plan.outcome;
    if (
      !outcome ||
      Object.keys(outcome).length !== 3 ||
      outcome.role !== 'candidate' ||
      outcome.fingerprint !== plan.readiness!.fingerprint ||
      !Number.isSafeInteger(outcome.committedAt) ||
      outcome.committedAt < plan.readiness!.acceptedAt ||
      outcome.committedAt > record.updatedAt ||
      outcome.committedAt >= plan.trial!.deadline
    )
      return false;
  }
  if (record.phase === 'pause-planned' || record.phase === 'paused')
    return plan.stop === null && plan.requestedAt === null;
  const stop = plan.stop;
  if (
    !validRestoreStopRecord(stop) ||
    !Number.isSafeInteger(plan.requestedAt) ||
    plan.requestedAt! < record.intent.confirmedAt ||
    plan.requestedAt! > record.updatedAt ||
    stop.request.deadline <= plan.requestedAt! ||
    stop.request.jobId !== record.intent.id ||
    stop.request.epoch !== plan.epoch ||
    stop.request.generationId !== record.intent.target.generationId ||
    !sameFile(stop.databaseIdentity, record.intent.target.identity) ||
    !sameProcess(stop.child, plan.child)
  )
    return false;
  return record.phase === 'stop-requested'
    ? stop.fingerprint === null
    : stop.fingerprint !== null &&
        stop.acceptedAt! >= plan.requestedAt! &&
        stop.acceptedAt! <= record.updatedAt;
}
const privateDirectory = (fd: number) => {
  const info = fstatSync(fd);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid!() ||
    info.mode & 0o077 ||
    !Number.isSafeInteger(info.dev) ||
    !Number.isSafeInteger(info.ino)
  )
    throw refused();
  return info;
};
const validPending = (name: string) => name.startsWith('pending-') && uuid.test(name.slice(8));
function boundedNames(path: string, maximum: number) {
  const directory = opendirSync(path, { bufferSize: 16 });
  const names: string[] = [];
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) return names;
      if (names.length === maximum) throw refused();
      names.push(entry.name);
    }
  } finally {
    directory.closeSync();
  }
}
function privateFile(fd: number) {
  const info = fstatSync(fd, { bigint: true });
  if (
    !info.isFile() ||
    info.uid !== BigInt(process.getuid!()) ||
    info.mode & 0o077n ||
    info.nlink !== 1n ||
    info.size > BigInt(MAX_JOB_BYTES)
  )
    throw refused();
  return info;
}
function unchangedFile(fd: number, path: string, before: ReturnType<typeof privateFile>) {
  for (const after of [privateFile(fd), lstatSync(path, { bigint: true })]) {
    if (
      !after.isFile() ||
      ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'nlink'].some(
        (key) => before[key as keyof typeof before] !== after[key as keyof typeof after],
      )
    )
      throw refused();
  }
}

function validRecord(value: unknown, id: string): value is RestoreJobRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as RestoreJobRecord;
  return (
    Object.keys(record).length === (executionPhases.includes(record.phase) ? 7 : 6) &&
    record.version === 1 &&
    Number.isSafeInteger(record.revision) &&
    record.revision >= 0 &&
    record.revision <= 1_000_000 &&
    validRestoreJobIntent(record.intent) &&
    record.intent.id === id &&
    record.intentHash === restoreIntentHash(record.intent) &&
    (['accepted', 'source-retained', 'failed'].includes(record.phase) ||
      executionPhases.includes(record.phase)) &&
    validExecution(record) &&
    Number.isSafeInteger(record.updatedAt) &&
    record.updatedAt >= record.intent.confirmedAt
  );
}

/** Historical terminal evidence remains readable after the child dies or its
 * permit expires. This validates recorded bindings, never current authority. */
export function isCommittedRestoreJob(value: unknown): value is RestoreJobRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as RestoreJobRecord;
  return (
    record.phase === 'candidate-committed' &&
    typeof record.intent?.id === 'string' &&
    validRecord(record, record.intent.id)
  );
}

/** Caller holds RecoveryJournal's kernel lock and the supervisor serial queue.
 * A publication error poisons this instance: uncertain durable state must be
 * reopened/reconciled, never replaced using a cached optimistic checkpoint.
 */
export class RestoreJobs {
  private readonly descriptor: number;
  private readonly journal: RecoveryJournal;
  private readonly now: () => number;
  private closed = false;
  private uncertain = false;
  constructor(journal: RecoveryJournal, now: () => number = Date.now) {
    this.journal = journal;
    this.now = now;
    journal.checkRoot();
    const path = journal.path('restore-jobs');
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      privateDirectory(descriptor);
      fsyncSync(descriptor);
      journal.syncRoot();
      this.descriptor = descriptor;
      this.check();
    } catch (error) {
      closeSync(descriptor);
      throw error;
    }
  }
  private check() {
    if (this.closed || this.uncertain) throw refused();
    this.journal.checkRoot();
    const actual = lstatSync(this.journal.path('restore-jobs'));
    const held = privateDirectory(this.descriptor);
    if (!actual.isDirectory() || actual.dev !== held.dev || actual.ino !== held.ino)
      throw refused();
  }
  private path(id: string) {
    if (!uuid.test(id)) throw refused();
    return `/proc/self/fd/${this.descriptor}/${id}`;
  }
  private inspect<T>(id: string, action: (fd: number) => T): T {
    this.check();
    const path = this.path(id);
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const held = privateDirectory(fd);
      const result = action(fd);
      const actual = lstatSync(path);
      this.check();
      if (!actual.isDirectory() || actual.dev !== held.dev || actual.ino !== held.ino)
        throw refused();
      return result;
    } finally {
      closeSync(fd);
    }
  }
  /** Missing job directory is absent; a directory missing state is an interrupted
   * admission and fails closed. Do not silently discard orphan directories.
   */
  read(id: string): RestoreJobRecord | undefined {
    this.check();
    try {
      lstatSync(this.path(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    return this.inspect(id, (directory) => {
      const path = `/proc/self/fd/${directory}/state.json`;
      const entries = boundedNames(`/proc/self/fd/${directory}`, 9);
      if (entries.some((name) => name !== 'state.json' && !validPending(name))) throw refused();
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = privateFile(fd);
        const bytes = Buffer.alloc(MAX_JOB_BYTES + 1);
        let length = 0;
        for (;;) {
          const count = readSync(fd, bytes, length, bytes.length - length, length);
          length += count;
          if (length > MAX_JOB_BYTES) throw refused();
          if (count === 0) break;
        }
        if (BigInt(length) !== before.size) throw refused();
        const value: unknown = JSON.parse(bytes.subarray(0, length).toString('utf8'));
        if (!validRecord(value, id)) throw refused();
        // Re-establish durability when reopening after an uncertain publication.
        fsyncSync(fd);
        fsyncSync(directory);
        fsyncSync(this.descriptor);
        this.journal.syncRoot();
        unchangedFile(fd, path, before);
        // Only unpublished records in this dedicated metadata directory may be
        // discarded. Missing state or unfamiliar/unbounded contents fail closed.
        for (const name of entries.filter(validPending)) {
          const pendingPath = `/proc/self/fd/${directory}/${name}`;
          const pending = openSync(
            pendingPath,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            const info = privateFile(pending);
            unchangedFile(pending, pendingPath, info);
            unlinkSync(pendingPath);
          } finally {
            closeSync(pending);
          }
        }
        fsyncSync(directory);
        unchangedFile(fd, path, before);
        return value;
      } finally {
        closeSync(fd);
      }
    });
  }
  list(): RestoreJobRecord[] {
    this.check();
    const names = boundedNames(`/proc/self/fd/${this.descriptor}`, MAX_JOBS);
    if (names.length > MAX_JOBS || names.some((name) => !uuid.test(name))) throw refused();
    return names.map((name) => {
      const record = this.read(name);
      if (!record) throw refused();
      return record;
    });
  }
  private target(intent: RestoreJobIntent) {
    this.check();
    const state = this.journal.state;
    const owned = this.journal.workspaceOwnership();
    const target = intent.target;
    const matches = (identity: typeof target.identity) =>
      identity.device === target.identity.device && identity.inode === target.identity.inode;
    if (
      target.instanceId !== state.instanceId ||
      target.generationId !== state.generationId ||
      target.epoch !== state.epoch ||
      target.databasePath !== owned.databasePath ||
      !state.databaseIdentity ||
      !matches(state.databaseIdentity) ||
      !matches(owned.databaseIdentity)
    )
      throw refused();
  }
  private clock(intent: RestoreJobIntent) {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < intent.confirmedAt || now >= intent.authority.expiresAt)
      throw new Error('The original restore confirmation expired.');
    return now;
  }
  private publish(record: RestoreJobRecord) {
    const text = JSON.stringify(record) + '\n';
    if (!validRecord(record, record.intent.id) || Buffer.byteLength(text) > MAX_JOB_BYTES)
      throw refused();
    try {
      this.inspect(record.intent.id, (directory) => {
        const name = `/proc/self/fd/${directory}/pending-${randomUUID()}`;
        let fd: number | undefined;
        const errors: unknown[] = [];
        try {
          fd = openSync(
            name,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
            0o600,
          );
          writeFileSync(fd, text);
          fsyncSync(fd);
          const completed = fd;
          fd = undefined;
          closeSync(completed);
          this.check();
          renameSync(name, `/proc/self/fd/${directory}/state.json`);
          fsyncSync(directory);
          fsyncSync(this.descriptor);
          this.journal.syncRoot();
        } catch (error) {
          errors.push(error);
        }
        try {
          if (fd !== undefined) closeSync(fd);
        } catch (error) {
          errors.push(error);
        }
        try {
          unlinkSync(name);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(error);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1)
          throw new AggregateError(errors, 'Restore publication and cleanup failed.');
      });
    } catch (error) {
      this.uncertain = true;
      throw error;
    }
  }
  /** Retry lookup does not refresh timestamps or authority. A caller must find
   * an existing job before generating a new continuation secret/confirmation.
   */
  admit(intent: RestoreJobIntent): { record: RestoreJobRecord; created: boolean } {
    const hash = restoreIntentHash(intent);
    const snapshot = JSON.parse(JSON.stringify(intent)) as RestoreJobIntent;
    const existing = this.read(snapshot.id);
    if (existing) {
      if (existing.intentHash !== hash)
        throw new Error('Restore job ID already has different intent.');
      return { record: existing, created: false };
    }
    const jobs = this.list();
    if (jobs.length >= MAX_JOBS)
      throw new Error(
        'Restore job inventory is full; retained IDs cannot be pruned automatically.',
      );
    if (
      this.journal.state.restoreJob ||
      jobs.some((job) => job.phase !== 'failed' && !isCommittedRestoreJob(job))
    )
      throw new Error('Finish the current restore job first.');
    this.target(snapshot);
    const record: RestoreJobRecord = {
      version: 1,
      revision: 0,
      intent: snapshot,
      intentHash: hash,
      phase: 'accepted',
      updatedAt: this.clock(snapshot),
    };
    try {
      mkdirSync(this.path(snapshot.id), { mode: 0o700 });
      fsyncSync(this.descriptor);
      this.publish(record);
    } catch (error) {
      this.uncertain = true;
      throw error;
    }
    this.target(snapshot);
    this.clock(snapshot);
    return { record: structuredClone(record), created: true };
  }
  /** Only pre-mutation admission checkpoints exist yet. Source custody must have
   * been independently verified before recording source-retained. This method
   * does not establish authority or authorize the next workspace operation.
   */
  checkpoint(
    id: string,
    intentHash: string,
    revision: number,
    phase: 'source-retained' | 'failed',
  ) {
    if (phase !== 'source-retained' && phase !== 'failed') throw refused();
    const current = this.read(id);
    if (
      !current ||
      current.intentHash !== intentHash ||
      current.revision !== revision ||
      !['accepted', 'source-retained'].includes(current.phase) ||
      (phase === 'source-retained' && current.phase !== 'accepted')
    )
      throw refused();
    if (phase !== 'failed') this.target(current.intent);
    const now = phase === 'failed' ? this.now() : this.clock(current.intent);
    if (!Number.isSafeInteger(now)) throw refused();
    const next: RestoreJobRecord = {
      ...current,
      phase,
      revision: current.revision + 1,
      updatedAt: Math.max(now, current.updatedAt),
    };
    this.publish(next);
    if (phase !== 'failed') {
      this.target(current.intent);
      this.clock(current.intent);
    }
    return structuredClone(next);
  }
  private executionRecord(
    id: string,
    hash: string,
    revision: number,
    phase: RestoreJobRecord['phase'],
  ) {
    const current = this.read(id);
    if (
      !current ||
      current.intentHash !== hash ||
      current.revision !== revision ||
      current.phase !== phase
    )
      throw refused();
    const state = this.journal.state,
      owned = this.journal.workspaceOwnership(),
      target = current.intent.target;
    if (
      state.restoreJob?.jobId !== id ||
      state.restoreJob.intentHash !== hash ||
      state.instanceId !== target.instanceId ||
      state.generationId !== target.generationId ||
      owned.databasePath !== target.databasePath ||
      !sameFile(state.databaseIdentity, target.identity) ||
      !sameFile(owned.databaseIdentity, target.identity)
    )
      throw refused();
    return current;
  }
  private executionBinding(current: RestoreJobRecord, phase: 'paused' | 'stopping' | 'stopped') {
    const state = this.journal.state,
      plan = current.execution!,
      intent = current.intent;
    if (
      state.phase !== phase ||
      state.epoch !== plan.epoch ||
      state.operation?.id !== intent.id ||
      state.operation.generationId !== intent.target.generationId ||
      state.operation.actorId !== intent.authority.actorId ||
      state.operation.sessionHash !== intent.authority.sessionHash ||
      state.operation.expiresAt !== intent.authority.expiresAt ||
      state.operation.tokenHash !== intent.continuationHash ||
      (phase === 'stopped' ? state.child !== null : !sameProcess(state.child, plan.child))
    )
      throw refused();
  }
  private publishExecution(
    current: RestoreJobRecord,
    phase: ExecutionPhase,
    execution: RestorePausePlan,
  ) {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < current.updatedAt) throw refused();
    const next: RestoreJobRecord = {
      ...current,
      phase,
      execution: structuredClone(execution),
      revision: current.revision + 1,
      updatedAt: now,
    };
    this.publish(next);
    return structuredClone(next);
  }
  /** Reserve the epoch before drain. Original intent and proof never change. */
  planPause(id: string, hash: string, revision: number, epoch: string) {
    const current = this.executionRecord(id, hash, revision, 'source-retained');
    this.target(current.intent);
    this.clock(current.intent);
    const state = this.journal.state;
    if (state.phase !== 'running' || state.restoreStop || !state.child) throw refused();
    const result = this.publishExecution(current, 'pause-planned', {
      epoch,
      child: state.child,
      stop: null,
      requestedAt: null,
    });
    this.clock(current.intent);
    return result;
  }
  markPaused(id: string, hash: string, revision: number) {
    const current = this.executionRecord(id, hash, revision, 'pause-planned');
    this.executionBinding(current, 'paused');
    if (this.journal.state.restoreStop) throw refused();
    return this.publishExecution(current, 'paused', current.execution!);
  }
  /** Must run before the shutdown challenge is sent to the child. */
  planStop(id: string, hash: string, revision: number, stop: RestoreStopRecord) {
    const current = this.executionRecord(id, hash, revision, 'paused');
    this.executionBinding(current, 'paused');
    this.clock(current.intent);
    if (
      this.journal.state.restoreStop ||
      stop.fingerprint !== null ||
      stop.request.deadline <= this.now()
    )
      throw refused();
    const result = this.publishExecution(current, 'stop-requested', {
      ...current.execution!,
      stop,
      requestedAt: this.now(),
    });
    this.clock(current.intent);
    if (this.now() >= stop.request.deadline) throw refused();
    return result;
  }
  /** Durable job witness precedes main-journal publication and the sole ACK.
   * Recording evidence after authority expiry does not authorize a mutation. */
  acceptWitness(id: string, hash: string, revision: number, stop: RestoreStopRecord) {
    const current = this.executionRecord(id, hash, revision, 'stop-requested');
    this.executionBinding(current, 'stopping');
    const requested = current.execution!.stop!,
      mirrored = this.journal.state.restoreStop;
    if (
      !validRestoreStopRecord(stop) ||
      stop.fingerprint === null ||
      stop.acceptedAt! < current.updatedAt ||
      !sameRestoreStopRequest(stop.request, requested.request) ||
      !mirrored ||
      !sameStop(mirrored, requested)
    )
      throw refused();
    return this.publishExecution(current, 'witness-accepted', { ...current.execution!, stop });
  }
  /** Caller separately proves physical group/descriptor closure before this. */
  markStopped(id: string, hash: string, revision: number) {
    const current = this.executionRecord(id, hash, revision, 'witness-accepted');
    this.executionBinding(current, 'stopped');
    if (!sameStop(this.journal.state.restoreStop, current.execution!.stop!)) throw refused();
    return this.publishExecution(current, 'witnessed-stopped', current.execution!);
  }
  private closedExecution(id: string, hash: string, revision: number, phase: ExecutionPhase) {
    const current = this.executionRecord(id, hash, revision, phase);
    this.executionBinding(current, 'stopped');
    if (!sameStop(this.journal.state.restoreStop, current.execution!.stop!)) throw refused();
    return current;
  }
  planOriginals(id: string, hash: string, revision: number, originals: RestoreOriginals) {
    const current = this.closedExecution(id, hash, revision, 'witnessed-stopped');
    return this.publishExecution(current, 'originals-planned', {
      ...current.execution!,
      originals,
    });
  }
  markOriginalsRetained(id: string, hash: string, revision: number) {
    const current = this.closedExecution(id, hash, revision, 'originals-planned');
    return this.publishExecution(current, 'originals-retained', current.execution!);
  }
  /** Reserve one worker slot before creating its directory. Ambiguous or partial
   * slots remain evidence; automatic retry must not allocate another one. */
  planFreeze(id: string, hash: string, revision: number, freezeSlot: string) {
    const current = this.closedExecution(id, hash, revision, 'originals-retained');
    this.clock(current.intent);
    const result = this.publishExecution(current, 'freeze-planned', {
      ...current.execution!,
      freezeSlot,
    });
    this.clock(current.intent);
    return result;
  }
  markFrozen(
    id: string,
    hash: string,
    revision: number,
    frozen: NonNullable<RestorePausePlan['frozen']>,
  ) {
    const current = this.closedExecution(id, hash, revision, 'freeze-planned');
    this.clock(current.intent);
    const result = this.publishExecution(current, 'frozen', { ...current.execution!, frozen });
    this.clock(current.intent);
    return result;
  }
  private preparationCheckpoint(
    current: RestoreJobRecord,
    phase: ExecutionPhase,
    preparation: RestorePreparation,
  ) {
    this.clock(current.intent);
    const result = this.publishExecution(current, phase, { ...current.execution!, preparation });
    // Recheck target/epoch/closure binding after durable publication as well as
    // time. A late failure preserves the published evidence, never clears it.
    this.closedExecution(result.intent.id, result.intentHash, result.revision, phase);
    this.clock(result.intent);
    return result;
  }
  planPreparation(id: string, hash: string, revision: number, slot: string, preparedAt: number) {
    const current = this.closedExecution(id, hash, revision, 'frozen');
    const now = this.clock(current.intent);
    if (!Number.isSafeInteger(preparedAt) || preparedAt < current.updatedAt || preparedAt > now)
      throw refused();
    return this.preparationCheckpoint(current, 'preparation-planned', { slot, preparedAt });
  }
  markCandidatePrepared(
    id: string,
    hash: string,
    revision: number,
    candidate: RestorePreparedImage,
  ) {
    const current = this.closedExecution(id, hash, revision, 'preparation-planned');
    return this.preparationCheckpoint(current, 'candidate-prepared', {
      ...current.execution!.preparation!,
      candidate,
    });
  }
  markRollbackPrepared(id: string, hash: string, revision: number, rollback: RestorePreparedImage) {
    const current = this.closedExecution(id, hash, revision, 'candidate-prepared');
    return this.preparationCheckpoint(current, 'rollback-prepared', {
      ...current.execution!.preparation!,
      rollback,
    });
  }
  markCandidateRehearsed(id: string, hash: string, revision: number) {
    const current = this.closedExecution(id, hash, revision, 'rollback-prepared');
    return this.preparationCheckpoint(
      current,
      'candidate-rehearsed',
      current.execution!.preparation!,
    );
  }
  markPrepared(id: string, hash: string, revision: number) {
    const current = this.closedExecution(id, hash, revision, 'candidate-rehearsed');
    return this.preparationCheckpoint(current, 'prepared', current.execution!.preparation!);
  }
  private activationCheckpoint(
    current: RestoreJobRecord,
    phase: ExecutionPhase,
    execution: RestorePausePlan,
  ) {
    this.clock(current.intent);
    const result = this.publishExecution(current, phase, execution);
    this.closedExecution(result.intent.id, result.intentHash, result.revision, phase);
    this.clock(result.intent);
    return result;
  }
  planActivation(id: string, hash: string, revision: number, attempt: RestoreAttempt) {
    const current = this.closedExecution(id, hash, revision, 'prepared');
    return this.activationCheckpoint(current, 'activation-planned', {
      ...current.execution!,
      attempt,
    });
  }
  markCandidateStaged(id: string, hash: string, revision: number) {
    const current = this.closedExecution(id, hash, revision, 'activation-planned');
    return this.activationCheckpoint(current, 'candidate-staged', current.execution!);
  }
  markCandidateReplacing(id: string, hash: string, revision: number) {
    const current = this.closedExecution(id, hash, revision, 'candidate-staged');
    return this.activationCheckpoint(current, 'candidate-replacing', current.execution!);
  }
  markCandidateActivated(id: string, hash: string, revision: number) {
    const current = this.closedExecution(id, hash, revision, 'candidate-replacing');
    return this.activationCheckpoint(current, 'candidate-activated', current.execution!);
  }
  private trialClock(record: RestoreJobRecord) {
    const permit = record.execution!.trial!;
    const check = () => {
      const now = this.clock(record.intent);
      if (now < record.updatedAt || now >= permit.deadline) throw refused();
      return now;
    };
    check();
    assertRestoreTrialTarget(
      permit,
      this.journal.databasePath,
      record.intent.target.identity,
      permit.child.pid,
    );
    return check();
  }
  planTrial(id: string, hash: string, revision: number, permit: RestoreTrialPermit) {
    const current = this.closedExecution(id, hash, revision, 'candidate-activated');
    if (!validRestoreTrialPermit(permit)) throw refused();
    this.trialClock({ ...current, execution: { ...current.execution!, trial: permit } });
    const result = this.activationCheckpoint(current, 'trial-planned', {
      ...current.execution!,
      trial: permit,
    });
    this.trialClock(result);
    return result;
  }
  /** A trial's main journal intentionally selects its new generation. Keep this
   * binding separate: none of the original-stage APIs may accept that switch. */
  private selectedTrialRecord(
    id: string,
    hash: string,
    revision: number,
    phase: ExecutionPhase,
    mainPhase: 'starting' | 'paused',
  ) {
    const record = this.read(id);
    if (
      !record ||
      record.intentHash !== hash ||
      record.revision !== revision ||
      record.phase !== phase ||
      !record.execution?.trial
    )
      throw refused();
    const permit = record.execution.trial,
      target = record.intent.target;
    const state = this.journal.state,
      owned = this.journal.workspaceOwnership(),
      operation = state.operation;
    if (
      state.restoreJob?.jobId !== id ||
      state.restoreJob.intentHash !== hash ||
      state.instanceId !== target.instanceId ||
      state.phase !== mainPhase ||
      state.generationId !== permit.generationId ||
      state.epoch !== permit.epoch ||
      owned.databasePath !== target.databasePath ||
      !sameFile(owned.databaseIdentity, target.identity) ||
      !sameFile(state.databaseIdentity, target.identity) ||
      !sameProcess(state.child, permit.child) ||
      !sameStop(state.restoreStop, record.execution.stop!) ||
      operation?.id !== id ||
      operation.generationId !== permit.generationId ||
      operation.actorId !== record.intent.authority.actorId ||
      operation.sessionHash !== record.intent.authority.sessionHash ||
      operation.expiresAt !== record.intent.authority.expiresAt ||
      operation.tokenHash !== record.intent.continuationHash
    )
      throw refused();
    this.trialClock(record);
    return record;
  }
  markTrialReady(
    id: string,
    hash: string,
    revision: number,
    reference: RestoreTrialRelease,
    fingerprint: string,
  ) {
    const current = this.selectedTrialRecord(id, hash, revision, 'trial-planned', 'starting');
    if (
      !sameRestoreTrialReference(reference, current.execution!.trial!) ||
      fingerprint !== current.execution!.trial!.output.fingerprint
    )
      throw refused();
    const acceptedAt = this.trialClock(current);
    const result = this.publishExecution(current, 'trial-ready', {
      ...current.execution!,
      readiness: { fingerprint, acceptedAt },
    });
    this.selectedTrialRecord(id, hash, result.revision, 'trial-ready', 'starting');
    return result;
  }
  /** Publish the winner before any barrier or public-admission release. A
   * post-publication failure must retain this outcome for recovery. */
  markCandidateCommitted(
    id: string,
    hash: string,
    revision: number,
    reference: RestoreTrialRelease,
  ) {
    const current = this.selectedTrialRecord(id, hash, revision, 'trial-ready', 'paused');
    if (!sameRestoreTrialReference(reference, current.execution!.trial!)) throw refused();
    const committedAt = this.trialClock(current);
    const result = this.publishExecution(current, 'candidate-committed', {
      ...current.execution!,
      outcome: {
        role: 'candidate',
        fingerprint: current.execution!.readiness!.fingerprint,
        committedAt,
      },
    });
    this.selectedTrialRecord(id, hash, result.revision, 'candidate-committed', 'paused');
    return result;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.descriptor);
  }
}
