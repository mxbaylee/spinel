import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { RecoveryJournal, processIdentity } from './journal.ts';
import { shareWorkspaceOwnership } from './ownership.ts';
import { restoreBarrierPath } from './restore-barrier.ts';
import { MAINTENANCE_CHANNEL } from './supervisor-client.ts';
import type { MaintenanceAdminStatus } from '../../shared/maintenance.ts';
import {
  assertRestoreTrialTarget,
  restoreTrialReference,
  validRestoreTrialPermit,
} from './restore-trial.ts';
import type { RestoreTrialPermit } from './restore-trial.ts';

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const fixturePath = fileURLToPath(new URL('./restore-trial-fixture.ts', import.meta.url));
function receive(child: ChildProcess, kind: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      child.off('message', message);
      child.off('exit', exited);
    };
    const exited = () => {
      finish();
      reject(new Error('Trial fixture exited before its response.'));
    };
    const message = (value: unknown) => {
      if (value && typeof value === 'object' && 'kind' in value && value.kind === kind) {
        finish();
        resolve(value as Record<string, unknown>);
      }
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Trial fixture response timed out.'));
    }, 20_000);
    child.on('message', message);
    child.once('exit', exited);
  });
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-trial-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'recovery'),
    data = join(directory, 'data'),
    assets = join(directory, 'assets');
  for (const path of [root, data, assets]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(assets, 'index.html'), 'Trial fixture');
  const databasePath = join(data, 'workspace.sqlite');
  const env = {
    ...process.env,
    DATABASE_PATH: databasePath,
    SPINEL_STATIC_DIR: assets,
    BACKUP_CONFIG_PATH: join(directory, 'absent-config'),
  };
  const seed = fork(fixturePath, [], {
    env: { ...env, SPINEL_TEST_TRIAL_ROLE: 'seed' },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const [seeded, [seedCode]] = await Promise.all([receive(seed, 'seeded'), once(seed, 'exit')]);
  if (seedCode !== 0 || typeof seeded.fingerprint !== 'string')
    throw new Error('Trial seed failed.');
  for (const suffix of ['', '-wal', '-shm']) await rm(databasePath + suffix, { force: true });
  await rename(databasePath + '.prepared', databasePath);
  await chmod(databasePath, 0o600);
  const bytes = await readFile(databasePath);
  const journal = await RecoveryJournal.open(root, databasePath);
  cleanups.push(() => journal.close());
  await journal.bindWorkspace();
  const ownership = journal.workspaceOwnership(),
    token = randomUUID();
  const child = fork(fixturePath, [], {
    env: { ...env, SPINEL_SUPERVISED: '1', SPINEL_PROCESS_GROUP_TOKEN: token },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  cleanups.push(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  });
  const identity = processIdentity(child.pid!, token);
  if (!identity) throw new Error('Trial process identity unavailable.');
  const permit: RestoreTrialPermit = {
    version: 1,
    jobId: randomUUID(),
    intentHash: 'b'.repeat(64),
    attemptId: randomUUID(),
    role: 'candidate',
    nonce: randomUUID(),
    child: identity,
    generationId: randomUUID(),
    epoch: randomUUID(),
    databasePath,
    identity: ownership.databaseIdentity,
    output: {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      fingerprint: seeded.fingerprint,
    },
    policy: {
      origin: 'http://localhost:3000',
      image: `sha256:${'a'.repeat(64)}`,
      spacesEnabled: true,
      staticDirectory: assets,
      consequencesVersion: 1,
    },
    maximumBytes: bytes.length + 1024 * 1024,
    deadline: Date.now() + 60_000,
  };
  const marker = restoreBarrierPath(databasePath);
  await writeFile(
    marker,
    JSON.stringify({ version: 1, operationId: permit.jobId, identity: permit.identity }) + '\n',
    { mode: 0o600 },
  );
  let state: MaintenanceAdminStatus = {
    available: true,
    phase: 'starting',
    epoch: permit.epoch,
    generationId: permit.generationId,
    operationId: permit.jobId,
    authorityExpiresAt: permit.deadline,
    notice: null,
    lastFailure: null,
    readyToResume: false,
  };
  const sendState = () =>
    child.send({ channel: MAINTENANCE_CHANNEL, kind: 'state', status: state }, () => {});
  child.on('message', (value) => {
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'hello')
      sendState();
  });
  sendState(); // Covers hello delivered while the marker write was pending.
  const ready = receive(child, 'restore-trial-ready'),
    listening = receive(child, 'listening');
  // These are transport/startup tests. The production controller must supply a
  // complete persisted-stage assertion; this fixture owns only this fixed attempt.
  const handoff = () =>
    shareWorkspaceOwnership(child, ownership, 10_000, {
      permit,
      assertCurrent() {
        expect(state.epoch).toBe(permit.epoch);
        expect(state.generationId).toBe(permit.generationId);
      },
    });
  return {
    child,
    permit,
    ready,
    listening,
    handoff,
    databasePath,
    marker,
    bytes,
    ownership,
    set(patch: Partial<MaintenanceAdminStatus>) {
      state = { ...state, ...patch };
      sendState();
    },
    async release(reference: unknown = restoreTrialReference(permit)) {
      const result = receive(child, 'restore-trial-released');
      child.send({ channel: MAINTENANCE_CHANNEL, kind: 'restore-trial-release', reference });
      return result;
    },
  };
}
async function httpStatus(url: string) {
  const response = await fetch(url);
  await response.text();
  return response.status;
}
async function start(f: Awaited<ReturnType<typeof fixture>>) {
  const [, ready, listening] = await Promise.all([f.handoff(), f.ready, f.listening]);
  expect(ready.reference).toEqual(restoreTrialReference(f.permit));
  expect(ready.fingerprint).toBe(f.permit.output.fingerprint);
  expect(listening.refusedReuse).toBe(true);
  expect(listening.refusedOrdinary).toBe(true);
  return `http://127.0.0.1:${listening.port}`;
}

test('real trial stays private until exact release after barrier cleanup, and repeated release is harmless', async () => {
  const f = await fixture(),
    origin = await start(f);
  for (const path of [
    '/',
    '/api/maintenance',
    '/api/health',
    '/api/auth/session',
    '/api/admin/maintenance',
  ]) {
    const response = await fetch(origin + path);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await response.text();
  }
  expect((await f.release()).accepted).toBe(false);
  expect(await httpStatus(origin + '/api/maintenance')).toBe(503);
  // Stand-in for the controller's already durable terminal decision/main update.
  // This tests the child boundary, not crash-safe job commitment.
  await rm(f.marker);
  f.set({ phase: 'paused' });
  expect((await f.release()).accepted).toBe(true);
  f.set({ phase: 'running' });
  expect((await f.release()).accepted).toBe(true);
  const response = await fetch(origin + '/api/maintenance');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    available: true,
    phase: 'running',
    epoch: f.permit.epoch,
    notice: null,
  });
}, 60_000);

test.each(['running', 'unavailable', 'expired'])(
  'an unexpected %s state cannot open trial HTTP or rehabilitate readiness',
  async (change) => {
    const f = await fixture(),
      origin = await start(f);
    if (change !== 'expired')
      f.set(change === 'running' ? { phase: 'running' } : { available: false });
    const pong = receive(f.child, 'fixture-pong');
    f.child.send({ kind: change === 'expired' ? 'fixture-expire' : 'fixture-ping' });
    await pong;
    expect(await httpStatus(origin + '/api/maintenance')).toBe(503);
    f.set({ available: true, phase: 'paused' });
    await rm(f.marker);
    expect((await f.release()).accepted).toBe(false);
    expect(await httpStatus(origin + '/api/maintenance')).toBe(503);
  },
  60_000,
);

test('permit validation refuses non-scalar role and a process identity that no longer exists', async () => {
  const f = await fixture();
  // Settle the real handoff before testing independent malformed bindings.
  await start(f);
  expect(validRestoreTrialPermit(f.permit)).toBe(true);
  expect(validRestoreTrialPermit({ ...f.permit, role: ['candidate'] })).toBe(false);
  const gone = { ...f.permit, child: { ...f.permit.child, pid: 2147483647 } };
  expect(() =>
    assertRestoreTrialTarget(gone, f.databasePath, f.ownership.databaseIdentity, gone.child.pid),
  ).toThrow('unavailable');
}, 60_000);

test.each(['bytes', 'policy'])(
  'a permitted handoff with mismatched %s never opens SQLite or reports health',
  async (mismatch) => {
    const f = await fixture();
    if (mismatch === 'bytes') f.permit.output.sha256 = '0'.repeat(64);
    else f.permit.policy.image = `sha256:${'c'.repeat(64)}`;
    const responses = Promise.allSettled([f.ready, f.listening]);
    const exited = once(f.child, 'exit');
    const handoff = f.handoff().catch(() => {});
    const [[code], reports] = await Promise.all([exited, responses, handoff]);
    expect(code).not.toBe(0);
    expect(reports.every((report) => report.status === 'rejected')).toBe(true);
    expect(await readFile(f.databasePath)).toEqual(f.bytes);
    for (const suffix of ['-wal', '-shm', '-journal'])
      await expect(lstat(f.databasePath + suffix)).rejects.toHaveProperty('code', 'ENOENT');
  },
  60_000,
);
