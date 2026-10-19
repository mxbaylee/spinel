import { expect, test, vi } from 'vitest';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import { checkImageList, PreparedImages, sha256 } from '../../web/offline/PreparedImages.ts';
import type { OfflineBundleImage } from '../shared/offlineBundle.ts';

async function fixture() {
  const scope = {
    origin: 'https://spinel.example',
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    kind: 'doc' as const,
    access: 'owner' as const,
    sdkVersion: '1.1.0' as const,
    schema: 1 as const,
    revisionOffset: 0,
  };
  const access = new OfflineAccess(scope);
  let account: string | null = 'owner';
  const data = new Uint8Array([1, 2, 3]);
  const hash = await sha256(data);
  const source = `/api/items/item/images/${hash}`;
  const images: OfflineBundleImage[] = [{ source, sha256: hash, mime: 'image/png', byteLength: 3 }];
  const bytes = new Map([[source, data]]);
  return {
    access,
    images,
    bytes,
    source,
    data,
    setAccount: (value: string | null) => {
      account = value;
    },
    prepare: () => PreparedImages.prepare(access, images, bytes, () => account),
  };
}

test('verified local image bytes render and export without fetching', async () => {
  const f = await fixture();
  const before = structuredClone(f.images);
  const service = await f.prepare();
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'));
  try {
    f.data[0] = 99;
    const url = await service.getImage(f.source);
    expect(url.startsWith('blob:')).toBe(true);
    expect(await service.getImage(f.access.scope.origin + f.source)).toBe(url);
    expect(await service.getImage(url)).toBe(url);
    const blob = await service.downloadImage(f.source);
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(f.images).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    service.dispose();
    fetch.mockRestore();
  }
});

test('localize rewrites only verified sources and leaves the stored snapshot unchanged', async () => {
  const f = await fixture();
  const service = await f.prepare();
  try {
    const snapshot = {
      drawings: {
        a: { source: f.source },
        b: { source: f.access.scope.origin + f.source },
        c: { source: 'https://elsewhere.example/tracker.png' },
        d: { source: '/api/items/other/images/abc' },
        e: { source: 'data:image/png;base64,AAAA' },
      },
      text: 'Not an image',
      other: '/api/items/other/images/abc',
      list: [f.source, 3, null],
      resources: [
        { name: 'SHEET_DRAWING_PLUGIN', data: JSON.stringify({ s: { d: { source: f.source } } }) },
        { name: 'plain', data: 'not json' },
      ],
    };
    const before = structuredClone(snapshot);
    const local = service.localize(snapshot);
    const url = await service.getImage(f.source);
    expect(local).toEqual({
      drawings: {
        a: { source: url },
        b: { source: url },
        c: { source: 'data:image/png;base64,' },
        d: { source: 'data:image/png;base64,' },
        e: { source: 'data:image/png;base64,AAAA' },
      },
      text: 'Not an image',
      other: '/api/items/other/images/abc',
      list: [url, 3, null],
      resources: [
        { name: 'SHEET_DRAWING_PLUGIN', data: JSON.stringify({ s: { d: { source: url } } }) },
        { name: 'plain', data: 'not json' },
      ],
    });
    expect(snapshot).toEqual(before);
  } finally {
    service.dispose();
  }
});

test.each([
  'missing',
  'wrong size',
  'wrong hash',
  'foreign path',
  'duplicate',
  'sparse',
  'mime',
  'account',
  'oversize',
  'budget',
])('%s image preparation fails before exposing any object URL', async (mode) => {
  const f = await fixture();
  if (mode === 'missing') f.bytes.clear();
  if (mode === 'wrong size') f.images[0].byteLength = 2;
  if (mode === 'wrong hash') f.data[0] = 5;
  if (mode === 'foreign path') f.images[0].source = '/api/items/other/images/hash';
  if (mode === 'duplicate') f.images.push({ ...f.images[0] });
  if (mode === 'sparse') f.images.length = 2;
  if (mode === 'mime') f.images[0].mime = 'image/svg+xml';
  if (mode === 'account') f.setAccount('other');
  if (mode === 'oversize') f.images[0].byteLength = 5 * 1024 * 1024 + 1;
  if (mode === 'budget')
    // Eleven 5 MB images exceed the 50 MB document budget before any bytes are hashed.
    for (let index = 0; index < 11; index++)
      f.images[index] = {
        source: `/api/items/item/images/${index.toString(16).padStart(64, '0')}`,
        sha256: index.toString(16).padStart(64, '0'),
        mime: 'image/png',
        byteLength: 5 * 1024 * 1024,
      };
  const urls = vi.spyOn(URL, 'createObjectURL');
  try {
    await expect(f.prepare()).rejects.toThrow(
      mode === 'budget' ? /budget/ : mode === 'account' ? /account/ : /image/,
    );
    expect(urls).not.toHaveBeenCalled();
  } finally {
    urls.mockRestore();
  }
});

test.each(['unknown', 'foreign origin', 'query', 'hash', 'data url'])(
  '%s reads never fall through to a browser network request',
  async (mode) => {
    const f = await fixture(),
      service = await f.prepare();
    const url =
      mode === 'unknown'
        ? '/missing'
        : mode === 'foreign origin'
          ? 'https://other.example' + f.source
          : mode === 'query'
            ? f.source + '?extra=1'
            : mode === 'hash'
              ? f.source + '#extra'
              : 'data:image/png;base64,AQID';
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'));
    try {
      expect(await service.getImage(url)).toBe('data:image/png;base64,');
      expect(f.access.state.phase).toBe('attention');
      await expect(service.downloadImage(url)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      expect(() => service.registerURLImageDownloader()).toThrow(/fallback/);
    } finally {
      service.dispose();
      fetch.mockRestore();
    }
  },
);

test.each(['account', 'lock', 'dispose'])(
  '%s revokes issued object URLs and denies later local reads',
  async (mode) => {
    const f = await fixture(),
      service = await f.prepare();
    const url = await service.getImage(f.source);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    try {
      if (mode === 'account') f.setAccount('other');
      if (mode === 'lock') f.access.lock('Signed out');
      if (mode === 'dispose') service.dispose();
      expect(await service.getImage(f.source)).toBe('data:image/png;base64,');
      expect(await service.getImage(url)).toBe('data:image/png;base64,');
      expect(revoke).toHaveBeenCalledWith(url);
      await expect(service.downloadImage(f.source)).rejects.toThrow();
    } finally {
      service.dispose();
      revoke.mockRestore();
    }
  },
);

test('locking while integrity verification is pending cannot publish an image service', async () => {
  const f = await fixture();
  const pending = f.prepare();
  f.access.lock('Signed out during preparation');
  await expect(pending).rejects.toThrow(/account|access/);
});

test.each([
  ['another origin', 'https://elsewhere.example/api/items/item/images/'],
  ['another item', '/api/items/other/images/'],
  ['another route', '/api/items/item/export?sha='],
])('an image list pointing at %s is refused before anything is fetched', async (_, prefix) => {
  const f = await fixture();
  const image = { ...f.images[0], source: prefix + f.images[0].sha256 };
  expect(() => checkImageList('item', [image])).toThrow(/malformed/);
  expect(() => checkImageList('item', f.images)).not.toThrow();
});
