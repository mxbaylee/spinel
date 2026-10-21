import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import type { ConnectionState } from './connectionState.ts';

export type CatalogConnectionDetails = { syncedAt: number; local: boolean; stale: boolean };

const names: Record<ConnectionState, string> = {
  online: 'Online — connected to Spinel',
  offline: 'Offline — not connected to Spinel',
  reconnecting: 'Reconnecting — connecting to Spinel',
};
const labels: Record<ConnectionState, string> = {
  online: 'Online',
  offline: 'Offline',
  reconnecting: 'Reconnecting',
};

function catalogTime(timestamp: number) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString()} ${time}`;
}

/** One fixed connection control; it deliberately makes no save/durability claim. */
export function ConnectionStatus({
  state,
  catalog,
  documentOpen = false,
}: {
  state: ConnectionState;
  catalog?: CatalogConnectionDetails | null;
  documentOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detail =
    state === 'online'
      ? 'Connected to Spinel.'
      : state === 'offline'
        ? 'You are offline. Spinel will try to reconnect automatically.'
        : 'Reconnecting to Spinel. Waiting for the connection to be ready.';
  return (
    <span className="connection-status" data-state={state}>
      <span
        className="connection-announcement"
        role="status"
        aria-label="Connection status"
        aria-live="polite"
        aria-atomic="true"
      >
        {labels[state]}
      </span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className="connection-trigger"
          aria-label={names[state]}
          openOnHover
          delay={200}
          onFocus={(event) => {
            // Keyboard focus exposes the same accessible detail as hover/tap.
            // Pointer focus leaves click/touch toggling to the public primitive.
            if (event.currentTarget.matches(':focus-visible')) setOpen(true);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {state === 'reconnecting' ? (
              <path d="M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 3 M4 15l2 3a7 7 0 0 0 12-1" />
            ) : (
              <path
                d={`M2 8q10-8 20 0 M5 12q7-6 14 0 M8 16q4-4 8 0 M12 20h.01${state === 'offline' ? ' M3 3l18 18' : ''}`}
              />
            )}
          </svg>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner className="connection-positioner" side="right" sideOffset={8}>
            <Popover.Popup
              className="connection-detail"
              aria-label="Connection details"
              initialFocus={false}
              finalFocus={false}
            >
              <strong>{labels[state]}</strong>
              <p>{detail}</p>
              {documentOpen && (
                <p>
                  Keep this tab open if changes are pending. Check the document’s separate save
                  status before closing.
                </p>
              )}
              {catalog &&
                catalog.syncedAt > 0 &&
                (catalog.local || catalog.stale || state !== 'online') && (
                  <p>Files as of {catalogTime(catalog.syncedAt)}.</p>
                )}
              {catalog?.local && (
                <p>
                  Downloaded documents are read-only in this session. Reopen Spinel while connected
                  to edit.
                </p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
