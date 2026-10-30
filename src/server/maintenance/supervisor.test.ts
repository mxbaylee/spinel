import { RecoveryResourceError } from '../backup/resource-error.ts';
import { RESTORE_RPC_ERROR } from './restore-rpc.ts';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { openSync, closeSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { maintenanceControl } from '../../../scripts/deploy/maintenance.ts';
import {
  acquireColdWorkspace,
  acquireColdWorkspaceLease,
  acquireLiveWorkspace,
  fileIdentity,
  processIdentity,
  RecoveryJournal,
} from './journal.ts';
import type { RestoreCapacityVolume } from './restore-capacity.ts';
import { estimateRestoreCapacity } from './restore-capacity.ts';
import type { RestoreAdmission } from './supervisor.ts';
import type { RestoreObservation } from '../backup/restore-control.ts';
import { assertWorkspaceHandlesClosed, MaintenanceSupervisor } from './supervisor.ts';
import { processResourcesReleased } from './process-exit.ts';
import { restoreBarrierPath } from './restore-barrier.ts';
import { restoreSnapshotFingerprint } from '../backup/inventory.ts';
import * as restoreFiles from './restore-files.ts';
import * as restoreInput from '../backup/restore-input.ts';
import { validRestoreStopRecord, validRestoreStopRequest } from './restore-stop.ts';
import { RestoreJobs } from './restore-jobs.ts';
import type { RestoreStopRequest } from '../../shared/maintenance.ts';
import { MAINTENANCE_CHANNEL } from './supervisor-client.ts';
import type { RestoreAuthority } from './restore-authority.ts';
import { validRestoreAuthority } from './restore-authority.ts';
import { applicationPolicy } from '../../../server/application-policy.ts';
import { prepareRestoreArchive } from '../backup/verification.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { restoreIntentHash } from './restore-job-intent.ts';
import { OWNERSHIP_CHANNEL, shareWorkspaceOwnership } from './ownership.ts';

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  } finally {
    vi.restoreAllMocks();
  }
});
const actorId = randomUUID();
const proof = (now = Date.now()) => ({
  actorId,
  sessionHash: 'a'.repeat(64),
  expiresAt: now + 60_000,
});
async function seed(databasePath: string, withAuthority = false, completeRestore = false) {
  const child = fork(
    fileURLToPath(
      new URL(
        completeRestore ? './restore-controller-fixture.ts' : './seed-fixture.ts',
        import.meta.url,
      ),
    ),
    [],
    {
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        SPINEL_TEST_AUTHORITY_SEED: withAuthority ? '1' : '0',
      },
      execArgv: [],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    },
  );
  let authority: RestoreAuthority | undefined;
  child.on('message', (value: unknown) => {
    if (
      value &&
      typeof value === 'object' &&
      'restoreAuthority' in value &&
      validRestoreAuthority(value.restoreAuthority)
    )
      authority = value.restoreAuthority;
  });
  const [code] = await once(child, 'exit');
  if (code !== 0 || (withAuthority && !authority)) throw new Error('Database seed failed.');
  return authority;
}
async function fixture(withAuthority = false, completeRestore = false) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-maint-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'recovery'),
    data = join(directory, 'data');
  await mkdir(root, { mode: 0o700 });
  await mkdir(data, { mode: 0o700 });
  const databasePath = join(data, 'workspace.sqlite');
  const authority = await seed(databasePath, withAuthority, completeRestore);
  const createChild = (groupToken: string, env: NodeJS.ProcessEnv = {}) =>
    fork(
      fileURLToPath(
        new URL(
          env.SPINEL_TEST_REAL_APP === '1' ? '../../../server/index.ts' : './app-fixture.ts',
          import.meta.url,
        ),
      ),
      [],
      {
        env: {
          ...process.env,
          ...env,
          DATABASE_PATH: databasePath,
          SPINEL_SUPERVISED: '1',
          SPINEL_PROCESS_GROUP_TOKEN: groupToken,
        },
        execArgv: [],
        detached: true,
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      },
    );
  async function supervisor(
    extra: {
      now?: () => number;
      env?: Record<string, string>;
      drainMs?: number;
      restoreMs?: number;
      startMs?: number;
      stopMs?: number;
    } = {},
  ) {
    const instance = await MaintenanceSupervisor.open({
      root,
      databasePath,
      publicPort: 0,
      now: extra.now,
      createChild: (groupToken) => createChild(groupToken, extra.env),
      budgets: {
        drainMs: extra.drainMs ?? 2000,
        stopMs: extra.stopMs ?? 100,
        startMs: extra.startMs ?? 5000,
        verifyMs: 5000,
        restoreMs: extra.restoreMs ?? 5000,
      },
    });
    cleanups.push(() => instance.close());
    return instance;
  }
  return { directory, root, data, databasePath, supervisor, authority, createChild };
}
async function start(supervisor: MaintenanceSupervisor) {
  const operationId = randomUUID();
  await supervisor.coldControl({ action: 'verify', operationId });
  await supervisor.coldControl({ action: 'start', operationId });
  expect(supervisor.status().phase).toBe('paused');
  await supervisor.coldControl({ action: 'resume', operationId });
  return operationId;
}

test('a restart retains control but never verifies, starts or resumes an unresolved restore', async () => {
  const f = await fixture();
  await writeFile(restoreBarrierPath(f.databasePath), '{}', { mode: 0o600 });
  const supervisor = await f.supervisor();
  expect(supervisor.status().phase).toBe('recovery-required');
  for (const action of ['verify', 'start', 'resume'] as const)
    await expect(supervisor.coldControl({ action, operationId: randomUUID() })).rejects.toThrow(
      'unfinished workspace restore',
    );
  expect(() => supervisor.journal.acceptJournal()).toThrow('unfinished workspace restore');
  expect(supervisor.journal.state.child).toBeNull();
  expect(supervisor.journal.state.verifier).toBeNull();
  expect(await readFile(restoreBarrierPath(f.databasePath), 'utf8')).toBe('{}');
});
function message(child: ChildProcess, predicate: (value: Record<string, unknown>) => boolean) {
  return new Promise<Record<string, unknown>>((resolveMessage, reject) => {
    const timer = setTimeout(() => {
      child.off('message', receive);
      reject(new Error('Fixture message timed out.'));
    }, 10_000);
    function receive(value: unknown) {
      if (value && typeof value === 'object' && predicate(value as Record<string, unknown>)) {
        clearTimeout(timer);
        child.off('message', receive);
        resolveMessage(value as Record<string, unknown>);
      }
    }
    child.on('message', receive);
  });
}

test('external journal and kernel lease refuse unsafe paths and concurrent offline writers', async () => {
  const f = await fixture();
  const release = await acquireColdWorkspace(f.databasePath);
  await expect(f.supervisor()).rejects.toThrow('active supervisor');
  await release();
  const futureParent = join(f.directory, 'future', 'nested');
  const future = join(futureParent, 'workspace.sqlite');
  const releaseFuture = await acquireColdWorkspace(future);
  cleanups.push(releaseFuture);
  await expect(lstat(futureParent)).rejects.toMatchObject({ code: 'ENOENT' });
  await mkdir(futureParent, { recursive: true, mode: 0o700 });
  await expect(acquireColdWorkspace(future)).rejects.toThrow('active supervisor');
  await releaseFuture();
  const dangling = join(f.directory, 'dangling');
  await symlink(join(f.directory, 'missing'), dangling);
  await expect(acquireColdWorkspace(join(dangling, 'workspace.sqlite'))).rejects.toThrow(
    'symlink target is missing',
  );
  const supervisor = await f.supervisor();
  await expect(acquireColdWorkspace(f.databasePath)).rejects.toThrow('active supervisor');
  const alias = join(f.data, 'alias.sqlite'),
    hardlink = join(f.data, 'hardlink.sqlite');
  await symlink(f.databasePath, alias);
  await link(f.databasePath, hardlink);
  await expect(acquireColdWorkspace(alias)).rejects.toThrow('active supervisor');
  await expect(acquireColdWorkspace(hardlink)).rejects.toThrow('active supervisor');
  expect(supervisor.status().phase).toBe('recovery-required');
  expect(supervisor.status().readyToResume).toBe(false);
  const inside = join(f.data, 'recovery');
  await mkdir(inside, { mode: 0o700 });
  await expect(RecoveryJournal.open(inside, f.databasePath)).rejects.toThrow('outside');
  const other = join(f.directory, 'other');
  await mkdir(other, { mode: 0o755 });
  await expect(RecoveryJournal.open(other, f.databasePath)).rejects.toThrow('private');
});

test('real SQLite app and stubborn WAL worker stop before closed verification and restart', async () => {
  const f = await fixture(),
    supervisor = await f.supervisor({ env: { SPINEL_TEST_WAL_CHILD: '1' } });
  await start(supervisor);
  const epoch = supervisor.status().epoch,
    operationId = randomUUID();
  const paused = await supervisor.control({ action: 'pause', operationId, authority: proof() });
  expect(paused.status.phase).toBe('paused');
  expect(paused.status.epoch).not.toBe(epoch);
  expect(paused.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(() => assertWorkspaceHandlesClosed(f.databasePath)).toThrow('still open');
  await supervisor.coldControl({ action: 'stop', operationId });
  expect(supervisor.status().phase).toBe('stopped');
  expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
  await supervisor.coldControl({ action: 'verify', operationId });
  await supervisor.coldControl({ action: 'start', operationId });
  // A copied token does not let a different administrator resume the pause.
  await expect(
    supervisor.control({
      action: 'resume',
      operationId,
      actorId: randomUUID(),
      resumeToken: paused.resumeToken!,
    }),
  ).rejects.toThrow('expired');
  expect(supervisor.status().phase).not.toBe('running');
  await supervisor.control({
    action: 'resume',
    operationId,
    actorId,
    resumeToken: paused.resumeToken!,
  });
  expect(supervisor.status().phase).toBe('running');
  await expect(
    supervisor.control({
      action: 'resume',
      operationId,
      actorId,
      resumeToken: paused.resumeToken!,
    }),
  ).rejects.toThrow('expired');
});

test('live application ownership spans DB close and aliases while separate cold CLI access remains available', async () => {
  const f = await fixture();
  const child = fork(fileURLToPath(new URL('./lease-fixture.ts', import.meta.url)), [], {
    env: { ...process.env, DATABASE_PATH: f.databasePath, SPINEL_TEST_LEASE: 'live' },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    }
  });
  await message(child, (value) => value.ready === true);
  const alias = join(f.data, 'live-alias.sqlite'),
    hardlink = join(f.data, 'live-hardlink.sqlite');
  await symlink(f.databasePath, alias);
  await link(f.databasePath, hardlink);
  for (const path of [f.databasePath, alias, hardlink]) {
    await expect(acquireLiveWorkspace(path)).rejects.toThrow('active application');
    const release = await acquireColdWorkspace(path);
    await release();
  }
  await expect(f.supervisor()).rejects.toThrow('active application');
  // Failed supervisor acquisition must roll back its root and cold-operation locks.
  const release = await acquireColdWorkspace(f.databasePath);
  await release();
  const exit = once(child, 'exit');
  child.send({ finish: true });
  await exit;
  const journal = await RecoveryJournal.open(f.root, f.databasePath);
  await journal.bindWorkspace();
  await expect(acquireLiveWorkspace(hardlink)).rejects.toThrow('active application');
  await journal.close();
  const reused = await acquireLiveWorkspace(hardlink);
  await reused.release();
});

test('first-creation inode binding protects aliases and unref cold leases cannot hold a failed CLI open', async () => {
  const f = await fixture(),
    path = join(f.data, 'new.sqlite'),
    alias = join(f.data, 'new-alias.sqlite');
  const live = await acquireLiveWorkspace(path),
    cold = await acquireColdWorkspaceLease(path);
  cleanups.push(live.release, cold.release);
  await writeFile(path, '', { flag: 'wx', mode: 0o600 });
  await live.bindFile();
  await cold.bindFile();
  await link(path, alias);
  await expect(acquireLiveWorkspace(alias)).rejects.toThrow('active application');
  await expect(acquireColdWorkspace(alias)).rejects.toThrow('active supervisor');
  await cold.release();
  await live.release();
  const child = fork(fileURLToPath(new URL('./lease-fixture.ts', import.meta.url)), [], {
    env: { ...process.env, DATABASE_PATH: f.databasePath, SPINEL_TEST_LEASE: 'cold' },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    }
  });
  const exit = once(child, 'exit');
  await message(child, (value) => value.ready === true);
  expect((await exit)[0]).toBe(1);
  const release = await acquireColdWorkspace(f.databasePath);
  await release();
}, 5000);

test('restart rejects early cold commands until old child reconciliation has completed', async () => {
  const f = await fixture();
  const previous = fork(fileURLToPath(new URL('./supervisor-fixture.ts', import.meta.url)), [], {
    env: {
      ...process.env,
      DATABASE_PATH: f.databasePath,
      SPINEL_MAINTENANCE_ROOT: f.root,
      SPINEL_TEST_IGNORE_STOP: '1',
    },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  cleanups.push(async () => {
    if (previous.exitCode === null && previous.signalCode === null) {
      const exit = once(previous, 'exit');
      previous.kill('SIGTERM');
      await exit;
    }
  });
  await message(previous, (value) => value.ready === true);
  const operationId = randomUUID();
  for (const action of ['verify', 'start', 'resume'] as const)
    await maintenanceControl(f.root, { action, operationId });
  const exit = once(previous, 'exit');
  previous.kill('SIGKILL');
  await exit;
  let early: Promise<boolean> | undefined;
  const restarted = await MaintenanceSupervisor.open({
    root: f.root,
    databasePath: f.databasePath,
    publicPort: 0,
    budgets: { stopMs: 100 },
    onTransition(status) {
      if (status.phase === 'recovery-required' && !early)
        early = maintenanceControl(f.root, { action: 'status' }).then(
          () => false,
          () => true,
        );
    },
  });
  cleanups.push(() => restarted.close());
  expect(await early).toBe(true);
  const current = await maintenanceControl(f.root, { action: 'status' });
  expect(current.status.phase).toBe('recovery-required');
  expect(restarted.journal.state.child).toBeNull();
  expect(restarted.journal.state.verifier).toBeNull();
  expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
}, 10_000);

test('inherited cold and live ownership survives supervisor and app death until the last WAL owner exits', async () => {
  const f = await fixture();
  const alias = join(f.data, 'orphan-alias.sqlite'),
    hardlink = join(f.data, 'orphan-hardlink.sqlite');
  await symlink(f.databasePath, alias);
  await link(f.databasePath, hardlink);
  const previous = fork(fileURLToPath(new URL('./supervisor-fixture.ts', import.meta.url)), [], {
    env: {
      ...process.env,
      DATABASE_PATH: f.databasePath,
      SPINEL_MAINTENANCE_ROOT: f.root,
      SPINEL_TEST_IGNORE_STOP: '1',
      SPINEL_TEST_WAL_CHILD: '1',
    },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  cleanups.push(async () => {
    if (previous.exitCode === null && previous.signalCode === null) {
      const exited = once(previous, 'exit');
      previous.kill('SIGKILL');
      await exited;
    }
    // A new controller only reconciles the recorded, marked process group.
    const controller = await MaintenanceSupervisor.open({
      root: f.root,
      databasePath: f.databasePath,
      publicPort: 0,
      budgets: { stopMs: 100 },
    });
    await controller.close();
  });
  await message(previous, (value) => value.ready === true);
  const operationId = randomUUID();
  for (const action of ['verify', 'start', 'resume'] as const)
    await maintenanceControl(f.root, { action, operationId });
  const journal = JSON.parse(await readFile(join(f.root, 'journal.json'), 'utf8'));
  const exited = once(previous, 'exit');
  previous.kill('SIGKILL');
  await exited;
  for (const path of [f.databasePath, alias, hardlink]) {
    await expect(acquireLiveWorkspace(path)).rejects.toThrow('active application');
    await expect(acquireColdWorkspace(path)).rejects.toThrow('active supervisor');
  }
  // Kill only the app leader. Its stubborn, same-group WAL worker retains its
  // own copies of all four sockets after both its ancestors have disappeared.
  process.kill(journal.child.pid, 'SIGKILL');
  const deadline = Date.now() + 3000;
  // The leader can be a zombie before its other threads finish. Wait for
  // their actual exit, then prove the separate WAL worker still owns the data.
  while (!processResourcesReleased(String(journal.child.pid)) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  expect(processResourcesReleased(String(journal.child.pid))).toBe(true);
  for (const path of [f.databasePath, alias, hardlink]) {
    await expect(acquireLiveWorkspace(path)).rejects.toThrow('active application');
    await expect(acquireColdWorkspace(path)).rejects.toThrow('active supervisor');
  }
  expect(() => assertWorkspaceHandlesClosed(f.databasePath)).toThrow('still open');
  const recovered = await MaintenanceSupervisor.open({
    root: f.root,
    databasePath: f.databasePath,
    publicPort: 0,
    budgets: { stopMs: 100 },
  });
  cleanups.push(() => recovered.close());
  expect(recovered.journal.state.child).toBeNull();
  expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
  await recovered.close();
  const live = await acquireLiveWorkspace(hardlink),
    cold = await acquireColdWorkspace(hardlink);
  await cold();
  await live.release();
}, 10_000);

// Exercise the exact stop boundary with a real previously stopped process group
// and real descriptors. The two restart cases above cover journal reconciliation.
async function stoppedGroupFixture() {
  const f = await fixture(),
    supervisor = await f.supervisor();
  await start(supervisor);
  const operationId = randomUUID();
  await supervisor.control({ action: 'pause', operationId, authority: proof() });
  const identity = supervisor.journal.state.child!;
  await supervisor.coldControl({ action: 'stop', operationId });
  expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
  const waitForClosure = () =>
    (
      supervisor as unknown as {
        stopGroup(value: typeof identity): Promise<void>;
      }
    ).stopGroup(identity);
  return { ...f, supervisor, waitForClosure };
}

test.each(['path', 'inode'] as const)(
  'a stopped group waits for a still-open %s descriptor without signalling its owner',
  async (kind) => {
    const f = await stoppedGroupFixture();
    const path = kind === 'path' ? f.databasePath : join(f.data, 'held-alias.sqlite');
    if (kind === 'inode') await link(f.databasePath, path);
    let descriptor: number | undefined = openSync(path, 'r');
    const kill = vi.spyOn(process, 'kill');
    let settled = false;
    const pending = f.waitForClosure().finally(() => {
      settled = true;
    });
    // Attach a handler immediately so the counterfactual's early refusal does not
    // produce an unhandled rejection while this test inspects the pending state.
    void pending.catch(() => {});
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(() => assertWorkspaceHandlesClosed(f.databasePath)).toThrow('still open');
      closeSync(descriptor);
      descriptor = undefined;
      await pending;
      expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
      expect(kill).not.toHaveBeenCalled();
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      await pending.catch(() => {});
    }
  },
);

test('a persistent descriptor refuses at the original stop deadline without signalling its owner', async () => {
  const f = await stoppedGroupFixture();
  const descriptor = openSync(f.databasePath, 'r');
  const kill = vi.spyOn(process, 'kill');
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  let settled = false;
  const pending = f.waitForClosure().then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    // Advance only the clock across this fixture's unchanged 100ms grace plus
    // 3000ms closure budget. The real descriptor stays open for every scan.
    now += 3100;
    expect(await pending).toBeInstanceOf(Error);
    expect(await pending).toMatchObject({
      message: 'Workspace handle closure exceeded its stop deadline.',
    });
    expect(() => assertWorkspaceHandlesClosed(f.databasePath)).toThrow('still open');
    expect(kill).not.toHaveBeenCalled();
  } finally {
    closeSync(descriptor);
    await pending;
  }
});

test('a descriptor closing after the stop budget cannot turn a late retry into success', async () => {
  const f = await stoppedGroupFixture();
  let descriptor: number | undefined = openSync(f.databasePath, 'r');
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  let settled = false;
  const pending = f.waitForClosure().then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    closeSync(descriptor);
    descriptor = undefined;
    expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
    now += 3101;
    expect(await pending).toMatchObject({
      message: 'Workspace handle closure exceeded its stop deadline.',
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    await pending;
  }
});

test('a successful closure scan completing across the deadline cannot report success', async () => {
  const f = await stoppedGroupFixture();
  expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const pending = f.waitForClosure();
  // stopGroup's already-resolved group-inventory continuation runs first and
  // synchronously completes the descriptor scan. Expire the clock before its
  // successful scan promise returns control, without creating a failed read.
  queueMicrotask(() => {
    now += 3101;
  });
  await expect(pending).rejects.toThrow('closure exceeded its stop deadline');
});

test('reconciled startup still refuses a competing cold process through the complete stop deadline', async () => {
  const f = await fixture();
  const token = randomUUID();
  async function owner(kind: 'live' | 'cold-held') {
    const child = fork(fileURLToPath(new URL('./lease-fixture.ts', import.meta.url)), [], {
      env: {
        ...process.env,
        DATABASE_PATH: f.databasePath,
        SPINEL_TEST_LEASE: kind,
        SPINEL_PROCESS_GROUP_TOKEN: token,
      },
      execArgv: [],
      detached: true,
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    cleanups.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    });
    await message(child, (value) => value.ready === true);
    return child;
  }
  const old = await owner('live');
  const journal = await RecoveryJournal.open(f.root, f.databasePath);
  journal.state = {
    ...journal.state,
    child: processIdentity(old.pid!, token),
    databaseIdentity: fileIdentity(f.databasePath),
  };
  journal.write();
  await journal.close();
  const oldExit = once(old, 'exit');
  old.send({ finish: true });
  await oldExit;
  const competitor = await owner('cold-held');
  await expect(
    MaintenanceSupervisor.open({
      root: f.root,
      databasePath: f.databasePath,
      publicPort: 0,
      budgets: { stopMs: 1 },
    }),
  ).rejects.toThrow('active supervisor');
  await expect(lstat(join(f.root, 'control.sock'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(processIdentity(competitor.pid!)).not.toBeNull();
  const competitorExit = once(competitor, 'exit');
  competitor.send({ finish: true });
  await competitorExit;
  const restarted = await f.supervisor();
  expect(restarted.status().phase).toBe('recovery-required');
  expect(restarted.journal.state.child).toBeNull();
}, 8000);

for (const transferred of [0, 2]) {
  test(`parent death after ${transferred} ownership handles never admits a SQLite open`, async () => {
    const f = await fixture();
    const parent = fork(fileURLToPath(new URL('./ownership-fixture.ts', import.meta.url)), [], {
      env: {
        ...process.env,
        DATABASE_PATH: f.databasePath,
        SPINEL_MAINTENANCE_ROOT: f.root,
        SPINEL_TEST_OWNERSHIP_ROLE: 'parent',
        SPINEL_TEST_TRANSFER_COUNT: String(transferred),
      },
      execArgv: [],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    cleanups.push(async () => {
      if (parent.exitCode === null && parent.signalCode === null) {
        const exited = once(parent, 'exit');
        parent.kill('SIGTERM');
        await exited;
      }
    });
    const waiting = await message(parent, (value) => value.waiting === true);
    const exited = once(parent, 'exit');
    parent.kill('SIGKILL');
    await exited;
    const deadline = Date.now() + 3000;
    while (processIdentity(Number(waiting.childPid)) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(processIdentity(Number(waiting.childPid))).toBeNull();
    await expect(lstat(`${f.databasePath}.opened`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
    const live = await acquireLiveWorkspace(f.databasePath),
      cold = await acquireColdWorkspace(f.databasePath);
    await cold();
    await live.release();
  }, 10_000);
}

test.each(['before', 'during'])(
  'ordinary inherited ownership refuses a restore barrier created %s transfer',
  async (pending) => {
    const f = await fixture(),
      before = await readFile(f.databasePath);
    const parent = fork(fileURLToPath(new URL('./ownership-fixture.ts', import.meta.url)), [], {
      env: {
        ...process.env,
        DATABASE_PATH: f.databasePath,
        SPINEL_MAINTENANCE_ROOT: f.root,
        SPINEL_TEST_OWNERSHIP_ROLE: 'parent',
        SPINEL_TEST_TRANSFER_COUNT: '4',
        SPINEL_TEST_OWNERSHIP_BARRIER: pending,
      },
      execArgv: [],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    cleanups.push(async () => {
      if (parent.exitCode === null && parent.signalCode === null) {
        const exited = once(parent, 'exit');
        parent.kill('SIGTERM');
        await exited;
      }
    });
    const exited = once(parent, 'exit');
    const refused = await message(parent, (value) => value.refused === true);
    expect(refused.code).toBe(1);
    expect(refused.lateClosed).toBe(pending === 'during');
    expect((await exited)[0]).toBe(0);
    await expect(lstat(`${f.databasePath}.opened`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.databasePath)).toEqual(before);
    expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
  },
  10_000,
);

test.each(['before', 'during', 'acknowledgment'])(
  'ordinary ownership sender refuses a restore barrier at %s',
  async (point) => {
    const f = await fixture(),
      journal = await RecoveryJournal.open(f.root, f.databasePath);
    cleanups.push(() => journal.close());
    await journal.bindWorkspace();
    const channel = new EventEmitter();
    let handles = 0;
    const pending = () =>
      writeFileSync(restoreBarrierPath(f.databasePath), 'pending', { mode: 0o600, flag: 'wx' });
    const send = vi.fn(
      (
        value: { kind: string; transferId?: string },
        _handle: unknown,
        callback: (error?: Error) => void,
      ) => {
        if (value.kind === 'offer')
          queueMicrotask(() =>
            channel.emit('message', { channel: OWNERSHIP_CHANNEL, kind: 'request' }),
          );
        if (value.kind === 'handle') {
          handles++;
          if (point === 'during' && handles === 2) pending();
          if (handles === 4)
            queueMicrotask(() => {
              if (point === 'acknowledgment') pending();
              channel.emit('message', {
                channel: OWNERSHIP_CHANNEL,
                kind: 'held',
                transferId: value.transferId,
              });
            });
        }
        callback();
        return true;
      },
    );
    // Sender control-flow injection with real retained kernel listeners. The
    // separate process test above exercises the actual receiver and IPC handles.
    const child = Object.assign(channel, { connected: true, send }) as unknown as ChildProcess;
    if (point === 'before') pending();
    await expect(shareWorkspaceOwnership(child, journal.workspaceOwnership())).rejects.toThrow(
      point === 'acknowledgment' ? 'handoff was interrupted' : 'unfinished workspace restore',
    );
    expect(handles).toBe(point === 'before' ? 0 : point === 'during' ? 2 : 4);
    expect(
      Object.values(journal.workspaceOwnership().handles).every((handle) => handle.listening),
    ).toBe(true);
  },
);

test('expired authority, arbitrary commands, stale operation IDs and changed generations stay closed', async () => {
  const f = await fixture();
  let now = Date.now();
  const supervisor = await f.supervisor({ now: () => now });
  await start(supervisor);
  await expect(
    supervisor.control({
      action: 'pause',
      operationId: randomUUID(),
      authority: proof(now - 60_001),
    }),
  ).rejects.toThrow('passkey');
  for (const command of [
    { action: 'exec', operationId: randomUUID(), command: 'touch outside' },
    { action: 'stop', operationId: randomUUID(), path: '/outside' },
    { action: 'start', operationId: '../outside' },
  ])
    await expect(supervisor.coldControl(command)).rejects.toThrow();
  const operationId = randomUUID();
  const paused = await supervisor.control({ action: 'pause', operationId, authority: proof(now) });
  now += 60_001;
  await expect(
    supervisor.control({
      action: 'resume',
      operationId,
      actorId,
      resumeToken: paused.resumeToken!,
    }),
  ).rejects.toThrow('expired');
  expect(supervisor.status().phase).toBe('paused');
  await expect(
    supervisor.coldControl({ action: 'stop', operationId: randomUUID() }),
  ).rejects.toThrow('exact current');
  await supervisor.coldControl({ action: 'stop', operationId });
  await rename(f.databasePath, f.databasePath + '.preserved');
  await seed(f.databasePath);
  await expect(supervisor.coldControl({ action: 'verify', operationId })).rejects.toThrow(
    'changed',
  );
  expect(supervisor.status().phase).not.toBe('running');
});

test('a timed-out drain does not claim paused, and unrelated handles block closed recovery without being killed', async () => {
  const f = await fixture(),
    supervisor = await f.supervisor({ env: { SPINEL_TEST_NEVER_DRAIN: '1' }, drainMs: 50 });
  await start(supervisor);
  const operationId = randomUUID();
  await expect(
    supervisor.control({ action: 'pause', operationId, authority: proof() }),
  ).rejects.toThrow();
  expect(supervisor.status().phase).toBe('recovery-required');
  await supervisor.coldControl({ action: 'stop', operationId });
  const unrelated = openSync(f.databasePath, 'r');
  try {
    await expect(supervisor.coldControl({ action: 'verify', operationId })).rejects.toThrow(
      'still open',
    );
  } finally {
    closeSync(unrelated);
  }
  await supervisor.coldControl({ action: 'verify', operationId });
  expect(supervisor.status().phase).toBe('stopped');
});

test('one-off absolute notices preserve DST instants, cancellation and missed downtime without authorizing pause', async () => {
  const f = await fixture();
  let now = Date.parse('2026-11-01T07:00:00Z');
  const supervisor = await f.supervisor({ now: () => now });
  await start(supervisor);
  const noticeId = randomUUID(),
    first = Date.parse('2026-11-01T08:30:00Z'),
    second = Date.parse('2026-11-01T09:30:00Z');
  for (const instant of [first, second]) {
    await supervisor.control({
      action: 'notice',
      operationId: randomUUID(),
      authority: proof(now),
      notice: {
        id: noticeId,
        startsAt: instant,
        timeZone: 'America/Los_Angeles',
        durationMinutes: 30,
      },
    });
    expect(supervisor.status().notice?.startsAt).toBe(instant);
    expect(supervisor.status().phase).toBe('running');
  }
  await expect(
    supervisor.control({
      action: 'notice',
      operationId: randomUUID(),
      authority: proof(now),
      notice: { id: randomUUID(), startsAt: second, timeZone: 'Not/AZone', durationMinutes: 30 },
    }),
  ).rejects.toThrow('IANA');
  await supervisor.control({
    action: 'cancel-notice',
    operationId: randomUUID(),
    authority: proof(now),
    noticeId,
  });
  expect(supervisor.status().notice?.state).toBe('cancelled');
  await supervisor.control({
    action: 'notice',
    operationId: randomUUID(),
    authority: proof(now),
    notice: {
      id: noticeId,
      startsAt: second,
      timeZone: 'America/Los_Angeles',
      durationMinutes: 30,
    },
  });
  await supervisor.close();
  now = second + 3_600_000;
  const restarted = await f.supervisor({ now: () => now });
  expect(restarted.status().notice?.state).toBe('missed');
  expect(restarted.status().phase).toBe('recovery-required');
});

test('the independent public proxy stays minimal while app auth is unavailable and corrupt journals remain inert', async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'journal.json'), '{broken', { mode: 0o600 });
  const supervisor = await f.supervisor();
  const origin = `http://127.0.0.1:${supervisor.publicAddress().port}`;
  const status = await (await fetch(origin + '/api/maintenance')).json();
  expect(Object.keys(status).sort()).toEqual(['available', 'epoch', 'notice', 'phase']);
  expect(status.phase).toBe('recovery-required');
  expect(JSON.stringify(status)).not.toMatch(/operationId|actorId|sessionHash|generationId|token/);
  expect((await fetch(origin + '/api/items')).status).toBe(503);
  expect(await (await fetch(origin + '/')).text()).toContain('Workspace maintenance');
  expect(await readFile(join(f.root, 'journal.json'), 'utf8')).toBe('{broken');
  const result = await maintenanceControl(f.root, { action: 'verify', operationId: randomUUID() });
  expect(result.status.phase).toBe('stopped');
  await chmod(join(f.root, 'control.sock'), 0o666);
  await expect(maintenanceControl(f.root, { action: 'status' })).rejects.toThrow('private');
});

test('nonconsecutive duplicate commands cannot republish cancelled notices or repeat a resumed pause', async () => {
  const f = await fixture(),
    supervisor = await f.supervisor();
  await start(supervisor);
  const publish = {
    action: 'notice',
    operationId: randomUUID(),
    authority: proof(),
    notice: {
      id: randomUUID(),
      startsAt: Date.now() + 3_600_000,
      timeZone: 'America/Los_Angeles',
      durationMinutes: 15,
    },
  };
  await supervisor.control(publish);
  await supervisor.control({
    action: 'cancel-notice',
    operationId: randomUUID(),
    authority: proof(),
    noticeId: publish.notice.id,
  });
  await supervisor.control(publish);
  expect(supervisor.status().notice?.state).toBe('cancelled');
  await expect(
    supervisor.control({ ...publish, notice: { ...publish.notice, durationMinutes: 30 } }),
  ).rejects.toThrow('different');
  const pause = { action: 'pause', operationId: randomUUID(), authority: proof() };
  const paused = await supervisor.control(pause);
  await supervisor.control({
    action: 'resume',
    operationId: pause.operationId,
    actorId,
    resumeToken: paused.resumeToken!,
  });
  await supervisor.control({
    ...publish,
    operationId: randomUUID(),
    notice: { ...publish.notice, id: randomUUID() },
  });
  await supervisor.control(pause);
  expect(supervisor.status().phase).toBe('running');
  await supervisor.close();
  const restarted = await f.supervisor();
  await start(restarted);
  await restarted.control(pause);
  expect(restarted.status().phase).toBe('running');
  await expect(
    restarted.control({ ...publish, notice: { ...publish.notice, durationMinutes: 20 } }),
  ).rejects.toThrow('different');
});

test('an Operator can withdraw a notice during a pause and a cancelled notice clears after its window', async () => {
  const f = await fixture();
  let now = Date.now();
  const supervisor = await f.supervisor({ now: () => now });
  await start(supervisor);
  const notice = {
    id: randomUUID(),
    startsAt: now + 3_600_000,
    timeZone: 'America/Los_Angeles',
    durationMinutes: 15,
  };
  await supervisor.control({
    action: 'notice',
    operationId: randomUUID(),
    authority: proof(now),
    notice,
  });
  const operationId = randomUUID();
  const paused = await supervisor.control({ action: 'pause', operationId, authority: proof(now) });
  await expect(
    supervisor.control({
      action: 'notice',
      operationId: randomUUID(),
      authority: proof(now),
      notice: { ...notice, id: randomUUID() },
    }),
  ).rejects.toThrow('scheduled while the workspace is running');
  await supervisor.control({
    action: 'cancel-notice',
    operationId: randomUUID(),
    authority: proof(now),
    noticeId: notice.id,
  });
  expect(supervisor.status().notice?.state).toBe('cancelled');
  await supervisor.control({
    action: 'resume',
    operationId,
    actorId,
    resumeToken: paused.resumeToken!,
  });
  now = notice.startsAt + 15 * 60_000;
  await expect.poll(() => supervisor.status().notice, { timeout: 5000 }).toBeNull();
});

test('failed journal persistence still stops every owned process without touching a replaced root', async () => {
  const f = await fixture(),
    supervisor = await f.supervisor();
  await start(supervisor);
  await rename(f.root, f.root + '-preserved');
  await mkdir(f.root, { mode: 0o700 });
  const unrelated = join(f.root, 'operator-note');
  await writeFile(unrelated, 'keep');
  const otherSocket = createServer();
  await new Promise<void>((resolve) => otherSocket.listen(join(f.root, 'control.sock'), resolve));
  try {
    await expect(supervisor.close()).rejects.toThrow('missing or changed');
    expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
    expect(await readFile(unrelated, 'utf8')).toBe('keep');
    expect((await lstat(join(f.root, 'control.sock'))).isSocket()).toBe(true);
  } finally {
    await new Promise<void>((resolve) => otherSocket.close(() => resolve()));
  }
});

for (const phase of ['starting', 'running', 'draining', 'paused', 'stopping', 'stopped'] as const) {
  test(`SIGKILL at durable ${phase} reconciles into maintenance with original rows and closed orphan handles`, async () => {
    const f = await fixture();
    async function launch() {
      const child = fork(fileURLToPath(new URL('./supervisor-fixture.ts', import.meta.url)), [], {
        env: {
          ...process.env,
          SPINEL_MAINTENANCE_ROOT: f.root,
          DATABASE_PATH: f.databasePath,
          SPINEL_TEST_DRAIN_MS: '50',
        },
        execArgv: [],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      cleanups.push(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const exit = once(child, 'exit');
          child.kill('SIGTERM');
          await exit;
        }
      });
      await message(child, (value) => value.ready === true);
      return child;
    }
    const child = await launch();
    let operationId = randomUUID();
    const control = (action: 'verify' | 'start' | 'resume' | 'pause' | 'stop') =>
      maintenanceControl(f.root, { action, operationId });
    await control('verify');
    if (phase !== 'starting') await control('start');
    if (!['starting', 'running'].includes(phase)) {
      await control('resume');
      operationId = randomUUID();
    }
    if (['stopping', 'stopped'].includes(phase)) await control('pause');
    const armed = message(child, (value) => value.armed === phase);
    child.send({ barrier: phase });
    await armed;
    const reached = message(child, (value) => value.barrier === phase);
    const action =
      phase === 'starting'
        ? 'start'
        : phase === 'running'
          ? 'resume'
          : ['draining', 'paused'].includes(phase)
            ? 'pause'
            : 'stop';
    const pending = control(action).catch(() => undefined);
    await reached;
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
    await pending;
    const restarted = await launch();
    const after = await maintenanceControl(f.root, { action: 'status' });
    expect(after.status.phase).toBe('recovery-required');
    expect(after.status.readyToResume).toBe(false);
    expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
    const database = openDatabase(f.databasePath);
    expect(
      database.prepare("SELECT count(*) AS count FROM writes WHERE value='original'").get()?.count,
    ).toBe(1);
    database.close();
    const stopped = once(restarted, 'exit');
    restarted.kill('SIGTERM');
    await stopped;
  }, 20_000);
}

test.each([false, true])(
  'restore shutdown persists its final witness, reaps handles and tolerates duplicates=%s',
  async (duplicate) => {
    const f = await fixture();
    const supervisor = await f.supervisor({
      env: duplicate ? { SPINEL_TEST_WITNESS_DUPLICATE: '1' } : {},
    });
    await start(supervisor);
    const jobId = randomUUID();
    await supervisor.control({ action: 'pause', operationId: jobId, authority: proof() });
    const before = supervisor.status();
    const record = await supervisor.stopForRestore(jobId);
    expect(validRestoreStopRecord(record)).toBe(true);
    expect(record.request).toMatchObject({
      jobId,
      epoch: before.epoch,
      generationId: before.generationId,
    });
    expect(record.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(supervisor.status().phase).toBe('stopped');
    expect(supervisor.journal.state.child).toBeNull();
    assertWorkspaceHandlesClosed(f.databasePath);
    const persisted = JSON.parse(await readFile(join(f.root, 'journal.json'), 'utf8'));
    expect(persisted.restoreStop).toEqual(record);
    const db = openDatabase(f.databasePath);
    try {
      expect(
        db.prepare("SELECT count(*) AS n FROM writes WHERE value='final restore flush'").get()!.n,
      ).toBe(1);
      expect(restoreSnapshotFingerprint(db)).toBe(record.fingerprint);
    } finally {
      db.close();
    }
    await expect(supervisor.stopForRestore(jobId)).rejects.toThrow('authorized pause');
  },
);

test('a duplicate witness after ACK and disconnect preserves the durable acceptance without sending again', async () => {
  const f = await fixture();
  let child!: ChildProcess;
  const supervisor = await MaintenanceSupervisor.open({
    root: f.root,
    databasePath: f.databasePath,
    publicPort: 0,
    createChild: (token) => (child = f.createChild(token)),
    budgets: { startMs: 5000, stopMs: 100, verifyMs: 5000, restoreMs: 5000 },
  });
  cleanups.push(() => supervisor.close());
  await start(supervisor);
  const jobId = randomUUID();
  await supervisor.control({ action: 'pause', operationId: jobId, authority: proof() });
  const send = child.send;
  let acknowledgements = 0,
    observed = false;
  let durableBefore: unknown, durableAfter: unknown;
  vi.spyOn(child, 'send').mockImplementation((value: unknown, ...args: unknown[]) => {
    if (
      value &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === 'restore-witness-ack'
    ) {
      acknowledgements++;
      child.once('disconnect', () => {
        observed = true;
        durableBefore = structuredClone(supervisor.journal.state.restoreStop);
        child.emit('message', { ...value, kind: 'restore-witness' });
        durableAfter = structuredClone(supervisor.journal.state.restoreStop);
      });
    }
    return Reflect.apply(send, child, [value, ...args]) as boolean;
  });
  const disconnected = once(child, 'disconnect');
  const accepted = await supervisor.stopForRestore(jobId);
  // Kernel resource closure and delivery of the IPC disconnect event are
  // separate observations. Exercise the duplicate only after its actual event.
  await disconnected;
  expect(observed).toBe(true);
  expect(acknowledgements).toBe(1);
  expect(durableBefore).toEqual(accepted);
  expect(durableAfter).toEqual(accepted);
  expect(supervisor.status().phase).toBe('stopped');
  assertWorkspaceHandlesClosed(f.databasePath);
});

test.each(['callback', 'throw'])(
  'state send %s failure closes admission without recursive IPC or an unhandled error',
  async (mode) => {
    const f = await fixture();
    let child!: ChildProcess;
    const supervisor = await MaintenanceSupervisor.open({
      root: f.root,
      databasePath: f.databasePath,
      publicPort: 0,
      createChild: (token) => (child = f.createChild(token)),
      budgets: { startMs: 5000, stopMs: 100, verifyMs: 5000, drainMs: 500 },
    });
    cleanups.push(() => supervisor.close());
    await start(supervisor);
    let sends = 0;
    const send = child.send;
    const intercepted = vi
      .spyOn(child, 'send')
      .mockImplementation((value: unknown, ...args: unknown[]) => {
        if (value && typeof value === 'object' && 'kind' in value && value.kind === 'state') {
          sends++;
          const error = Object.assign(new Error('Closed IPC fixture'), { code: 'EPIPE' });
          if (mode === 'throw') throw error;
          const callback = args.at(-1);
          if (typeof callback !== 'function')
            throw new Error('State send lacks an error callback.');
          callback(error);
          return false;
        }
        return Reflect.apply(send, child, [value, ...args]) as boolean;
      });
    await expect(
      supervisor.control({ action: 'pause', operationId: randomUUID(), authority: proof() }),
    ).rejects.toThrow();
    child.emit('message', { channel: MAINTENANCE_CHANNEL, kind: 'hello' });
    expect(supervisor.status().phase).toBe('recovery-required');
    expect(supervisor.status().readyToResume).toBe(false);
    expect(sends).toBe(1);
    intercepted.mockRestore();
  },
);

test('restore shutdown refuses another operation and kills a child that never provides its witness', async () => {
  const f = await fixture();
  const supervisor = await f.supervisor({
    env: { SPINEL_TEST_NEVER_WITNESS: '1' },
    restoreMs: 200,
    stopMs: 15_000,
  });
  await start(supervisor);
  const jobId = randomUUID();
  await supervisor.control({ action: 'pause', operationId: jobId, authority: proof() });
  await expect(supervisor.stopForRestore(randomUUID())).rejects.toThrow('authorized pause');
  expect(supervisor.status().phase).toBe('paused');
  const signalled = vi.spyOn(process, 'kill');
  await expect(supervisor.stopForRestore(jobId)).rejects.toThrow('timed out');
  expect(signalled.mock.calls.some(([, signal]) => signal === 'SIGKILL')).toBe(true);
  expect(signalled.mock.calls.some(([, signal]) => signal === 'SIGTERM')).toBe(false);
  signalled.mockRestore();
  expect(supervisor.status().phase).toBe('recovery-required');
  expect(supervisor.journal.state.restoreStop?.fingerprint).toBeNull();
  assertWorkspaceHandlesClosed(f.databasePath);
});

test('conflicting final witness messages cannot complete restore shutdown', async () => {
  const f = await fixture();
  const supervisor = await f.supervisor({ env: { SPINEL_TEST_WITNESS_CONFLICT: '1' } });
  await start(supervisor);
  const jobId = randomUUID();
  await supervisor.control({ action: 'pause', operationId: jobId, authority: proof() });
  await expect(supervisor.stopForRestore(jobId)).rejects.toThrow();
  expect(supervisor.status().phase).toBe('recovery-required');
  assertWorkspaceHandlesClosed(f.databasePath);
});

test('witness persistence failure is never acknowledged as completed shutdown', async () => {
  const f = await fixture();
  const supervisor = await f.supervisor();
  await start(supervisor);
  const jobId = randomUUID();
  await supervisor.control({ action: 'pause', operationId: jobId, authority: proof() });
  const originalWrite = supervisor.journal.write.bind(supervisor.journal);
  const write = vi.spyOn(supervisor.journal, 'write').mockImplementation(() => {
    if (supervisor.journal.state.restoreStop?.fingerprint) throw new Error('Journal fsync failed.');
    originalWrite();
  });
  try {
    await expect(supervisor.stopForRestore(jobId)).rejects.toThrow();
    expect(supervisor.status().phase).toBe('recovery-required');
    expect(
      JSON.parse(await readFile(join(f.root, 'journal.json'), 'utf8')).restoreStop.fingerprint,
    ).toBeNull();
    assertWorkspaceHandlesClosed(f.databasePath);
  } finally {
    write.mockRestore();
  }
});

test('restart preserves the historical witness but cannot reopen its original generation', async () => {
  const f = await fixture();
  const supervisor = await f.supervisor();
  await start(supervisor);
  const jobId = randomUUID();
  await supervisor.control({ action: 'pause', operationId: jobId, authority: proof() });
  const record = await supervisor.stopForRestore(jobId);
  await supervisor.close();
  const restarted = await f.supervisor();
  expect(restarted.journal.state.restoreStop).toEqual(record);
  expect(restarted.status().epoch).not.toBe(record.request.epoch);
  expect(restarted.status().phase).toBe('recovery-required');
  for (const action of ['verify', 'start', 'resume', 'pause'] as const)
    await expect(restarted.coldControl({ action, operationId: jobId })).rejects.toThrow(
      'unfinished restore witness',
    );
  expect(restarted.journal.state.restoreStop).toEqual(record);
});

test('the production entrypoint completes the private restore shutdown handshake', async () => {
  const f = await fixture();
  const assets = join(f.directory, 'assets');
  await mkdir(assets);
  await writeFile(join(assets, 'index.html'), 'Fixture');
  const supervisor = await f.supervisor({
    env: { SPINEL_TEST_REAL_APP: '1', PORT: '0', SPINEL_STATIC_DIRECTORY: assets },
    startMs: 20_000,
    restoreMs: 20_000,
    stopMs: 3000,
  });
  await start(supervisor);
  const jobId = randomUUID();
  await supervisor.control({ action: 'pause', operationId: jobId, authority: proof() });
  const witness = await supervisor.stopForRestore(jobId);
  expect(validRestoreStopRecord(witness)).toBe(true);
  expect(witness.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(supervisor.status().phase).toBe('stopped');
  assertWorkspaceHandlesClosed(f.databasePath);
}, 60_000);

test('slow synchronous witness persistence cannot bypass the shutdown deadline', async () => {
  const f = await fixture();
  let elapsed = 0;
  const supervisor = await f.supervisor({ now: () => Date.now() + elapsed, restoreMs: 5000 });
  await start(supervisor);
  const jobId = randomUUID();
  await supervisor.control({ action: 'pause', operationId: jobId, authority: proof() });
  const originalWrite = supervisor.journal.write.bind(supervisor.journal);
  const write = vi.spyOn(supervisor.journal, 'write').mockImplementation(() => {
    originalWrite();
    if (supervisor.journal.state.restoreStop?.fingerprint) elapsed = 10_000;
  });
  try {
    await expect(supervisor.stopForRestore(jobId)).rejects.toThrow();
    expect(supervisor.status().phase).toBe('recovery-required');
    assertWorkspaceHandlesClosed(f.databasePath);
  } finally {
    write.mockRestore();
  }
});

test.each(['requested', 'persisted'] as const)(
  'parent death at the %s restore boundary never fabricates an acknowledged witness',
  async (stage) => {
    const f = await fixture();
    const acknowledgment = join(f.data, 'witness-ack');
    const marker = join(f.directory, 'restore-cut');
    const previous = fork(fileURLToPath(new URL('./supervisor-fixture.ts', import.meta.url)), [], {
      env: {
        ...process.env,
        DATABASE_PATH: f.databasePath,
        SPINEL_MAINTENANCE_ROOT: f.root,
        SPINEL_TEST_WITNESS_ACK_FILE: acknowledgment,
        SPINEL_TEST_RESTORE_BARRIER_FILE: marker,
      },
      execArgv: [],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    cleanups.push(async () => {
      if (previous.exitCode === null && previous.signalCode === null) {
        const exit = once(previous, 'exit');
        previous.kill('SIGKILL');
        await exit;
      }
    });
    await message(previous, (value) => value.ready === true);
    const initial = randomUUID();
    for (const action of ['verify', 'start', 'resume'] as const)
      await maintenanceControl(f.root, { action, operationId: initial });
    const jobId = randomUUID();
    await maintenanceControl(f.root, { action: 'pause', operationId: jobId });
    const armed = message(previous, (value) => value.restoreArmed === stage);
    previous.send({ restoreBarrier: stage });
    await armed;
    previous.send({ restore: jobId });
    await expect
      .poll(
        async () => {
          try {
            return await readFile(marker, 'utf8');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(stage);
    const journal = JSON.parse(await readFile(join(f.root, 'journal.json'), 'utf8'));
    expect(journal.phase).toBe('stopping');
    expect(journal.child).not.toBeNull();
    const retained = journal.restoreStop;
    expect(validRestoreStopRecord(retained)).toBe(true);
    if (stage === 'persisted') expect(retained.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    else expect(retained.fingerprint).toBeNull();
    await expect(lstat(acknowledgment)).rejects.toHaveProperty('code', 'ENOENT');
    const exited = once(previous, 'exit');
    previous.kill('SIGKILL');
    await exited;
    const restarted = await f.supervisor();
    expect(restarted.journal.state.restoreStop).toEqual(retained);
    expect(restarted.status().phase).toBe('recovery-required');
    expect(restarted.journal.state.child).toBeNull();
    assertWorkspaceHandlesClosed(f.databasePath);
    await expect(lstat(acknowledgment)).rejects.toHaveProperty('code', 'ENOENT');
    await expect(restarted.coldControl({ action: 'start', operationId: jobId })).rejects.toThrow(
      'unfinished restore witness',
    );
  },
  30_000,
);

test('a stale shutdown challenge cannot replace or poison the current witness', async () => {
  const f = await fixture();
  const supervisor = await f.supervisor({ env: { SPINEL_TEST_WITNESS_STALE: '1' } });
  await start(supervisor);
  const jobId = randomUUID();
  await supervisor.control({ action: 'pause', operationId: jobId, authority: proof() });
  const witness = await supervisor.stopForRestore(jobId);
  expect(witness.fingerprint).not.toBe('0'.repeat(64));
  expect(witness.request.jobId).toBe(jobId);
  expect(supervisor.journal.state.restoreStop).toEqual(witness);
  expect(supervisor.status().phase).toBe('stopped');
  assertWorkspaceHandlesClosed(f.databasePath);
});

test('journal refuses oversized UTF-8 records before replacing durable state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-journal-budget-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'recovery');
  await mkdir(root, { mode: 0o700 });
  const data = join(directory, 'data');
  await mkdir(data, { mode: 0o700 });
  const journal = await RecoveryJournal.open(root, join(data, 'workspace.sqlite'));
  cleanups.push(() => journal.close());
  const before = await readFile(join(root, 'journal.json'), 'utf8');
  journal.state.lastFailure = 'é'.repeat(17_000);
  expect(() => journal.write()).toThrow('storage budget');
  expect(await readFile(join(root, 'journal.json'), 'utf8')).toBe(before);
  expect(await readdir(root)).toEqual(['journal.json']);
  journal.state = JSON.parse(before);
  journal.write();
  expect(await readFile(join(root, 'journal.json'), 'utf8')).toBe(before);
});

test.each([
  'referenced',
  'orphan',
  'missing-main',
  'corrupt-main',
  'missing-record',
  'corrupt-record',
])(
  'restart cleans only complete unexecuted admissions and refuses uncertain records: %s',
  async (condition) => {
    const f = await fixture();
    const first = await f.supervisor();
    await start(first);
    const state = first.journal.state;
    const intent = {
      ...restoreJobIntentFixture(),
      target: {
        instanceId: state.instanceId,
        generationId: state.generationId,
        epoch: state.epoch,
        databasePath: first.journal.databasePath,
        identity: { ...state.databaseIdentity! },
      },
    };
    const jobs = new RestoreJobs(first.journal);
    let record;
    try {
      record = jobs.admit(intent).record;
    } finally {
      jobs.close();
    }
    if (condition !== 'orphan') {
      first.journal.state.restoreJob = { jobId: intent.id, intentHash: record.intentHash };
      first.journal.write();
    }
    await first.close();
    const journalPath = join(f.root, 'journal.json');
    const jobPath = join(f.root, 'restore-jobs', intent.id, 'state.json');
    if (condition === 'missing-main') await rm(journalPath);
    if (condition === 'corrupt-main') await writeFile(journalPath, '{');
    if (condition === 'missing-record') await rm(jobPath);
    if (condition === 'corrupt-record') await writeFile(jobPath, '{');
    const restarted = await f.supervisor();
    if (condition === 'referenced' || condition === 'orphan') {
      expect(restarted.status().phase).toBe('stopped');
      expect(restarted.journal.state.restoreJob).toBeNull();
      expect(restarted.journal.state.completedOperationId).toBe(intent.id);
      expect(restarted.journal.state.verifiedAt).toBeNull();
      expect(JSON.parse(await readFile(jobPath, 'utf8'))).toMatchObject({
        phase: 'failed',
        intent,
      });
      await restarted.coldControl({ action: 'verify', operationId: randomUUID() });
      return;
    }
    expect(restarted.status().phase).toBe('recovery-required');
    const before = await readFile(journalPath);
    for (const action of ['verify', 'start', 'resume', 'pause'] as const)
      await expect(restarted.coldControl({ action, operationId: randomUUID() })).rejects.toThrow(
        'restore job',
      );
    await expect(
      restarted.control({ action: 'pause', operationId: randomUUID(), authority: proof() }),
    ).rejects.toThrow('restore job');
    expect(() => restarted.journal.acceptJournal()).toThrow('restore job');
    expect(await readFile(journalPath)).toEqual(before);
    await restarted.coldControl({ action: 'stop', operationId: randomUUID() });
    expect(restarted.journal.state.operation).toBeNull();
    if (condition === 'corrupt-main') expect(await readFile(journalPath)).toEqual(before);
    expect(restarted.journal.state.child).toBeNull();
    expect(restarted.journal.state.verifier).toBeNull();
    expect(['stopped', 'recovery-required']).toContain(
      (await restarted.coldControl({ action: 'status' })).status.phase,
    );
  },
  15_000,
);

test('unreferenced failed pre-mutation jobs preserve idempotency without blocking ordinary recovery', async () => {
  const f = await fixture();
  const first = await f.supervisor();
  await start(first);
  const state = first.journal.state;
  const intent = {
    ...restoreJobIntentFixture(),
    target: {
      instanceId: state.instanceId,
      generationId: state.generationId,
      epoch: state.epoch,
      databasePath: first.journal.databasePath,
      identity: { ...state.databaseIdentity! },
    },
  };
  const jobs = new RestoreJobs(first.journal);
  try {
    const { record } = jobs.admit(intent);
    jobs.checkpoint(intent.id, record.intentHash, 0, 'failed');
  } finally {
    jobs.close();
  }
  const jobPath = join(f.root, 'restore-jobs', intent.id, 'state.json');
  const retained = await readFile(jobPath);
  await first.close();
  const restarted = await f.supervisor();
  await start(restarted);
  expect(await readFile(jobPath)).toEqual(retained);
}, 15_000);

test.each([false, true])(
  'pending admission permits protective stop of a failed live child with recording failure=%s',
  async (recordingFailure) => {
    const f = await fixture();
    const supervisor = await f.supervisor();
    await start(supervisor);
    const state = supervisor.journal.state;
    const intent = {
      ...restoreJobIntentFixture(),
      target: {
        instanceId: state.instanceId,
        generationId: state.generationId,
        epoch: state.epoch,
        databasePath: supervisor.journal.databasePath,
        identity: { ...state.databaseIdentity! },
      },
    };
    const jobs = new RestoreJobs(supervisor.journal);
    try {
      jobs.admit(intent);
    } finally {
      jobs.close();
    }
    expect(supervisor.journal.state.operation).toBeNull();
    // A pending admission is not permission to discard running/draining work.
    await expect(
      supervisor.coldControl({ action: 'stop', operationId: randomUUID() }),
    ).rejects.toThrow('Pause and drain');
    const child = supervisor.journal.state.child!;
    supervisor.journal.state = {
      ...supervisor.journal.state,
      phase: 'recovery-required',
      verifiedAt: null,
      lastFailure: 'storage-failed',
    };
    supervisor.journal.write();
    const jobPath = join(f.root, 'restore-jobs', intent.id, 'state.json');
    const before = await readFile(jobPath);
    const mainPath = join(f.root, 'journal.json');
    const priorMain = await readFile(mainPath);
    const fault = recordingFailure
      ? vi.spyOn(supervisor.journal, 'write').mockImplementation(() => {
          throw new Error('Injected stop recording failure');
        })
      : undefined;
    await supervisor.coldControl({ action: 'stop', operationId: randomUUID() });
    if (recordingFailure) {
      expect(await readFile(mainPath)).toEqual(priorMain);
      expect(supervisor.status().phase).toBe('recovery-required');
    }
    fault?.mockRestore();
    expect(supervisor.journal.state.child).toBeNull();
    expect(supervisor.journal.state.operation).toBeNull();
    expect(processResourcesReleased(String(child.pid))).toBe(true);
    expect(await readFile(jobPath)).toEqual(before);
    await expect(
      supervisor.coldControl({ action: 'verify', operationId: randomUUID() }),
    ).rejects.toThrow('restore job');
  },
  15_000,
);

test.each(['verify', 'start'] as const)(
  'rechecks independent restore admission after awaited ownership before %s',
  async (action) => {
    const f = await fixture();
    const supervisor = await f.supervisor();
    const operationId = randomUUID();
    await supervisor.coldControl({ action: 'verify', operationId });
    const bind = supervisor.journal.bindWorkspace.bind(supervisor.journal);
    vi.spyOn(supervisor.journal, 'bindWorkspace').mockImplementationOnce(async () => {
      await bind();
      const state = supervisor.journal.state;
      const intent = {
        ...restoreJobIntentFixture(),
        target: {
          instanceId: state.instanceId,
          generationId: state.generationId,
          epoch: state.epoch,
          databasePath: supervisor.journal.databasePath,
          identity: { ...state.databaseIdentity! },
        },
      };
      const jobs = new RestoreJobs(supervisor.journal);
      try {
        jobs.admit(intent);
      } finally {
        jobs.close();
      }
    });
    await expect(supervisor.coldControl({ action, operationId })).rejects.toThrow('restore job');
    expect(supervisor.journal.state.child).toBeNull();
    expect(supervisor.journal.state.verifier).toBeNull();
  },
  10_000,
);

test.each([undefined, 'sha256:' + 'a'.repeat(64)])(
  'real application child uses pinned deployment policy with image=%s',
  async (image) => {
    const f = await fixture();
    const staticDirectory = join(f.directory, 'trusted-assets');
    await mkdir(staticDirectory);
    await writeFile(
      join(staticDirectory, 'index.html'),
      '<!doctype html><title>Trusted fixture</title>',
    );
    const policy = applicationPolicy(3000, {
      APP_ORIGIN: 'https://trusted.example',
      SPINEL_IMAGE: image,
      SPINEL_SPACE_REVIEW: '0',
      SPINEL_STATIC_DIRECTORY: staticDirectory,
    });
    const original = { ...policy };
    const supervisor = await MaintenanceSupervisor.open({
      root: f.root,
      databasePath: f.databasePath,
      publicPort: 0,
      applicationPolicy: policy,
      createChild: (_token, environment) => {
        expect(environment.APP_ORIGIN).toBe(original.origin);
        expect(environment.SPINEL_IMAGE).toBe(image);
        expect(environment.SPINEL_SPACE_REVIEW).toBe('0');
        expect(environment.SPINEL_STATIC_DIRECTORY).toBe(staticDirectory);
        expect(environment.SPINEL_MAINTENANCE_ROOT).toBeUndefined();
        return fork(fileURLToPath(new URL('../../../server/index.ts', import.meta.url)), [], {
          env: { ...environment, PORT: '0', HOST: '127.0.0.1', BACKUP_CONFIG_PATH: undefined },
          execArgv: [],
          detached: true,
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
      },
      budgets: { startMs: 10_000, stopMs: 100, verifyMs: 5000 },
    });
    cleanups.push(() => supervisor.close());
    // Caller-owned configuration must not retarget a later child or restore trial.
    policy.origin = 'https://changed.example';
    policy.image = 'sha256:' + 'f'.repeat(64);
    policy.spaceReview = true;
    policy.staticDirectory = join(f.directory, 'missing-assets');
    const old = process.env.SPINEL_IMAGE;
    try {
      process.env.SPINEL_IMAGE = 'sha256:' + 'e'.repeat(64);
      const operationId = randomUUID();
      await supervisor.coldControl({ action: 'verify', operationId });
      await supervisor.coldControl({ action: 'start', operationId });
      expect(supervisor.status().readyToResume).toBe(true);
      expect(supervisor.status().phase).toBe('paused');
    } finally {
      if (old === undefined) delete process.env.SPINEL_IMAGE;
      else process.env.SPINEL_IMAGE = old;
    }
  },
  20_000,
);

test('real application rechecks the original proof without renewing verification or pausing', async () => {
  const f = await fixture(true);
  const assets = join(f.directory, 'assets');
  await mkdir(assets);
  await writeFile(
    join(assets, 'index.html'),
    '<html><body>Private restore authority fixture</body></html>',
  );
  const supervisor = await f.supervisor({
    startMs: 20_000,
    stopMs: 3000,
    env: {
      SPINEL_TEST_REAL_APP: '1',
      PORT: '0',
      HOST: '127.0.0.1',
      SPINEL_STATIC_DIRECTORY: assets,
      BACKUP_CONFIG_PATH: join(f.directory, 'absent-backup-config'),
    },
  });
  const jobId = randomUUID();
  await expect(supervisor.recheckRestoreAuthority(jobId, f.authority!)).rejects.toThrow(
    'current application',
  );
  await start(supervisor);
  const before = supervisor.status();
  await expect(supervisor.recheckRestoreAuthority(jobId, f.authority!)).resolves.toBeUndefined();
  for (const altered of [
    { ...f.authority!, verifiedAt: f.authority!.verifiedAt + 1 },
    { ...f.authority!, verifiedPasskeyId: 'other' },
    { ...f.authority!, actorId: randomUUID() },
    { ...f.authority!, sessionHash: 'f'.repeat(64) },
  ])
    await expect(supervisor.recheckRestoreAuthority(jobId, altered)).rejects.toThrow(
      'original restore',
    );
  expect(supervisor.status()).toEqual(before);
}, 60_000);

test('authority probes reject foreign challenges and matching replies after their deadline', async () => {
  const f = await fixture(true);
  let child!: ChildProcess;
  let elapsed = 0;
  const supervisor = await MaintenanceSupervisor.open({
    root: f.root,
    databasePath: f.databasePath,
    publicPort: 0,
    now: () => Date.now() + elapsed,
    createChild: (token) => {
      child = f.createChild(token);
      return child;
    },
    budgets: { startMs: 5000, stopMs: 100, verifyMs: 5000 },
  });
  cleanups.push(() => supervisor.close());
  await start(supervisor);
  const before = supervisor.status();
  let received!: (value: { request: RestoreStopRequest; authority: RestoreAuthority }) => void;
  const send = child.send;
  const intercepted = vi
    .spyOn(child, 'send')
    .mockImplementation((value: unknown, ...args: unknown[]) => {
      if (
        value &&
        typeof value === 'object' &&
        'kind' in value &&
        value.kind === 'restore-authority'
      ) {
        if (
          !('request' in value) ||
          !validRestoreStopRequest(value.request) ||
          !('authority' in value) ||
          !validRestoreAuthority(value.authority)
        )
          throw new Error('Invalid authority probe fixture packet.');
        received({ request: value.request, authority: value.authority });
        return true;
      }
      return Reflect.apply(send, child, [value, ...args]) as boolean;
    });
  try {
    for (const field of ['challengeId', 'epoch', 'generationId', 'jobId', 'deadline'] as const) {
      const arrived = new Promise<{ request: RestoreStopRequest; authority: RestoreAuthority }>(
        (resolve) => {
          received = resolve;
        },
      );
      const rejected = expect(
        supervisor.recheckRestoreAuthority(randomUUID(), f.authority!),
      ).rejects.toThrow('original restore');
      const { request } = await arrived;
      child.emit('message', {
        channel: MAINTENANCE_CHANNEL,
        kind: 'restore-authority-result',
        request: {
          ...request,
          [field]: field === 'deadline' ? request.deadline + 1 : randomUUID(),
        },
        accepted: true,
      });
      child.emit('message', {
        channel: MAINTENANCE_CHANNEL,
        kind: 'restore-authority-result',
        request,
        accepted: false,
      });
      await rejected;
    }
    // A lost response must release the queue/waiter without changing live state.
    {
      const arrived = new Promise<{ request: RestoreStopRequest; authority: RestoreAuthority }>(
        (resolve) => {
          received = resolve;
        },
      );
      const rejected = expect(
        supervisor.recheckRestoreAuthority(randomUUID(), f.authority!),
      ).rejects.toThrow('timed out');
      await arrived;
      await rejected;
    }
    {
      const arrived = new Promise<{ request: RestoreStopRequest; authority: RestoreAuthority }>(
        (resolve) => {
          received = resolve;
        },
      );
      const accepted = expect(
        supervisor.recheckRestoreAuthority(randomUUID(), f.authority!),
      ).resolves.toBeUndefined();
      const { request } = await arrived;
      child.emit('message', {
        channel: MAINTENANCE_CHANNEL,
        kind: 'restore-authority-result',
        request,
        accepted: true,
      });
      await accepted;
    }
    const arrived = new Promise<{ request: RestoreStopRequest; authority: RestoreAuthority }>(
      (resolve) => {
        received = resolve;
      },
    );
    const original = { ...f.authority! };
    const rejected = expect(
      supervisor.recheckRestoreAuthority(randomUUID(), original),
    ).rejects.toThrow('challenge');
    original.verifiedPasskeyId = 'changed-while-queued';
    const packet = await arrived;
    expect(packet.authority).toEqual(f.authority);
    elapsed = 6000;
    child.emit('message', {
      channel: MAINTENANCE_CHANNEL,
      kind: 'restore-authority-result',
      request: packet.request,
      accepted: true,
    });
    await rejected;
    expect(supervisor.status()).toEqual(before);
  } finally {
    intercepted.mockRestore();
  }
}, 30_000);

test('live-child authority revocation refuses the unchanged original proof', async () => {
  const f = await fixture(true);
  let child!: ChildProcess;
  const supervisor = await MaintenanceSupervisor.open({
    root: f.root,
    databasePath: f.databasePath,
    publicPort: 0,
    createChild: (token) => {
      child = f.createChild(token, { SPINEL_TEST_REVOKE_RESTORE_AUTHORITY: '1' });
      return child;
    },
    budgets: { startMs: 5000, stopMs: 100, verifyMs: 5000 },
  });
  cleanups.push(() => supervisor.close());
  await start(supervisor);
  let revoked: string | undefined;
  child.on('message', (value: unknown) => {
    if (
      value &&
      typeof value === 'object' &&
      'revokedRestoreAuthority' in value &&
      typeof value.revokedRestoreAuthority === 'string'
    )
      revoked = value.revokedRestoreAuthority;
  });
  await expect(supervisor.recheckRestoreAuthority(randomUUID(), f.authority!)).rejects.toThrow(
    'original restore',
  );
  expect(revoked).toBe(f.authority!.actorId);
  expect(supervisor.status().phase).toBe('running');
});

async function admissionFixture(
  revokeOnProbe?: number,
  now?: () => number,
  environment: Record<string, string> = {},
  restoreCapacityVolume?: RestoreCapacityVolume,
) {
  const f = await fixture(true);
  const policy = applicationPolicy(3000, {
    APP_ORIGIN: 'https://spinel.example',
    SPINEL_IMAGE: 'spinel@sha256:' + 'a'.repeat(64),
    SPINEL_STATIC_DIRECTORY: join(f.directory, 'assets'),
  });
  let child!: ChildProcess;
  const supervisor = await MaintenanceSupervisor.open({
    now,
    restoreCapacityVolume,
    root: f.root,
    databasePath: f.databasePath,
    publicPort: 0,
    applicationPolicy: policy,
    createChild: (token) => {
      child = f.createChild(token, {
        SPINEL_TEST_REVOKE_RESTORE_AUTHORITY: String(revokeOnProbe ?? 0),
        SPINEL_TEST_WITNESS_ACK_FILE: join(f.directory, 'witness-ack'),
        ...environment,
      });
      return child;
    },
    budgets: { startMs: 5000, stopMs: 100, verifyMs: 5000 },
  });
  cleanups.push(() => supervisor.close());
  await start(supervisor);
  // Custody-only fixture: opaque bytes stand in for prior verifier output. This
  // is not archive authentication, SQLite opening or activation acceptance.
  const archive = Buffer.alloc(128, 1),
    candidate = Buffer.alloc(4096, 2);
  const archivePath = join(f.directory, 'prepared.spinel'),
    databasePath = join(f.directory, 'prepared.sqlite');
  await writeFile(archivePath, archive, { mode: 0o600 });
  await writeFile(databasePath, candidate, { mode: 0o600 });
  const state = supervisor.status();
  const request: RestoreAdmission = {
    id: randomUUID(),
    generationId: state.generationId,
    epoch: state.epoch,
    authority: f.authority!,
    confirmedAt: Date.now(),
    preview: restoreJobIntentFixture().preview,
    consequenceEnvelope: 1,
    previewDatabaseBytes: 8192,
    source: {
      archive: {
        path: archivePath,
        bytes: archive.length,
        sha256: createHash('sha256').update(archive).digest('hex'),
      },
      databasePath,
      databaseBytes: candidate.length,
      databaseSha256: createHash('sha256').update(candidate).digest('hex'),
      recovery: {
        createdAt: new Date().toISOString(),
        origin: policy.origin,
        image: policy.image!,
      },
    },
  };
  return { ...f, supervisor, request, child };
}

test
  .runIf(process.platform === 'linux')
  .each([
    'ownership-first',
    'readiness-first',
    'original-recovered',
    'original-commit-publication',
    'wrong-fingerprint',
    'failed-freeze-publication',
    'release-rejected',
    'early-release',
    'pause-publication',
    'commit-publication',
    'clock-after-final-scan',
    'clock-after-running-write',
  ])(
  'complete application and authenticated archive commit and release the selected candidate: %s',
  async (ordering) => {
    const f = await fixture(true, true);
    const policy = applicationPolicy(3000, {
      APP_ORIGIN: 'https://spinel.example',
      SPINEL_IMAGE: `spinel@sha256:${'a'.repeat(64)}`,
      SPINEL_STATIC_DIRECTORY: join(f.data, 'assets'),
    });
    const seedSource = JSON.parse(await readFile(join(f.data, 'restore-source.json'), 'utf8'));
    const source = await prepareRestoreArchive({
      archive: seedSource.archive,
      keyFile: seedSource.keyFile,
      stagingRoot: f.data,
      expectedOrigin: policy.origin,
      expectedImage: policy.image!,
      expectedArchive: { bytes: seedSource.bytes, sha256: seedSource.sha256 },
      timeoutMs: 30_000,
    });
    cleanups.push(() => source.dispose());
    expect(source.tables).toBeGreaterThan(0);
    const portProbe = createServer();
    await new Promise<void>((resolve, reject) => {
      portProbe.once('error', reject);
      portProbe.listen(0, '127.0.0.1', resolve);
    });
    const applicationPort = (portProbe.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );
    const applicationUrl = `http://127.0.0.1:${applicationPort}/api/health`;
    const originalRecovery = ordering.startsWith('original-');
    const terminalPhase = originalRecovery ? 'original-committed' : 'candidate-committed';
    let privateReadyObserved = false,
      ownershipReordered = false;
    let authorityOffset = 0,
      clockAdvanced = false,
      runningPublished = false,
      runningWritten = false,
      earlyInjected = false,
      injectingEarlyRelease = false;
    let trialChild: ChildProcess | undefined, privateReference: unknown;
    let pausedProbe: Promise<number> | undefined;
    let releaseSnapshot:
      { phase: string; main: unknown; barrier: boolean; accepted: unknown } | undefined;
    const supervisor = await MaintenanceSupervisor.open({
      root: f.root,
      databasePath: f.databasePath,
      publicPort: 0,
      applicationPolicy: policy,
      now: () => Date.now() + authorityOffset,
      onTransition: (status) => {
        if (privateReadyObserved && status.phase === 'running') runningPublished = true;
      },
      createChild: (token, environment) => {
        const child = f.createChild(token, {
          ...environment,
          SPINEL_TEST_REAL_APP: '1',
          PORT: String(applicationPort),
          HOST: '127.0.0.1',
          APP_ORIGIN: policy.origin,
          SPINEL_IMAGE: policy.image!,
          SPINEL_STATIC_DIRECTORY: policy.staticDirectory,
          BACKUP_CONFIG_PATH: join(f.data, 'absent-backup-config'),
        });
        if (environment.SPINEL_RESTORE_TRIAL === '1') {
          trialChild = child;
          const emit = child.emit.bind(child);
          let held: unknown[] | undefined;
          child.emit = (event: string | symbol, ...args: unknown[]) => {
            const value = args[0] as Record<string, unknown> | undefined;
            if (
              event === 'message' &&
              value?.kind === 'held' &&
              value.trialNonce &&
              ordering === 'readiness-first'
            ) {
              held = args;
              return true;
            }
            if (event === 'message' && value?.kind === 'restore-trial-ready') {
              privateReadyObserved = true;
              privateReference = structuredClone(value.reference);
              pausedProbe = (async () => {
                const response = await fetch(applicationUrl);
                const status = response.status;
                await response.text();
                const reference = value.reference as {
                  jobId: string;
                  epoch: string;
                  generationId: string;
                  role: 'candidate' | 'original';
                };
                const readJob = () =>
                  JSON.parse(
                    readFileSync(
                      join(f.root, 'restore-jobs', reference.jobId, 'state.json'),
                      'utf8',
                    ),
                  );
                const original = reference.role === 'original';
                expect(readJob().phase).toBe(original ? 'original-trial-opening' : 'trial-opening');
                const selected = original ? readJob().execution.rollback : readJob().execution;
                expect(selected.openingGrantedAt).toBeLessThanOrEqual(Date.now());
                expect(selected.trial.child.pid).toBe(child.pid);
                // Neither ordinary readiness nor an old attempt nonce may advance
                // the trial or make ordinary resume available.
                emit('message', {
                  channel: MAINTENANCE_CHANNEL,
                  kind: 'ready',
                  epoch: reference.epoch,
                  generationId: reference.generationId,
                });
                emit('message', { ...value, reference: { ...reference, nonce: randomUUID() } });
                expect(supervisor.status().phase).toBe('starting');
                expect(supervisor.status().readyToResume).toBe(false);
                if (
                  ordering === 'wrong-fingerprint' ||
                  ordering === 'failed-freeze-publication' ||
                  (originalRecovery && !original)
                ) {
                  emit('message', { ...value, fingerprint: '0'.repeat(64) });
                  return status;
                }
                emit(event, ...args);
                if (ordering === 'readiness-first') {
                  expect(held).toBeDefined();
                  expect(readJob().phase).toBe('trial-opening');
                  expect(supervisor.status().readyToResume).toBe(false);
                  ownershipReordered = true;
                  emit('message', ...held!);
                }
                return status;
              })();
              void pausedProbe.catch(() => {});
              return true;
            }
            if (event === 'message' && value?.kind === 'restore-trial-released') {
              if (injectingEarlyRelease) return emit(event, ...args);
              const reference = value.reference as { jobId: string };
              const record = JSON.parse(
                readFileSync(join(f.root, 'restore-jobs', reference.jobId, 'state.json'), 'utf8'),
              );
              releaseSnapshot = {
                phase: record.phase,
                main: structuredClone(supervisor.journal.state),
                barrier: existsSync(restoreBarrierPath(f.databasePath)),
                accepted: value.accepted,
              };
              if (ordering === 'release-rejected')
                return emit('message', { ...value, accepted: false });
              if (ordering.startsWith('clock-after-')) {
                const advance = () => {
                  clockAdvanced = true;
                  authorityOffset = f.authority!.expiresAt - Date.now() + 1;
                };
                const write = supervisor.journal.write.bind(supervisor.journal);
                vi.spyOn(supervisor.journal, 'write').mockImplementation(() => {
                  write();
                  if (supervisor.journal.state.phase === 'running') {
                    runningWritten = true;
                    if (ordering === 'clock-after-running-write') advance();
                  }
                });
                if (ordering === 'clock-after-final-scan') {
                  const internal = supervisor as unknown as { assertGeneration(): void };
                  const check = internal.assertGeneration.bind(supervisor);
                  let scans = 0;
                  vi.spyOn(internal, 'assertGeneration').mockImplementation(() => {
                    check();
                    // ACK validation, final admission, ordinary resume check,
                    // then the final restore-specific admission scan.
                    if (++scans === 4) advance();
                  });
                }
              }
            }
            return emit(event, ...args);
          };
        }
        return child;
      },
      budgets: {
        startMs: 20_000,
        stopMs: 3000,
        drainMs: 10_000,
        verifyMs: 5000,
        restoreMs: 30_000,
      },
    });
    cleanups.push(() => supervisor.close());
    await start(supervisor);
    const state = supervisor.status();
    const id = randomUUID();
    const admitted = await supervisor.admitPreparedRestore({
      id,
      generationId: state.generationId,
      epoch: state.epoch,
      authority: f.authority!,
      confirmedAt: Date.now(),
      preview: restoreJobIntentFixture().preview,
      consequenceEnvelope: 1,
      previewDatabaseBytes: 8192,
      source: {
        archive: source.archive,
        databasePath: source.databasePath,
        databaseBytes: source.databaseBytes,
        databaseSha256: source.databaseSha256,
        recovery: source.recovery,
      },
    });
    // The request-side staging lifetime ends after the custody ACK. Subsequent
    // controller work must use its retained encrypted bundle and verified source.
    await source.dispose();
    await expect(lstat(source.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    if (ordering === 'early-release') {
      const commit = restoreFiles.commitRestoreFiles;
      vi.spyOn(restoreFiles, 'commitRestoreFiles').mockImplementationOnce(async (...args) => {
        await Promise.resolve();
        earlyInjected = true;
        injectingEarlyRelease = true;
        try {
          trialChild!.emit('message', {
            channel: MAINTENANCE_CHANNEL,
            kind: 'restore-trial-released',
            reference: privateReference,
            accepted: true,
          });
        } finally {
          injectingEarlyRelease = false;
        }
        return commit(...args);
      });
    }
    let commitPublicationFailed = false;
    let pausePublicationFailed = false;
    if (ordering === 'pause-publication') {
      const write = supervisor.journal.write.bind(supervisor.journal);
      vi.spyOn(supervisor.journal, 'write').mockImplementation(() => {
        write();
        if (
          !pausePublicationFailed &&
          supervisor.journal.state.phase === 'paused' &&
          JSON.parse(readFileSync(join(f.root, 'restore-jobs', id, 'state.json'), 'utf8')).phase ===
            'trial-ready'
        ) {
          pausePublicationFailed = true;
          throw new Error('Paused trial publication result was lost.');
        }
      });
    }
    if (ordering === 'commit-publication' || ordering === 'original-commit-publication') {
      const write = supervisor.journal.write.bind(supervisor.journal);
      vi.spyOn(supervisor.journal, 'write').mockImplementation(() => {
        write();
        if (
          !commitPublicationFailed &&
          supervisor.journal.state.restoreJob?.jobId === id &&
          supervisor.journal.state.restoreStop === null &&
          JSON.parse(readFileSync(join(f.root, 'restore-jobs', id, 'state.json'), 'utf8')).phase ===
            terminalPhase
        ) {
          commitPublicationFailed = true;
          throw new Error('Terminal main publication result was lost.');
        }
      });
    }
    let frozenPublicationFailed = false;
    if (ordering === 'failed-freeze-publication') {
      const publish = RestoreJobs.prototype.markTrialFrozen;
      vi.spyOn(RestoreJobs.prototype, 'markTrialFrozen').mockImplementation(function (
        this: RestoreJobs,
        ...args: Parameters<RestoreJobs['markTrialFrozen']>
      ) {
        publish.apply(this, args);
        frozenPublicationFailed = true;
        throw new Error('Failed frozen publication result was lost.');
      });
    }
    if (['wrong-fingerprint', 'early-release', 'pause-publication'].includes(ordering)) {
      const publish = RestoreJobs.prototype.markTrialFrozen;
      vi.spyOn(RestoreJobs.prototype, 'markTrialFrozen').mockImplementation(function (
        this: RestoreJobs,
        ...args: Parameters<RestoreJobs['markTrialFrozen']>
      ) {
        const result = publish.apply(this, args);
        authorityOffset = result.intent.authority.expiresAt + 1 - Date.now();
        return result;
      });
    }
    let controllerFailure: string | null = null;
    const controller = supervisor as unknown as {
      executeRestoreStopOwned(request: {
        id: string;
        intentHash: string;
        continuationToken: string;
      }): Promise<void>;
    };
    const execute = controller.executeRestoreStopOwned.bind(controller);
    vi.spyOn(controller, 'executeRestoreStopOwned').mockImplementation(async (request) => {
      try {
        await execute(request);
      } catch (error) {
        controllerFailure =
          error instanceof Error ? error.message.slice(0, 300) : 'Unknown fixture failure';
        throw error;
      }
    });
    const begun = await supervisor.beginPreparedRestore({
      id,
      intentHash: admitted.record.intentHash,
      continuationToken: admitted.continuationToken!,
    });
    expect(begun.record.phase).toBe('pause-planned');
    const statePath = join(f.root, 'restore-jobs', id, 'state.json');
    await expect
      .poll(() => privateReadyObserved || supervisor.status().phase === 'recovery-required', {
        timeout: 30_000,
      })
      .toBe(true);
    expect({
      ready: privateReadyObserved,
      phase: supervisor.status().phase,
      jobPhase: JSON.parse(readFileSync(statePath, 'utf8')).phase,
      controllerFailure,
    }).toMatchObject({ ready: true });
    expect(await pausedProbe).toBe(503);
    const failed = !['ownership-first', 'readiness-first', 'original-recovered'].includes(ordering);
    const uncommitted = [
      'wrong-fingerprint',
      'failed-freeze-publication',
      'early-release',
      'pause-publication',
    ].includes(ordering);
    const retainedBarrier = uncommitted || ordering.endsWith('commit-publication');
    if (failed) {
      await expect
        .poll(() => supervisor.status().phase, { timeout: 30_000 })
        .toBe('recovery-required');
      await expect.poll(() => supervisor.journal.state.child, { timeout: 10_000 }).toBeNull();
    } else {
      await expect
        .poll(async () => JSON.parse(await readFile(statePath, 'utf8')).phase, { timeout: 30_000 })
        .toBe(terminalPhase);
      await expect.poll(() => supervisor.status().phase).toBe('running');
    }
    expect(privateReadyObserved).toBe(true);
    expect(ownershipReordered).toBe(ordering === 'readiness-first');
    const completed = JSON.parse(await readFile(statePath, 'utf8'));
    const selected = originalRecovery ? completed.execution.rollback : completed.execution;
    expect(completed.execution.frozen.fingerprint).toBe(completed.execution.stop.fingerprint);
    expect(completed.execution.frozen.fingerprint).not.toBe(source.logicalFingerprint);
    expect(completed.intent.source.archive.sha256).toBe(seedSource.sha256);
    const preparation = completed.execution.preparation;
    expect(preparation.candidate.fingerprint).not.toBe(preparation.rollback.fingerprint);
    const slot = join(f.root, `restore-${id}`, `prepare-${preparation.slot}`);
    for (const [image, filename, expectedName] of [
      [preparation.candidate, ['restored', 'spinel.sqlite'], 'Archived folder'],
      [preparation.rollback, ['rollback.sqlite'], 'Current folder'],
    ] as const) {
      const imagePath = join(slot, image.directory, ...filename);
      const bytes = await readFile(imagePath);
      expect(bytes.length).toBe(image.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(image.sha256);
      const observer = fork(
        fileURLToPath(new URL('./restore-controller-observer-fixture.ts', import.meta.url)),
        [],
        {
          env: {
            ...process.env,
            DATABASE_PATH: imagePath,
            SPINEL_TEST_FOLDER_ID: seedSource.folderId,
          },
          execArgv: [],
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        },
      );
      let observation: unknown;
      observer.on('message', (value: unknown) => {
        observation = value;
      });
      const [code] = await once(observer, 'exit');
      expect(code).toBe(0);
      expect(observation).toEqual({ name: expectedName, sessions: 0 });
      // Observer completion must not alter the selected, closed output.
      expect(await readFile(imagePath)).toEqual(bytes);
    }
    expect(completed.phase).toBe(uncommitted ? 'trial-frozen' : terminalPhase);
    if (uncommitted || originalRecovery) {
      const failure = completed.execution.failure;
      expect(failure.capture.manifest.witness.fingerprint).toBe(failure.stop.fingerprint);
      expect(failure.freeze.output.fingerprint).toBe(failure.stop.fingerprint);
      expect(failure.capture.deadline).toBe(failure.freeze.deadline);
      const raw = join(f.root, `restore-${id}`, `failed-${failure.capture.slot}`, 'raw');
      for (const [name, evidence] of Object.entries(failure.capture.manifest.files)) {
        if (!evidence) continue;
        const retained = await readFile(join(raw, name));
        expect(retained.length).toBe((evidence as { bytes: number }).bytes);
        expect(createHash('sha256').update(retained).digest('hex')).toBe(
          (evidence as { sha256: string }).sha256,
        );
      }
      const frozenPath = join(
        f.root,
        `restore-${id}`,
        `failed-freeze-${failure.freeze.slot}`,
        failure.freeze.output.directory,
        'frozen.sqlite',
      );
      const frozenBytes = await readFile(frozenPath);
      expect(frozenBytes.length).toBe(failure.freeze.output.bytes);
      expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
        failure.freeze.output.sha256,
      );
      expect(completed.execution.failure.from).toBe(
        ['wrong-fingerprint', 'failed-freeze-publication'].includes(ordering) || originalRecovery
          ? 'trial-opening'
          : 'trial-ready',
      );
      expect(completed.execution.failure.stop.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(completed.execution.failure.stop.child.pid).toBe(completed.execution.trial.child.pid);
      expect(completed.execution.failure.stop.request.challengeId).not.toBe(
        completed.execution.stop.request.challengeId,
      );
      expect(completed.execution.stop.request.generationId).toBe(
        admitted.record.intent.target.generationId,
      );
      expect(completed.execution.failure.stop.request.generationId).toBe(
        completed.execution.attempt.generationId,
      );
    }
    if (originalRecovery) {
      expect(selected.attempt.generationId).not.toBe(completed.execution.attempt.generationId);
      expect(selected.attempt.epoch).not.toBe(completed.execution.attempt.epoch);
      expect(selected.trial.role).toBe('original');
      expect(selected.outcome.role).toBe('original');
      expect(selected.outcome.fingerprint).toBe(selected.image.fingerprint);
      const path = join(
        f.root,
        `restore-${id}`,
        `original-${selected.slot}`,
        selected.image.directory,
        'rollback.sqlite',
      );
      const image = await readFile(path);
      expect(image.length).toBe(selected.image.bytes);
      expect(createHash('sha256').update(image).digest('hex')).toBe(selected.image.sha256);
    }
    if (ordering === 'failed-freeze-publication') {
      expect(frozenPublicationFailed).toBe(true);
      const retainedRoot = join(f.root, `restore-${id}`),
        before = (await readdir(retainedRoot)).sort();
      expect(
        before.filter((name) => name.startsWith('failed-') && !name.startsWith('failed-freeze-')),
      ).toEqual([`failed-${completed.execution.failure.capture.slot}`]);
      expect(before.filter((name) => name.startsWith('failed-freeze-'))).toEqual([
        `failed-freeze-${completed.execution.failure.freeze.slot}`,
      ]);
      const replay = await supervisor.beginPreparedRestore({
        id,
        intentHash: admitted.record.intentHash,
        continuationToken: admitted.continuationToken!,
      });
      expect(replay.queued).toBe(false);
      expect(replay.record).toEqual(completed);
      expect((await readdir(retainedRoot)).sort()).toEqual(before);
      expect(supervisor.journal.state.child).toBeNull();
      expect(existsSync(restoreBarrierPath(f.databasePath))).toBe(true);
      assertWorkspaceHandlesClosed(f.databasePath);
    }
    expect(supervisor.status().readyToResume).toBe(false);
    expect(supervisor.journal.state.restoreStop).toEqual(
      uncommitted ? completed.execution.stop : null,
    );
    expect(fileIdentity(f.databasePath)).toEqual(admitted.record.intent.target.identity);
    expect(supervisor.status().generationId).toBe(selected.attempt.generationId);
    expect(supervisor.status().generationId).not.toBe(admitted.record.intent.target.generationId);
    if (failed && ordering !== 'clock-after-running-write')
      expect(supervisor.journal.state.operation?.generationId).toBe(
        supervisor.status().generationId,
      );
    else {
      expect(supervisor.journal.state.operation).toBeNull();
      expect(supervisor.journal.state.completedOperationId).toBe(id);
    }
    expect(existsSync(restoreBarrierPath(f.databasePath))).toBe(retainedBarrier);
    const response = await fetch(`http://127.0.0.1:${supervisor.publicAddress().port}/`);
    expect(response.status).toBe(503);
    await response.text();
    if (retainedBarrier) expect(releaseSnapshot).toBeUndefined();
    else
      expect(releaseSnapshot).toMatchObject({
        phase: terminalPhase,
        barrier: false,
        accepted: true,
        main: {
          phase: 'paused',
          restoreJob: null,
          restoreStop: null,
          generationId: selected.trial.generationId,
        },
      });
    if (failed) assertWorkspaceHandlesClosed(f.databasePath);
    else {
      expect(() => assertWorkspaceHandlesClosed(f.databasePath)).toThrow();
      await expect
        .poll(async () => {
          const response = await fetch(applicationUrl);
          await response.text();
          return response.status;
        })
        // Release restores the ordinary authentication guard. Restore clears
        // sessions, so an unauthenticated health request must still be refused.
        .toBe(401);
    }
    expect(runningPublished).toBe(!failed);
    expect(earlyInjected).toBe(ordering === 'early-release');
    expect(commitPublicationFailed).toBe(ordering.endsWith('commit-publication'));
    expect(pausePublicationFailed).toBe(ordering === 'pause-publication');
    if (ordering.startsWith('clock-after-')) {
      expect(clockAdvanced).toBe(true);
      expect(runningWritten).toBe(ordering === 'clock-after-running-write');
    }
    if (!uncommitted) {
      await supervisor.close();
      assertWorkspaceHandlesClosed(f.databasePath);
      const observer = fork(
        fileURLToPath(new URL('./restore-controller-observer-fixture.ts', import.meta.url)),
        [],
        {
          env: {
            ...process.env,
            DATABASE_PATH: f.databasePath,
            SPINEL_TEST_FOLDER_ID: seedSource.folderId,
          },
          execArgv: [],
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        },
      );
      let selectedContents: unknown;
      observer.on('message', (value: unknown) => {
        selectedContents = value;
      });
      const [code] = await once(observer, 'exit');
      expect(code).toBe(0);
      // A failed release after durable commitment cannot revive original content.
      expect(selectedContents).toEqual({
        name: originalRecovery ? 'Current folder' : 'Archived folder',
        sessions: 0,
      });

      const terminalBytes = await readFile(statePath, 'utf8');
      const commit = restoreFiles.commitRestoreFiles;
      let cleanupAttempts = 0;
      const interrupted = ordering.endsWith('commit-publication');
      if (interrupted) {
        const mainPath = join(f.root, 'journal.json');
        const originalMain = JSON.parse(await readFile(mainPath, 'utf8'));
        const originalBytes = await readFile(f.databasePath);
        for (const fault of [
          'reference-hash',
          'reference-job',
          'generation',
          'actor',
          'session',
          'token',
          'expiry',
          'competing-job',
        ]) {
          const changed = structuredClone(originalMain);
          let competitor: string | undefined;
          if (fault === 'reference-hash') changed.restoreJob.intentHash = 'f'.repeat(64);
          if (fault === 'reference-job') changed.restoreJob.jobId = randomUUID();
          if (fault === 'generation')
            changed.generationId = changed.operation.generationId = randomUUID();
          if (fault === 'actor') changed.operation.actorId = randomUUID();
          if (fault === 'session') changed.operation.sessionHash = 'f'.repeat(64);
          if (fault === 'token') changed.operation.tokenHash = 'f'.repeat(64);
          if (fault === 'expiry') changed.operation.expiresAt++;
          if (fault === 'competing-job') {
            competitor = randomUUID();
            const intent = structuredClone(completed.intent);
            intent.id = intent.source.id = competitor;
            const directory = join(f.root, 'restore-jobs', competitor);
            await mkdir(directory, { mode: 0o700 });
            await writeFile(
              join(directory, 'state.json'),
              JSON.stringify({
                version: 1,
                revision: 1,
                intent,
                intentHash: restoreIntentHash(intent),
                phase: 'accepted',
                updatedAt: intent.confirmedAt,
              }),
              { mode: 0o600 },
            );
          }
          await writeFile(mainPath, JSON.stringify(changed), { mode: 0o600 });
          const refused = await MaintenanceSupervisor.open({
            root: f.root,
            databasePath: f.databasePath,
            publicPort: 0,
            applicationPolicy: policy,
            budgets: { stopMs: 100 },
          });
          cleanups.push(() => refused.close());
          expect(refused.journal.wasUnverified, fault).toBe(false);
          expect(refused.status().phase, fault).toBe('recovery-required');
          expect(refused.journal.state.restoreJob, fault).toEqual(changed.restoreJob);
          expect(refused.journal.state.verifiedAt, fault).toBeNull();
          expect(existsSync(restoreBarrierPath(f.databasePath)), fault).toBe(true);
          expect(await readFile(statePath, 'utf8'), fault).toBe(terminalBytes);
          expect(await readFile(f.databasePath), fault).toEqual(originalBytes);
          if (competitor) {
            const records = new RestoreJobs(refused.journal);
            try {
              expect(records.read(competitor)?.phase).toBe('accepted');
            } finally {
              records.close();
            }
          }
          await expect(
            refused.coldControl({ action: 'verify', operationId: changed.operation.id }),
          ).rejects.toThrow('unfinished restore job');
          await refused.close();
          if (competitor) await rm(join(f.root, 'restore-jobs', competitor), { recursive: true });
        }
        await writeFile(mainPath, JSON.stringify(originalMain), { mode: 0o600 });
      }
      const cleanup = interrupted
        ? vi.spyOn(restoreFiles, 'commitRestoreFiles').mockImplementation(async (...args) => {
            cleanupAttempts++;
            if (cleanupAttempts === 1) throw new Error('Interrupted after main adoption.');
            await commit(...args);
            if (cleanupAttempts === 2) throw new Error('Interrupted after barrier cleanup.');
          })
        : undefined;
      for (let attempt = 0; attempt < (interrupted ? 3 : 1); attempt++) {
        const recovered = await MaintenanceSupervisor.open({
          root: f.root,
          databasePath: f.databasePath,
          publicPort: 0,
          applicationPolicy: policy,
          // Historical commitment remains recoverable after the original proof
          // expires. It grants no fresh restore attempt or private trial release.
          now: () => Math.max(Date.now(), completed.intent.authority.expiresAt + 1000),
          budgets: { stopMs: 100, verifyMs: 5000 },
        });
        cleanups.push(() => recovered.close());
        expect(recovered.status().phase).toBe('recovery-required');
        expect(recovered.status().generationId).toBe(selected.trial.generationId);
        expect(recovered.status().epoch).not.toBe(selected.trial.epoch);
        expect(recovered.journal.state.child).toBeNull();
        expect(recovered.journal.state.verifiedAt).toBeNull();
        expect(await readFile(statePath, 'utf8')).toBe(terminalBytes);
        if (interrupted && attempt < 2) {
          expect(recovered.journal.state.restoreJob).toEqual({
            jobId: id,
            intentHash: admitted.record.intentHash,
          });
          expect(existsSync(restoreBarrierPath(f.databasePath))).toBe(attempt === 0);
          await expect(
            recovered.coldControl({
              action: 'verify',
              operationId: recovered.status().operationId ?? randomUUID(),
            }),
          ).rejects.toThrow('unfinished restore job');
        } else {
          expect(recovered.journal.state.restoreJob).toBeNull();
          expect(recovered.journal.state.restoreStop).toBeNull();
          expect(existsSync(restoreBarrierPath(f.databasePath))).toBe(false);
          await recovered.coldControl({
            action: 'verify',
            operationId: recovered.status().operationId ?? randomUUID(),
          });
          expect(recovered.journal.state.verifiedAt).not.toBeNull();
        }
        await recovered.close();
        if (interrupted && attempt === 1) {
          const editor = fork(
            fileURLToPath(new URL('./restore-postcommit-edit-fixture.ts', import.meta.url)),
            [],
            {
              env: {
                ...process.env,
                DATABASE_PATH: f.databasePath,
                SPINEL_TEST_FOLDER_ID: seedSource.folderId,
              },
              execArgv: [],
              stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
            },
          );
          let edited: unknown;
          editor.on('message', (value: unknown) => {
            edited = value;
          });
          expect((await once(editor, 'exit'))[0]).toBe(0);
          expect(edited).toEqual({ edited: true });
        }
      }
      cleanup?.mockRestore();
      if (interrupted) {
        expect(cleanupAttempts).toBe(3);
        const unchanged = fork(
          fileURLToPath(new URL('./restore-controller-observer-fixture.ts', import.meta.url)),
          [],
          {
            env: {
              ...process.env,
              DATABASE_PATH: f.databasePath,
              SPINEL_TEST_FOLDER_ID: seedSource.folderId,
            },
            execArgv: [],
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
          },
        );
        let retained: unknown;
        unchanged.on('message', (value: unknown) => {
          retained = value;
        });
        expect((await once(unchanged, 'exit'))[0]).toBe(0);
        expect(retained).toEqual({ name: 'Post-commit edit', sessions: 0 });
      }
    }
  },
  90_000,
);

test('admission durably retains source before ACK and exact retries reuse its continuation', async () => {
  const f = await admissionFixture();
  const before = f.supervisor.status();
  const result = await f.supervisor.admitPreparedRestore(f.request);
  expect(result.custody).toBe(true);
  expect(result.record.phase).toBe('source-retained');
  expect(result.continuationToken).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  const text = await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8');
  expect(JSON.parse(text)).toEqual(result.record);
  expect(text).not.toContain(result.continuationToken!);
  expect(f.supervisor.journal.state.restoreJob).toEqual({
    jobId: f.request.id,
    intentHash: result.record.intentHash,
  });
  await rm(f.request.source.archive.path);
  await rm(f.request.source.databasePath);
  const retried = await f.supervisor.admitPreparedRestore(f.request);
  expect(retried).toEqual(result);
  await expect(
    f.supervisor.admitPreparedRestore({ ...f.request, confirmedAt: f.request.confirmedAt + 1 }),
  ).rejects.toThrow();
  await expect(
    f.supervisor.admitPreparedRestore({ ...f.request, id: randomUUID() }),
  ).rejects.toThrow('current restore');
  expect(f.supervisor.status()).toEqual(before);
});

test.each(['copy', 'revocation'])(
  'certain pre-mutation %s failure preserves running data and records terminal failure',
  async (cause) => {
    const f = await admissionFixture(cause === 'revocation' ? 2 : undefined);
    const before = f.supervisor.status();
    if (cause === 'copy') f.request.source.archive.sha256 = 'f'.repeat(64);
    await expect(f.supervisor.admitPreparedRestore(f.request)).rejects.toThrow();
    const record = JSON.parse(
      await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8'),
    );
    expect(record.phase).toBe('failed');
    expect(f.supervisor.journal.state.restoreJob).toBeNull();
    expect(f.supervisor.status()).toEqual(before);
    const retried = await f.supervisor.admitPreparedRestore(f.request);
    expect(retried).toEqual({ record, custody: false });
    expect(await readFile(f.request.source.archive.path)).toEqual(Buffer.alloc(128, 1));
  },
);

test('uncertain main-reference publication retains the independent admission guard', async () => {
  const f = await admissionFixture();
  const write = vi.spyOn(f.supervisor.journal, 'write').mockImplementation(() => {
    throw new Error('Journal publication failed.');
  });
  try {
    await expect(f.supervisor.admitPreparedRestore(f.request)).rejects.toThrow();
    expect(f.supervisor.status().phase).toBe('recovery-required');
    const record = JSON.parse(
      await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8'),
    );
    expect(record.phase).toBe('accepted');
    expect(() => f.supervisor.journal.assertNoPendingRestoreJobs()).toThrow('unfinished restore');
  } finally {
    write.mockRestore();
  }
});

test('stale generation and policy confirmations cannot create admission records', async () => {
  const f = await admissionFixture();
  await expect(
    f.supervisor.admitPreparedRestore({ ...f.request, generationId: randomUUID() }),
  ).rejects.toThrow('confirmation');
  await expect(
    f.supervisor.admitPreparedRestore({
      ...f.request,
      source: {
        ...f.request.source,
        recovery: { ...f.request.source.recovery, image: 'spinel@sha256:' + 'b'.repeat(64) },
      },
    }),
  ).rejects.toThrow('deployment policy');
  expect(await readdir(f.root)).not.toContain('restore-jobs');
  expect(f.supervisor.status().phase).toBe('running');
});

test('synchronous expiry after custody checkpoint cannot return an ACK', async () => {
  let elapsed = 0;
  const f = await admissionFixture(undefined, () => Date.now() + elapsed);
  const checkpoint = RestoreJobs.prototype.checkpoint;
  const delayed = vi.spyOn(RestoreJobs.prototype, 'checkpoint').mockImplementation(function (
    this: RestoreJobs,
    ...args: Parameters<RestoreJobs['checkpoint']>
  ) {
    const result = checkpoint.apply(this, args);
    if (args[3] === 'source-retained') elapsed = 60_000;
    return result;
  });
  try {
    await expect(f.supervisor.admitPreparedRestore(f.request)).rejects.toThrow('expired');
    const record = JSON.parse(
      await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8'),
    );
    expect(record.phase).toBe('failed');
    expect(f.supervisor.journal.state.restoreJob).toBeNull();
    expect(f.supervisor.status().phase).toBe('running');
  } finally {
    delayed.mockRestore();
  }
});

test('shutdown retains journal ownership until an aborted source-copy operation settles', async () => {
  const f = await admissionFixture();
  let arrived!: () => void, release!: () => void;
  const copying = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const retain = restoreFiles.retainRestoreSource;
  const delayed = vi
    .spyOn(restoreFiles, 'retainRestoreSource')
    .mockImplementation(async (options) => {
      arrived();
      await held; // Models an I/O operation that cannot finish just because its signal aborted.
      return retain(options);
    });
  const journalClose = vi.spyOn(f.supervisor.journal, 'close');
  const rejected = expect(f.supervisor.admitPreparedRestore(f.request)).rejects.toThrow();
  await copying;
  let closed = false;
  const closing = f.supervisor.close().then(() => {
    closed = true;
  });
  const duplicate = f.supervisor.close();
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    expect(journalClose).not.toHaveBeenCalled();
  } finally {
    release();
    await rejected;
    await Promise.all([closing, duplicate]);
    delayed.mockRestore();
  }
  expect(journalClose).toHaveBeenCalledOnce();
  const record = JSON.parse(
    await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8'),
  );
  expect(record.phase).toBe('accepted');
});

test('retained-source retry rechecks expiry after the final proof promise settles', async () => {
  let elapsed = 0;
  const f = await admissionFixture(undefined, () => Date.now() + elapsed);
  await f.supervisor.admitPreparedRestore(f.request);
  let replies = 0;
  const delay = (value: unknown) => {
    if (
      value &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === 'restore-authority-result' &&
      'accepted' in value &&
      value.accepted === true &&
      ++replies === 2
    ) {
      // The parent's registered handler resolves its proof promise first. This
      // microtask expires it before admission continues, without firing timers.
      queueMicrotask(() => {
        elapsed = 60_000;
      });
    }
  };
  f.child.on('message', delay);
  try {
    await expect(f.supervisor.admitPreparedRestore(f.request)).rejects.toThrow('expired');
    expect(replies).toBe(2);
    const record = JSON.parse(
      await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8'),
    );
    expect(record.phase).toBe('failed');
    expect(f.supervisor.journal.state.restoreJob).toBeNull();
  } finally {
    f.child.off('message', delay);
  }
});

test('begin acknowledges a durable pause plan before drain and retains the job witness before ACK', async () => {
  const f = await admissionFixture(undefined, undefined, { SPINEL_TEST_DRAIN_MS: '500' });
  const admitted = await f.supervisor.admitPreparedRestore(f.request);
  const begin = {
    id: f.request.id,
    intentHash: admitted.record.intentHash,
    continuationToken: admitted.continuationToken!,
  };
  await expect(
    f.supervisor.beginPreparedRestore({ ...begin, continuationToken: 'A'.repeat(43) }),
  ).rejects.toThrow('continuation');
  expect(f.supervisor.status().phase).toBe('running');
  const statePath = join(f.root, 'restore-jobs', begin.id, 'state.json');
  let outputParentSynced = false;
  const syncDirectory = restoreInput.syncRestoreDirectory;
  vi.spyOn(restoreInput, 'syncRestoreDirectory').mockImplementation(async (path, signal) => {
    await syncDirectory(path, signal);
    if (
      path.startsWith(join(f.root, `restore-${begin.id}`, 'freeze-')) &&
      (await readdir(path)).some((name) => name.startsWith('.restore-frozen-'))
    )
      outputParentSynced = true;
  });
  const markFrozen = RestoreJobs.prototype.markFrozen;
  vi.spyOn(RestoreJobs.prototype, 'markFrozen').mockImplementation(function (
    this: RestoreJobs,
    ...args: Parameters<RestoreJobs['markFrozen']>
  ) {
    expect(outputParentSynced).toBe(true);
    return markFrozen.apply(this, args);
  });

  const write = f.supervisor.journal.write.bind(f.supervisor.journal);
  let witnessedBeforeAck = false;
  vi.spyOn(f.supervisor.journal, 'write').mockImplementation(() => {
    if (f.supervisor.journal.state.restoreStop?.fingerprint && !witnessedBeforeAck) {
      const job = JSON.parse(readFileSync(statePath, 'utf8'));
      expect(job.phase).toBe('witness-accepted');
      expect(job.execution.stop).toEqual(f.supervisor.journal.state.restoreStop);
      expect(existsSync(join(f.directory, 'witness-ack'))).toBe(false);
      witnessedBeforeAck = true;
    }
    write();
  });
  const planned = await f.supervisor.beginPreparedRestore(begin);
  expect(planned.record.phase).toBe('pause-planned');
  expect(['running', 'draining']).toContain(f.supervisor.status().phase);
  // This custody fixture deliberately has no valid SQLite candidate. The real
  // controller must retain its original evidence and refuse preparation.
  await expect
    .poll(() => f.supervisor.status().phase, { timeout: 15_000 })
    .toBe('recovery-required');
  expect(JSON.parse(await readFile(statePath, 'utf8')).phase).toBe('preparation-planned');
  expect(witnessedBeforeAck).toBe(true);
  expect(existsSync(join(f.directory, 'witness-ack'))).toBe(true);
  assertWorkspaceHandlesClosed(f.databasePath);
  const completed = JSON.parse(await readFile(statePath, 'utf8'));
  expect(completed.intent).toEqual(admitted.record.intent);
  const frozen = completed.execution.frozen;
  expect(frozen.fingerprint).toBe(completed.execution.stop.fingerprint);
  const frozenPath = join(
    f.root,
    `restore-${begin.id}`,
    `freeze-${completed.execution.freezeSlot}`,
    frozen.directory,
    'frozen.sqlite',
  );
  const frozenBytes = await readFile(frozenPath);
  expect(frozenBytes.length).toBe(frozen.bytes);
  expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(frozen.sha256);
  const observer = new RestoreJobs(f.supervisor.journal);
  try {
    expect(observer.read(begin.id)).toEqual(completed);
    for (const alter of ['path', 'fingerprint', 'original-inode']) {
      const invalid = structuredClone(completed);
      if (alter === 'path') invalid.execution.frozen.directory = '../escape';
      else if (alter === 'fingerprint') invalid.execution.frozen.fingerprint = '0'.repeat(64);
      else invalid.execution.originals.identity.inode = '0';
      writeFileSync(statePath, JSON.stringify(invalid));
      expect(() => observer.read(begin.id)).toThrow('unavailable');
    }
  } finally {
    writeFileSync(statePath, JSON.stringify(completed));
    observer.close();
  }

  const retried = await f.supervisor.beginPreparedRestore(begin);
  expect(retried.record).toEqual(completed);
  expect(f.supervisor.status().epoch).toBe(planned.record.execution!.epoch);
  expect(f.supervisor.status().phase).toBe('recovery-required');
}, 60_000);

test('failed job-witness publication never sends the child a custody acknowledgement', async () => {
  const f = await admissionFixture();
  const admitted = await f.supervisor.admitPreparedRestore(f.request);
  vi.spyOn(RestoreJobs.prototype, 'acceptWitness').mockImplementation(() => {
    throw new Error('Injected witness publication failure');
  });
  await f.supervisor.beginPreparedRestore({
    id: f.request.id,
    intentHash: admitted.record.intentHash,
    continuationToken: admitted.continuationToken!,
  });
  await expect
    .poll(() => f.supervisor.status().lastFailure, { timeout: 10_000 })
    .toBe('restore-execution-unresolved');
  expect(existsSync(join(f.directory, 'witness-ack'))).toBe(false);
  expect(f.supervisor.journal.state.restoreStop!.fingerprint).toBeNull();
  const job = JSON.parse(
    await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8'),
  );
  expect(job.phase).toBe('stop-requested');
  assertWorkspaceHandlesClosed(f.databasePath);
  expect(() => f.supervisor.journal.assertNoPendingRestoreJobs()).toThrow('unfinished restore');
}, 60_000);

test('a begin retry responds while drain is waiting for that retry to release', async () => {
  const f = await admissionFixture(undefined, undefined, { SPINEL_TEST_NEVER_DRAIN: '1' });
  const admitted = await f.supervisor.admitPreparedRestore(f.request);
  const request = {
    id: f.request.id,
    intentHash: admitted.record.intentHash,
    continuationToken: admitted.continuationToken!,
  };
  await f.supervisor.beginPreparedRestore(request);
  await expect.poll(() => f.supervisor.status().phase).toBe('draining');
  let response: Awaited<ReturnType<MaintenanceSupervisor['beginPreparedRestore']>> | undefined;
  const retry = f.supervisor.beginPreparedRestore(request).then((result) => {
    response = result;
  });
  // The fixture withholds drain until the simulated request has its response.
  await expect.poll(() => response?.record.phase, { timeout: 3000 }).toBe('pause-planned');
  await retry;
  f.child.send({ releaseHeldDrain: true });
  await expect
    .poll(() => f.supervisor.status().phase, { timeout: 15_000 })
    .toBe('recovery-required');
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(f.root, 'restore-jobs', request.id, 'state.json'), 'utf8'))
          .phase,
      { timeout: 15_000 },
    )
    .toBe('preparation-planned');
}, 60_000);

test('a published pause plan followed by failure fences the application without discarding intent', async () => {
  const f = await admissionFixture();
  const admitted = await f.supervisor.admitPreparedRestore(f.request);
  const plan = RestoreJobs.prototype.planPause;
  vi.spyOn(RestoreJobs.prototype, 'planPause').mockImplementation(function (
    this: RestoreJobs,
    ...args: Parameters<RestoreJobs['planPause']>
  ) {
    plan.apply(this, args);
    throw new Error('Injected failure after durable plan');
  });
  const request = {
    id: f.request.id,
    intentHash: admitted.record.intentHash,
    continuationToken: admitted.continuationToken!,
  };
  await expect(f.supervisor.beginPreparedRestore(request)).rejects.toThrow('after durable plan');
  expect(f.supervisor.status().phase).toBe('recovery-required');
  expect(f.supervisor.status().lastFailure).toBe('restore-execution-unresolved');
  const retry = await f.supervisor.beginPreparedRestore(request);
  expect(retry.record.phase).toBe('pause-planned');
  expect(retry.record.intent).toEqual(admitted.record.intent);
  expect(retry.queued).toBe(false);
  expect(f.supervisor.journal.state.restoreJob?.jobId).toBe(request.id);
}, 60_000);

test('stop-plan persistence crossing original expiry never dispatches the shutdown challenge', async () => {
  let clock: number | undefined;
  const f = await admissionFixture(undefined, () => clock ?? Date.now());
  const admitted = await f.supervisor.admitPreparedRestore(f.request);
  const plan = RestoreJobs.prototype.planStop;
  vi.spyOn(RestoreJobs.prototype, 'planStop').mockImplementation(function (
    this: RestoreJobs,
    ...args: Parameters<RestoreJobs['planStop']>
  ) {
    const result = plan.apply(this, args);
    clock = f.request.authority.expiresAt;
    return result;
  });
  const send = vi.spyOn(f.child, 'send');
  await f.supervisor.beginPreparedRestore({
    id: f.request.id,
    intentHash: admitted.record.intentHash,
    continuationToken: admitted.continuationToken!,
  });
  await expect
    .poll(() => f.supervisor.status().lastFailure, { timeout: 10_000 })
    .toBe('restore-execution-unresolved');
  expect(
    send.mock.calls.some(
      ([message]) =>
        message &&
        typeof message === 'object' &&
        'kind' in message &&
        message.kind === 'restore-stop',
    ),
  ).toBe(false);
  const job = JSON.parse(
    await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8'),
  );
  expect(job.phase).toBe('stop-requested');
  expect(job.execution.stop.fingerprint).toBeNull();
  expect(existsSync(join(f.directory, 'witness-ack'))).toBe(false);
  assertWorkspaceHandlesClosed(f.databasePath);
}, 60_000);

test('revocation during drain preserves raw current evidence and refuses frozen authority', async () => {
  const f = await admissionFixture(undefined, undefined, { SPINEL_TEST_REVOKE_ON_DRAIN: '1' });
  const admitted = await f.supervisor.admitPreparedRestore(f.request);
  await f.supervisor.beginPreparedRestore({
    id: f.request.id,
    intentHash: admitted.record.intentHash,
    continuationToken: admitted.continuationToken!,
  });
  await expect
    .poll(() => f.supervisor.status().lastFailure, { timeout: 15_000 })
    .toBe('restore-execution-unresolved');
  const job = JSON.parse(
    await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8'),
  );
  expect(job.phase).toBe('freeze-planned');
  expect(job.execution.originals.id).toBe(f.request.id);
  expect(job.execution.frozen).toBeUndefined();
  expect(job.execution.stop.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  assertWorkspaceHandlesClosed(f.databasePath);
  const raw = await readFile(join(f.root, `restore-${f.request.id}`, 'original', 'spinel.sqlite'));
  expect(createHash('sha256').update(raw).digest('hex')).toBe(
    job.execution.originals.original['spinel.sqlite'].sha256,
  );
  expect(fileIdentity(f.databasePath)).toEqual(admitted.record.intent.target.identity);
}, 60_000);

test.each(['publication', 'deadline'])(
  'late frozen %s failure retains the exact output and cannot allocate another slot on retry',
  async (boundary) => {
    const f = await admissionFixture();
    const admitted = await f.supervisor.admitPreparedRestore(f.request);
    const actualNow = Date.now;
    let elapsed = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => actualNow() + elapsed);
    const markFrozen = RestoreJobs.prototype.markFrozen;
    vi.spyOn(RestoreJobs.prototype, 'markFrozen').mockImplementation(function (
      this: RestoreJobs,
      ...args: Parameters<RestoreJobs['markFrozen']>
    ) {
      const result = markFrozen.apply(this, args);
      if (boundary === 'publication') throw new Error('Injected failure after frozen publication');
      elapsed = 120_001;
      return result;
    });
    const request = {
      id: f.request.id,
      intentHash: admitted.record.intentHash,
      continuationToken: admitted.continuationToken!,
    };
    await f.supervisor.beginPreparedRestore(request);
    await expect
      .poll(() => f.supervisor.status().lastFailure, { timeout: 15_000 })
      .toBe('restore-execution-unresolved');
    const job = JSON.parse(
      await readFile(join(f.root, 'restore-jobs', request.id, 'state.json'), 'utf8'),
    );
    expect(job.phase).toBe('frozen');
    const retained = join(f.root, `restore-${request.id}`),
      slot = `freeze-${job.execution.freezeSlot}`;
    expect((await readdir(retained)).filter((name) => name.startsWith('freeze-'))).toEqual([slot]);
    const output = join(retained, slot, job.execution.frozen.directory, 'frozen.sqlite');
    const before = await readFile(output);
    expect(createHash('sha256').update(before).digest('hex')).toBe(job.execution.frozen.sha256);
    const retry = await f.supervisor.beginPreparedRestore(request);
    expect(retry.record).toEqual(job);
    expect(await readFile(output)).toEqual(before);
    expect((await readdir(retained)).filter((name) => name.startsWith('freeze-'))).toEqual([slot]);
    expect(f.supervisor.status().phase).toBe('recovery-required');
    assertWorkspaceHandlesClosed(f.databasePath);
  },
  60_000,
);

async function unexecutedRestartFixture(
  phase: 'accepted' | 'source-retained' | 'failed' = 'accepted',
) {
  const f = await fixture(),
    first = await f.supervisor();
  await start(first);
  const state = first.journal.state,
    originalChild = structuredClone(first.journal.state.child),
    intent = {
      ...restoreJobIntentFixture(),
      target: {
        instanceId: state.instanceId,
        generationId: state.generationId,
        epoch: state.epoch,
        databasePath: first.journal.databasePath,
        identity: { ...state.databaseIdentity! },
      },
    };
  const jobs = new RestoreJobs(first.journal);
  let record = jobs.admit(intent).record;
  if (phase !== 'accepted')
    record = jobs.checkpoint(intent.id, record.intentHash, record.revision, phase);
  jobs.close();
  first.journal.state.restoreJob = { jobId: intent.id, intentHash: record.intentHash };
  first.journal.write();
  const sourcePath = join(f.root, `restore-${intent.id}`);
  await mkdir(sourcePath, { mode: 0o700 });
  const retained = Buffer.from('Retained source custody must survive admission cleanup.');
  await writeFile(join(sourcePath, 'source-custody'), retained, { mode: 0o600 });
  await first.close();
  const statePath = join(f.root, 'restore-jobs', intent.id, 'state.json'),
    mainPath = join(f.root, 'journal.json');
  return { ...f, record, intent, retained, sourcePath, statePath, mainPath, originalChild };
}
test.each(['accepted', 'source-retained', 'failed'] as const)(
  'restart abandons only unexecuted %s admission without renewing expired proof or replaying source',
  async (phase) => {
    const f = await unexecutedRestartFixture(phase),
      previous = JSON.parse(await readFile(f.mainPath, 'utf8'));
    const before = await readFile(f.databasePath);
    let durable: string | undefined,
      epoch = previous.epoch;
    for (let restart = 0; restart < 3; restart++) {
      const supervisor = await MaintenanceSupervisor.open({
        root: f.root,
        databasePath: f.databasePath,
        publicPort: 0,
        now: () => f.intent.authority.expiresAt + 100_000 + restart,
        budgets: { stopMs: 100, verifyMs: 5000 },
      });
      cleanups.push(() => supervisor.close());
      expect(supervisor.status().epoch).not.toBe(epoch);
      epoch = supervisor.status().epoch;
      expect(supervisor.journal.state.restoreJob).toBeNull();
      expect(supervisor.journal.state.completedOperationId).toBe(f.intent.id);
      expect(supervisor.journal.state.child).toBeNull();
      expect(supervisor.journal.state.verifiedAt).toBeNull();
      expect(supervisor.journal.state.generationId).toBe(f.intent.target.generationId);
      expect(['stopped', 'recovery-required']).toContain(supervisor.status().phase);
      const bytes = await readFile(f.statePath, 'utf8'),
        record = JSON.parse(bytes);
      expect(record.phase).toBe('failed');
      expect(record.intent).toEqual(f.intent);
      expect(record.intentHash).toBe(f.record.intentHash);
      expect(record.revision).toBe(f.record.revision + (phase === 'failed' ? 0 : 1));
      if (durable) expect(bytes).toBe(durable);
      durable = bytes;
      expect(() => supervisor.journal.assertNoPendingRestoreJobs()).not.toThrow();
      expect(await readFile(join(f.sourcePath, 'source-custody'))).toEqual(f.retained);
      expect(await readFile(f.databasePath)).toEqual(before);
      assertWorkspaceHandlesClosed(f.databasePath);
      await supervisor.close();
    }
  },
  20_000,
);

test.each(['failed-publication', 'main-publication'] as const)(
  'restart retries uncertain preexecution cleanup after %s without renewing intent',
  async (fault) => {
    const f = await unexecutedRestartFixture('source-retained');
    let injected = false;
    if (fault === 'failed-publication') {
      const checkpoint = RestoreJobs.prototype.checkpoint;
      vi.spyOn(RestoreJobs.prototype, 'checkpoint').mockImplementation(function (
        this: RestoreJobs,
        ...args: Parameters<RestoreJobs['checkpoint']>
      ) {
        const record = checkpoint.apply(this, args);
        if (!injected && args[3] === 'failed') {
          injected = true;
          throw new Error('Lost failed publication');
        }
        return record;
      });
    } else {
      const write = RecoveryJournal.prototype.write;
      vi.spyOn(RecoveryJournal.prototype, 'write').mockImplementation(function (
        this: RecoveryJournal,
      ) {
        write.call(this);
        if (
          !injected &&
          !this.state.restoreJob &&
          this.state.completedOperationId === f.intent.id
        ) {
          injected = true;
          throw new Error('Lost main cleanup publication');
        }
      });
    }
    const uncertain = await f.supervisor();
    expect(injected).toBe(true);
    expect(uncertain.status().phase).toBe('recovery-required');
    expect(uncertain.journal.state.verifiedAt).toBeNull();
    expect(uncertain.journal.state.child).toBeNull();
    const failed = await readFile(f.statePath, 'utf8');
    expect(JSON.parse(failed)).toMatchObject({ phase: 'failed', intent: f.intent });
    await uncertain.close();
    vi.restoreAllMocks();
    const retry = await f.supervisor();
    expect(retry.journal.state.restoreJob).toBeNull();
    expect(retry.journal.state.completedOperationId).toBe(f.intent.id);
    expect(retry.journal.state.child).toBeNull();
    expect(retry.journal.state.verifiedAt).toBeNull();
    expect(await readFile(f.statePath, 'utf8')).toBe(failed);
    expect(await readFile(join(f.sourcePath, 'source-custody'))).toEqual(f.retained);
    expect(() => retry.journal.assertNoPendingRestoreJobs()).not.toThrow();
  },
  20_000,
);

test.each([
  'conflicting-reference',
  'missing-reference-target',
  'multiple',
  'postexecution',
  'barrier',
  'active-operation',
  'wrong-generation',
  'wrong-instance',
  'wrong-inode',
  'unknown-inventory',
] as const)(
  'restart preserves closed uncertain admission with %s',
  async (condition) => {
    const f = await unexecutedRestartFixture(),
      main = JSON.parse(await readFile(f.mainPath, 'utf8'));
    const record = structuredClone(f.record);
    if (condition === 'conflicting-reference') main.restoreJob.intentHash = 'f'.repeat(64);
    if (condition === 'missing-reference-target') main.restoreJob.jobId = randomUUID();
    if (condition === 'active-operation')
      main.operation = {
        id: randomUUID(),
        generationId: main.generationId,
        actorId: f.intent.authority.actorId,
        sessionHash: f.intent.authority.sessionHash,
        expiresAt: f.intent.authority.expiresAt,
        tokenHash: f.intent.continuationHash,
      };
    if (condition === 'wrong-generation') record.intent.target.generationId = randomUUID();
    if (condition === 'wrong-instance') record.intent.target.instanceId = randomUUID();
    if (condition === 'wrong-inode')
      record.intent.target.identity.inode = String(
        BigInt(record.intent.target.identity.inode) + 1n,
      );
    if (condition.startsWith('wrong-')) {
      record.intentHash = restoreIntentHash(record.intent);
      main.restoreJob.intentHash = record.intentHash;
    }
    if (condition === 'postexecution') {
      Object.assign(record, {
        phase: 'pause-planned',
        execution: { epoch: randomUUID(), child: f.originalChild, stop: null, requestedAt: null },
      });
      // The recorded identity remains valid historical evidence after physical exit.
      expect(f.originalChild).not.toBeNull();
    }
    if (condition === 'multiple') {
      const other = structuredClone(record),
        id = randomUUID();
      other.intent.id = other.intent.source.id = id;
      other.intentHash = restoreIntentHash(other.intent);
      const directory = join(f.root, 'restore-jobs', id);
      await mkdir(directory, { mode: 0o700 });
      await writeFile(join(directory, 'state.json'), JSON.stringify(other), { mode: 0o600 });
    }
    if (condition === 'unknown-inventory')
      await writeFile(join(f.root, 'restore-jobs', 'unknown'), '?', { mode: 0o600 });
    if (condition === 'barrier')
      await writeFile(
        restoreBarrierPath(f.databasePath),
        JSON.stringify({
          version: 1,
          operationId: f.intent.id,
          identity: f.intent.target.identity,
        }) + '\n',
        { mode: 0o600 },
      );
    await writeFile(f.statePath, JSON.stringify(record), { mode: 0o600 });
    await writeFile(f.mainPath, JSON.stringify(main), { mode: 0o600 });
    const before = await readFile(f.statePath),
      bytes = await readFile(f.databasePath);
    const supervisor = await f.supervisor();
    expect(supervisor.status().phase).toBe('recovery-required');
    expect(supervisor.journal.state.restoreJob).toEqual(main.restoreJob);
    expect(supervisor.journal.state.verifiedAt).toBeNull();
    expect(await readFile(f.statePath)).toEqual(before);
    expect(await readFile(f.databasePath)).toEqual(bytes);
    expect(await readFile(join(f.sourcePath, 'source-custody'))).toEqual(f.retained);
    await expect(
      supervisor.coldControl({ action: 'verify', operationId: randomUUID() }),
    ).rejects.toThrow();
  },
  20_000,
);

function observeFromFixture(
  child: ChildProcess,
  id?: string,
): Promise<{
  ok: boolean;
  result?: RestoreObservation;
}> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const done = (error?: Error, result?: { ok: boolean; result?: RestoreObservation }) => {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', exited);
      if (error) reject(error);
      else resolve(result!);
    };
    const receive = (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const value = message as Record<string, unknown>;
      if (
        value.channel !== 'spinel-maintenance-fixture' ||
        value.kind !== 'observe-restore-result' ||
        value.requestId !== requestId
      )
        return;
      done(undefined, {
        ok: value.ok === true,
        result: value.result as RestoreObservation | undefined,
      });
    };
    const exited = () => done(new Error('Observation fixture exited before its response.'));
    const timer = setTimeout(
      () => done(new Error('Observation joined blocked work or did not answer.')),
      3000,
    );
    child.on('message', receive);
    child.once('exit', exited);
    child.send(
      {
        channel: 'spinel-maintenance-fixture',
        kind: 'observe-restore',
        requestId,
        ...(id === undefined ? {} : { id }),
      },
      (error) => {
        if (error) done(error);
      },
    );
  });
}
test('real child observation sees queued prepublication admission without joining its blocked queue', async () => {
  const f = await admissionFixture();
  const empty = await observeFromFixture(f.child, f.request.id);
  expect(empty).toMatchObject({
    ok: true,
    result: {
      record: null,
      pending: false,
      target: { generationId: f.request.generationId, epoch: f.request.epoch },
    },
  });
  const owner = f.supervisor as unknown as { queue: Promise<unknown> };
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  owner.queue = owner.queue.then(() => held);
  let settled = false;
  const admission = f.supervisor.admitPreparedRestore(f.request).finally(() => {
    settled = true;
  });
  void admission.catch(() => {});
  try {
    const queued = await observeFromFixture(f.child, f.request.id);
    expect(queued).toMatchObject({ ok: true, result: { record: null, pending: true } });
    expect(settled).toBe(false);
    expect(f.supervisor.journal.state.restoreJob).toBeNull();
    await expect(
      lstat(join(f.root, 'restore-jobs', f.request.id, 'state.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    // Looking up another ID cannot disguise globally pending mutation work.
    expect(await observeFromFixture(f.child, randomUUID())).toMatchObject({
      ok: true,
      result: { record: null, pending: true },
    });
  } finally {
    release();
  }
  const admitted = await admission;
  expect(await observeFromFixture(f.child, f.request.id)).toMatchObject({
    ok: true,
    result: { record: admitted.record, pending: true },
  });
  await f.supervisor.close();
  let child!: ChildProcess;
  const restarted = await MaintenanceSupervisor.open({
    root: f.root,
    databasePath: f.databasePath,
    publicPort: 0,
    createChild: (token) => {
      child = f.createChild(token);
      return child;
    },
    budgets: { startMs: 5000, stopMs: 100, verifyMs: 5000 },
  });
  cleanups.push(() => restarted.close());
  expect(restarted.journal.state.restoreJob).toBeNull();
  expect(restarted.journal.state.verifiedAt).toBeNull();
  await start(restarted); // Explicit normal recovery, never a metadata bypass.
  const observed = await observeFromFixture(child, f.request.id);
  expect(observed).toMatchObject({
    ok: true,
    result: {
      pending: false,
      record: {
        phase: 'failed',
        intent: admitted.record.intent,
        intentHash: admitted.record.intentHash,
      },
    },
  });
  expect(observed.result!.target.generationId).toBe(f.request.generationId);
  expect(observed.result!.target.epoch).not.toBe(f.request.epoch);
  const source = await readFile(
    join(f.root, `restore-${f.request.id}-source`, 'source.spinel.enc'),
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(f.request.source.archive.sha256);
}, 20_000);

test('real child observation refuses corrupt complete inventory instead of reporting missing evidence', async () => {
  const f = await admissionFixture();
  expect(await observeFromFixture(f.child)).toMatchObject({
    ok: true,
    result: { record: null, pending: false },
  });
  const id = randomUUID(),
    directory = join(f.root, 'restore-jobs', id);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'state.json'), '{', { mode: 0o600 });
  const response = await observeFromFixture(f.child, randomUUID());
  expect(response).toEqual({ ok: false, result: undefined });
  expect(f.supervisor.status().phase).toBe('running');
  expect(await readFile(join(directory, 'state.json'), 'utf8')).toBe('{');
}, 15_000);

test.each(['recovery-volume', 'shared-volume'] as const)(
  'whole-cutover capacity rejects insufficient %s before pause while the real child stays running',
  async (kind) => {
    let application = '',
      recovery = '',
      low = false,
      capacity = 0n;
    const f = await admissionFixture(undefined, undefined, {}, (path) => ({
      device: kind === 'shared-volume' || path !== recovery ? '1' : '2',
      availableBytes:
        low && (kind === 'shared-volume' || path === recovery) ? capacity : 10n ** 12n,
    }));
    application = f.databasePath;
    recovery = f.root;
    const request = {
      generationId: f.request.generationId,
      epoch: f.request.epoch,
      archiveBytes: f.request.source.archive.bytes,
      databaseBytes: f.request.source.databaseBytes,
      previewDatabaseBytes: f.request.previewDatabaseBytes,
    };
    const initial = f.supervisor.estimatePreparedRestore(request);
    expect(initial.resources.sufficient).toBe(true);
    const admitted = await f.supervisor.admitPreparedRestore(f.request);
    const plan = estimateRestoreCapacity(
      {
        ...request,
        databasePath: application,
        recoveryRoot: recovery,
        identity: admitted.record.intent.target.identity,
        sourceRetained: true,
        checkedAt: Date.now(),
      },
      (path) => ({
        device: kind === 'shared-volume' || path !== recovery ? '1' : '2',
        availableBytes: 10n ** 12n,
      }),
    );
    const recoveryPlan = plan.filesystems.find((item) => item.purposes.includes('recovery'))!;
    capacity = BigInt(recoveryPlan.requiredAdditionalBytes - 1);
    if (kind === 'shared-volume') {
      // Both independent demands fit; it is their simultaneous shared-volume
      // sum that must refuse, not a accidentally low single-volume fixture.
      const independent = estimateRestoreCapacity(
        {
          ...request,
          databasePath: application,
          recoveryRoot: recovery,
          identity: admitted.record.intent.target.identity,
          sourceRetained: true,
          checkedAt: Date.now(),
        },
        (path) => ({ device: path === recovery ? '2' : '1', availableBytes: 10n ** 12n }),
      );
      expect(
        independent.filesystems.every((item) => BigInt(item.requiredAdditionalBytes) <= capacity),
      ).toBe(true);
    }
    low = true;
    const before = f.supervisor.status(),
      beforeJournal = await readFile(join(f.root, 'journal.json'));
    const pause = vi.spyOn(RestoreJobs.prototype, 'planPause');
    const sent = vi.spyOn(f.child, 'send');
    await expect(
      f.supervisor.beginPreparedRestore({
        id: f.request.id,
        intentHash: admitted.record.intentHash,
        continuationToken: admitted.continuationToken!,
      }),
    ).rejects.toThrow('insufficient disk space');
    expect(pause).not.toHaveBeenCalled();
    const rpcRequestId = randomUUID();
    await (
      f.supervisor as unknown as { restoreRpc(child: ChildProcess, value: object): Promise<void> }
    ).restoreRpc(f.child, {
      channel: MAINTENANCE_CHANNEL,
      kind: 'restore-begin',
      requestId: rpcRequestId,
      request: {
        id: f.request.id,
        intentHash: admitted.record.intentHash,
        continuationToken: admitted.continuationToken!,
      },
    });
    expect(
      sent.mock.calls.find(
        ([message]) =>
          !!message &&
          typeof message === 'object' &&
          'requestId' in message &&
          message.requestId === rpcRequestId,
      )?.[0],
    ).toEqual({
      channel: MAINTENANCE_CHANNEL,
      kind: 'restore-result',
      action: 'restore-begin',
      requestId: rpcRequestId,
      error: RESTORE_RPC_ERROR,
      resourceCode: 'disk-space',
      target: { generationId: f.request.generationId, epoch: f.request.epoch },
    });
    expect(pause).not.toHaveBeenCalled();
    expect(f.supervisor.status()).toEqual(before);
    expect(f.supervisor.status().phase).toBe('running');
    expect(f.child.connected).toBe(true);
    expect(await readFile(join(f.root, 'journal.json'))).toEqual(beforeJournal);
    const record = JSON.parse(
      await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8'),
    );
    expect(record).toEqual(admitted.record);
    expect(record.execution).toBeUndefined();
    expect(f.supervisor.journal.state.restoreStop).toBeNull();
    expect(existsSync(join(f.root, `restore-${f.request.id}`))).toBe(false);
    expect(existsSync(restoreBarrierPath(f.databasePath))).toBe(false);
    expect(
      sent.mock.calls.some(
        ([message]) =>
          !!message &&
          typeof message === 'object' &&
          'kind' in message &&
          ['pause', 'restore-stop'].includes(String(message.kind)),
      ),
    ).toBe(false);
    const refreshed = f.supervisor.estimatePreparedRestore(request);
    expect(refreshed.resources.sufficient).toBe(false);
    expect(() =>
      f.supervisor.estimatePreparedRestore({ ...request, epoch: randomUUID() }),
    ).toThrow();
  },
);

test('capacity probing cannot cross original proof expiry and publish a pause plan', async () => {
  let clock: number | undefined;
  let expire = false;
  const f = await admissionFixture(
    undefined,
    () => clock ?? Date.now(),
    {},
    () => {
      if (expire) clock = Date.now() + 60_000;
      return { device: '1', availableBytes: 10n ** 12n };
    },
  );
  const admitted = await f.supervisor.admitPreparedRestore(f.request);
  const pause = vi.spyOn(RestoreJobs.prototype, 'planPause');
  expire = true;
  await expect(
    f.supervisor.beginPreparedRestore({
      id: f.request.id,
      intentHash: admitted.record.intentHash,
      continuationToken: admitted.continuationToken!,
    }),
  ).rejects.toThrow('no longer current');
  expect(pause).not.toHaveBeenCalled();
  expect(f.supervisor.status().phase).toBe('running');
  expect(f.supervisor.journal.state.restoreStop).toBeNull();
  expect(
    JSON.parse(await readFile(join(f.root, 'restore-jobs', f.request.id, 'state.json'), 'utf8')),
  ).toEqual(admitted.record);
});

test('a concurrent pause publication makes an earlier capacity refusal generic over IPC', async () => {
  let low = false;
  const f = await admissionFixture(undefined, undefined, {}, () => ({
    device: '1',
    availableBytes: low ? 0n : 10n ** 12n,
  }));
  const admitted = await f.supervisor.admitPreparedRestore(f.request);
  const request = {
    id: f.request.id,
    intentHash: admitted.record.intentHash,
    continuationToken: admitted.continuationToken!,
  };
  low = true;
  const refusal = await f.supervisor.beginPreparedRestore(request).catch((error) => error);
  expect(refusal).toBeInstanceOf(RecoveryResourceError);
  expect(refusal.code).toBe('disk-space');
  vi.spyOn(f.supervisor, 'beginPreparedRestore').mockImplementationOnce(async () => {
    const jobs = new RestoreJobs(f.supervisor.journal);
    try {
      jobs.planPause(request.id, request.intentHash, admitted.record.revision, randomUUID());
    } finally {
      jobs.close();
    }
    throw refusal;
  });
  const sent = vi.spyOn(f.child, 'send');
  const requestId = randomUUID();
  await (
    f.supervisor as unknown as { restoreRpc(child: ChildProcess, value: object): Promise<void> }
  ).restoreRpc(f.child, {
    channel: MAINTENANCE_CHANNEL,
    kind: 'restore-begin',
    requestId,
    request,
  });
  expect(
    sent.mock.calls.find(
      ([message]) =>
        !!message &&
        typeof message === 'object' &&
        'requestId' in message &&
        message.requestId === requestId,
    )?.[0],
  ).toEqual({
    channel: MAINTENANCE_CHANNEL,
    kind: 'restore-result',
    action: 'restore-begin',
    requestId,
    error: RESTORE_RPC_ERROR,
  });
  const jobs = new RestoreJobs(f.supervisor.journal);
  try {
    expect(jobs.read(request.id)?.phase).toBe('pause-planned');
    expect(jobs.read(request.id)?.execution).toBeDefined();
  } finally {
    jobs.close();
  }
  expect(f.supervisor.journal.state.restoreJob?.jobId).toBe(request.id);
});
