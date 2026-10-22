import type {
  SpaceDeletePreview,
  SpaceRecoveryItem,
  SpaceTrashListing,
} from '../src/shared/spaces.ts';
import { kindLabel } from '../src/shared/workspace.ts';
import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';

export function SpaceTrash({
  listing,
  spaceName,
  disabled,
  busy,
  error,
  notice,
  preview,
  onReload,
  onRestore,
  onPreviewDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  listing: SpaceTrashListing | null;
  spaceName: string;
  disabled: boolean;
  busy: boolean;
  error: string;
  notice: string;
  preview: SpaceDeletePreview | null;
  onReload(): void;
  onRestore(item: SpaceRecoveryItem): void;
  onPreviewDelete(item: SpaceRecoveryItem): void;
  onCancelDelete(): void;
  onConfirmDelete(preview: SpaceDeletePreview): void;
}) {
  return (
    <section className="space-trash" aria-label="Deleted Space contents">
      <p>
        Restore pages, Sheets and folders to their original location. Their contents stay together.
      </p>
      {disabled && <p role="status">Reconnect to restore or permanently delete Space contents.</p>}
      {notice && (
        <p className="space-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="space-error" role="alert">
          <p>{error}</p>
          <Button disabled={busy} onClick={onReload}>
            Refresh Trash
          </Button>
        </div>
      )}
      {!listing ? (
        !error && <p role="status">Loading Space Trash…</p>
      ) : listing.items.length ? (
        <div role="list" aria-label="Deleted pages and folders">
          {listing.items.map((item) => (
            <div className="space-trash-row" role="listitem" aria-label={item.name} key={item.id}>
              <span className="space-item-icon">
                {item.kind === 'folder' ? (
                  <ProfileIcon icon="lucide:folder" size={32} />
                ) : (
                  <EntityIcon kind={item.kind} size={32} />
                )}
              </span>
              <div className="space-trash-detail">
                <strong>{item.name}</strong>
                <span>
                  {kindLabel[item.kind]}
                  {item.descendantCount > 0 ? ` · ${item.descendantCount} descendants` : ''}
                </span>
                <span>
                  {item.originalLocation
                    ? 'From ' + item.originalLocation.name
                    : 'Original location unavailable.'}
                </span>
                <span>Deleted {new Date(item.trashedAt).toLocaleString()}</span>
                {!item.originalLocation && (
                  <span>Restores to {spaceName} because its original location is unavailable.</span>
                )}
              </div>
              <div className="space-trash-actions">
                <Button
                  disabled={disabled || busy}
                  aria-label={`Restore ${item.name}`}
                  onClick={() => onRestore(item)}
                >
                  Restore
                </Button>
                {listing.access === 'owner' && (
                  <ActionMenu
                    label={`Actions for deleted ${item.name}`}
                    actions={[
                      {
                        label: 'Delete permanently',
                        destructive: true,
                        disabled: disabled || busy,
                        onClick: () => onPreviewDelete(item),
                      },
                    ]}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-empty">
          <ProfileIcon icon="lucide:trash-2" size={40} />
          <h2>Space Trash is empty</h2>
          <p>Deleted pages, Sheets and folders appear here.</p>
        </div>
      )}
      {preview && listing?.access === 'owner' && (
        <Modal
          icon="trash"
          title={`Delete ${preview.root.name} permanently?`}
          open
          dismissDisabled={busy}
          description="This deletes the following subtree. It cannot be restored afterward."
          onOpenChange={(open) => {
            if (!open) onCancelDelete();
          }}
        >
          <p>
            {preview.counts.total} items: {preview.counts.docs} Docs, {preview.counts.sheets} Sheets
            and {preview.counts.folders} folders.
          </p>
          <ul className="space-delete-list" aria-label="Items to delete">
            {preview.items.map((item) => (
              <li key={item.id}>
                {item.name} <span className="sp-muted">{kindLabel[item.kind]}</span>
              </li>
            ))}
          </ul>
          {error && <p role="alert">{error}</p>}
          {disabled && <p role="status">Reconnect before deleting this subtree.</p>}
          <div className="sp-actions">
            <Button disabled={busy} onClick={onCancelDelete}>
              Cancel
            </Button>
            <Button primary disabled={busy || disabled} onClick={() => onConfirmDelete(preview)}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
