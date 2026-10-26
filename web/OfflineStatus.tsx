import { AccessState } from './AccessState.tsx';

/** Row badge for an item kept on this device, or one that can't open offline. */
export function OfflineBadge({
  state,
}: {
  state: 'available' | 'pages-available' | 'needs-connection' | null;
}) {
  if (!state) return null;
  return (
    <span className="offline-badge" data-state={state === 'pages-available' ? 'available' : state}>
      <span aria-hidden="true">{state === 'needs-connection' ? '⌁' : '⤓'}</span>{' '}
      {state === 'pages-available'
        ? 'Pages available offline'
        : state === 'available'
          ? 'Available offline'
          : 'Needs a connection'}
    </span>
  );
}

/** No connection and no local data for this device's account: nothing to show. */
export function OfflineUnreachable() {
  return <AccessState kind="offline" embedded onRetry={() => location.reload()} />;
}
