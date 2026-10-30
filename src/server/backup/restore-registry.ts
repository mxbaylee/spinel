import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, open, rename, rm, stat, statfs } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { backup } from '../../../server/database.ts';
import type { DatabaseSync } from '../../../server/database.ts';
import type {
  RestoreOutcome,
  RestorePreparation,
  RestorePreview,
  RestoreStatus,
} from '../../shared/restore.ts';
import {
  validRestorePreview,
  validRestoreResources,
  validRestoreVerification,
} from '../../shared/restore.ts';
import { validRestoreJobRecord } from '../maintenance/restore-jobs.ts';
import type { RestoreJobRecord } from '../maintenance/restore-jobs.ts';
import { processIdentity } from '../maintenance/journal.ts';
import type { ProcessIdentity } from '../maintenance/journal.ts';
import { assertRestoreAuthority } from '../maintenance/restore-authority.ts';
import { restoreIntentHash } from '../maintenance/restore-job-intent.ts';
import type { RestoreAuthority } from '../maintenance/restore-authority.ts';
import type {
  RestoreController,
  ConfirmedRestoreAdmission,
  RestoreObservation,
} from './restore-control.ts';
import { hasDestination } from './config.ts';
import type { BackupConfig } from './config.ts';
import { createDestination } from './destination.ts';
import type { RemoteStore } from './destination.ts';
import { backupTime } from './spaces.ts';
import {
  fileChunks,
  MAX_ARCHIVE_BYTES,
  transferArchive,
  TRANSFER_DISK_RESERVE,
} from './transfer.ts';
import { prepareRestoreArchive, reconcilePreparedRestore } from './verification.ts';
import type { PreparedRestoreSource } from './verification.ts';
import { RecoveryResourceError } from './resource-error.ts';

const LIFETIME_MS = 30 * 60_000;
const DATABASE_LIMIT = 8 * 1024 ** 3;
const FAILURE =
  'Restore preparation failed. Check the encrypted backup, key, compatible application image and free space.';
const HANDOFF_FAILURE =
  'Restore admission needs recovery. The original source remains held; retry the same confirmation.';
const terminal = new Set<RestorePreparation['state']>([
  'cancelled',
  'expired',
  'failed',
  'started',
]);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const bootId = (value: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const validProcess = (value: ProcessIdentity | null, pid: number): value is ProcessIdentity =>
  !!value && value.pid === pid && bootId(value.boot) && /^[0-9]{1,32}$/.test(value.start);
function leaseOwner(value: string) {
  const legacy = /^restore:([1-9][0-9]*):([a-f0-9-]{36})$/.exec(value);
  const current = /^restore:v2:([1-9][0-9]*):([a-f0-9-]{36}):([0-9]{1,32}):([a-f0-9-]{36})$/.exec(
    value,
  );
  const pid = Number(current?.[1] ?? legacy?.[1]);
  const id = current?.[4] ?? legacy?.[2];
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !id ||
    !uuid(id) ||
    (current && !bootId(current[2]))
  )
    return null;
  return {
    pid,
    id,
    identity: current ? { pid, boot: current[2], start: current[3], token: '' } : null,
  };
}
function ownerGone(owner: NonNullable<ReturnType<typeof leaseOwner>>) {
  try {
    if (owner.identity) {
      const current = processIdentity(owner.pid);
      return (
        current === null ||
        (validProcess(current, owner.pid) &&
          (current.boot !== owner.identity.boot || current.start !== owner.identity.start))
      );
    }
    // Legacy owners cannot distinguish a reused live PID. Keep that ambiguity.
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return !owner.identity && (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

export class RestoreRegistryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export interface RestoreRegistryOptions {
  databasePath: string;
  origin: string;
  image?: string;
  spacesEnabled: boolean;
  controller?: RestoreController;
  now?: () => number;
  configuration(): Promise<BackupConfig | undefined>;
  remote?: (config: BackupConfig) => RemoteStore;
}
type Source = { kind: 'upload'; key: Buffer } | { kind: 'catalog'; artifactId: string };
interface Job {
  public: RestorePreparation;
  requestId: string;
  requestHash: string;
  actor: string;
  session: string;
  owner: string;
  controller: AbortController;
  proof: RestoreAuthority;
  directory?: string;
  keyFile?: string;
  prepared?: PreparedRestoreSource;
  previewDatabaseBytes?: number;
  task?: Promise<void>;
  initialization?: Promise<void>;
  finishing?: Promise<void>;
  admission?: ConfirmedRestoreAdmission;
  ack?: Awaited<ReturnType<RestoreController['admit']>>;
  custodyReleased?: boolean;
  handoffWritten?: boolean;
  admissionFailureObserved?: boolean;
  admissionAttempt: number;
}
function artifactId(config: BackupConfig, key: string) {
  const identity =
    config.type === 'filesystem'
      ? ['filesystem', config.root, config.rootDevice, config.rootInode, config.prefix]
      : hasDestination(config)
        ? [config.type ?? 'spaces', config.region, config.bucket, config.prefix]
        : ['manual', config.prefix];
  return digest([identity, key]);
}

/** Application custody ends only after a matching durable supervisor ACK.
 * Public projections are explicit; never serialize Job or controller results. */
export class RestoreRegistry {
  private job?: Job;
  private history = new Map<string, Job>();
  private creating = false;
  private closing = false;
  private timer?: ReturnType<typeof setInterval>;
  private cleanupTask?: Promise<void>;
  readonly namespace: string;
  readonly now: () => number;
  readonly db: DatabaseSync;
  readonly options: RestoreRegistryOptions;
  constructor(db: DatabaseSync, options: RestoreRegistryOptions) {
    this.db = db;
    this.options = { ...options };
    this.namespace = `.restore-preparation-${digest(resolve(options.databasePath)).slice(0, 24)}-`;
    this.now = options.now ?? Date.now;
  }
  start() {
    // Rehearsal/private trial startup must remain inert. A running application
    // allocates housekeeping only after an explicit restore preparation exists.
    if (!this.job || this.timer || this.closing || !this.available()) return;
    this.timer = setInterval(() => {
      void this.db
        .runBackground(async () => {
          await this.cleanupOrphans();
          await this.expire();
        })
        ?.catch(() => {});
    }, 30_000);
    this.timer.unref();
  }
  private assertOperator(actor: string, sessionHash: string) {
    const current = this.db
      .prepare(
        `SELECT 1 AS allowed FROM auth_sessions AS s
      JOIN auth_users AS u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.is_admin=1 AND u.disabled=0`,
      )
      .get(sessionHash, actor, this.now());
    if (!current)
      throw new RestoreRegistryError(404, 'Operator access is unavailable. Sign in again.');
  }
  private async observe(id?: string): Promise<RestoreObservation> {
    const control = this.control();
    let observed: RestoreObservation;
    try {
      observed = await control.observe(id ? { id } : {});
    } catch {
      throw new RestoreRegistryError(503, 'Restore status could not be verified.');
    }
    const current = control.target();
    if (
      !observed ||
      typeof observed.pending !== 'boolean' ||
      !uuid(observed.target?.generationId) ||
      !uuid(observed.target?.epoch) ||
      observed.target.generationId !== current.generationId ||
      observed.target.epoch !== current.epoch ||
      (observed.record !== null &&
        (!validRestoreJobRecord(observed.record, observed.record?.intent?.id) ||
          (id !== undefined && observed.record.intent.id !== id) ||
          (!observed.pending &&
            !['failed', 'candidate-committed', 'original-committed'].includes(
              observed.record.phase,
            ))))
    )
      throw new RestoreRegistryError(503, 'Restore status could not be verified.');
    return observed;
  }
  private matchesAdmission(job: Job, record: RestoreJobRecord) {
    const admission = job.admission;
    if (!admission) return false;
    const intent = record.intent,
      source = admission.source;
    return (
      restoreIntentHash(intent) === record.intentHash &&
      intent.id === job.public.id &&
      intent.target.generationId === admission.generationId &&
      intent.target.epoch === admission.epoch &&
      intent.source.archive.bytes === source.archive.bytes &&
      intent.source.archive.sha256 === source.archive.sha256 &&
      intent.source.candidate.bytes === source.databaseBytes &&
      intent.source.candidate.sha256 === source.databaseSha256 &&
      digest(intent.source.recovery) === digest(source.recovery) &&
      intent.confirmedAt === admission.confirmedAt &&
      intent.previewDatabaseBytes === admission.previewDatabaseBytes &&
      intent.policy.origin === this.options.origin &&
      intent.policy.image === this.options.image &&
      intent.policy.spacesEnabled === this.options.spacesEnabled &&
      intent.policy.consequencesVersion === 1 &&
      intent.consequenceEnvelope === 1 &&
      Object.keys(admission.preview).every(
        (key) =>
          intent.preview[key as keyof RestorePreview] ===
          admission.preview[key as keyof RestorePreview],
      ) &&
      (['actorId', 'sessionHash', 'verifiedAt', 'verifiedPasskeyId', 'expiresAt'] as const).every(
        (key) => intent.authority[key] === admission.authority[key],
      ) &&
      (!job.ack || job.ack.record.intentHash === record.intentHash)
    );
  }
  private async reconcileAdmission(authorize: () => void) {
    const job = this.job;
    const idle = () =>
      this.job === job &&
      !!job?.admission &&
      !job.admissionFailureObserved &&
      !job.task &&
      !job.initialization &&
      !job.finishing;
    if (!job || !idle()) return;
    authorize();
    const lease = this.db.prepare('SELECT owner,job,lease FROM backup_state WHERE id=1').get();
    const attempt = job.admissionAttempt;
    const observed = await this.observe(job.public.id);
    authorize();
    if (!idle() || job.admissionAttempt !== attempt) return;
    const current = this.control().target(),
      record = observed.record;
    if (record && !this.matchesAdmission(job, record))
      throw new RestoreRegistryError(503, 'Restore status could not be verified.');
    if (
      observed.pending ||
      observed.target.generationId !== current.generationId ||
      observed.target.epoch !== current.epoch ||
      (record
        ? record.phase !== 'failed' ||
          !!record.execution ||
          record.intent.target.generationId !== current.generationId
        : !!job.ack ||
          job.admission!.generationId !== current.generationId ||
          job.admission!.epoch !== current.epoch)
    )
      return;
    if (!job.custodyReleased) {
      if (lease?.owner !== job.owner || lease.job !== 'restore') return;
      const result = this.db
        .prepare(
          "UPDATE backup_state SET lease=0,owner=NULL,job=NULL WHERE id=1 AND owner=? AND job='restore' AND lease=?",
        )
        .run(job.owner, lease.lease);
      if (result.changes !== 1) return;
    }
    // A matching ACK may already have released the lease. Never touch a later
    // operation's owner in that case. Keep admission, staging and handoff files;
    // normal finish/cleanup would destroy the evidence of this resolved failure.
    job.admissionFailureObserved = true;
    job.public.state = 'failed';
    job.public.error = record
      ? 'Restore did not begin. Its retained source remains available for recovery.'
      : 'Restore was not admitted. Its retained source remains available for recovery.';
  }
  private async cleanupOrphans(authorize: () => void = () => {}) {
    // Logical lease recovery never removes source/handoff evidence. A directory
    // may be missing after ACK cleanup or incomplete after a crash; neither is
    // evidence that the supervisor accepted (or rejected) the restore.
    if (this.cleanupTask) return this.cleanupTask;
    this.cleanupTask = (async () => {
      const state = this.db.prepare('SELECT owner,job,lease FROM backup_state WHERE id=1').get();
      if (state?.job !== 'restore' || typeof state.owner !== 'string') return;
      const owner = leaseOwner(state.owner);
      if (!owner) return;
      const dead = () => ownerGone(owner);
      if (!dead()) return;
      let observed: RestoreObservation;
      try {
        observed = await this.observe(owner.id);
      } catch {
        return;
      } // unavailable/invalid evidence retains the hold
      authorize();
      const current = this.control().target(),
        record = observed.record;
      if (
        observed.pending ||
        !dead() ||
        current.generationId !== observed.target.generationId ||
        current.epoch !== observed.target.epoch ||
        (record !== null &&
          !(
            record.phase === 'failed' &&
            !record.execution &&
            record.intent.target.generationId === current.generationId
          ))
      )
        return;
      this.db
        .prepare(
          "UPDATE backup_state SET lease=0,owner=NULL,job=NULL WHERE id=1 AND owner=? AND job='restore' AND lease=?",
        )
        .run(state.owner, state.lease);
    })();
    try {
      await this.cleanupTask;
    } finally {
      this.cleanupTask = undefined;
    }
  }
  private async hashFile(job: Job, path: string, maximum: number, signal: AbortSignal) {
    const file = await open(path, 'r');
    try {
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of fileChunks(file, signal)) {
        this.assertActive(job);
        bytes += chunk.length;
        if (bytes > maximum) throw new Error('Recovery file size limit.');
        hash.update(chunk);
      }
      return hash.digest('hex');
    } finally {
      await file.close();
    }
  }
  available() {
    const control = this.options.controller;
    return !!(
      control &&
      typeof control.target === 'function' &&
      typeof control.admit === 'function' &&
      typeof control.begin === 'function' &&
      typeof control.observe === 'function' &&
      this.options.image &&
      /^(sha256:[a-f0-9]{64}|\S+@sha256:[a-f0-9]{64})$/.test(this.options.image)
    );
  }
  private control() {
    if (!this.available() || this.closing)
      throw new RestoreRegistryError(503, 'Supervised restore is unavailable.');
    return this.options.controller!;
  }
  private lease(job: Job) {
    const state = this.db.prepare('SELECT owner,lease,job FROM backup_state WHERE id=1').get();
    if (state?.owner !== job.owner || state.job !== 'restore' || Number(state.lease) <= this.now())
      throw new RestoreRegistryError(409, 'The restore source hold expired. Prepare it again.');
  }
  private assertActive(job: Job) {
    job.controller.signal.throwIfAborted();
    this.lease(job);
    if (this.now() >= job.public.expiresAt)
      throw new RestoreRegistryError(409, 'Restore preparation expired.');
    const target = this.control().target();
    if (
      target.generationId !== job.public.target.generationId ||
      target.epoch !== job.public.target.epoch
    )
      throw new RestoreRegistryError(
        409,
        'The target workspace changed. Prepare the restore again.',
      );
    assertRestoreAuthority(this.db, job.proof, this.now);
  }
  private owned(id: string, actor: string, session: string) {
    const job = this.history.get(id);
    if (!job || job.actor !== actor || job.session !== session)
      throw new RestoreRegistryError(404, 'Restore preparation not found.');
    return job;
  }
  status(id: string, actor: string, session: string) {
    return structuredClone(this.owned(id, actor, session).public);
  }
  async current(actor: string, session: string) {
    const job = this.job;
    if (!job || job.actor !== actor || job.session !== session) return null;
    // Do not join admission/Begin: its response must finish before drain. Only
    // private allocation can delay returning an upload-ready preparation.
    await job.initialization?.catch(() => {});
    return structuredClone(job.public);
  }
  async summary(actor: string, session: string): Promise<RestoreStatus> {
    this.assertOperator(actor, session);
    if (this.available()) await this.reconcileAdmission(() => this.assertOperator(actor, session));
    const job = await this.current(actor, session);
    this.assertOperator(actor, session);
    if (!this.available()) return { available: false, job, outcome: null, pending: null };
    await this.cleanupOrphans(() => this.assertOperator(actor, session));
    const observed = await this.observe(this.job?.admission && job ? job.id : undefined);
    this.assertOperator(actor, session);
    const record = observed.record;
    let outcome: RestoreOutcome | null = null;
    if (record) {
      outcome = {
        id: record.intent.id,
        state:
          record.phase === 'candidate-committed'
            ? 'backup-restored'
            : record.phase === 'original-committed'
              ? 'original-recovered'
              : record.phase === 'failed' && !record.execution
                ? 'did-not-start'
                : 'unresolved',
        updatedAt: record.updatedAt,
        source: {
          bytes: record.intent.source.archive.bytes,
          sha256: record.intent.source.archive.sha256,
        },
      };
    }
    return { available: true, job, outcome, pending: observed.pending };
  }
  private async points(config: BackupConfig, remote: RemoteStore, signal: AbortSignal) {
    const keys = await remote.list(signal);
    signal.throwIfAborted();
    if (keys.length > 10_000) throw new Error('Catalog limit.');
    return keys
      .map((key) => ({ key, time: backupTime(key, config.prefix) }))
      .filter((point): point is { key: string; time: Date } => point.time !== null)
      .sort((a, b) => b.time.getTime() - a.time.getTime() || b.key.localeCompare(a.key));
  }
  async catalog() {
    let remote: RemoteStore | undefined;
    try {
      const config = await this.options.configuration();
      if (!config || !hasDestination(config)) return { entries: [] };
      remote = this.options.remote?.(config) ?? createDestination(config);
      const points = await this.points(config, remote, AbortSignal.timeout(30_000));
      return {
        entries: points.map(({ key, time }) => ({
          id: artifactId(config, key),
          createdAt: time.getTime(),
        })),
      };
    } catch {
      throw new RestoreRegistryError(503, 'Saved backups could not be loaded.');
    } finally {
      await remote?.close?.();
    }
  }
  async create(requestId: string, proof: RestoreAuthority, source: Source) {
    let ownsCreation = false;
    try {
      const control = this.control();
      if (
        !uuid(requestId) ||
        (source.kind === 'upload' && source.key.length !== 32) ||
        (source.kind === 'catalog' && !/^[a-f0-9]{64}$/.test(source.artifactId))
      )
        throw new RestoreRegistryError(400, 'Invalid restore preparation.');
      assertRestoreAuthority(this.db, proof, this.now);
      await this.reconcileAdmission(() => assertRestoreAuthority(this.db, proof, this.now));
      assertRestoreAuthority(this.db, proof, this.now);
      const requestHash = digest(
        source.kind === 'catalog'
          ? source
          : { kind: source.kind, key: createHash('sha256').update(source.key).digest('hex') },
      );
      const findExisting = () =>
        [...this.history.values()].find(
          (item) =>
            item.requestId === requestId &&
            item.actor === proof.actorId &&
            item.session === proof.sessionHash,
        );
      const existingResult = async (existing: Job) => {
        if (existing.requestHash !== requestHash)
          throw new RestoreRegistryError(409, 'This request already selected a different source.');
        await existing.initialization;
        return structuredClone(existing.public);
      };
      const existing = findExisting();
      if (existing) return await existingResult(existing);
      await this.expire();
      await this.cleanupOrphans(() => assertRestoreAuthority(this.db, proof, this.now));
      const observation = await this.observe();
      assertRestoreAuthority(this.db, proof, this.now);
      if (observation.pending)
        throw new RestoreRegistryError(
          409,
          'Another supervised restore needs recovery before preparation.',
        );
      const admittedWhileWaiting = findExisting();
      if (admittedWhileWaiting) return await existingResult(admittedWhileWaiting);
      if (this.creating || (this.job && !terminal.has(this.job.public.state)))
        throw new RestoreRegistryError(409, 'Finish the current restore preparation first.');
      this.creating = true;
      ownsCreation = true;
      const now = this.now(),
        id = randomUUID();
      let identity: ProcessIdentity | null;
      try {
        identity = processIdentity(process.pid);
      } catch {
        identity = null;
      }
      if (!validProcess(identity, process.pid))
        throw new RestoreRegistryError(503, 'Restore process ownership could not be verified.');
      const owner = `restore:v2:${process.pid}:${identity.boot}:${identity.start}:${id}`;
      const target = control.target();
      if (!uuid(target.generationId) || !uuid(target.epoch))
        throw new RestoreRegistryError(503, 'Supervised restore is unavailable.');
      const claim = this.db
        .prepare("UPDATE backup_state SET owner=?,job='restore',lease=? WHERE id=1 AND lease<=?")
        .run(owner, now + LIFETIME_MS + 60_000, now);
      if (!claim.changes)
        throw new RestoreRegistryError(409, 'Another backup or recovery operation is active.');
      const job: Job = {
        requestId,
        requestHash,
        actor: proof.actorId,
        session: proof.sessionHash,
        owner,
        proof: structuredClone(proof),
        controller: new AbortController(),
        admissionAttempt: 0,
        public: {
          id,
          state: source.kind === 'upload' ? 'uploading' : 'preparing',
          source: source.kind,
          createdAt: now,
          expiresAt: now + LIFETIME_MS,
          bytes: null,
          sourceSha256: null,
          sourceCreatedAt: null,
          target: { ...target },
          preview: null,
          verification: null,
          resources: null,
          confirmation: null,
          consequencesVersion: 1,
          error: null,
        },
      };
      this.job = job;
      this.start();
      this.history.set(id, job);
      for (const [key, old] of this.history)
        if (this.history.size > 32 && old !== job && terminal.has(old.public.state))
          this.history.delete(key);
      try {
        job.initialization = (async () => {
          job.directory = await mkdtemp(
            join(dirname(resolve(this.options.databasePath)), `${this.namespace}${process.pid}-`),
          );
          await chmod(job.directory, 0o700);
          this.assertActive(job);
          if (source.kind === 'upload') {
            job.keyFile = join(job.directory, 'upload.key');
            const key = await open(job.keyFile, 'wx', 0o600);
            try {
              await key.writeFile(source.key);
              await key.sync();
            } finally {
              await key.close();
            }
            this.assertActive(job);
          }
        })();
        await job.initialization;
        if (source.kind === 'catalog') {
          const task = () => this.prepareCatalog(job, source.artifactId);
          job.task = this.db.maintenance ? this.db.maintenance.run(task) : task();
        }
        return structuredClone(job.public);
      } catch (error) {
        await this.finish(job, 'failed');
        throw error;
      } finally {
        job.initialization = undefined;
      }
    } finally {
      if (ownsCreation) this.creating = false;
      if (source.kind === 'upload') source.key.fill(0);
    }
  }
  async upload(
    id: string,
    actor: string,
    session: string,
    chunks: AsyncIterable<Uint8Array>,
    bytes: number,
    disconnect: () => void = () => {},
  ) {
    const job = this.owned(id, actor, session);
    if (job.public.state !== 'uploading' || job.task)
      throw new RestoreRegistryError(409, 'This upload is already being processed.');
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_ARCHIVE_BYTES)
      throw new RestoreRegistryError(413, 'Encrypted backup exceeds its size limit.');
    const task = async () => {
      const releaseDrain = this.db.maintenance?.cancelOnDrain(job.controller);
      const signal = AbortSignal.any([
        job.controller.signal,
        AbortSignal.timeout(Math.max(1, job.proof.expiresAt - this.now())),
      ]);
      signal.addEventListener('abort', disconnect, { once: true });
      try {
        this.assertActive(job);
        const path = join(job.directory!, 'source.spinel');
        const output = await open(path, 'wx', 0o600);
        const guarded = async function* (self: RestoreRegistry) {
          for await (const chunk of chunks) {
            self.assertActive(job);
            signal.throwIfAborted();
            yield chunk;
          }
        };
        let sha256: string;
        try {
          sha256 = await transferArchive(guarded(this), output, signal, bytes, path);
          await output.sync();
        } finally {
          await output.close();
        }
        this.assertActive(job);
        job.public.state = 'preparing';
        await this.prepare(job, path, { bytes, sha256 }, [{ path: job.keyFile! }], signal);
      } catch (error) {
        await this.finish(job, 'failed', error);
      } finally {
        signal.removeEventListener('abort', disconnect);
        releaseDrain?.();
      }
    };
    job.task = this.db.maintenance ? this.db.maintenance.run(task) : task();
    await job.task;
    return structuredClone(job.public);
  }
  private async prepareCatalog(job: Job, selected: string) {
    let remote: RemoteStore | undefined;
    const releaseDrain = this.db.maintenance?.cancelOnDrain(job.controller);
    const signal = AbortSignal.any([
      job.controller.signal,
      AbortSignal.timeout(Math.max(1, job.proof.expiresAt - this.now())),
    ]);
    try {
      this.assertActive(job);
      const config = await this.options.configuration();
      this.assertActive(job);
      if (!config || !hasDestination(config)) throw new Error('No catalog.');
      remote = this.options.remote?.(config) ?? createDestination(config);
      const points = await this.points(config, remote, signal);
      this.assertActive(job);
      const point = points.find(({ key }) => artifactId(config, key) === selected);
      if (!point || !remote.download) throw new Error('Selected source unavailable.');
      const path = join(job.directory!, 'source.spinel');
      await remote.download(point.key, path, signal);
      this.assertActive(job);
      const info = await stat(path);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_ARCHIVE_BYTES)
        throw new Error('Source limit.');
      await chmod(path, 0o600);
      const sha256 = await this.hashFile(job, path, MAX_ARCHIVE_BYTES, signal);
      this.assertActive(job);
      await this.prepare(
        job,
        path,
        { bytes: info.size, sha256 },
        [
          { path: config.keyFile, id: config.keyId ?? 'default' },
          ...Object.entries(config.retainedKeyFiles ?? {}).map(([id, path]) => ({ id, path })),
        ],
        signal,
      );
    } catch (error) {
      await this.finish(job, 'failed', error);
    } finally {
      try {
        await remote?.close?.();
      } catch {
        await this.finish(job, 'failed');
      } finally {
        releaseDrain?.();
      }
    }
  }
  private async prepare(
    job: Job,
    archive: string,
    expectedArchive: { bytes: number; sha256: string },
    keys: { path: string; id?: string }[],
    signal: AbortSignal,
  ) {
    for (const key of keys) {
      this.assertActive(job);
      let prepared: PreparedRestoreSource;
      try {
        prepared = await prepareRestoreArchive({
          archive,
          keyFile: key.path,
          expectedArchive,
          stagingRoot: job.directory!,
          expectedOrigin: this.options.origin,
          expectedImage: this.options.image!,
          signal,
        });
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof RecoveryResourceError) throw error;
        continue;
      }
      if (key.id !== undefined && prepared.keyId !== undefined && prepared.keyId !== key.id) {
        await prepared.dispose();
        continue;
      }
      job.prepared = prepared;
      break;
    }
    this.assertActive(job);
    if (!job.prepared) throw new Error('No compatible source.');
    await this.eraseKey(job);
    this.assertActive(job);
    const path = join(job.directory!, 'preview-current.sqlite');
    const pages = Number(this.db.prepare('PRAGMA page_count').get()!.page_count);
    const pageSize = Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
    const size = pages * pageSize;
    const disk = await statfs(job.directory!, { bigint: true });
    if (
      !Number.isSafeInteger(size) ||
      size < 4096 ||
      size > DATABASE_LIMIT ||
      disk.bavail * disk.bsize < BigInt(size) + BigInt(TRANSFER_DISK_RESERVE)
    )
      throw new Error('Preview resource limit.');
    this.assertActive(job);
    await backup(this.db, path);
    await chmod(path, 0o600);
    this.assertActive(job);
    const databaseBytes = (await stat(path)).size;
    const databaseSha256 = await this.hashFile(job, path, DATABASE_LIMIT, signal);
    this.assertActive(job);
    const preview = await reconcilePreparedRestore({
      candidate: job.prepared,
      current: { databasePath: path, databaseBytes, databaseSha256 },
      stagingRoot: job.directory!,
      expectedOrigin: this.options.origin,
      expectedImage: this.options.image!,
      spacesEnabled: this.options.spacesEnabled,
      now: this.now(),
      signal,
    });
    try {
      this.assertActive(job);
      const report = preview.reconciliation;
      if (!report) throw new Error('Missing reconciliation preview.');
      const counts: RestorePreview = {
        provisional: true,
        currentAccounts: report.credentials.currentAccounts,
        currentPasskeys: report.credentials.currentPasskeys,
        sharingRemoved: report.grants.removed,
        sharingDowngraded: report.grants.downgraded,
        isolatedItems: report.ownership.isolatedItems,
        isolatedGroups: report.ownership.isolatedGroups,
        detachedRoots: report.ownership.detachedRoots,
        heldTrashBatches: report.ownership.heldTrashBatches,
      };
      if (!validRestorePreview(counts)) throw new Error('Invalid reconciliation preview.');
      if (
        !Number.isSafeInteger(preview.databaseBytes) ||
        preview.databaseBytes < 4096 ||
        preview.databaseBytes > DATABASE_LIMIT
      )
        throw new Error('Invalid preview size.');
      job.previewDatabaseBytes = preview.databaseBytes;
      job.public.preview = counts;
      job.public.bytes = expectedArchive.bytes;
      job.public.sourceSha256 = expectedArchive.sha256;
      job.public.sourceCreatedAt = job.prepared.recovery.createdAt;
      const verification = {
        applicationCompatible: true as const,
        sourceCompatible: true as const,
        databaseVerified: true as const,
        tables: job.prepared.tables,
        rows: job.prepared.rows,
        snapshots: job.prepared.snapshots,
        images: job.prepared.images,
      };
      if (!validRestoreVerification(verification))
        throw new Error('Invalid verification coverage.');
      job.public.verification = verification;
    } finally {
      await preview.dispose();
      await rm(path, { force: true });
    }
    this.assertActive(job);
    const estimate = await this.control().estimate({
      ...job.public.target,
      archiveBytes: expectedArchive.bytes,
      databaseBytes: job.prepared.databaseBytes,
      previewDatabaseBytes: job.previewDatabaseBytes!,
    });
    this.assertActive(job);
    if (
      !estimate ||
      estimate.target?.generationId !== job.public.target.generationId ||
      estimate.target?.epoch !== job.public.target.epoch ||
      !validRestoreResources(estimate.resources)
    )
      throw new Error('Invalid capacity evidence.');
    job.public.resources = structuredClone(estimate.resources);
    if (!estimate.resources.sufficient) throw new RecoveryResourceError('disk-space');
    job.public.confirmation = digest({
      source: expectedArchive,
      target: job.public.target,
      origin: this.options.origin,
      image: this.options.image,
      spacesEnabled: this.options.spacesEnabled,
      preview: job.public.preview,
      previewDatabaseBytes: job.previewDatabaseBytes,
      verification: job.public.verification,
      consequencesVersion: 1,
    });
    await rm(archive, { force: true }); // verified source owns its own authenticated ciphertext copy
    this.assertActive(job);
    job.public.state = 'ready';
  }
  private async eraseKey(job: Job) {
    if (job.keyFile) {
      await rm(job.keyFile, { force: true });
      job.keyFile = undefined;
    }
  }
  async confirm(
    id: string,
    actor: string,
    session: string,
    confirmation: string,
    proof: RestoreAuthority,
  ) {
    const job = this.owned(id, actor, session);
    if (confirmation !== job.public.confirmation || !confirmation || !job.public.preview)
      throw new RestoreRegistryError(
        409,
        'Confirm the current source, target and restore consequences.',
      );
    if (job.public.state === 'started') return structuredClone(job.public);
    if (job.admissionFailureObserved) return structuredClone(job.public);
    if (['admitting', 'accepted'].includes(job.public.state) && job.task) {
      await job.task;
      return structuredClone(job.public);
    }
    if (!['ready', 'admitting', 'accepted'].includes(job.public.state))
      throw new RestoreRegistryError(409, 'Restore preparation is not ready.');
    if (!job.admission) {
      if (
        !job.previewDatabaseBytes ||
        !validRestoreResources(job.public.resources) ||
        !job.public.resources.sufficient ||
        !validRestoreVerification(job.public.verification)
      )
        throw new RestoreRegistryError(409, 'Prepare and verify this restore again.');
      if (proof.actorId !== actor || proof.sessionHash !== session)
        throw new RestoreRegistryError(409, 'Restore confirmation belongs to another account.');
      job.proof = structuredClone(proof);
      this.assertActive(job);
      const source = job.prepared!;
      job.admission = {
        id,
        ...job.public.target,
        authority: structuredClone(proof),
        confirmedAt: this.now(),
        previewDatabaseBytes: job.previewDatabaseBytes,
        source: {
          archive: { ...source.archive },
          databasePath: source.databasePath,
          databaseBytes: source.databaseBytes,
          databaseSha256: source.databaseSha256,
          recovery: { ...source.recovery },
        },
        preview: { ...job.public.preview },
        consequenceEnvelope: 1,
      };
      // An uncertain IPC outcome must not expire the only source or its retention hold.
      this.db
        .prepare('UPDATE backup_state SET lease=? WHERE id=1 AND owner=?')
        .run(Number.MAX_SAFE_INTEGER, job.owner);
    }
    const task = async () => {
      try {
        const control = this.control();
        if (!job.ack) {
          job.public.state = 'admitting';
          // Retain the exact confirmed request for host recovery after an app crash.
          // No cleanup path removes this marker until custody is acknowledged.
          if (!job.handoffWritten) {
            const temporary = join(job.directory!, 'handoff-pending.json');
            const marker = await open(temporary, 'wx', 0o600);
            try {
              await marker.writeFile(JSON.stringify(job.admission));
              await marker.sync();
            } finally {
              await marker.close();
            }
            await rename(temporary, join(job.directory!, 'handoff.json'));
            const directory = await open(job.directory!, 'r');
            try {
              await directory.sync();
            } finally {
              await directory.close();
            }
            job.handoffWritten = true;
          }
          const ack = await control.admit(structuredClone(job.admission!));
          const intent = ack.record.intent;
          if (
            !ack.custody ||
            ack.record.phase !== 'source-retained' ||
            !this.matchesAdmission(job, ack.record) ||
            intent.continuationHash !==
              createHash('sha256')
                .update(ack.continuationToken ?? '')
                .digest('hex') ||
            !/^[A-Za-z0-9_-]{43}$/.test(ack.continuationToken ?? '')
          )
            throw new Error('Custody ACK does not match.');
          job.ack = ack;
          job.public.state = 'accepted';
        }
        if (!job.custodyReleased) {
          await this.cleanup(job);
          this.releaseLease(job);
          job.custodyReleased = true;
        }
        const result = await control.begin({
          id,
          intentHash: job.ack.record.intentHash,
          continuationToken: job.ack.continuationToken!,
        });
        if (result.record.intentHash !== job.ack.record.intentHash || !result.record.execution)
          throw new Error('Restore plan not published.');
        job.public.state = 'started';
        job.public.error = null;
      } catch (error) {
        if (
          job.ack &&
          job.custodyReleased &&
          error instanceof RecoveryResourceError &&
          error.code === 'disk-space'
        ) {
          job.public.resources = null;
          job.public.error = new RecoveryResourceError('disk-space').message;
        } else job.public.error = HANDOFF_FAILURE;
      }
    };
    job.admissionAttempt++;
    job.task = task();
    await job.task;
    job.task = undefined;
    return structuredClone(job.public);
  }
  private releaseLease(job: Job) {
    this.db
      .prepare('UPDATE backup_state SET lease=0,owner=NULL,job=NULL WHERE id=1 AND owner=?')
      .run(job.owner);
  }
  private async cleanup(job: Job) {
    await this.eraseKey(job);
    await job.prepared?.dispose();
    job.prepared = undefined;
    if (job.directory) {
      await rm(job.directory, { recursive: true, force: true });
      job.directory = undefined;
    }
  }
  private async finish(job: Job, state: 'failed' | 'cancelled' | 'expired', error?: unknown) {
    if (job.admission) return; // ambiguous supervisor custody requires explicit recovery
    if (job.finishing) return job.finishing;
    job.controller.abort();
    job.finishing = (async () => {
      try {
        await this.cleanup(job);
        this.releaseLease(job);
        job.public.state = state;
        job.public.error =
          state !== 'failed'
            ? null
            : error instanceof RecoveryResourceError
              ? new RecoveryResourceError(error.code).message
              : FAILURE;
      } catch {
        this.db
          .prepare('UPDATE backup_state SET lease=? WHERE id=1 AND owner=?')
          .run(Number.MAX_SAFE_INTEGER, job.owner);
        job.public.state = 'failed';
        job.public.error =
          'Private restore staging could not be removed. Recovery cleanup is required.';
      }
    })();
    await job.finishing;
    job.finishing = undefined;
  }
  async cancel(id: string, actor: string, session: string) {
    const job = this.owned(id, actor, session);
    this.assertOperator(actor, session);
    await this.reconcileAdmission(() => this.assertOperator(actor, session));
    this.assertOperator(actor, session);
    if (terminal.has(job.public.state)) return structuredClone(job.public);
    if (job.admission)
      throw new RestoreRegistryError(
        409,
        'Restore was confirmed. Its source remains held until supervised recovery resolves.',
      );
    job.controller.abort();
    await job.initialization?.catch(() => {});
    await job.task;
    await this.finish(job, 'cancelled');
    return structuredClone(job.public);
  }
  private async expire() {
    const job = this.job;
    if (
      !job ||
      job.admission ||
      terminal.has(job.public.state) ||
      this.now() < job.public.expiresAt
    )
      return;
    job.controller.abort();
    await job.initialization?.catch(() => {});
    await job.task;
    await this.finish(job, 'expired');
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    await this.cleanupTask;
    const job = this.job;
    if (!job) return;
    if (!job.admission) job.controller.abort();
    await job.initialization?.catch(() => {});
    await job.task;
    if (!job.admission) await this.finish(job, 'cancelled');
  }
}
