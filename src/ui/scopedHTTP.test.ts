import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import { ScopedHTTP } from '../../web/offline/ScopedHTTP.ts';

vi.mock('../../web/maintenanceState.ts', () => import('./fixtures/unsupervisedMaintenance.ts'));
beforeEach(() => vi.stubGlobal('location', { origin: 'https://spinel.example', pathname: '/' }));

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const access = new OfflineAccess({
    origin: 'https://spinel.example',
    accountId: 'owner',
    itemId: 'child',
    spaceId: 'root',
    unitId: 'generation',
    kind: 'doc',
    access: 'editor',
    sdkVersion: '1.1.0',
    schema: 1,
    revisionOffset: 0,
  });
  let current = true;
  return {
    access,
    http: new ScopedHTTP(access, () => current),
    leave: () => {
      current = false;
    },
  };
}

test('every allowed HTTP read carries the downloading account and exact Space child scope', async () => {
  const f = fixture();
  const fetch = vi.fn(async () => Response.json({}, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  expect((await f.http.fetch('/api/spaces/root/items/child/offline-bundle')).status).toBe(409);
  const [url, init] = fetch.mock.calls[0]! as unknown as [URL, RequestInit];
  expect(url.href).toBe('https://spinel.example/api/spaces/root/items/child/offline-bundle');
  expect(new Headers(init.headers).get('X-Spinel-Offline-Account')).toBe('owner');
  expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  for (const path of [
    '/api/items/child/offline-bundle',
    '/api/spaces/other/items/child/offline-bundle',
    '/api/spaces/root/items/sibling/formulas/evaluate',
    'https://other.example/api/spaces/root/items/child',
  ])
    await expect(f.http.fetch(path)).rejects.toThrow('does not belong');
  expect(fetch).toHaveBeenCalledOnce();
});

test('a completed response is fenced if its account epoch or local access changed', async () => {
  const f = fixture();
  let release!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const pending = f.http.fetch('/sync-api/spaces/root/items/child/ticket', { method: 'POST' });
  f.leave();
  release(Response.json({ ticket: 'never-use' }));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await expect(f.http.fetch('/api/spaces/root/items/child/collaboration')).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(fetch).toHaveBeenCalledOnce();
});
