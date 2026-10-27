import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomToken } from '../server/auth/store.ts';

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

test('only a newly acquired Web Lock can retire an abandoned local prompt owner', async () => {
  const c = await client();
  const key = ACTIVE + B;
  const marker = JSON.stringify({ version: 1, id: B, coordination: 'web-lock', phase: 'prompt' });
  values.set(key, marker);
  const work = vi.fn(async () => 'ready');
  // The marker's old coordination mode is not proof that this caller owns a lock.
  await expect(c.withAccountRead(() => {}, work)).rejects.toThrow('another Spinel tab');
  expect(values.get(key)).toBe(marker);
  expect(work).not.toHaveBeenCalled();
  const acquire = deferred();
  vi.stubGlobal('navigator', {
    locks: {
      request: async (_name: string, run: () => Promise<unknown>) => {
        await acquire.promise;
        return run();
      },
    },
  });
  const reopened = c.withAccountRead(() => {}, work);
  await Promise.resolve();
  expect(values.get(key)).toBe(marker);
  acquire.resolve();
  await expect(reopened).resolves.toBe('ready');
  expect(values.has(key)).toBe(false);
  expect(work).toHaveBeenCalledOnce();
});

test.each([
  ['dispatched response', { version: 1, id: B, coordination: 'web-lock', phase: 'network' }],
  [
    'prompt without an owner lock',
    { version: 1, id: B, coordination: 'unlocked', phase: 'prompt' },
  ],
  ['unknown phase', { version: 1, id: B, coordination: 'web-lock', phase: 'unknown' }],
  ['wrong owner', { version: 1, id: A, coordination: 'web-lock', phase: 'prompt' }],
  ['legacy marker', B],
])('an abandoned %s is never inferred safe by a later Web Lock', async (_reason, value) => {
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, run: () => Promise<unknown>) => run(),
    },
  });
  const c = await client();
  const key = ACTIVE + B;
  const marker = JSON.stringify(value);
  values.set(key, marker);
  const exit = c.beginAccountExit(A, true);
  await expect(c.finishAccountExit(exit)).rejects.toThrow('other Spinel tabs');
  expect(values.get(key)).toBe(marker);
  expect(fetch).not.toHaveBeenCalled();
});

test('a live prompt owner remains exclusive and returns to network phase before verification', async () => {
  let queue: Promise<unknown> = Promise.resolve();
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, run: () => Promise<unknown>) => {
        const next = queue.then(run, run);
        queue = next.catch(() => {});
        return next;
      },
    },
  });
  const first = await client(),
    second = await client();
  const entered = deferred(),
    promptFinished = deferred(),
    dispatched = deferred(),
    response = deferred();
  const marker = () =>
    JSON.parse(values.get([...values.keys()].find((key) => key.startsWith(ACTIVE))!)!);
  const authentication = first.withAuthentication(
    true,
    () => {},
    async (verify, prompt) => {
      expect(marker()).toMatchObject({ coordination: 'web-lock', phase: 'network' });
      await prompt(async () => {
        expect(marker().phase).toBe('prompt');
        entered.resolve();
        await promptFinished.promise;
      });
      expect(marker().phase).toBe('network');
      dispatched.resolve();
      await response.promise;
      verify();
    },
  );
  await entered.promise;
  const read = vi.fn(async () => 'ready');
  const reopened = second.withAccountRead(() => {}, read);
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  expect(marker().phase).toBe('prompt');
  promptFinished.resolve();
  await dispatched.promise;
  expect(read).not.toHaveBeenCalled();
  expect(marker().phase).toBe('network');
  response.resolve();
  await authentication;
  await expect(reopened).resolves.toBe('ready');
  expect([...values.keys()].filter((key) => key.startsWith(ACTIVE))).toEqual([]);
});

test('a prompt result cannot reach verification when its durable phase fence changed', async () => {
  const c = await client();
  const dispatch = vi.fn();
  await expect(
    c.withAuthentication(
      true,
      () => {},
      async (_verify, prompt) => {
        await prompt(async () => {
          const key = [...values.keys()].find((key) => key.startsWith(ACTIVE))!;
          values.set(key, 'unknown replacement');
          return 'credential result';
        });
        dispatch();
      },
    ),
  ).rejects.toThrow('account changed');
  expect(dispatch).not.toHaveBeenCalled();
  expect([...values.values()]).toContain('unknown replacement');
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

test.each(['authentication', 'registration'] as const)(
  'cancelled delayed %s options retain account binding and challenge cleanup until the response settles',
  async (kind) => {
    // Use the server's actual challenge identifier generator, not an account UUID.
    const returnedChallenge = randomToken();
    let queue: Promise<unknown> = Promise.resolve();
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, run: () => Promise<unknown>) => {
          const next = queue.then(run, run);
          queue = next.catch(() => {});
          return next;
        },
      },
    });
    const first = await client(),
      second = await client();
    const { api } = await import('../../web/api.ts');
    const optionsSent = deferred(),
      cancelSent = deferred();
    const optionsResponse = deferred<Response>(),
      cancelResponse = deferred<Response>();
    vi.mocked(fetch).mockImplementation((path) => {
      if (String(path).endsWith('/options')) {
        optionsSent.resolve();
        return optionsResponse.promise;
      }
      cancelSent.resolve();
      return cancelResponse.promise;
    });
    let finishOptions!: () => void;
    const stream = new ReadableStream({
      start(controller) {
        finishOptions = () => {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ challengeId: returnedChallenge, options: {} }),
            ),
          );
          controller.close();
        };
      },
    });
    let current = true;
    let challengeId: string | undefined;
    const abandoned = new DOMException('The passkey request ended.', 'AbortError');
    const openPrompt = vi.fn(async () => {});
    const authentication = first.withAuthentication(
      kind === 'authentication',
      () => {
        if (!current) throw abandoned;
      },
      async (verify, prompt) => {
        try {
          const options = await api<{ challengeId: string }>(`${kind}/options`, {}, verify, {
            accountId: kind === 'registration' ? A : undefined,
            onAbandonedChallenge: (id) => {
              challengeId = id;
            },
          });
          challengeId = options.challengeId;
          await prompt(openPrompt);
        } catch (failure) {
          if (challengeId) await api('cancel', { challengeId });
          throw failure;
        }
      },
    );
    const rejected = expect(authentication).rejects.toBe(abandoned);
    await optionsSent.promise;
    const headers = new Headers(vi.mocked(fetch).mock.calls[0]![1]?.headers);
    expect(headers.get('X-Spinel-Account')).toBe(kind === 'registration' ? A : null);
    expect(headers.get('Content-Type')).toBe('application/json');
    current = false;
    optionsResponse.resolve(new Response(stream, { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(challengeId).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    finishOptions();
    await cancelSent.promise;
    expect(challengeId).toBe(returnedChallenge);
    expect(openPrompt).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ challengeId: returnedChallenge }),
      }),
    );
    const marker = [...values.keys()].find((key) => key.startsWith(ACTIVE))!;
    expect(JSON.parse(values.get(marker)!).phase).toBe('network');
    const next = vi.fn(async () => 'ready');
    const reopened = second.withAccountRead(() => {}, next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    cancelResponse.resolve(new Response(null, { status: 204 }));
    await rejected;
    await expect(reopened).resolves.toBe('ready');
    expect([...values.keys()].filter((key) => key.startsWith(ACTIVE))).toEqual([]);
  },
);

test.each([
  ['account UUID', B],
  ['incomplete token', 'a'.repeat(42)],
  ['non-base64url token', '+' + 'a'.repeat(42)],
  ['non-string value', null],
])(
  'cancelled options never expose a malformed challenge identifier: %s',
  async (_name, challengeId) => {
    const { api } = await import('../../web/api.ts');
    const response = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => response.promise);
    let current = true;
    const abandoned = new DOMException('The passkey request ended.', 'AbortError');
    const cleanup = vi.fn();
    const options = api(
      'authentication/options',
      {},
      () => {
        if (!current) throw abandoned;
      },
      { onAbandonedChallenge: cleanup },
    );
    const rejected = expect(options).rejects.toBe(abandoned);
    current = false;
    response.resolve(Response.json({ challengeId, options: {} }));
    await rejected;
    expect(cleanup).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
