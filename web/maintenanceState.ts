import { useSyncExternalStore } from 'react';
import type { MaintenancePublicStatus } from '../src/shared/maintenance.ts';

export const maintenanceEvent = 'spinel-maintenance';
type Snapshot = { status: MaintenancePublicStatus | null; reachable: boolean };
const listeners = new Set<() => void>();
let snapshot: Snapshot = { status: null, reachable: false };
let timer: ReturnType<typeof setInterval> | undefined;
let active: Promise<MaintenancePublicStatus | null> | undefined;

const phases = new Set([
  'running',
  'draining',
  'paused',
  'stopping',
  'stopped',
  'starting',
  'recovery-required',
]);

function validStatus(value: unknown): value is MaintenancePublicStatus {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as MaintenancePublicStatus;
  if (
    typeof candidate.available !== 'boolean' ||
    !phases.has(candidate.phase) ||
    typeof candidate.epoch !== 'string' ||
    candidate.epoch.length > 128 ||
    (candidate.available && !candidate.epoch)
  )
    return false;
  if (candidate.notice === null) return true;
  const notice = candidate.notice;
  return Boolean(
    notice &&
    typeof notice.id === 'string' &&
    Number.isSafeInteger(notice.startsAt) &&
    typeof notice.timeZone === 'string' &&
    notice.timeZone.length <= 100 &&
    Number.isInteger(notice.durationMinutes) &&
    notice.durationMinutes > 0 &&
    notice.durationMinutes <= 1440 &&
    ['scheduled', 'started', 'cancelled', 'missed'].includes(notice.state),
  );
}

function publish(next: Snapshot) {
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  const previous = snapshot.status;
  snapshot = next;
  for (const listener of listeners) listener();
  // Consumers capture their own immutable epoch. A new status must never
  // replace the epoch already attached to a pending edit or offline queue.
  window.dispatchEvent(
    new CustomEvent(maintenanceEvent, { detail: { previous, current: next.status } }),
  );
}

export const getMaintenanceStatus = () => snapshot.status;
export const getMaintenanceEpoch = () =>
  snapshot.status?.available && snapshot.status.epoch ? snapshot.status.epoch : undefined;

export function refreshMaintenanceStatus(): Promise<MaintenancePublicStatus | null> {
  if (active) return active;
  active = Promise.resolve().then(async () => {
    try {
      const response = await fetch('/api/maintenance', {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 404) {
        // Old/unsupervised app shells have no control endpoint. Never infer an
        // edit epoch from a missing service or make old stories look broken.
        if (snapshot.status?.available) throw new Error('Maintenance status unavailable');
        publish({
          status: { available: false, phase: 'running', epoch: '', notice: null },
          reachable: true,
        });
        return snapshot.status;
      }
      if (!response.ok && response.status !== 503)
        throw new Error('Maintenance status unavailable');
      const result: unknown = await response.json();
      if (!validStatus(result)) throw new Error('Invalid maintenance status');
      if (snapshot.status?.available && !result.available)
        throw new Error('Maintenance control disappeared');
      const status: MaintenancePublicStatus = {
        available: result.available,
        phase: result.phase,
        epoch: result.epoch,
        notice: result.notice
          ? {
              id: result.notice.id,
              startsAt: result.notice.startsAt,
              timeZone: result.notice.timeZone,
              durationMinutes: result.notice.durationMinutes,
              state: result.notice.state,
            }
          : null,
      };
      publish({ status, reachable: true });
      return status;
    } catch {
      // Losing the control endpoint is not evidence that maintenance ended.
      publish({ status: snapshot.status, reachable: false });
      return snapshot.status;
    } finally {
      active = undefined;
    }
  });
  return active;
}

function refreshOnFocus() {
  if (document.visibilityState !== 'hidden') void refreshMaintenanceStatus();
}

export function subscribeMaintenanceStatus(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshMaintenanceStatus();
    timer = setInterval(() => void refreshMaintenanceStatus(), 5000);
    window.addEventListener('online', refreshOnFocus);
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearInterval(timer);
    timer = undefined;
    window.removeEventListener('online', refreshOnFocus);
    window.removeEventListener('focus', refreshOnFocus);
    document.removeEventListener('visibilitychange', refreshOnFocus);
  };
}

export function useMaintenanceStatus() {
  return useSyncExternalStore(subscribeMaintenanceStatus, () => snapshot);
}
