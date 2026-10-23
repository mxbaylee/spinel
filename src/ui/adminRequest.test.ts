import { afterEach, expect, test, vi } from 'vitest';
import { AdminRequestError, adminResponse } from '../../web/adminRequest.ts';

afterEach(() => vi.unstubAllGlobals());
test.each([401, 403, 404])('a departed Operator view ignores late denial %i', async (status) => {
  const deferred = Promise.withResolvers<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => deferred.promise),
  );
  let current = true;
  const call = adminResponse('diagnostics', new AbortController().signal, () => {
    if (!current) throw new Error('Departed');
  });
  current = false;
  deferred.resolve(Response.json({ error: 'Private server text' }, { status }));
  await expect(call).rejects.toThrow('Departed');
});
test('current denial has a static message and mutation sends explicit confirmation with its boundary', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ error: 'Private SQL and path' }, { status: 409 }),
  );
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  const body = { confirm: true, generation: '11111111-1111-4111-8111-111111111111' };
  const result = adminResponse('diagnostics/truncate', signal, () => {}, body);
  await expect(result).rejects.toBeInstanceOf(AdminRequestError);
  await expect(result).rejects.toMatchObject({
    status: 409,
    message: 'The request could not be confirmed. Refresh and try again.',
  });
  expect(fetcher.mock.calls[0]).toEqual([
    '/api/admin/diagnostics/truncate',
    {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ]);
});
