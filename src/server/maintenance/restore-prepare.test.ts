import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { prepareRestoreAttempt } from './restore-prepare.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { restoreIntentHash } from './restore-job-intent.ts';
import type {
  RestoreJobRecord,
  RestoreJobs,
  RestorePreparation,
  RestorePreparedImage,
} from './restore-jobs.ts';
import { reconcilePreparedRestore } from '../backup/verification.ts';
import { prepareRestoreRollback } from '../backup/restore-rollback.ts';
import { rehearseRestoreStartup } from '../backup/restore-startup.ts';
import { readRetainedRestoreSource } from './restore-files.ts';
import { syncRestoreDirectory } from '../backup/restore-input.ts';

vi.mock('../backup/verification.ts', () => ({ reconcilePreparedRestore: vi.fn() }));
vi.mock('../backup/restore-rollback.ts', () => ({ prepareRestoreRollback: vi.fn() }));
vi.mock('../backup/restore-startup.ts', () => ({ rehearseRestoreStartup: vi.fn() }));
vi.mock('./restore-files.ts', async (original) => {
  const actual = await original<typeof import('./restore-files.ts')>();
  return { ...actual, readRetainedRestoreSource: vi.fn() };
});
vi.mock('../backup/restore-input.ts', async (original) => {
  const actual = await original<typeof import('../backup/restore-input.ts')>();
  return { ...actual, syncRestoreDirectory: vi.fn(actual.syncRestoreDirectory) };
});
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Portable controller sequencing/custody fixture. Worker outputs deliberately
 * contain opaque bytes, not SQLite. Real worker semantics belong to the complete
 * application supervisor fixture; the Linux store tests cover actual publication.
 */
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spinel-restore-prepare-')));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  let time = Date.now();
  const intent = restoreJobIntentFixture(time);
  const retained = join(root, `restore-${intent.id}`);
  await mkdir(retained, { mode: 0o700 });
  const freezeSlot = randomUUID();
  const frozenPath = join(
    retained,
    `freeze-${freezeSlot}`,
    '.restore-frozen-ABC123',
    'frozen.sqlite',
  );
  await mkdir(dirname(frozenPath), { recursive: true, mode: 0o700 });
  const bytes = Buffer.alloc(4096, 'F');
  await writeFile(frozenPath, bytes, { mode: 0o600 });
  const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  let state: RestoreJobRecord = {
    version: 1,
    revision: 10,
    intent,
    intentHash: restoreIntentHash(intent),
    phase: 'frozen',
    updatedAt: time,
    execution: {
      epoch: randomUUID(),
      child: { pid: 1234, start: '100', boot: randomUUID(), token: randomUUID() },
      requestedAt: time,
      stop: {
        request: {
          jobId: intent.id,
          challengeId: randomUUID(),
          epoch: randomUUID(),
          generationId: intent.target.generationId,
          deadline: time + 5000,
        },
        databaseIdentity: intent.target.identity,
        child: { pid: 1234, start: '100', boot: randomUUID(), token: randomUUID() },
        fingerprint: 'a'.repeat(64),
        acceptedAt: time,
      },
      freezeSlot,
      frozen: {
        directory: '.restore-frozen-ABC123',
        bytes: bytes.length,
        sha256: digest(bytes),
        fingerprint: 'a'.repeat(64),
      },
    },
  };
  const initial = structuredClone(state);
  const events: string[] = [];
  let onPublish: ((phase: RestoreJobRecord['phase']) => void) | undefined;
  const publish = (
    id: string,
    hash: string,
    revision: number,
    from: RestoreJobRecord['phase'],
    phase: RestoreJobRecord['phase'],
    preparation: RestorePreparation,
  ) => {
    if (
      id !== state.intent.id ||
      hash !== state.intentHash ||
      revision !== state.revision ||
      state.phase !== from
    )
      throw new Error('Refused stale preparation stage');
    state = {
      ...state,
      phase,
      revision: revision + 1,
      updatedAt: time,
      execution: { ...state.execution!, preparation },
    };
    events.push(phase);
    onPublish?.(phase);
    return structuredClone(state);
  };
  const jobs = {
    planPreparation: vi.fn(
      (id: string, hash: string, revision: number, slot: string, preparedAt: number) =>
        publish(id, hash, revision, 'frozen', 'preparation-planned', { slot, preparedAt }),
    ),
    markCandidatePrepared: vi.fn(
      (id: string, hash: string, revision: number, candidate: RestorePreparedImage) =>
        publish(id, hash, revision, 'preparation-planned', 'candidate-prepared', {
          ...state.execution!.preparation!,
          candidate,
        }),
    ),
    markRollbackPrepared: vi.fn(
      (id: string, hash: string, revision: number, rollback: RestorePreparedImage) =>
        publish(id, hash, revision, 'candidate-prepared', 'rollback-prepared', {
          ...state.execution!.preparation!,
          rollback,
        }),
    ),
    markCandidateRehearsed: vi.fn((id: string, hash: string, revision: number) =>
      publish(
        id,
        hash,
        revision,
        'rollback-prepared',
        'candidate-rehearsed',
        state.execution!.preparation!,
      ),
    ),
    markPrepared: vi.fn((id: string, hash: string, revision: number) =>
      publish(id, hash, revision, 'candidate-rehearsed', 'prepared', state.execution!.preparation!),
    ),
  };
  const sourcePath = join(root, 'source.sqlite');
  await writeFile(sourcePath, Buffer.alloc(4096, 'S'), { mode: 0o600 });
  const source = {
    manifest: intent.source,
    archive: { path: join(root, 'source.enc'), ...intent.source.archive },
    candidate: {
      databasePath: sourcePath,
      databaseBytes: 4096,
      databaseSha256: digest(Buffer.alloc(4096, 'S')),
      recovery: intent.source.recovery,
    },
  };
  vi.mocked(readRetainedRestoreSource).mockResolvedValue(source);
  const outputs: string[] = [];
  const dispose = vi.fn();
  vi.mocked(reconcilePreparedRestore).mockImplementation(async (options) => {
    events.push('candidate-worker');
    const directory = await mkdtemp(join(options.stagingRoot, '.restore-reconciled-'));
    await mkdir(join(directory, 'restored'), { mode: 0o700 });
    const databasePath = join(directory, 'restored', 'spinel.sqlite');
    const data = Buffer.alloc(4096, 'C');
    await writeFile(databasePath, data, { mode: 0o600 });
    outputs.push(databasePath);
    return {
      databasePath,
      databaseBytes: data.length,
      databaseSha256: digest(data),
      logicalFingerprint: 'c'.repeat(64),
      recovery: intent.source.recovery,
      tables: 1,
      rows: 1,
      snapshots: 0,
      images: 0,
      dispose,
    };
  });
  vi.mocked(prepareRestoreRollback).mockImplementation(async (options) => {
    events.push('rollback-worker');
    const directory = await mkdtemp(join(options.stagingRoot, '.restore-rollback-'));
    const databasePath = join(directory, 'rollback.sqlite');
    const data = Buffer.alloc(4096, 'R');
    await writeFile(databasePath, data, { mode: 0o600 });
    outputs.push(databasePath);
    return {
      databasePath,
      databaseBytes: data.length,
      databaseSha256: digest(data),
      logicalFingerprint: 'd'.repeat(64),
      originalFingerprint: options.current.fingerprint,
      tables: 1,
      rows: 1,
      snapshots: 0,
      images: 0,
      reconciliation: {
        credentials: { currentAccounts: 1, currentPasskeys: 1 },
        receipts: { copied: 0, matched: 0 },
        operations: { copied: 0, defaulted: 0 },
        generations: { rotated: 0, initialized: 0, revisionOffset: 1 },
      },
      dispose,
    };
  });
  vi.mocked(rehearseRestoreStartup).mockImplementation(async () => {
    events.push('rehearsal');
  });
  const controller = new AbortController();
  const assertClosed = vi.fn();
  const options = {
    jobs: jobs as unknown as RestoreJobs,
    record: initial,
    root,
    now: () => time,
    signal: controller.signal,
    assertClosed,
    deadline: Date.now() + 30_000,
  };
  return {
    options,
    jobs,
    initial,
    outputs,
    events,
    dispose,
    source,
    frozenPath,
    retained,
    controller,
    state: () => structuredClone(state),
    advance: (ms: number) => {
      time += ms;
    },
    onPublish: (hook: typeof onPublish) => {
      onPublish = hook;
    },
  };
}

test('one planned slot preserves frozen authority, candidate negative evidence and both startup proofs', async () => {
  const f = await fixture();
  f.onPublish((phase) => {
    const plan = f.state().execution!.preparation!;
    const staging = join(f.retained, `prepare-${plan.slot}`);
    if (phase === 'preparation-planned') expect(existsSync(staging)).toBe(false);
    else if (phase === 'candidate-prepared' || phase === 'rollback-prepared')
      expect(vi.mocked(syncRestoreDirectory).mock.calls.at(-1)?.[0]).toBe(staging);
    f.advance(1); // Every worker must still receive the one immutable timestamp.
  });
  const result = await prepareRestoreAttempt(f.options);
  expect(result.phase).toBe('prepared');
  expect(result.revision).toBe(f.initial.revision + 5);
  expect(result.intent).toEqual(f.initial.intent);
  expect(result.execution!.frozen).toEqual(f.initial.execution!.frozen);
  expect(f.events).toEqual([
    'preparation-planned',
    'candidate-worker',
    'candidate-prepared',
    'rollback-worker',
    'rollback-prepared',
    'rehearsal',
    'candidate-rehearsed',
    'rehearsal',
    'prepared',
  ]);
  const candidate = vi.mocked(reconcilePreparedRestore).mock.calls[0][0];
  const rollback = vi.mocked(prepareRestoreRollback).mock.calls[0][0];
  expect(candidate.current.databasePath).toBe(f.frozenPath);
  expect(candidate.candidate).toEqual(f.source.candidate);
  expect(rollback.current).toEqual({
    ...candidate.current,
    fingerprint: f.initial.execution!.stop!.fingerprint,
  });
  expect(rollback.additional.map((input) => input.databasePath)).toEqual([f.outputs[0]]);
  expect(candidate.now).toBe(result.execution!.preparation!.preparedAt);
  expect(rollback.now).toBe(candidate.now);
  const rehearsals = vi.mocked(rehearseRestoreStartup).mock.calls.map(([input]) => input);
  expect(rehearsals.map((input) => input.candidate.databasePath)).toEqual(f.outputs);
  expect(
    rehearsals.every((input) => input.staticDirectory === result.intent.policy.staticDirectory),
  ).toBe(true);
  expect(await readFile(f.frozenPath)).toEqual(Buffer.alloc(4096, 'F'));
  expect(f.dispose).not.toHaveBeenCalled();
});

test.each(['candidate-prepared', 'rollback-prepared', 'candidate-rehearsed', 'prepared'] as const)(
  'publication uncertainty at %s retains exact outputs and refuses a new slot',
  async (failed) => {
    const f = await fixture();
    f.onPublish((phase) => {
      if (phase === failed) throw new Error('Published then failed');
    });
    await expect(prepareRestoreAttempt(f.options)).rejects.toThrow('Published then failed');
    const retained = f.outputs.map((path) => readFileSync(path));
    const dirs = readdirSync(f.retained);
    expect(f.state().phase).toBe(failed);
    await expect(prepareRestoreAttempt({ ...f.options, record: f.state() })).rejects.toThrow(
      'stale preparation',
    );
    expect(readdirSync(f.retained)).toEqual(dirs);
    expect(f.outputs.map((path) => readFileSync(path))).toEqual(retained);
    expect(f.dispose).not.toHaveBeenCalled();
  },
);

test('failed rollback and failed candidate rehearsal cannot advertise prepared or automatically retry', async () => {
  const f = await fixture();
  vi.mocked(prepareRestoreRollback).mockRejectedValueOnce(new Error('Rollback refused'));
  await expect(prepareRestoreAttempt(f.options)).rejects.toThrow('Rollback refused');
  expect(f.state().phase).toBe('candidate-prepared');
  expect(f.outputs).toHaveLength(1);
  expect(rehearseRestoreStartup).not.toHaveBeenCalled();
  const second = await fixture();
  vi.mocked(rehearseRestoreStartup).mockRejectedValueOnce(new Error('Startup writes'));
  await expect(prepareRestoreAttempt(second.options)).rejects.toThrow('Startup writes');
  expect(second.state().phase).toBe('rollback-prepared');
  expect(second.outputs).toHaveLength(2);
  expect(second.jobs.markPrepared).not.toHaveBeenCalled();
});

test.each(['cancel', 'expiry', 'deadline'] as const)(
  '%s immediately after final publication retains evidence and refuses success',
  async (cause) => {
    const f = await fixture();
    const clock = Date.now;
    let late = false;
    vi.spyOn(Date, 'now').mockImplementation(() => (late ? f.options.deadline : clock()));
    f.onPublish((phase) => {
      if (phase !== 'prepared') return;
      if (cause === 'cancel') f.controller.abort();
      else if (cause === 'expiry') f.advance(60_000);
      else late = true;
    });
    await expect(prepareRestoreAttempt(f.options)).rejects.toThrow();
    expect(f.state().phase).toBe('prepared');
    expect(f.outputs.every((path) => existsSync(path))).toBe(true);
    expect(f.dispose).not.toHaveBeenCalled();
  },
);

test('closure lost after candidate worker or synchronous scan crosses expiry stops before rollback', async () => {
  const f = await fixture();
  f.options.assertClosed.mockImplementation(() => {
    if (f.outputs.length) throw new Error('Original reopened');
  });
  await expect(prepareRestoreAttempt(f.options)).rejects.toThrow('Original reopened');
  expect(f.outputs).toHaveLength(1);
  expect(f.state().phase).toBe('preparation-planned');
  expect(prepareRestoreRollback).not.toHaveBeenCalled();
  const second = await fixture();
  second.options.assertClosed.mockImplementationOnce(() => {
    second.advance(60_000);
  });
  await expect(prepareRestoreAttempt(second.options)).rejects.toThrow('deadline');
  expect(second.jobs.planPreparation).not.toHaveBeenCalled();
});

test('a reserved slot survives an uncertain plan before any worker starts', async () => {
  const f = await fixture();
  f.onPublish((phase) => {
    if (phase === 'preparation-planned') throw new Error('Plan publication uncertain');
  });
  await expect(prepareRestoreAttempt(f.options)).rejects.toThrow('Plan publication uncertain');
  expect(reconcilePreparedRestore).not.toHaveBeenCalled();
  const directories = readdirSync(f.retained);
  await expect(prepareRestoreAttempt({ ...f.options, record: f.state() })).rejects.toThrow();
  expect(readdirSync(f.retained)).toEqual(directories);
});

test.each(['path', 'sidecar', 'hash', 'witness'] as const)(
  'changed output %s refuses advancement and preserves successful evidence',
  async (kind) => {
    const f = await fixture();
    if (kind === 'witness') {
      const work = vi.mocked(prepareRestoreRollback).getMockImplementation()!;
      vi.mocked(prepareRestoreRollback).mockImplementation(async (options) => ({
        ...(await work(options)),
        originalFingerprint: '0'.repeat(64),
      }));
    } else {
      const work = vi.mocked(reconcilePreparedRestore).getMockImplementation()!;
      vi.mocked(reconcilePreparedRestore).mockImplementation(async (options) => {
        const output = await work(options);
        if (kind === 'path') return { ...output, databasePath: f.source.candidate.databasePath };
        if (kind === 'hash') return { ...output, databaseSha256: '0'.repeat(64) };
        await writeFile(output.databasePath + '-wal', '', { mode: 0o600 });
        return output;
      });
    }
    await expect(prepareRestoreAttempt(f.options)).rejects.toThrow();
    expect(f.state().phase).toBe(kind === 'witness' ? 'candidate-prepared' : 'preparation-planned');
    expect(f.outputs.every((path) => existsSync(path))).toBe(true);
    expect(f.dispose).not.toHaveBeenCalled();
  },
);
