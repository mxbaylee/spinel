import { randomUUID } from 'node:crypto';
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

import { validRestoreAuthority } from './restore-authority.ts';

export const MAINTENANCE_CHANNEL = 'spinel-maintenance';

/** Private IPC, inherited only by the supervisor's fixed application child. */
export async function connectMaintenance(): Promise<MaintenanceBridge> {
  if (!process.send || process.env.SPINEL_SUPERVISED !== '1' || !process.env.DATABASE_PATH)
    throw new Error('Maintenance requires its supervised application channel.');
  let current: MaintenanceAdminStatus | undefined;
  let closed = false;
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
  const send = (message: Record<string, unknown>) => {
    if (closed || !process.connected) throw new Error('Recovery control is unavailable.');
    process.send!({ channel: MAINTENANCE_CHANNEL, ...message }, () => {});
  };
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
      status?: MaintenanceAdminStatus;
      requestId?: string;
      result?: MaintenanceControlResult;
      error?: string;
      request?: unknown;
      fingerprint?: unknown;
      authority?: unknown;
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
    } else if (message.kind === 'restore-authority') {
      const request = message.request;
      if (!validRestoreStopRequest(request)) return;
      const matches = () =>
        !closed &&
        !restoreRequest &&
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
    if (current) {
      current = { ...current, phase: 'recovery-required', readyToResume: false };
      for (const listener of listeners) listener(publicMaintenance(current));
    }
    for (const request of requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Recovery control is unavailable.'));
    }
    requests.clear();
    rejectInitial(new Error('Recovery control disconnected.'));
    // An orphan app must not keep serving against stale parent authority.
    process.kill(process.pid, 'SIGTERM');
  };
  process.on('message', onMessage);
  process.on('disconnect', onDisconnect);
  const ownership = receiveWorkspaceOwnership(process.env.DATABASE_PATH);
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
    ready: () => send({ kind: 'ready', epoch: current!.epoch }),
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
      listeners.clear();
    },
  };
}
