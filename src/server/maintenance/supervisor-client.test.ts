import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MaintenanceAdminStatus } from '../../shared/maintenance.ts';
import { connectMaintenance, MAINTENANCE_CHANNEL } from './supervisor-client.ts';
import type { SupervisedMaintenanceBridge } from './supervisor-client.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { restoreTrialReference } from './restore-trial.ts';
import type { RestoreTrialPermit } from './restore-trial.ts';
import { validRestoreTrialStopRequest } from './restore-trial-stop.ts';
import type { RestoreTrialStopRequest } from './restore-trial-stop.ts';

const boundary = vi.hoisted(() => ({
  state: undefined as MaintenanceAdminStatus | undefined,
  child: undefined as RestoreTrialPermit['child'] | undefined,
}));
vi.mock('./ownership.ts', () => ({
  receiveWorkspaceOwnership: async (_path: string, opening: (value: object) => void) => {
    opening({});
    void Promise.resolve().then(() =>
      process.emit('message', {
        channel: 'spinel-maintenance',
        kind: 'state',
        status: boundary.state,
      }),
    );
    return {};
  },
}));
vi.mock('./journal.ts', async (original) => ({
  ...(await original<typeof import('./journal.ts')>()),
  processIdentity: () => boundary.child,
}));
let bridge: SupervisedMaintenanceBridge | undefined;
let messages: Record<string, unknown>[];
let permit: RestoreTrialPermit;
const originalSend = Object.getOwnPropertyDescriptor(process, 'send');
const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected');
function message(kind: string, payload: Record<string, unknown> = {}) {
  process.emit('message', { channel: MAINTENANCE_CHANNEL, kind, ...payload });
}
function state(patch: Partial<MaintenanceAdminStatus>) {
  boundary.state = { ...boundary.state!, ...patch };
  message('state', { status: boundary.state });
}
function stop(): RestoreTrialStopRequest {
  return {
    reference: restoreTrialReference(permit),
    child: { ...permit.child },
    request: {
      jobId: permit.jobId,
      generationId: permit.generationId,
      epoch: permit.epoch,
      challengeId: randomUUID(),
      deadline: Date.now() + 1000,
    },
  };
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  const intent = restoreJobIntentFixture();
  permit = {
    version: 1,
    jobId: intent.id,
    intentHash: 'a'.repeat(64),
    attemptId: randomUUID(),
    nonce: randomUUID(),
    role: 'candidate',
    child: {
      pid: process.pid,
      start: '1',
      boot: randomUUID(),
      token: randomUUID(),
    },
    generationId: randomUUID(),
    epoch: randomUUID(),
    databasePath: intent.target.databasePath,
    identity: intent.target.identity,
    output: { bytes: 4096, sha256: 'b'.repeat(64), fingerprint: 'c'.repeat(64) },
    policy: intent.policy,
    maximumBytes: 8192,
    deadline: Date.now() + 60_000,
  };
  boundary.child = permit.child;
  boundary.state = {
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
  vi.stubEnv('SPINEL_SUPERVISED', '1');
  vi.stubEnv('DATABASE_PATH', permit.databasePath);
  vi.stubEnv('SPINEL_PROCESS_GROUP_TOKEN', permit.child.token);
  messages = [];
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  Object.defineProperty(process, 'send', {
    configurable: true,
    value: (value: Record<string, unknown>) => {
      messages.push(value);
      return true;
    },
  });
  bridge = await connectMaintenance();
});
afterEach(() => {
  bridge?.close();
  bridge = undefined;
  if (originalSend) Object.defineProperty(process, 'send', originalSend);
  else delete process.send;
  if (originalConnected) Object.defineProperty(process, 'connected', originalConnected);
  else delete (process as Partial<NodeJS.Process>).connected;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('failed trial shutdown works before readiness after permit expiry, with only matching durable ACK', async () => {
  let completion: Promise<void> | undefined;
  const listener = vi.fn((request: RestoreTrialStopRequest) => {
    completion = bridge!.acceptRestoreTrialWitness(request, 'd'.repeat(64));
    return completion;
  });
  bridge!.onRestoreTrialStop(permit, listener);
  const release = vi.fn();
  bridge!.onRestoreTrialRelease(release);
  vi.setSystemTime(permit.deadline + 1);
  state({ phase: 'stopping' });
  const request = stop();
  message('restore-trial-stop', { stop: request });
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(messages.at(-1)).toMatchObject({
    kind: 'restore-trial-witness',
    stop: request,
    fingerprint: 'd'.repeat(64),
  });
  let settled = false;
  void completion!.then(() => {
    settled = true;
  });
  message('restore-trial-stop', { stop: request });
  message('restore-trial-witness-ack', {
    stop: { ...request, reference: { ...request.reference, nonce: randomUUID() } },
    fingerprint: 'd'.repeat(64),
  });
  message('restore-trial-witness-ack', { stop: request, fingerprint: 'e'.repeat(64) });
  message('restore-trial-release', { reference: request.reference });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(release).not.toHaveBeenCalled();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(() => bridge!.restoreTrialReady(permit)).toThrow();
  message('restore-trial-witness-ack', { stop: request, fingerprint: 'd'.repeat(64) });
  await completion;
  expect(settled).toBe(true);
});

test('cross-attempt, child, role, operation, state and excessive deadline challenges cannot begin shutdown', async () => {
  const listener = vi.fn(async () => {});
  bridge!.onRestoreTrialStop(permit, listener);
  state({ phase: 'stopping' });
  const request = stop();
  for (const changed of [
    { ...request, child: { ...request.child, start: '2' } },
    { ...request, child: { ...request.child, pid: process.pid + 1 } },
    { ...request, reference: { ...request.reference, attemptId: randomUUID() } },
    { ...request, reference: { ...request.reference, role: 'original' } },
    { ...request, request: { ...request.request, deadline: Date.now() + 30_001 } },
    { ...request, request: { ...request.request, deadline: Date.now() } },
  ])
    message('restore-trial-stop', { stop: changed });
  state({ operationId: randomUUID() });
  message('restore-trial-stop', { stop: request });
  state({ operationId: permit.jobId, phase: 'running' });
  message('restore-trial-stop', { stop: request });
  state({ phase: 'stopping', available: false });
  message('restore-trial-stop', { stop: request });
  await Promise.resolve();
  expect(listener).not.toHaveBeenCalled();
  state({ available: true, phase: 'recovery-required' });
  message('restore-trial-stop', { stop: request });
  await Promise.resolve();
  expect(listener).toHaveBeenCalledExactlyOnceWith(request);
});

test.each(['expired', 'timeout', 'state-changed', 'disconnect', 'close'] as const)(
  'trial witness refuses %s ACK without extending collection authority',
  async (failure) => {
    let completion: Promise<void> | undefined;
    bridge!.onRestoreTrialStop(permit, (request) => {
      completion = bridge!.acceptRestoreTrialWitness(request, 'd'.repeat(64));
      return completion;
    });
    state({ phase: 'stopping' });
    const request = stop();
    message('restore-trial-stop', { stop: request });
    await Promise.resolve();
    const rejected = expect(completion).rejects.toThrow('not acknowledged');
    if (failure === 'expired') vi.setSystemTime(request.request.deadline);
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(1000);
    if (failure === 'state-changed') state({ epoch: randomUUID() });
    if (failure === 'disconnect') {
      vi.spyOn(process, 'kill').mockReturnValue(true);
      process.emit('disconnect');
    } else if (failure === 'close') bridge!.close();
    else message('restore-trial-witness-ack', { stop: request, fingerprint: 'd'.repeat(64) });
    await rejected;
  },
);

test('trial stop has a closed schema and refuses mismatched request/reference binding', () => {
  const request = stop();
  expect(validRestoreTrialStopRequest(request)).toBe(true);
  for (const value of [
    { ...request, extra: true },
    { ...request, child: { ...request.child, extra: true } },
    { ...request, reference: { ...request.reference, extra: true } },
    { ...request, request: { ...request.request, jobId: randomUUID() } },
    { ...request, request: { ...request.request, epoch: randomUUID() } },
    { ...request, request: { ...request.request, generationId: randomUUID() } },
  ])
    expect(validRestoreTrialStopRequest(value)).toBe(false);
});

test('a committed released trial can later use ordinary restore authority and shutdown', async () => {
  const failedStop = vi.fn(async () => {}),
    ordinaryStop = vi.fn(async () => {}),
    authority = vi.fn();
  bridge!.onRestoreTrialStop(permit, failedStop);
  bridge!.onRestoreTrialRelease(() => {});
  bridge!.onRestoreAuthority!(authority);
  bridge!.onRestoreStop!(ordinaryStop);
  message('restore-trial-release', { reference: restoreTrialReference(permit) });
  expect(messages.at(-1)).toMatchObject({ kind: 'restore-trial-released', accepted: true });
  state({ phase: 'running' });
  const request = { ...stop().request, jobId: randomUUID() };
  message('restore-authority', { request, authority: restoreJobIntentFixture().authority });
  expect(authority).toHaveBeenCalledTimes(1);
  expect(messages.at(-1)).toMatchObject({ kind: 'restore-authority-result', accepted: true });
  state({ phase: 'stopping', operationId: request.jobId });
  message('restore-stop', { request });
  await Promise.resolve();
  expect(ordinaryStop).toHaveBeenCalledExactlyOnceWith(request);
  expect(failedStop).not.toHaveBeenCalled();
});
