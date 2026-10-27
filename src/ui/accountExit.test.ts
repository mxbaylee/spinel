import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const CANCEL = '00000000-0000-4000-8000-000000000003';
const GENERATION = '00000000-0000-4000-8000-000000000004';
const EXIT = 'spinel.offline.sign-out';
const ACTIVE = 'spinel.auth.active:';
let values: Map<string, string>;
let local: Storage;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function client() {
  vi.resetModules();
  return import('../../web/offline/accountExit.ts');
}
beforeEach(() => {
  values = new Map([
    ['spinel.offline.account', A],
    ['spinel.offline.online-account', A],
    ['spinel.offline.cancellation', CANCEL],
    ['spinel.auth.generation', GENERATION],
  ]);
  local = new Proxy(
    {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => values.clear(),
    },
    {
      ownKeys: () => [...values.keys()],
      getOwnPropertyDescriptor: (_target, key) =>
        values.has(String(key))
          ? { configurable: true, enumerable: true, value: values.get(String(key)), writable: true }
          : undefined,
    },
  );
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: local }));
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('location', { pathname: '/sign-in' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('accepted exit locks synchronously, stores identifiers only, and keeps its deletion fence after remote completion', async () => {
  const c = await client();
  const exit = c.beginAccountExit(A, true);
  expect(values.has('spinel.offline.account')).toBe(false);
  expect(exit.persisted).toBe(true);
  expect(JSON.parse(values.get(EXIT)!)).toEqual(exit.intent);
  expect(Object.keys(exit.intent).sort()).toEqual([
    'accountId',
    'authGeneration',
    'cancellation',
    'hasOfflineAccount',
    'id',
    'version',
  ]);
  await c.finishAccountExit(exit);
  expect(values.has(EXIT)).toBe(false);
  expect(c.accountExitPending()).toBe(false);
  expect(() => exit.verifyCurrent()).not.toThrow();
  expect(fetch).toHaveBeenCalledWith(
    '/api/auth/sign-out',
    expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      body: '{}',
      headers: { 'Content-Type': 'application/json', 'X-Spinel-Offline-Account': A },
    }),
  );
  c.beginAccountExit(A, true);
  expect(() => exit.verifyCurrent()).toThrow('account changed');
});

test.each([200, 201, 400, 403, 409, 500])(
  'HTTP %i never settles a saved logout',
  async (status) => {
    const c = await client();
    const exit = c.beginAccountExit(A, true);
    const before = values.get(EXIT);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status }));
    await expect(c.finishAccountExit(exit)).rejects.toThrow();
    expect(values.get(EXIT)).toBe(before);
    expect(c.accountExitPending()).toBe(true);
  },
);

test('a verified anonymous exit sends an explicit fence instead of legacy unconditional logout', async () => {
  const c = await client();
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 401 }));
  const exit = await c.exitCurrentBrowser();
  expect(exit.intent.accountId).toBeNull();
  expect(exit.intent.hasOfflineAccount).toBe(false);
  await c.finishAccountExit(exit);
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/auth/sign-out',
    expect.objectContaining({
      headers: { 'Content-Type': 'application/json', 'X-Spinel-Offline-Account': 'anonymous' },
    }),
  );
  expect(c.accountExitPending()).toBe(false);
});

test('a network failure preserves the exact intent for a later confirmed retry', async () => {
  const c = await client();
  const exit = c.beginAccountExit(A, true);
  const before = values.get(EXIT);
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
  await expect(c.finishAccountExit(exit)).rejects.toThrow('offline');
  expect(values.get(EXIT)).toBe(before);
  await c.finishAccountExit(exit);
  expect(values.has(EXIT)).toBe(false);
});

test('an old response cannot erase a later exit, even for the same account', async () => {
  const c = await client();
  const exit = c.beginAccountExit(A, true);
  const sent = deferred();
  const response = deferred<Response>();
  vi.mocked(fetch).mockImplementationOnce(() => {
    sent.resolve();
    return response.promise;
  });
  const finish = c.finishAccountExit(exit);
  const rejected = expect(finish).rejects.toThrow('account changed');
  await sent.promise;
  const next = c.beginAccountExit(A, true);
  response.resolve(new Response(null, { status: 204 }));
  await rejected;
  expect(JSON.parse(values.get(EXIT)!)).toEqual(next.intent);
});

test('matching UUID alone cannot clear a modified intent or delete through an obsolete authentication generation', async () => {
  const c = await client();
  const exit = c.beginAccountExit(A, true);
  values.set(EXIT, JSON.stringify({ ...exit.intent, hasOfflineAccount: false }));
  await expect(c.finishAccountExit(exit)).rejects.toThrow('account changed');
  expect(fetch).not.toHaveBeenCalled();
  values.set(EXIT, JSON.stringify(exit.intent));
  values.set('spinel.auth.generation', B);
  expect(() => exit.verifyCurrent()).toThrow('account changed');
});

test('malformed/unknown intent stays locked without inferring a current account', async () => {
  const c = await client();
  for (const raw of ['{}', 'bad json', JSON.stringify({ accountId: A }), '1']) {
    values.set(EXIT, raw);
    if (raw === '1') values.delete('spinel.offline.online-account');
    expect(c.accountExitPending()).toBe(true);
    expect(await c.restoreAccountExit()).toBe('unknown');
    expect(values.get(EXIT)).toBe(raw);
  }
  expect(fetch).not.toHaveBeenCalled();
});

test('a legacy exit retains its known original account without inventing private inventory eligibility', async () => {
  const c = await client();
  values.set(EXIT, '1');
  const exit = await c.restoreAccountExit();
  expect(exit).not.toBeNull();
  expect(exit).not.toBe('unknown');
  if (!exit || exit === 'unknown') throw new Error('Missing adopted exit');
  expect(exit.intent.accountId).toBe(A);
  expect(exit.intent.hasOfflineAccount).toBe(false);
  await c.finishAccountExit(exit);
  expect(values.has(EXIT)).toBe(false);
});

test('no-lock ordinary authentication works and retains no credential response in control storage', async () => {
  const c = await client();
  const response = { credential: 'private-response', user: A };
  const result = await c.withAuthentication(
    true,
    () => {},
    async (verify) => {
      verify();
      expect([...values.keys()].filter((key) => key.startsWith(ACTIVE))).toHaveLength(1);
      return response;
    },
  );
  expect(result).toBe(response);
  expect([...values.keys()].filter((key) => key.startsWith(ACTIVE))).toHaveLength(0);
  expect(JSON.stringify([...values])).not.toContain('private-response');
});

test('two no-lock clients cannot overwrite an older in-flight verification marker', async () => {
  const first = await client(),
    second = await client();
  const entered = deferred(),
    response = deferred();
  const auth = first.withAuthentication(
    true,
    () => {},
    async (verify) => {
      entered.resolve();
      await response.promise;
      verify();
    },
  );
  const rejected = expect(auth).rejects.toThrow('account changed');
  await entered.promise;
  const originalKeys = [...values.keys()].filter((key) => key.startsWith(ACTIVE));
  await expect(
    second.withAuthentication(
      true,
      () => {},
      async () => {},
    ),
  ).rejects.toThrow('another Spinel tab');
  expect([...values.keys()].filter((key) => key.startsWith(ACTIVE))).toEqual(originalKeys);
  const exit = second.beginAccountExit(A, true);
  await expect(second.finishAccountExit(exit)).rejects.toThrow('other Spinel tabs');
  expect(fetch).not.toHaveBeenCalled();
  response.resolve();
  await rejected;
  expect([...values.keys()].filter((key) => key.startsWith(ACTIVE))).toEqual([]);
  await second.finishAccountExit(exit);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('an exit barrier prevents a later registered ceremony from dispatching', async () => {
  const first = await client(),
    second = await client();
  first.beginAccountExit(A, true);
  const work = vi.fn(async () => {});
  await expect(second.withAuthentication(true, () => {}, work)).rejects.toThrow(
    'Finish signing out',
  );
  expect(work).not.toHaveBeenCalled();
  expect([...values.keys()].filter((key) => key.startsWith(ACTIVE))).toEqual([]);
});

test('unknown activities are bounded and never expired into a successful logout', async () => {
  const c = await client();
  for (let index = 0; index < 8; index++) values.set(ACTIVE + index, 'unknown old operation');
  const exit = c.beginAccountExit(A, true);
  await expect(c.finishAccountExit(exit)).rejects.toThrow('other Spinel tabs');
  await expect(
    c.withAuthentication(
      true,
      () => {},
      async () => {},
    ),
  ).rejects.toThrow('unfinished');
  expect([...values.keys()].filter((key) => key.startsWith(ACTIVE))).toHaveLength(8);
  expect(fetch).not.toHaveBeenCalled();
});

test('the shared Web Lock outlives dispatched verification and serializes the later logout', async () => {
  let queue: Promise<unknown> = Promise.resolve();
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, work: () => Promise<unknown>) => {
        const next = queue.then(work, work);
        queue = next.catch(() => {});
        return next;
      },
    },
  });
  const first = await client(),
    second = await client();
  const entered = deferred(),
    response = deferred();
  const authentication = first.withAuthentication(
    true,
    () => {},
    async (verify) => {
      entered.resolve();
      await response.promise;
      verify();
    },
  );
  const rejected = expect(authentication).rejects.toThrow('account changed');
  await entered.promise;
  const exit = second.beginAccountExit(A, true);
  const logout = second.finishAccountExit(exit);
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  response.resolve();
  await rejected;
  await logout;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(values.has(EXIT)).toBe(false);
});

test('blocked storage still permits a serialized online ceremony and never claims a durable exit queue', async () => {
  Object.defineProperty(window, 'localStorage', {
    get: () => {
      throw new Error('blocked');
    },
  });
  vi.stubGlobal('navigator', {
    locks: { request: (_name: string, work: () => Promise<unknown>) => work() },
  });
  const c = await client();
  await expect(
    c.withAuthentication(
      true,
      () => {},
      async (verify) => {
        verify();
        return 'signed in';
      },
    ),
  ).resolves.toBe('signed in');
  const exit = c.beginAccountExit(A, true);
  expect(exit.persisted).toBe(false);
  expect(c.accountExitPending()).toBe(true);
  await c.finishAccountExit(exit);
  expect(c.accountExitPending()).toBe(false);
});

test('api fences before dispatch and keeps a stale dispatched response owned through its full body', async () => {
  const { api } = await import('../../web/api.ts');
  const error = new DOMException('account changed', 'AbortError');
  await expect(
    api('authentication/options', {}, () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(fetch).not.toHaveBeenCalled();
  let current = true;
  let finish!: () => void;
  const stream = new ReadableStream({
    start(controller) {
      finish = () => {
        controller.enqueue(new TextEncoder().encode('{"user":"private"}'));
        controller.close();
      };
    },
  });
  const headers = deferred<Response>();
  vi.mocked(fetch).mockImplementationOnce(() => headers.promise);
  const pending = api('authentication/verify', {}, () => {
    if (!current) throw error;
  });
  const rejected = expect(pending).rejects.toBe(error);
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  current = false;
  headers.resolve(new Response(stream, { status: 200 }));
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  finish();
  await rejected;
  expect(settled).toBe(true);
});
