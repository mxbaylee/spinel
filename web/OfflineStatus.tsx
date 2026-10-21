/** Row badge for an item kept on this device, or one that can't open offline. */
export function OfflineBadge({ state }: { state: 'available' | 'needs-connection' | null }) {
  if (!state) return null;
  return (
    <span className="offline-badge" data-state={state}>
      <span aria-hidden="true">{state === 'available' ? '⤓' : '⌁'}</span>{' '}
      {state === 'available' ? 'Available offline' : 'Needs a connection'}
    </span>
  );
}

/** No connection and no local data for this device's account: nothing to show. */
export function OfflineUnreachable() {
  return (
    <section className="welcome">
      <h1>You're offline</h1>
      <p>Connect to the internet, then try again to open Spinel.</p>
      <button className="primary" onClick={() => location.reload()}>
        Try again
      </button>
    </section>
  );
}
