import type { MaintenancePublicStatus } from '../src/shared/maintenance.ts';

export const maintenanceDismissalStorageKey = 'spinel:maintenance-dismissal:v1';
export const maintenanceDismissalLifetime = 60 * 60 * 1000;
export type MaintenanceDismissal = { noticeKey: string; expiresAt: number };
type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Undefined means not loaded yet, not evidence that the announcement ended. */
export function maintenanceBannerKey(status: MaintenancePublicStatus | null) {
  if (!status) return undefined;
  if (!status.available) return null;
  const notice = status.notice?.state === 'cancelled' ? null : status.notice;
  if (status.phase === 'running' && !notice) return null;
  // Poll timestamps, connectivity and countdowns must not undo a dismissal.
  return JSON.stringify([
    status.epoch,
    status.phase,
    notice && [notice.id, notice.startsAt, notice.timeZone, notice.durationMinutes, notice.state],
  ]);
}

/** One bounded, nonsecret record; never writes to account or workspace state. */
export function createMaintenanceDismissals(storage: () => SessionStore | null) {
  let record: MaintenanceDismissal | null | undefined;

  function save(next: MaintenanceDismissal | null) {
    record = next;
    try {
      if (next) storage()?.setItem(maintenanceDismissalStorageKey, JSON.stringify(next));
      else storage()?.removeItem(maintenanceDismissalStorageKey);
    } catch {
      // The same module instance retains dismissal across in-tab navigation.
    }
    return next;
  }

  function read() {
    if (record !== undefined) return record;
    record = null;
    try {
      const raw = storage()?.getItem(maintenanceDismissalStorageKey);
      if (!raw) return record;
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object') {
        const candidate = value as Partial<MaintenanceDismissal>;
        if (
          typeof candidate.noticeKey === 'string' &&
          candidate.noticeKey.length > 0 &&
          candidate.noticeKey.length <= 2048 &&
          typeof candidate.expiresAt === 'number' &&
          Number.isSafeInteger(candidate.expiresAt)
        ) {
          record = { noticeKey: candidate.noticeKey, expiresAt: candidate.expiresAt };
          return record;
        }
      }
      save(null);
    } catch {
      save(null);
    }
    return record;
  }

  return {
    current(key: string | null | undefined, now = Date.now()) {
      const current = read();
      if (!current) return null;
      if (current.expiresAt <= now || current.expiresAt > now + maintenanceDismissalLifetime)
        return save(null);
      // Preserve a reload's stored dismissal until authoritative status arrives.
      if (key === undefined) return current;
      if (current.noticeKey !== key) return save(null);
      return current;
    },
    dismiss(noticeKey: string, now = Date.now()) {
      return save({ noticeKey, expiresAt: now + maintenanceDismissalLifetime })!;
    },
    clear() {
      save(null);
    },
  };
}

export const maintenanceDismissals = createMaintenanceDismissals(() =>
  typeof window === 'undefined' ? null : window.sessionStorage,
);
