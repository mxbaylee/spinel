import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NAVIGATION_DEADLINE_MS } from '../../web/offline/deadlines.ts';
import type { ShellManifest } from './offlineShell.ts';

const boundary = vi.hoisted(() => ({ read: vi.fn(), complete: vi.fn() }));
vi.mock('../../web/offline/runtimeStore.ts', async (original) => ({
  ...(await original<typeof import('../../web/offline/runtimeStore.ts')>()),
  readRuntimeState: boundary.read,
}));
vi.mock('../../web/offline/runtimeCache.ts', async (original) => ({
  ...(await original<typeof import('../../web/offline/runtimeCache.ts')>()),
  completeRuntime: boundary.complete,
}));
const browser = { onLine: true };
const manifest: ShellManifest = {
  protocol: 1,
  version: 'a'.repeat(16),
  compatibility: { format: 1, sdkVersion: '1.3.1' },
  entry: '/assets/app.js',
  css: [],
  files: ['/assets/app.js'],
};

type WorkerHandler = (event: {
  request?: Request;
  respondWith?: (response: Promise<Response>) => void;
  waitUntil?: (done: Promise<void>) => void;
}) => void;
let handlers: Map<string, WorkerHandler>;
beforeEach(async () => {
  vi.resetModules();
  browser.onLine = true;
  boundary.read.mockReset().mockResolvedValue(null);
  boundary.complete.mockReset().mockResolvedValue(true);
  handlers = new Map();
  vi.stubGlobal('self', {
    location: { origin: 'https://spinel.test' },
    navigator: browser,
    addEventListener: (type: string, handler: WorkerHandler) => handlers.set(type, handler),
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
  });
  await import('../../web/service-worker.ts');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function navigation(url: string) {
  const request = new Request(url);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}
function responseFor(request: Request) {
  let response: Promise<Response> | undefined;
  handlers.get('fetch')!({
    request,
    respondWith: (value) => {
      response = value;
    },
  });
  return response;
}
describe('offline navigation without private caches', () => {
  it('returns only generic static copy when a private or guest navigation cannot connect', async () => {
    const network = vi.fn().mockRejectedValue(new TypeError('Offline'));
    vi.stubGlobal('fetch', network);
    for (const url of [
      'https://spinel.test/?item=private-title',
      'https://spinel.test/share/private-id#secret-token',
    ]) {
      const request = navigation(url);
      const response = await responseFor(request);
      expect(response?.status).toBe(503);
      expect(response?.headers.get('cache-control')).toBe('no-store');
      expect(response?.headers.get('referrer-policy')).toBe('no-referrer');
      const html = await response!.text();
      expect(html).toContain("You're offline");
      expect(html).toContain('location.reload()'); // Keeps a guest fragment in the browser, never in static copy.
      expect(html).not.toMatch(/private-title|private-id|secret-token/);
      expect(network).toHaveBeenLastCalledWith(request, {
        cache: 'no-store',
        signal: url.includes('/share/') ? undefined : expect.any(AbortSignal),
      });
    }
  });
  it('preserves online denial responses and never intercepts APIs, images or another origin', async () => {
    const denied = new Response('Not found', { status: 404 });
    const network = vi.fn().mockResolvedValue(denied);
    vi.stubGlobal('fetch', network);
    expect(await responseFor(navigation('https://spinel.test/share/revoked'))).toBe(denied);
    network.mockClear();
    for (const request of [
      new Request('https://spinel.test/api/items'),
      new Request('https://spinel.test/api/images/secret'),
      navigation('https://other.test/'),
    ])
      expect(responseFor(request)).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  });
});

// Execute the registered production fetch handler; only public storage boundaries
// are fixtures. Without the navigate() timeout the abort-aware fetch never settles.
describe('bounded production worker navigation', () => {
  function savedShell() {
    boundary.read.mockResolvedValue({ builds: [manifest] });
    const match = vi.fn(async () => new Response('saved public shell'));
    vi.stubGlobal('caches', { match });
    return match;
  }
  it('aborts a pending online fetch at its deadline and serves the complete shell', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Deadline', 'TimeoutError')), delay);
      return controller.signal;
    });
    const match = savedShell();
    const network = vi.fn(
      (_request: Request, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        }),
    );
    vi.stubGlobal('fetch', network);
    let settled = false;
    const response = responseFor(navigation('https://spinel.test/?item=saved'))!.then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(NAVIGATION_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    expect(match).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(await (await response).text()).toBe('saved public shell');
    expect(network).toHaveBeenCalledOnce();
    expect(boundary.complete).toHaveBeenCalledWith(manifest);
  });
  it('skips the network when the browser already knows it is offline', async () => {
    browser.onLine = false;
    savedShell();
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    expect(await (await responseFor(navigation('https://spinel.test/?item=saved')))!.text()).toBe(
      'saved public shell',
    );
    expect(network).not.toHaveBeenCalled();
  });
  it('never gives a server-only route a private-context shell, even when one is prepared', async () => {
    browser.onLine = false;
    const match = savedShell();
    vi.stubGlobal('fetch', vi.fn());
    for (const path of ['/invite', '/setup', '/share/private-id']) {
      const response = await responseFor(navigation(`https://spinel.test${path}`));
      expect(response!.status).toBe(503);
      expect(await response!.text()).not.toMatch(/saved public shell|private-id/);
    }
    expect(match).not.toHaveBeenCalled();
    expect(boundary.read).not.toHaveBeenCalled();
  });
  it('does not impose the offline-shell deadline on an online server-only route', async () => {
    const deadline = vi.spyOn(AbortSignal, 'timeout');
    const network = vi.fn(async () => new Response('Sign in'));
    vi.stubGlobal('fetch', network);
    const request = navigation('https://spinel.test/invite');
    expect(await (await responseFor(request))!.text()).toBe('Sign in');
    expect(network).toHaveBeenCalledWith(request, { cache: 'no-store', signal: undefined });
    expect(deadline).not.toHaveBeenCalled();
  });
});
