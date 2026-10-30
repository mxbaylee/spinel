import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { processIdentity } from './journal.ts';
import {
  matchesRestoreTrialStop,
  RESTORE_TRIAL_STOP_MS,
  sameRestoreTrialStopRequest,
  validRestoreTrialStopRequest,
} from './restore-trial-stop.ts';
import type { RestoreTrialStopRequest } from './restore-trial-stop.ts';
import type {
  MaintenanceAdminStatus,
  MaintenanceBridge,
  MaintenanceCommand,
  MaintenanceControlResult,
  MaintenancePublicStatus,
  RestoreStopRequest,
  RestoreAuthority,
} from '../../shared/maintenance.ts';
import { publicMaintenance } from '../../shared/maintenance.ts';
import { receiveWorkspaceOwnership } from './ownership.ts';
import {
  sameRestoreStopRequest,
  validRestoreFingerprint,
  validRestoreStopRequest,
} from './restore-stop.ts';

import {
  restoreTrialReference,
  sameRestoreTrialReference,
  validRestoreTrialPermit,
} from './restore-trial.ts';
import type { RestoreOpening, RestoreTrialPermit, RestoreTrialRelease } from './restore-trial.ts';

import { validRestoreAuthority } from './restore-authority.ts';
import type { RestoreController } from '../backup/restore-control.ts';
import {
  boundedRestoreRpc,
  RESTORE_RPC_ERROR,
  RESTORE_RPC_MS,
  RESTORE_RPC_PENDING,
  validRestoreRpcResult,
} from './restore-rpc.ts';
import type { RestoreRpcAction, RestoreRpcResult } from './restore-rpc.ts';

export const MAINTENANCE_CHANNEL = 'spinel-maintenance';

export interface SupervisedMaintenanceBridge extends MaintenanceBridge {
  readonly restoreController: RestoreController;
  takeRestoreOpening(): RestoreOpening | undefined;
  onRestoreTrialStop(
    permit: RestoreTrialPermit,
    listener: (stop: RestoreTrialStopRequest) => Promise<void>,
  ): void;
  acceptRestoreTrialWitness(stop: RestoreTrialStopRequest, fingerprint: string): Promise<void>;
  restoreTrialReady(permit: RestoreTrialPermit): void;
  onRestoreTrialRelease(listener: (reference: RestoreTrialRelease) => void): void;
}

/** Private IPC, inherited only by the supervisor's fixed application child. */
export async function connectMaintenance(): Promise<SupervisedMaintenanceBridge> {
  if (!process.send || process.env.SPINEL_SUPERVISED !== '1' || !process.env.DATABASE_PATH)
    throw new Error('Maintenance requires its supervised application channel.');
  let current: MaintenanceAdminStatus | undefined;
  let closed = false;
  let opening: RestoreOpening | undefined;
  let trialExpected = false;
  let trial: RestoreTrialPermit | undefined;
  let releaseListener: ((reference: RestoreTrialRelease) => void) | undefined;
  let released = false;
  let trialReady = false;
  let trialStopListener: ((stop: RestoreTrialStopRequest) => Promise<void>) | undefined;
  let trialStop: RestoreTrialStopRequest | undefined;
  let trialWitnessWaiter: typeof witnessWaiter;
  const failTrialWitness = () => {
    if (!trialWitnessWaiter) return;
    clearTimeout(trialWitnessWaiter.timer);
    trialWitnessWaiter.reject(new Error('The final trial witness was not acknowledged.'));
    trialWitnessWaiter = undefined;
  };
  const trialStopCurrent = (stop: RestoreTrialStopRequest) =>
    !closed &&
    !released &&
    !!trial &&
    matchesRestoreTrialStop(stop, trial) &&
    !!current?.available &&
    ['stopping', 'recovery-required'].includes(current.phase) &&
    current.operationId === stop.request.jobId &&
    current.epoch === stop.request.epoch &&
    current.generationId === stop.request.generationId &&
    Date.now() < stop.request.deadline;
  const bindTrial = (permit: RestoreTrialPermit) => {
    if (
      closed ||
      !trialExpected ||
      trialStop ||
      released ||
      !validRestoreTrialPermit(permit) ||
      permit.child.pid !== process.pid ||
      !isDeepStrictEqual(processIdentity(process.pid, permit.child.token), permit.child) ||
      process.env.SPINEL_PROCESS_GROUP_TOKEN !== permit.child.token ||
      !current?.available ||
      !['starting', 'paused'].includes(current.phase) ||
      current.operationId !== permit.jobId ||
      current.epoch !== permit.epoch ||
      current.generationId !== permit.generationId ||
      Date.now() >= permit.deadline ||
      (trial && !isDeepStrictEqual(trial, permit))
    )
      throw new Error('Restore trial has no matching application binding.');
    trial ??= structuredClone(permit);
  };
  let restoreListener: ((request: RestoreStopRequest) => Promise<void>) | undefined;
  let authorityListener: ((proof: RestoreAuthority) => void) | undefined;
  let restoreRequest: RestoreStopRequest | undefined;
  let witnessWaiter:
    | {
        fingerprint: string;
        resolve(): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  const failWitness = () => {
    if (!witnessWaiter) return;
    clearTimeout(witnessWaiter.timer);
    witnessWaiter.reject(new Error('The final restore witness was not acknowledged.'));
    witnessWaiter = undefined;
  };
  const listeners = new Set<(status: MaintenancePublicStatus) => void>();
  const requests = new Map<
    string,
    {
      resolve: (result: MaintenanceControlResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const restoreRequests = new Map<
    string,
    {
      action: RestoreRpcAction;
      id?: string;
      intentHash?: string;
      resolve(result: RestoreRpcResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const failRestoreRequest = (requestId: string) => {
    const request = restoreRequests.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    restoreRequests.delete(requestId);
    request.reject(new Error(RESTORE_RPC_ERROR));
  };
  const send = (message: Record<string, unknown>, onError?: () => void) => {
    if (closed || !process.connected) throw new Error('Recovery control is unavailable.');
    process.send!({ channel: MAINTENANCE_CHANNEL, ...message }, (error) => {
      if (error) onError?.();
    });
  };
  const restoreCall = (
    action: RestoreRpcAction,
    request:
      | Parameters<RestoreController['admit']>[0]
      | Parameters<RestoreController['begin']>[0]
      | Parameters<RestoreController['observe']>[0]
      | Parameters<RestoreController['estimate']>[0],
  ) =>
    new Promise<RestoreRpcResult>((resolve, reject) => {
      if (
        closed ||
        !current?.available ||
        (trialExpected && !released) ||
        (action !== 'restore-begin' && current.phase !== 'running') ||
        restoreRequests.size >= RESTORE_RPC_PENDING ||
        !boundedRestoreRpc(request)
      ) {
        reject(new Error(RESTORE_RPC_ERROR));
        return;
      }
      const requestId = randomUUID();
      const timer = setTimeout(
        () => failRestoreRequest(requestId),
        action === 'restore-observe' || action === 'restore-estimate' ? 10_000 : RESTORE_RPC_MS,
      );
      restoreRequests.set(requestId, {
        action,
        id: 'id' in request ? request.id : undefined,
        intentHash: 'intentHash' in request ? request.intentHash : undefined,
        resolve,
        reject,
        timer,
      });
      try {
        send({ kind: action, requestId, request }, () => failRestoreRequest(requestId));
      } catch {
        failRestoreRequest(requestId);
      }
    });
  let resolveInitial!: () => void, rejectInitial!: (error: Error) => void;
  const initial = new Promise<void>((resolve, reject) => {
    resolveInitial = resolve;
    rejectInitial = reject;
  });
  const initialTimeout = setTimeout(
    () => rejectInitial(new Error('Recovery control did not initialize.')),
    10_000,
  );
  const onMessage = (value: unknown) => {
    if (
      closed ||
      !value ||
      typeof value !== 'object' ||
      (value as { channel?: unknown }).channel !== MAINTENANCE_CHANNEL
    )
      return;
    const message = value as {
      kind?: string;
      action?: RestoreRpcAction;
      status?: MaintenanceAdminStatus;
      requestId?: string;
      result?: MaintenanceControlResult;
      error?: string;
      request?: unknown;
      fingerprint?: unknown;
      authority?: unknown;
      reference?: unknown;
      stop?: unknown;
    };
    if (message.kind === 'state' && message.status) {
      current = message.status;
      if (
        current.phase === 'starting' ||
        current.phase === 'paused' ||
        current.phase === 'running'
      ) {
        clearTimeout(initialTimeout);
        resolveInitial();
      }
      for (const listener of listeners) listener(publicMaintenance(current));
    } else if (message.kind === 'restore-trial-release') {
      if (!trial || !sameRestoreTrialReference(message.reference, trial)) return;
      let accepted = false;
      try {
        if (
          trialStop ||
          !releaseListener ||
          !current?.available ||
          current.epoch !== trial.epoch ||
          current.generationId !== trial.generationId ||
          (!released &&
            (!['starting', 'paused'].includes(current.phase) || Date.now() >= trial.deadline))
        )
          throw new Error('Restore release binding changed.');
        releaseListener(message.reference);
        released = true;
        accepted = true;
      } catch {
        /* A rejected release keeps the independent application latch closed. */
      }
      send({ kind: 'restore-trial-released', reference: restoreTrialReference(trial), accepted });
    } else if (message.kind === 'restore-trial-stop') {
      const stop = message.stop;
      if (!validRestoreTrialStopRequest(stop)) return;
      if (trialStop && sameRestoreTrialStopRequest(stop, trialStop)) return;
      if (
        trialStop ||
        restoreRequest ||
        !trialStopListener ||
        !trialStopCurrent(stop) ||
        stop.request.deadline - Date.now() > RESTORE_TRIAL_STOP_MS
      ) {
        try {
          send({ kind: 'restore-trial-stop-refused', stop });
        } catch {
          /* Parent disconnected. */
        }
        return;
      }
      trialStop = structuredClone(stop);
      void Promise.resolve()
        .then(() => {
          if (!trialStopCurrent(trialStop!)) throw new Error('Trial shutdown binding changed.');
          return trialStopListener!(structuredClone(trialStop!));
        })
        .catch(() => {
          try {
            send({ kind: 'restore-trial-stop-refused', stop });
          } catch {
            /* Parent disconnected. */
          }
        });
    } else if (
      message.kind === 'restore-trial-witness-ack' &&
      trialStop &&
      trialWitnessWaiter &&
      validRestoreTrialStopRequest(message.stop) &&
      sameRestoreTrialStopRequest(message.stop, trialStop) &&
      message.fingerprint === trialWitnessWaiter.fingerprint
    ) {
      if (!trialStopCurrent(trialStop)) {
        failTrialWitness();
        return;
      }
      clearTimeout(trialWitnessWaiter.timer);
      trialWitnessWaiter.resolve();
      trialWitnessWaiter = undefined;
    } else if (message.kind === 'restore-authority') {
      const request = message.request;
      if (!validRestoreStopRequest(request)) return;
      const matches = () =>
        !closed &&
        !restoreRequest &&
        (!trialExpected || released) &&
        !!current &&
        current.phase === 'running' &&
        current.epoch === request.epoch &&
        current.generationId === request.generationId &&
        Date.now() < request.deadline;
      let accepted = false;
      try {
        if (matches() && authorityListener && validRestoreAuthority(message.authority)) {
          authorityListener(message.authority);
          // The synchronous database read may cross the challenge deadline.
          accepted = matches();
        }
      } catch {
        /* Only a boolean crosses IPC; never expose account or SQL details. */
      }
      try {
        send({ kind: 'restore-authority-result', request, accepted });
      } catch {
        /* A disconnected parent cannot admit this restore. */
      }
    } else if (message.kind === 'restore-stop') {
      const request = message.request;
      if (!validRestoreStopRequest(request)) return;
      if (restoreRequest && sameRestoreStopRequest(request, restoreRequest)) return;
      if (
        restoreRequest ||
        (trialExpected && !released) ||
        !restoreListener ||
        !current ||
        current.phase !== 'stopping' ||
        current.epoch !== request.epoch ||
        current.generationId !== request.generationId ||
        current.operationId !== request.jobId ||
        Date.now() >= request.deadline
      ) {
        try {
          send({ kind: 'restore-stop-refused', request });
        } catch {
          /* Disconnect closes admission. */
        }
        return;
      }
      restoreRequest = request;
      void Promise.resolve()
        .then(() => restoreListener!(request))
        .catch(() => {
          if (!closed && process.connected) {
            try {
              send({ kind: 'restore-stop-refused', request });
            } catch {
              /* Disconnect closes admission. */
            }
          }
        });
    } else if (
      message.kind === 'restore-witness-ack' &&
      restoreRequest &&
      witnessWaiter &&
      validRestoreStopRequest(message.request) &&
      sameRestoreStopRequest(message.request, restoreRequest) &&
      message.fingerprint === witnessWaiter.fingerprint
    ) {
      if (
        !current ||
        current.phase !== 'stopping' ||
        current.epoch !== restoreRequest.epoch ||
        current.generationId !== restoreRequest.generationId ||
        Date.now() >= restoreRequest.deadline
      ) {
        failWitness();
        return;
      }
      clearTimeout(witnessWaiter.timer);
      witnessWaiter.resolve();
      witnessWaiter = undefined;
    } else if (message.kind === 'restore-result' && typeof message.requestId === 'string') {
      const request = restoreRequests.get(message.requestId);
      if (!request || message.action !== request.action) return;
      if (
        message.error !== undefined ||
        !validRestoreRpcResult(message.result, request.action, request.id, request.intentHash)
      ) {
        failRestoreRequest(message.requestId);
        return;
      }
      if (
        'target' in message.result &&
        (!current?.available ||
          current.phase !== 'running' ||
          (trialExpected && !released) ||
          message.result.target.generationId !== current.generationId ||
          message.result.target.epoch !== current.epoch)
      ) {
        failRestoreRequest(message.requestId);
        return;
      }
      clearTimeout(request.timer);
      restoreRequests.delete(message.requestId);
      request.resolve(message.result);
    } else if (message.kind === 'result' && typeof message.requestId === 'string') {
      const request = requests.get(message.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      requests.delete(message.requestId);
      if (message.result) request.resolve(message.result);
      else
        request.reject(
          new Error(message.error ?? 'Recovery control could not complete this operation.'),
        );
    }
  };
  const onDisconnect = () => {
    if (closed) return;
    failWitness();
    failTrialWitness();
    if (current) {
      current = { ...current, phase: 'recovery-required', readyToResume: false };
      for (const listener of listeners) listener(publicMaintenance(current));
    }
    for (const request of requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Recovery control is unavailable.'));
    }
    requests.clear();
    for (const id of restoreRequests.keys()) failRestoreRequest(id);
    rejectInitial(new Error('Recovery control disconnected.'));
    // An orphan app must not keep serving against stale parent authority.
    process.kill(process.pid, 'SIGTERM');
  };
  process.on('message', onMessage);
  process.on('disconnect', onDisconnect);
  const ownership = receiveWorkspaceOwnership(process.env.DATABASE_PATH, (capability) => {
    opening = capability;
    trialExpected = true;
  });
  send({ kind: 'hello' });
  try {
    await Promise.all([initial, ownership]);
  } catch (error) {
    clearTimeout(initialTimeout);
    process.off('message', onMessage);
    process.off('disconnect', onDisconnect);
    throw error;
  }
  return {
    restoreController: {
      async estimate(request) {
        const result = await restoreCall('restore-estimate', request);
        if (!('resources' in result)) throw new Error(RESTORE_RPC_ERROR);
        return result;
      },
      target() {
        if (
          closed ||
          !current?.available ||
          current.phase !== 'running' ||
          (trialExpected && !released)
        )
          throw new Error(RESTORE_RPC_ERROR);
        return { generationId: current.generationId, epoch: current.epoch };
      },
      async admit(request) {
        const result = await restoreCall('restore-admit', request);
        if (!('custody' in result)) throw new Error(RESTORE_RPC_ERROR);
        return result;
      },
      async begin(request) {
        const result = await restoreCall('restore-begin', request);
        if ('target' in result || !result.record) throw new Error(RESTORE_RPC_ERROR);
        return { record: result.record };
      },
      async observe(request) {
        const result = await restoreCall('restore-observe', request);
        if (!('pending' in result)) throw new Error(RESTORE_RPC_ERROR);
        return result;
      },
    },
    takeRestoreOpening() {
      const result = opening;
      opening = undefined;
      return result;
    },
    onRestoreTrialStop(permit, listener) {
      if (trialStopListener) throw new Error('Trial shutdown is already registered.');
      bindTrial(permit);
      trialStopListener = listener;
    },
    acceptRestoreTrialWitness(stop, fingerprint) {
      if (
        !trialStop ||
        !validRestoreTrialStopRequest(stop) ||
        !sameRestoreTrialStopRequest(stop, trialStop) ||
        !trialStopCurrent(stop) ||
        !validRestoreFingerprint(fingerprint) ||
        trialWitnessWaiter
      )
        return Promise.reject(new Error('The final trial witness has no current challenge.'));
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          failTrialWitness,
          Math.max(1, Math.min(RESTORE_TRIAL_STOP_MS, stop.request.deadline - Date.now())),
        );
        trialWitnessWaiter = { fingerprint, resolve, reject, timer };
        try {
          send({ kind: 'restore-trial-witness', stop: structuredClone(trialStop), fingerprint });
        } catch {
          failTrialWitness();
        }
      });
    },
    restoreTrialReady(permit) {
      if (trialReady) throw new Error('Restore readiness was already reported.');
      bindTrial(permit);
      trialReady = true;
      send({
        kind: 'restore-trial-ready',
        reference: restoreTrialReference(trial!),
        fingerprint: trial!.output.fingerprint,
      });
    },
    onRestoreTrialRelease(listener) {
      if (closed || !trialExpected || releaseListener)
        throw new Error('Restore release listener is unavailable.');
      releaseListener = listener;
    },
    status: () => publicMaintenance(current!),
    adminStatus: () => structuredClone(current!),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    control(command: MaintenanceCommand) {
      return new Promise<MaintenanceControlResult>((resolve, reject) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => {
          requests.delete(requestId);
          reject(new Error('Recovery control did not finish. Refresh its status before retrying.'));
        }, 45_000);
        requests.set(requestId, { resolve, reject, timer });
        try {
          send({ kind: 'command', requestId, command });
        } catch (error) {
          clearTimeout(timer);
          requests.delete(requestId);
          reject(error);
        }
      });
    },
    ready: () => {
      if (trialExpected) throw new Error('A restore trial cannot report ordinary readiness.');
      send({ kind: 'ready', epoch: current!.epoch });
    },
    drained: (epoch) => {
      if (!closed && process.connected) send({ kind: 'drained', epoch });
    },
    onRestoreAuthority(listener) {
      if (authorityListener || closed) throw new Error('Restore authority is already registered.');
      authorityListener = listener;
    },
    onRestoreStop(listener) {
      if (restoreListener || closed) throw new Error('Restore shutdown is already registered.');
      restoreListener = listener;
    },
    acceptRestoreWitness(request, fingerprint) {
      if (
        closed ||
        !restoreRequest ||
        !sameRestoreStopRequest(request, restoreRequest) ||
        !validRestoreFingerprint(fingerprint) ||
        witnessWaiter ||
        !current ||
        current.phase !== 'stopping' ||
        current.epoch !== request.epoch ||
        current.generationId !== request.generationId ||
        Date.now() >= request.deadline
      )
        return Promise.reject(new Error('The final restore witness has no current challenge.'));
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          failWitness,
          Math.max(1, Math.min(30_000, request.deadline - Date.now())),
        );
        witnessWaiter = { fingerprint, resolve, reject, timer };
        try {
          send({ kind: 'restore-witness', request, fingerprint });
        } catch {
          failWitness();
        }
      });
    },
    fail: (reason) => {
      if (!closed && process.connected) send({ kind: 'failure', reason });
    },
    close() {
      closed = true;
      failWitness();
      failTrialWitness();
      trialStopListener = undefined;
      restoreListener = undefined;
      authorityListener = undefined;
      clearTimeout(initialTimeout);
      process.off('message', onMessage);
      process.off('disconnect', onDisconnect);
      for (const request of requests.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Application is stopping.'));
      }
      requests.clear();
      for (const id of restoreRequests.keys()) failRestoreRequest(id);
      listeners.clear();
    },
  };
}
