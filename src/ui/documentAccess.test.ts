import { afterEach, expect, test, vi } from 'vitest';
import {
  documentPath,
  documentProtocolPath,
  documentSyncPath,
  guestItemId,
} from '../../web/documentAccess.ts';
import { readSpaceLocation, spaceHref } from '../../web/spaceNavigation.ts';
import { spacesRequest } from '../../web/spacesApi.ts';

const root = 'aaaabbcc-1111-4000-8000-000000000001';
const child = 'aaaabbcc-1111-4000-8000-000000000002';
const other = 'aaaabbcc-1111-4000-8000-000000000003';
afterEach(() => vi.unstubAllGlobals());

test.each(['/spaces', '/review/spaces', '/'])(
  'account route %s uses exact account child namespaces',
  (pathname) => {
    vi.stubGlobal('location', { pathname });
    expect(guestItemId()).toBeUndefined();
    expect(documentPath(child, root)).toBe(`/api/spaces/${root}/items/${child}`);
    expect(documentProtocolPath({ spaceId: root, itemId: child })).toBe(
      `/space-api/${root}/items/${child}/universer-api`,
    );
    expect(documentPath(child)).toBe(`/api/items/${child}`);
    expect(documentSyncPath(child)).toBe(`/sync-api/items/${child}`);
    expect(documentSyncPath(child, root)).toBe(`/sync-api/spaces/${root}/items/${child}`);
    expect(documentProtocolPath()).toBe('/universer-api');
  },
);

test.each([`/share/${root}`, `/share/${root}/`, `/share/${root.toUpperCase()}/`])(
  'guest route %s keeps API, protocol and navigation in its root without an account fallback',
  async (pathname) => {
    vi.stubGlobal('location', { pathname, search: '' });
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(guestItemId()).toBe(root);
    expect(readSpaceLocation(location)).toMatchObject({ kind: 'space', spaceId: root });
    expect(documentPath(root)).toBe(`/api/guest/${root}`);
    expect(documentPath(child, root)).toBe(`/api/guest-spaces/${root}/items/${child}`);
    expect(documentSyncPath(root)).toBe(`/sync-api/guest/${root}`);
    expect(documentSyncPath(child, root)).toBe(`/sync-api/guest-spaces/${root}/items/${child}`);
    expect(documentProtocolPath({ spaceId: root, itemId: child })).toBe(
      `/guest-space-api/${root}/items/${child}/universer-api`,
    );
    expect(spaceHref()).toBe(`/share/${root}`);
    expect(spaceHref(root, { kind: 'page', id: child })).toBe(`/share/${root}?item=${child}`);
    expect(() => documentPath(other)).toThrow('not available');
    expect(() => documentPath(child, other)).toThrow('not available');
    expect(() => documentSyncPath(other)).toThrow('not available');
    expect(() => documentSyncPath(child, other)).toThrow('not available');
    expect(() => documentProtocolPath({ spaceId: other, itemId: child })).toThrow('not available');
    expect(() => spaceHref(other)).toThrow('not available');
    await expect(spacesRequest('/' + other)).rejects.toThrow('not available');
    expect(fetcher).not.toHaveBeenCalled();
    await spacesRequest('/' + root + '/items/' + child);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/guest-spaces/${root}/items/${child}`);
  },
);
