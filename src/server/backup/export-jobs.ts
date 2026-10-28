import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from '../../../server/database.ts';
import { makeArchive, privateFile, readKey, restoreArchive } from './archive.ts';
import { hasDestination } from './config.ts';
import type { BackupConfig } from './config.ts';
import { createDestination } from './destination.ts';
import type { RemoteStore } from './destination.ts';
import { backupTime } from './spaces.ts';
import { MAX_ARCHIVE_BYTES } from './transfer.ts';
import { RecoveryResourceError } from './resource-error.ts';

const PREPARE_MS = 30 * 60_000;
const DELIVERY_MS = 10 * 60_000;
const FAILURE =
  'The workspace backup could not be prepared. Check the recovery key, application image and free space, then try again.';
const CLEANUP_FAILURE =
  'The workspace backup could not be removed. Check private staging permissions before trying again.';
const liveOwners = new Set<string>();
const activeStates = new Set(['preparing', 'ready', 'downloading']);

export interface ExportJob {
  id: string;
  state: 'preparing' | 'ready' | 'downloading' | 'delivered' | 'cancelled' | 'expired' | 'failed';
  createdAt: number;
  expiresAt: number | null;
  bytes: number | null;
  keyId: string | null;
  error: string | null;
}
interface PrivateJob {
  public: ExportJob;
  session: string;
  owner: string;
  controller: AbortController;
  path?: string;
  directory?: string;
  task?: Promise<void>;
  finishing?: Promise<void>;
  heartbeat?: ReturnType<typeof setInterval>;
  heartbeatTask?: Promise<void>;
}
interface Options {
  databasePath: string;
  origin: string;
  image?: string;
  now?: () => number;
  configuration(): Promise<BackupConfig>;
  remote?: (config: BackupConfig) => RemoteStore;
}
interface LeaseState {
  owner: string | null;
  lease: number;
  job: string | null;
}

/** Fixed, non-content messages only. HTTP routes must never expose raw I/O errors. */
export class ExportError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ExportError';
    this.status = status;
  }
}

function destinationIdentity(config: BackupConfig) {
  return config.type === 'filesystem'
    ? ['filesystem', config.root, config.rootDevice, config.rootInode, config.prefix]
    : hasDestination(config)
      ? [config.type ?? 'spaces', config.region, config.bucket, config.prefix]
      : ['manual', config.prefix];
}
function artifactId(config: BackupConfig, key: string) {
  return createHash('sha256')
    .update(JSON.stringify([destinationIdentity(config), key]))
    .digest('hex');
}
function ownerAlive(owner: string | null) {
  const match = owner?.match(/^export:(\d+):[a-f0-9-]{36}$/);
  if (!match) return true;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  if (pid === process.pid) return liveOwners.has(owner!);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Lack of permission is not proof that the other process stopped.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** One private retained archive per database. A ready/downloaded selection keeps
 * the existing persisted recovery lease, so scheduled retention cannot race it.
 * The lease lasts only through bounded preparation and browser delivery. */
export class ExportJobs {
  private readonly db: DatabaseSync;
  private readonly options: Options;
  private readonly now: () => number;
  private readonly namespace: string;
  private job?: PrivateJob;
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private closingTask?: Promise<void>;
  private initialized = false;
  private ticking?: Promise<void>;
  private reconciling?: Promise<boolean>;

  constructor(db: DatabaseSync, options: Options) {
    this.db = db;
    this.options = options;
    this.now = options.now ?? Date.now;
    // Two application databases may share a parent; neither may clean the other's jobs.
    const identity = createHash('sha256')
      .update(resolve(options.databasePath))
      .digest('hex')
      .slice(0, 24);
    this.namespace = `.backup-export-${identity}-`;
  }
  async start() {
    if (this.timer || this.closing) return;
    await this.tick();
    if (this.timer || this.closing) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, 5_000);
    this.timer.unref();
  }
  /** Fresh admission for periodic cleanup; skipped work remains due on resume. */
  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    if (this.closing) return Promise.resolve();
    const task = this.db.runBackground(async () => {
      if (!this.initialized) await this.reconcile();
      await this.expire();
    });
    if (!task) return Promise.resolve();
    this.ticking = task.finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }
  private state() {
    return this.db
      .prepare('SELECT owner,lease,job FROM backup_state WHERE id=1')
      .get() as unknown as LeaseState;
  }
  private requireLease(job: PrivateJob) {
    const state = this.state();
    if (state.owner !== job.owner || state.lease <= this.now()) {
      job.controller.abort();
      throw new ExportError(409, 'Recovery work changed. Refresh backup status and try again.');
    }
    job.controller.signal.throwIfAborted();
  }
  private release(owner: string) {
    this.db
      .prepare('UPDATE backup_state SET lease=0,owner=NULL,job=NULL WHERE id=1 AND owner=?')
      .run(owner);
    liveOwners.delete(owner);
  }
  private reconcile(): Promise<boolean> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = this.reconcileStaging()
      .then((completed) => {
        if (completed) this.initialized = true;
        return completed;
      })
      .finally(() => {
        this.reconciling = undefined;
      });
    return this.reconciling;
  }
  private async reconcileStaging() {
    const state = this.state();
    if (state.lease > this.now() && (state.job !== 'export' || ownerAlive(state.owner)))
      return false;
    const owner = `export:${process.pid}:${randomUUID()}`;
    const claim = this.db
      .prepare(
        "UPDATE backup_state SET lease=?,owner=?,job='export' WHERE id=1 AND lease=? AND owner IS ?",
      )
      .run(this.now() + PREPARE_MS, owner, state.lease, state.owner);
    if (!claim.changes) return false;
    liveOwners.add(owner);
    try {
      for (const entry of await readdir(dirname(this.options.databasePath), {
        withFileTypes: true,
      })) {
        if (
          !entry.name.startsWith(this.namespace) ||
          !entry.isDirectory() ||
          !/^[a-f0-9-]{36}-[A-Za-z0-9]+$/.test(entry.name.slice(this.namespace.length))
        )
          continue;
        const path = join(dirname(this.options.databasePath), entry.name);
        const info = await lstat(path);
        if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
          continue;
        await rm(path, { recursive: true, force: true });
      }
    } catch {
      throw new ExportError(503, CLEANUP_FAILURE);
    } finally {
      this.release(owner);
    }
    return true;
  }
  private async expire() {
    const job = this.job;
    if (!job) return;
    if (
      job.public.expiresAt !== null &&
      this.now() >= job.public.expiresAt &&
      activeStates.has(job.public.state)
    )
      await this.finish(job, 'expired');
    else if (job.directory && !activeStates.has(job.public.state))
      await this.finish(job, job.public.state);
  }
  async current(session: string): Promise<ExportJob | null> {
    await this.expire();
    return this.job?.session === session ? { ...this.job.public } : null;
  }
  async create(session: string, artifact?: string): Promise<ExportJob> {
    if (this.closing)
      throw new ExportError(503, 'The server is stopping. Try again after it restarts.');
    await this.expire();
    const previous = this.job;
    if (previous && (activeStates.has(previous.public.state) || previous.directory))
      throw new ExportError(
        409,
        'A backup is already being prepared or downloaded. Finish or cancel it before trying again.',
      );
    if (
      typeof session !== 'string' ||
      !session ||
      (artifact !== undefined && !/^[a-f0-9]{64}$/.test(artifact))
    )
      throw new ExportError(400, 'Choose a workspace backup and try again.');
    let config: BackupConfig;
    try {
      config = await this.options.configuration();
    } catch {
      throw new ExportError(503, FAILURE);
    }
    if (config.manualDownload === false)
      throw new ExportError(403, 'Workspace downloads are disabled by deployment policy.');
    if (artifact !== undefined && !hasDestination(config))
      throw new ExportError(404, 'That workspace backup is no longer available. Refresh the list.');
    await this.reconcile();
    if (this.closing)
      throw new ExportError(503, 'The server is stopping. Try again after it restarts.');
    const id = randomUUID(),
      owner = `export:${process.pid}:${id}`;
    const claim = this.db
      .prepare("UPDATE backup_state SET lease=?,owner=?,job='export' WHERE id=1 AND lease<=?")
      .run(this.now() + PREPARE_MS + 60_000, owner, this.now());
    if (!claim.changes)
      throw new ExportError(
        409,
        'A backup or recovery check is running. Wait for it to finish and try again.',
      );
    liveOwners.add(owner);
    const job: PrivateJob = {
      public: {
        id,
        state: 'preparing',
        createdAt: this.now(),
        expiresAt: this.now() + PREPARE_MS,
        bytes: null,
        keyId: artifact === undefined ? (config.keyId ?? 'default') : null,
        error: null,
      },
      session,
      owner,
      controller: new AbortController(),
    };
    this.job = job;
    job.heartbeat = setInterval(() => {
      void this.heartbeat(job).catch(() => {});
    }, 30_000);
    job.heartbeat.unref();
    // The create response can finish while preparation is still active. Retain
    // a separate inherited permit through remote close and final cleanup too.
    const prepare = () => this.prepare(job, config, artifact);
    job.task = this.db.maintenance ? this.db.maintenance.run(prepare) : prepare();
    return { ...job.public };
  }
  private heartbeat(job: PrivateJob): Promise<void> {
    if (job.heartbeatTask) return job.heartbeatTask;
    if (this.closing || this.job !== job) return Promise.resolve();
    const task = this.db.runBackground(async () => {
      try {
        this.requireLease(job);
        this.db
          .prepare('UPDATE backup_state SET lease=? WHERE id=1 AND owner=?')
          .run((job.public.expiresAt ?? this.now()) + 60_000, job.owner);
        await this.expire();
      } catch {
        await this.finish(job, 'failed', FAILURE);
      }
    });
    if (!task) return Promise.resolve();
    job.heartbeatTask = task.finally(() => {
      job.heartbeatTask = undefined;
    });
    return job.heartbeatTask;
  }
  private async points(config: BackupConfig, remote: RemoteStore, signal: AbortSignal) {
    const keys = await remote.list(signal);
    signal.throwIfAborted();
    if (keys.length > 10_000) throw new Error('Backup catalog exceeds its entry limit.');
    return keys
      .map((key) => ({ key, time: backupTime(key, config.prefix) }))
      .filter((entry): entry is { key: string; time: Date } => entry.time !== null)
      .sort((a, b) => b.time.getTime() - a.time.getTime() || b.key.localeCompare(a.key));
  }
  async catalog(): Promise<{ entries: { id: string; createdAt: number }[] }> {
    let remote: RemoteStore | undefined;
    try {
      const config = await this.options.configuration();
      if (!hasDestination(config)) return { entries: [] };
      if (config.manualDownload === false)
        throw new ExportError(403, 'Workspace downloads are disabled by deployment policy.');
      remote = this.options.remote?.(config) ?? createDestination(config);
      const points = await this.points(config, remote, AbortSignal.timeout(30_000));
      return {
        entries: points.map(({ key, time }) => ({
          id: artifactId(config, key),
          createdAt: time.getTime(),
        })),
      };
    } catch (error) {
      if (error instanceof ExportError) throw error;
      throw new ExportError(
        503,
        'Saved backups could not be loaded. Check the destination and try again.',
      );
    } finally {
      await remote?.close?.();
    }
  }
  private async prepare(job: PrivateJob, config: BackupConfig, selected?: string) {
    let remote: RemoteStore | undefined;
    const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(PREPARE_MS)]);
    try {
      this.requireLease(job);
      job.directory = await mkdtemp(
        join(dirname(this.options.databasePath), `${this.namespace}${job.public.id}-`),
      );
      await chmod(job.directory, 0o700);
      signal.throwIfAborted();
      if (selected === undefined) {
        const archive = await makeArchive(
          this.db,
          job.directory,
          await readKey(config.keyFile),
          {
            format: 1,
            createdAt: new Date(job.public.createdAt).toISOString(),
            origin: this.options.origin,
            image: this.options.image ?? '',
            runtimeEnvironment: (await privateFile(config.runtimeEnvironmentFile)).toString(),
            keyId: config.keyId ?? 'default',
          },
          { signal },
        );
        job.path = archive.archive;
      } else {
        if (!hasDestination(config)) throw new Error('No backup destination.');
        remote = this.options.remote?.(config) ?? createDestination(config);
        if (!remote.download) throw new Error('Backup retrieval is unavailable.');
        const point = (await this.points(config, remote, signal)).find(
          ({ key }) => artifactId(config, key) === selected,
        );
        if (!point)
          throw new ExportError(
            404,
            'That workspace backup is no longer available. Refresh the list.',
          );
        this.requireLease(job);
        job.path = join(job.directory, 'backup.spinel');
        await remote.download(point.key, job.path, signal);
        // The catalog never authorizes arbitrary keys. Authenticate the selected
        // encrypted bytes and inventory before handing them to the browser.
        for (const [id, keyFile] of [
          [config.keyId ?? 'default', config.keyFile],
          ...Object.entries(config.retainedKeyFiles ?? {}),
        ]) {
          const restored = join(job.directory, `check-${randomUUID()}`);
          try {
            const recovery = await restoreArchive(
              job.path,
              await readKey(keyFile),
              job.directory,
              restored,
              { requireInventory: true, signal },
            );
            if (recovery.origin !== this.options.origin || (recovery.keyId ?? 'default') !== id)
              throw new Error('Backup recovery identity differs.');
            job.public.keyId = id;
            break;
          } catch (error) {
            signal.throwIfAborted();
            if (error instanceof RecoveryResourceError) throw error;
          } finally {
            await rm(restored, { recursive: true, force: true });
          }
        }
        if (!job.public.keyId) throw new Error('Backup could not be authenticated.');
      }
      this.requireLease(job);
      signal.throwIfAborted();
      const info = await stat(job.path);
      if (info.size > MAX_ARCHIVE_BYTES) throw new RecoveryResourceError('archive-size');
      if (!info.isFile() || info.size < 37 || (info.mode & 0o077) !== 0)
        throw new Error('Backup is unavailable.');
      job.public.bytes = info.size;
      job.public.expiresAt = this.now() + DELIVERY_MS;
      this.db
        .prepare('UPDATE backup_state SET lease=? WHERE id=1 AND owner=?')
        .run(job.public.expiresAt + 60_000, job.owner);
      job.public.state = 'ready';
    } catch (error) {
      if (activeStates.has(job.public.state)) {
        job.public.state = 'failed';
        job.public.error = error instanceof RecoveryResourceError ? error.message : FAILURE;
      }
    } finally {
      try {
        await remote?.close?.();
      } catch {
        job.public.state = 'failed';
        job.public.error = FAILURE;
      }
      if (!activeStates.has(job.public.state)) await this.cleanup(job);
    }
  }
  private async cleanup(job: PrivateJob) {
    this.db.maintenance?.assertWrite();
    clearInterval(job.heartbeat);
    try {
      if (job.directory) await rm(job.directory, { recursive: true, force: true });
      job.directory = undefined;
      job.path = undefined;
      this.release(job.owner);
    } catch {
      job.public.state = 'failed';
      job.public.error = CLEANUP_FAILURE;
    }
  }
  private finish(
    job: PrivateJob,
    state: ExportJob['state'],
    error: string | null = null,
  ): Promise<void> {
    this.db.maintenance?.assertWrite();
    if (job.finishing) return job.finishing;
    if (!activeStates.has(job.public.state) && !job.directory) return Promise.resolve();
    job.public.state = state;
    job.public.error = error;
    job.controller.abort();
    job.finishing = (async () => {
      await job.task;
      await this.cleanup(job);
    })().finally(() => {
      job.finishing = undefined;
    });
    return job.finishing;
  }
  async cancel(session: string, id: string): Promise<ExportJob> {
    await this.expire();
    const job = this.owned(session, id);
    if (activeStates.has(job.public.state)) await this.finish(job, 'cancelled');
    return { ...job.public };
  }
  private owned(session: string, id: string) {
    if (!this.job || this.job.session !== session || this.job.public.id !== id)
      throw new ExportError(404, 'That workspace backup is unavailable. Create another backup.');
    return this.job;
  }
  async claim(session: string, id: string) {
    let config: BackupConfig;
    try {
      config = await this.options.configuration();
    } catch {
      throw new ExportError(503, 'Backup policy could not be checked. Refresh and try again.');
    }
    await this.expire();
    const job = this.owned(session, id);
    if (config.manualDownload === false) {
      await this.finish(job, 'cancelled');
      throw new ExportError(403, 'Workspace downloads are disabled by deployment policy.');
    }
    if (job.public.state !== 'ready' || !job.path || job.public.bytes === null)
      throw new ExportError(409, 'That workspace backup is not ready. Refresh its status.');
    this.requireLease(job);
    job.public.state = 'downloading';
    job.public.expiresAt = this.now() + DELIVERY_MS;
    this.db
      .prepare('UPDATE backup_state SET lease=? WHERE id=1 AND owner=?')
      .run(job.public.expiresAt + 60_000, job.owner);
    return {
      path: job.path,
      bytes: job.public.bytes,
      signal: job.controller.signal,
      finish: (success: boolean) =>
        this.finish(
          job,
          success ? 'delivered' : 'failed',
          success ? null : 'The download was interrupted. Create another backup and try again.',
        ),
    };
  }
  close(): Promise<void> {
    if (this.closingTask) return this.closingTask;
    this.closing = true;
    clearInterval(this.timer);
    const job = this.job;
    clearInterval(job?.heartbeat);
    this.closingTask = (async () => {
      const cleanup = async () => {
        await this.reconciling;
        if (job && (activeStates.has(job.public.state) || job.directory))
          await this.finish(job, 'cancelled');
      };
      // App shutdown has already closed admission and drained. Without a fresh
      // permit, retained staging/lease cleanup belongs to the next running boot.
      // Direct mode preserves its ordinary cancellation and cleanup behavior.
      const finalizing = this.db.maintenance?.status.available
        ? this.db.runBackground(cleanup)
        : cleanup();
      try {
        const settled = await Promise.allSettled([
          finalizing,
          this.ticking,
          this.reconciling,
          job?.task,
          job?.finishing,
          job?.heartbeatTask,
        ]);
        const failed = settled.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      } finally {
        if (job) liveOwners.delete(job.owner);
      }
    })();
    return this.closingTask;
  }
}
