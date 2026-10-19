/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope;

// Public static copy only: never interpolate a URL, token or document into this page.
const offline = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#c42c58"><title>Spinel — Offline</title><style>body{font:1.1rem system-ui,sans-serif;margin:0;padding:3rem 1.5rem;background:#fff5f2;color:#4a1e33}main{max-width:32rem;margin:auto}button{font:inherit;min-height:44px;padding:.75rem 1rem;border:0;border-radius:.5rem;background:#c42c58;color:white}</style></head><body><main><h1>You're offline</h1><p>Connect to the internet, then try again to open Spinel. Documents are not stored on this device for offline use.</p><button id="retry">Try again</button></main><script>document.getElementById('retry').addEventListener('click',()=>location.reload());</script></body></html>`;

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  // APIs, images and other subresources go straight to the network. Even navigation
  // responses are never cached; a revoked session/link must reach the server again.
  if (
    event.request.mode !== 'navigate' ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(
      () =>
        new Response(offline, {
          status: 503,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy':
              "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          },
        }),
    ),
  );
});
