import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type WorkerHandler = (event: {
  request?: Request;
  respondWith?: (response: Promise<Response>) => void;
  waitUntil?: (done: Promise<void>) => void;
}) => void;
let handlers: Map<string, WorkerHandler>;
beforeEach(async () => {
  vi.resetModules();
  handlers = new Map();
  vi.stubGlobal('self', {
    location: { origin: 'https://spinel.test' },
    addEventListener: (type: string, handler: WorkerHandler) => handlers.set(type, handler),
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
  });
  await import('../../web/service-worker.ts');
});
afterEach(() => vi.unstubAllGlobals());
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
      expect(network).toHaveBeenLastCalledWith(request, { cache: 'no-store' });
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
