import { afterEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { openExistingDatabase } from '../../web/offline/existingDatabase.ts';
import {
  completeRuntime,
  cachedInstallationAsset,
  fillRuntime,
  publishedBuilds,
  runtimeCacheName,
} from '../../web/offline/runtimeCache.ts';
import { emptyRuntimeState, initialRuntimeState } from '../../web/offline/runtimeStore.ts';
import {
  ensureAccountRuntime,
  installRuntimeHost,
  isRuntimeCompatible,
} from '../../web/offline/runtime.ts';
import type { ShellManifest } from '../shared/offlineShell.ts';
import { installationAssetName, installationPaths, pwaManifest } from '../shared/pwa.ts';
import type { InstallationPath } from '../shared/pwa.ts';
import { initializeTheme } from './theme.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const build = (id: string, format = 1): ShellManifest => ({
  protocol: 1,
  version: id.repeat(16),
  compatibility: { format, sdkVersion: '1.1.0' },
  entry: `/assets/app-${id}.js`,
  css: [`/assets/theme-${id}.css`],
  files: [`/assets/app-${id}.js`, `/assets/lazy-${id}.js`, `/assets/theme-${id}.css`],
});
const a = build('a'),
  b = build('b'),
  c = build('c', 2);
function opening() {
  const close = vi.fn();
  const abort = vi.fn();
  const request: {
    result: { close: typeof close; onversionchange?: () => void };
    transaction: { abort: typeof abort };
    error?: DOMException;
    onupgradeneeded?: (event: { oldVersion: number }) => void;
    onerror?: () => void;
    onsuccess?: () => void;
  } = { result: { close }, transaction: { abort } };
  const open = vi.fn(() => request);
  vi.stubGlobal('indexedDB', { open });
  return { close, abort, request, open };
}
test('an absent existing-only probe aborts creation without using databases enumeration', async () => {
  const f = opening();
  const pending = openExistingDatabase('spinel-offline-account');
  expect(f.open.mock.calls).toEqual([['spinel-offline-account']]);
  f.request.onupgradeneeded?.({ oldVersion: 0 });
  expect(f.abort).toHaveBeenCalledOnce();
  f.request.error = new DOMException('Aborted', 'AbortError');
  f.request.onerror?.();
  expect(await pending).toBeNull();
});
test('an existing database is returned without choosing a version and closes on versionchange', async () => {
  const f = opening();
  const pending = openExistingDatabase('spinel-offline-account');
  f.request.onsuccess?.();
  expect(await pending).toBe(f.request.result);
  f.request.result.onversionchange?.();
  expect(f.close).toHaveBeenCalledOnce();
});
test('timed-out database opening retires a late handle and still aborts a late create', async () => {
  vi.useFakeTimers();
  const f = opening();
  const pending = openExistingDatabase('spinel-offline-account', 10);
  const rejected = expect(pending).rejects.toThrow('did not respond');
  await vi.advanceTimersByTimeAsync(11);
  await rejected;
  f.request.onupgradeneeded?.({ oldVersion: 0 });
  f.request.onsuccess?.();
  expect(f.abort).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
});
test('an existing-only probe does not mistake a storage failure for an empty store', async () => {
  const f = opening();
  const pending = openExistingDatabase('spinel-offline-account');
  f.request.error = new DOMException('Blocked', 'SecurityError');
  f.request.onerror?.();
  await expect(pending).rejects.toMatchObject({ name: 'SecurityError' });
});

test.each([
  {
    label: 'verified empty current account',
    names: ['spinel-offline-fresh'],
    account: 'fresh',
    legacy: false,
  },
  { label: 'unverified current account', names: ['spinel-offline-fresh'], legacy: true },
  {
    label: 'another account alongside a verified empty current account',
    names: ['spinel-offline-fresh', 'spinel-offline-kept'],
    account: 'fresh',
    legacy: true,
  },
  { label: 'public control metadata alone', names: ['spinel-offline-runtime'], legacy: false },
  {
    label: 'a legacy cache despite verified emptiness',
    names: ['spinel-offline-fresh'],
    account: 'fresh',
    cache: true,
    legacy: true,
  },
  { label: 'missing enumeration on an apparently fresh device', account: 'fresh', legacy: true },
  {
    label: 'failed enumeration on an apparently fresh device',
    account: 'fresh',
    failed: true,
    legacy: true,
  },
])('initial runtime discovery respects $label without opening private stores', async (scenario) => {
  const open = vi.fn();
  const cachesOpen = vi.fn();
  vi.stubGlobal('caches', {
    keys: async () => (scenario.cache ? ['spinel-shell-legacy054'] : []),
    open: cachesOpen,
  });
  vi.stubGlobal('indexedDB', {
    open,
    databases: scenario.failed
      ? async () => {
          throw new Error('Storage unavailable');
        }
      : scenario.names
        ? async () => scenario.names.map((name) => ({ name }))
        : undefined,
  });
  const state = await initialRuntimeState(() => {}, scenario.account);
  expect(state.legacyCompatibility).toEqual(scenario.legacy ? a.compatibility : undefined);
  expect(state.accounts).toEqual({});
  expect(open).not.toHaveBeenCalled();
  expect(cachesOpen).not.toHaveBeenCalled();
});

test('retiring an application removes its theme reactions before another runtime starts', () => {
  const media = Object.assign(new EventTarget(), { matches: false });
  const browser = new EventTarget();
  const setProperty = vi.fn();
  const root = { dataset: {}, style: { colorScheme: '', setProperty } };
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('localStorage', { getItem: () => null });
  const stop = initializeTheme();
  expect(setProperty).toHaveBeenCalled();
  stop();
  setProperty.mockClear();
  media.dispatchEvent(new Event('change'));
  browser.dispatchEvent(
    Object.assign(new Event('storage'), { key: 'spinel-theme', newValue: 'dark' }),
  );
  expect(setProperty).not.toHaveBeenCalled();
  const next = initializeTheme();
  setProperty.mockClear();
  media.dispatchEvent(new Event('change'));
  expect(setProperty).toHaveBeenCalled();
  next();
});

test('cleanup may move an account compatibility hold to a newer complete compatible build', () => {
  const state = { ...emptyRuntimeState(), builds: [a, b], accounts: { account: a.compatibility } };
  expect(publishedBuilds(state, c, new Set(), 0)).toEqual([b, c]);
  expect(state.builds).toEqual([a, b]); // Selection itself cannot delete or rewrite anything.
});
test('an exact live-client pin wins over otherwise replaceable compatibility', () => {
  const state = { ...emptyRuntimeState(), builds: [a, b], accounts: { account: a.compatibility } };
  expect(publishedBuilds(state, c, new Set([a.version]), 0)).toEqual([a, c]);
});
test('all slots protected refuses publication rather than deleting a retained or live build', () => {
  const second = build('b', 2),
    third = build('c', 3);
  const state = {
    ...emptyRuntimeState(),
    builds: [a, second],
    accounts: { first: a.compatibility, second: second.compatibility },
  };
  expect(() => publishedBuilds(state, third, new Set(), 0)).toThrow('Other open tabs');
  expect(state.builds).toEqual([a, second]);
});
test('an unknown legacy client consumes a protected slot until its actual client closes', () => {
  const state = { ...emptyRuntimeState(), builds: [a], legacyCompatibility: a.compatibility };
  expect(() => publishedBuilds(state, c, new Set([a.version]), 1)).toThrow('Other open tabs');
  expect(publishedBuilds(state, c, new Set([a.version]), 0)).toEqual([a, c]);
});
test('releasing one account cannot release the independent unknown-legacy compatibility hold', () => {
  const state = { ...emptyRuntimeState(), builds: [a], legacyCompatibility: a.compatibility };
  expect(publishedBuilds(state, c, new Set(), 0)).toEqual([a, c]);
  expect(() => publishedBuilds({ ...state, builds: [] }, c, new Set(), 0)).toThrow(
    'compatible offline editor',
  );
});

function response(body: string | Uint8Array, path: string, mime: string) {
  const value = new Response(typeof body === 'string' ? body : new Uint8Array(body).buffer, {
    headers: { 'Content-Type': mime },
  });
  Object.defineProperty(value, 'url', { value: 'https://spinel.test' + path });
  return value;
}
const html = (manifest: ShellManifest) =>
  `<html><head><script id="spinel-runtime" type="application/json">${JSON.stringify(manifest)}</script></head><body></body></html>`;
function cacheFixture(manifest = a) {
  const data = new Map<string, Response>();
  for (const path of manifest.files)
    data.set(
      path,
      response(
        path.endsWith('.css') ? 'body{}' : 'export const ready=true;',
        path,
        path.endsWith('.css') ? 'text/css' : 'text/javascript',
      ),
    );
  data.set('/', response(html(manifest), '/sign-in', 'text/html'));
  const read = vi.fn(async (path: string) => data.get(path)?.clone());
  const put = vi.fn(async (path: string, value: Response) => {
    data.set(path, value.clone());
  });
  const open = vi.fn(async () => ({ match: read, put }));
  vi.stubGlobal('caches', { match: read, open });
  return { data, read, put, open };
}
test('readiness inspects every lazy asset and HTML identity without creating caches', async () => {
  const f = cacheFixture();
  expect(await completeRuntime(a)).toBe(true);
  expect(f.read.mock.calls.map(([path]) => path)).toEqual([...a.files, '/']);
  expect(f.open).not.toHaveBeenCalled();
  f.data.delete(a.files[1]);
  expect(await completeRuntime(a)).toBe(false);
  expect(f.open).not.toHaveBeenCalled();
});
test('cached HTML from another emitted build never marks this runtime complete', async () => {
  const f = cacheFixture();
  f.data.set('/', response(html(b), '/sign-in', 'text/html'));
  expect(await completeRuntime(a)).toBe(false);
});
test('a failed repair keeps its saved HTML and does not claim completeness', async () => {
  const f = cacheFixture();
  const saved = await f.data.get('/')!.clone().text();
  f.data.delete(a.files[1]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('missing', { status: 404 })),
  );
  await expect(fillRuntime(a, () => {}, new AbortController().signal)).rejects.toThrow(
    'missing or incomplete',
  );
  expect(await f.data.get('/')!.clone().text()).toBe(saved);
  expect(await completeRuntime(a)).toBe(false);
});
test.each(['wrong-build', 'redirect', 'html-asset'] as const)(
  '%s during preparation cannot create a complete marker',
  async (failure) => {
    const f = cacheFixture();
    f.data.clear();
    const fetched: { path: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      fetched.push({ path, init });
      if (path === '/sign-in') {
        if (failure === 'redirect') {
          const value = response(html(a), '/other', 'text/html');
          Object.defineProperty(value, 'redirected', { value: true });
          return value;
        }
        return response(html(b), '/sign-in', 'text/html');
      }
      return response(
        failure === 'html-asset' ? '<html>sign in</html>' : 'export const ready=true;',
        path,
        path.endsWith('.css') ? 'text/css' : 'text/javascript',
      );
    });
    await expect(fillRuntime(a, () => {}, new AbortController().signal)).rejects.toThrow();
    expect(f.data.has('/')).toBe(false);
    expect(
      fetched.every(({ init }) => init.credentials === 'omit' && init.redirect === 'error'),
    ).toBe(true);
    expect(f.open).toHaveBeenCalledWith(runtimeCacheName(a));
  },
);

async function installationFixture() {
  const assets = new Map<InstallationPath, Uint8Array>();
  assets.set('/manifest.webmanifest', Buffer.from(JSON.stringify(pwaManifest)));
  for (const size of [180, 192, 512] as const)
    assets.set(
      `/app-icon-${size}.png`,
      await sharp({ create: { width: size, height: size, channels: 4, background: '#c42c58' } })
        .png()
        .toBuffer(),
    );
  const installation = Object.fromEntries(
    installationPaths.map((path) => [
      path,
      installationAssetName(path, createHash('sha256').update(assets.get(path)!).digest('hex')),
    ]),
  ) as NonNullable<ShellManifest['installation']>;
  const current = {
    ...b,
    files: [...b.files, ...Object.values(installation)],
    installation,
  };
  const cached = cacheFixture(current);
  for (const path of installationPaths) {
    const file = installation[path];
    cached.data.set(
      file,
      response(
        assets.get(path)!,
        file,
        path === '/manifest.webmanifest' ? 'application/manifest+json' : 'image/png',
      ),
    );
  }
  const state = { ...emptyRuntimeState(), builds: [current] };
  return { ...cached, assets, current, state };
}

test('prepared installation resources resolve offline from one published runtime without creating a cache', async () => {
  const f = await installationFixture();
  const fetch = vi.fn(async () => {
    throw new Error('The network is offline');
  });
  vi.stubGlobal('fetch', fetch);
  expect(await completeRuntime(f.current)).toBe(true);
  for (const path of installationPaths) {
    const result = await cachedInstallationAsset(path, f.current.version, f.state);
    expect(result?.ok).toBe(true);
    expect(result!.url).toBe(''); // The worker's synthetic response retains the caller's fixed URL.
    expect(result!.redirected).toBe(false);
    expect(new Uint8Array(await result!.arrayBuffer())).toEqual(
      new Uint8Array(f.assets.get(path)!),
    );
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(f.open).not.toHaveBeenCalled();
});

test('installation reads cannot create caches, publish a candidate, or replace an older pinned runtime', async () => {
  const f = await installationFixture();
  for (const path of ['/api/items', '/app-icon-8192.png', '/manifest.webmanifest?token=secret'])
    expect(await cachedInstallationAsset(path, undefined, f.state)).toBeUndefined();
  expect(await cachedInstallationAsset('/manifest.webmanifest', undefined, null)).toBeUndefined();
  expect(
    await cachedInstallationAsset('/manifest.webmanifest', undefined, {
      ...emptyRuntimeState(),
      candidate: f.current,
    }),
  ).toBeUndefined();
  expect(
    await cachedInstallationAsset('/manifest.webmanifest', a.version, {
      ...f.state,
      builds: [a, f.current],
    }),
  ).toBeUndefined();
  f.data.delete('/');
  expect(
    await cachedInstallationAsset('/manifest.webmanifest', f.current.version, f.state),
  ).toBeUndefined();
  expect(f.open).not.toHaveBeenCalled();
  const legacy = cacheFixture(a);
  expect(await completeRuntime(a)).toBe(true);
  expect(legacy.read.mock.calls.map(([path]) => path)).toEqual([...a.files, '/']);
});

test.each([
  'missing',
  'mime',
  'different-bytes',
  'unsafe-manifest',
  'wrong-size',
  'oversized',
] as const)(
  'installation %s cannot claim readiness or publish a completed shell',
  async (failure) => {
    const f = await installationFixture();
    const path = failure === 'unsafe-manifest' ? '/manifest.webmanifest' : '/app-icon-192.png';
    let file = f.current.installation[path];
    let bytes = f.assets.get(path)!;
    if (failure === 'unsafe-manifest' || failure === 'wrong-size' || failure === 'oversized') {
      bytes =
        failure === 'unsafe-manifest'
          ? Buffer.from(JSON.stringify({ ...pwaManifest, start_url: '/?token=private' }))
          : failure === 'wrong-size'
            ? f.assets.get('/app-icon-180.png')!
            : new Uint8Array(100_001);
      const replaced = installationAssetName(
        path,
        createHash('sha256').update(bytes).digest('hex'),
      );
      f.current.files = f.current.files.map((entry) => (entry === file ? replaced : entry));
      f.data.delete(file);
      file = replaced;
      f.current.installation[path] = file;
      f.data.set('/', response(html(f.current), '/sign-in', 'text/html'));
    }
    const bad =
      failure === 'missing'
        ? new Response('missing', { status: 404 })
        : response(
            failure === 'different-bytes' ? f.assets.get('/app-icon-180.png')! : bytes,
            file,
            failure === 'mime'
              ? 'text/html'
              : path === '/manifest.webmanifest'
                ? 'application/manifest+json'
                : 'image/png',
          );
    f.data.set(file, bad);
    expect(await completeRuntime(f.current)).toBe(false);
    expect(await cachedInstallationAsset(path, f.current.version, f.state)).toBeUndefined();
    f.data.delete('/');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => bad.clone()),
    );
    await expect(fillRuntime(f.current, () => {}, new AbortController().signal)).rejects.toThrow(
      'missing or incomplete',
    );
    expect(f.data.has('/')).toBe(false);
  },
);

test('installation preparation fetches hash-addressed public bytes without credentials and publishes HTML last', async () => {
  const f = await installationFixture();
  const source = new Map(f.data);
  f.data.clear();
  const fetched: { path: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      fetched.push({ path, init });
      const value = source.get(path === '/sign-in' ? '/' : path)!.clone();
      Object.defineProperty(value, 'url', { value: 'https://spinel.test' + path });
      return value;
    }),
  );
  await fillRuntime(f.current, () => {}, new AbortController().signal);
  expect(await completeRuntime(f.current)).toBe(true);
  expect(f.put.mock.calls.at(-1)?.[0]).toBe('/');
  expect(fetched.map(({ path }) => path)).toEqual([...f.current.files, '/sign-in']);
  expect(
    fetched.every(
      ({ init }) =>
        init.credentials === 'omit' && init.cache === 'reload' && init.redirect === 'error',
    ),
  ).toBe(true);
});

test('compatible online recovery is independent of cached-public-shell readiness', async () => {
  vi.stubGlobal('window', {});
  installRuntimeHost({ manifest: null, compatibility: a.compatibility, switchTo: vi.fn() });
  expect(isRuntimeCompatible(a.compatibility)).toBe(true);
  expect(isRuntimeCompatible(c.compatibility)).toBe(false);
  expect(
    await ensureAccountRuntime(
      'account',
      { kind: 'retained', compatibility: a.compatibility },
      () => {},
    ),
  ).toEqual({ kind: 'ready', buildId: 'development' });
  expect(await ensureAccountRuntime('account', { kind: 'unknown' }, () => {})).toEqual({
    kind: 'unavailable',
    reason: 'unknown-format',
  });
});
