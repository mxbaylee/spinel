import { AccessState } from './AccessState.tsx';
import type { OfflineDownload } from './offline/offlineStore.ts';
import { spaceCopies } from './offline/spaceCopies.ts';

/** Saved edits that deliver by themselves; creations and retained work have their own states. */
export const needsSync = (download?: OfflineDownload) =>
  Boolean(download?.pending && !download.retained && !download.creation);

/** A Space has no edits of its own: its pages carry them, so any pending page copy counts. */
export function itemNeedsSync(
  item: { id: string; kind: string },
  downloads: ReadonlyMap<string, OfflineDownload>,
) {
  return (
    needsSync(downloads.get(item.id)) ||
    (item.kind === 'space' &&
      spaceCopies(downloads.values(), item.id).some((copy) => needsSync(copy)))
  );
}

/** Pins files that still need to sync above everything else; the sort is stable. */
export function pendingFirst<T>(items: readonly T[], needs: (item: T) => boolean): T[] {
  const pinned = new Map(items.map((item) => [item, Number(needs(item))]));
  return [...items].sort((a, b) => pinned.get(b)! - pinned.get(a)!);
}

/** Informational only: ordinary unsynced edits ask nothing of the person. */
export function OfflineSyncNotice({ downloads }: { downloads: Iterable<OfflineDownload> }) {
  const count = [...downloads].filter(needsSync).length;
  if (!count) return null;
  return (
    <p className="offline-sync-notice" role="status">
      <strong>
        <span aria-hidden="true">↥</span> Needs to sync
      </strong>{' '}
      {count === 1 ? '1 file has' : `${count} files have`} changes saved on this device. They send
      on their own when you are online. Nothing to do.
    </p>
  );
}

/** Row badge for an item kept on this device, or one that can't open offline. */
export function OfflineBadge({
  state,
}: {
  state:
    'available' | 'pages-available' | 'needs-connection' | 'not-synced' | 'needs-attention' | null;
}) {
  if (!state) return null;
  return (
    <span className="offline-badge" data-state={state === 'pages-available' ? 'available' : state}>
      <span aria-hidden="true">
        {state === 'needs-attention'
          ? '!'
          : state === 'not-synced'
            ? '↥'
            : state === 'needs-connection'
              ? '⌁'
              : '⤓'}
      </span>{' '}
      {state === 'pages-available'
        ? 'Pages available offline'
        : state === 'not-synced'
          ? 'Not synced yet'
          : state === 'needs-attention'
            ? 'Needs attention'
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
