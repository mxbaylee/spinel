import {
  isShellAsset,
  runtimeDescriptor,
  sameCompatibility,
  SHELL_CACHE_PREFIX,
  SHELL_PAGE,
} from '../../src/shared/offlineShell.ts';
import type { RuntimeCompatibility, ShellManifest } from '../../src/shared/offlineShell.ts';
import type { RuntimeState } from './runtimeStore.ts';

export const runtimeCacheName = (manifest: Pick<ShellManifest, 'version'>) =>
  SHELL_CACHE_PREFIX + manifest.version;

function contentType(response: Response, path: string) {
  const mime = response.headers.get('Content-Type')?.split(';')[0].trim() ?? '';
  if (path.endsWith('.js')) return /^(?:text|application)\/(?:javascript|ecmascript)$/.test(mime);
  if (path.endsWith('.css')) return mime === 'text/css';
  return !mime.includes('html') && Boolean(mime);
}
function validAsset(response: Response | undefined, path: string) {
  return Boolean(response?.ok && !response.redirected && contentType(response, path));
}
const identical = (left: ShellManifest | null, right: ShellManifest) =>
  left !== null && JSON.stringify(left) === JSON.stringify(right);

/** Observational: CacheStorage.match does not create an empty cache. */
export async function completeRuntime(manifest: ShellManifest, verify: () => void = () => {}) {
  const cacheName = runtimeCacheName(manifest);
  for (const file of manifest.files) {
    verify();
    if (!validAsset(await caches.match(file, { cacheName }), file)) return false;
    verify();
  }
  const page = await caches.match(SHELL_PAGE, { cacheName });
  verify();
  if (!page?.ok || !page.headers.get('Content-Type')?.startsWith('text/html')) return false;
  try {
    const descriptor = runtimeDescriptor(await page.text());
    verify();
    return identical(descriptor, manifest);
  } catch {
    return false;
  }
}

/** Only allowlisted public bytes are fetched; HTML completion is written last. */
export async function fillRuntime(
  manifest: ShellManifest,
  verify: () => void,
  signal: AbortSignal,
) {
  verify();
  const cache = await caches.open(runtimeCacheName(manifest));
  verify();
  for (const file of manifest.files) {
    signal.throwIfAborted();
    verify();
    if (validAsset(await cache.match(file), file)) continue;
    const response = await fetch(file, {
      credentials: 'omit',
      cache: 'reload',
      redirect: 'error',
      signal,
    });
    verify();
    if (!validAsset(response, file) || new URL(response.url).pathname !== file)
      throw new Error('A Spinel app file is missing or incomplete. Try again.');
    if (file.endsWith('.js') || file.endsWith('.css')) {
      // A misconfigured fallback can return HTML with a JavaScript MIME type.
      if (/^\s*</.test(await response.clone().text()))
        throw new Error('A Spinel app file contained a web page. Try again.');
      verify();
    }
    await cache.put(file, response);
    verify();
  }
  const page = await fetch('/sign-in', {
    credentials: 'omit',
    cache: 'reload',
    redirect: 'error',
    signal,
  });
  verify();
  if (
    !page.ok ||
    page.redirected ||
    new URL(page.url).pathname !== '/sign-in' ||
    !page.headers.get('Content-Type')?.startsWith('text/html') ||
    !identical(runtimeDescriptor(await page.clone().text()), manifest)
  )
    throw new Error('Spinel changed while its app files were downloading. Try again.');
  verify();
  await cache.put(SHELL_PAGE, page);
  verify();
  if (!(await completeRuntime(manifest, verify)))
    throw new Error('The Spinel app download is incomplete.');
}

export function knownManifests(state: RuntimeState | null, current: ShellManifest | null) {
  const result = new Map<string, ShellManifest>();
  for (const manifest of [...(state?.builds ?? []), state?.candidate, current])
    if (manifest) result.set(manifest.version, manifest);
  return result;
}

export async function compatibleBuild(
  state: RuntimeState,
  compatibility: RuntimeCompatibility,
  verify: () => void,
) {
  for (const manifest of [...state.builds].reverse()) {
    if (
      sameCompatibility(manifest.compatibility, compatibility) &&
      (await completeRuntime(manifest, verify))
    )
      return manifest;
  }
  return undefined;
}

/**
 * Select the two complete builds before deleting any bytes. Exact live-client
 * holds and one complete build for each retained compatibility must all fit.
 */
export function publishedBuilds(
  state: RuntimeState,
  incoming: ShellManifest,
  liveBuilds: ReadonlySet<string>,
  legacySlots: number,
) {
  const all = [...state.builds.filter((build) => build.version !== incoming.version), incoming];
  const protect = new Set(liveBuilds);
  protect.add(incoming.version);
  const requirements = [
    ...Object.values(state.accounts),
    ...(state.legacyCompatibility ? [state.legacyCompatibility] : []),
  ];
  for (const requirement of requirements) {
    const matching = [...all]
      .reverse()
      .filter((build) => sameCompatibility(build.compatibility, requirement));
    // A build already protected by an open tab can satisfy the compatibility
    // hold too; do not reserve a redundant third slot for the same format.
    const candidate = matching.find((build) => protect.has(build.version)) ?? matching[0];
    if (!candidate) throw new Error('A compatible offline editor must be retained.');
    protect.add(candidate.version);
  }
  const required = all.filter((build) => protect.has(build.version));
  const capacity = 2 - legacySlots;
  if (required.length > capacity)
    throw new Error(
      'Other open tabs or retained offline work need the saved app versions. Close unused tabs and try again.',
    );
  const selected = new Set(required.map((build) => build.version));
  for (const build of [...all].reverse()) if (selected.size < capacity) selected.add(build.version);
  return all.filter((build) => selected.has(build.version));
}

export async function cachedAsset(
  path: string,
  preferred: string | undefined,
  state: RuntimeState | null,
) {
  if (!isShellAsset(path)) return undefined;
  const names = [
    ...(preferred ? [SHELL_CACHE_PREFIX + preferred] : []),
    ...[...(state?.builds ?? [])].reverse().map(runtimeCacheName),
    ...(await caches.keys()).filter((name) => name.startsWith(SHELL_CACHE_PREFIX)),
  ];
  for (const cacheName of new Set(names)) {
    const response = await caches.match(path, { cacheName });
    if (validAsset(response, path)) return response;
  }
  return undefined;
}
