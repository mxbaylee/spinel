import { afterEach, expect, test, vi } from 'vitest';
import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import {
  CollaborationController,
  CollaborationSessionService,
  CollaborationStatus,
  CollaborationUIEventService,
  ILocalCacheService,
} from '@univerjs-pro/collaboration-client';
import type { SaveState } from '../shared/autosave.ts';
import type { DocPendingChanges } from '../../web/docPending.ts';
import { watchCollaboration } from '../../web/collaboration.ts';

// Exercise Spinel's watcher through public SDK tokens/observables without
// starting a native editor or loading any Pro implementation.
vi.mock('@univerjs/core', () => ({ UserManagerService: Symbol('users') }));
vi.mock('../../web/CollaborationSessions.ts', () => ({ CollaborationSessions: class {} }));
vi.mock('@univerjs-pro/license', () => ({ UniverLicensePlugin: class {} }));
vi.mock('@univerjs-pro/collaboration', () => ({ UniverCollaborationPlugin: class {} }));
vi.mock('@univerjs-pro/collaboration-client', () => ({
  CollaborationController: Symbol('collaboration'),
  CollaborationSessionService: Symbol('sessions'),
  CollaborationUIEventService: Symbol('events'),
  ILocalCacheService: Symbol('cache'),
  UniverCollaborationClientPlugin: class {},
  CollaborationStatus: {
    SYNCED: 'synced',
    PENDING: 'pending',
    OFFLINE: 'offline',
    NOT_COLLAB: 'not_collab',
  },
  SessionStatus: { IDLE: 0, JOINING: 1, OFFLINE: 2, ONLINE: 3 },
  CollaborationUIEventId: {
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    CLOSE_ROOM: 'CLOSE_ROOM',
    JOIN_ROOM_FAILED: 'JOIN_ROOM_FAILED',
  },
}));
vi.mock('@univerjs-pro/collaboration-client-ui', () => ({
  BrowserCollaborationSocketService: class {},
  UniverCollaborationClientUIPlugin: class {},
}));
vi.mock('@univerjs-pro/collaboration-client/locale/en-US', () => ({ default: {} }));
vi.mock('@univerjs-pro/collaboration-client-ui/locale/en-US', () => ({ default: {} }));
vi.mock('@univerjs-pro/collaboration-client/facade', () => ({}));
vi.mock('@univerjs-pro/collaboration-client-ui/lib/index.css', () => ({}));

function stream<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    next(value: T) {
      for (const listener of listeners) listener(value);
    },
  };
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('only the current native-empty, SYNCED cache completion can clear a newer Doc edit', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setInterval, clearInterval }));
  const status$ = stream<CollaborationStatus>();
  const entity = { status$, session: { sessionStatus$: stream<number>() } };
  const entities = stream<typeof entity>();
  let status: CollaborationStatus = CollaborationStatus.SYNCED;
  let nativeQueued = false;
  let nativeChanged = () => {};
  const native: DocPendingChanges = {
    pending: () => nativeQueued,
    subscribe(changed) {
      nativeChanged = changed;
      return () => {
        nativeChanged = () => {};
      };
    },
  };
  const flushes: ReturnType<typeof barrier>[] = [];
  const cache = {
    exhaustSavingTask: () => {
      const flush = barrier();
      flushes.push(flush);
      return flush.promise;
    },
  };
  const services = new Map<unknown, unknown>([
    [CollaborationSessionService, { socket$: stream<null>(), reconnect() {} }],
    [CollaborationController, { getCollabEntity$: () => entities }],
    [CollaborationUIEventService, { event$: stream<never>() }],
    [ILocalCacheService, cache],
  ]);
  const univer = {
    __getInjector: () => ({
      get(token: unknown) {
        if (!services.has(token)) throw new Error('Unexpected public SDK service');
        return services.get(token);
      },
    }),
  } as unknown as Univer;
  const api = {
    getCollaboration: () => ({ getCollaborationStatus: () => status }),
  } as unknown as FUniver;
  const reports: SaveState[] = [];
  const watcher = watchCollaboration(
    univer,
    api,
    'live-doc',
    'stable-doc',
    'owner',
    (state) => reports.push(state),
    async () => {},
    () => {},
    'space',
    native,
  );
  entities.next(entity);
  try {
    // Establish a genuinely clean baseline, including the first recovery flush.
    flushes[0].resolve();
    await flushes[0].promise;
    expect(reports.at(-1)).toMatchObject({ dirty: false, message: 'All changes saved.' });
    reports.length = 0;

    // A raw local Doc notification precedes collaboration's batching/status.
    nativeQueued = true;
    nativeChanged();
    expect(status).toBe(CollaborationStatus.SYNCED);
    expect(reports.at(-1)).toMatchObject({
      dirty: true,
      message: 'Changes not saved yet — keep this tab open.',
    });
    expect(flushes).toHaveLength(1);

    // An empty native queue still cannot acknowledge the submitted changes.
    status = CollaborationStatus.PENDING;
    nativeQueued = false;
    nativeChanged();
    expect(reports.at(-1)?.dirty).toBe(true);
    expect(flushes).toHaveLength(1);
    status = CollaborationStatus.SYNCED;
    status$.next(status);
    const older = flushes.at(-1)!;
    expect(older).not.toBe(flushes[0]);

    // Another edit invalidates that unresolved flush while the SDK still says
    // SYNCED. Its later empty-queue notification starts a current flush, without
    // requiring a status transition that could mask the native invalidation.
    nativeQueued = true;
    nativeChanged();
    nativeQueued = false;
    nativeChanged();
    const current = flushes.at(-1)!;
    expect(current).not.toBe(older);
    older.resolve();
    await older.promise;
    expect(reports.every((state) => state.dirty)).toBe(true);

    current.resolve();
    await current.promise;
    expect(reports.at(-1)).toEqual({
      dirty: false,
      failed: false,
      message: 'All changes saved.',
    });
    expect(reports.filter((state) => !state.dirty)).toHaveLength(1);
  } finally {
    watcher.dispose();
  }
});
