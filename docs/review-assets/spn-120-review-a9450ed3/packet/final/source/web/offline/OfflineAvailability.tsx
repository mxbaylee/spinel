import { Modal } from '../../src/ui/redesign/Controls.tsx';
import { useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { OfflineMessage } from './useOfflineDownloads.ts';
import { StorageHelp } from './StorageHelp.tsx';

/**
 * Pending removal keeps work in place and offers the same guarded routes in
 * every host. `children` (a dialog's Done) closes the same action row.
 */
export function OfflineAvailabilityActions({
  message,
  allowNavigation = () => true,
  children,
}: {
  message: OfflineMessage;
  allowNavigation?: () => boolean;
  children?: ReactNode;
}) {
  // Keyed by the result text, not the message object: a late storage answer
  // replaces the message. Once a result has offered the guide, its button
  // stays for that result, so an answer neither moves Done under a tap, closes
  // an open guide, nor removes the button the guide's focus returns to.
  const [offeredFor, setOfferedFor] = useState<string | null>(null);
  const [helpOpenFor, setHelpOpenFor] = useState<string | null>(null);
  const helpTrigger = useRef<HTMLButtonElement>(null);
  if (message.storageHelp && offeredFor !== message.text) setOfferedFor(message.text);
  const offered = message.storageHelp || offeredFor === message.text;
  if (!message.recoveryItemId && !offered && !children) return null;
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    if (!allowNavigation()) event.preventDefault();
  };
  return (
    <>
      <div className="sp-actions">
        {message.recoveryItemId && (
          <>
            <a
              className="sp-control sp-primary"
              href={`/?offlineRecovery=${encodeURIComponent(message.recoveryItemId)}`}
              onClick={follow}
            >
              Open recovery
            </a>
            <a className="sp-control" href="/profile#device" onClick={follow}>
              Manage device copies
            </a>
          </>
        )}
        {offered && (
          <button
            className="sp-control sp-quiet"
            ref={helpTrigger}
            onClick={() => setHelpOpenFor(message.text)}
          >
            How to keep them
          </button>
        )}
        {children}
      </div>
      <StorageHelp
        open={helpOpenFor === message.text}
        onDismiss={() => setHelpOpenFor(null)}
        finalFocus={() => helpTrigger.current}
      />
    </>
  );
}

/** Explicit offline actions report their result without displacing the editor. */
export function OfflineAvailability({
  message,
  onDismiss,
  finalFocus,
  allowNavigation,
}: {
  message: OfflineMessage;
  onDismiss: () => void;
  finalFocus?: () => HTMLElement | boolean | null;
  allowNavigation?: () => boolean;
}) {
  return (
    <Modal
      title="Offline availability"
      icon={message.failed ? 'warning' : 'info'}
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
      finalFocus={finalFocus}
    >
      <p role={message.failed ? 'alert' : 'status'}>{message.text}</p>
      {/* A late storage answer replaces this detail, so it is announced. */}
      {message.detail && <p aria-live="polite">{message.detail}</p>}
      {/* The playbook's dialog actions sit together, bottom right. */}
      <OfflineAvailabilityActions message={message} allowNavigation={allowNavigation}>
        <button className="sp-control" onClick={onDismiss}>
          Done
        </button>
      </OfflineAvailabilityActions>
    </Modal>
  );
}
