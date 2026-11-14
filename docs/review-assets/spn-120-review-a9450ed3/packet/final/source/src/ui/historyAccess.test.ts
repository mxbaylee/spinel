import { afterEach, expect, test, vi } from 'vitest';
import { historyHref, historyRequest } from '../../web/historyApi.ts';

vi.mock('../../web/maintenanceState.ts', () => import('./fixtures/unsupervisedMaintenance.ts'));

afterEach(() => vi.unstubAllGlobals());

test('Space history links retain the root and stable child independently from the checkpoint', () => {
  const href = historyHref('child', 'project', 'saved-version');
  const query = new URL(href, 'https://spinel.example').searchParams;
  expect([...query.entries()]).toEqual([
    ['item', 'child'],
    ['space', 'project'],
    ['version', 'saved-version'],
  ]);
  expect(historyHref('ordinary')).toBe('/preview?item=ordinary');
});

test('history writes use exact Space routing without putting scope into the mutable payload', async () => {
  vi.stubGlobal('location', {
    origin: 'https://spinel.test',
    pathname: '/preview',
    assign: vi.fn(),
  });
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await historyRequest('child', '/checkpoint', 'PATCH', { name: 'Ready' }, 'project'),
  ).toEqual({ ok: true });
  await historyRequest('ordinary');
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(
    calls.map(([path, init]) => [
      path,
      {
        ...init,
        headers: Object.fromEntries(new Headers(init.headers)),
      },
    ]),
  ).toEqual([
    [
      '/api/spaces/project/items/child/history/checkpoint',
      {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-spinel-epoch': '' },
        body: JSON.stringify({ name: 'Ready' }),
      },
    ],
    [
      '/api/items/ordinary/history',
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'x-spinel-epoch': '' },
      },
    ],
  ]);
});
