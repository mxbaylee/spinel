import { fork, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
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
import { RecoveryJournal, fileIdentity, processIdentity } from './journal.ts';
import { isCommittedRestoreJob, RestoreJobs } from './restore-jobs.ts';
import type { RestoreJobRecord } from './restore-jobs.ts';
import { restoreTrialReference } from './restore-trial.ts';
import type { RestoreTrialStopRequest } from './restore-trial-stop.ts';
import type { RestoreTrialPermit } from './restore-trial.ts';
import { restoreBarrierPath } from './restore-barrier.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { restoreIntentHash, validRestoreJobIntent } from './restore-job-intent.ts';

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

test('confirmation requires exact provisional preview and the complete consequence envelope', () => {
  const intent = restoreJobIntentFixture();
  const hash = restoreIntentHash(intent);
  expect(validRestoreJobIntent(intent)).toBe(true);
  for (const key of Object.keys(intent.preview).filter((key) => key !== 'provisional')) {
    const changed = {
      ...intent,
      preview: {
        ...intent.preview,
        [key]: Number(intent.preview[key as keyof typeof intent.preview]) + 1,
      },
    };
    expect(validRestoreJobIntent(changed)).toBe(true);
    expect(restoreIntentHash(changed)).not.toBe(hash);
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1', null])
      expect(
        validRestoreJobIntent({ ...intent, preview: { ...intent.preview, [key]: invalid } }),
      ).toBe(false);
    const missing = { ...intent.preview } as Record<string, unknown>;
    delete missing[key];
    expect(validRestoreJobIntent({ ...intent, preview: missing })).toBe(false);
  }
  for (const invalid of [
    { ...intent, preview: undefined },
    { ...intent, preview: null },
    { ...intent, preview: { ...intent.preview, provisional: false } },
    { ...intent, preview: { ...intent.preview, documentNames: [] } },
    { ...intent, policy: { ...intent.policy, consequencesVersion: undefined } },
    { ...intent, policy: { ...intent.policy, consequencesVersion: 0 } },
    { ...intent, policy: { ...intent.policy, consequencesVersion: 2 } },
    { ...intent, policy: { ...intent.policy, consequencesVersion: '1' } },
  ]) {
    expect(validRestoreJobIntent(invalid)).toBe(false);
    expect(() => restoreIntentHash(invalid as typeof intent)).toThrow('Invalid restore job intent');
  }
  const legacy = { ...intent } as Record<string, unknown>;
  delete legacy.preview;
  expect(validRestoreJobIntent(legacy)).toBe(false);
});

linux('confirmed preview survives custody and expired retries reject changed counts', async () => {
  const f = await fixture();
  const intent = f.intent();
  const accepted = f.jobs.admit(intent).record;
  const retained = f.jobs.checkpoint(intent.id, accepted.intentHash, 0, 'source-retained');
  f.jobs.close();
  const reopened = f.openJobs();
  expect(reopened.read(intent.id)?.intent).toEqual(intent);
  f.advance(60_001);
  expect(reopened.admit(intent)).toEqual({ created: false, record: retained });
  for (const key of Object.keys(intent.preview).filter((key) => key !== 'provisional')) {
    expect(() =>
      reopened.admit({
        ...intent,
        preview: {
          ...intent.preview,
          [key]: Number(intent.preview[key as keyof typeof intent.preview]) + 1,
        },
      }),
    ).toThrow('different intent');
  }
  expect(reopened.read(intent.id)).toEqual(retained);
});

linux(
  'persisted confirmation tampering fails closed instead of accepting altered preview',
  async () => {
    for (const mutation of ['count', 'envelope', 'missing-preview'] as const) {
      const f = await fixture();
      const intent = f.intent();
      const record = f.jobs.admit(intent).record;
      const altered = JSON.parse(JSON.stringify(record));
      if (mutation === 'count') altered.intent.preview.sharingRemoved += 1;
      else if (mutation === 'envelope') altered.intent.policy.consequencesVersion = 2;
      else delete altered.intent.preview;
      writeFileSync(f.statePath(intent.id), JSON.stringify(altered), { mode: 0o600 });
      expect(() => f.jobs.read(intent.id)).toThrow();
    }
  },
);

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

async function preparedFixture() {
  const f = await frozenFixture();
  let record = f.record;
  const id = record.intent.id,
    hash = record.intentHash;
  record = f.jobs.planPreparation(id, hash, record.revision, randomUUID(), record.updatedAt);
  record = f.jobs.markCandidatePrepared(id, hash, record.revision, candidateImage);
  record = f.jobs.markRollbackPrepared(id, hash, record.revision, rollbackImage);
  record = f.jobs.markCandidateRehearsed(id, hash, record.revision);
  record = f.jobs.markPrepared(id, hash, record.revision);
  return { ...f, record };
}
const attemptFixture = () => ({
  attemptId: randomUUID(),
  generationId: randomUUID(),
  epoch: randomUUID(),
  nonce: randomUUID(),
});

linux(
  'activation phases preserve immutable originals and reject reused identities or skipped transitions',
  async () => {
    const f = await preparedFixture();
    let record = f.record;
    const id = record.intent.id,
      hash = record.intentHash;
    for (const attempt of [
      { ...attemptFixture(), generationId: record.intent.target.generationId },
      { ...attemptFixture(), epoch: record.execution!.epoch },
      { ...attemptFixture(), nonce: 'not-a-uuid' },
      { ...attemptFixture(), extra: true },
    ])
      expect(() => f.jobs.planActivation(id, hash, record.revision, attempt)).toThrow();
    record = f.jobs.planActivation(id, hash, record.revision, attemptFixture());
    const attempt = record.execution!.attempt;
    expect(() => f.jobs.planActivation(id, hash, record.revision, attemptFixture())).toThrow();
    expect(() => f.jobs.markCandidateActivated(id, hash, record.revision)).toThrow();
    record = f.jobs.markCandidateStaged(id, hash, record.revision);
    expect(() => f.jobs.markCandidateActivated(id, hash, record.revision)).toThrow();
    record = f.jobs.markCandidateReplacing(id, hash, record.revision);
    record = f.jobs.markCandidateActivated(id, hash, record.revision);
    expect(record.execution).toEqual({ ...f.record.execution, attempt });
    expect(record.intent).toEqual(f.record.intent);
    expect(f.openJobs().read(id)).toEqual(record);
    const invalid = structuredClone(record);
    invalid.execution!.attempt!.epoch = invalid.intent.target.epoch;
    writeFileSync(f.statePath(id), JSON.stringify(invalid));
    expect(() => f.jobs.read(id)).toThrow();
    writeFileSync(f.statePath(id), JSON.stringify(record));
    f.advance(60_000);
    expect(() => f.jobs.markCandidateActivated(id, hash, record.revision)).toThrow();
    expect(f.jobs.read(id)).toEqual(record);
  },
);

async function activatedTrialFixture() {
  const f = await preparedFixture();
  let record = f.record;
  const id = record.intent.id,
    hash = record.intentHash;
  record = f.jobs.planActivation(id, hash, record.revision, attemptFixture());
  record = f.jobs.markCandidateStaged(id, hash, record.revision);
  record = f.jobs.markCandidateReplacing(id, hash, record.revision);
  record = f.jobs.markCandidateActivated(id, hash, record.revision);
  // Metadata-store boundary only: a real idle process has no ownership handles
  // and opens no database. The supervisor suite supplies actual trial readiness.
  const token = randomUUID();
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "process.on('message', () => {}); process.send({ ready: true });",
    ],
    {
      env: { ...process.env, SPINEL_PROCESS_GROUP_TOKEN: token },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    },
  );
  cleanups.push(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
  });
  await once(child, 'message');
  const candidate = record.execution!.preparation!.candidate!,
    attempt = record.execution!.attempt!;
  writeFileSync(
    restoreBarrierPath(f.journal.databasePath),
    JSON.stringify({ version: 1, operationId: id, identity: record.intent.target.identity }) + '\n',
    { mode: 0o600 },
  );
  const permit: RestoreTrialPermit = {
    version: 1,
    jobId: id,
    intentHash: hash,
    ...attempt,
    role: 'candidate',
    child: processIdentity(child.pid!, token)!,
    databasePath: record.intent.target.databasePath,
    identity: record.intent.target.identity,
    output: {
      bytes: candidate.bytes,
      sha256: candidate.sha256,
      fingerprint: candidate.fingerprint,
    },
    policy: record.intent.policy,
    maximumBytes: 1024 * 1024,
    deadline: record.intent.authority.expiresAt,
  };
  const select = () => {
    Object.assign(f.journal.state, {
      phase: 'starting',
      generationId: permit.generationId,
      epoch: permit.epoch,
      child: permit.child,
    });
    f.journal.state.operation!.generationId = permit.generationId;
    f.journal.write();
  };
  return { ...f, record, permit, child, select };
}

linux(
  'trial permit and readiness bind the selected generation without weakening original-stage checks',
  async () => {
    const f = await activatedTrialFixture();
    const id = f.record.intent.id,
      hash = f.record.intentHash;
    for (const permit of [
      { ...f.permit, nonce: randomUUID() },
      { ...f.permit, role: 'original' as const },
      { ...f.permit, output: { ...f.permit.output, fingerprint: '0'.repeat(64) } },
      { ...f.permit, policy: { ...f.permit.policy, spacesEnabled: false } },
      { ...f.permit, deadline: f.permit.deadline + 1 },
      { ...f.permit, child: { ...f.permit.child, start: '0' } },
    ])
      expect(() => f.jobs.planTrial(id, hash, f.record.revision, permit)).toThrow();
    let record = f.jobs.planTrial(id, hash, f.record.revision, f.permit);
    const reference = restoreTrialReference(f.permit);
    expect(() =>
      f.jobs.markTrialReady(id, hash, record.revision, reference, f.permit.output.fingerprint),
    ).toThrow();
    f.select();
    expect(() =>
      f.jobs.markTrialReady(id, hash, record.revision, reference, f.permit.output.fingerprint),
    ).toThrow();
    record = f.jobs.markTrialOpening(id, hash, record.revision);
    expect(record.phase).toBe('trial-opening');
    expect(record.execution!.openingGrantedAt).toBe(record.updatedAt);
    expect(() => f.jobs.markCandidateActivated(id, hash, record.revision)).toThrow();
    expect(() =>
      f.jobs.markTrialReady(
        id,
        hash,
        record.revision,
        { ...reference, nonce: randomUUID() },
        f.permit.output.fingerprint,
      ),
    ).toThrow();
    expect(() =>
      f.jobs.markTrialReady(id, hash, record.revision, reference, '0'.repeat(64)),
    ).toThrow();
    f.journal.state.operation!.generationId = f.record.intent.target.generationId;
    expect(() =>
      f.jobs.markTrialReady(id, hash, record.revision, reference, f.permit.output.fingerprint),
    ).toThrow();
    f.journal.state.operation!.generationId = f.permit.generationId;
    record = f.jobs.markTrialReady(
      id,
      hash,
      record.revision,
      reference,
      f.permit.output.fingerprint,
    );
    expect(record.phase).toBe('trial-ready');
    expect(record.execution!.stop).toEqual(f.record.execution!.stop);
    expect(record.execution!.trial).toEqual(f.permit);
    expect(record.intent).toEqual(f.record.intent);
    expect(f.openJobs().read(id)).toEqual(record);
    const invalid = structuredClone(record);
    invalid.execution!.trial!.nonce = randomUUID();
    writeFileSync(f.statePath(id), JSON.stringify(invalid));
    expect(() => f.jobs.read(id)).toThrow();
  },
);

linux(
  'trial publication expiry keeps the exact permit and cannot authorize readiness',
  async () => {
    const f = await activatedTrialFixture();
    const id = f.record.intent.id,
      hash = f.record.intentHash;
    const sync = f.journal.syncRoot.bind(f.journal);
    const fault = vi.spyOn(f.journal, 'syncRoot').mockImplementation(() => {
      sync();
      if (JSON.parse(readFileSync(f.statePath(id), 'utf8')).phase === 'trial-planned')
        f.advance(60_000);
    });
    expect(() => f.jobs.planTrial(id, hash, f.record.revision, f.permit)).toThrow();
    fault.mockRestore();
    const planned = f.jobs.read(id)!;
    expect(planned.phase).toBe('trial-planned');
    expect(planned.execution!.trial).toEqual(f.permit);
    f.select();
    expect(() =>
      f.jobs.markTrialReady(
        id,
        hash,
        planned.revision,
        restoreTrialReference(f.permit),
        f.permit.output.fingerprint,
      ),
    ).toThrow();
  },
);

async function readyTrialFixture() {
  const f = await activatedTrialFixture();
  const id = f.record.intent.id,
    hash = f.record.intentHash;
  let record = f.jobs.planTrial(id, hash, f.record.revision, f.permit);
  f.select();
  record = f.jobs.markTrialOpening(id, hash, record.revision);
  const reference = restoreTrialReference(f.permit);
  record = f.jobs.markTrialReady(id, hash, record.revision, reference, f.permit.output.fingerprint);
  f.journal.state.phase = 'paused';
  f.journal.write();
  return { ...f, record, reference };
}

async function failedTrialFixture(ready: boolean, expired = true) {
  const f = await activatedTrialFixture();
  const id = f.record.intent.id,
    hash = f.record.intentHash;
  let record = f.jobs.planTrial(id, hash, f.record.revision, f.permit);
  f.select();
  record = f.jobs.markTrialOpening(id, hash, record.revision);
  if (ready)
    record = f.jobs.markTrialReady(
      id,
      hash,
      record.revision,
      restoreTrialReference(f.permit),
      f.permit.output.fingerprint,
    );
  // The old permit/authority is expired. Only bounded final evidence is allowed.
  if (expired) f.advance(60_000);
  f.journal.state.phase = 'stopping';
  f.journal.write();
  const stop: RestoreTrialStopRequest = {
    reference: restoreTrialReference(f.permit),
    child: structuredClone(f.permit.child),
    request: {
      jobId: id,
      generationId: f.permit.generationId,
      epoch: f.permit.epoch,
      challengeId: randomUUID(),
      deadline: record.updatedAt + (expired ? 90_000 : 30_000),
    },
  };
  return { ...f, record, stop };
}

linux.each([false, true])(
  'failed trial evidence seals its predecessor and never renews authority: ready=%s',
  async (ready) => {
    const f = await failedTrialFixture(ready);
    const id = f.record.intent.id,
      hash = f.record.intentHash;
    for (const stop of [
      { ...f.stop, reference: { ...f.stop.reference, nonce: randomUUID() } },
      { ...f.stop, child: { ...f.stop.child, start: '0' } },
      {
        ...f.stop,
        request: { ...f.stop.request, challengeId: f.record.execution!.stop!.request.challengeId },
      },
      { ...f.stop, request: { ...f.stop.request, deadline: f.stop.request.deadline + 1 } },
    ])
      expect(() => f.jobs.planTrialStop(id, hash, f.record.revision, stop)).toThrow();
    const operation = structuredClone(f.journal.state.operation!);
    for (const key of ['actorId', 'sessionHash', 'tokenHash', 'generationId'] as const) {
      f.journal.state.operation![key] = randomUUID();
      expect(() => f.jobs.planTrialStop(id, hash, f.record.revision, f.stop)).toThrow();
      f.journal.state.operation = structuredClone(operation);
    }
    let record = f.jobs.planTrialStop(id, hash, f.record.revision, f.stop);
    expect(record.execution!.failure).toMatchObject({
      from: ready ? 'trial-ready' : 'trial-opening',
      priorUpdatedAt: f.record.updatedAt,
      requestedAt: f.record.updatedAt + 60_000,
      stop: { fingerprint: null, acceptedAt: null },
    });
    expect(record.execution!.stop).toEqual(f.record.execution!.stop);
    expect(() => f.jobs.planTrialStop(id, hash, record.revision, f.stop)).toThrow();
    expect(() => f.jobs.markTrialOpening(id, hash, record.revision)).toThrow();
    expect(() =>
      f.jobs.markCandidateCommitted(id, hash, record.revision, f.stop.reference),
    ).toThrow();
    record = f.jobs.acceptTrialWitness(id, hash, record.revision, f.stop, 'd'.repeat(64));
    expect(record.execution!.failure!.stop.fingerprint).not.toBe(f.permit.output.fingerprint);
    expect(record.execution!.stop).toEqual(f.record.execution!.stop);
    expect(f.openJobs().read(id)).toEqual(record);
    for (const change of [
      (r: RestoreJobRecord) => {
        r.execution!.failure!.priorUpdatedAt = f.permit.deadline;
      },
      (r: RestoreJobRecord) => {
        r.execution!.failure!.from = ready ? 'trial-opening' : 'trial-ready';
      },
      (r: RestoreJobRecord) => {
        r.execution!.failure!.stop.acceptedAt = f.stop.request.deadline;
      },
      (r: RestoreJobRecord) => {
        r.execution!.failure!.stop.child.start = '0';
      },
    ]) {
      const changed = structuredClone(record);
      change(changed);
      writeFileSync(f.statePath(id), JSON.stringify(changed));
      expect(() => f.openJobs().read(id)).toThrow();
      writeFileSync(f.statePath(id), JSON.stringify(record));
    }
    // A timely witness remains useful after its deadline, but actual closure is
    // distinct. This idle metadata fixture never opened SQLite or owned handles.
    f.advance(30_001);
    expect(() => f.jobs.markTrialStopped(id, hash, record.revision)).toThrow();
    const exit = once(f.child, 'exit');
    f.child.kill('SIGKILL');
    await exit;
    f.journal.state.phase = 'stopped';
    f.journal.state.child = null;
    f.journal.write();
    const stopped = f.jobs.markTrialStopped(id, hash, record.revision);
    expect(stopped.phase).toBe('trial-witnessed-stopped');
    expect(stopped.execution).toEqual(record.execution);
    expect(f.openJobs().read(id)).toEqual(stopped);
  },
);

linux.each(['arrival', 'publication'])(
  'late failed-trial witness cannot authorize ACK: %s',
  async (boundary) => {
    const f = await failedTrialFixture(false);
    const id = f.record.intent.id,
      hash = f.record.intentHash;
    const record = f.jobs.planTrialStop(id, hash, f.record.revision, f.stop);
    if (boundary === 'arrival') f.advance(30_000);
    else {
      const sync = f.journal.syncRoot.bind(f.journal);
      vi.spyOn(f.journal, 'syncRoot').mockImplementation(() => {
        sync();
        if (JSON.parse(readFileSync(f.statePath(id), 'utf8')).phase === 'trial-witness-accepted')
          f.advance(30_000);
      });
    }
    expect(() =>
      f.jobs.acceptTrialWitness(id, hash, record.revision, f.stop, 'd'.repeat(64)),
    ).toThrow();
    vi.restoreAllMocks();
    const retained = f.openJobs().read(id)!;
    expect(retained.phase).toBe(
      boundary === 'arrival' ? 'trial-stop-requested' : 'trial-witness-accepted',
    );
    expect(retained.execution!.stop).toEqual(f.record.execution!.stop);
  },
);

async function stoppedFailedTrialFixture(expired = true) {
  const f = await failedTrialFixture(false, expired);
  const id = f.record.intent.id,
    hash = f.record.intentHash;
  let record = f.jobs.planTrialStop(id, hash, f.record.revision, f.stop);
  record = f.jobs.acceptTrialWitness(id, hash, record.revision, f.stop, 'd'.repeat(64));
  const exit = once(f.child, 'exit');
  f.child.kill('SIGKILL');
  await exit;
  f.journal.state.phase = 'stopped';
  f.journal.state.child = null;
  f.journal.write();
  record = f.jobs.markTrialStopped(id, hash, record.revision);
  return { ...f, record };
}
function planFailedCustody(f: Awaited<ReturnType<typeof stoppedFailedTrialFixture>>) {
  const id = f.record.intent.id,
    hash = f.record.intentHash,
    deadline = f.record.updatedAt + 120_000;
  let record = f.jobs.planTrialCapture(id, hash, f.record.revision, randomUUID(), deadline);
  const manifest = {
    version: 1 as const,
    captureId: record.execution!.failure!.capture!.slot,
    stop: f.stop,
    witness: {
      fingerprint: record.execution!.failure!.stop.fingerprint!,
      acceptedAt: record.execution!.failure!.stop.acceptedAt!,
    },
    identity: f.permit.identity,
    files: f.record.execution!.originals!.original,
  };
  record = f.jobs.planTrialCustody(id, hash, record.revision, manifest);
  record = f.jobs.markTrialCustodyRetained(id, hash, record.revision);
  expect(() =>
    f.jobs.planTrialFreeze(id, hash, record.revision, randomUUID(), deadline + 1),
  ).toThrow();
  record = f.jobs.planTrialFreeze(id, hash, record.revision, randomUUID(), deadline);
  return record;
}
linux(
  'failed capture/freeze retains original evidence and has one immutable evidence deadline',
  async () => {
    const f = await stoppedFailedTrialFixture();
    let record = planFailedCustody(f);
    const id = record.intent.id,
      hash = record.intentHash;
    record = f.jobs.markTrialFrozen(id, hash, record.revision, {
      directory: '.restore-frozen-abc123',
      bytes: 4096,
      sha256: 'e'.repeat(64),
      fingerprint: 'd'.repeat(64),
    });
    expect(record.phase).toBe('trial-frozen');
    expect(record.execution!.stop).toEqual(f.record.execution!.stop);
    expect(record.execution!.frozen).toEqual(f.record.execution!.frozen);
    expect(record.execution!.preparation).toEqual(f.record.execution!.preparation);
    expect(record.execution!.failure!.freeze!.deadline).toBe(
      record.execution!.failure!.capture!.deadline,
    );
    expect(() =>
      f.jobs.markCandidateCommitted(id, hash, record.revision, f.stop.reference),
    ).toThrow();
    expect(() =>
      f.jobs.planTrialCapture(id, hash, record.revision, randomUUID(), record.updatedAt + 120_000),
    ).toThrow();
    for (const mutate of [
      (r: RestoreJobRecord) => {
        r.execution!.failure!.capture!.manifest!.witness.fingerprint = f.permit.output.fingerprint;
      },
      (r: RestoreJobRecord) => {
        r.execution!.failure!.capture!.manifest!.stop.reference.nonce = randomUUID();
      },
      (r: RestoreJobRecord) => {
        r.execution!.failure!.capture!.retainedAt = r.execution!.failure!.capture!.deadline;
      },
      (r: RestoreJobRecord) => {
        r.execution!.failure!.freeze!.deadline += 1;
      },
      (r: RestoreJobRecord) => {
        r.execution!.failure!.freeze!.output!.fingerprint = f.permit.output.fingerprint;
      },
      (r: RestoreJobRecord) => {
        r.execution!.failure!.freeze!.output!.directory = '../original';
      },
      (r: RestoreJobRecord) => {
        r.execution!.failure!.freeze!.slot = r.execution!.freezeSlot!;
      },
      (r: RestoreJobRecord) => {
        delete r.execution!.failure!.capture!.manifest;
      },
      (r: RestoreJobRecord) => {
        r.phase = 'trial-custody-planned';
      },
    ]) {
      const changed = structuredClone(record);
      mutate(changed);
      writeFileSync(f.statePath(id), JSON.stringify(changed));
      expect(() => f.openJobs().read(id)).toThrow();
      writeFileSync(f.statePath(id), JSON.stringify(record));
    }
    f.advance(120_001);
    expect(f.openJobs().read(id)).toEqual(record);
  },
);
linux.each(['lost-publication', 'deadline'])(
  'failed frozen publication preserves its exact output after %s',
  async (boundary) => {
    const f = await stoppedFailedTrialFixture(),
      record = planFailedCustody(f);
    const id = record.intent.id,
      hash = record.intentHash;
    const sync = f.journal.syncRoot.bind(f.journal);
    vi.spyOn(f.journal, 'syncRoot').mockImplementation(() => {
      sync();
      if (JSON.parse(readFileSync(f.statePath(id), 'utf8')).phase === 'trial-frozen') {
        if (boundary === 'deadline') f.advance(120_001);
        else throw new Error('Lost frozen publication result');
      }
    });
    expect(() =>
      f.jobs.markTrialFrozen(id, hash, record.revision, {
        directory: '.restore-frozen-abc123',
        bytes: 4096,
        sha256: 'e'.repeat(64),
        fingerprint: 'd'.repeat(64),
      }),
    ).toThrow();
    vi.restoreAllMocks();
    const retained = f.openJobs().read(id)!;
    expect(retained.phase).toBe('trial-frozen');
    expect(retained.execution!.failure!.freeze!.output!.sha256).toBe('e'.repeat(64));
    expect(retained.execution!.frozen).toEqual(f.record.execution!.frozen);
  },
);

linux('candidate commit requires readiness and exact selected paused bindings', async () => {
  const f = await activatedTrialFixture();
  const id = f.record.intent.id,
    hash = f.record.intentHash;
  let record = f.jobs.planTrial(id, hash, f.record.revision, f.permit);
  f.select();
  const reference = restoreTrialReference(f.permit);
  expect(() => f.jobs.markCandidateCommitted(id, hash, record.revision, reference)).toThrow();
  record = f.jobs.markTrialOpening(id, hash, record.revision);
  record = f.jobs.markTrialReady(id, hash, record.revision, reference, f.permit.output.fingerprint);
  expect(record.execution!.readiness).toEqual({
    fingerprint: f.permit.output.fingerprint,
    acceptedAt: record.updatedAt,
  });
  expect(() => f.jobs.markCandidateCommitted(id, hash, record.revision, reference)).toThrow();
  f.journal.state.phase = 'paused';
  f.journal.write();
  const baseline = structuredClone(f.journal.state);
  for (const change of [
    () => {
      f.journal.state.child!.start = '0';
    },
    () => {
      f.journal.state.operation!.generationId = record.intent.target.generationId;
    },
    () => {
      f.journal.state.restoreJob!.intentHash = '0'.repeat(64);
    },
    () => {
      f.journal.state.restoreStop!.fingerprint = '0'.repeat(64);
    },
    () => {
      f.journal.state.epoch = record.intent.target.epoch;
    },
  ]) {
    change();
    expect(() => f.jobs.markCandidateCommitted(id, hash, record.revision, reference)).toThrow();
    Object.assign(f.journal.state, structuredClone(baseline));
  }
  expect(() =>
    f.jobs.markCandidateCommitted(id, hash, record.revision, { ...reference, nonce: randomUUID() }),
  ).toThrow();
  expect(() => f.jobs.markCandidateCommitted(id, hash, record.revision - 1, reference)).toThrow();
  expect(f.jobs.read(id)).toEqual(record);
  f.advance(1);
  const committed = f.jobs.markCandidateCommitted(id, hash, record.revision, reference);
  expect(committed.execution!.outcome).toEqual({
    role: 'candidate',
    fingerprint: f.permit.output.fingerprint,
    committedAt: committed.updatedAt,
  });
  expect(committed.execution!.readiness).toEqual(record.execution!.readiness);
  expect(committed.execution!.stop).toEqual(record.execution!.stop);
  expect(committed.intent).toEqual(record.intent);
  expect(isCommittedRestoreJob(committed)).toBe(true);
  expect(() => f.jobs.markCandidateCommitted(id, hash, committed.revision, reference)).toThrow();
  expect(() => f.jobs.admit(f.intent())).toThrow('Finish the current restore job');
  delete f.journal.state.restoreJob;
  f.journal.write();
  expect(f.jobs.admit(f.intent()).created).toBe(true);
});

linux(
  'terminal schema binds readiness and winner without importing live expiry or process checks',
  async () => {
    const f = await readyTrialFixture();
    const id = f.record.intent.id,
      hash = f.record.intentHash;
    f.advance(1);
    const committed = f.jobs.markCandidateCommitted(id, hash, f.record.revision, f.reference);
    for (const mutate of [
      (r: RestoreJobRecord) => {
        delete r.execution!.readiness;
      },
      (r: RestoreJobRecord) => {
        r.execution!.readiness!.fingerprint = '0'.repeat(64);
      },
      (r: RestoreJobRecord) => {
        r.execution!.readiness!.acceptedAt = r.execution!.preparation!.preparedAt - 1;
      },
      (r: RestoreJobRecord) => {
        r.execution!.readiness!.acceptedAt = r.updatedAt + 1;
      },
      (r: RestoreJobRecord) => {
        Object.assign(r.execution!.readiness!, { unexpected: true });
      },
      (r: RestoreJobRecord) => {
        delete r.execution!.outcome;
      },
      (r: RestoreJobRecord) => {
        Object.assign(r.execution!.outcome!, { role: 'original' });
      },
      (r: RestoreJobRecord) => {
        r.execution!.outcome!.fingerprint = '0'.repeat(64);
      },
      (r: RestoreJobRecord) => {
        r.execution!.outcome!.committedAt = r.execution!.readiness!.acceptedAt - 1;
      },
      (r: RestoreJobRecord) => {
        r.execution!.outcome!.committedAt = r.updatedAt + 1;
      },
      (r: RestoreJobRecord) => {
        r.execution!.outcome!.committedAt = r.execution!.trial!.deadline;
      },
      (r: RestoreJobRecord) => {
        Object.assign(r.execution!.outcome!, { unexpected: true });
      },
      (r: RestoreJobRecord) => {
        r.phase = 'trial-ready';
      },
    ]) {
      const invalid = structuredClone(committed);
      mutate(invalid);
      expect(isCommittedRestoreJob(invalid)).toBe(false);
      writeFileSync(f.statePath(id), JSON.stringify(invalid));
      expect(() => f.jobs.read(id)).toThrow();
    }
    writeFileSync(f.statePath(id), JSON.stringify(committed));
    const exit = once(f.child, 'exit');
    f.child.kill('SIGKILL');
    await exit;
    f.advance(60_000);
    expect(f.openJobs().read(id)).toEqual(committed);
    expect(f.jobs.admit(committed.intent)).toEqual({ record: committed, created: false });
    expect(isCommittedRestoreJob(committed)).toBe(true);
    expect(isCommittedRestoreJob(undefined)).toBe(false);
    expect(isCommittedRestoreJob({ phase: 'candidate-committed' })).toBe(false);
  },
);

linux.each(['expired', 'dead child', 'missing barrier', 'backwards clock'] as const)(
  'candidate commit refuses %s before publication',
  async (failure) => {
    const f = await readyTrialFixture();
    if (failure === 'expired') f.advance(60_000);
    if (failure === 'backwards clock') f.advance(-1);
    if (failure === 'missing barrier') rmSync(restoreBarrierPath(f.journal.databasePath));
    if (failure === 'dead child') {
      const exit = once(f.child, 'exit');
      f.child.kill('SIGKILL');
      await exit;
    }
    expect(() =>
      f.jobs.markCandidateCommitted(
        f.record.intent.id,
        f.record.intentHash,
        f.record.revision,
        f.reference,
      ),
    ).toThrow();
    expect(f.jobs.read(f.record.intent.id)).toEqual(f.record);
  },
);

linux.each(['expired', 'uncertain fsync'] as const)(
  'candidate winner survives %s after publication',
  async (failure) => {
    const f = await readyTrialFixture();
    const id = f.record.intent.id,
      hash = f.record.intentHash;
    const sync = f.journal.syncRoot.bind(f.journal);
    const fault = vi.spyOn(f.journal, 'syncRoot').mockImplementation(() => {
      sync();
      if (JSON.parse(readFileSync(f.statePath(id), 'utf8')).phase === 'candidate-committed') {
        if (failure === 'expired') f.advance(60_000);
        else throw new Error('injected post-publication fsync failure');
      }
    });
    expect(() => f.jobs.markCandidateCommitted(id, hash, f.record.revision, f.reference)).toThrow();
    fault.mockRestore();
    if (failure === 'uncertain fsync') expect(() => f.jobs.read(id)).toThrow();
    const reopened = f.openJobs();
    const committed = reopened.read(id)!;
    expect(isCommittedRestoreJob(committed)).toBe(true);
    expect(committed.execution!.readiness).toEqual(f.record.execution!.readiness);
    expect(committed.execution!.outcome!.fingerprint).toBe(f.permit.output.fingerprint);
    expect(() =>
      reopened.markCandidateCommitted(id, hash, f.record.revision, f.reference),
    ).toThrow();
    expect(reopened.read(id)).toEqual(committed);
  },
);

async function originalRecoveryFixture(expired = false) {
  const f = await stoppedFailedTrialFixture(expired);
  let record = planFailedCustody(f);
  record = f.jobs.markTrialFrozen(record.intent.id, record.intentHash, record.revision, {
    directory: '.restore-frozen-abc123',
    bytes: 4096,
    sha256: 'e'.repeat(64),
    fingerprint: 'd'.repeat(64),
  });
  return { ...f, record };
}
linux(
  'original recovery preserves sealed predecessor and refuses expired proof, skipped stages and altered history',
  async () => {
    const expired = await originalRecoveryFixture(true);
    expect(() =>
      expired.jobs.planOriginalPreparation(
        expired.record.intent.id,
        expired.record.intentHash,
        expired.record.revision,
        randomUUID(),
        expired.record.intent.authority.expiresAt,
      ),
    ).toThrow();
    const f = await originalRecoveryFixture(),
      id = f.record.intent.id,
      hash = f.record.intentHash;
    let record = f.jobs.planOriginalPreparation(
      id,
      hash,
      f.record.revision,
      randomUUID(),
      f.record.intent.authority.expiresAt,
    );
    expect(() =>
      f.jobs.planOriginalPreparation(
        id,
        hash,
        record.revision,
        randomUUID(),
        record.intent.authority.expiresAt,
      ),
    ).toThrow();
    expect(() =>
      f.jobs.planOriginalActivation(id, hash, record.revision, attemptFixture()),
    ).toThrow();
    record = f.jobs.markOriginalPrepared(id, hash, record.revision, {
      directory: '.restore-rollback-new123',
      bytes: 4096,
      sha256: '3'.repeat(64),
      fingerprint: '4'.repeat(64),
    });
    record = f.jobs.markOriginalRehearsed(id, hash, record.revision);
    expect(() =>
      f.jobs.planOriginalActivation(id, hash, record.revision, f.record.execution!.attempt!),
    ).toThrow();
    record = f.jobs.planOriginalActivation(id, hash, record.revision, attemptFixture());
    record = f.jobs.markOriginalStaged(id, hash, record.revision);
    record = f.jobs.markOriginalReplacing(id, hash, record.revision);
    record = f.jobs.markOriginalActivated(id, hash, record.revision);
    const { rollback, ...predecessor } = record.execution!;
    expect(predecessor).toEqual(f.record.execution);
    expect(rollback!.priorUpdatedAt).toBe(f.record.updatedAt);
    for (const mutate of [
      (r: RestoreJobRecord) => {
        r.execution!.rollback!.deadline++;
      },
      (r: RestoreJobRecord) => {
        r.execution!.rollback!.attempt!.epoch = r.execution!.attempt!.epoch;
      },
      (r: RestoreJobRecord) => {
        r.execution!.rollback!.image!.directory = '../original';
      },
      (r: RestoreJobRecord) => {
        delete r.execution!.failure;
      },
      (r: RestoreJobRecord) => {
        r.execution!.rollback!.priorUpdatedAt = r.intent.authority.expiresAt;
      },
      (r: RestoreJobRecord) => {
        r.phase = 'original-committed';
      },
    ]) {
      const changed = structuredClone(record);
      mutate(changed);
      writeFileSync(f.statePath(id), JSON.stringify(changed));
      expect(() => f.openJobs().read(id)).toThrow();
      writeFileSync(f.statePath(id), JSON.stringify(record));
    }
    f.advance(60_000);
    expect(f.openJobs().read(id)).toEqual(record);
    expect(() => f.jobs.markOriginalActivated(id, hash, record.revision)).toThrow();
  },
);

linux.each(['success', 'publication', 'expiry'] as const)(
  'original winner uses exact role and stays durable after %s',
  async (mode) => {
    const f = await originalRecoveryFixture(),
      id = f.record.intent.id,
      hash = f.record.intentHash;
    let record = f.jobs.planOriginalPreparation(
      id,
      hash,
      f.record.revision,
      randomUUID(),
      f.record.intent.authority.expiresAt,
    );
    record = f.jobs.markOriginalPrepared(id, hash, record.revision, {
      directory: '.restore-rollback-new123',
      bytes: 4096,
      sha256: '3'.repeat(64),
      fingerprint: '4'.repeat(64),
    });
    record = f.jobs.markOriginalRehearsed(id, hash, record.revision);
    record = f.jobs.planOriginalActivation(id, hash, record.revision, attemptFixture());
    record = f.jobs.markOriginalStaged(id, hash, record.revision);
    record = f.jobs.markOriginalReplacing(id, hash, record.revision);
    record = f.jobs.markOriginalActivated(id, hash, record.revision);
    const token = randomUUID(),
      child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          "process.on('message', () => {}); process.send({ ready: true });",
        ],
        {
          env: { ...process.env, SPINEL_PROCESS_GROUP_TOKEN: token },
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        },
      );
    cleanups.push(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    });
    await once(child, 'message');
    const image = record.execution!.rollback!.image!,
      permit: RestoreTrialPermit = {
        ...f.permit,
        ...record.execution!.rollback!.attempt!,
        role: 'original',
        child: processIdentity(child.pid!, token)!,
        output: { bytes: image.bytes, sha256: image.sha256, fingerprint: image.fingerprint },
        deadline: record.execution!.rollback!.deadline,
      };
    expect(() =>
      f.jobs.planOriginalTrial(id, hash, record.revision, { ...permit, role: 'candidate' }),
    ).toThrow();
    expect(() =>
      f.jobs.planOriginalTrial(id, hash, record.revision, { ...permit, child: f.permit.child }),
    ).toThrow();
    record = f.jobs.planOriginalTrial(id, hash, record.revision, permit);
    Object.assign(f.journal.state, {
      phase: 'starting',
      generationId: permit.generationId,
      epoch: permit.epoch,
      child: permit.child,
    });
    f.journal.state.operation!.generationId = permit.generationId;
    f.journal.write();
    record = f.jobs.markOriginalTrialOpening(id, hash, record.revision);
    const reference = restoreTrialReference(permit);
    expect(() =>
      f.jobs.markOriginalTrialReady(id, hash, record.revision, f.stop.reference, image.fingerprint),
    ).toThrow();
    record = f.jobs.markOriginalTrialReady(id, hash, record.revision, reference, image.fingerprint);
    expect(() => f.jobs.markOriginalCommitted(id, hash, record.revision, reference)).toThrow();
    f.journal.state.phase = 'paused';
    f.journal.write();
    expect(() => f.jobs.markCandidateCommitted(id, hash, record.revision, reference)).toThrow();
    if (mode !== 'success') {
      const sync = f.journal.syncRoot.bind(f.journal);
      vi.spyOn(f.journal, 'syncRoot').mockImplementation(() => {
        sync();
        if (JSON.parse(readFileSync(f.statePath(id), 'utf8')).phase === 'original-committed') {
          if (mode === 'publication') throw new Error('Lost original winner publication');
          f.advance(60_000);
        }
      });
      expect(() => f.jobs.markOriginalCommitted(id, hash, record.revision, reference)).toThrow();
      vi.restoreAllMocks();
      record = f.openJobs().read(id)!;
    } else record = f.jobs.markOriginalCommitted(id, hash, record.revision, reference);
    expect(record.phase).toBe('original-committed');
    expect(isCommittedRestoreJob(record)).toBe(true);
    expect(record.execution!.rollback!.outcome!.fingerprint).toBe(image.fingerprint);
    expect(record.execution!.trial).toEqual(f.record.execution!.trial);
    expect(record.execution!.failure).toEqual(f.record.execution!.failure);
    f.advance(60_000);
    expect(f.openJobs().read(id)).toEqual(record);
    expect(() =>
      f.jobs.planOriginalPreparation(
        id,
        hash,
        record.revision,
        randomUUID(),
        record.intent.authority.expiresAt,
      ),
    ).toThrow();
  },
);
