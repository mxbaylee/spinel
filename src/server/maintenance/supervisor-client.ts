import { randomUUID } from 'node:crypto';
import type {
  MaintenanceAdminStatus,
  MaintenanceBridge,
  MaintenanceCommand,
  MaintenanceControlResult,
  MaintenancePublicStatus,
} from '../../shared/maintenance.ts';
import { publicMaintenance } from '../../shared/maintenance.ts';

export const MAINTENANCE_CHANNEL = 'spinel-maintenance';

/** Private IPC, inherited only by the supervisor's fixed application child. */
export async function connectMaintenance(): Promise<MaintenanceBridge> {
  if (!process.send || process.env.SPINEL_SUPERVISED !== '1')
    throw new Error('Maintenance requires its supervised application channel.');
  let current: MaintenanceAdminStatus | undefined;
  let closed = false;
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
  send({ kind: 'hello' });
  try {
    await initial;
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
    fail: (reason) => {
      if (!closed && process.connected) send({ kind: 'failure', reason });
    },
    close() {
      closed = true;
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
