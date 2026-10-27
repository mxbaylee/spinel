import { Modal } from '../../src/ui/redesign/Controls.tsx';
import type { MouseEvent } from 'react';
import type { OfflineMessage } from './useOfflineDownloads.ts';

/** Pending removal keeps work in place and offers the same guarded routes in every host. */
export function OfflineAvailabilityActions({
  message,
  allowNavigation = () => true,
}: {
  message: OfflineMessage;
  allowNavigation?: () => boolean;
}) {
  if (!message.recoveryItemId) return null;
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
    <div className="sp-actions">
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
    </div>
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
      {message.detail && <p>{message.detail}</p>}
      <OfflineAvailabilityActions message={message} allowNavigation={allowNavigation} />
      <button className="sp-control" onClick={onDismiss}>
        Done
      </button>
    </Modal>
  );
}
