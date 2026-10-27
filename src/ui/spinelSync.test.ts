import { afterEach, expect, test, vi } from 'vitest';
import type {
  NativeSyncOptions,
  ClientState,
  IncomingFrame,
  ClientCheckpoint,
} from '@spinel/sync-client';
import type { Univer } from '@univerjs/core';
import { disposeSpinelSync, getSpinelSync, loadSpinelDocument } from '../../web/spinelSync.ts';
import { getSyncPresence } from '../../web/syncPresence.ts';
import type { SaveState } from '../shared/autosave.ts';
import type { ConnectionState } from '../../web/connectionState.ts';
import type { OfflineSession } from '../../web/offline/OfflineSession.ts';
import type { OfflineRecoveryRequest } from '../shared/offlineRecovery.ts';

const downloadOfflineFile = vi.hoisted(() => vi.fn());
vi.mock('../../web/offline/recovery.ts', () => ({
  downloadOfflineFile,
  offlineCopyName: (title: string) => `${title} (offline copy, 2026-10-27 14:35)`,
}));

const native = vi.hoisted(() => ({
  clients: [] as {
    options: NativeSyncOptions;
    state: ClientState;
    disposed: boolean;
    received: IncomingFrame[];
  }[],
}));
vi.mock('@univerjs/core', () => ({ UniverInstanceType: { UNIVER_SHEET: 2, UNIVER_DOC: 1 } }));
vi.mock('@spinel/sync-client', () => ({
  validateNativeSnapshot: vi.fn(),
  createNativeSyncClient(options: NativeSyncOptions) {
    const entry = {
      options,
      state: {
        revision: options.revision,
        pending: false,
        pendingMutations: 0,
        connected: false,
        resyncing: false,
      } as ClientState,
      disposed: false,
      received: [] as IncomingFrame[],
    };
    native.clients.push(entry);
    return {
      get confirmedRevision() {
        return entry.state.revision;
      },
      setConnected(connected: boolean) {
        entry.state = { ...entry.state, connected };
        options.onState(entry.state);
      },
      receive(frame: IncomingFrame) {
        entry.received.push(frame);
        if (frame.type === 'resume' || frame.type === 'ack') entry.state.revision = frame.revision;
        if (frame.type === 'ack') entry.state.pending = false;
        options.onState(entry.state);
      },
      checkpoint() {
        return {
          version: 1 as const,
          unitId: 'unit',
          revision: entry.state.revision,
          snapshot: options.snapshot,
          sent: null,
          inflight: [],
          buffer: [],
        };
      },
      async persistNow() {
        try {
          await options.persist?.(this.checkpoint());
          if (options.persist) entry.state.localPersistence = 'saved';
          options.onState(entry.state);
        } catch (error) {
          entry.state.localPersistence = 'failed';
          options.onState(entry.state);
          throw error;
        }
      },
      retry() {
        void this.persistNow().catch(() => {});
      },
      refuse(reason: import('@spinel/sync-client').ClientFailure) {
        entry.state = { ...entry.state, resyncing: true };
        options.onState(entry.state);
        options.onResync(reason);
      },
      dispose() {
        entry.disposed = true;
      },
    };
  },
}));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  sent: unknown[] = [];
  url: string;
  constructor(url: URL) {
    this.url = String(url);
    Socket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  frame(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  downloadOfflineFile.mockClear();
  native.clients.length = 0;
  Socket.instances.length = 0;
});
const item = '11111111-1111-4111-8111-111111111111';
const child = '22222222-2222-4222-8222-222222222222';

async function fixture({
  guest = false,
  space = false,
  initializeAccess,
  onInitialPending,
  beforeWatch,
  downloaded = false,
  preparing = false,
  canRecover = false,
  canRefresh,
}: {
  guest?: boolean;
  space?: boolean;
  initializeAccess?(): void | Promise<void>;
  onInitialPending?(): void;
  beforeWatch?(): void;
  downloaded?: boolean;
  preparing?: boolean;
  canRecover?: boolean;
  canRefresh?(): boolean;
} = {}) {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  const signIn = vi.fn();
  vi.stubGlobal('location', {
    pathname: guest ? `/share/${item}` : '/',
    origin: 'https://spinel.test',
    protocol: 'https:',
    search: '',
    assign: signIn,
  });
  const events = new EventTarget();
  const dispatched = vi.spyOn(events, 'dispatchEvent');
  vi.stubGlobal('window', events);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('WebSocket', Socket);
  let current = true;
  let metadata: (input: string) => Promise<Response> = async (input) =>
    Response.json(
      input.endsWith('/collaboration')
        ? { access: 'editor', unitId: 'unit', user: { id: 'owner' } }
        : { item: { access: 'editor' }, live: { unitId: 'unit' } },
    );
  const requests = vi.fn(async (input: string, _init?: RequestInit) => {
    if (input.includes('/snapshot?'))
      return Response.json({
        version: 1,
        unitId: 'unit',
        revision: 8,
        snapshot: { id: 'unit', body: { dataStream: '\r\n' } },
      });
    if (input.includes('/ticket?')) return Response.json({ version: 1, ticket: 'one-use-ticket' });
    return metadata(input);
  });
  vi.stubGlobal('fetch', requests);
  const recoveryRequest: OfflineRecoveryRequest = {
    recoveryId: '33333333-3333-4333-8333-333333333333',
    filename: 'Offline notes (offline copy, 2026-10-27 14:35).univer.json',
    snapshot: {
      id: space ? child : item,
      title: 'Offline notes (offline copy, 2026-10-27 14:35)',
      documentStyle: {},
      body: { dataStream: 'Retained local notes\r\n' },
    },
    possibleReplayCrash: false,
  };
  const copyItem = {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Offline notes (offline copy, 2026-10-27 14:35)',
  };
  const offline = {
    enabled: downloaded,
    canRecover,
    current: true,
    pending: false,
    online: false,
    problem: '',
    accountId: 'owner',
    itemId: space ? child : item,
    bundle: { access: 'editor', unitId: 'unit', name: 'Offline notes' },
    recoveryRequest: undefined as OfflineRecoveryRequest | undefined,
    onChange: undefined as (() => void) | undefined,
    initial: () =>
      downloaded
        ? { snapshot: { id: 'unit', body: { dataStream: '\r\n' } }, revision: 8 }
        : undefined,
    toVisible: <T>(value: T) => value,
    toCanonical: <T>(value: T) => value,
    fetch: requests,
    reconcileAvailability: vi.fn(async (_checkpoint: ClientCheckpoint) => {}),
    persist: vi.fn(async (_checkpoint: ClientCheckpoint) => {}),
    prepareRecovery: vi.fn(
      async (_checkpoint: ClientCheckpoint): Promise<OfflineRecoveryRequest> => {
        offline.recoveryRequest ??= structuredClone(recoveryRequest);
        return structuredClone(offline.recoveryRequest);
      },
    ),
    publishRecovery: vi.fn(
      async (_request: OfflineRecoveryRequest, _signal: AbortSignal) => copyItem,
    ),
    exportSnapshot: vi.fn(async (_checkpoint: ClientCheckpoint) =>
      structuredClone(recoveryRequest.snapshot),
    ),
    finishRecovery: vi.fn(async (_recoveryId?: string) => {
      offline.pending = false;
    }),
    prepareImages: vi.fn(async (_value: unknown, _signal?: AbortSignal) => {}),
    refreshClean: vi.fn(async (verify: () => void) => {
      verify();
    }),
    removeClean: vi.fn(async (verify: () => void) => {
      verify();
    }),
    endAuthentication: vi.fn(),
    stopAuthenticationHTTP: vi.fn(),
    stopRemote: vi.fn((reason: string) => {
      offline.problem = reason;
    }),
    dispose: vi.fn(),
  };
  const univer = { createUnit: vi.fn() } as unknown as Univer;
  const abort = new AbortController();
  stops.push(() => {
    abort.abort();
    disposeSpinelSync(univer);
  });
  const reload = vi.fn();
  const lock = vi.fn();
  await loadSpinelDocument({
    univer,
    unitId: 'unit',
    itemId: space ? child : item,
    spaceId: space ? item : undefined,
    access: 'editor',
    kind: 'doc',
    signal: abort.signal,
    isCurrent: () => current,
    initializeAccess,
    onInitialPending,
    reload,
    lock,
    offline: downloaded || preparing ? (offline as unknown as OfflineSession) : undefined,
    canRefresh,
  });
  beforeWatch?.();
  const saves: SaveState[] = [];
  const connections: ConnectionState[] = [];
  const readonly = vi.fn(async (_preserveInput?: boolean) => {});
  const handle = getSpinelSync(univer)!.watch({
    publish: (state) => saves.push(state),
    connection: (state) => connections.push(state),
    readonly,
  });
  await vi.advanceTimersByTimeAsync(0);
  const client = native.clients.at(-1)!;
  return {
    univer,
    saves,
    connections,
    readonly,
    handle,
    abort,
    requests,
    reload,
    lock,
    signIn,
    dispatched,
    client,
    offline,
    recoveryRequest,
    copyItem,
    socket: () => Socket.instances.at(-1)!,
    leave() {
      current = false;
    },
    metadata(reply: (input: string) => Promise<Response>) {
      metadata = reply;
    },
    pending() {
      client.state.pending = true;
      client.state.pendingMutations = 1;
      if (downloaded || preparing) offline.pending = true;
      client.options.onState(client.state);
    },
    conflict() {
      offline.stopRemote('The live document changed. Your saved device copy is retained.');
      offline.onChange?.();
    },
  };
}

test('recovery freezes and drains before publication, then removes local work only after the durable response', async () => {
  const f = await fixture({ downloaded: true, canRecover: true, space: true });
  const order: string[] = [];
  let release!: () => void;
  const acknowledged = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prepare = f.offline.prepareRecovery.getMockImplementation()!;
  const finish = f.offline.finishRecovery.getMockImplementation()!;
  f.readonly.mockImplementationOnce(async (preserve) => {
    expect(preserve).toBe(true);
    order.push('freeze');
  });
  f.offline.persist.mockImplementationOnce(async () => {
    order.push('drain');
  });
  f.offline.prepareRecovery.mockImplementationOnce(async (checkpoint) => {
    order.push('prepare');
    expect(checkpoint).toEqual(f.offline.persist.mock.calls[0][0]);
    return prepare(checkpoint);
  });
  f.offline.publishRecovery.mockImplementationOnce(async (request, signal) => {
    order.push('publish');
    expect(request).toEqual(f.recoveryRequest);
    expect(signal.aborted).toBe(false);
    await acknowledged;
    return f.copyItem;
  });
  f.offline.finishRecovery.mockImplementationOnce(async (recoveryId) => {
    order.push('cleanup');
    expect(f.client.disposed).toBe(false);
    expect(f.offline.pending).toBe(true);
    await finish(recoveryId);
  });
  f.pending();
  f.conflict();
  await vi.advanceTimersByTimeAsync(0);
  expect(order).toEqual(['freeze', 'drain', 'prepare', 'publish']);
  expect(f.saves.at(-1)?.recovery).toMatchObject({
    phase: 'creating',
    originalHref: `/spaces/${item}?item=${child}`,
  });
  expect(f.offline.finishRecovery).not.toHaveBeenCalled();
  expect(f.offline.pending).toBe(true);
  expect(f.client.disposed).toBe(false);
  f.handle.recover();
  f.handle.exportRecovery();
  f.handle.discardRecovery();
  f.offline.onChange?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.publishRecovery).toHaveBeenCalledOnce();
  expect(f.offline.exportSnapshot).not.toHaveBeenCalled();
  expect(f.offline.finishRecovery).not.toHaveBeenCalled();
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(order).toEqual(['freeze', 'drain', 'prepare', 'publish', 'cleanup']);
  expect(f.offline.finishRecovery).toHaveBeenCalledWith(f.recoveryRequest.recoveryId);
  expect(f.offline.pending).toBe(false);
  expect(f.client.disposed).toBe(true);
  expect(f.saves.at(-1)?.recovery).toMatchObject({
    phase: 'created',
    copyHref: `/?item=${f.copyItem.id}`,
    copyName: f.copyItem.name,
    originalHref: `/spaces/${item}?item=${child}`,
  });
  expect(f.offline.removeClean).not.toHaveBeenCalled();
  expect(f.reload).not.toHaveBeenCalled();
  f.handle.recover();
  f.offline.onChange?.();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.offline.publishRecovery).toHaveBeenCalledOnce();
  expect(f.offline.finishRecovery).toHaveBeenCalledOnce();
});

test('failed recovery retains the client and outbox, makes one automatic attempt, and retries the same stored request explicitly', async () => {
  const f = await fixture({ downloaded: true, canRecover: true });
  f.offline.publishRecovery.mockRejectedValueOnce(
    new Error('Recovery is temporarily unavailable.'),
  );
  f.pending();
  f.conflict();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.saves.at(-1)?.recovery).toMatchObject({
    phase: 'failed',
    message: 'Recovery is temporarily unavailable.',
  });
  expect(f.client.disposed).toBe(false);
  expect(f.offline.pending).toBe(true);
  expect(f.offline.finishRecovery).not.toHaveBeenCalled();
  f.offline.onChange?.();
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.offline.prepareRecovery).toHaveBeenCalledOnce();
  expect(f.offline.publishRecovery).toHaveBeenCalledOnce();
  f.handle.recover();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.publishRecovery).toHaveBeenCalledTimes(2);
  expect(f.offline.publishRecovery.mock.calls.map(([request]) => request)).toEqual([
    f.recoveryRequest,
    f.recoveryRequest,
  ]);
  expect(f.offline.finishRecovery).toHaveBeenCalledWith(f.recoveryRequest.recoveryId);
  expect(f.client.disposed).toBe(true);
  expect(f.offline.pending).toBe(false);
});

test('failed recovery cleanup retains the exact request and retries the already-created copy', async () => {
  const f = await fixture({ downloaded: true, canRecover: true });
  f.offline.finishRecovery.mockRejectedValueOnce(new Error('Local recovery cleanup failed.'));
  f.pending();
  f.conflict();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.saves.at(-1)?.recovery).toMatchObject({
    phase: 'failed',
    message: 'Local recovery cleanup failed.',
  });
  expect(f.offline.recoveryRequest).toEqual(f.recoveryRequest);
  expect(f.offline.pending).toBe(true);
  expect(f.client.disposed).toBe(false);
  f.handle.recover();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.publishRecovery.mock.calls.map(([request]) => request)).toEqual([
    f.recoveryRequest,
    f.recoveryRequest,
  ]);
  expect(f.offline.finishRecovery.mock.calls).toEqual([
    [f.recoveryRequest.recoveryId],
    [f.recoveryRequest.recoveryId],
  ]);
  expect(f.saves.at(-1)?.recovery).toMatchObject({
    phase: 'created',
    copyHref: `/?item=${f.copyItem.id}`,
  });
  expect(f.offline.pending).toBe(false);
  expect(f.client.disposed).toBe(true);
});

test('explicit discard after a failed copy clears only local work and never republishes the request', async () => {
  const f = await fixture({ downloaded: true, canRecover: true });
  f.offline.publishRecovery.mockRejectedValueOnce(new Error('Copy permission denied.'));
  f.pending();
  f.conflict();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.finishRecovery).not.toHaveBeenCalled();
  const requests = f.requests.mock.calls.length;
  f.handle.discardRecovery();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.publishRecovery).toHaveBeenCalledOnce();
  expect(f.offline.prepareRecovery).toHaveBeenCalledOnce();
  expect(f.offline.finishRecovery).toHaveBeenCalledExactlyOnceWith();
  expect(f.requests.mock.calls).toHaveLength(requests);
  expect(f.offline.pending).toBe(false);
  expect(f.client.disposed).toBe(true);
  expect(f.saves.at(-1)?.recovery).toMatchObject({
    phase: 'discarded',
    originalHref: `/?item=${item}`,
  });
});

test('unfinished host input blocks automatic copy and every explicit recovery action until the input is dismissed', async () => {
  let unfinished = true;
  const f = await fixture({ downloaded: true, canRecover: true, canRefresh: () => !unfinished });
  f.pending();
  f.conflict();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.saves.at(-1)?.recovery?.phase).toBe('ready');
  expect(f.offline.prepareRecovery).not.toHaveBeenCalled();
  f.handle.recover();
  await vi.advanceTimersByTimeAsync(0);
  f.handle.exportRecovery();
  await vi.advanceTimersByTimeAsync(0);
  f.handle.discardRecovery();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.readonly).toHaveBeenCalledWith(true);
  expect(f.saves.at(-1)?.recovery?.message).toBe(
    'Copy or finish the unfinished input before recovering these changes.',
  );
  expect(f.offline.persist).not.toHaveBeenCalled();
  expect(f.offline.prepareRecovery).not.toHaveBeenCalled();
  expect(f.offline.publishRecovery).not.toHaveBeenCalled();
  expect(f.offline.exportSnapshot).not.toHaveBeenCalled();
  expect(f.offline.finishRecovery).not.toHaveBeenCalled();
  expect(downloadOfflineFile).not.toHaveBeenCalled();
  expect(f.offline.pending).toBe(true);
  expect(f.client.disposed).toBe(false);
  unfinished = false;
  f.handle.recover();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.publishRecovery).toHaveBeenCalledOnce();
  expect(f.saves.at(-1)?.recovery?.phase).toBe('created');
});

test('a failed local drain cannot publish a recovery snapshot or remove the pending outbox', async () => {
  const f = await fixture({ downloaded: true, canRecover: true });
  f.offline.persist.mockRejectedValueOnce(new Error('Device storage is full.'));
  f.pending();
  f.conflict();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.saves.at(-1)).toMatchObject({
    dirty: true,
    local: 'failed',
    recovery: { phase: 'failed', message: 'Device storage is full.' },
  });
  expect(f.offline.prepareRecovery).not.toHaveBeenCalled();
  expect(f.offline.publishRecovery).not.toHaveBeenCalled();
  expect(f.offline.finishRecovery).not.toHaveBeenCalled();
  expect(f.offline.pending).toBe(true);
  expect(f.client.disposed).toBe(false);
  f.handle.retry();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.persist).toHaveBeenCalledTimes(2);
  expect(f.offline.publishRecovery).not.toHaveBeenCalled();
  f.handle.recover();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.persist).toHaveBeenCalledTimes(3);
  expect(f.offline.publishRecovery).toHaveBeenCalledOnce();
  expect(f.saves.at(-1)?.recovery?.phase).toBe('created');
});

test('a session without recovery ownership never exposes or starts the copy workflow', async () => {
  const f = await fixture({ downloaded: true, canRecover: false });
  f.pending();
  f.conflict();
  await vi.advanceTimersByTimeAsync(0);
  f.handle.recover();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.saves.at(-1)?.recovery).toBeUndefined();
  expect(f.offline.prepareRecovery).not.toHaveBeenCalled();
  expect(f.offline.publishRecovery).not.toHaveBeenCalled();
  expect(f.offline.finishRecovery).not.toHaveBeenCalled();
  expect(f.offline.pending).toBe(true);
  expect(f.client.disposed).toBe(false);
});

test.each(['metadata', 'publication'] as const)(
  'a 401 from %s holds durable work for local export until the explicit sign-in action',
  async (source) => {
    const f = await fixture({ downloaded: true, canRecover: true });
    f.pending();
    if (source === 'metadata') {
      f.metadata(async () => Response.json({}, { status: 401 }));
      await vi.advanceTimersByTimeAsync(1000);
    } else {
      f.offline.publishRecovery.mockRejectedValueOnce(
        Object.assign(new Error('Your sign-in ended.'), { status: 401 }),
      );
      f.conflict();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(f.offline.endAuthentication).toHaveBeenCalledOnce();
    expect(f.saves.at(-1)).toMatchObject({
      retained: true,
      signInRequired: true,
      local: 'attention',
    });
    expect(f.saves.at(-1)?.recovery).toBeDefined();
    expect(f.signIn).not.toHaveBeenCalled();
    expect(f.client.disposed).toBe(false);
    expect(f.offline.pending).toBe(true);
    expect(f.offline.finishRecovery).not.toHaveBeenCalled();
    const publications = f.offline.publishRecovery.mock.calls.length;
    f.handle.exportRecovery();
    await vi.waitFor(() => expect(downloadOfflineFile).toHaveBeenCalledOnce());
    expect(downloadOfflineFile).toHaveBeenCalledWith(
      f.recoveryRequest.snapshot,
      'Offline notes (offline copy, 2026-10-27 14:35).univer.json',
    );
    expect(f.offline.publishRecovery).toHaveBeenCalledTimes(publications);
    expect(f.offline.finishRecovery).not.toHaveBeenCalled();
    expect(f.offline.pending).toBe(true);
    expect(f.client.disposed).toBe(false);
    expect(f.signIn).not.toHaveBeenCalled();
    f.handle.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.signIn).toHaveBeenCalledExactlyOnceWith('/sign-in');
    expect(f.client.disposed).toBe(true);
    expect(f.offline.pending).toBe(true);
    expect(f.offline.finishRecovery).not.toHaveBeenCalled();
  },
);

test.each(['freeze', 'drain', 'prepare', 'publish'] as const)(
  'account invalidation while recovery waits for %s fences every later publication and local cleanup',
  async (stage) => {
    const f = await fixture({ downloaded: true, canRecover: true });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (stage === 'freeze') f.readonly.mockImplementationOnce(() => held);
    if (stage === 'drain') f.offline.persist.mockImplementationOnce(() => held);
    if (stage === 'prepare')
      f.offline.prepareRecovery.mockImplementationOnce(async () => {
        await held;
        return f.recoveryRequest;
      });
    if (stage === 'publish')
      f.offline.publishRecovery.mockImplementationOnce(async () => {
        await held;
        return f.copyItem;
      });
    f.pending();
    f.conflict();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.offline.finishRecovery).not.toHaveBeenCalled();
    const reports = f.saves.length;
    f.offline.current = false;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.offline.publishRecovery).toHaveBeenCalledTimes(stage === 'publish' ? 1 : 0);
    expect(f.offline.finishRecovery).not.toHaveBeenCalled();
    expect(downloadOfflineFile).not.toHaveBeenCalled();
    expect(f.offline.pending).toBe(true);
    expect(f.signIn).not.toHaveBeenCalled();
    expect(f.saves).toHaveLength(reports);
    expect(f.reload).not.toHaveBeenCalled();
  },
);

test('a socket open is not room readiness or a durable save, and reconnect retains pending status', async () => {
  const f = await fixture();
  expect(new URL(f.socket().url).searchParams.get('afterRevision')).toBe('8');
  f.socket().open();
  expect(f.connections.at(-1)).toBe('reconnecting');
  expect(f.saves.at(-1)?.message).not.toBe('All changes saved.');
  f.socket().frame({
    type: 'resume',
    version: 1,
    unitId: 'unit',
    fromRevision: 8,
    revision: 8,
    edits: [],
  });
  expect(f.connections.at(-1)).toBe('online');
  expect(f.saves.at(-1)).toMatchObject({
    dirty: false,
    failed: false,
    message: 'All changes saved.',
  });
  f.pending();
  expect(f.saves.at(-1)).toMatchObject({ dirty: true, failed: false });
  f.socket().close();
  expect(f.saves.at(-1)).toMatchObject({ dirty: true, failed: true });
  await vi.advanceTimersByTimeAsync(300);
  expect(Socket.instances).toHaveLength(2);
  f.socket().open();
  f.socket().frame({
    type: 'resume',
    version: 1,
    unitId: 'unit',
    fromRevision: 8,
    revision: 9,
    edits: [],
  });
  expect(f.saves.at(-1)).toMatchObject({ dirty: true });
  f.socket().frame({
    type: 'ack',
    mutationId: 'sent',
    revision: 10,
    mutations: [],
    touched: { kind: 'doc' },
    hash: 'hash',
    duplicate: true,
  });
  expect(f.saves.at(-1)).toMatchObject({ dirty: false, failed: false });
});

test.each(['response', 'body'] as const)(
  'preparing a Space child during its metadata %s rechecks access without freezing the editor',
  async (stage) => {
    const f = await fixture({ preparing: true, space: true });
    f.socket().open();
    f.socket().frame({
      type: 'resume',
      version: 1,
      unitId: 'unit',
      fromRevision: 8,
      revision: 8,
      edits: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.saves.at(-1)?.message).toBe('All changes saved.');

    const metadata = { item: { access: 'editor' }, live: { unitId: 'unit' } };
    const response = Response.json(metadata);
    let release!: () => void;
    if (stage === 'response') {
      const held = new Promise<Response>((resolve) => {
        release = () => resolve(response);
      });
      f.metadata(() => held);
    } else {
      const held = new Promise<typeof metadata>((resolve) => {
        release = () => resolve(metadata);
      });
      vi.spyOn(response, 'json').mockImplementationOnce(() => held);
      f.metadata(async () => response);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.requests.mock.calls.at(-1)?.[0]).toBe(`/api/spaces/${item}/items/${child}`);
    expect(f.requests.mock.calls.at(-1)?.[1]?.method).toBeUndefined();

    // Preparation activates the existing native binding through its real
    // event/persistence path while the ordinary metadata read is still held.
    f.offline.persist.mockImplementationOnce(async () => {
      f.offline.enabled = true;
      f.offline.onChange?.();
    });
    window.dispatchEvent(
      new CustomEvent('spinel-offline-prepared', { detail: { accountId: 'owner' } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(f.offline.reconcileAvailability).toHaveBeenCalledOnce();
    expect(f.offline.persist).toHaveBeenCalledOnce();
    expect(f.offline.persist.mock.calls[0][0]).toMatchObject({ sent: null, buffer: [] });
    expect(f.offline.persist.mock.calls[0][0].failure).toBeUndefined();

    let confirm!: (response: Response) => void;
    const confirmation = new Promise<Response>((resolve) => {
      confirm = resolve;
    });
    f.metadata(() => confirmation);
    const requests = f.requests.mock.calls.length;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.requests).toHaveBeenCalledTimes(requests + 1);
    expect(f.requests.mock.calls.at(-1)).toEqual([
      `/api/spaces/${item}/items/${child}/collaboration`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    ]);
    expect(f.readonly).not.toHaveBeenCalled();
    expect(f.offline.stopRemote).not.toHaveBeenCalled();
    expect(f.offline.refreshClean).not.toHaveBeenCalled();
    expect(f.offline.removeClean).not.toHaveBeenCalled();
    expect(f.client.state.resyncing).toBe(false);

    confirm(Response.json({ access: 'editor', unitId: 'unit', user: { id: 'owner' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.saves.at(-1)).toMatchObject({
      local: 'synced',
      failed: false,
      message: 'Synced. All changes are saved on the server and this device.',
    });
    expect(f.socket().readyState).toBe(Socket.OPEN);
    expect(f.reload).not.toHaveBeenCalled();

    // The obsolete response does not weaken the next real access denial or
    // allow it to delete an edit made after preparation completed.
    f.pending();
    f.metadata(async () => Response.json({}, { status: 403 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.saves.at(-1)).toMatchObject({ local: 'attention', retained: true });
    expect(f.client.state.resyncing).toBe(true);
    expect(f.readonly).toHaveBeenCalled();
    expect(f.offline.pending).toBe(true);
    expect(f.offline.removeClean).not.toHaveBeenCalled();
    expect(f.offline.refreshClean).not.toHaveBeenCalled();
  },
);

test('a clean downloaded base outside replay retention refreshes without retaining a failure', async () => {
  const f = await fixture({ downloaded: true });
  f.socket().open();
  f.socket().frame({ type: 'resync', reason: 'stale' });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.readonly).toHaveBeenCalledOnce();
  expect(f.offline.persist).toHaveBeenCalledOnce();
  expect(f.offline.refreshClean).toHaveBeenCalledOnce();
  expect(f.client.received).toEqual([]);
  expect(f.client.disposed).toBe(true);
  expect(f.reload).toHaveBeenCalledWith('stale', true);
});

test.each([403, 404])(
  'verified %s removes a clean downloaded child after freezing and draining, without inventing edits',
  async (status) => {
    const f = await fixture({ downloaded: true, space: true });
    const order: string[] = [];
    f.readonly.mockImplementationOnce(async () => {
      order.push('freeze');
    });
    f.offline.persist.mockImplementationOnce(async () => {
      order.push('drain');
    });
    f.offline.removeClean.mockImplementationOnce(async (verify) => {
      verify();
      order.push('remove');
    });
    f.metadata(async () => Response.json({}, { status }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['freeze', 'drain', 'remove']);
    expect(f.offline.refreshClean).not.toHaveBeenCalled();
    expect(f.client.state.resyncing).toBe(false);
    expect(f.client.disposed).toBe(true);
    expect(f.lock).toHaveBeenCalledOnce();
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.requests.mock.calls.at(-1)?.[0]).toBe(
      `/api/spaces/${item}/items/${child}/collaboration`,
    );
  },
);

test.each([false, true])(
  'a 401 expires preparation and drains locally, retaining pending work before explicit sign-in (pending: %s)',
  async (pending) => {
    const f = await fixture({ downloaded: true });
    if (pending) f.pending();
    const order: string[] = [];
    f.readonly.mockImplementationOnce(async (preserveInput) => {
      expect(f.offline.stopAuthenticationHTTP).toHaveBeenCalledOnce();
      expect(preserveInput).toBe(true);
      order.push('freeze');
    });
    f.offline.persist.mockImplementationOnce(async () => {
      order.push('persist');
    });
    f.offline.endAuthentication.mockImplementationOnce(() => {
      order.push('expire');
    });
    f.metadata(async () => Response.json({}, { status: 401 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['expire', 'freeze', 'persist']);
    expect(f.offline.removeClean).not.toHaveBeenCalled();
    expect(f.offline.refreshClean).not.toHaveBeenCalled();
    expect(f.client.state.resyncing).toBe(false);
    expect(f.client.disposed).toBe(!pending);
    if (pending) {
      expect(f.offline.pending).toBe(true);
      expect(f.signIn).not.toHaveBeenCalled();
      expect(f.saves.at(-1)).toMatchObject({
        retained: true,
        signInRequired: true,
        local: 'attention',
      });
      f.handle.retry();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.signIn).toHaveBeenCalledWith('/sign-in');
      expect(f.offline.pending).toBe(true);
      expect(f.client.disposed).toBe(true);
    } else expect(f.signIn).toHaveBeenCalledWith('/sign-in');
  },
);

test.each(['disk', 'recovery', 'host input', 'timeout'] as const)(
  'a 401 disables offline reopening but retains the visible editor after %s prevents a safe exit',
  async (failure) => {
    const f = await fixture({ downloaded: true, canRefresh: () => failure !== 'host input' });
    f.pending();
    if (failure === 'disk') f.offline.persist.mockRejectedValueOnce(new Error('Disk full'));
    if (failure === 'recovery') f.client.state.recoveryMissing = true;
    if (failure === 'timeout')
      f.offline.persist.mockImplementationOnce(() => new Promise(() => {}));
    f.metadata(async () => Response.json({}, { status: 401 }));
    await vi.advanceTimersByTimeAsync(4001);
    expect(f.offline.endAuthentication).toHaveBeenCalledOnce();
    expect(f.offline.removeClean).not.toHaveBeenCalled();
    expect(f.client.disposed).toBe(false);
    expect(f.signIn).not.toHaveBeenCalled();
    expect(f.readonly).toHaveBeenCalledWith(true);
    expect(f.socket().readyState).toBe(3);
    if (failure === 'disk') {
      expect(f.saves.at(-1)).toMatchObject({ dirty: true, local: 'failed' });
      f.handle.retry();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.signIn).toHaveBeenCalledWith('/sign-in');
      expect(f.client.disposed).toBe(true);
    }
  },
);

test('durable expired work exposes a sign-in handoff that still waits for unfinished host input', async () => {
  let unfinished = true;
  const f = await fixture({ downloaded: true, canRefresh: () => !unfinished });
  f.pending();
  f.metadata(async () => Response.json({}, { status: 401 }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.saves.at(-1)).toMatchObject({
    dirty: false,
    local: 'attention',
    retained: true,
    signInRequired: true,
  });
  f.handle.retry();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.signIn).not.toHaveBeenCalled();
  unfinished = false;
  f.handle.retry();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.signIn).toHaveBeenCalledOnce();
  expect(f.client.state.pending).toBe(true);
  expect(f.offline.removeClean).not.toHaveBeenCalled();
});

test('an account change during the 401 local drain cannot clear or redirect the new account', async () => {
  const f = await fixture({ downloaded: true });
  f.offline.persist.mockImplementationOnce(async () => {
    f.offline.current = false;
  });
  f.metadata(async () => Response.json({}, { status: 401 }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.offline.endAuthentication).toHaveBeenCalledOnce();
  expect(f.signIn).not.toHaveBeenCalled();
});

test.each(['viewer', 'generation'] as const)(
  'a clean authorized %s change refreshes the download and reopens without a failure checkpoint',
  async (change) => {
    const f = await fixture({ downloaded: true });
    f.metadata(async () =>
      Response.json({
        access: change === 'viewer' ? 'viewer' : 'editor',
        unitId: change === 'generation' ? 'replacement' : 'unit',
        user: { id: 'owner' },
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.readonly).toHaveBeenCalledOnce();
    expect(f.offline.persist).toHaveBeenCalledOnce();
    expect(f.offline.refreshClean).toHaveBeenCalledOnce();
    expect(f.offline.removeClean).not.toHaveBeenCalled();
    expect(f.client.state.resyncing).toBe(false);
    expect(f.client.disposed).toBe(true);
    expect(f.reload).toHaveBeenCalledWith('stale', true);
    expect(f.lock).not.toHaveBeenCalled();
  },
);

test.each([false, true])(
  'an expected-account 409 never removes or replaces the prior account copy (pending: %s)',
  async (pending) => {
    const f = await fixture({ downloaded: true });
    if (pending) f.pending();
    f.metadata(async () => Response.json({}, { status: 409 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.offline.removeClean).not.toHaveBeenCalled();
    expect(f.offline.refreshClean).not.toHaveBeenCalled();
    expect(f.client.disposed).toBe(false);
    expect(f.client.state.resyncing).toBe(pending);
    expect(f.saves.at(-1)?.local).toBe('attention');
    expect(f.readonly).toHaveBeenCalled();
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.lock).not.toHaveBeenCalled();
  },
);

test.each(['queue', 'durable queue', 'recovery', 'host input'] as const)(
  'access loss retains %s and does not delete or replace the downloaded copy',
  async (work) => {
    const f = await fixture({ downloaded: true, canRefresh: () => work !== 'host input' });
    if (work === 'queue') f.pending();
    if (work === 'durable queue') f.offline.pending = true;
    if (work === 'recovery') {
      f.client.state.recoveryMissing = true;
      f.client.options.onState(f.client.state);
    }
    f.metadata(async () => Response.json({}, { status: 404 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.offline.removeClean).not.toHaveBeenCalled();
    expect(f.offline.refreshClean).not.toHaveBeenCalled();
    expect(f.client.disposed).toBe(false);
    expect(f.client.state.resyncing).toBe(true);
    expect(f.saves.at(-1)?.local).toBe(work === 'recovery' ? 'failed' : 'attention');
    expect(f.readonly).toHaveBeenCalled();
  },
);

test.each(['freeze', 'drain', 'commit'] as const)(
  'an edit appearing during clean access-loss %s is retained instead of removed',
  async (stage) => {
    const f = await fixture({ downloaded: true });
    if (stage === 'freeze') f.readonly.mockImplementationOnce(async () => f.pending());
    if (stage === 'drain') f.offline.persist.mockImplementationOnce(async () => f.pending());
    if (stage === 'commit')
      f.offline.removeClean.mockImplementationOnce(async (verify) => {
        f.pending();
        verify();
      });
    f.metadata(async () => Response.json({}, { status: 403 }));
    await vi.advanceTimersByTimeAsync(1000);
    if (stage !== 'commit') expect(f.offline.removeClean).not.toHaveBeenCalled();
    expect(f.client.state.pending).toBe(true);
    expect(f.client.state.resyncing).toBe(true);
    expect(f.client.disposed).toBe(false);
    expect(f.lock).not.toHaveBeenCalled();
    expect(f.reload).not.toHaveBeenCalled();
  },
);

test('a failed clean removal shows attention without creating a permanent recovery checkpoint', async () => {
  const f = await fixture({ downloaded: true });
  f.offline.removeClean.mockRejectedValueOnce(new Error('Disk failure'));
  f.metadata(async () => Response.json({}, { status: 403 }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.saves.at(-1)).toMatchObject({ local: 'attention', dirty: false, retained: false });
  expect(f.client.state.resyncing).toBe(false);
  expect(f.client.disposed).toBe(false);
  expect(f.lock).not.toHaveBeenCalled();
});

test('a stale clean queue cannot replace uncommitted host cell input or an image insertion', async () => {
  let inputFinished = false;
  const f = await fixture({ downloaded: true, canRefresh: () => inputFinished });
  f.socket().open();
  f.socket().frame({ type: 'resync', reason: 'stale' });
  await vi.advanceTimersByTimeAsync(300);
  expect(f.readonly).not.toHaveBeenCalled();
  expect(f.offline.refreshClean).not.toHaveBeenCalled();
  expect(f.reload).not.toHaveBeenCalled();
  expect(f.client.received).toEqual([]);
  // Finishing the native input normally creates pending queue work; that work
  // must take the conservative conflict path on the next stale response.
  inputFinished = true;
  f.pending();
  f.socket().open();
  f.socket().frame({ type: 'resync', reason: 'stale' });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.refreshClean).not.toHaveBeenCalled();
  expect(f.client.received).toEqual([{ type: 'resync', reason: 'stale' }]);
});

test('a stale response never refreshes a downloaded document with pending local work', async () => {
  const f = await fixture({ downloaded: true });
  f.pending();
  f.socket().open();
  f.socket().frame({ type: 'resync', reason: 'stale' });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.offline.refreshClean).not.toHaveBeenCalled();
  expect(f.client.received).toEqual([{ type: 'resync', reason: 'stale' }]);
  expect(f.reload).not.toHaveBeenCalled();
});

test.each(['count', 'bytes'] as const)(
  'incoming offline frames are bounded by %s before a stalled image read',
  async (limit) => {
    const f = await fixture({ downloaded: true });
    let release!: () => void;
    f.offline.prepareImages.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    f.socket().open();
    const stalled = f.socket();
    stalled.frame({
      type: 'resume',
      version: 1,
      unitId: 'unit',
      fromRevision: 8,
      revision: 8,
      edits: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    const signal = f.offline.prepareImages.mock.calls[0]![1]!;
    if (limit === 'count') {
      for (let i = 0; i < 129; i++) stalled.frame({ type: 'edit', revision: i + 9, mutations: [] });
    } else stalled.onmessage?.({ data: 'x'.repeat(10 * 1024 * 1024 + 1) });
    expect(stalled.readyState).toBe(3);
    expect(signal.aborted).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(300);
    expect(f.client.received).toEqual([]);
    expect(f.offline.prepareImages).toHaveBeenCalledOnce();
    expect(Socket.instances).toHaveLength(2);
    expect(f.reload).not.toHaveBeenCalled();
  },
);

test('uncaptured visible recovery edits keep the navigation warning after a failure marker saves', async () => {
  const f = await fixture({ downloaded: true });
  f.client.options.onState({
    ...f.client.state,
    recoveryMissing: true,
    resyncing: true,
    localPersistence: 'saved',
  });
  expect(f.saves.at(-1)).toMatchObject({ dirty: true, failed: true, local: 'failed' });
  expect(f.saves.at(-1)?.message).toContain('Keep this tab open');
});

test.each(['saving', 'failed'] as const)(
  'attention never conceals a %s local checkpoint or its navigation warning',
  async (localPersistence) => {
    const f = await fixture({ downloaded: true });
    f.client.state = {
      ...f.client.state,
      pending: true,
      resyncing: true,
      localPersistence,
    };
    f.client.options.onState(f.client.state);
    expect(f.saves.at(-1)).toMatchObject({ dirty: true, failed: true, local: localPersistence });
    expect(f.saves.at(-1)?.message).toContain('attention');
    if (localPersistence === 'failed') {
      expect(f.saves.at(-1)?.message).toContain('Keep this tab open and retry saving');
      expect(f.saves.at(-1)?.message).not.toContain('saved device copy is retained');
    }
    f.client.state.localPersistence = 'saved';
    f.client.options.onState(f.client.state);
    expect(f.saves.at(-1)).toMatchObject({ dirty: false, failed: true, local: 'attention' });
  },
);

test('durable offline work retains an unavailable page without marking it unsaved', async () => {
  const f = await fixture({ downloaded: true, space: true });
  f.client.state = {
    ...f.client.state,
    pending: true,
    pendingMutations: 1,
    localPersistence: 'saved',
  };
  f.client.options.onState(f.client.state);
  expect(f.saves.at(-1)).toMatchObject({ dirty: false, retained: true, local: 'saved' });
  f.metadata(async () => Response.json({}, { status: 404 }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.saves.at(-1)).toMatchObject({ dirty: false, retained: true, local: 'attention' });
  expect(f.readonly).toHaveBeenCalled();
  expect(f.client.disposed).toBe(false);
});

test('a clean downloaded copy has no retained-work flag and a completed queue clears it', async () => {
  const f = await fixture({ downloaded: true });
  expect(f.saves.at(-1)).toMatchObject({ dirty: false, retained: false });
  f.pending();
  expect(f.saves.at(-1)?.retained).toBe(true);
  f.client.state = {
    ...f.client.state,
    pending: false,
    pendingMutations: 0,
    localPersistence: 'saved',
  };
  f.offline.pending = false;
  f.client.options.onState(f.client.state);
  expect(f.saves.at(-1)).toMatchObject({ dirty: false, retained: false });
});

test('ordinary guest pending work keeps its original dirty behavior without offline retention', async () => {
  const f = await fixture({ guest: true, space: true });
  f.pending();
  expect(f.saves.at(-1)?.dirty).toBe(true);
  expect(f.saves.at(-1)?.retained).toBeUndefined();
});

test('pending work publishes before the readiness watcher or socket can start', async () => {
  let guarded = false;
  const f = await fixture({
    onInitialPending() {
      guarded = true;
    },
    beforeWatch() {
      expect(Socket.instances).toHaveLength(0);
      const client = native.clients.at(-1)!;
      client.state = { ...client.state, pending: true, pendingMutations: 1 };
      client.options.onState(client.state);
      expect(guarded).toBe(true);
      expect(Socket.instances).toHaveLength(0);
    },
  });
  expect(f.saves.at(-1)?.dirty).toBe(true);
});

test('initial access completes before capture or socket startup even when readiness is delayed', async () => {
  let release!: () => void;
  let applied = false;
  const loading = fixture({
    initializeAccess() {
      applied = true;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(applied).toBe(true);
  expect(native.clients).toHaveLength(0);
  expect(Socket.instances).toHaveLength(0);
  release();
  const f = await loading;
  expect(native.clients).toHaveLength(1);
  expect(f.univer.createUnit).toHaveBeenCalledOnce();
});

test('Space guest socket, tickets and metadata stay in the exact root/child scope', async () => {
  const f = await fixture({ guest: true, space: true });
  const prefix = `/sync-api/guest-spaces/${item}/items/${child}`;
  expect(f.requests.mock.calls.slice(0, 2).every(([url]) => url.startsWith(prefix))).toBe(true);
  expect(new URL(f.socket().url).pathname).toBe(`${prefix}/socket`);
  f.metadata(async () => Response.json({}, { status: 403 }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.dispatched.mock.calls.some(([event]) => event.type === 'spinel-guest-revoked')).toBe(
    true,
  );
  expect(f.socket().readyState).toBe(3);
});

test.each([false, true])(
  'a stalled socket or initial replay reconnects without clearing pending edits (opened=%s)',
  async (opened) => {
    const f = await fixture();
    f.pending();
    const stalled = f.socket();
    if (opened) stalled.open();
    await vi.advanceTimersByTimeAsync(15_300);
    expect(stalled.readyState).toBe(3);
    expect(Socket.instances).toHaveLength(2);
    expect(f.saves.at(-1)).toMatchObject({ dirty: true, failed: true });
    expect(new URL(f.socket().url).searchParams.get('afterRevision')).toBe('8');
    expect(f.reload).not.toHaveBeenCalled();
  },
);

test('a departed child’s late access denial cannot revoke the replacement guest or publish old status', async () => {
  const f = await fixture({ guest: true, space: true });
  let release!: (response: Response) => void;
  f.metadata(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(1000);
  f.leave();
  const reports = f.saves.length;
  release(Response.json({}, { status: 403 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.dispatched).not.toHaveBeenCalled();
  expect(f.saves).toHaveLength(reports);
});

test('membership disappears on disconnect, and disposal fences late socket and native callbacks', async () => {
  const f = await fixture();
  const updates: unknown[] = [];
  getSyncPresence(f.univer, 'unit')!.subscribe((state) => updates.push(state));
  f.socket().open();
  f.socket().frame({
    type: 'resume',
    version: 1,
    unitId: 'unit',
    fromRevision: 8,
    revision: 8,
    edits: [],
  });
  f.socket().frame({
    type: 'presence',
    selfId: 'me',
    members: [{ id: 'peer', name: 'Collaborator', avatar: '', selection: '0:0:1:TEXT::-1' }],
  });
  expect(updates.at(-1)).toMatchObject({ connected: true, members: [{ id: 'peer' }] });
  f.socket().close();
  expect(updates.at(-1)).toMatchObject({ connected: false, members: [] });
  f.handle.dispose();
  const reports = f.saves.length;
  f.client.options.onState({ ...f.client.state, connected: true, pending: false });
  f.socket().frame({
    type: 'resume',
    version: 1,
    unitId: 'unit',
    fromRevision: 8,
    revision: 8,
    edits: [],
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.saves).toHaveLength(reports);
  expect(f.client.disposed).toBe(true);
  expect(getSyncPresence(f.univer, 'unit')).toBeUndefined();
  expect(Socket.instances).toHaveLength(1);
});

test('restore or role change keeps pending work unsaved and makes the editor readonly', async () => {
  const f = await fixture();
  f.pending();
  f.metadata(async () =>
    Response.json({ item: { access: 'editor' }, live: { unitId: 'replacement' } }),
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.readonly).toHaveBeenCalledOnce();
  expect(f.saves.at(-1)).toMatchObject({ dirty: true, failed: true });
  expect(f.saves.at(-1)?.message).toContain('restored');
  expect(f.socket().readyState).toBe(3);
  expect(f.reload).not.toHaveBeenCalled();
});
