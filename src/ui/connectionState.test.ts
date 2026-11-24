import { afterEach, expect, test, vi } from 'vitest';
import { CONNECTION_CHECK_EVENT, watchServerConnection } from '../../web/connectionState.ts';
import { CONNECTION_CHECKED_EVENT } from '../../web/connectionState.ts';
import type { ConnectionState } from '../../web/connectionState.ts';

vi.mock('../../web/maintenanceState.ts', () => import('./fixtures/unsupervisedMaintenance.ts'));

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
  vi.stubGlobal('location', { origin: 'https://spinel.test', pathname: '/' });
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

test('Try now asks the server again at once, aborting the earlier probe, and stops on disposal', async () => {
  const check = server(false);
  expect(check.states).toEqual(['offline']);
  expect(check.requests).toHaveLength(0);
  // The browser has recovered since it last said so: the check reads it and probes immediately.
  (navigator as { onLine: boolean }).onLine = true;
  (window as unknown as EventTarget).dispatchEvent(new Event(CONNECTION_CHECK_EVENT));
  expect(check.states).toEqual(['offline', 'reconnecting']);
  expect(check.requests).toHaveLength(1);
  check.requests[0].resolve(ok());
  await settle();
  expect(check.states.at(-1)).toBe('online');
  // A second check cancels a probe still in flight instead of stacking another.
  (window as unknown as EventTarget).dispatchEvent(new Event(CONNECTION_CHECK_EVENT));
  (window as unknown as EventTarget).dispatchEvent(new Event(CONNECTION_CHECK_EVENT));
  expect(check.requests[1].signal.aborted).toBe(true);
  expect(check.requests).toHaveLength(3);
  check.stop();
  (window as unknown as EventTarget).dispatchEvent(new Event(CONNECTION_CHECK_EVENT));
  expect(check.requests).toHaveLength(3);
});

test('Try now says when it has an answer, keeps syncing steady while online, and stays quiet when replaced', async () => {
  const check = server(true);
  check.requests[0].resolve(ok());
  await settle();
  expect(check.states).toEqual(['reconnecting', 'online']);
  const answers = vi.fn();
  (window as unknown as EventTarget).addEventListener(CONNECTION_CHECKED_EVENT, answers);
  const ask = () =>
    (window as unknown as EventTarget).dispatchEvent(new Event(CONNECTION_CHECK_EVENT));
  ask();
  // Already online: the banner is not dropped to waiting while the probe runs.
  expect(check.states).toEqual(['reconnecting', 'online']);
  // A second press replaces the first probe; only the last one answers.
  ask();
  await settle();
  expect(answers).not.toHaveBeenCalled();
  check.requests[2].resolve(ok());
  await settle();
  expect(answers).toHaveBeenCalledTimes(1);
});
