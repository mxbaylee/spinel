import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { origin: 'https://spinel.example' });
});
afterEach(() => vi.unstubAllGlobals());
const status = (epoch: string) => ({ available: true, phase: 'running', epoch, notice: null });

test('the first guest mutation waits for status and an existing tab never silently adopts a resumed epoch', async () => {
  const calls: Array<{ path: string; epoch: string | null }> = [];
  let epoch = 'before';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), epoch: new Headers(init?.headers).get('X-Spinel-Epoch') });
      return String(input) === '/api/maintenance'
        ? Response.json(status(epoch))
        : Response.json({ ok: true });
    }),
  );
  const { maintenanceFetch } = await import('../../web/maintenanceFetch.ts');
  const state = await import('../../web/maintenanceState.ts');
  await maintenanceFetch('/api/guest/link-session', { method: 'POST' });
  expect(calls).toEqual([
    { path: '/api/maintenance', epoch: null },
    { path: '/api/guest/link-session', epoch: 'before' },
  ]);
  epoch = 'after';
  await state.refreshMaintenanceStatus();
  await maintenanceFetch('/api/items', { method: 'POST' });
  expect(calls.at(-1)?.epoch).toBe('before');
});

test('a saved offline base overrides a fresh tab and epoch headers never reach another origin', async () => {
  const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ ok: true }),
  );
  vi.stubGlobal('fetch', request);
  const { maintenanceFetch } = await import('../../web/maintenanceFetch.ts');
  await maintenanceFetch('/api/items', {
    method: 'POST',
    headers: { 'X-Spinel-Epoch': 'saved-before' },
  });
  expect(new Headers(request.mock.calls[0][1]?.headers).get('X-Spinel-Epoch')).toBe('saved-before');
  await maintenanceFetch('https://other.example/resource');
  expect(new Headers(request.mock.calls[1][1]?.headers).has('X-Spinel-Epoch')).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
});
