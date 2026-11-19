import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { RecoveryJournal, fileIdentity, processIdentity } from './journal.ts';
import { restoreBarrierPath } from './restore-barrier.ts';
import {
  RestoreJobs,
  currentRestoreRecovery,
  isCommittedRestoreJob,
  restoreJobDeadline,
  restoreJobOperation,
  restoreJobPhase,
  selectedRestoreTrial,
  validRestoreJobRecord,
} from './restore-jobs.ts';
import type { RestoreJobRecord } from './restore-jobs.ts';
import { coldRecoveryPriorGenerations, validRestoreColdRecovery } from './restore-cold-state.ts';
import type { ColdRecoveryGrant, ColdRecoveryPhase } from './restore-cold-state.ts';
import type { ColdRestoreCustody } from './restore-files.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { restoreIntentHash } from './restore-job-intent.ts';
import { restoreTrialReference } from './restore-trial.ts';
import type { RestoreTrialPermit } from './restore-trial.ts';
import { interruptedTrialFingerprint, prepareColdRestoreOriginal } from './restore-cold.ts';
import * as restoreFiles from './restore-files.ts';
import {
  cleanupPlannedRestoreTrial,
  finishRestoreCrashCleanup,
} from './restore-crash-cleanup-fixture.ts';
import { MaintenanceSupervisor } from './supervisor.ts';
import { processResourcesReleased } from './process-exit.ts';

const cleanups: Array<() => void | Promise<void>> = [];
const directories: string[] = [];
afterEach(async () => {
  const retained = directories.splice(0);
  try {
    await finishRestoreCrashCleanup(
      cleanups
        .splice(0)
        .reverse()
        .map((cleanup) => async () => cleanup()),
    );
    // Every resource cleanup ran above. Any failure skips removal so uncertain
    // process closure cannot discard the fixture's diagnostic evidence.
    await finishRestoreCrashCleanup(
      retained.map((directory) => () => rm(directory, { recursive: true, force: true })),
    );
  } finally {
    vi.restoreAllMocks();
  }
});
const linux = test.skipIf(process.platform !== 'linux');
const attemptIds = () => ({
  attemptId: randomUUID(),
  generationId: randomUUID(),
  epoch: randomUUID(),
  nonce: randomUUID(),
});

/** Metadata fixture only. Real SQLite, process closure and file installation are
 * exercised by the SIGKILL integration tests, not inferred from these hashes. */
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-cold-state-')));
  directories.push(directory);
  const root = join(directory, 'recovery');
  await mkdir(root, { mode: 0o700 });
  const data = join(directory, 'data');
  await mkdir(data, { mode: 0o700 });
  const databasePath = join(data, 'workspace.sqlite');
  writeFileSync(databasePath, Buffer.alloc(4096), { mode: 0o600 });
  let journal = await RecoveryJournal.open(root, databasePath);
  await journal.bindWorkspace();
  let now = Date.now();
  const time = () => (now = Math.max(now, Date.now()));
  const historicalTime = now - 120_000;
  const intent = restoreJobIntentFixture(historicalTime);
  intent.target = {
    instanceId: journal.state.instanceId,
    generationId: journal.state.generationId,
    epoch: journal.state.epoch,
    databasePath,
    identity: fileIdentity(databasePath),
  };
  const child = { pid: 1234, start: '100', boot: randomUUID(), token: randomUUID() };
  const epoch = randomUUID();
  const stop = {
    request: {
      jobId: intent.id,
      generationId: intent.target.generationId,
      epoch,
      challengeId: randomUUID(),
      deadline: historicalTime + 30_000,
    },
    databaseIdentity: intent.target.identity,
    child,
    fingerprint: 'a'.repeat(64),
    acceptedAt: historicalTime + 1,
  };
  const original: RestoreJobRecord = {
    version: 1,
    revision: 20,
    intent,
    intentHash: restoreIntentHash(intent),
    phase: 'candidate-replacing',
    updatedAt: historicalTime + 4,
    execution: {
      epoch,
      child,
      requestedAt: historicalTime,
      stop,
      originals: {
        id: intent.id,
        identity: intent.target.identity,
        original: {
          'spinel.sqlite': { bytes: 4096, sha256: 'b'.repeat(64) },
          'spinel.sqlite-wal': null,
          'spinel.sqlite-shm': null,
        },
      },
      freezeSlot: randomUUID(),
      frozen: {
        directory: '.restore-frozen-ABC123',
        bytes: 4096,
        sha256: 'c'.repeat(64),
        fingerprint: stop.fingerprint,
      },
      preparation: {
        slot: randomUUID(),
        preparedAt: historicalTime + 2,
        candidate: {
          directory: '.restore-reconciled-ABC123',
          bytes: 4096,
          sha256: 'd'.repeat(64),
          fingerprint: 'e'.repeat(64),
        },
        rollback: {
          directory: '.restore-rollback-ABC123',
          bytes: 4096,
          sha256: 'f'.repeat(64),
          fingerprint: '1'.repeat(64),
        },
      },
      attempt: attemptIds(),
    },
  };
  expect(validRestoreJobRecord(original, intent.id)).toBe(true);
  Object.assign(journal.state, {
    phase: 'recovery-required',
    epoch: randomUUID(),
    databaseIdentity: intent.target.identity,
    restoreJob: { jobId: intent.id, intentHash: original.intentHash },
    restoreStop: stop,
    operation: {
      id: intent.id,
      generationId: intent.target.generationId,
      ...restoreJobOperation(original),
    },
    updatedAt: time(),
  });
  journal.write();
  const statePath = join(root, 'restore-jobs', intent.id, 'state.json');
  mkdirSync(join(root, 'restore-jobs', intent.id), { recursive: true, mode: 0o700 });
  writeFileSync(statePath, JSON.stringify(original), { mode: 0o600 });
  await journal.close();
  journal = await RecoveryJournal.open(root, databasePath);
  cleanups.push(() => journal.close());
  await journal.bindWorkspace();
  expect(journal.wasUnverified).toBe(false);
  const jobs = new RestoreJobs(journal, time);
  cleanups.push(() => jobs.close());
  const grant = (): ColdRecoveryGrant => ({
    slot: randomUUID(),
    grantedAt: time(),
    deadline: time() + 60_000,
    bootEpoch: journal.state.epoch,
    priorGenerationId: journal.state.generationId,
    attempt: attemptIds(),
  });
  const begin = (record = jobs.read(intent.id)!, value = grant()) =>
    jobs.beginOriginalRecovery(intent.id, original.intentHash, record.revision, value);
  const adopt = (record: RestoreJobRecord) => {
    Object.assign(journal.state, {
      phase: 'stopped',
      operation: {
        id: intent.id,
        generationId: journal.state.generationId,
        ...restoreJobOperation(record),
      },
      updatedAt: time(),
    });
    journal.write();
  };
  const custody = (record: RestoreJobRecord): ColdRestoreCustody => ({
    version: 1,
    kind: 'cold-original',
    jobId: intent.id,
    captureId: currentRestoreRecovery(record)!.slot,
    identity: intent.target.identity,
    files: original.execution!.originals!.original,
  });
  const checkpoint = (record: RestoreJobRecord, phase: ColdRecoveryPhase, patch = {}) =>
    jobs.checkpointOriginalRecovery(intent.id, original.intentHash, record.revision, phase, patch);
  const activate = () => {
    let record = begin();
    adopt(record);
    record = checkpoint(record, 'original-custody-planned', { custody: custody(record) });
    record = checkpoint(record, 'original-custody-retained');
    record = checkpoint(record, 'original-evidence-ready');
    record = checkpoint(record, 'original-preparation-planned');
    record = checkpoint(record, 'original-prepared', {
      image: {
        directory: '.restore-rollback-NEW123',
        bytes: 4096,
        sha256: '2'.repeat(64),
        fingerprint: '3'.repeat(64),
      },
    });
    record = checkpoint(record, 'original-rehearsed', { rehearsedAt: time() });
    for (const phase of [
      'original-activation-planned',
      'original-staged',
      'original-replacing',
      'original-activated',
    ] as const)
      record = checkpoint(record, phase);
    return record;
  };
  return {
    root,
    journal,
    original,
    jobs,
    statePath,
    time,
    grant,
    begin,
    adopt,
    custody,
    checkpoint,
    activate,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('crash cleanup preserves the original failure and every secondary failure', async () => {
  const primary = new Error('The original assertion failed.');
  const first = new Error('First cleanup failed.');
  const last = new Error('Last cleanup failed.');
  const reached = vi.fn();
  await expect(
    finishRestoreCrashCleanup(
      [
        async () => {
          throw first;
        },
        async () => {
          reached();
        },
        async () => {
          throw last;
        },
      ],
      { error: primary },
    ),
  ).rejects.toMatchObject({ errors: [primary, first, last], cause: primary });
  expect(reached).toHaveBeenCalledTimes(1);
  await expect(
    finishRestoreCrashCleanup([
      async () => {
        throw first;
      },
    ]),
  ).rejects.toMatchObject({ errors: [first], cause: first });
  await expect(
    (async () => {
      try {
        throw primary;
      } finally {
        await finishRestoreCrashCleanup([async () => {}], { error: primary });
      }
    })(),
  ).rejects.toBe(primary);
});

linux(
  'failed crash cleanup stops an unadopted planned child and preserves an unrelated group',
  async () => {
    const f = await fixture();
    let record = f.activate();
    const spawnBlocked = async () => {
      const token = randomUUID();
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          'process.send({ready:true}, () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0));',
        ],
        {
          env: { ...process.env, SPINEL_PROCESS_GROUP_TOKEN: token },
          detached: true,
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        },
      );
      cleanups.push(async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      });
      await once(child, 'message');
      return { child, identity: processIdentity(child.pid!, token)! };
    };
    const planned = await spawnBlocked();
    const unrelated = await spawnBlocked();
    const recovery = currentRestoreRecovery(record)!;
    const image = recovery.image!;
    const permit: RestoreTrialPermit = {
      version: 1,
      jobId: record.intent.id,
      intentHash: record.intentHash,
      ...recovery.attempt,
      role: 'original',
      child: planned.identity,
      databasePath: record.intent.target.databasePath,
      identity: record.intent.target.identity,
      output: { bytes: image.bytes, sha256: image.sha256, fingerprint: image.fingerprint },
      policy: record.intent.policy,
      maximumBytes: 1024 * 1024,
      deadline: recovery.deadline,
    };
    writeFileSync(
      restoreBarrierPath(f.journal.databasePath),
      JSON.stringify({
        version: 1,
        operationId: record.intent.id,
        identity: record.intent.target.identity,
      }),
      { mode: 0o600 },
    );
    record = f.jobs.planOriginalTrial(record.intent.id, record.intentHash, record.revision, permit);
    const retained = readFileSync(f.statePath);
    const live = readFileSync(f.journal.databasePath);
    f.jobs.close();
    await f.journal.close();
    const supervisor = await MaintenanceSupervisor.open({
      root: f.root,
      databasePath: record.intent.target.databasePath,
      publicPort: 0,
      budgets: { stopMs: 100 },
    });
    cleanups.push(() => supervisor.close());
    expect(supervisor.journal.state.child).toBeNull();
    expect(processResourcesReleased(String(planned.child.pid))).toBe(false);
    const primary = new Error('Injected assertion before recover-original.');
    await expect(
      (async () => {
        try {
          throw primary;
        } finally {
          await finishRestoreCrashCleanup(
            [() => cleanupPlannedRestoreTrial(supervisor, record.intent.id)],
            { error: primary },
          );
        }
      })(),
    ).rejects.toBe(primary);
    expect(processResourcesReleased(String(planned.child.pid))).toBe(true);
    expect(processIdentity(unrelated.child.pid!)).toMatchObject({
      pid: unrelated.identity.pid,
      boot: unrelated.identity.boot,
      start: unrelated.identity.start,
    });
    expect(processResourcesReleased(String(unrelated.child.pid))).toBe(false);
    expect(readFileSync(f.statePath)).toEqual(retained);
    expect(readFileSync(record.intent.target.databasePath)).toEqual(live);
  },
  10_000,
);

linux.each(['operation', 'postcheck', 'both'] as const)(
  'cold recovery retains the first cause when %s fails',
  async (failure) => {
    const f = await fixture();
    const record = f.begin();
    f.adopt(record);
    const primary = new Error('The custody read failed.');
    const postcheck = new Error('The grant was cancelled during the read.');
    const abort = new AbortController();
    const capture = vi
      .spyOn(restoreFiles, 'captureColdRestoreCustody')
      .mockImplementation(async () => {
        if (failure !== 'operation') abort.abort(postcheck);
        if (failure !== 'postcheck') throw primary;
        return f.custody(record);
      });
    const pending = prepareColdRestoreOriginal({
      jobs: f.jobs,
      record,
      root: f.root,
      databasePath: record.intent.target.databasePath,
      now: f.time,
      signal: abort.signal,
      assertClosed() {},
    });
    if (failure === 'both') {
      await expect(pending).rejects.toMatchObject({
        errors: [primary, postcheck],
        cause: primary,
      });
    } else await expect(pending).rejects.toBe(failure === 'operation' ? primary : postcheck);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(f.jobs.read(record.intent.id)).toEqual(record);
  },
);

linux(
  'a fresh cold grant can recover an expired intent without renewing any original authority',
  async () => {
    const f = await fixture();
    expect(f.original.intent.authority.expiresAt).toBeLessThan(Date.now());
    const record = f.begin();
    expect(record.intent).toEqual(f.original.intent);
    expect(record.intentHash).toBe(f.original.intentHash);
    expect(record.execution).toEqual(f.original.execution);
    expect(record.phase).toBe('candidate-replacing');
    expect(restoreJobPhase(record)).toBe('original-capture-planned');
    expect(restoreJobDeadline(record)).toBeGreaterThan(Date.now());
    expect(restoreJobOperation(record).actorId).toBe('cold-host');
    expect(selectedRestoreTrial(record)).toBeUndefined();
    expect(() =>
      f.jobs.markCandidateActivated(record.intent.id, record.intentHash, record.revision),
    ).toThrow();
    expect(() =>
      f.checkpoint(record, 'original-custody-planned', { custody: f.custody(record) }),
    ).toThrow();
    f.adopt(record);
    const retained = f.checkpoint(record, 'original-custody-planned', {
      custody: f.custody(record),
    });
    expect(f.jobs.read(record.intent.id)).toEqual(retained);
    expect(retained.recovery?.sourceUpdatedAt).toBe(f.original.updatedAt);
    expect(() => f.checkpoint(retained, 'original-prepared')).toThrow();
    expect(() =>
      f.checkpoint(retained, 'original-custody-retained', { custody: f.custody(retained) }),
    ).toThrow();
  },
);

linux(
  'expired grants cannot continue and a deliberate retry preserves all earlier evidence',
  async () => {
    const f = await fixture();
    const first = f.begin();
    f.adopt(first);
    const recorded = f.checkpoint(first, 'original-custody-planned', { custody: f.custody(first) });
    f.advance(60_001);
    expect(() => f.checkpoint(recorded, 'original-custody-retained')).toThrow();
    const next = f.begin(recorded);
    expect(next.recovery?.attempts[0]).toEqual(recorded.recovery?.attempts[0]);
    expect(next.intent).toEqual(f.original.intent);
    expect(next.recovery?.attempts).toHaveLength(2);
    expect(currentRestoreRecovery(next)?.slot).not.toBe(currentRestoreRecovery(recorded)?.slot);
    expect(f.jobs.read(next.intent.id)).toEqual(next);
  },
);

linux(
  'an interrupted admission can be retried without pretending its main grant was published',
  async () => {
    const f = await fixture();
    let record = f.original;
    for (let index = 0; index < 8; index++) record = f.begin(record);
    expect(record.recovery?.attempts).toHaveLength(8);
    const bytes = readFileSync(f.statePath);
    expect(() => f.begin(record)).toThrow();
    expect(readFileSync(f.statePath)).toEqual(bytes);
    expect(f.jobs.read(record.intent.id)).toEqual(record);
  },
);

linux.each([
  'stale-revision',
  'wrong-hash',
  'wrong-boot',
  'wrong-generation',
  'expired-grant',
  'overlong-grant',
  'reused-attempt',
  'wrong-operation',
  'wrong-actor',
  'live-child',
  'changed-inode',
  'missing-witness',
] as const)('cold admission refuses %s without changing the durable record', async (mutation) => {
  const f = await fixture(),
    grant = f.grant();
  let revision = f.original.revision,
    hash = f.original.intentHash;
  if (mutation === 'stale-revision') revision--;
  if (mutation === 'wrong-hash') hash = '0'.repeat(64);
  if (mutation === 'wrong-boot') grant.bootEpoch = randomUUID();
  if (mutation === 'wrong-generation') grant.priorGenerationId = randomUUID();
  if (mutation === 'expired-grant') grant.deadline = grant.grantedAt;
  if (mutation === 'overlong-grant') grant.deadline = grant.grantedAt + 600_001;
  if (mutation === 'reused-attempt') grant.attempt = f.original.execution!.attempt!;
  if (mutation === 'wrong-operation') f.journal.state.operation!.id = randomUUID();
  if (mutation === 'wrong-actor') f.journal.state.operation!.actorId = randomUUID();
  if (mutation === 'live-child') f.journal.state.child = f.original.execution!.child;
  if (mutation === 'changed-inode') f.journal.state.databaseIdentity = { device: '1', inode: '2' };
  if (mutation === 'missing-witness') f.journal.state.restoreStop = null;
  const before = readFileSync(f.statePath);
  expect(() => f.jobs.beginOriginalRecovery(f.original.intent.id, hash, revision, grant)).toThrow();
  expect(readFileSync(f.statePath)).toEqual(before);
});

linux(
  'the cold original trial requires fresh exact bindings and publishes one durable winner',
  async () => {
    const f = await fixture();
    let record = f.activate();
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
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    });
    await once(child, 'message');
    const recovery = currentRestoreRecovery(record)!;
    const image = recovery.image!;
    const permit: RestoreTrialPermit = {
      version: 1,
      jobId: record.intent.id,
      intentHash: record.intentHash,
      ...recovery.attempt,
      role: 'original',
      child: processIdentity(child.pid!, token)!,
      databasePath: record.intent.target.databasePath,
      identity: record.intent.target.identity,
      output: { bytes: image.bytes, sha256: image.sha256, fingerprint: image.fingerprint },
      policy: record.intent.policy,
      maximumBytes: 1024 * 1024,
      deadline: recovery.deadline,
    };
    writeFileSync(
      restoreBarrierPath(f.journal.databasePath),
      JSON.stringify({
        version: 1,
        operationId: record.intent.id,
        identity: record.intent.target.identity,
      }) + '\n',
      { mode: 0o600 },
    );
    for (const invalid of [
      { ...permit, role: 'candidate' as const },
      { ...permit, epoch: randomUUID() },
      { ...permit, deadline: permit.deadline + 1 },
      { ...permit, output: { ...permit.output, fingerprint: '0'.repeat(64) } },
    ])
      expect(() =>
        f.jobs.planOriginalTrial(record.intent.id, record.intentHash, record.revision, invalid),
      ).toThrow();
    record = f.jobs.planOriginalTrial(record.intent.id, record.intentHash, record.revision, permit);
    expect(() =>
      f.jobs.markOriginalTrialOpening(record.intent.id, record.intentHash, record.revision),
    ).toThrow();
    Object.assign(f.journal.state, {
      phase: 'starting',
      generationId: permit.generationId,
      epoch: permit.epoch,
      child: permit.child,
    });
    f.journal.state.operation!.generationId = permit.generationId;
    f.journal.write();
    record = f.jobs.markOriginalTrialOpening(record.intent.id, record.intentHash, record.revision);
    const reference = restoreTrialReference(permit);
    expect(() =>
      f.jobs.markOriginalTrialReady(
        record.intent.id,
        record.intentHash,
        record.revision,
        { ...reference, role: 'candidate' },
        image.fingerprint,
      ),
    ).toThrow();
    record = f.jobs.markOriginalTrialReady(
      record.intent.id,
      record.intentHash,
      record.revision,
      reference,
      image.fingerprint,
    );
    f.journal.state.phase = 'paused';
    f.journal.write();
    record = f.jobs.markOriginalCommitted(
      record.intent.id,
      record.intentHash,
      record.revision,
      reference,
    );
    expect(record.phase).toBe('candidate-replacing');
    expect(restoreJobPhase(record)).toBe('original-committed');
    expect(isCommittedRestoreJob(record)).toBe(true);
    expect(selectedRestoreTrial(record)).toEqual(permit);
    expect(record.intent).toEqual(f.original.intent);
    expect(record.execution).toEqual(f.original.execution);
    expect(() => f.begin(record)).toThrow();
    f.advance(600_001);
    expect(isCommittedRestoreJob(f.jobs.read(record.intent.id))).toBe(true);
    expect(() =>
      f.jobs.markOriginalCommitted(record.intent.id, record.intentHash, record.revision, reference),
    ).toThrow();
  },
);

linux(
  'cold state preserves historical authorization validation and rejects malformed or rewritten grants',
  async () => {
    const f = await fixture();
    const record = f.activate();
    for (const alter of [
      (value: RestoreJobRecord) => {
        value.intent.authority.expiresAt = Date.now() + 60_000;
      },
      (value: RestoreJobRecord) => {
        value.recovery!.sourceUpdatedAt = value.updatedAt;
      },
      (value: RestoreJobRecord) => {
        value.recovery!.sourceRevision++;
      },
      (value: RestoreJobRecord) => {
        value.recovery!.attempts[0].deadline = value.recovery!.attempts[0].updatedAt;
      },
      (value: RestoreJobRecord) => {
        value.recovery!.attempts[0].phase = 'original-committed';
      },
      (value: RestoreJobRecord) => {
        value.recovery!.attempts[0].custody!.captureId = randomUUID();
      },
      (value: RestoreJobRecord) => {
        value.recovery!.attempts[0].image!.directory = '../escaped';
      },
    ]) {
      const corrupted = structuredClone(record);
      alter(corrupted);
      expect(validRestoreJobRecord(corrupted, record.intent.id)).toBe(false);
    }
    expect(f.jobs.read(record.intent.id)).toEqual(record);
  },
);

/** Pure records: no journal, process or platform, so these run on every host. */
function pureRecords() {
  const time = Date.now() - 120_000;
  const intent = restoreJobIntentFixture(time);
  intent.target = {
    instanceId: randomUUID(),
    generationId: randomUUID(),
    epoch: randomUUID(),
    databasePath: '/srv/spinel/data/workspace.sqlite',
    identity: { device: '1', inode: '2' },
  };
  const image = (kind: string, char: string) => ({
    directory: `.restore-${kind}-ABC123`,
    bytes: 4096,
    sha256: char.repeat(64),
    fingerprint: char.repeat(64),
  });
  const source: RestoreJobRecord = {
    version: 1,
    revision: 20,
    intent,
    intentHash: restoreIntentHash(intent),
    phase: 'candidate-replacing',
    updatedAt: time + 4,
    execution: {
      epoch: randomUUID(),
      child: { pid: 1234, start: '100', boot: randomUUID(), token: randomUUID() },
      requestedAt: time,
      stop: {} as never,
      originals: {
        id: intent.id,
        identity: intent.target.identity,
        original: {
          'spinel.sqlite': { bytes: 4096, sha256: 'b'.repeat(64) },
          'spinel.sqlite-wal': null,
          'spinel.sqlite-shm': null,
        },
      },
      freezeSlot: randomUUID(),
      frozen: image('frozen', 'c'),
      preparation: {
        slot: randomUUID(),
        preparedAt: time + 2,
        candidate: image('reconciled', 'd'),
        rollback: image('rollback', 'f'),
      },
      attempt: attemptIds(),
    },
  };
  const attempt = (grantedAt: number) => ({
    slot: randomUUID(),
    grantedAt,
    deadline: grantedAt + 60_000,
    bootEpoch: randomUUID(),
    priorGenerationId: intent.target.generationId,
    phase: 'original-capture-planned' as ColdRecoveryPhase,
    attempt: attemptIds(),
    updatedAt: grantedAt + 1,
  });
  const recovered = (count: number): RestoreJobRecord => {
    const attempts = [];
    let at = source.updatedAt + 10;
    for (let index = 0; index < count; index++, at += 10) attempts.push(attempt(at));
    return {
      ...structuredClone(source),
      revision: source.revision + count,
      updatedAt: attempts.at(-1)!.updatedAt,
      recovery: {
        sourceRevision: source.revision,
        sourceUpdatedAt: source.updatedAt,
        attempts,
      },
    };
  };
  return { source, recovered };
}

test('cold recovery history validation accepts exact histories and rejects each tamper', () => {
  const { recovered } = pureRecords();
  for (const count of [1, 2, 8]) expect(validRestoreColdRecovery(recovered(count))).toBe(true);
  expect(validRestoreColdRecovery(recovered(9))).toBe(false);
  const rejects = (change: (record: RestoreJobRecord) => void, count = 1) => {
    const record = recovered(count);
    change(record);
    return validRestoreColdRecovery(record);
  };
  const last = (record: RestoreJobRecord) => record.recovery!.attempts.at(-1)!;
  expect(rejects((record) => ((last(record) as { phase: string }).phase = 'unknown'))).toBe(false);
  // A committed winner has no generation to replace and cannot be followed by a grant.
  expect(rejects((record) => (last(record).phase = 'original-committed'))).toBe(false);
  expect(rejects((record) => (record.recovery!.attempts[0]!.phase = 'original-committed'), 2)).toBe(
    false,
  );
  expect(rejects((record) => (last(record).priorGenerationId = randomUUID()))).toBe(false);
  expect(rejects((record) => (last(record).deadline = last(record).grantedAt + 600_001))).toBe(
    false,
  );
  expect(rejects((record) => (last(record).grantedAt = record.recovery!.sourceUpdatedAt - 1))).toBe(
    false,
  );
  expect(rejects((record) => (record.recovery!.sourceRevision = record.revision))).toBe(false);
  expect(rejects((record) => (record.revision += 1))).toBe(false);
  expect(rejects((record) => (record.updatedAt += 1))).toBe(false);
  expect(
    rejects((record) => {
      (last(record) as unknown as Record<string, unknown>).extra = true;
    }),
  ).toBe(false);
  // A reused slot or nonce from the source record is refused.
  expect(rejects((record) => (last(record).slot = record.intent.id))).toBe(false);
  expect(rejects((record) => (last(record).attempt.nonce = record.execution!.attempt!.nonce))).toBe(
    false,
  );
  // No source plan to recover from: nothing is eligible.
  expect(rejects((record) => delete record.execution!.originals)).toBe(false);
});

test('prior generations never include a committed winner or an unknown stage', () => {
  const { source, recovered } = pureRecords();
  const target = source.intent.target.generationId;
  const planned = source.execution!.attempt!.generationId;
  expect(coldRecoveryPriorGenerations(source)).toEqual([target]);
  for (const phase of ['candidate-committed', 'original-committed', 'failed'])
    expect(coldRecoveryPriorGenerations({ ...source, phase } as never)).toEqual([]);
  expect(coldRecoveryPriorGenerations({ ...source, phase: 'trial-planned' })).toEqual([
    target,
    planned,
  ]);
  const record = recovered(1);
  const previous = record.recovery!.attempts[0]!;
  const prior = (phase: string) =>
    coldRecoveryPriorGenerations(record, [{ ...previous, phase } as never]);
  expect(prior('original-capture-planned')).toEqual([previous.priorGenerationId]);
  expect(prior('original-trial-planned')).toEqual([
    previous.priorGenerationId,
    previous.attempt.generationId,
  ]);
  // Before the trial is planned only the prior generation could have opened.
  expect(prior('original-activated')).toEqual([previous.priorGenerationId]);
  for (const phase of ['original-trial-opening', 'original-trial-ready'])
    expect(prior(phase)).toEqual([previous.attempt.generationId]);
  expect(prior('original-committed')).toEqual([]);
  expect(prior('original-unknown')).toEqual([]);
});

test('an interrupted trial is frozen only against an already sealed fingerprint', () => {
  const { recovered } = pureRecords();
  const sealed = { fingerprint: '7'.repeat(64) };
  const withAttempts = (...phases: string[]) => {
    const record = recovered(phases.length + 1);
    phases.forEach((phase, index) => {
      Object.assign(record.recovery!.attempts[index]!, { phase, image: sealed });
    });
    return record;
  };
  // A trial that opened privately froze its own image; a mixed or replacing
  // history is never opened as SQLite, and a changed trial stays unresolved.
  expect(interruptedTrialFingerprint(withAttempts('original-trial-opening'))).toBe(
    sealed.fingerprint,
  );
  expect(interruptedTrialFingerprint(withAttempts('original-trial-ready'))).toBe(
    sealed.fingerprint,
  );
  for (const phase of ['original-replacing', 'original-activated', 'original-trial-planned'])
    expect(interruptedTrialFingerprint(withAttempts(phase))).toBeUndefined();
  const missing = withAttempts('original-trial-opening');
  delete missing.recovery!.attempts[0]!.image;
  expect(() => interruptedTrialFingerprint(missing)).toThrow(/sealed image/);
  const bare = recovered(1);
  bare.recovery = undefined;
  for (const phase of ['candidate-replacing', 'original-replacing'] as const)
    expect(interruptedTrialFingerprint({ ...bare, phase })).toBeUndefined();
  const rollback = { ...structuredClone(bare), phase: 'original-trial-opening' as const };
  rollback.execution!.rollback = { image: sealed } as never;
  expect(interruptedTrialFingerprint(rollback)).toBe(sealed.fingerprint);
});
