import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MaintenanceAdminStatus } from '../../shared/maintenance.ts';
import { connectMaintenance, MAINTENANCE_CHANNEL } from './supervisor-client.ts';
import type { SupervisedMaintenanceBridge } from './supervisor-client.ts';
import { restoreJobIntentFixture } from './restore-job-fixture.ts';
import { restoreTrialReference } from './restore-trial.ts';
import type { RestoreTrialPermit } from './restore-trial.ts';
import { validRestoreTrialStopRequest } from './restore-trial-stop.ts';
import type { RestoreTrialStopRequest } from './restore-trial-stop.ts';
import { restoreIntentHash } from './restore-job-intent.ts';
import { RESTORE_RPC_ERROR, RESTORE_RPC_MS, RESTORE_RPC_PENDING } from './restore-rpc.ts';
import type { ConfirmedRestoreAdmission } from '../backup/restore-control.ts';

const boundary = vi.hoisted(() => ({
  trial: true,
  state: undefined as MaintenanceAdminStatus | undefined,
  child: undefined as RestoreTrialPermit['child'] | undefined,
}));
vi.mock('./ownership.ts', () => ({
  receiveWorkspaceOwnership: async (_path: string, opening: (value: object) => void) => {
    if (boundary.trial) opening({});
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
  boundary.trial = true;
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

async function ordinaryController() {
  bridge!.close();
  boundary.trial = false;
  bridge = await connectMaintenance();
  state({ phase: 'running', operationId: null, authorityExpiresAt: null });
  return bridge.restoreController;
}
function admission() {
  const intent = restoreJobIntentFixture();
  intent.target.generationId = permit.generationId;
  intent.target.epoch = permit.epoch;
  const continuationToken = 'T'.repeat(43);
  intent.continuationHash = createHash('sha256').update(continuationToken).digest('hex');
  const request: ConfirmedRestoreAdmission = {
    id: intent.id,
    generationId: intent.target.generationId,
    epoch: intent.target.epoch,
    authority: intent.authority,
    confirmedAt: intent.confirmedAt,
    preview: intent.preview,
    consequenceEnvelope: 1,
    previewDatabaseBytes: 8192,
    source: {
      archive: { ...intent.source.archive, path: '/srv/private/archive.spinel' },
      databasePath: '/srv/private/prepared.sqlite',
      databaseBytes: intent.source.candidate.bytes,
      databaseSha256: intent.source.candidate.sha256,
      recovery: intent.source.recovery,
    },
  };
  return {
    request,
    result: {
      record: {
        version: 1,
        revision: 1,
        phase: 'source-retained',
        intent,
        intentHash: restoreIntentHash(intent),
        updatedAt: intent.confirmedAt,
      },
      custody: true,
      continuationToken,
    },
  };
}

test('private trial cannot obtain a running restore target or admit another source', async () => {
  const { request } = admission();
  expect(() => bridge!.restoreController.target()).toThrow(RESTORE_RPC_ERROR);
  await expect(bridge!.restoreController.admit(request)).rejects.toThrow(RESTORE_RPC_ERROR);
  await expect(bridge!.restoreController.estimate(capacityRequest())).rejects.toThrow(
    RESTORE_RPC_ERROR,
  );
  expect(
    messages.some((item) => item.kind === 'restore-admit' || item.kind === 'restore-estimate'),
  ).toBe(false);
});

test('custody RPC requires its correlated action and validated original record before resolving', async () => {
  const controller = await ordinaryController();
  const { request, result } = admission();
  expect(controller.target()).toEqual({ generationId: permit.generationId, epoch: permit.epoch });
  const pending = controller.admit(request);
  const frame = messages.at(-1)!;
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  message('restore-result', { action: 'restore-admit', requestId: randomUUID(), result });
  message('restore-result', { action: 'restore-begin', requestId: frame.requestId, result });
  await Promise.resolve();
  expect(settled).toBe(false);
  message('restore-result', { action: frame.kind, requestId: frame.requestId, result });
  await expect(pending).resolves.toEqual(result);
  // A late duplicate cannot dispatch a separate begin or replace the settled ACK.
  message('restore-result', { action: frame.kind, requestId: frame.requestId, result });
  expect(messages.filter((item) => item.kind === 'restore-admit')).toHaveLength(1);
  expect(messages.some((item) => item.kind === 'restore-begin')).toBe(false);
});

test.each(['record', 'token', 'error'])(
  'invalid %s reply cannot establish source custody',
  async (fault) => {
    const controller = await ordinaryController();
    const { request, result } = admission();
    const pending = controller.admit(request),
      frame = messages.at(-1)!;
    if (fault === 'record') result.record.intent.id = randomUUID();
    if (fault === 'token') result.continuationToken = 'U'.repeat(43);
    message('restore-result', {
      action: frame.kind,
      requestId: frame.requestId,
      result,
      ...(fault === 'error' ? { error: '/private/archive/key must not escape' } : {}),
    });
    await expect(pending).rejects.toThrow(RESTORE_RPC_ERROR);
  },
);

test('restore transport bounds pending work and rejects every unacknowledged request on timeout or close', async () => {
  const controller = await ordinaryController(),
    { request } = admission();
  const pending = Array.from({ length: RESTORE_RPC_PENDING }, () =>
    controller.admit(request).catch((error: Error) => error.message),
  );
  await expect(controller.admit(request)).rejects.toThrow(RESTORE_RPC_ERROR);
  expect(messages.filter((item) => item.kind === 'restore-admit')).toHaveLength(
    RESTORE_RPC_PENDING,
  );
  await vi.advanceTimersByTimeAsync(RESTORE_RPC_MS);
  expect(await Promise.all(pending)).toEqual(Array(RESTORE_RPC_PENDING).fill(RESTORE_RPC_ERROR));
  const closing = controller.admit(request);
  bridge!.close();
  await expect(closing).rejects.toThrow(RESTORE_RPC_ERROR);
});

test('observation distinguishes validated absence from an expired historical record without issuing mutations', async () => {
  const controller = await ordinaryController();
  const target = controller.target();
  let pending = controller.observe({});
  let frame = messages.at(-1)!;
  const absent = { target, record: null, pending: false };
  message('restore-result', { action: frame.kind, requestId: frame.requestId, result: absent });
  await expect(pending).resolves.toEqual(absent);
  const { result } = admission();
  result.record.phase = 'failed';
  vi.setSystemTime(result.record.intent.authority.expiresAt + 1);
  pending = controller.observe({ id: result.record.intent.id });
  frame = messages.at(-1)!;
  const historical = { target, record: result.record, pending: false };
  message('restore-result', { action: frame.kind, requestId: frame.requestId, result: historical });
  await expect(pending).resolves.toEqual(historical);
  expect(
    messages.some((item) => ['restore-admit', 'restore-begin'].includes(String(item.kind))),
  ).toBe(false);
});

test.each(['wrong-id', 'incomplete', 'stale-target', 'stopped'])(
  'observation rejects %s instead of reporting no pending restore',
  async (fault) => {
    const controller = await ordinaryController();
    const { result } = admission();
    const target = controller.target();
    const pending = controller.observe({ id: randomUUID() });
    const frame = messages.at(-1)!;
    if (fault === 'stale-target') state({ epoch: randomUUID() });
    if (fault === 'stopped') state({ phase: 'paused' });
    const observation = {
      target,
      record: fault === 'wrong-id' ? result.record : null,
      ...(fault === 'incomplete' ? {} : { pending: false }),
    };
    message('restore-result', {
      action: frame.kind,
      requestId: frame.requestId,
      result: observation,
    });
    await expect(pending).rejects.toThrow(RESTORE_RPC_ERROR);
  },
);

test('observation timeout remains unknown and cannot hang a status request for the admission budget', async () => {
  const controller = await ordinaryController();
  const pending = controller.observe({}).catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await pending).toBe(RESTORE_RPC_ERROR);
});

function capacityReply() {
  return {
    target: { generationId: permit.generationId, epoch: permit.epoch },
    resources: {
      provisional: true as const,
      checkedAt: Date.now(),
      requiredAdditionalBytes: 300_000_000,
      availableBytes: 500_000_000,
      sufficient: true,
      filesystems: [
        {
          purposes: ['application', 'preparation', 'recovery'] as Array<
            'application' | 'preparation' | 'recovery'
          >,
          requiredAdditionalBytes: 300_000_000,
          availableBytes: 500_000_000,
          sufficient: true,
        },
      ],
    },
  };
}
const capacityRequest = () => ({
  generationId: permit.generationId,
  epoch: permit.epoch,
  archiveBytes: 100,
  databaseBytes: 4096,
  previewDatabaseBytes: 8192,
});

test('capacity RPC returns only correlated path-free current-generation estimates without an admission', async () => {
  const controller = await ordinaryController();
  const pending = controller.estimate(capacityRequest()),
    frame = messages.at(-1)!;
  expect(frame.kind).toBe('restore-estimate');
  const result = capacityReply();
  message('restore-result', { action: 'restore-observe', requestId: frame.requestId, result });
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  message('restore-result', { action: frame.kind, requestId: frame.requestId, result });
  await expect(pending).resolves.toEqual(result);
  expect(
    messages.some((value) => value.kind === 'restore-admit' || value.kind === 'restore-begin'),
  ).toBe(false);
});

test.each(['stale-target', 'private-path', 'unsafe-number', 'missing-scope', 'closed-state'])(
  'capacity RPC refuses %s evidence',
  async (fault) => {
    const controller = await ordinaryController();
    const pending = controller.estimate(capacityRequest()),
      frame = messages.at(-1)!;
    const result = capacityReply();
    if (fault === 'stale-target') result.target.epoch = randomUUID();
    if (fault === 'private-path')
      Object.assign(result.resources.filesystems[0], { path: '/private/recovery' });
    if (fault === 'unsafe-number') result.resources.availableBytes = Number.MAX_SAFE_INTEGER + 1;
    if (fault === 'missing-scope') result.resources.filesystems[0].purposes = ['application'];
    if (fault === 'closed-state') state({ phase: 'draining' });
    message('restore-result', { action: frame.kind, requestId: frame.requestId, result });
    await expect(pending).rejects.toThrow(RESTORE_RPC_ERROR);
  },
);
