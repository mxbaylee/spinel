import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../web/api.ts';
import { isNetworkFailure } from '../../web/offline/localStart.ts';
import { SESSION_REQUEST_DEADLINE_MS } from '../../web/offline/deadlines.ts';

vi.mock('../../web/maintenanceState.ts', () => import('./fixtures/unsupervisedMaintenance.ts'));

const assign = vi.fn();
let timeout: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  assign.mockReset();
  vi.stubGlobal('location', { origin: 'https://spinel.test', pathname: '/', assign });
  // Native AbortSignal.timeout uses an independent clock. Bind only that clock
  // to fake time; api, maintenanceFetch and outage classification stay real.
  timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Deadline', 'TimeoutError')), ms);
    return controller.signal;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function held(signal: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test.each(['headers', 'body'] as const)(
  'a stalled session at %s finishes at the chosen deadline as an outage, without sign-out',
  async (boundary) => {
    vi.stubGlobal('fetch', (_input: unknown, { signal }: RequestInit) =>
      boundary === 'headers'
        ? held(signal!)
        : Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: () => held(signal!),
          }),
    );
    let settled = false;
    const outcome = api('session').catch((error: unknown) => {
      settled = true;
      return error;
    });
    // Product decision: session readiness gets 3 s; item transfers still get 15 s.
    expect(SESSION_REQUEST_DEADLINE_MS).toBe(3000);
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    const error = await outcome;
    expect(error).toMatchObject({ name: 'TimeoutError' });
    expect(isNetworkFailure(error)).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  },
);

test('a slow success inside the budget remains an authenticated result', async () => {
  const user = { id: 'owner', name: 'Owner', isAdmin: false };
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(new Response(JSON.stringify({ user }), { status: 200 })), 2500),
      ),
  );
  const pending = api('session');
  await vi.advanceTimersByTimeAsync(2500);
  await expect(pending).resolves.toEqual({ user });
  expect(assign).not.toHaveBeenCalled();
});

test.each(['complete', 'timed-out', 'malformed'] as const)(
  'an actual 401 stays a denial when its error body is %s',
  async (body) => {
    vi.stubGlobal('fetch', (_input: unknown, { signal }: RequestInit) =>
      Promise.resolve({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: () =>
          body === 'timed-out'
            ? held(signal!)
            : body === 'malformed'
              ? Promise.reject(new SyntaxError('invalid response'))
              : Promise.resolve({ error: 'Expired' }),
      }),
    );
    const outcome = api('session').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3000);
    const error = await outcome;
    expect(error).toMatchObject({ status: 401 });
    expect(isNetworkFailure(error)).toBe(false);
    expect(assign).toHaveBeenCalledExactlyOnceWith('/sign-in');
  },
);

test('a stale owner cannot act on a late 401 or its timed-out body', async () => {
  let current = true;
  vi.stubGlobal('fetch', (_input: unknown, { signal }: RequestInit) =>
    Promise.resolve({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: () => held(signal!),
    }),
  );
  const outcome = api('session', undefined, () => {
    if (!current) throw new DOMException('Retired', 'AbortError');
  }).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  current = false;
  await vi.advanceTimersByTimeAsync(3000);
  expect(await outcome).toMatchObject({ name: 'AbortError' });
  expect(assign).not.toHaveBeenCalled();
});

test('other authentication reads and explicit cancellation retain their existing budgets', async () => {
  vi.stubGlobal('fetch', (_input: unknown, { signal }: RequestInit) => held(signal!));
  const unrelated = api('passkeys').catch((error: unknown) => error);
  expect(timeout).toHaveBeenLastCalledWith(15_000);
  const controller = new AbortController();
  const cancelled = api('session', undefined, undefined, { signal: controller.signal }).catch(
    (error: unknown) => error,
  );
  expect(timeout).toHaveBeenCalledTimes(1);
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  expect(await cancelled).toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await unrelated).toMatchObject({ name: 'TimeoutError' });
  expect(assign).not.toHaveBeenCalled();
});
