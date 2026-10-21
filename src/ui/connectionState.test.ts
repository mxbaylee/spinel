import { afterEach, expect, test, vi } from 'vitest';
import {
  createEditorConnection,
  reduceEditorConnection,
  watchServerConnection,
} from '../../web/connectionState.ts';
import type { ConnectionState, EditorConnectionEvent } from '../../web/connectionState.ts';

function editor(...events: EditorConnectionEvent[]) {
  return events.reduce(reduceEditorConnection, createEditorConnection(true));
}
const active = { type: 'sync', status: 'active' } as const;
const joined = { type: 'room', status: 'online' } as const;

test('an editor needs both an active collaboration unit and a joined room', () => {
  expect(createEditorConnection(true).state).toBe('reconnecting');
  expect(createEditorConnection(false).state).toBe('offline');
  expect(editor(active).state).toBe('reconnecting');
  expect(editor(joined).state).toBe('reconnecting');
  expect(editor(active, joined).state).toBe('online');
  expect(editor(joined, active).state).toBe('online');
});

test('ordinary synchronization changes do not make a joined editor reconnect', () => {
  // Pending edits and acknowledgements normalize to active: connectivity never confirms a save.
  let connection = editor(active, joined);
  for (let edit = 0; edit < 3; edit++) {
    connection = reduceEditorConnection(connection, active);
    expect(connection.state).toBe('online');
  }
});

test.each([
  [{ type: 'room', status: 'idle' }, 'reconnecting'],
  [{ type: 'room', status: 'joining' }, 'reconnecting'],
  [{ type: 'room', status: 'offline' }, 'offline'],
  [{ type: 'sync', status: 'offline' }, 'offline'],
  [{ type: 'sync', status: 'not-started' }, 'reconnecting'],
] satisfies [EditorConnectionEvent, ConnectionState][])(
  'a joined editor reflects %j',
  (event, expected) => {
    expect(reduceEditorConnection(editor(active, joined), event).state).toBe(expected);
  },
);

test('browser recovery cannot reuse a stale joined room or a synchronization callback', () => {
  let connection = editor(active, joined);
  connection = reduceEditorConnection(connection, { type: 'browser', online: false });
  expect(connection.state).toBe('offline');
  connection = reduceEditorConnection(connection, joined);
  expect(connection.state).toBe('offline');
  connection = reduceEditorConnection(connection, { type: 'browser', online: true });
  expect(connection.state).toBe('reconnecting');
  connection = reduceEditorConnection(connection, active);
  expect(connection.state).toBe('reconnecting');
  connection = reduceEditorConnection(connection, joined);
  expect(connection.state).toBe('online');
});

test('explicit reconnect waits for a new room event, including while offline', () => {
  expect(editor(active, joined, { type: 'reconnect' }, active).state).toBe('reconnecting');
  expect(editor(active, joined, { type: 'reconnect' }, joined).state).toBe('online');
  expect(
    editor(active, joined, { type: 'browser', online: false }, { type: 'reconnect' }, joined).state,
  ).toBe('offline');
});

test('rejoining can progress while the previous collaboration status still says offline', () => {
  let connection = editor(active, joined, { type: 'sync', status: 'offline' });
  connection = reduceEditorConnection(connection, { type: 'reconnect' });
  expect(connection.state).toBe('reconnecting');
  connection = reduceEditorConnection(connection, joined);
  expect(connection.state).toBe('offline');
  connection = reduceEditorConnection(connection, active);
  expect(connection.state).toBe('online');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function server(online = true) {
  vi.useFakeTimers();
  const browser = new EventTarget();
  const navigator = { onLine: online };
  vi.stubGlobal('window', browser);
  vi.stubGlobal('navigator', navigator);
  const requests: (ReturnType<typeof deferred<Response>> & { signal: AbortSignal })[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
    const reply = deferred<Response>();
    // Intentionally permit completion after abort, proving stale results are ignored too.
    requests.push({ ...reply, signal: init!.signal! });
    return reply.promise;
  });
  vi.stubGlobal('fetch', fetch);
  const states: ConnectionState[] = [];
  const ended = vi.fn();
  const stop = watchServerConnection((state) => states.push(state), ended);
  stops.push(stop);
  return {
    requests,
    fetch,
    states,
    ended,
    stop,
    network(value: boolean) {
      navigator.onLine = value;
      browser.dispatchEvent(new Event(value ? 'online' : 'offline'));
    },
  };
}
const ok = () => Response.json({ status: 'ok' });
const settle = () => vi.advanceTimersByTimeAsync(0);

test('server connectivity requires a valid fresh health response, not browser online alone', async () => {
  const check = server();
  expect(check.states).toEqual(['reconnecting']);
  expect(check.fetch).toHaveBeenCalledWith(
    '/api/health',
    expect.objectContaining({ cache: 'no-store', credentials: 'same-origin', redirect: 'error' }),
  );
  check.requests[0].resolve(ok());
  await settle();
  expect(check.states).toEqual(['reconnecting', 'online']);
  await vi.advanceTimersByTimeAsync(3000);
  expect(check.requests).toHaveLength(2);
  expect(check.states.at(-1)).toBe('online');
  check.requests[1].resolve(ok());
  await settle();
  expect(check.states).toEqual(['reconnecting', 'online']);
});

test.each([
  ['a failed status', () => Response.json({ status: 'ok' }, { status: 503 })],
  ['an unrelated JSON body', () => Response.json({ user: 'someone' })],
  ['an invalid JSON body', () => new Response('<html>Sign in</html>')],
  ['a null JSON body', () => Response.json(null)],
])('%s never establishes Online', async (_name, response) => {
  const check = server();
  check.requests[0].resolve(response());
  await settle();
  expect(check.states).toEqual(['reconnecting', 'offline']);
});

test('a browser outage is immediate and a stale success cannot undo it or a later reconnect', async () => {
  const check = server();
  check.network(false);
  expect(check.states).toEqual(['reconnecting', 'offline']);
  expect(check.requests[0].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(9000);
  expect(check.requests).toHaveLength(1);
  check.network(true);
  expect(check.states.at(-1)).toBe('reconnecting');
  expect(check.requests).toHaveLength(2);
  check.requests[0].resolve(ok());
  await settle();
  expect(check.states.at(-1)).toBe('reconnecting');
  check.requests[1].resolve(ok());
  await settle();
  expect(check.states.at(-1)).toBe('online');
});

test('starting offline sends no probe until the browser returns', async () => {
  const check = server(false);
  expect(check.states).toEqual(['offline']);
  await vi.advanceTimersByTimeAsync(9000);
  expect(check.requests).toHaveLength(0);
  check.network(true);
  expect(check.states).toEqual(['offline', 'reconnecting']);
  expect(check.requests).toHaveLength(1);
});

test('a polling tick does not overlap a probe started by a browser event', async () => {
  const check = server(false);
  await vi.advanceTimersByTimeAsync(2500);
  check.network(true);
  await vi.advanceTimersByTimeAsync(500);
  expect(check.requests).toHaveLength(1);
  expect(check.requests[0].signal.aborted).toBe(false);
  check.requests[0].resolve(ok());
  await settle();
  await vi.advanceTimersByTimeAsync(3000);
  expect(check.requests).toHaveLength(2);
});

test('a hung request times out, is aborted, and never overlaps its replacement', async () => {
  const check = server();
  await vi.advanceTimersByTimeAsync(1999);
  expect(check.requests).toHaveLength(1);
  expect(check.requests[0].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(check.states.at(-1)).toBe('offline');
  expect(check.requests[0].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(check.requests).toHaveLength(2);
  check.requests[1].resolve(ok());
  await settle();
  check.requests[0].reject(new TypeError('Late network error'));
  await settle();
  expect(check.states.at(-1)).toBe('online');
});

test('the timeout includes reading the health body and ignores its late success', async () => {
  const check = server();
  const body = deferred<unknown>();
  check.requests[0].resolve({ ok: true, status: 200, json: () => body.promise } as Response);
  await settle();
  await vi.advanceTimersByTimeAsync(2000);
  expect(check.states.at(-1)).toBe('offline');
  body.resolve({ status: 'ok' });
  await settle();
  expect(check.states.at(-1)).toBe('offline');
});

test('an ordinary failed request recovers on a later successful probe', async () => {
  const check = server();
  check.requests[0].reject(new TypeError('Failed to fetch'));
  await settle();
  expect(check.states.at(-1)).toBe('offline');
  await vi.advanceTimersByTimeAsync(3000);
  check.requests[1].resolve(ok());
  await settle();
  expect(check.states.at(-1)).toBe('online');
});

test('a 401 ends the session once without presenting it as an offline entitlement', async () => {
  const check = server();
  check.requests[0].resolve(Response.json({ error: 'Sign in' }, { status: 401 }));
  await settle();
  expect(check.states).toEqual(['reconnecting']);
  expect(check.ended).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  check.network(false);
  check.network(true);
  await vi.advanceTimersByTimeAsync(9000);
  expect(check.requests).toHaveLength(1);
  expect(check.ended).toHaveBeenCalledOnce();
});

test('disposal aborts the request, removes listeners and timers, and ignores late completion', async () => {
  const check = server();
  check.stop();
  check.stop();
  expect(check.requests[0].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  check.requests[0].resolve(ok());
  check.network(false);
  check.network(true);
  await vi.advanceTimersByTimeAsync(9000);
  expect(check.states).toEqual(['reconnecting']);
  expect(check.requests).toHaveLength(1);
});
