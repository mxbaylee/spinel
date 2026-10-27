import { ItemIcon } from './Appearance.tsx';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { accessLabel, fileKindLabel } from '../src/shared/workspace.ts';
import type { FileItem } from '../src/shared/workspace.ts';
import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { ActionMenu } from '../src/ui/redesign/Controls.tsx';
import type { Action } from '../src/ui/redesign/Controls.tsx';
import { OfflineBadge } from './OfflineStatus.tsx';
import './DashboardFiles.css';

export type DashboardFileLayout = 'list' | 'grid';
export type DashboardOfflineState =
  'available' | 'pages-available' | 'needs-connection' | 'not-synced' | 'needs-attention' | null;

export { filenameEmoji } from '../src/shared/appearance.ts';

export interface DashboardFilesProps<T extends FileItem = FileItem> {
  items: readonly T[];
  layout?: DashboardFileLayout;
  onOpen: (item: T) => void;
  /** Supply only actions authorized by the existing controller. Open is added here. */
  actionsFor?: (item: T) => Action[];
  offlineState?: (item: T) => DashboardOfflineState;
  /** Accessible metadata only: for example the search service's authorized paths. */
  details?: (item: T) => ReactNode;
  dateMode?: 'updated' | 'shared';
  busy?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  label?: string;
  openLabel?: (item: T) => string;
  /** Permanent Trash is a destination, never an ordinary mutable file. */
  onOpenTrash?: () => void;
}

export function DashboardFiles<T extends FileItem>({
  items,
  layout = 'list',
  onOpen,
  actionsFor,
  offlineState,
  details,
  dateMode = 'updated',
  busy = false,
  loading = false,
  error,
  onRetry,
  emptyMessage = 'This folder is empty. Choose New to add a file.',
  label = 'Folder contents',
  openLabel = (item) => `${item.name} ${fileKindLabel[item.kind]}`,
  onOpenTrash,
}: DashboardFilesProps<T>) {
  const descriptionId = useId();
  if (error)
    return (
      <div className="dashboard-files-state">
        <p role="alert">{error}</p>
        {onRetry && <button onClick={onRetry}>Try again</button>}
      </div>
    );
  if (loading)
    return (
      <p className="dashboard-files-state" role="status">
        Loading files…
      </p>
    );
  return (
    <div className="dashboard-files-section">
      <div
        className={`sp-ui dashboard-files dashboard-files-${layout}`}
        role="list"
        aria-label={label}
      >
        {items.map((item, index) => {
          const date = dateMode === 'shared' ? item.sharedAt : item.updatedAt;
          const detail = details?.(item);
          // Legacy grants use zero for unknown dates, never a Unix-epoch share date.
          const validDate =
            date !== undefined &&
            (dateMode !== 'shared' || date > 0) &&
            Number.isFinite(new Date(date).getTime());
          const actions: Action[] = [
            { label: 'Open', onClick: () => onOpen(item), disabled: busy },
            ...(actionsFor?.(item) ?? []).map((action) => ({
              ...action,
              disabled: busy || action.disabled,
            })),
          ];
          return (
            <div className="dashboard-file" role="listitem" key={item.id}>
              <button
                className="dashboard-file-open"
                aria-label={openLabel(item)}
                aria-describedby={`${descriptionId}-${index}`}
                disabled={busy}
                onClick={() => onOpen(item)}
              >
                <span className="dashboard-file-identity" aria-hidden="true">
                  <ItemIcon {...item} size={28} />
                </span>
                <span className="dashboard-file-description">
                  <strong>{item.name}</strong>
                  <span className="dashboard-file-metadata" id={`${descriptionId}-${index}`}>
                    <span className="dashboard-file-type">
                      {item.kind !== 'folder' && <EntityIcon kind={item.kind} size={16} />}
                      {fileKindLabel[item.kind]}
                    </span>
                    <span>
                      {item.access === 'owner' ? 'Owner' : `Shared · ${accessLabel(item.access)}`}
                    </span>
                    {item.access !== 'owner' && (
                      <span>Owner: {item.ownerName ?? 'Owner unavailable'}</span>
                    )}
                    <OfflineBadge state={offlineState?.(item) ?? null} />
                  </span>
                  {item.tags.length > 0 && (
                    <span className="dashboard-file-tags" aria-label="Tags">
                      {item.tags.slice(0, 2).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                      {item.tags.length > 2 && (
                        <span title={item.tags.slice(2).join(', ')}>
                          +{item.tags.length - 2} more tags
                        </span>
                      )}
                    </span>
                  )}
                  {detail != null && <span className="dashboard-file-details">{detail}</span>}
                </span>
              </button>
              <span className="dashboard-file-date">
                {validDate ? (
                  <time
                    dateTime={new Date(date!).toISOString()}
                    title={`${dateMode === 'shared' ? 'Shared' : 'Last edited'} ${new Date(date!).toLocaleString()}`}
                  >
                    {new Date(date!).toLocaleDateString()}
                  </time>
                ) : dateMode === 'shared' ? (
                  'Older share'
                ) : (
                  'Date unavailable'
                )}
              </span>
              <div className="dashboard-file-menu">
                <ActionMenu label={`More actions for ${item.name}`} actions={actions} />
              </div>
            </div>
          );
        })}
        {onOpenTrash && (
          <div className="dashboard-file dashboard-file-trash" role="listitem">
            <button className="dashboard-file-open" onClick={onOpenTrash} disabled={busy}>
              <span className="dashboard-file-identity" aria-hidden="true">
                <ProfileIcon icon="lucide:trash-2" size={28} />
              </span>
              <span className="dashboard-file-description">
                <strong>Trash</strong>
                <span className="dashboard-file-metadata">Recently deleted files</span>
              </span>
            </button>
          </div>
        )}
      </div>
      {!items.length && <p className="dashboard-files-state">{emptyMessage}</p>}
    </div>
  );
}
