/// <reference lib="webworker" />
import { iconSvg } from '../src/ui/appIcon.ts';
import {
  needsServer,
  parseShellManifest,
  PREPARE_SHELL,
  SHELL_CACHE_PREFIX,
  SHELL_PAGE,
} from '../src/shared/offlineShell.ts';
import type { PrepareShellReply } from '../src/shared/offlineShell.ts';
declare const self: ServiceWorkerGlobalScope;

// The build replaces this token with the emitted shell (vite.config.ts); in
// development there is no shell, so nothing is ever cached.
const shell = parseShellManifest('__SPINEL_SHELL_MANIFEST__');
const cacheName = shell ? SHELL_CACHE_PREFIX + shell.version : null;
const shellFiles = new Set(shell?.files);

// Public static copy only: never interpolate a URL, token or document into this page.
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

/** A device is prepared once someone downloaded a document on it (docs/offline.md). */
async function prepared() {
  return (await caches.keys()).some((key) => key.startsWith(SHELL_CACHE_PREFIX));
}

/**
 * Caches the allowlisted public shell. The page is fetched from the public
 * sign-in route without cookies, so no session or account data is cached. It
 * is written last: its presence marks this version's shell as complete.
 */
async function prepareShell() {
  if (!shell || !cacheName) throw new Error('Offline downloads need a production build of Spinel.');
  const cache = await caches.open(cacheName);
  for (const file of shell.files)
    if (!(await cache.match(file))) {
      const response = await fetch(file, { credentials: 'omit', cache: 'reload' });
      if (!response.ok) throw new Error('Could not keep Spinel on this device. Try again.');
      await cache.put(file, response);
    }
  if (!(await cache.match(SHELL_PAGE))) {
    const page = await fetch('/sign-in', {
      credentials: 'omit',
      cache: 'reload',
      redirect: 'error',
    });
    if (!page.ok) throw new Error('Could not keep Spinel on this device. Try again.');
    await cache.put(SHELL_PAGE, page);
  }
}

self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      // A prepared device keeps working offline after an update: cache the new
      // shell before this version takes over. A failure keeps the old worker.
      if (await prepared()) await prepareShell();
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(SHELL_CACHE_PREFIX) && key !== cacheName) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('message', (event) => {
  const port = event.ports[0];
  if (event.data?.type !== PREPARE_SHELL || !port) return;
  event.waitUntil(
    prepareShell().then(
      () => port.postMessage({ ok: true, version: shell!.version } satisfies PrepareShellReply),
      (error) =>
        port.postMessage({
          ok: false,
          error: error instanceof Error ? error.message : 'Could not keep Spinel on this device.',
        } satisfies PrepareShellReply),
    ),
  );
});

// `caches.match` with a cache name never creates a cache, so an unprepared
// device's CacheStorage stays empty.
const cachedShell = (path: string) =>
  cacheName ? caches.match(path, { cacheName }) : Promise.resolve(undefined);

async function navigate(request: Request, url: URL) {
  try {
    // Navigations always go to the server first and are never cached, so a
    // revoked session or link reaches the server whenever there is a network.
    return await fetch(request, { cache: 'no-store' });
  } catch {
    const page = needsServer(url.pathname) ? undefined : await cachedShell(SHELL_PAGE);
    // A fresh response: a cached page served for another URL is not a redirect.
    return page ? new Response(page.body, { status: 200, headers: page.headers }) : offlinePage();
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // APIs, images and other private requests go straight to the network.
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (url.pathname === '/favicon.svg')
    event.respondWith(new Response(iconSvg(), { headers: { 'Content-Type': 'image/svg+xml' } }));
  else if (event.request.mode === 'navigate') event.respondWith(navigate(event.request, url));
  else if (shellFiles.has(url.pathname) && !url.search)
    // Shell files are content-hashed, so a cached copy is always the right one.
    event.respondWith(cachedShell(url.pathname).then((cached) => cached ?? fetch(event.request)));
});
