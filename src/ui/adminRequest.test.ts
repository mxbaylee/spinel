import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AdminRequestError, adminResponse } from '../../web/adminRequest.ts';

vi.mock('../../web/maintenanceState.ts', () => import('./fixtures/unsupervisedMaintenance.ts'));
beforeEach(() => vi.stubGlobal('location', { origin: 'https://spinel.test', pathname: '/admin' }));

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
  const [path, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect([path, { ...init, headers: Object.fromEntries(new Headers(init.headers)) }]).toEqual([
    '/api/admin/diagnostics/truncate',
    {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-spinel-epoch': '' },
      body: JSON.stringify(body),
    },
  ]);
});
