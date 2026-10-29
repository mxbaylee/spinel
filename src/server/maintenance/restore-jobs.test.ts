import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
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
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { restoreIntentHash } from './restore-job-intent.ts';

const boundaries = vi.hoisted(() => ({ onRead: undefined as (() => void) | undefined }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
      boundaries.onRead?.();
      return actual.readSync(fd, buffer, offset, length, position);
    },
  };
});

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  boundaries.onRead = undefined;
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
  f.advance(1001);
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
    f.advance(1000);
    expect(() => f.jobs.checkpoint(intent.id, record.intentHash, 0, 'source-retained')).toThrow(
      'expired',
    );
    f.jobs.checkpoint(intent.id, record.intentHash, 0, 'failed');
    const stale = f.intent();
    f.advance(1000);
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
    f.advance(1000);
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
    f.jobs.admit(intent);
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
