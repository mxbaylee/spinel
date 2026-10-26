import { afterEach, expect, test, vi } from 'vitest';
import { ICommandService } from '@univerjs/core';
import type { CommandListener, IExecutionOptions, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import {
  CollaborationController,
  CollaborationSessionService,
  CollaborationStatus,
  CollaborationUIEventId,
  CollaborationUIEventService,
  ILocalCacheService,
} from '@univerjs-pro/collaboration-client';
import type { SaveState } from '../shared/autosave.ts';
import type { DocPendingChanges } from '../../web/docPending.ts';
import { prepareCollaboration, watchCollaboration } from '../../web/collaboration.ts';

const bootstrap = vi.hoisted(() => ({ legacyFacadeLoads: 0 }));

// Exercise Spinel's watcher through public SDK tokens/observables without
// starting a native editor or loading any Pro implementation.
vi.mock('@univerjs/core', () => ({
  UserManagerService: Symbol('users'),
  ICommandService: Symbol('commands'),
}));
vi.mock('../../web/CollaborationSessions.ts', () => ({ CollaborationSessions: class {} }));
// The replacement socket lifecycle has its own tests; these fixtures exercise
// the unchanged legacy watcher without constructing either native runtime.
vi.mock('../../web/spinelSync.ts', () => ({
  getSpinelSync: () => undefined,
  loadSpinelDocument: vi.fn(),
  disposeSpinelSync: vi.fn(),
}));
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
vi.mock('@univerjs-pro/collaboration-client/facade', () => {
  bootstrap.legacyFacadeLoads++;
  return {};
});
vi.mock('@univerjs-pro/collaboration-client-ui/lib/index.css', () => ({}));

test.each([401, 403, 404])(
  'late preparation denial %i cannot revoke a replacement guest editor',
  async (status) => {
    const root = '11111111-1111-4111-8111-111111111111';
    vi.stubGlobal('location', { pathname: `/share/${root}` });
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    let release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    let current = true;
    const opening = prepareCollaboration('old-child', root, () => current);
    current = false;
    release(Response.json({ error: 'Unavailable' }, { status }));
    await expect(opening).rejects.toThrow('Unavailable');
    expect(dispatchEvent).not.toHaveBeenCalled();
    const active = prepareCollaboration('current-child', root, () => true);
    release(Response.json({ error: 'Unavailable' }, { status }));
    await expect(active).rejects.toThrow('Unavailable');
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0][0].type).toBe('spinel-guest-revoked');
  },
);

test('native preparation never installs the global legacy facade, and a backend change requires a new page', async () => {
  vi.stubGlobal('location', { pathname: '/' });
  const response = { unitId: 'unit', access: 'editor', user: { id: 'person', name: 'Person' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...response, syncVersion: 1 })),
  );
  expect(bootstrap.legacyFacadeLoads).toBe(0);
  expect((await prepareCollaboration('item')).syncVersion).toBe(1);
  expect(bootstrap.legacyFacadeLoads).toBe(0);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(response)),
  );
  await prepareCollaboration('item');
  expect(bootstrap.legacyFacadeLoads).toBe(1);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...response, syncVersion: 1 })),
  );
  await expect(prepareCollaboration('item')).rejects.toThrow('Reload this page');
});

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
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture({
  doc = false,
  initial = CollaborationStatus.SYNCED,
}: { doc?: boolean; initial?: CollaborationStatus } = {}) {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setInterval, clearInterval }));
  const id = doc ? 'live-doc' : 'live-sheet';
  const itemId = doc ? 'stable-doc' : 'stable-sheet';
  const status$ = stream<CollaborationStatus>();
  const entity = { status$, session: { sessionStatus$: stream<number>() } };
  const entities = stream<typeof entity>();
  const events = stream<{ id: CollaborationUIEventId; unitID: string }>();
  let status = initial;
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
  const mutations = new Set<CommandListener>();
  let response = () => Response.json({ item: { access: 'owner' }, live: { unitId: id } });
  const request = vi.fn<typeof globalThis.fetch>(async () => response());
  vi.stubGlobal('fetch', request);
  const readonly = vi.fn(async () => {});
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
    [CollaborationUIEventService, { event$: events }],
    [ILocalCacheService, cache],
    [
      ICommandService,
      {
        onMutationExecutedForCollab(listener: CommandListener) {
          mutations.add(listener);
          return { dispose: () => mutations.delete(listener) };
        },
      },
    ],
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
    id,
    itemId,
    'owner',
    (state) => reports.push(state),
    readonly,
    () => {},
    'space',
    doc ? native : undefined,
  );
  entities.next(entity);
  stops.push(() => watcher.dispose());
  return {
    id,
    itemId,
    reports,
    flushes,
    request,
    readonly,
    watcher,
    status(value: CollaborationStatus, notify = true) {
      status = value;
      if (notify) status$.next(value);
    },
    native(value: boolean) {
      nativeQueued = value;
      nativeChanged();
    },
    mutate(params: object, options?: IExecutionOptions) {
      for (const listener of mutations)
        listener({ id: 'sheet.mutation.set-range-values', params }, options);
    },
    access(reply: () => Response) {
      response = reply;
    },
    denied() {
      events.next({ id: CollaborationUIEventId.PERMISSION_DENIED, unitID: id });
    },
  };
}
const settle = () => vi.advanceTimersByTimeAsync(0);
async function complete(flush: ReturnType<typeof barrier>) {
  flush.resolve();
  await flush.promise;
}

test('only the current native-empty, SYNCED cache completion can clear a newer Doc edit', async () => {
  const f = fixture({ doc: true });
  // Establish a genuinely clean baseline, including the first recovery flush.
  await complete(f.flushes[0]);
  expect(f.reports.at(-1)).toMatchObject({ dirty: false, message: 'All changes saved.' });
  f.reports.length = 0;

  // A raw local Doc notification precedes collaboration's batching/status.
  f.native(true);
  expect(f.reports.at(-1)).toMatchObject({
    dirty: true,
    message: 'Changes not saved yet — keep this tab open.',
  });
  expect(f.flushes).toHaveLength(1);

  // An empty native queue still cannot acknowledge the submitted changes.
  f.status(CollaborationStatus.PENDING, false);
  f.native(false);
  expect(f.reports.at(-1)?.dirty).toBe(true);
  expect(f.flushes).toHaveLength(1);
  f.status(CollaborationStatus.SYNCED);
  const older = f.flushes.at(-1)!;
  expect(older).not.toBe(f.flushes[0]);

  // Another edit invalidates that unresolved flush while the SDK still says
  // SYNCED. Its later empty-queue notification starts a current flush, without
  // requiring a status transition that could mask the native invalidation.
  f.native(true);
  f.native(false);
  const current = f.flushes.at(-1)!;
  expect(current).not.toBe(older);
  await complete(older);
  expect(f.reports.every((state) => state.dirty)).toBe(true);

  await complete(current);
  expect(f.reports.at(-1)).toEqual({
    dirty: false,
    failed: false,
    message: 'All changes saved.',
  });
  expect(f.reports.filter((state) => !state.dirty)).toHaveLength(1);
});

test.each([
  { doc: false, disconnected: CollaborationStatus.OFFLINE, missing: true },
  { doc: false, disconnected: CollaborationStatus.NOT_COLLAB, missing: false },
  { doc: true, disconnected: CollaborationStatus.OFFLINE, missing: false },
  { doc: true, disconnected: CollaborationStatus.NOT_COLLAB, missing: true },
])(
  'a flushed clean editor stays clean through duplicate sync, retry and denial: %j',
  async ({ doc, disconnected, missing }) => {
    const f = fixture({ doc });
    await complete(f.flushes[0]);
    expect(f.reports.at(-1)?.dirty).toBe(false);
    f.reports.length = 0;

    f.status(CollaborationStatus.SYNCED);
    f.watcher.retry();
    await settle();
    expect(f.flushes).toHaveLength(1);
    expect(f.reports.every((state) => !state.dirty)).toBe(true);

    f.access(() =>
      missing
        ? new Response(null, { status: 404 })
        : Response.json({ item: { access: 'viewer' }, live: { unitId: f.id } }),
    );
    f.status(disconnected);
    expect(f.reports.at(-1)?.dirty).toBe(false);
    f.denied();
    await settle();
    expect(f.request).toHaveBeenCalled();
    expect(f.readonly).toHaveBeenCalledTimes(1);
    expect(f.reports.at(-1)).toEqual({
      dirty: false,
      failed: true,
      message: 'Access changed. Copy unsaved changes before reloading.',
    });
    expect(f.reports.every((state) => !state.dirty)).toBe(true);
  },
);

test('initial disconnected state stays guarded until synchronization and a current cache flush', async () => {
  const f = fixture({ initial: CollaborationStatus.OFFLINE });
  expect(f.reports.at(-1)?.dirty).toBe(true);
  expect(f.flushes).toHaveLength(0);
  f.status(CollaborationStatus.NOT_COLLAB);
  expect(f.reports.at(-1)?.dirty).toBe(true);
  f.status(CollaborationStatus.SYNCED);
  expect(f.reports.every((state) => state.dirty)).toBe(true);
  expect(f.flushes).toHaveLength(1);
  await complete(f.flushes[0]);
  expect(f.reports.at(-1)?.dirty).toBe(false);
});

test('an outstanding recovery-cache flush stays dirty through disconnect and access denial', async () => {
  const f = fixture();
  const unfinished = f.flushes[0];
  expect(f.reports.at(-1)?.dirty).toBe(true);
  f.access(() => new Response(null, { status: 404 }));
  f.status(CollaborationStatus.OFFLINE);
  await settle();
  expect(f.readonly).toHaveBeenCalledTimes(1);
  expect(f.reports.at(-1)).toMatchObject({
    dirty: true,
    message: 'Access changed. Copy unsaved changes before reloading.',
  });
  await complete(unfinished);
  expect(f.reports.every((state) => state.dirty)).toBe(true);
});

test.each(['collaboration', 'native Doc'] as const)(
  '%s pending work survives disconnect and denial',
  async (source) => {
    const f = fixture({ doc: true });
    await complete(f.flushes[0]);
    f.reports.length = 0;
    if (source === 'native Doc') f.native(true);
    else f.status(CollaborationStatus.PENDING);
    expect(f.reports.at(-1)?.dirty).toBe(true);
    f.access(() => new Response(null, { status: 404 }));
    f.status(CollaborationStatus.OFFLINE);
    f.status(CollaborationStatus.NOT_COLLAB);
    await settle();
    expect(f.readonly).toHaveBeenCalledTimes(1);
    expect(f.reports.at(-1)).toMatchObject({
      dirty: true,
      message: 'Access changed. Copy unsaved changes before reloading.',
    });
    expect(f.reports.every((state) => state.dirty)).toBe(true);
  },
);

test.each([undefined, { syncOnly: true }] satisfies (IExecutionOptions | undefined)[])(
  'a local Sheet mutation becomes dirty immediately while already OFFLINE: %j',
  async (options) => {
    const f = fixture();
    await complete(f.flushes[0]);
    f.status(CollaborationStatus.OFFLINE);
    await settle();
    expect(f.reports.at(-1)?.dirty).toBe(false);
    f.reports.length = 0;

    // No collaboration-status event accompanies this mutation. Pending local
    // work must be visible before its queued status resample or access response.
    f.mutate({ unitId: f.id }, options);
    expect(f.reports.at(-1)?.dirty).toBe(true);
    await settle();
    expect(f.flushes).toHaveLength(1);
    f.access(() => new Response(null, { status: 404 }));
    f.denied();
    await settle();
    expect(f.readonly).toHaveBeenCalledTimes(1);
    expect(f.reports.every((state) => state.dirty)).toBe(true);
  },
);

test('unscoped, other-unit, remote, replay and local-only notifications do not invent Sheet work', async () => {
  const f = fixture();
  await complete(f.flushes[0]);
  f.status(CollaborationStatus.OFFLINE);
  await settle();
  const firstIgnored = f.reports.length;
  f.mutate({});
  f.mutate({ unitId: 'other-sheet' });
  f.mutate({ unitId: f.itemId });
  for (const options of [{ onlyLocal: true }, { fromCollab: true }, { fromChangeset: true }])
    f.mutate({ unitId: f.id }, options);
  await settle();
  expect(f.reports.at(-1)?.dirty).toBe(false);
  expect(f.reports.slice(firstIgnored).every((state) => !state.dirty)).toBe(true);
  expect(f.flushes).toHaveLength(1);
  expect(f.readonly).not.toHaveBeenCalled();
});

test('a queued older cache completion cannot clear a new local Sheet mutation', async () => {
  const f = fixture();
  await complete(f.flushes[0]);
  f.reports.length = 0;
  f.status(CollaborationStatus.PENDING);
  f.status(CollaborationStatus.SYNCED);
  const older = f.flushes.at(-1)!;
  expect(older).not.toBe(f.flushes[0]);

  // Queue the old completion first, then publish the real local mutation in
  // this same turn. Its synchronous invalidation must win before a later
  // microtask can resample the SDK's still-SYNCED status.
  older.resolve();
  f.mutate({ unitId: f.id });
  expect(f.reports.at(-1)?.dirty).toBe(true);
  await older.promise;
  await settle();
  const current = f.flushes.at(-1)!;
  expect(current).not.toBe(older);
  expect(f.reports.every((state) => state.dirty)).toBe(true);

  await complete(current);
  expect(f.reports.at(-1)).toEqual({ dirty: false, failed: false, message: 'All changes saved.' });
  expect(f.reports.filter((state) => !state.dirty)).toHaveLength(1);
});
