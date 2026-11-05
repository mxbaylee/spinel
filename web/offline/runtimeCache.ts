import {
  isShellAsset,
  runtimeDescriptor,
  sameCompatibility,
  SHELL_CACHE_PREFIX,
  SHELL_PAGE,
} from '../../src/shared/offlineShell.ts';
import type { RuntimeCompatibility, ShellManifest } from '../../src/shared/offlineShell.ts';
import type { RuntimeState } from './runtimeStore.ts';
import {
  installationAssetDigest,
  installationPaths,
  isInstallationPath,
  validPwaManifest,
} from '../../src/shared/pwa.ts';
import type { InstallationPath } from '../../src/shared/pwa.ts';

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
async function validInstallationAsset(
  response: Response | undefined,
  path: InstallationPath,
  file: string,
) {
  const expected = installationAssetDigest(path, file);
  const manifest = path === '/manifest.webmanifest';
  if (
    !expected ||
    !response?.ok ||
    response.redirected ||
    response.headers.get('Content-Type')?.split(';')[0].trim() !==
      (manifest ? 'application/manifest+json' : 'image/png')
  )
    return false;
  const reader = response.clone().body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > (manifest ? 16_384 : 100_000)) {
        // Cache responses can already be cloned tees. Rejection must not wait
        // for an unused parent branch to consume or cancel its own response.
        void reader.cancel().catch(() => {});
        void response.body?.cancel().catch(() => {});
        return false;
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== expected) return false;
    if (manifest) return validPwaManifest(JSON.parse(new TextDecoder().decode(bytes)));
    const size = Number(path.match(/\d+/)![0]);
    return (
      bytes.length >= 33 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) &&
      new DataView(bytes.buffer).getUint32(8) === 13 &&
      new TextDecoder().decode(bytes.slice(12, 16)) === 'IHDR' &&
      new DataView(bytes.buffer).getUint32(16) === size &&
      new DataView(bytes.buffer).getUint32(20) === size
    );
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
}
async function validRuntimeAsset(
  response: Response | undefined,
  file: string,
  manifest: ShellManifest,
) {
  const installation = installationPaths.find((path) => manifest.installation?.[path] === file);
  return installation
    ? validInstallationAsset(response, installation, file)
    : validAsset(response, file);
}
const identical = (left: ShellManifest | null, right: ShellManifest) =>
  left !== null && JSON.stringify(left) === JSON.stringify(right);

/** Observational: CacheStorage.match does not create an empty cache. */
export async function completeRuntime(manifest: ShellManifest, verify: () => void = () => {}) {
  const cacheName = runtimeCacheName(manifest);
  for (const file of manifest.files) {
    verify();
    if (!(await validRuntimeAsset(await caches.match(file, { cacheName }), file, manifest)))
      return false;
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
    if (await validRuntimeAsset(await cache.match(file), file, manifest)) continue;
    const response = await fetch(file, {
      credentials: 'omit',
      cache: 'reload',
      redirect: 'error',
      signal,
    });
    verify();
    if (
      !(await validRuntimeAsset(response, file, manifest)) ||
      new URL(response.url).pathname !== file
    )
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

/** Public fixed URLs use one published build; reads never create or repair caches. */
export async function cachedInstallationAsset(
  path: string,
  preferred: string | undefined,
  state: RuntimeState | null,
) {
  if (!isInstallationPath(path)) return undefined;
  const selected = state?.builds.find((manifest) => manifest.version === preferred);
  const manifests = selected ? [selected] : [...(state?.builds ?? [])].reverse();
  for (const manifest of manifests) {
    const file = manifest.installation?.[path];
    if (!file) continue; // Earlier complete runtimes retain their original contract.
    const cacheName = runtimeCacheName(manifest);
    const page = await caches.match(SHELL_PAGE, { cacheName });
    if (!page?.ok || !page.headers.get('Content-Type')?.startsWith('text/html')) continue;
    try {
      if (!identical(runtimeDescriptor(await page.text()), manifest)) continue;
    } catch {
      continue;
    }
    const response = await caches.match(file, { cacheName });
    if (!(await validInstallationAsset(response, path, file))) return undefined;
    // A synthetic response keeps the fixed request URL, rather than exposing
    // its hash-addressed cache URL as a redirect. No second HTTP cache is needed.
    return new Response(response!.body, {
      headers: {
        'Content-Type': response!.headers.get('Content-Type')!,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  return undefined;
}
