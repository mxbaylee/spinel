import { afterEach, expect, test, vi } from 'vitest';
import { checkBundle, DownloadError, downloadForOffline } from '../../web/offline/download.ts';
import { isNetworkFailure } from '../../web/offline/localStart.ts';
import { OFFLINE_SDK_VERSION } from '../../web/offline/OfflineAccess.ts';
import type { OfflineBundle } from '../shared/offlineBundle.ts';
import type { OfflineStore } from '../../web/offline/offlineStore.ts';
import { sha256 } from '../../web/offline/PreparedImages.ts';
import { prepareShell } from '../../web/offline/shell.ts';
import { itemsRequest } from '../../web/itemsApi.ts';

vi.mock('../../web/offline/shell.ts', () => ({ prepareShell: vi.fn(async () => {}) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const sha = 'a'.repeat(64);
function bundle(change: Record<string, unknown> = {}) {
  return {
    version: 1,
    accountId: 'owner',
    itemId: 'item',
    name: 'Budget',
    unitId: 'unit',
    revision: 3,
    revisionOffset: 0,
    access: 'owner',
    readOnly: false,
    sdkVersion: OFFLINE_SDK_VERSION,
    kind: 'doc',
    snapshot: { id: 'item' },
    images: [
      { source: `/api/items/item/images/${sha}`, sha256: sha, mime: 'image/png', byteLength: 3 },
    ],
    ...change,
  } as unknown as OfflineBundle;
}

test('a bundle for this account, item and SDK passes', () => {
  vi.stubGlobal('location', { origin: 'https://spinel.example' });
  expect(() => checkBundle(bundle(), 'owner', 'item')).not.toThrow();
});

test.each([
  ['another account', { accountId: 'someone-else' }],
  ['another item', { itemId: 'other' }],
  ['another version', { version: 2 }],
  ['an unsupported item kind', { kind: 'unsupported' }],
  ['no snapshot', { snapshot: null }],
  ['a fractional revision', { revision: 1.5 }],
  ['another native item', { snapshot: { id: 'other-item' } }],
  // A viewer's copy must open read-only (docs/offline.md).
  ['an editable viewer copy', { access: 'viewer', readOnly: false }],
])('a bundle for %s is refused', (_, change) => {
  vi.stubGlobal('location', { origin: 'https://spinel.example' });
  expect(() => checkBundle(bundle(change), 'owner', 'item')).toThrow(DownloadError);
});

test('a Space bundle must match the exact requested root as well as its account and child', () => {
  vi.stubGlobal('location', { origin: 'https://spinel.example' });
  expect(() =>
    checkBundle(bundle({ spaceId: 'project' }), 'owner', 'item', 'project'),
  ).not.toThrow();
  for (const [stored, requested] of [
    ['another-project', 'project'],
    ['project', undefined],
    [undefined, 'project'],
  ])
    expect(() => checkBundle(bundle({ spaceId: stored }), 'owner', 'item', requested)).toThrow(
      DownloadError,
    );
});

test('a restored bundle keeps its stable native item ID and separate live generation', () => {
  vi.stubGlobal('location', { origin: 'https://spinel.example' });
  expect(() =>
    checkBundle(
      bundle({
        spaceId: 'project',
        unitId: 'restored-generation',
        revision: 12,
        revisionOffset: 11,
      }),
      'owner',
      'item',
      'project',
    ),
  ).not.toThrow();
});

test('a Space download fetches images through the exact child scope and stores their canonical keys', async () => {
  vi.stubGlobal('location', { origin: 'https://spinel.example', pathname: '/spaces/project' });
  const bytes = new Uint8Array([1, 2, 3]);
  const hash = await sha256(bytes);
  const source = `/api/items/item/images/${hash}`;
  const value = bundle({
    spaceId: 'project',
    images: [{ source, sha256: hash, mime: 'image/png', byteLength: bytes.length }],
  });
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/spaces/project/items/item/offline-bundle') return Response.json(value);
    if (path === `/api/spaces/project/items/item/images/${hash}`) return new Response(bytes);
    throw new Error('Unexpected route: ' + path);
  });
  vi.stubGlobal('fetch', fetcher);
  const saved = {
    itemId: 'item',
    spaceId: 'project',
    name: 'Budget',
    kind: 'doc',
    readOnly: false,
    revision: 3,
    downloadedAt: 1,
  };
  const saveDownload = vi.fn(async () => saved);
  const store = { accountId: 'owner', saveDownload } as unknown as OfflineStore;
  expect(await downloadForOffline(store, 'item', 'project')).toEqual(saved);
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
    '/api/spaces/project/items/item/offline-bundle',
    `/api/spaces/project/items/item/images/${hash}`,
  ]);
  expect(saveDownload).toHaveBeenCalledWith(
    value,
    new Map([[source, bytes]]),
    expect.any(Function),
  );
});

test('a mismatched Space response is refused before fetching images or replacing a prepared copy', async () => {
  vi.stubGlobal('location', { origin: 'https://spinel.example', pathname: '/spaces/project' });
  const fetcher = vi.fn(async () => Response.json(bundle({ spaceId: 'another-project' })));
  vi.stubGlobal('fetch', fetcher);
  const saveDownload = vi.fn();
  await expect(
    downloadForOffline(
      { accountId: 'owner', saveDownload } as unknown as OfflineStore,
      'item',
      'project',
    ),
  ).rejects.toThrow(DownloadError);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(saveDownload).not.toHaveBeenCalled();
});

test.each(['bundle', 'shell'] as const)(
  'leaving the account during %s preparation never writes the delayed offline copy',
  async (stage) => {
    vi.stubGlobal('location', { origin: 'https://spinel.example', pathname: '/spaces/project' });
    let active = true;
    const verifyCurrent = () => {
      if (!active) throw new Error('Account changed');
    };
    const value = bundle({ spaceId: 'project', images: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (stage === 'bundle') active = false;
        return Response.json(value);
      }),
    );
    if (stage === 'shell')
      vi.mocked(prepareShell).mockImplementationOnce(async () => {
        active = false;
      });
    const saveDownload = vi.fn();
    await expect(
      downloadForOffline(
        { accountId: 'owner', saveDownload } as unknown as OfflineStore,
        'item',
        'project',
        verifyCurrent,
      ),
    ).rejects.toThrow('Account changed');
    expect(saveDownload).not.toHaveBeenCalled();
  },
);

test.each(['download', 'root action'] as const)(
  'a delayed signed-out %s response cannot redirect a newer view',
  async (kind) => {
    const assign = vi.fn();
    vi.stubGlobal('location', { origin: 'https://spinel.example', assign });
    let active = true;
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
    const verifyCurrent = () => {
      if (!active) throw new Error('View changed');
    };
    const work =
      kind === 'download'
        ? downloadForOffline(
            { accountId: 'owner' } as OfflineStore,
            'item',
            'project',
            verifyCurrent,
          )
        : itemsRequest('/project', 'PATCH', { name: 'New name' }, verifyCurrent);
    const rejected = expect(work).rejects.toThrow('View changed');
    active = false;
    release(Response.json({ error: 'Sign in to continue.' }, { status: 401 }));
    await rejected;
    expect(assign).not.toHaveBeenCalled();
  },
);

test('a bundle from another SDK version is refused', () => {
  vi.stubGlobal('location', { origin: 'https://spinel.example' });
  expect(() => checkBundle(bundle({ sdkVersion: '0.9.0' }), 'owner', 'item')).toThrow(
    /another version/,
  );
});

test('an image list pointing anywhere but this item is refused before fetching', () => {
  vi.stubGlobal('location', { origin: 'https://spinel.example' });
  const images = [
    { source: `/api/items/other/images/${sha}`, sha256: sha, mime: 'image/png', byteLength: 3 },
  ];
  expect(() => checkBundle(bundle({ images }), 'owner', 'item')).toThrow(DownloadError);
});

// Only an unreachable server opens local data; any server answer, a 401
// included, never does (docs/offline.md, "Launch").
test('only a failed round trip counts as a network failure', () => {
  expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
  expect(isNetworkFailure(Object.assign(new Error('Sign in to continue.'), { status: 401 }))).toBe(
    false,
  );
  expect(isNetworkFailure(new SyntaxError('Unexpected token <'))).toBe(false);
});
