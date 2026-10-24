import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { DatabaseSync } from '../../../server/database.ts';
import { makeArchive, privateFile, readKey } from './archive.ts';
import type { Recovery } from './archive.ts';
import { expiredBackups, loadConfig, SpacesStore } from './spaces.ts';
import type { RemoteStore } from './spaces.ts';
import { observeJob } from '../health/jobs.ts';
import type { ObserveJob } from '../health/jobs.ts';

const HOUR = 60 * 60_000;
interface State {
  last_attempt: number | null;
  last_good: number | null;
  error: string | null;
  lease: number;
  owner: string | null;
}
export interface BackupOptions {
  databasePath: string;
  origin: string;
  image?: string;
  configPath?: string;
  now?: () => number;
  // A transport seam for failure/retention tests; production always uses Spaces.
  remote?: (config: Awaited<ReturnType<typeof loadConfig>>) => RemoteStore;
  observe?: ObserveJob;
}
export class BackupService {
  db: DatabaseSync;
  options: BackupOptions;
  now: () => number;
  active?: Promise<boolean>;
  timer?: ReturnType<typeof setInterval>;
  constructor(db: DatabaseSync, options: BackupOptions) {
    this.db = db;
    this.options = options;
    this.now = options.now ?? Date.now;
    db.exec(`CREATE TABLE IF NOT EXISTS backup_state (
      id INTEGER PRIMARY KEY CHECK(id=1), last_attempt INTEGER, last_good INTEGER,
      error TEXT, lease INTEGER NOT NULL DEFAULT 0, owner TEXT
    ) STRICT; INSERT OR IGNORE INTO backup_state (id) VALUES (1);`);
  }
  state() {
    return this.db.prepare('SELECT * FROM backup_state WHERE id=1').get() as unknown as State;
  }
  status() {
    const state = this.state();
    return {
      configured: !!this.options.configPath,
      lastAttempt: state.last_attempt,
      lastGood: state.last_good,
      running: state.lease > this.now(),
      error:
        state.error ??
        (state.owner && state.lease <= this.now()
          ? 'The previous backup was interrupted. A retry is due.'
          : null),
      overdue:
        !!this.options.configPath && (!state.last_good || this.now() - state.last_good > 26 * HOUR),
    };
  }
  start() {
    if (!this.options.configPath) return;
    const tick = () => {
      const state = this.state(),
        now = this.now();
      const due = new Date(now);
      due.setUTCHours(2, 0, 0, 0);
      if (due.getTime() > now) due.setUTCDate(due.getUTCDate() - 1);
      if (
        (!!state.error || !!state.owner || !state.last_good || state.last_good < due.getTime()) &&
        (!state.last_attempt || now - state.last_attempt >= HOUR)
      )
        void this.run().catch(() =>
          console.error('Backup scheduler failed; check database availability.'),
        );
    };
    tick();
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
  }
  run(): Promise<boolean> {
    if (this.active) return this.active;
    const owner = randomUUID(),
      now = this.now();
    const claim = this.db
      .prepare(
        'UPDATE backup_state SET lease=?, owner=?, last_attempt=?, error=NULL WHERE id=1 AND lease<=?',
      )
      .run(now + HOUR, owner, now, now);
    if (!claim.changes) return Promise.resolve(false);
    const finish = observeJob(this.options.observe);
    this.active = this.perform(owner)
      .then(
        (result) => {
          let observedSuccess = false;
          try {
            observedSuccess = result && !this.status().error;
          } catch {
            /* Reporting cannot change the backup result. */
          }
          finish(observedSuccess);
          return result;
        },
        (error) => {
          finish(false);
          throw error;
        },
      )
      .finally(() => {
        this.active = undefined;
      });
    return this.active;
  }
  private async perform(owner: string) {
    let archive: Awaited<ReturnType<typeof makeArchive>> | undefined;
    let remote: RemoteStore | undefined;
    const heartbeat = setInterval(
      () =>
        this.db
          .prepare('UPDATE backup_state SET lease=? WHERE id=1 AND owner=?')
          .run(this.now() + HOUR, owner),
      60_000,
    );
    heartbeat.unref();
    try {
      if (!this.options.configPath) throw new Error('Not configured');
      const config = await loadConfig(this.options.configPath);
      const recovery: Recovery = {
        format: 1,
        createdAt: new Date(this.now()).toISOString(),
        origin: this.options.origin,
        image: this.options.image ?? '',
        runtimeEnvironment: (await privateFile(config.runtimeEnvironmentFile)).toString(),
      };
      archive = await makeArchive(
        this.db,
        dirname(this.options.databasePath),
        await readKey(config.keyFile),
        recovery,
      );
      remote = this.options.remote?.(config) ?? new SpacesStore(config);
      const key = `${config.prefix}/${recovery.createdAt.replaceAll(':', '-')}-${randomUUID()}.spinel`;
      const signal = AbortSignal.timeout(30 * 60_000);
      await remote.put(key, archive.archive, archive.sha256, signal);
      // Record a verified offsite recovery point even if subsequent retention fails.
      this.db
        .prepare('UPDATE backup_state SET last_good=? WHERE id=1 AND owner=?')
        .run(this.now(), owner);
      for (const old of expiredBackups(
        await remote.list(signal),
        config.prefix,
        new Date(this.now()),
      ))
        if (old !== key) await remote.remove(old, signal);
      this.db.prepare('UPDATE backup_state SET error=NULL WHERE id=1 AND owner=?').run(owner);
      return true;
    } catch {
      // SDK errors may contain credentials or request details. Never persist/log them.
      this.db
        .prepare('UPDATE backup_state SET error=? WHERE id=1 AND owner=?')
        .run(
          'Backup or retention failed. Check the private backup configuration, storage access and free disk space, then retry.',
          owner,
        );
      return false;
    } finally {
      clearInterval(heartbeat);
      if (remote instanceof SpacesStore) remote.close();
      try {
        await archive?.dispose();
      } catch {
        this.db
          .prepare('UPDATE backup_state SET error=? WHERE id=1 AND owner=?')
          .run(
            'Backup staging cleanup failed. Check free space and encrypted staging permissions.',
            owner,
          );
      } finally {
        this.db
          .prepare('UPDATE backup_state SET lease=0, owner=NULL WHERE id=1 AND owner=?')
          .run(owner);
      }
    }
  }
  async close() {
    clearInterval(this.timer);
    await this.active;
  }
}
