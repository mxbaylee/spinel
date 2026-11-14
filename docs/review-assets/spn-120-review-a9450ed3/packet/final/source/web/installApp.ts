export function registerAppWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  // Registration does not reload an editor or cache any document data.
  void navigator.serviceWorker
    .register(import.meta.env.DEV ? '/service-worker.ts' : '/service-worker.js', {
      type: 'module',
      scope: '/',
      updateViaCache: 'none',
    })
    .catch(() => {
      // The online app still works if a browser or privacy setting disallows workers.
      console.warn('Spinel offline screen is unavailable in this browser.');
    });
}
