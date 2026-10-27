/// <reference lib="webworker" />
import { faviconSvg } from '../src/ui/favicon.ts';
import {
  LEGACY_COMPATIBILITY,
  needsServer,
  parseShellManifest,
  PREPARE_SHELL,
  RUNTIME_MESSAGE,
  sameCompatibility,
  SHELL_CACHE_PREFIX,
  SHELL_PAGE,
  validCompatibility,
} from '../src/shared/offlineShell.ts';
import type { RuntimeCommand, RuntimeReply, ShellManifest } from '../src/shared/offlineShell.ts';
import {
  initialRuntimeState,
  readRuntimeState,
  RUNTIME_LOCK,
  writeRuntimeState,
} from './offline/runtimeStore.ts';
import type { RuntimeState } from './offline/runtimeStore.ts';
import {
  cachedAsset,
  compatibleBuild,
  completeRuntime,
  fillRuntime,
  knownManifests,
  publishedBuilds,
  runtimeCacheName,
} from './offline/runtimeCache.ts';
declare const self: ServiceWorkerGlobalScope;

const shell = parseShellManifest('__SPINEL_SHELL_MANIFEST__');
// These are actual Client.id values, never caller-supplied tab identifiers.
const observedClients = new Map<string, string[]>();

const offline = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#c42c58"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="robots" content="noindex"><title>Spinel — Offline</title><style>body{font:1.1rem system-ui,sans-serif;margin:0;padding:3rem 1.5rem;background:#fff5f2;color:#4a1e33}main{max-width:32rem;margin:auto}button{font:inherit;min-height:44px;padding:.75rem 1rem;border:0;border-radius:.5rem;background:#c42c58;color:white}</style></head><body><main><h1>You're offline</h1><p>Connect to the internet, then try again to open this page.</p><button id="retry">Try again</button></main><script>document.getElementById('retry').addEventListener('click',()=>location.reload());</script></body></html>`;
const offlinePage = () =>
  new Response(offline, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });

function locked<T>(operation: () => Promise<T>) {
  if (!self.navigator.locks)
    throw new Error('This browser cannot safely update offline app files.');
  // Queue synchronously, before the operation can yield. A timed-out old request
  // cannot be reordered after a later reservation under the same origin lock.
  return self.navigator.locks.request(RUNTIME_LOCK, operation);
}

async function shellCaches() {
  return (await caches.keys()).filter((name) => name.startsWith(SHELL_CACHE_PREFIX));
}

async function reconcile(state: RuntimeState, verify: () => void) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  verify();
  const live = new Set(clients.map((client) => client.id));
  for (const id of Object.keys(state.clients)) if (!live.has(id)) delete state.clients[id];
  for (const [id, build] of observedClients) {
    if (!live.has(id)) observedClients.delete(id);
    else if (!Object.hasOwn(state.clients, id)) state.clients[id] = build;
  }
  const unknown = clients.some((client) => !Object.hasOwn(state.clients, client.id));
  return { liveBuilds: new Set(Object.values(state.clients).flat()), unknown };
}

async function legacyCaches(state: RuntimeState) {
  const known = new Set(
    [...state.builds, ...(state.candidate ? [state.candidate] : [])].map(runtimeCacheName),
  );
  return (await shellCaches()).filter((name) => !known.has(name));
}

async function prepare(
  manifest: ShellManifest,
  state: RuntimeState,
  verify: () => void,
  deadline: number,
  accountId?: string,
) {
  const { liveBuilds, unknown } = await reconcile(state, verify);
  const legacy = await legacyCaches(state);
  verify();
  // A legacy eager entry cannot be dynamically imported by the new host.
  // Establish a complete format-1 host before replacing its worker.
  if (
    legacy.length &&
    !sameCompatibility(manifest.compatibility, LEGACY_COMPATIBILITY) &&
    !state.builds.some((build) => sameCompatibility(build.compatibility, LEGACY_COMPATIBILITY))
  )
    throw new Error('The previous offline editor must remain available for retained work.');
  if (accountId) state.accounts = { ...state.accounts, [accountId]: manifest.compatibility };
  if (state.candidate && state.candidate.version !== manifest.version) {
    if (unknown || liveBuilds.has(state.candidate.version))
      throw new Error('Another open tab needs an unfinished app download. Close it and try again.');
    await caches.delete(runtimeCacheName(state.candidate));
    verify();
    delete state.candidate;
  }
  const alreadyPublished = state.builds.some((build) => build.version === manifest.version);
  if (!alreadyPublished) {
    // Two complete slots plus one candidate, counting unclassified legacy caches.
    if (state.builds.length + legacy.length > 2)
      throw new Error('Close unused tabs before preparing another app version.');
    state.candidate = manifest;
  }
  await writeRuntimeState(state, verify);
  if (!(await completeRuntime(manifest, verify)))
    await fillRuntime(manifest, verify, AbortSignal.timeout(Math.max(1, deadline - Date.now())));
  verify();

  const protectedLegacy = unknown ? legacy.length : 0;
  const protectedBuilds = unknown
    ? new Set([...liveBuilds, ...state.builds.map((build) => build.version)])
    : liveBuilds;
  const selected = publishedBuilds(state, manifest, protectedBuilds, protectedLegacy);
  const keep = new Set(selected.map(runtimeCacheName));
  // Publish holds and the complete build before deleting any unprotected cache.
  state.builds = selected;
  delete state.candidate;
  await writeRuntimeState(state, verify);
  for (const name of await shellCaches()) {
    verify();
    if (!keep.has(name) && !(unknown && legacy.includes(name))) await caches.delete(name);
  }
  return manifest;
}

async function command(request: RuntimeCommand, clientId: string): Promise<RuntimeReply> {
  const verify = () => {
    if (Date.now() > request.deadline)
      throw new Error('Offline app preparation took too long. Try again.');
  };
  verify();
  const existing = await readRuntimeState();
  verify();
  const known = knownManifests(existing, shell);
  const executing = known.get(request.buildId);
  if (request.type === 'readiness') {
    if (!existing || !request.accountId || !Object.hasOwn(existing.accounts, request.accountId))
      return { ok: true, prepared: false };
    const matching = existing.builds.filter((build) =>
      sameCompatibility(build.compatibility, existing.accounts[request.accountId!]),
    );
    const manifest = await compatibleBuild(existing, existing.accounts[request.accountId], verify);
    if (manifest) return { ok: true, prepared: true, manifest };
    const names = await shellCaches();
    return {
      ok: true,
      prepared: false,
      reason: matching.length
        ? matching.some((build) => names.includes(runtimeCacheName(build)))
          ? 'incomplete-cache'
          : 'missing-cache'
        : 'missing-compatible-runtime',
    };
  }
  if (request.type === 'bootstrap') {
    let manifest = executing;
    if (existing && request.accountId && Object.hasOwn(existing.accounts, request.accountId)) {
      manifest =
        (await compatibleBuild(existing, existing.accounts[request.accountId], verify)) ??
        executing;
    }
    if (manifest) {
      observedClients.set(clientId, [...new Set([request.buildId, manifest.version])]);
      if (existing && self.navigator.locks) {
        existing.clients[clientId] = [...new Set([request.buildId, manifest.version])];
        await reconcile(existing, verify);
        await writeRuntimeState(existing, verify);
      }
    }
    return { ok: true, manifest };
  }
  if (request.type === 'claim') {
    observedClients.set(clientId, [request.buildId]);
    if (existing) {
      existing.clients[clientId] = [request.buildId];
      await reconcile(existing, verify);
      await writeRuntimeState(existing, verify);
    }
    return { ok: true };
  }
  if (!request.accountId) throw new Error('An account is required for offline preparation.');
  if (request.type === 'release') {
    if (!existing) return { ok: true };
    delete existing.accounts[request.accountId];
    await reconcile(existing, verify);
    await writeRuntimeState(existing, verify);
    // The small public cache is bounded during preparation. Releasing an
    // account never removes a live editor or the unknown-legacy requirement.
    return { ok: true };
  }
  const state =
    existing ??
    (await initialRuntimeState(
      verify,
      request.type === 'prepare' && request.requirement?.kind === 'empty'
        ? request.accountId
        : undefined,
    ));
  if (request.type === 'admit') {
    const requirement = request.requirement;
    if (requirement?.kind === 'unknown') return { ok: true, reason: 'unknown-format' };
    if (requirement?.kind === 'empty') return { ok: true, manifest: executing };
    if (requirement?.kind !== 'retained' || !validCompatibility(requirement.compatibility))
      throw new Error('The retained offline format is unknown.');
    state.accounts = { ...state.accounts, [request.accountId]: requirement.compatibility };
    const manifest =
      executing && sameCompatibility(executing.compatibility, requirement.compatibility)
        ? executing
        : await compatibleBuild(state, requirement.compatibility, verify);
    // Preserve the requirement even when its public cache is missing.
    if (manifest) {
      state.clients[clientId] = [...new Set([request.buildId, manifest.version])];
      observedClients.set(clientId, [...new Set([request.buildId, manifest.version])]);
    }
    await reconcile(state, verify);
    await writeRuntimeState(state, verify);
    return manifest ? { ok: true, manifest } : { ok: true, reason: 'missing-compatible-runtime' };
  }
  if (!executing)
    throw new Error('This app version cannot be prepared. Reload when your work is saved.');
  state.clients[clientId] = [executing.version];
  observedClients.set(clientId, [executing.version]);
  await prepare(executing, state, verify, request.deadline, request.accountId);
  return { ok: true, manifest: executing, prepared: true };
}

self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      if (shell && (await shellCaches()).length) {
        await locked(async () => {
          const deadline = Date.now() + 180_000;
          const verify = () => {
            if (Date.now() > deadline) throw new Error('Offline app update timed out.');
          };
          const state = (await readRuntimeState()) ?? (await initialRuntimeState(verify));
          await prepare(shell, state, verify, deadline);
        });
      }
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const port = event.ports[0];
  const source = event.source as Client | null;
  if (!port || !source || typeof source.id !== 'string') return;
  const legacy = event.data?.type === PREPARE_SHELL;
  if (!legacy && event.data?.type !== RUNTIME_MESSAGE) return;
  event.waitUntil(
    (async () => {
      try {
        if (legacy) {
          if (!shell || !sameCompatibility(shell.compatibility, LEGACY_COMPATIBILITY))
            throw new Error('This app update needs a fresh start after your work is saved.');
          await locked(async () => {
            const deadline = Date.now() + 180_000;
            const verify = () => {
              if (Date.now() > deadline) throw new Error('Offline app update timed out.');
            };
            const state = (await readRuntimeState()) ?? (await initialRuntimeState(verify));
            state.legacyCompatibility = LEGACY_COMPATIBILITY;
            await prepare(shell, state, verify, deadline);
          });
          port.postMessage({ ok: true, version: shell.version });
          return;
        }
        const request = event.data.request as RuntimeCommand;
        if (
          !request ||
          request.protocol !== 1 ||
          typeof request.id !== 'string' ||
          !Number.isFinite(request.deadline) ||
          request.deadline > Date.now() + 181_000 ||
          !['bootstrap', 'claim', 'admit', 'prepare', 'readiness', 'release'].includes(
            request.type,
          ) ||
          typeof request.buildId !== 'string' ||
          (request.accountId !== undefined &&
            (typeof request.accountId !== 'string' ||
              !request.accountId ||
              request.accountId.length > 200))
        )
          throw new Error('Invalid offline app request.');
        const result =
          request.type === 'readiness' || (request.type === 'bootstrap' && !self.navigator.locks)
            ? await command(request, source.id)
            : await locked(() => command(request, source.id));
        port.postMessage(result);
      } catch (error) {
        port.postMessage({
          ok: false,
          error: error instanceof Error ? error.message : 'Offline app storage is unavailable.',
        });
      }
    })(),
  );
});

async function navigate(request: Request, url: URL) {
  try {
    return await fetch(request, { cache: 'no-store' });
  } catch {
    if (needsServer(url.pathname)) return offlinePage();
    const state = await readRuntimeState().catch(() => null);
    for (const manifest of [...(state?.builds ?? [])].reverse()) {
      if (!(await completeRuntime(manifest).catch(() => false))) continue;
      const page = await caches.match(SHELL_PAGE, { cacheName: runtimeCacheName(manifest) });
      if (page) return new Response(page.body, { status: 200, headers: page.headers });
    }
    return offlinePage();
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (url.pathname === '/favicon.svg')
    event.respondWith(new Response(faviconSvg(), { headers: { 'Content-Type': 'image/svg+xml' } }));
  else if (event.request.mode === 'navigate') event.respondWith(navigate(event.request, url));
  else if (url.pathname.startsWith('/assets/') && !url.search)
    event.respondWith(
      (async () => {
        const state = await readRuntimeState().catch(() => null);
        const preferred = (
          observedClients.get(event.clientId) ?? state?.clients[event.clientId]
        )?.at(-1);
        return (await cachedAsset(url.pathname, preferred, state)) ?? fetch(event.request);
      })(),
    );
});
