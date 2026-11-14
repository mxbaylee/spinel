import { describe, expect, it } from 'vitest';
import type { MaintenancePublicStatus } from '../shared/maintenance.ts';
import {
  createMaintenanceDismissals,
  maintenanceBannerKey,
  maintenanceDismissalLifetime,
  maintenanceDismissalStorageKey,
} from '../../web/maintenanceDismissal.ts';

const now = Date.UTC(2030, 0, 1);
const scheduled: MaintenancePublicStatus = {
  available: true,
  epoch: 'test-epoch',
  phase: 'running',
  notice: {
    id: 'notice-one',
    startsAt: now + 600_000,
    timeZone: 'UTC',
    durationMinutes: 30,
    state: 'scheduled',
  },
};
const key = maintenanceBannerKey(scheduled)!;
function session() {
  const values = new Map<string, string>();
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      values.set(name, value);
    },
    removeItem: (name: string) => {
      values.delete(name);
    },
  };
}

describe('tab-local maintenance banner dismissal', () => {
  it('keeps the same expiry across polls and a new module instance after refresh', () => {
    const storage = session();
    const store = createMaintenanceDismissals(() => storage);
    const dismissed = store.dismiss(key, now);
    expect(dismissed.expiresAt).toBe(now + maintenanceDismissalLifetime);
    expect(store.current(maintenanceBannerKey(structuredClone(scheduled)), now + 1)).toBe(
      dismissed,
    );
    const refreshed = createMaintenanceDismissals(() => storage);
    // Initial loading is not authoritative cancellation, including after reload.
    expect(refreshed.current(undefined, now + 2)).toEqual(dismissed);
    expect(refreshed.current(key, now + 3)).toEqual(dismissed);
  });

  it('expires at one hour and removes the obsolete record', () => {
    // Owner chose a maximum of one hour rather than permanent notification preferences.
    const storage = session();
    const store = createMaintenanceDismissals(() => storage);
    store.dismiss(key, now);
    expect(store.current(key, now + maintenanceDismissalLifetime - 1)).not.toBeNull();
    expect(store.current(key, now + maintenanceDismissalLifetime)).toBeNull();
    expect(storage.getItem(maintenanceDismissalStorageKey)).toBeNull();
  });

  it('does not synchronize dismissal between separate tabs', () => {
    const first = session();
    const second = session();
    createMaintenanceDismissals(() => first).dismiss(key, now);
    expect(createMaintenanceDismissals(() => second).current(key, now + 1)).toBeNull();
  });

  it('does not synchronize subsequent changes to an opener copy', () => {
    const first = session();
    const second = session();
    const source = createMaintenanceDismissals(() => first);
    source.dismiss(key, now);
    second.setItem(maintenanceDismissalStorageKey, first.getItem(maintenanceDismissalStorageKey)!);
    source.clear();
    expect(createMaintenanceDismissals(() => second).current(key, now + 1)).not.toBeNull();
    expect(
      createMaintenanceDismissals(() => second).current(key, now + maintenanceDismissalLifetime),
    ).toBeNull();
  });

  it.each([
    { id: 'replacement' },
    { startsAt: now + 900_000 },
    { timeZone: 'America/Los_Angeles' },
    { durationMinutes: 60 },
    { state: 'started' as const },
    { state: 'missed' as const },
  ])('resurfaces changed announcement content: %j', (change) => {
    const store = createMaintenanceDismissals(() => session());
    store.dismiss(key, now);
    const changed = maintenanceBannerKey({
      ...scheduled,
      notice: { ...scheduled.notice!, ...change },
    });
    expect(changed).not.toBe(key);
    expect(store.current(changed, now + 1)).toBeNull();
    expect(store.current(key, now + 2)).toBeNull();
  });

  it.each(['draining', 'paused', 'stopping', 'stopped', 'starting', 'recovery-required'] as const)(
    'resurfaces an actual %s transition even without an announcement',
    (phase) => {
      const store = createMaintenanceDismissals(() => session());
      store.dismiss(key, now);
      const changed = maintenanceBannerKey({ ...scheduled, notice: null, phase });
      expect(changed).not.toBe(key);
      expect(changed).toBeTypeOf('string');
      expect(store.current(changed, now + 1)).toBeNull();
    },
  );

  it('resurfaces a different generation with otherwise identical public status', () => {
    const store = createMaintenanceDismissals(() => session());
    store.dismiss(key, now);
    expect(
      store.current(maintenanceBannerKey({ ...scheduled, epoch: 'new-epoch' }), now + 1),
    ).toBeNull();
  });

  it.each([
    { ...scheduled, notice: null },
    { ...scheduled, available: false },
    { ...scheduled, notice: { ...scheduled.notice!, state: 'cancelled' as const } },
  ])('clears an authoritatively absent announcement', (status) => {
    const storage = session();
    const store = createMaintenanceDismissals(() => storage);
    store.dismiss(key, now);
    expect(maintenanceBannerKey(status)).toBeNull();
    expect(store.current(null, now + 1)).toBeNull();
    expect(storage.getItem(maintenanceDismissalStorageKey)).toBeNull();
  });

  it('keeps a pause visible as a distinct identity when a notice is cancelled', () => {
    expect(
      maintenanceBannerKey({
        ...scheduled,
        phase: 'paused',
        notice: { ...scheduled.notice!, state: 'cancelled' },
      }),
    ).toBeTypeOf('string');
  });

  it('falls back to memory when the browser blocks the sessionStorage getter', () => {
    const store = createMaintenanceDismissals(() => {
      throw new Error('Storage is blocked');
    });
    const dismissed = store.dismiss(key, now);
    expect(store.current(key, now + 1)).toEqual(dismissed);
    store.clear();
    expect(store.current(key, now + 2)).toBeNull();
  });

  it('keeps in-memory dismissal when writes and removal throw', () => {
    const store = createMaintenanceDismissals(() => ({
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota exceeded');
      },
      removeItem: () => {
        throw new Error('Storage is blocked');
      },
    }));
    expect(store.current(key, now)).toBeNull();
    store.dismiss(key, now);
    expect(store.current(key, now + 1)).not.toBeNull();
    store.clear();
    expect(store.current(key, now + 2)).toBeNull();
  });

  it.each(['broken JSON', 'null', '[]', '{}', 'true', '{"noticeKey":1,"expiresAt":1}'])(
    'ignores malformed stored state: %s',
    (value) => {
      const storage = session();
      storage.setItem(maintenanceDismissalStorageKey, value);
      expect(createMaintenanceDismissals(() => storage).current(key, now)).toBeNull();
    },
  );

  it('rejects an expiry more than one hour ahead, including clock rollback', () => {
    const storage = session();
    storage.setItem(
      maintenanceDismissalStorageKey,
      JSON.stringify({
        noticeKey: key,
        expiresAt: now + maintenanceDismissalLifetime + 1,
      }),
    );
    expect(createMaintenanceDismissals(() => storage).current(key, now)).toBeNull();
  });

  it('clears only its own storage entry when details are reopened', () => {
    const storage = session();
    storage.setItem('unrelated', 'retained');
    const store = createMaintenanceDismissals(() => storage);
    store.dismiss(key, now);
    store.clear();
    expect(storage.getItem('unrelated')).toBe('retained');
    expect(storage.getItem(maintenanceDismissalStorageKey)).toBeNull();
  });
});
