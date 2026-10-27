import { afterEach, expect, test, vi } from 'vitest';
import { openExistingDatabase } from '../../web/offline/existingDatabase.ts';
import {
  completeRuntime,
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

function response(body: string, path: string, mime: string) {
  const value = new Response(body, { headers: { 'Content-Type': mime } });
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
