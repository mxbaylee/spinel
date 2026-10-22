import { afterEach, expect, test, vi } from 'vitest';
import { historyHref, historyRequest } from '../../web/historyApi.ts';

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
  vi.stubGlobal('location', { pathname: '/preview', assign: vi.fn() });
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await historyRequest('child', '/checkpoint', 'PATCH', { name: 'Ready' }, 'project'),
  ).toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledWith('/api/spaces/project/items/child/history/checkpoint', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ready' }),
  });
  await historyRequest('ordinary');
  expect(fetcher).toHaveBeenLastCalledWith('/api/items/ordinary/history', {
    method: 'GET',
    credentials: 'same-origin',
  });
});
