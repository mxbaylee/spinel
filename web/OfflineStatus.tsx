import { AccessState } from './AccessState.tsx';
import type { OfflineDownload } from './offline/offlineStore.ts';
import { spaceCopies } from './offline/spaceCopies.ts';
import type { ConnectionState } from './connectionState.ts';
import type { DashboardOfflineState } from './DashboardFiles.tsx';
import type { QueuedPhase } from './SyncStatus.tsx';

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

/** What the sync status shows: every file that needs a choice, and the queue that sends itself. */
export function syncSummary(downloads: Iterable<OfflineDownload>, connection: ConnectionState) {
  const all = [...downloads];
  const count = all.filter(needsSync).length;
  const recover = all
    .filter((download) => download.pending && download.retained && !download.creation)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ itemId, name }) => ({ itemId, name }));
  return {
    recover,
    // Online, the replay owner sends every eligible file; otherwise they wait for the connection.
    queued: count ? { phase: syncPhase(connection), count } : undefined,
  };
}
/** The row badge for work on this device that hasn't reached the server, or null when there is none. */
export function pendingBadge(
  download: OfflineDownload | undefined,
  needs: boolean,
  connection: ConnectionState,
): DashboardOfflineState {
  const creation = download?.creation;
  if (creation) return creation.problem ? 'needs-attention' : 'not-synced';
  if (download?.pending && download.retained) return 'needs-attention';
  return needs ? syncPhase(connection) : null;
}
export const syncPhase = (connection: ConnectionState): QueuedPhase =>
  connection === 'online' ? 'syncing' : 'waiting';

/** Row badge for an item kept on this device, or one that can't open offline. */
export function OfflineBadge({ state }: { state: DashboardOfflineState }) {
  if (!state) return null;
  return (
    <span className="offline-badge" data-state={state === 'pages-available' ? 'available' : state}>
      <span aria-hidden="true">
        {state === 'needs-attention'
          ? '!'
          : state === 'not-synced' || state === 'waiting'
            ? '↥'
            : state === 'syncing'
              ? '↻'
              : state === 'needs-connection'
                ? '⌁'
                : '⤓'}
      </span>{' '}
      {state === 'pages-available'
        ? 'Pages available offline'
        : state === 'not-synced'
          ? 'Not synced yet'
          : state === 'waiting'
            ? 'Waiting to sync'
            : state === 'syncing'
              ? 'Syncing now'
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
