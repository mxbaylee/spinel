import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from '../../../server/database.ts';
import { makeArchive, privateFile, readKey, validateRecovery } from './archive.ts';
import type { Recovery } from './archive.ts';
import { hasDestination, loadConfig } from './config.ts';
import type { BackupConfig } from './config.ts';
import { createDestination } from './destination.ts';
import type { RemoteStore } from './destination.ts';
import { backupTime, expiredBackups } from './spaces.ts';
import { verifyArchive } from './verification.ts';
import { RecoveryResourceError } from './resource-error.ts';
import { observeJob } from '../health/jobs.ts';
import type { ObserveJob } from '../health/jobs.ts';
import { ExportJobs } from './export-jobs.ts';
import { MAX_ARCHIVE_BYTES } from './transfer.ts';

const HOUR = 60 * 60_000;
const BACKUP_FAILURE =
  'Backup or retention failed. Check the private backup configuration, storage access and free disk space, then retry.';
const VERIFY_FAILURE =
  'Recovery verification failed. Keep the source backup and check recovery keys, application compatibility, storage access and free space.';
type Job = 'backup' | 'verify';
interface State {
  last_attempt: number | null;
  last_good: number | null;
  error: string | null;
  lease: number;
  owner: string | null;
  job: Job | 'export' | null;
  publication_identity: string | null;
  publication_destination: string | null;
  publication_key_id: string | null;
}
interface VerificationState {
  last_attempt: number | null;
  last_good: number | null;
  error: string | null;
  lease: number;
  owner: string | null;
  backup_key: string | null;
  key_id: string | null;
  identity: string | null;
}
export interface BackupOptions {
  databasePath: string;
  origin: string;
  image?: string;
  configPath?: string;
  now?: () => number;
  remote?: (config: BackupConfig) => RemoteStore;
  observe?: ObserveJob;
}

function destinationIdentity(config: BackupConfig) {
  const destination =
    config.type === 'filesystem'
      ? ['filesystem', config.root, config.rootDevice, config.rootInode, config.prefix]
      : hasDestination(config)
        ? [config.type ?? 'spaces', config.region, config.bucket, config.prefix]
        : ['manual', config.prefix];
  // Credential rotation preserves existing points in the same destination.
  return createHash('sha256').update(JSON.stringify(destination)).digest('hex');
}
function dueAt(now: number, hour: number, weekday?: number) {
  const due = new Date(now);
  due.setUTCHours(hour, 0, 0, 0);
  if (weekday === undefined) {
    if (due.getTime() > now) due.setUTCDate(due.getUTCDate() - 1);
  } else {
    due.setUTCDate(due.getUTCDate() - ((due.getUTCDay() - weekday + 7) % 7));
    if (due.getTime() > now) due.setUTCDate(due.getUTCDate() - 7);
  }
  return due.getTime();
}

export class BackupService {
  db: DatabaseSync;
  options: BackupOptions;
  now: () => number;
  active?: Promise<boolean>;
  timer?: ReturnType<typeof setInterval>;
  readonly exports: ExportJobs;
  private activeJob?: Job;
  private config?: BackupConfig;
  private configGeneration = 0;
  private configError: string | null = null;
  private identity?: string;
  private closing = false;
  private ticking?: Promise<void>;
  private manualReady = false;
  private manualUnavailable =
    'Configure a recovery key and application image on the server to download a workspace backup.';

  constructor(db: DatabaseSync, options: BackupOptions) {
    this.db = db;
    this.options = options;
    this.now = options.now ?? Date.now;
    db.exec(`CREATE TABLE IF NOT EXISTS backup_state (
      id INTEGER PRIMARY KEY CHECK(id=1), last_attempt INTEGER, last_good INTEGER,
      error TEXT, lease INTEGER NOT NULL DEFAULT 0, owner TEXT
    ) STRICT; INSERT OR IGNORE INTO backup_state (id) VALUES (1);`);
    const columns = new Set(
      db
        .prepare('PRAGMA table_info(backup_state)')
        .all()
        .map((r) => r.name),
    );
    for (const name of [
      'job',
      'publication_identity',
      'publication_destination',
      'publication_key_id',
    ])
      if (!columns.has(name)) db.exec(`ALTER TABLE backup_state ADD COLUMN ${name} TEXT`);
    db.exec(`CREATE TABLE IF NOT EXISTS verification_state (
      id INTEGER PRIMARY KEY CHECK(id=1), last_attempt INTEGER, last_good INTEGER,
      error TEXT, lease INTEGER NOT NULL DEFAULT 0, owner TEXT,
      backup_key TEXT, key_id TEXT, identity TEXT
    ) STRICT; INSERT OR IGNORE INTO verification_state (id) VALUES (1);`);
    this.exports = new ExportJobs(db, { ...options, configuration: () => this.configuration() });
  }
  state() {
    return this.db.prepare('SELECT * FROM backup_state WHERE id=1').get() as unknown as State;
  }
  private verificationState() {
    return this.db
      .prepare('SELECT * FROM verification_state WHERE id=1')
      .get() as unknown as VerificationState;
  }
  private async configuration() {
    if (!this.options.configPath) throw new Error('Backup is not configured.');
    const generation = ++this.configGeneration;
    try {
      // A caller owns the configuration it read. Another request may reload
      // deployment policy while this one is checking private recovery files.
      const config = await loadConfig(this.options.configPath);
      const identity = destinationIdentity(config);
      let manualReady = false;
      let manualUnavailable =
        config.manualDownload === false
          ? 'Workspace downloads are disabled by deployment policy.'
          : 'Check the private recovery key, runtime configuration and application image on the server.';
      if (config.manualDownload !== false) {
        try {
          await readKey(config.keyFile);
          validateRecovery({
            format: 1,
            createdAt: new Date(this.now()).toISOString(),
            origin: this.options.origin,
            image: this.options.image ?? '',
            runtimeEnvironment: (await privateFile(config.runtimeEnvironmentFile)).toString(),
            keyId: config.keyId ?? 'default',
          });
          manualReady = true;
          manualUnavailable = '';
        } catch {
          /* Policy remains visible, but unusable recovery prerequisites do not look ready. */
        }
      }
      // A slower, older read must not replace the latest request's status.
      if (generation === this.configGeneration) {
        this.config = config;
        this.identity = identity;
        this.configError = null;
        this.manualReady = manualReady;
        this.manualUnavailable = manualUnavailable;
      }
      return config;
    } catch {
      if (generation === this.configGeneration) {
        this.config = undefined;
        this.identity = undefined;
        this.manualReady = false;
        this.manualUnavailable = 'Check the private backup configuration on the server.';
        this.configError =
          'Backup configuration could not be read. Check its private file and supported settings.';
      }
      throw new Error('Invalid backup configuration.');
    }
  }
  status() {
    const state = this.state(),
      verification = this.verificationState(),
      now = this.now();
    const configured = !!this.options.configPath;
    const matching = !this.identity || state.publication_identity === this.identity;
    const lastGood = matching ? state.last_good : null;
    const verificationGood =
      !this.identity || verification.identity === this.identity ? verification.last_good : null;
    const destination =
      this.config && hasDestination(this.config) ? (this.config.type ?? 'spaces') : null;
    const automatic =
      !!this.config && hasDestination(this.config) && this.config.automatic !== false;
    return {
      configured,
      destination,
      offsite:
        destination === 'spaces' &&
        matching &&
        !!lastGood &&
        state.publication_destination === destination,
      policy: {
        automatic,
        manualDownload: !!this.config && this.config.manualDownload !== false,
        manualReady: this.manualReady,
        manualUnavailable: this.manualReady ? null : this.manualUnavailable,
        backupHourUtc: this.config?.backupHourUtc ?? 2,
        retention: { daily: 7, weekly: 4, monthly: 6 },
        maxArchiveBytes: MAX_ARCHIVE_BYTES,
      },
      keyId: this.config?.keyId ?? null,
      lastAttempt: state.last_attempt,
      lastGood,
      running: state.lease > now && state.job !== 'verify' && state.job !== 'export',
      error:
        this.configError ??
        state.error ??
        (state.owner && state.job !== 'verify' && state.job !== 'export' && state.lease <= now
          ? 'The previous backup was interrupted. A retry is due.'
          : null),
      overdue: automatic && (!lastGood || now - lastGood > 26 * HOUR),
      verification: {
        lastAttempt: verification.last_attempt,
        lastGood: verificationGood,
        running: state.lease > now && state.job === 'verify',
        error:
          verification.error ??
          (state.owner && state.job === 'verify' && state.lease <= now
            ? 'The previous recovery verification was interrupted. A retry is due.'
            : null),
        overdue: automatic && (!verificationGood || now - verificationGood > 8 * 24 * HOUR),
        keyId: verification.key_id,
        lastBackup: verification.backup_key,
      },
    };
  }

  async start() {
    if (this.timer || this.closing) return;
    await this.exports.start();
    if (!this.options.configPath) return;
    // Configuration errors remain visible and retryable; they do not stop the app.
    await this.configuration().catch(() => {});
    if (this.timer || this.closing) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }
  /** Run one scheduling decision using the injected clock and real job path. */
  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.schedule()
      .catch(() => {
        console.error('Recovery scheduler failed; check database availability.');
      })
      .finally(() => {
        this.ticking = undefined;
      });
    return this.ticking;
  }
  private async schedule() {
    if (!this.options.configPath || this.active || this.closing) return;
    // Deployment changes are effective at the next scheduling decision, including
    // disabling automatic jobs without making manual recovery unavailable.
    const config = await this.configuration().catch(() => undefined);
    if (!config || !hasDestination(config) || config.automatic === false) return;
    const state = this.state(),
      now = this.now();
    if (state.lease > now) return;
    const due = dueAt(now, this.config?.backupHourUtc ?? 2);
    if (
      (!!state.error ||
        (state.owner && state.job !== 'verify') ||
        !this.status().lastGood ||
        state.last_good! < due) &&
      (!state.last_attempt || now - state.last_attempt >= HOUR)
    )
      await this.run();
    if (this.closing) return;
    const verification = this.verificationState();
    const verifyDue = dueAt(
      this.now(),
      this.config?.verificationHourUtc ?? 3,
      this.config?.verificationDayUtc ?? 0,
    );
    if (
      (!!verification.error ||
        (state.owner && state.job === 'verify') ||
        !this.status().verification.lastGood ||
        verification.last_good! < verifyDue) &&
      (!verification.last_attempt || this.now() - verification.last_attempt >= HOUR)
    )
      await this.verify();
  }
  run(): Promise<boolean> {
    return this.begin('backup');
  }
  verify(): Promise<boolean> {
    return this.begin('verify');
  }

  private begin(job: Job): Promise<boolean> {
    if (this.closing) return Promise.resolve(false);
    if (this.active) return this.activeJob === job ? this.active : Promise.resolve(false);
    const owner = randomUUID(),
      now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const claim = this.db
        .prepare('UPDATE backup_state SET lease=?, owner=?, job=? WHERE id=1 AND lease<=?')
        .run(now + HOUR, owner, job, now);
      if (claim.changes) {
        if (job === 'backup')
          this.db.prepare('UPDATE backup_state SET last_attempt=?, error=NULL WHERE id=1').run(now);
        else
          this.db
            .prepare(
              'UPDATE verification_state SET last_attempt=?, error=NULL, lease=?, owner=? WHERE id=1',
            )
            .run(now, now + HOUR, owner);
      }
      this.db.exec('COMMIT');
      if (!claim.changes) return Promise.resolve(false);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.activeJob = job;
    const finish = job === 'backup' ? observeJob(this.options.observe) : () => {};
    this.active = this.perform(job, owner)
      .then(
        (result) => {
          finish(result);
          return result;
        },
        (error) => {
          finish(false);
          throw error;
        },
      )
      .finally(() => {
        this.active = undefined;
        this.activeJob = undefined;
      });
    return this.active;
  }
  private recordError(job: Job, owner: string, message: string) {
    if (job === 'backup')
      this.db.prepare('UPDATE backup_state SET error=? WHERE id=1 AND owner=?').run(message, owner);
    else
      this.db
        .prepare('UPDATE verification_state SET error=? WHERE id=1 AND owner=?')
        .run(message, owner);
  }
  private async perform(job: Job, owner: string) {
    let archive: Awaited<ReturnType<typeof makeArchive>> | undefined;
    let remote: RemoteStore | undefined;
    let directory: string | undefined;
    let success = false;
    const signal = AbortSignal.timeout(30 * 60_000);
    const heartbeat = setInterval(() => {
      try {
        this.db
          .prepare('UPDATE backup_state SET lease=? WHERE id=1 AND owner=?')
          .run(this.now() + HOUR, owner);
        if (job === 'verify')
          this.db
            .prepare('UPDATE verification_state SET lease=? WHERE id=1 AND owner=?')
            .run(this.now() + HOUR, owner);
      } catch {
        /* The job checks its lease before publication/status changes. */
      }
    }, 60_000);
    heartbeat.unref();
    try {
      const config = await this.configuration();
      const identity = destinationIdentity(config);
      this.requireLease(owner);
      if (!hasDestination(config)) throw new Error('An automatic destination is not configured.');
      remote = this.options.remote?.(config) ?? createDestination(config);
      await remote.cleanup?.(signal);
      // The shared lease excludes both publication and verification. Only this
      // service's private, generated scratch namespace is reconciled on retry.
      const staging = dirname(this.options.databasePath);
      for (const entry of await readdir(staging, { withFileTypes: true })) {
        if (!/^\.recovery-job-[a-f0-9-]{36}-[a-zA-Z0-9]+$/.test(entry.name) || !entry.isDirectory())
          continue;
        const path = join(staging, entry.name),
          info = await lstat(path);
        if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) continue;
        await rm(path, { recursive: true, force: true });
      }
      directory = await mkdtemp(join(staging, `.recovery-job-${randomUUID()}-`));
      await chmod(directory, 0o700);
      if (job === 'backup') {
        const recovery: Recovery = {
          format: 1,
          createdAt: new Date(this.now()).toISOString(),
          origin: this.options.origin,
          image: this.options.image ?? '',
          runtimeEnvironment: (await privateFile(config.runtimeEnvironmentFile)).toString(),
          keyId: config.keyId ?? 'default',
        };
        archive = await makeArchive(this.db, directory, await readKey(config.keyFile), recovery, {
          signal,
        });
        const key = `${config.prefix}/${recovery.createdAt.replaceAll(':', '-')}-${randomUUID()}.spinel`;
        this.requireLease(owner);
        await remote.put(key, archive.archive, archive.sha256, signal);
        this.requireLease(owner);
        // Publication is distinct from isolated recovery and offsite coverage.
        this.db
          .prepare(
            'UPDATE backup_state SET last_good=?, publication_identity=?, publication_destination=?, publication_key_id=? WHERE id=1 AND owner=?',
          )
          .run(this.now(), identity, config.type ?? 'spaces', config.keyId ?? 'default', owner);
        const held = this.verificationState().backup_key;
        for (const old of expiredBackups(
          await remote.list(signal),
          config.prefix,
          new Date(this.now()),
        )) {
          this.requireLease(owner);
          if (old !== key && old !== held) await remote.remove(old, signal);
        }
      } else {
        if (!this.options.image) throw new Error('Application image is required for verification.');
        if (!remote.download) throw new Error('Destination does not support recovery retrieval.');
        const keys = (await remote.list(signal))
          .map((key) => ({ key, time: backupTime(key, config.prefix) }))
          .filter((entry) => entry.time !== null)
          .sort((a, b) => b.time!.getTime() - a.time!.getTime() || b.key.localeCompare(a.key));
        const key = keys[0]?.key;
        if (!key) throw new Error('No published recovery point.');
        this.db
          .prepare('UPDATE verification_state SET backup_key=? WHERE id=1 AND owner=?')
          .run(key, owner);
        const path = join(directory, 'candidate.spinel');
        await remote.download(key, path, signal);
        let verifiedKey: string | undefined;
        for (const [id, keyFile] of [
          [config.keyId ?? 'default', config.keyFile],
          ...Object.entries(config.retainedKeyFiles ?? {}),
        ]) {
          signal.throwIfAborted();
          try {
            const result = await verifyArchive({
              archive: path,
              keyFile,
              stagingRoot: directory,
              expectedOrigin: this.options.origin,
              expectedImage: this.options.image,
              signal,
            });
            if (result.keyId !== undefined && result.keyId !== id) continue;
            verifiedKey = id;
            break;
          } catch (error) {
            signal.throwIfAborted();
            // Resource refusal cannot improve by trying another retained key.
            if (error instanceof RecoveryResourceError) throw error;
          }
        }
        if (!verifiedKey) throw new Error('Recovery could not be verified with configured keys.');
        this.requireLease(owner);
        this.db
          .prepare(
            'UPDATE verification_state SET last_good=?, key_id=?, identity=? WHERE id=1 AND owner=?',
          )
          .run(this.now(), verifiedKey, identity, owner);
      }
      success = true;
    } catch (error) {
      // Errors can contain credentials, SQL or document data. Persist safe text only.
      this.recordError(
        job,
        owner,
        error instanceof RecoveryResourceError
          ? new RecoveryResourceError(error.code).message
          : job === 'backup'
            ? BACKUP_FAILURE
            : VERIFY_FAILURE,
      );
    } finally {
      clearInterval(heartbeat);
      let cleanupFailed = false;
      try {
        const closed = await Promise.allSettled([
          Promise.resolve().then(() => remote?.close?.()),
          Promise.resolve().then(() => archive?.dispose()),
        ]);
        if (directory) await rm(directory, { recursive: true, force: true });
        cleanupFailed = closed.some((result) => result.status === 'rejected');
      } catch {
        cleanupFailed = true;
      }
      try {
        if (cleanupFailed) {
          success = false;
          this.recordError(
            job,
            owner,
            'Recovery staging cleanup failed. Check private staging permissions and free space.',
          );
        }
      } finally {
        if (job === 'verify')
          this.db
            .prepare('UPDATE verification_state SET lease=0, owner=NULL WHERE id=1 AND owner=?')
            .run(owner);
        this.db
          .prepare('UPDATE backup_state SET lease=0, owner=NULL, job=NULL WHERE id=1 AND owner=?')
          .run(owner);
      }
    }
    return success;
  }
  private requireLease(owner: string) {
    const state = this.state();
    if (state.owner !== owner || state.lease <= this.now())
      throw new Error('Recovery lease was lost.');
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    await this.exports.close();
    await this.ticking;
    await this.active;
  }
}
