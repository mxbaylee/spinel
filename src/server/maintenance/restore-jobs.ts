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
import type { RecoveryJournal } from './journal.ts';
import { sameFile } from './journal.ts';
import { restoreIntentHash, validRestoreJobIntent } from './restore-job-intent.ts';
import type { RestoreJobIntent } from './restore-job-intent.ts';

/** Admission only. Later mutation stages must add their required evidence before
 * becoming valid persisted states. This store alone never pauses/opens a database.
 */
export interface RestoreJobRecord {
  version: 1;
  revision: number;
  intent: RestoreJobIntent;
  intentHash: string;
  phase: 'accepted' | 'source-retained' | 'failed';
  updatedAt: number;
}
const MAX_JOB_BYTES = 64 * 1024;
const MAX_JOBS = 64;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const refused = () => new Error('Restore job custody is unavailable or changed.');
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
    Object.keys(record).length === 6 &&
    record.version === 1 &&
    Number.isSafeInteger(record.revision) &&
    record.revision >= 0 &&
    record.revision <= 1_000_000 &&
    validRestoreJobIntent(record.intent) &&
    record.intent.id === id &&
    record.intentHash === restoreIntentHash(record.intent) &&
    ['accepted', 'source-retained', 'failed'].includes(record.phase) &&
    Number.isSafeInteger(record.updatedAt) &&
    record.updatedAt >= record.intent.confirmedAt
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
    if (
      target.instanceId !== state.instanceId ||
      target.generationId !== state.generationId ||
      target.epoch !== state.epoch ||
      target.databasePath !== owned.databasePath ||
      !state.databaseIdentity ||
      !sameFile(target.identity, state.databaseIdentity) ||
      !sameFile(target.identity, owned.databaseIdentity)
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
        try {
          fd = openSync(
            name,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
            0o600,
          );
          writeFileSync(fd, text);
          fsyncSync(fd);
          closeSync(fd);
          fd = undefined;
          this.check();
          renameSync(name, `/proc/self/fd/${directory}/state.json`);
          fsyncSync(directory);
          fsyncSync(this.descriptor);
          this.journal.syncRoot();
        } finally {
          if (fd !== undefined) closeSync(fd);
          try {
            unlinkSync(name);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
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
    if (jobs.some((job) => job.phase !== 'failed'))
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
      current.phase === 'failed' ||
      (phase === 'source-retained' && current.phase !== 'accepted')
    )
      throw refused();
    const now = phase === 'failed' ? this.now() : this.clock(current.intent);
    if (!Number.isSafeInteger(now)) throw refused();
    const next: RestoreJobRecord = {
      ...current,
      phase,
      revision: current.revision + 1,
      updatedAt: Math.max(now, current.updatedAt),
    };
    this.publish(next);
    if (phase !== 'failed') this.clock(current.intent);
    return structuredClone(next);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.descriptor);
  }
}
