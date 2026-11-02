import type { MouseEvent, RefObject } from 'react';
import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { Modal } from '../src/ui/redesign/Controls.tsx';
import { StorageHelp } from './offline/StorageHelp.tsx';
import type { DeviceInventory } from './offline/deviceStorage.ts';
import './deviceStorage.css';

export type DeviceItem = DeviceInventory['items'][number];
export type DeviceStorageDialog =
  { kind: 'about' } | { kind: 'remove'; item: DeviceItem; discard?: boolean } | null;
export type DeviceStorageOperation = 'persistence' | { itemId: string } | null;

export function deviceItemHref(item: DeviceItem) {
  if (item.pending || item.uncertain) return `/?offlineRecovery=${encodeURIComponent(item.itemId)}`;
  return item.spaceId
    ? `/spaces/${encodeURIComponent(item.spaceId)}?item=${encodeURIComponent(item.itemId)}`
    : `/?item=${encodeURIComponent(item.itemId)}`;
}

export function deviceBytes(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return 'Size unavailable';
  if (bytes < 1024) return `${Math.ceil(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const protection = {
  granted: 'Your browser granted storage protection.',
  denied: 'Your browser did not grant storage protection.',
  unsupported: 'This browser does not offer storage protection.',
  error: 'Storage protection could not be checked.',
  'not-requested': 'Storage protection has not been granted.',
} satisfies Record<DeviceInventory['persistence'], string>;

export type DeviceStoragePanelProps = {
  inventory: DeviceInventory | null;
  loading: boolean;
  error?: string;
  locked?: boolean;
  operation: DeviceStorageOperation;
  message?: { text: string; failed: boolean } | null;
  dialog: DeviceStorageDialog;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onRefresh: () => void;
  onRequestPersistence: () => void;
  onOpenDialog: (dialog: DeviceStorageDialog, trigger?: HTMLElement) => void;
  onConfirmRemove: () => void;
  allowNavigation: () => boolean;
  finalFocus?: () => HTMLElement | boolean | null;
};

/** Account-scoped data is supplied by the container; stories use the same rendered states. */
export function DeviceStoragePanel({
  inventory,
  loading,
  error,
  locked = false,
  operation,
  message,
  dialog,
  headingRef,
  onRefresh,
  onRequestPersistence,
  onOpenDialog,
  onConfirmRemove,
  allowNavigation,
  finalFocus,
}: DeviceStoragePanelProps) {
  const removing = typeof operation === 'object' && operation !== null;
  const selected = dialog?.kind === 'remove' ? dialog : null;
  const pending = Boolean(selected?.item.pending || selected?.item.uncertain);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (operation) {
      event.preventDefault();
      return;
    }
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
    <section className="device-storage sp-ui" aria-labelledby="device-storage-heading">
      <div className="device-storage-heading">
        <h2 id="device-storage-heading" ref={headingRef} tabIndex={-1}>
          Offline documents
        </h2>
        <button
          className="sp-control"
          disabled={loading || Boolean(operation) || locked}
          onClick={onRefresh}
        >
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>
      <p className="sp-muted">
        Downloads and saved offline changes for this account, in this browser.
      </p>
      {error && <p role="alert">{error}</p>}
      {loading && !inventory && <p role="status">Checking this device…</p>}
      {inventory && !locked && (
        <>
          <dl className="device-storage-usage">
            <div>
              <dt>This account’s documents</dt>
              <dd>
                {deviceBytes(inventory.bytes)}
                {inventory.bytes !== null && <span> estimated</span>}
              </dd>
            </div>
            <div>
              <dt>Browser storage for this site</dt>
              <dd>
                {inventory.origin.usage === undefined
                  ? 'Usage unavailable'
                  : deviceBytes(inventory.origin.usage)}
                {inventory.origin.quota !== undefined &&
                  ` of about ${deviceBytes(inventory.origin.quota)}`}
              </dd>
            </div>
          </dl>
          <p className="device-storage-caption sp-muted">
            Browser storage includes app files and other accounts. Estimates can change as you edit.
          </p>
          <div className="device-storage-protection">
            <p>{protection[inventory.persistence]}</p>
            <div className="device-storage-actions">
              {inventory.persistence !== 'granted' && inventory.persistence !== 'unsupported' && (
                <button
                  className="sp-control"
                  disabled={Boolean(operation)}
                  onClick={onRequestPersistence}
                >
                  {operation === 'persistence' ? 'Requesting…' : 'Request storage protection'}
                </button>
              )}
              <button
                className="sp-control sp-quiet"
                disabled={Boolean(operation)}
                onClick={(event) => onOpenDialog({ kind: 'about' }, event.currentTarget)}
              >
                About device storage
              </button>
            </div>
          </div>
          {inventory.problem && <p role="alert">{inventory.problem}</p>}
          {inventory.state === 'empty' && <p>No documents are downloaded for this account.</p>}
          {inventory.state === 'missing' && (
            <p role="status">
              The saved device data is missing. Connect to download documents again. Offline changes
              that were only on this device may be lost.
            </p>
          )}
          {inventory.state === 'unavailable' && (
            <p role="status">
              Device data could not be fully checked. It has not been removed. Try again before
              relying on an offline copy.
            </p>
          )}
          {inventory.items.length > 0 && (
            <ul className="device-storage-list" aria-label="Documents on this device">
              {inventory.items.map((item) => (
                <li key={item.itemId}>
                  <div className="device-storage-item">
                    <EntityIcon kind={item.kind} size={20} />
                    <div className="device-storage-item-body">
                      <a
                        className="device-storage-title"
                        href={deviceItemHref(item)}
                        onClick={follow}
                      >
                        {item.name}
                      </a>
                      <div className="device-storage-meta">
                        <span>{item.available ? 'Available offline' : 'Needs attention'}</span>
                        {(item.pending || item.uncertain) && <span>Pending changes</span>}
                        {item.readOnly && <span>View only</span>}
                        <span>{deviceBytes(item.bytes)}</span>
                      </div>
                      {item.spaceId && (
                        <p className="device-storage-caption sp-muted">
                          One downloaded page in a Space
                        </p>
                      )}
                      {item.problem && <p className="device-storage-problem">{item.problem}</p>}
                    </div>
                  </div>
                  <button
                    className="sp-control"
                    aria-label={`Remove ${item.name} from device`}
                    disabled={Boolean(operation)}
                    onClick={(event) => onOpenDialog({ kind: 'remove', item }, event.currentTarget)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {message && !selected && <p role={message.failed ? 'alert' : 'status'}>{message.text}</p>}
      <StorageHelp
        open={dialog?.kind === 'about'}
        onDismiss={() => onOpenDialog(null)}
        finalFocus={finalFocus}
      />
      {/* A controlled close resolves final focus after a removed row leaves the DOM. */}
      <Modal
        title={
          selected?.discard
            ? 'Discard offline changes?'
            : pending
              ? 'Keep your offline changes'
              : 'Remove device copy?'
        }
        icon={pending ? 'warning' : 'info'}
        open={selected !== null}
        dismissDisabled={removing}
        onOpenChange={(open) => {
          if (!open) onOpenDialog(null);
        }}
        finalFocus={finalFocus}
      >
        {selected && (
          <div className="device-storage-dialog">
            <p className="device-storage-dialog-name">{selected.item.name}</p>
            {selected.discard ? (
              <p>
                This removes the device copy and all its saved offline changes. Changes that have
                not reached the server will be lost. This cannot be undone. The original document
                stays unchanged.
              </p>
            ) : pending ? (
              <>
                <p>
                  This copy has saved or unverified offline changes. Removing it now could lose work
                  that has not reached the server.
                </p>
                <p>
                  {selected.item.uncertain || !selected.item.available
                    ? 'The device copy could not be fully checked. Recovery may be unavailable; keep it unless you are ready to discard its offline changes.'
                    : 'Open recovery to save a copy or export your work, or keep this device copy.'}
                </p>
              </>
            ) : (
              <p>
                Remove this downloaded copy from this device? The original document and its filing
                are kept. You will need a connection to download it again.
              </p>
            )}
            {message && <p role={message.failed ? 'alert' : 'status'}>{message.text}</p>}
            <div className="sp-actions device-storage-dialog-actions">
              {pending && !selected.discard ? (
                <>
                  <a
                    className="sp-control sp-primary"
                    href={`/?offlineRecovery=${encodeURIComponent(selected.item.itemId)}`}
                    onClick={follow}
                  >
                    Open recovery
                  </a>
                  <button className="sp-control" onClick={() => onOpenDialog(null)}>
                    Keep on device
                  </button>
                  <button
                    className="sp-control sp-quiet"
                    onClick={() => onOpenDialog({ ...selected, discard: true })}
                  >
                    Discard offline changes…
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="sp-control sp-primary"
                    disabled={removing}
                    onClick={onConfirmRemove}
                  >
                    {removing
                      ? 'Removing…'
                      : selected.discard
                        ? 'Discard offline changes'
                        : 'Remove from device'}
                  </button>
                  <button
                    className="sp-control"
                    disabled={removing}
                    onClick={() => onOpenDialog(null)}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
