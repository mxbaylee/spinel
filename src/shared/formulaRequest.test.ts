import { afterEach, expect, it, vi } from 'vitest';
import { requestFormula } from './formulaRequest.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('waits through source loading and evaluator contention before returning a current value', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'Another formula is loading' }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ ok: false, reason: 'busy' }))
    .mockResolvedValueOnce(Response.json({ ok: true, kind: 'scalar', value: 42 }));
  vi.stubGlobal('fetch', fetch);
  const request = requestFormula('/formulas/evaluate', { method: 'POST' });
  await vi.runAllTimersAsync();
  await expect(request).resolves.toEqual({ ok: true, kind: 'scalar', value: 42 });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('cancels a pending retry when the viewer leaves or loses access', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: false, reason: 'busy' }));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const request = requestFormula('/formulas/evaluate', { signal: controller.signal });
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await rejected;
  await vi.runAllTimersAsync();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('stops retrying after the bounded wait and does not retry authorization failures', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockImplementation(async () => Response.json({ ok: false, reason: 'busy' }));
  vi.stubGlobal('fetch', fetch);
  const request = requestFormula('/formulas/evaluate', {});
  await vi.runAllTimersAsync();
  await expect(request).resolves.toEqual({ ok: false, reason: 'busy' });
  expect(fetch).toHaveBeenCalledTimes(7);
  fetch
    .mockClear()
    .mockImplementation(async () =>
      Response.json({ error: 'Source unavailable' }, { status: 403 }),
    );
  await expect(requestFormula('/formulas/resolve', {})).rejects.toThrow('Source unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);
});
