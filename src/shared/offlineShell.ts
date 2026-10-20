/**
 * The offline app shell (docs/offline.md): the public, versioned build files a
 * prepared device keeps in CacheStorage so Spinel can start without a network.
 * Nothing private is ever listed here; documents live in IndexedDB.
 */
export type ShellManifest = { version: string; files: string[] };
export type PrepareShellReply = { ok: true; version: string } | { ok: false; error: string };

/** The page asks the service worker to cache the shell with this message type. */
export const PREPARE_SHELL = 'spinel-prepare-shell';
export const SHELL_CACHE_PREFIX = 'spinel-shell-';
/** The build replaces this token in service-worker.js with the manifest JSON. */
export const SHELL_PLACEHOLDER = '__SPINEL_SHELL_MANIFEST__';
/** The page HTML is cached under this key, fetched from the public sign-in route. */
export const SHELL_PAGE = '/';

/** Emitted build files that belong in the shell: hashed assets, never source maps. */
export function shellFiles(fileNames: readonly string[]) {
  return fileNames
    .filter((name) => /^assets\/[^/]+$/.test(name) && !name.endsWith('.map'))
    .map((name) => `/${name}`)
    .sort();
}

/** Reads the build's manifest; returns null in development, where there is none. */
export function parseShellManifest(text: string): ShellManifest | null {
  if (!text.startsWith('{')) return null;
  const manifest = JSON.parse(text) as ShellManifest;
  if (
    typeof manifest.version !== 'string' ||
    !/^[a-f0-9]{16}$/.test(manifest.version) ||
    !Array.isArray(manifest.files) ||
    manifest.files.some((file) => typeof file !== 'string' || !/^\/assets\/[^/]+$/.test(file))
  )
    throw new Error('The offline app shell manifest is malformed.');
  return manifest;
}

/** Navigations that never fall back to the private app shell offline. */
export function needsServer(pathname: string) {
  return pathname.startsWith('/share/') || pathname === '/setup' || pathname === '/invite';
}
