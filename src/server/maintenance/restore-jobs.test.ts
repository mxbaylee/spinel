import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { RecoveryJournal, fileIdentity } from './journal.ts';
import { RestoreJobs } from './restore-jobs.ts';
import type { RestoreJobRecord } from './restore-jobs.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { restoreIntentHash } from './restore-job-intent.ts';

const boundaries = vi.hoisted(() => ({
  onRead: undefined as (() => void) | undefined,
  onUnlink: undefined as (() => void) | undefined,
  onClose: undefined as ((fd: number, close: () => void) => void) | undefined,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    closeSync: (fd: number) => {
      if (boundaries.onClose) return boundaries.onClose(fd, () => actual.closeSync(fd));
      return actual.closeSync(fd);
    },
    unlinkSync: (path: import('node:fs').PathLike) => {
      if (String(path).includes('/pending-')) boundaries.onUnlink?.();
      return actual.unlinkSync(path);
    },
    readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
      boundaries.onRead?.();
      return actual.readSync(fd, buffer, offset, length, position);
    },
  };
});

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  boundaries.onRead = undefined;
  boundaries.onUnlink = undefined;
  boundaries.onClose = undefined;
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
// Kernel leases and pinned /proc descriptors use the supported Linux profile.
const linux = test.skipIf(process.platform !== 'linux');
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-restore-jobs-')));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'recovery');
  await mkdir(root, { mode: 0o700 });
  const data = join(directory, 'data');
  await mkdir(data, { mode: 0o700 });
  const databasePath = join(data, 'workspace.sqlite');
  // Metadata custody fixture only; no claim of valid SQLite or restore eligibility.
  writeFileSync(databasePath, Buffer.alloc(4096), { mode: 0o600 });
  const journal = await RecoveryJournal.open(root, databasePath);
  cleanups.push(() => journal.close());
  await journal.bindWorkspace();
  journal.state.databaseIdentity = fileIdentity(databasePath);
  journal.write();
  let now = Date.now();
  const intent = () => ({
    ...restoreJobIntentFixture(now),
    target: {
      instanceId: journal.state.instanceId,
      generationId: journal.state.generationId,
      epoch: journal.state.epoch,
      databasePath,
      identity: { ...journal.state.databaseIdentity! },
    },
  });
  const openJobs = () => {
    const jobs = new RestoreJobs(journal, () => now);
    cleanups.push(() => jobs.close());
    return jobs;
  };
  return {
    directory,
    root,
    journal,
    intent,
    openJobs,
    jobs: openJobs(),
    advance: (ms: number) => {
      now += ms;
    },
    statePath: (id: string) => join(root, 'restore-jobs', id, 'state.json'),
  };
}

linux('durable admission survives reopen and expired retries do not renew it', async () => {
  const f = await fixture();
  const intent = f.intent();
  const initial = f.jobs.admit(intent);
  expect(initial.created).toBe(true);
  const retained = f.jobs.checkpoint(intent.id, initial.record.intentHash, 0, 'source-retained');
  f.jobs.close();
  const reopened = f.openJobs();
  expect(reopened.read(intent.id)).toEqual(retained);
  f.advance(60_001);
  expect(reopened.admit(intent)).toEqual({ created: false, record: retained });
  expect(() => reopened.checkpoint(intent.id, retained.intentHash, 1, 'source-retained')).toThrow();
  expect(() => reopened.admit({ ...intent, continuationHash: 'f'.repeat(64) })).toThrow(
    'different intent',
  );
  expect(() => reopened.admit(f.intent())).toThrow('current restore');
  const failed = reopened.checkpoint(intent.id, retained.intentHash, 1, 'failed');
  expect(() => reopened.checkpoint(intent.id, failed.intentHash, 2, 'source-retained')).toThrow();
  expect(reopened.admit(intent)).toEqual({ created: false, record: failed });
  expect(reopened.admit(f.intent()).created).toBe(true);
});

linux(
  'stale revisions, malformed phases, changed targets and expired new requests fail closed',
  async () => {
    const f = await fixture();
    const intent = f.intent();
    expect(() =>
      f.jobs.admit({ ...intent, target: { ...intent.target, epoch: randomUUID() } }),
    ).toThrow();
    expect(f.jobs.list()).toEqual([]);
    const { record } = f.jobs.admit(intent);
    expect(() => f.jobs.checkpoint(intent.id, record.intentHash, 1, 'failed')).toThrow();
    expect(() =>
      f.jobs.checkpoint(intent.id, record.intentHash, 0, 'accepted' as 'source-retained'),
    ).toThrow();
    f.advance(60_000);
    expect(() => f.jobs.checkpoint(intent.id, record.intentHash, 0, 'source-retained')).toThrow(
      'expired',
    );
    f.jobs.checkpoint(intent.id, record.intentHash, 0, 'failed');
    const stale = f.intent();
    f.advance(60_000);
    expect(() => f.jobs.admit(stale)).toThrow('expired');
    expect(f.jobs.read(stale.id)).toBeUndefined();
  },
);

linux(
  'uncertain publication poisons the instance and reopening preserves the published outcome',
  async () => {
    const f = await fixture();
    const intent = f.intent();
    const { record } = f.jobs.admit(intent);
    const sync = f.journal.syncRoot.bind(f.journal);
    const fault = vi.spyOn(f.journal, 'syncRoot').mockImplementation(() => {
      if (JSON.parse(readFileSync(f.statePath(intent.id), 'utf8')).phase === 'source-retained')
        throw new Error('Injected directory fsync failure');
      sync();
    });
    expect(() => f.jobs.checkpoint(intent.id, record.intentHash, 0, 'source-retained')).toThrow(
      'fsync',
    );
    expect(() => f.jobs.read(intent.id)).toThrow();
    expect(() => f.jobs.checkpoint(intent.id, record.intentHash, 0, 'failed')).toThrow();
    fault.mockRestore();
    f.jobs.close();
    const reopened = f.openJobs();
    expect(reopened.read(intent.id)).toMatchObject({ phase: 'source-retained', revision: 1 });
    expect(() => reopened.checkpoint(intent.id, record.intentHash, 0, 'failed')).toThrow();
  },
);

linux('read refuses a selected file replaced during durability checks', async () => {
  const f = await fixture();
  const intent = f.intent();
  f.jobs.admit(intent);
  const path = f.statePath(intent.id);
  const sync = f.journal.syncRoot.bind(f.journal);
  vi.spyOn(f.journal, 'syncRoot').mockImplementationOnce(() => {
    const text = readFileSync(path);
    renameSync(path, join(f.directory, 'old-state'));
    writeFileSync(path, text, { mode: 0o600 });
    sync();
  });
  expect(() => f.jobs.read(intent.id)).toThrow();
});

linux(
  'bounded interrupted private records are removed only after a valid durable state',
  async () => {
    const f = await fixture();
    const intent = f.intent();
    f.jobs.admit(intent);
    const directory = join(f.root, 'restore-jobs', intent.id);
    const pending = join(directory, 'pending-' + randomUUID());
    writeFileSync(pending, 'incomplete', { mode: 0o600 });
    expect(f.jobs.read(intent.id)?.phase).toBe('accepted');
    expect(readdirSync(directory)).toEqual(['state.json']);
    for (let n = 0; n < 9; n++)
      writeFileSync(join(directory, 'pending-' + randomUUID()), '', { mode: 0o600 });
    expect(() => f.jobs.read(intent.id)).toThrow();
    expect(readdirSync(directory)).toHaveLength(10);
  },
);

linux.each(['missing-state', 'symlink', 'hardlink', 'permissions', 'oversized', 'invalid-json'])(
  'invalid or interrupted records are not treated as absent: %s',
  async (failure) => {
    const f = await fixture();
    const intent = f.intent();
    f.jobs.admit(intent);
    const path = f.statePath(intent.id);
    if (failure === 'missing-state') rmSync(path);
    if (failure === 'symlink') {
      renameSync(path, join(f.directory, 'saved'));
      symlinkSync(join(f.directory, 'saved'), path);
    }
    if (failure === 'hardlink') linkSync(path, join(f.directory, 'alias'));
    if (failure === 'permissions') chmodSync(path, 0o644);
    if (failure === 'oversized') writeFileSync(path, Buffer.alloc(64 * 1024 + 1));
    if (failure === 'invalid-json') writeFileSync(path, '{');
    expect(() => f.jobs.read(intent.id)).toThrow();
    expect(() => f.jobs.admit(intent)).toThrow();
    expect(() => f.jobs.list()).toThrow();
  },
);

linux('orphan job directories and replaced custody directories prevent admission', async () => {
  const f = await fixture();
  mkdirSync(join(f.root, 'restore-jobs', randomUUID()), { mode: 0o700 });
  expect(() => f.jobs.admit(f.intent())).toThrow();
  renameSync(join(f.root, 'restore-jobs'), join(f.root, 'old-jobs'));
  mkdirSync(join(f.root, 'restore-jobs'), { mode: 0o700 });
  expect(() => f.jobs.list()).toThrow();
});

linux('actual record reads remain bounded if a file grows after its initial stat', async () => {
  const f = await fixture();
  const intent = f.intent();
  f.jobs.admit(intent);
  boundaries.onRead = () => {
    boundaries.onRead = undefined;
    appendFileSync(f.statePath(intent.id), Buffer.alloc(1024 * 1024));
  };
  expect(() => f.jobs.read(intent.id)).toThrow();
});

linux('expiry during publication retains the ID without reporting new authority', async () => {
  const f = await fixture();
  const intent = f.intent();
  const sync = f.journal.syncRoot.bind(f.journal);
  vi.spyOn(f.journal, 'syncRoot').mockImplementationOnce(() => {
    f.advance(60_000);
    sync();
  });
  expect(() => f.jobs.admit(intent)).toThrow('expired');
  expect(f.jobs.admit(intent)).toMatchObject({ created: false, record: { phase: 'accepted' } });
});

linux('retained IDs are bounded and never silently pruned for a new admission', async () => {
  const f = await fixture();
  const intent = f.intent();
  const first = f.jobs.admit(intent).record;
  const failed = f.jobs.checkpoint(intent.id, first.intentHash, first.revision, 'failed');
  // Seed terminal metadata fixtures without exercising 64 unrelated preparation
  // flows. Reading each still validates and fsyncs the actual retained record.
  for (let n = 1; n < 64; n++) {
    const next = f.intent();
    const directory = join(f.root, 'restore-jobs', next.id);
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(
      join(directory, 'state.json'),
      JSON.stringify({ ...failed, intent: next, intentHash: restoreIntentHash(next) }),
      { mode: 0o600 },
    );
  }
  expect(f.jobs.list()).toHaveLength(64);
  expect(() => f.jobs.admit(f.intent())).toThrow('inventory is full');
  expect(f.jobs.read(intent.id)).toEqual(failed);
  mkdirSync(join(f.root, 'restore-jobs', randomUUID()), { mode: 0o700 });
  expect(() => f.jobs.list()).toThrow();
});

linux.each(['unknown-name', 'permissions', 'hardlink', 'oversized'])(
  'stale metadata with unsafe custody is retained and refused: %s',
  async (failure) => {
    const f = await fixture();
    const intent = f.intent();
    f.jobs.admit(intent);
    const directory = join(f.root, 'restore-jobs', intent.id);
    const pending = join(
      directory,
      failure === 'unknown-name' ? 'unexpected' : 'pending-' + randomUUID(),
    );
    writeFileSync(pending, failure === 'oversized' ? Buffer.alloc(64 * 1024 + 1) : 'incomplete', {
      mode: 0o600,
    });
    if (failure === 'permissions') chmodSync(pending, 0o644);
    if (failure === 'hardlink') linkSync(pending, join(f.directory, 'pending-alias'));
    expect(() => f.jobs.read(intent.id)).toThrow();
    expect(readdirSync(directory)).toHaveLength(2);
  },
);

linux.each(['state', 'pending', 'journal'])(
  'FIFO %s records are refused without blocking recovery',
  async (kind) => {
    const f = await fixture();
    const intent = f.intent();
    const { record } = f.jobs.admit(intent);
    if (kind === 'journal') f.jobs.checkpoint(intent.id, record.intentHash, 0, 'failed');
    const path =
      kind === 'journal'
        ? join(f.root, 'journal.json')
        : kind === 'state'
          ? f.statePath(intent.id)
          : join(f.root, 'restore-jobs', intent.id, 'pending-' + randomUUID());
    if (kind !== 'pending') rmSync(path);
    const made = spawnSync('mkfifo', ['-m', '600', path]);
    expect(made.status).toBe(0);
    f.jobs.close();
    await f.journal.close();
    const result = await new Promise<unknown>((resolve, reject) => {
      const child = fork(
        fileURLToPath(new URL('./restore-jobs-fixture.ts', import.meta.url)),
        [f.root, f.journal.databasePath, intent.id, kind],
        {
          execArgv: ['--max-old-space-size=128'],
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        },
      );
      let message: unknown;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, 5000);
      child.once('message', (value) => {
        message = value;
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        if (timedOut) reject(new Error('Metadata fixture blocked on FIFO'));
        else if (code !== 0) reject(new Error('Metadata fixture setup failed'));
        else resolve(message);
      });
    });
    expect(result).toEqual({ refused: true });
  },
  10_000,
);

linux('publication and cleanup errors are both retained and poison the store', async () => {
  const f = await fixture();
  const intent = f.intent();
  const publication = new Error('Injected publication fsync failure');
  const cleanup = new Error('Injected pending cleanup failure');
  const sync = vi.spyOn(f.journal, 'syncRoot').mockImplementation(() => {
    throw publication;
  });
  boundaries.onUnlink = () => {
    throw cleanup;
  };
  let failure: unknown;
  try {
    f.jobs.admit(intent);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([publication, cleanup]);
  expect(() => f.jobs.read(intent.id)).toThrow();
  boundaries.onUnlink = undefined;
  sync.mockRestore();
  f.jobs.close();
  expect(f.openJobs().read(intent.id)?.intentHash).toBe(restoreIntentHash(intent));
});

linux(
  'an uncertain explicit close is never retried on a potentially reused descriptor',
  async () => {
    const f = await fixture();
    const intent = f.intent();
    let pending: number | undefined;
    const attempts: number[] = [];
    boundaries.onClose = (fd, close) => {
      attempts.push(fd);
      const path = readlinkSync(`/proc/self/fd/${fd}`);
      close();
      if (path.includes('/pending-')) {
        pending = fd;
        throw new Error('Injected error after descriptor was closed');
      }
    };
    expect(() => f.jobs.admit(intent)).toThrow('after descriptor was closed');
    expect(pending).toBeDefined();
    expect(attempts.filter((fd) => fd === pending)).toHaveLength(1);
    expect(() => f.jobs.read(intent.id)).toThrow();
    boundaries.onClose = undefined;
    f.jobs.close();
    // No rename occurred; the empty job directory remains an interrupted admission.
    expect(() => f.openJobs().read(intent.id)).toThrow();
  },
);

linux(
  'planned shutdown preserves intent and journals witness before physical-stop completion',
  async () => {
    const f = await fixture(),
      intent = f.intent();
    const child = { pid: 1234, start: '100', boot: randomUUID(), token: randomUUID() };
    let record = f.jobs.admit(intent).record;
    record = f.jobs.checkpoint(intent.id, record.intentHash, record.revision, 'source-retained');
    Object.assign(f.journal.state, {
      phase: 'running',
      child,
      restoreJob: { jobId: intent.id, intentHash: record.intentHash },
    });
    f.journal.write();
    const history: RestoreJobRecord[] = [];
    const epoch = randomUUID();
    record = f.jobs.planPause(intent.id, record.intentHash, record.revision, epoch);
    history.push(structuredClone(record));
    expect(record.intent).toEqual(intent);
    expect(() =>
      f.jobs.checkpoint(intent.id, record.intentHash, record.revision, 'failed'),
    ).toThrow();
    expect(() => f.jobs.markPaused(intent.id, record.intentHash, record.revision)).toThrow();
    Object.assign(f.journal.state, {
      phase: 'paused',
      epoch,
      operation: {
        id: intent.id,
        actorId: intent.authority.actorId,
        sessionHash: intent.authority.sessionHash,
        expiresAt: intent.authority.expiresAt,
        tokenHash: intent.continuationHash,
        generationId: intent.target.generationId,
      },
    });
    f.journal.write();
    record = f.jobs.markPaused(intent.id, record.intentHash, record.revision);
    history.push(structuredClone(record));
    const stop = {
      request: {
        jobId: intent.id,
        challengeId: randomUUID(),
        generationId: intent.target.generationId,
        epoch,
        deadline: intent.authority.expiresAt,
      },
      databaseIdentity: intent.target.identity,
      child,
      fingerprint: null,
      acceptedAt: null,
    };
    f.advance(5);
    record = f.jobs.planStop(intent.id, record.intentHash, record.revision, stop);
    history.push(structuredClone(record));
    expect(f.journal.state.restoreStop).toBeNull();
    Object.assign(f.journal.state, { phase: 'stopping', restoreStop: stop });
    f.journal.write();
    const accepted = { ...stop, fingerprint: 'a'.repeat(64), acceptedAt: record.updatedAt };
    record = f.jobs.acceptWitness(intent.id, record.intentHash, record.revision, accepted);
    history.push(structuredClone(record));
    expect(f.openJobs().read(intent.id)).toEqual(record);
    expect(f.journal.state.restoreStop!.fingerprint).toBeNull();
    expect(() => f.jobs.markStopped(intent.id, record.intentHash, record.revision)).toThrow();
    // Store-boundary fixture only: the supervisor separately proves group/FD closure.
    Object.assign(f.journal.state, { phase: 'stopped', child: null, restoreStop: accepted });
    f.journal.write();
    f.advance(120_000); // Recording completed closure cannot renew expired authority.
    record = f.jobs.markStopped(intent.id, record.intentHash, record.revision);
    history.push(structuredClone(record));
    expect(record.phase).toBe('witnessed-stopped');
    expect(record.intent).toEqual(intent);
    expect(record.execution!.stop).toEqual(accepted);
    expect(() => f.journal.assertNoPendingRestoreJobs()).toThrow('unfinished restore');
    const final = structuredClone(record);
    for (const historical of history) {
      const corruptions: ((value: RestoreJobRecord) => void)[] = [
        (value) => {
          value.execution!.epoch = value.intent.target.epoch;
        },
        (value) => {
          value.execution!.child.boot = [value.execution!.child.boot] as unknown as string;
        },
      ];
      if (historical.execution!.stop) {
        corruptions.push((value) => {
          value.execution!.stop!.request.deadline = value.intent.confirmedAt - 1;
        });
        corruptions.push((value) => {
          value.execution!.requestedAt = value.intent.confirmedAt - 1;
        });
        corruptions.push((value) => {
          value.execution!.stop!.request.epoch = randomUUID();
        });
        if (historical.execution!.stop!.fingerprint !== null)
          corruptions.push((value) => {
            value.execution!.stop!.acceptedAt = value.execution!.requestedAt! - 1;
          });
      }
      for (const corrupt of corruptions) {
        const invalid = structuredClone(historical);
        corrupt(invalid);
        writeFileSync(f.statePath(intent.id), JSON.stringify(invalid));
        expect(() => f.jobs.read(intent.id)).toThrow('unavailable');
      }
    }
    writeFileSync(f.statePath(intent.id), JSON.stringify(final));
    expect(f.jobs.read(intent.id)).toEqual(final);
  },
);

async function frozenFixture() {
  const f = await fixture(),
    intent = f.intent();
  const child = { pid: 1234, start: '100', boot: randomUUID(), token: randomUUID() };
  let record = f.jobs.admit(intent).record;
  record = f.jobs.checkpoint(intent.id, record.intentHash, record.revision, 'source-retained');
  Object.assign(f.journal.state, {
    phase: 'running',
    child,
    restoreJob: { jobId: intent.id, intentHash: record.intentHash },
  });
  f.journal.write();
  const epoch = randomUUID();
  record = f.jobs.planPause(intent.id, record.intentHash, record.revision, epoch);
  Object.assign(f.journal.state, {
    phase: 'paused',
    epoch,
    operation: {
      id: intent.id,
      actorId: intent.authority.actorId,
      sessionHash: intent.authority.sessionHash,
      expiresAt: intent.authority.expiresAt,
      tokenHash: intent.continuationHash,
      generationId: intent.target.generationId,
    },
  });
  f.journal.write();
  record = f.jobs.markPaused(intent.id, record.intentHash, record.revision);
  const stop = {
    request: {
      jobId: intent.id,
      challengeId: randomUUID(),
      generationId: intent.target.generationId,
      epoch,
      deadline: intent.authority.expiresAt,
    },
    databaseIdentity: intent.target.identity,
    child,
    fingerprint: null,
    acceptedAt: null,
  };
  record = f.jobs.planStop(intent.id, record.intentHash, record.revision, stop);
  Object.assign(f.journal.state, { phase: 'stopping', restoreStop: stop });
  f.journal.write();
  const accepted = { ...stop, fingerprint: 'a'.repeat(64), acceptedAt: record.updatedAt };
  record = f.jobs.acceptWitness(intent.id, record.intentHash, record.revision, accepted);
  Object.assign(f.journal.state, { phase: 'stopped', child: null, restoreStop: accepted });
  f.journal.write();
  record = f.jobs.markStopped(intent.id, record.intentHash, record.revision);
  record = f.jobs.planOriginals(intent.id, record.intentHash, record.revision, {
    id: intent.id,
    identity: intent.target.identity,
    original: {
      'spinel.sqlite': { bytes: 4096, sha256: 'b'.repeat(64) },
      'spinel.sqlite-wal': null,
      'spinel.sqlite-shm': null,
    },
  });
  record = f.jobs.markOriginalsRetained(intent.id, record.intentHash, record.revision);
  record = f.jobs.planFreeze(intent.id, record.intentHash, record.revision, randomUUID());
  record = f.jobs.markFrozen(intent.id, record.intentHash, record.revision, {
    directory: '.restore-frozen-ABC123',
    bytes: 4096,
    sha256: 'c'.repeat(64),
    fingerprint: accepted.fingerprint,
  });
  return { ...f, record };
}
const candidateImage = {
  directory: '.restore-reconciled-ABC123',
  bytes: 4096,
  sha256: 'd'.repeat(64),
  fingerprint: 'e'.repeat(64),
};
const rollbackImage = {
  ...candidateImage,
  directory: '.restore-rollback-DEF456',
  sha256: 'f'.repeat(64),
};

linux(
  'prepared stages preserve original binding, strict output schemas and the one fixed timestamp across reopen',
  async () => {
    const f = await frozenFixture();
    let record = f.record;
    const id = record.intent.id,
      hash = record.intentHash;
    const history = [structuredClone(record)];
    record = f.jobs.planPreparation(id, hash, record.revision, randomUUID(), record.updatedAt);
    history.push(structuredClone(record));
    expect(() =>
      f.jobs.planPreparation(id, hash, record.revision, randomUUID(), record.updatedAt),
    ).toThrow();
    expect(() => f.jobs.markRollbackPrepared(id, hash, record.revision, rollbackImage)).toThrow();
    const before = readFileSync(f.statePath(id));
    for (const invalid of [
      { ...candidateImage, directory: '../escaped' },
      { ...candidateImage, directory: '.restore-rollback-ABC123' },
      { ...candidateImage, bytes: 8 * 1024 ** 3 + 1 },
      { ...candidateImage, fingerprint: ['a'.repeat(64)] },
      { ...candidateImage, sha256: 'bad' },
      { ...candidateImage, arbitrary: true },
    ]) {
      expect(() =>
        f.jobs.markCandidatePrepared(id, hash, record.revision, invalid as typeof candidateImage),
      ).toThrow();
      expect(readFileSync(f.statePath(id))).toEqual(before);
    }
    const preparedAt = record.execution!.preparation!.preparedAt;
    f.advance(1);
    record = f.jobs.markCandidatePrepared(id, hash, record.revision, candidateImage);
    history.push(structuredClone(record));
    expect(() => f.jobs.markCandidateRehearsed(id, hash, record.revision)).toThrow();
    record = f.jobs.markRollbackPrepared(id, hash, record.revision, rollbackImage);
    history.push(structuredClone(record));
    expect(() => f.jobs.markPrepared(id, hash, record.revision)).toThrow();
    record = f.jobs.markCandidateRehearsed(id, hash, record.revision);
    history.push(structuredClone(record));
    record = f.jobs.markPrepared(id, hash, record.revision);
    history.push(structuredClone(record));
    expect(record.intent).toEqual(f.record.intent);
    expect(record.execution!.stop).toEqual(f.record.execution!.stop);
    expect(record.execution!.frozen).toEqual(f.record.execution!.frozen);
    expect(record.execution!.preparation).toEqual({
      slot: history[1].execution!.preparation!.slot,
      preparedAt,
      candidate: candidateImage,
      rollback: rollbackImage,
    });
    f.jobs.close();
    const reopened = f.openJobs();
    expect(reopened.read(id)).toEqual(record);
    for (const saved of history.slice(1)) {
      for (const corrupt of [
        (item: RestoreJobRecord) => {
          item.execution!.preparation!.slot = '../unsafe';
        },
        (item: RestoreJobRecord) => {
          item.execution!.preparation!.preparedAt = item.intent.authority.expiresAt;
        },
        (item: RestoreJobRecord) => {
          item.execution!.frozen!.fingerprint = '0'.repeat(64);
        },
        (item: RestoreJobRecord) => {
          item.updatedAt = item.intent.authority.expiresAt;
        },
      ]) {
        const invalid = structuredClone(saved);
        corrupt(invalid);
        writeFileSync(f.statePath(id), JSON.stringify(invalid));
        expect(() => reopened.read(id)).toThrow('unavailable');
      }
    }
    writeFileSync(f.statePath(id), JSON.stringify(record));
    expect(reopened.read(id)).toEqual(record);
  },
);

linux(
  'preparation refuses changed target/epoch/authority and publication crossing expiry retains its checkpoint',
  async () => {
    const f = await frozenFixture();
    const original = f.record;
    const args = [
      original.intent.id,
      original.intentHash,
      original.revision,
      randomUUID(),
      original.updatedAt,
    ] as const;
    f.journal.state.epoch = randomUUID();
    expect(() => f.jobs.planPreparation(...args)).toThrow();
    f.journal.state.epoch = original.execution!.epoch;
    f.journal.state.operation!.actorId = randomUUID();
    expect(() => f.jobs.planPreparation(...args)).toThrow();
    f.journal.state.operation!.actorId = original.intent.authority.actorId;
    f.journal.state.generationId = randomUUID();
    expect(() => f.jobs.planPreparation(...args)).toThrow();
    f.journal.state.generationId = original.intent.target.generationId;
    expect(() => f.jobs.planPreparation(args[0], args[1], args[2] - 1, args[3], args[4])).toThrow();
    const sync = f.journal.syncRoot.bind(f.journal);
    const fault = vi.spyOn(f.journal, 'syncRoot').mockImplementation(() => {
      sync();
      if (
        JSON.parse(readFileSync(f.statePath(original.intent.id), 'utf8')).phase ===
        'preparation-planned'
      )
        f.advance(60_000);
    });
    await expect(Promise.resolve().then(() => f.jobs.planPreparation(...args))).rejects.toThrow(
      'expired',
    );
    fault.mockRestore();
    const planned = f.jobs.read(original.intent.id)!;
    expect(planned.phase).toBe('preparation-planned');
    expect(() =>
      f.jobs.markCandidatePrepared(
        planned.intent.id,
        planned.intentHash,
        planned.revision,
        candidateImage,
      ),
    ).toThrow('expired');
    expect(f.jobs.read(original.intent.id)).toEqual(planned);
  },
);
