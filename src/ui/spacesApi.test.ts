import { afterEach, expect, test, vi } from 'vitest';
import {
  SpaceApiError,
  spaceAccessDenied,
  spaceRequestMessage,
  spacesRequest,
} from '../../web/spacesApi.ts';

afterEach(() => vi.unstubAllGlobals());

test.each([401, 403, 404])(
  'guest Space response %i stays scoped to its requesting controller',
  async (status) => {
    const root = '11111111-1111-4111-8111-111111111111';
    vi.stubGlobal('location', { pathname: `/share/${root}` });
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    let release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const controller = new AbortController();
    const reading = spacesRequest(`/${root}`, { signal: controller.signal });
    controller.abort();
    release(Response.json({ error: 'Unavailable' }, { status }));
    await expect(reading).rejects.toMatchObject({ status });
    expect(dispatchEvent).not.toHaveBeenCalled();
    // A missing child is not authority over its still-accessible root. The
    // controller refreshes that root and owns the terminal privacy decision.
    const active = spacesRequest(`/${root}/items/missing-child`, {
      method: 'PATCH',
      body: { name: 'Changed elsewhere' },
    });
    release(Response.json({ error: 'Unavailable' }, { status }));
    await expect(active).rejects.toMatchObject({ status });
    expect(dispatchEvent).not.toHaveBeenCalled();
  },
);

test('Space requests preserve scoped paths, JSON mutations, session cookies and cancellation', async () => {
  const signal = new AbortController().signal;
  const body = { name: 'Planning', kind: 'doc', parentId: 'parent' };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ item: { id: 'created' } }, { status: 201 }));
  vi.stubGlobal('fetch', fetch);
  await expect(spacesRequest('/space/items', { method: 'POST', body, signal })).resolves.toEqual({
    item: { id: 'created' },
  });
  expect(fetch).toHaveBeenCalledWith('/api/spaces/space/items', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
});

test('a successful read or empty deletion does not invent a response or mutation body', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ spaces: [], folders: [] }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  await expect(spacesRequest()).resolves.toEqual({ spaces: [], folders: [] });
  expect(fetch.mock.calls[0][1]).not.toHaveProperty('body');
  await expect(
    spacesRequest('/space/trash/item', { method: 'DELETE', body: { version: 'exact-set' } }),
  ).resolves.toBeUndefined();
});

test.each([401, 403, 404])(
  'authoritative %i remains distinguishable from offline without navigating over pending work',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ error: 'Space unavailable' }, { status })),
    );
    const error = await spacesRequest('/space').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SpaceApiError);
    expect(error).toMatchObject({ status, message: 'Space unavailable' });
    expect(spaceAccessDenied(error)).toBe(true);
    expect(spaceRequestMessage(error)).toBe('Space unavailable');
  },
);

test('conflict and transient server errors preserve their status without being access revocations', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ error: 'The subtree changed. Refresh the preview.' }, { status: 409 }),
    )
    .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const conflict = await spacesRequest('/space/trash/item').catch((cause: unknown) => cause);
  expect(conflict).toMatchObject({
    status: 409,
    message: 'The subtree changed. Refresh the preview.',
  });
  expect(spaceAccessDenied(conflict)).toBe(false);
  const transient = await spacesRequest('/space').catch((cause: unknown) => cause);
  expect(transient).toMatchObject({ status: 503 });
  expect(spaceAccessDenied(transient)).toBe(false);
});

test('malformed successful JSON is not treated as a usable tree', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('<html>Sign in</html>')),
  );
  const error = await spacesRequest('/space').catch((cause: unknown) => cause);
  expect(error).toMatchObject({ status: 502 });
  expect(spaceAccessDenied(error)).toBe(false);
});

test('network aborts retain their identity while offline messaging makes no authorization claim', async () => {
  const abort = new DOMException('The request was aborted', 'AbortError');
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockRejectedValue(abort));
  await expect(spacesRequest('/space')).rejects.toBe(abort);
  expect(spaceAccessDenied(abort)).toBe(false);
  expect(spaceRequestMessage(abort)).toBe('Could not reach Spinel. Reconnect and try again.');
});
