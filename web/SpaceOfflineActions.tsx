import { useId } from 'react';
import type { SpaceNode } from '../src/shared/spaces.ts';
import type { SpaceFile } from '../src/shared/workspace.ts';
import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { Button } from '../src/ui/redesign/Controls.tsx';
import type { SpaceUser } from './SpaceShell.tsx';
import { spaceCopies } from './offline/spaceCopies.ts';
import { useOfflineDownloads } from './offline/useOfflineDownloads.ts';
import { OfflineAvailabilityActions } from './offline/OfflineAvailability.tsx';
import './spaceOffline.css';

/** Mounted only for an everyday account; a guest never opens an offline store. */
export function SpaceOfflineActions({
  user,
  root,
  item,
  saved,
  onOpen,
  allowNavigation = () => true,
}: {
  user: SpaceUser;
  root: SpaceFile;
  item: SpaceNode | null;
  saved: boolean;
  onOpen(id: string): void;
  allowNavigation?: () => boolean;
}) {
  const offline = useOfflineDownloads(user, undefined, () => null, { spaceRoot: root });
  const hint = useId();
  const copies = spaceCopies(offline.downloads.values(), root.id);
  const current =
    item?.spaceId === root.id &&
    item.id !== root.id &&
    (item.kind === 'doc' || item.kind === 'sheet')
      ? item
      : null;
  const downloaded = Boolean(current && copies.some((copy) => copy.itemId === current.id));
  if (!current && !copies.length && !offline.message) return null;
  return (
    <section className="space-offline-actions" aria-label="Offline availability">
      {current && (
        <div className="space-offline-current">
          <Button
            disabled={offline.busy !== null || (!downloaded && !saved)}
            aria-describedby={!downloaded && !saved ? hint : undefined}
            aria-label={
              downloaded
                ? `Remove ${current.name} from this device`
                : `Make ${current.name} available offline on this device`
            }
            onClick={() => void offline.toggle(current, root.id)}
          >
            {offline.busy === current.id
              ? downloaded
                ? 'Removing…'
                : 'Downloading…'
              : downloaded
                ? 'Remove from device'
                : 'Make available offline'}
          </Button>
          {downloaded && (
            <span className="sp-muted">
              {copies.find((copy) => copy.itemId === current.id)?.available === false
                ? 'Device copy needs attention'
                : 'Available on this device'}
            </span>
          )}
          {!downloaded && !saved && (
            <p id={hint} className="sp-muted">
              Wait until this page is connected and saved to prepare an offline copy.
            </p>
          )}
        </div>
      )}
      {copies.length > 0 && (
        <details className="space-prepared-pages">
          <summary>On this device ({copies.length})</summary>
          <ul className="space-copy-list" aria-label="Prepared pages in this Space">
            {copies.map((copy) => (
              <li key={copy.itemId}>
                <button
                  type="button"
                  className="space-page-link"
                  aria-current={copy.itemId === current?.id ? 'page' : undefined}
                  onClick={() => onOpen(copy.itemId)}
                >
                  <EntityIcon kind={copy.kind} size={20} />
                  <span>{copy.name}</span>
                </button>
                {copy.available === false && <span className="sp-muted">Needs attention</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {offline.message && (
        <>
          <p role={offline.message.failed ? 'alert' : 'status'}>{offline.message.text}</p>
          {offline.message.detail && <p>{offline.message.detail}</p>}
          <OfflineAvailabilityActions message={offline.message} allowNavigation={allowNavigation} />
        </>
      )}
    </section>
  );
}
