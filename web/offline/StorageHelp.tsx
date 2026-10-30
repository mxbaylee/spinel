import { Modal } from '../../src/ui/redesign/Controls.tsx';
import './storageHelp.css';

/** One guide for download results and Profile → This device; it also opens offline. */
export function StorageHelp({
  open,
  onDismiss,
  finalFocus,
}: {
  open: boolean;
  onDismiss: () => void;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  return (
    <Modal
      title="About device storage"
      icon="info"
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      finalFocus={finalFocus}
    >
      <div className="storage-help">
        <p>
          Downloads stay in this browser profile. Use a regular window and return to the same
          profile; Private Browsing and Incognito can remove downloads when you close them.
        </p>
        <p>
          Check storage protection in Profile → This device and allow it if your browser asks. Keep
          free disk space and avoid cleanup settings that remove this site’s browsing data.
        </p>
        <details>
          <summary>Browser storage limits</summary>
          <ul>
            <li>
              <strong>Chrome</strong> decides whether to grant protection automatically. Without it,
              storage pressure can remove downloads.
            </li>
            <li>
              <strong>Firefox</strong> may ask for permission. Allow persistent storage for Spinel
              when prompted.
            </li>
            <li>
              <strong>Safari</strong> decides automatically. It may also clear downloads after seven
              days of Safari use without interacting with Spinel.
            </li>
          </ul>
        </details>
        <p>
          Protection is not a backup or a guarantee. Clearing browser data or losing this device can
          erase unsynced changes. Server backups cannot restore edits that never reached the server.
        </p>
        <p>
          Before clearing data, connect and open pending documents until they show Synced, or use
          recovery to export your work. A home-screen shortcut does not download a document.
        </p>
        <div className="sp-actions">
          <button className="sp-control sp-primary" onClick={onDismiss}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
