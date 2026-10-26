import { afterEach, expect, test, vi } from 'vitest';
import type { NativeSyncOptions, ClientState, IncomingFrame } from '@spinel/sync-client';
import type { Univer } from '@univerjs/core';
import { disposeSpinelSync, getSpinelSync, loadSpinelDocument } from '../../web/spinelSync.ts';
import { getSyncPresence } from '../../web/syncPresence.ts';
import type { SaveState } from '../shared/autosave.ts';
import type { ConnectionState } from '../../web/connectionState.ts';

const native = vi.hoisted(() => ({
  clients: [] as {
    options: NativeSyncOptions;
    state: ClientState;
    disposed: boolean;
  }[],
}));
vi.mock('@univerjs/core', () => ({ UniverInstanceType: { UNIVER_SHEET: 2, UNIVER_DOC: 1 } }));
vi.mock('@spinel/sync-client', () => ({
  createNativeSyncClient(options: NativeSyncOptions) {
    const entry = {
      options,
      state: {
        revision: options.revision,
        pending: false,
        pendingMutations: 0,
        connected: false,
        resyncing: false,
      },
      disposed: false,
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
        if (frame.type === 'resume' || frame.type === 'ack') entry.state.revision = frame.revision;
        if (frame.type === 'ack') entry.state.pending = false;
        options.onState(entry.state);
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
  native.clients.length = 0;
  Socket.instances.length = 0;
});
const item = '11111111-1111-4111-8111-111111111111';
const child = '22222222-2222-4222-8222-222222222222';

async function fixture({
  guest = false,
  space = false,
  initializeAccess,
}: { guest?: boolean; space?: boolean; initializeAccess?(): void | Promise<void> } = {}) {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', {
    pathname: guest ? `/share/${item}` : '/',
    origin: 'https://spinel.test',
    protocol: 'https:',
  });
  const events = new EventTarget();
  const dispatched = vi.spyOn(events, 'dispatchEvent');
  vi.stubGlobal('window', events);
  vi.stubGlobal('WebSocket', Socket);
  let current = true;
  let metadata: () => Promise<Response> = async () =>
    Response.json({ item: { access: 'editor' }, live: { unitId: 'unit' } });
  const requests = vi.fn(async (input: string) => {
    if (input.includes('/snapshot?'))
      return Response.json({
        version: 1,
        unitId: 'unit',
        revision: 8,
        snapshot: { id: 'unit', body: { dataStream: '\r\n' } },
      });
    if (input.includes('/ticket?')) return Response.json({ version: 1, ticket: 'one-use-ticket' });
    return metadata();
  });
  vi.stubGlobal('fetch', requests);
  const univer = { createUnit: vi.fn() } as unknown as Univer;
  const abort = new AbortController();
  stops.push(() => {
    abort.abort();
    disposeSpinelSync(univer);
  });
  const reload = vi.fn();
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
    reload,
  });
  const saves: SaveState[] = [];
  const connections: ConnectionState[] = [];
  const readonly = vi.fn(async () => {});
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
    dispatched,
    client,
    socket: () => Socket.instances.at(-1)!,
    leave() {
      current = false;
    },
    metadata(reply: () => Promise<Response>) {
      metadata = reply;
    },
    pending() {
      client.state.pending = true;
      client.state.pendingMutations = 1;
      client.options.onState(client.state);
    },
  };
}

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
