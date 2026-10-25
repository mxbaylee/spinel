import { Modal } from '../../src/ui/redesign/Controls.tsx';
import type { OfflineMessage } from './useOfflineDownloads.ts';

/** Explicit offline actions report their result without displacing the editor. */
export function OfflineAvailability({
  message,
  onDismiss,
  finalFocus,
}: {
  message: OfflineMessage;
  onDismiss: () => void;
  finalFocus?: () => HTMLElement | boolean | null;
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
      <button className="sp-control" onClick={onDismiss}>
        Done
      </button>
    </Modal>
  );
}
