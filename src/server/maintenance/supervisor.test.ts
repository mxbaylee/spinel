import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import { openSync, closeSync, writeFileSync } from 'node:fs';
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
import { assertWorkspaceHandlesClosed, MaintenanceSupervisor } from './supervisor.ts';
import { processResourcesReleased } from './process-exit.ts';
import { restoreBarrierPath } from './restore-barrier.ts';
import { restoreSnapshotFingerprint } from '../backup/inventory.ts';
import { validRestoreStopRecord } from './restore-stop.ts';
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
async function seed(databasePath: string) {
  const child = fork(fileURLToPath(new URL('./seed-fixture.ts', import.meta.url)), [], {
    env: { ...process.env, DATABASE_PATH: databasePath },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error('Database seed failed.');
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-maint-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'recovery'),
    data = join(directory, 'data');
  await mkdir(root, { mode: 0o700 });
  await mkdir(data, { mode: 0o700 });
  const databasePath = join(data, 'workspace.sqlite');
  await seed(databasePath);
  const createChild = (groupToken: string, env: Record<string, string> = {}) =>
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
  return { directory, root, data, databasePath, supervisor };
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
  expect(recovered.journal.state.child).toBeNull();
  expect(() => assertWorkspaceHandlesClosed(f.databasePath)).not.toThrow();
  await recovered.close();
  const live = await acquireLiveWorkspace(hardlink),
    cold = await acquireColdWorkspace(hardlink);
  await cold();
  await live.release();
}, 10_000);

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
  const journal = await RecoveryJournal.open(root, join(directory, 'workspace.sqlite'));
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
