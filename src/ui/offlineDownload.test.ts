import { afterEach, expect, test, vi } from 'vitest';
import { checkBundle, DownloadError } from '../../web/offline/download.ts';
import { isNetworkFailure } from '../../web/offline/localStart.ts';
import { OFFLINE_SDK_VERSION } from '../../web/offline/OfflineAccess.ts';
import type { OfflineBundle } from '../shared/offlineBundle.ts';

afterEach(() => {
  vi.unstubAllGlobals();
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
    snapshot: { id: 'unit' },
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
  // A viewer's copy must open read-only (docs/offline.md).
  ['an editable viewer copy', { access: 'viewer', readOnly: false }],
])('a bundle for %s is refused', (_, change) => {
  vi.stubGlobal('location', { origin: 'https://spinel.example' });
  expect(() => checkBundle(bundle(change), 'owner', 'item')).toThrow(DownloadError);
});

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
