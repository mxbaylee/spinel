import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { activateRestoreAttempt } from './restore-activate.ts';
import { captureRestoreOriginals, preserveRestoreOriginals } from './restore-files.ts';
import { restoreBarrierPath } from './restore-barrier.ts';
import { fileIdentity } from './journal.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { restoreIntentHash } from './restore-job-intent.ts';
import type { RestoreAttempt, RestoreJobRecord, RestoreJobs } from './restore-jobs.ts';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const evidence = (bytes: Buffer) => ({
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

/** Portable byte-custody integration: actual staging/overwrite/barrier helpers,
 * opaque already-prepared bytes, and a recording store substitute. Linux store
 * tests independently enforce schema/journal bindings; no SQLite is opened here. */
async function fixture(candidateBytes = 8193) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-activate-')));
  directories.push(directory);
  const root = join(directory, 'recovery'),
    databasePath = join(directory, 'workspace.sqlite');
  await mkdir(root, { mode: 0o700 });
  const original = Buffer.alloc(16_385, 'O'),
    candidate = Buffer.alloc(candidateBytes, 'C');
  await writeFile(databasePath, original, { mode: 0o600 });
  await writeFile(databasePath + '-wal', 'Original committed WAL', { mode: 0o600 });
  await writeFile(databasePath + '-shm', 'Original runtime index', { mode: 0o600 });
  const identity = fileIdentity(databasePath);
  let now = Date.now();
  const intent = restoreJobIntentFixture(now);
  intent.target.databasePath = databasePath;
  intent.target.identity = identity;
  const assertClosed = vi.fn(() => {
    expect(fileIdentity(databasePath)).toEqual(identity);
  });
  const custody = { root, id: intent.id, databasePath, assertClosed };
  const originals = await captureRestoreOriginals(custody);
  await preserveRestoreOriginals(custody, originals);
  const retained = join(root, `restore-${intent.id}`),
    slot = randomUUID();
  const candidatePath = join(
    retained,
    `prepare-${slot}`,
    '.restore-reconciled-ABC123',
    'restored',
    'spinel.sqlite',
  );
  await mkdir(dirname(candidatePath), { recursive: true, mode: 0o700 });
  await writeFile(candidatePath, candidate, { mode: 0o600 });
  const epoch = randomUUID(),
    child = { pid: 1234, start: '100', boot: randomUUID(), token: randomUUID() };
  let state: RestoreJobRecord = {
    version: 1,
    revision: 15,
    intent,
    intentHash: restoreIntentHash(intent),
    phase: 'prepared',
    updatedAt: now,
    execution: {
      epoch,
      child,
      requestedAt: now,
      stop: {
        request: {
          jobId: intent.id,
          challengeId: randomUUID(),
          generationId: intent.target.generationId,
          epoch,
          deadline: now + 5000,
        },
        databaseIdentity: identity,
        child,
        fingerprint: 'a'.repeat(64),
        acceptedAt: now,
      },
      originals,
      freezeSlot: randomUUID(),
      frozen: {
        directory: '.restore-frozen-ABC123',
        ...evidence(original),
        fingerprint: 'a'.repeat(64),
      },
      preparation: {
        slot,
        preparedAt: now,
        candidate: {
          directory: '.restore-reconciled-ABC123',
          ...evidence(candidate),
          fingerprint: 'c'.repeat(64),
        },
        rollback: {
          directory: '.restore-rollback-ABC123',
          ...evidence(original),
          fingerprint: 'd'.repeat(64),
        },
      },
    },
  };
  const initial = structuredClone(state),
    events: RestoreJobRecord['phase'][] = [];
  let hook: ((phase: RestoreJobRecord['phase']) => void) | undefined;
  const publish = (
    id: string,
    hash: string,
    revision: number,
    from: RestoreJobRecord['phase'],
    phase: RestoreJobRecord['phase'],
    attempt = state.execution!.attempt,
  ) => {
    if (
      id !== state.intent.id ||
      hash !== state.intentHash ||
      revision !== state.revision ||
      state.phase !== from
    )
      throw new Error('Stale activation stage');
    state = {
      ...state,
      phase,
      revision: revision + 1,
      updatedAt: now,
      execution: { ...state.execution!, attempt },
    };
    events.push(phase);
    hook?.(phase);
    return structuredClone(state);
  };
  const jobs = {
    planActivation: vi.fn((id: string, hash: string, revision: number, attempt: RestoreAttempt) =>
      publish(id, hash, revision, 'prepared', 'activation-planned', attempt),
    ),
    markCandidateStaged: vi.fn((id: string, hash: string, revision: number) =>
      publish(id, hash, revision, 'activation-planned', 'candidate-staged'),
    ),
    markCandidateReplacing: vi.fn((id: string, hash: string, revision: number) =>
      publish(id, hash, revision, 'candidate-staged', 'candidate-replacing'),
    ),
    markCandidateActivated: vi.fn((id: string, hash: string, revision: number) =>
      publish(id, hash, revision, 'candidate-replacing', 'candidate-activated'),
    ),
    read: vi.fn(() => structuredClone(state)),
  };
  const controller = new AbortController();
  const options = {
    jobs: jobs as unknown as RestoreJobs,
    record: initial,
    root,
    databasePath,
    now: () => now,
    signal: controller.signal,
    assertClosed,
    deadline: Date.now() + 30_000,
  };
  return {
    options,
    jobs,
    initial,
    original,
    candidate,
    candidatePath,
    retained,
    controller,
    identity,
    state: () => structuredClone(state),
    onPublish: (callback: typeof hook) => {
      hook = callback;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('one durable activation attempt stages the selected candidate and preserves the original inode, tuple and witness', async () => {
  const f = await fixture();
  f.onPublish((phase) => {
    const barrier = existsSync(restoreBarrierPath(f.options.databasePath));
    if (phase === 'activation-planned')
      expect(existsSync(join(f.retained, 'candidate.sqlite'))).toBe(false);
    if (phase === 'candidate-staged') expect(barrier).toBe(false);
    if (phase === 'candidate-replacing') {
      expect(barrier).toBe(true);
      expect(readFileSync(f.options.databasePath)).toEqual(f.original);
    }
    if (phase === 'candidate-activated') {
      expect(barrier).toBe(true);
      expect(readFileSync(f.options.databasePath)).toEqual(f.candidate);
      expect(existsSync(f.options.databasePath + '-wal')).toBe(false);
    }
  });
  const result = await activateRestoreAttempt(f.options);
  expect(result.phase).toBe('candidate-activated');
  expect(result.revision).toBe(f.initial.revision + 4);
  expect(fileIdentity(f.options.databasePath)).toEqual(f.identity);
  expect(await readFile(join(f.retained, 'original', 'spinel.sqlite'))).toEqual(f.original);
  expect(await readFile(join(f.retained, 'original', 'spinel.sqlite-wal'), 'utf8')).toBe(
    'Original committed WAL',
  );
  expect(await readFile(join(f.retained, 'original', 'spinel.sqlite-shm'), 'utf8')).toBe(
    'Original runtime index',
  );
  expect(await readFile(f.candidatePath)).toEqual(f.candidate);
  expect(result.intent).toEqual(f.initial.intent);
  expect(result.execution).toEqual({ ...f.initial.execution, attempt: result.execution!.attempt });
  expect(new Set(Object.values(result.execution!.attempt!)).size).toBe(4);
});

test.each([
  'activation-planned',
  'candidate-staged',
  'candidate-replacing',
  'candidate-activated',
] as const)(
  'uncertain %s publication retains evidence and cannot start a new activation attempt',
  async (failed) => {
    const f = await fixture();
    f.onPublish((phase) => {
      if (phase === failed) throw new Error('Published then failed');
    });
    await expect(activateRestoreAttempt(f.options)).rejects.toThrow('Published then failed');
    expect(f.state().phase).toBe(failed);
    const before = await readFile(f.options.databasePath);
    expect(before).toEqual(failed === 'candidate-activated' ? f.candidate : f.original);
    expect(existsSync(restoreBarrierPath(f.options.databasePath))).toBe(
      ['candidate-replacing', 'candidate-activated'].includes(failed),
    );
    await expect(activateRestoreAttempt({ ...f.options, record: f.state() })).rejects.toThrow(
      'Stale activation',
    );
    expect(await readFile(f.options.databasePath)).toEqual(before);
    expect(await readFile(join(f.retained, 'original', 'spinel.sqlite'))).toEqual(f.original);
  },
);

test.each(['cancel', 'expiry', 'deadline'] as const)(
  '%s during replacing persistence leaves original bytes behind the published barrier',
  async (cause) => {
    const f = await fixture();
    const clock = Date.now;
    let late = false;
    vi.spyOn(Date, 'now').mockImplementation(() => (late ? f.options.deadline : clock()));
    f.onPublish((phase) => {
      if (phase !== 'candidate-replacing') return;
      if (cause === 'cancel') f.controller.abort();
      else if (cause === 'expiry') f.advance(60_000);
      else late = true;
    });
    await expect(activateRestoreAttempt(f.options)).rejects.toThrow();
    expect(f.state().phase).toBe('candidate-replacing');
    expect(await readFile(f.options.databasePath)).toEqual(f.original);
    expect(existsSync(restoreBarrierPath(f.options.databasePath))).toBe(true);
    expect(f.jobs.markCandidateActivated).not.toHaveBeenCalled();
  },
);

test('changed candidate or durable attempt cannot reach the live overwrite', async () => {
  const f = await fixture();
  await writeFile(f.candidatePath, Buffer.alloc(f.candidate.length, 'X'));
  await expect(activateRestoreAttempt(f.options)).rejects.toThrow();
  expect(f.state().phase).toBe('activation-planned');
  expect(await readFile(f.options.databasePath)).toEqual(f.original);
  const next = await fixture();
  next.jobs.read.mockImplementation(() => {
    const record = next.state();
    record.execution!.attempt!.nonce = randomUUID();
    return record;
  });
  await expect(activateRestoreAttempt(next.options)).rejects.toThrow('evidence changed');
  expect(await readFile(next.options.databasePath)).toEqual(next.original);
  expect(existsSync(restoreBarrierPath(next.options.databasePath))).toBe(false);
});

test('late final authorization failure preserves the installed candidate and its barrier', async () => {
  const f = await fixture();
  f.onPublish((phase) => {
    if (phase === 'candidate-activated') f.advance(60_000);
  });
  await expect(activateRestoreAttempt(f.options)).rejects.toThrow('expired');
  expect(f.state().phase).toBe('candidate-activated');
  expect(await readFile(f.options.databasePath)).toEqual(f.candidate);
  expect(existsSync(restoreBarrierPath(f.options.databasePath))).toBe(true);
  expect(await readFile(join(f.retained, 'original', 'spinel.sqlite'))).toEqual(f.original);
});

test.each(['staging', 'live'] as const)(
  'original authority clock crossing after first %s chunk stops before the remaining bytes',
  async (stage) => {
    const f = await fixture(2 * 64 * 1024 + 7);
    const staged = join(f.retained, 'candidate.sqlite');
    const written = () =>
      stage === 'live'
        ? readFileSync(f.options.databasePath)[0] === f.candidate[0]
        : existsSync(staged) && readFileSync(staged).length > 0;
    const originalTime = f.options.now();
    // Only the proof clock jumps. The controller's wall-clock deadline and abort
    // timer remain live, so neither can substitute for per-I/O authorization.
    await expect(
      activateRestoreAttempt({
        ...f.options,
        now: () => originalTime + (written() ? 60_000 : 0),
      }),
    ).rejects.toThrow('expired');
    expect(Date.now()).toBeLessThan(f.options.deadline);
    expect(f.controller.signal.aborted).toBe(false);
    expect(fileIdentity(f.options.databasePath)).toEqual(f.identity);
    expect(f.state().phase).toBe(stage === 'live' ? 'candidate-replacing' : 'activation-planned');
    expect(existsSync(restoreBarrierPath(f.options.databasePath))).toBe(stage === 'live');
    const partial = await readFile(stage === 'live' ? f.options.databasePath : staged);
    expect(partial).toEqual(f.candidate.subarray(0, 64 * 1024));
    if (stage === 'staging') expect(await readFile(f.options.databasePath)).toEqual(f.original);
    else expect(await readFile(staged)).toEqual(f.candidate);
    expect(await readFile(f.options.databasePath + '-wal', 'utf8')).toBe('Original committed WAL');
    expect(await readFile(f.candidatePath)).toEqual(f.candidate);
    expect(await readFile(join(f.retained, 'original', 'spinel.sqlite'))).toEqual(f.original);
    expect(f.jobs.markCandidateActivated).not.toHaveBeenCalled();
  },
);
