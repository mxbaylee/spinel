import { expect, test, vi } from 'vitest';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import { PreparedImages } from '../../web/offline/PreparedImages.ts';

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
  const access = new OfflineAccess(scope, async () => ({ ...scope, restoring: false }));
  let account: string | null = 'owner';
  const data = new Uint8Array([1, 2, 3]);
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const source = `/api/items/item/images/${sha256}`;
  const manifest = { scope, images: [{ source, sha256, mime: 'image/png', byteLength: 3 }] };
  const bytes = new Map([[source, data]]);
  return {
    access,
    manifest,
    bytes,
    source,
    data,
    setAccount: (value: string | null) => {
      account = value;
    },
    prepare: () => PreparedImages.prepare(access, manifest, bytes, () => account),
  };
}

test('verified local image bytes render/export without fetching or rewriting the prepared source', async () => {
  const f = await fixture();
  const before = structuredClone(f.manifest);
  const service = await f.prepare();
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'));
  try {
    f.data[0] = 99;
    const url = await service.getImage(f.source);
    expect(url.startsWith('blob:')).toBe(true);
    expect(await service.getImage(f.manifest.scope.origin + f.source)).toBe(url);
    const blob = await service.downloadImage(f.source);
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(f.manifest).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    service.dispose();
    fetch.mockRestore();
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
  'scope',
  'oversize',
])('%s image preparation fails before exposing any object URL', async (mode) => {
  const f = await fixture();
  if (mode === 'missing') f.bytes.clear();
  if (mode === 'wrong size') f.manifest.images[0].byteLength = 2;
  if (mode === 'wrong hash') f.data[0] = 5;
  if (mode === 'foreign path') f.manifest.images[0].source = '/api/items/other/images/hash';
  if (mode === 'duplicate') f.manifest.images.push({ ...f.manifest.images[0] });
  if (mode === 'sparse') f.manifest.images.length = 2;
  if (mode === 'mime') f.manifest.images[0].mime = 'image/svg+xml';
  if (mode === 'scope') f.manifest.scope = { ...f.manifest.scope, accountId: 'other' };
  if (mode === 'oversize') f.manifest.images[0].byteLength = 5 * 1024 * 1024 + 1;
  const urls = vi.spyOn(URL, 'createObjectURL');
  try {
    await expect(f.prepare()).rejects.toThrow();
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
  '%s revokes issued object URLs and denies subsequent local reads',
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
      expect(revoke).toHaveBeenCalledWith(url);
      await expect(service.downloadImage(f.source)).rejects.toThrow();
    } finally {
      service.dispose();
      revoke.mockRestore();
    }
  },
);
test('locking while integrity verification is pending cannot publish a prepared image service', async () => {
  const f = await fixture();
  const pending = f.prepare();
  f.access.lock('Signed out during preparation');
  await expect(pending).rejects.toThrow(/account|access/);
});
