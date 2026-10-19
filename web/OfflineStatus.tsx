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

/**
 * Local mode's banner: the list is the last one synced, never an empty or live
 * one. SPN-042's connection indicator will take over the "Files as of" line.
 */
export function OfflineBanner({ syncedAt }: { syncedAt: number }) {
  const synced = new Date(syncedAt);
  const sameDay = synced.toDateString() === new Date().toDateString();
  const time = synced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="banner" role="status">
      <span aria-hidden="true">⌁</span> <strong>Offline</strong> Files as of{' '}
      {sameDay ? time : `${synced.toLocaleDateString()} ${time}`}. Downloaded documents open
      read-only until you reconnect.
    </div>
  );
}
