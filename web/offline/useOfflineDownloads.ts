import { useEffect, useRef, useState } from 'react';
import type { SpaceFile, WorkspaceItem } from '../../src/shared/workspace.ts';
import { DownloadError, downloadForOffline } from './download.ts';
import type { LocalStart } from './localStart.ts';
import {
  openOfflineStore,
  preparedAccount,
  setPreparedAccount,
  spaceOfflineCatalog,
} from './offlineStore.ts';
import type { OfflineCatalog, OfflineDownload, OfflineStore, OfflineUser } from './offlineStore.ts';
import { prepareShell } from './shell.ts';

export type OfflineMessage = { text: string; failed: boolean };

/**
 * This account's downloads on this device. Online, it downloads and removes
 * items, keeps the last-synced catalog once the device is prepared, and
 * refreshes each download in the background. In local mode it only reads.
 */
export function useOfflineDownloads(
  user: OfflineUser,
  local: LocalStart | null | undefined,
  catalog: () => OfflineCatalog | null,
  options: { spaceRoot?: SpaceFile } = {},
) {
  const [downloads, setDownloads] = useState(
    () => new Map(local?.downloads.map((download) => [download.itemId, download])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<OfflineMessage | null>(null);
  const mounted = useRef(false);
  // A download can take minutes; read the catalog as it is when it finishes.
  const latestCatalog = useRef(catalog);
  latestCatalog.current = catalog;
  const latestRoot = useRef(options.spaceRoot);
  latestRoot.current = options.spaceRoot;
  // The server admits one transfer at a time; run refreshes and toggles in turn.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function serially<T>(work: (store: OfflineStore) => Promise<T>) {
    const run = queue.current.then(async () => {
      const store = await openOfflineStore(user.id);
      try {
        return await work(store);
      } finally {
        store.close();
      }
    });
    queue.current = run.catch(() => {});
    return run;
  }
  function set(download: OfflineDownload) {
    if (mounted.current)
      setDownloads((previous) => new Map(previous).set(download.itemId, download));
  }
  function unset(itemId: string) {
    if (!mounted.current) return;
    setDownloads((previous) => {
      const next = new Map(previous);
      next.delete(itemId);
      return next;
    });
  }

  useEffect(() => {
    mounted.current = true;
    if (local || preparedAccount() !== user.id)
      return () => {
        mounted.current = false;
      };
    let cancelled = false;
    void serially(async (store) => {
      const known = await store.downloads();
      if (cancelled) return;
      setDownloads(new Map(known.map((download) => [download.itemId, download])));
      // Keep the shell current after an update or eviction, then refresh each
      // copy. A failed refresh keeps the last complete copy. A document this
      // account can no longer open is removed: SPN-039's copies hold no edits.
      await prepareShell();
      for (const download of known) {
        if (cancelled) return;
        try {
          set(await downloadForOffline(store, download.itemId, download.spaceId));
        } catch (error) {
          if (error instanceof DownloadError && error.status === 404) {
            await store.remove(download.itemId);
            unset(download.itemId);
            if (!(await store.downloads()).length) setPreparedAccount(null);
          }
        }
      }
    }).catch(() => {
      // Refreshing is best effort; downloads stay as they were.
    });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [user.id, local]);

  async function saveCatalog(value: OfflineCatalog) {
    if (local || preparedAccount() !== user.id) return;
    await serially((store) => store.saveCatalog({ id: user.id, name: user.name }, value));
  }

  async function toggle(item: Pick<WorkspaceItem, 'id' | 'name' | 'kind'>, spaceId?: string) {
    if (local || busy) return;
    if (!['doc', 'sheet'].includes(item.kind)) {
      setMessage({ text: 'Only Sheets and Docs can be downloaded.', failed: true });
      return;
    }
    const downloaded = downloads.has(item.id) && downloads.get(item.id)!.spaceId === spaceId;
    // Offline launch needs the file list as well as the document; the device
    // counts as prepared only once both are stored.
    const atClick = downloaded ? null : latestCatalog.current();
    const rootAtClick = latestRoot.current;
    if (spaceId !== undefined && rootAtClick?.id !== spaceId) {
      setMessage({ text: 'Open this Space again before preparing a copy.', failed: true });
      return;
    }
    if (!downloaded && !atClick && !rootAtClick) {
      setMessage({ text: 'Wait for your files to load, then try again.', failed: true });
      return;
    }
    setBusy(item.id);
    setMessage(null);
    try {
      await serially(async (store) => {
        if (downloaded) {
          await store.remove(item.id);
          unset(item.id);
          // With nothing left to open, the device is no longer prepared.
          if (!(await store.downloads()).length) setPreparedAccount(null);
          return;
        }
        const download = await downloadForOffline(store, item.id, spaceId);
        // Keep the newest catalog; a refresh that failed meanwhile falls back
        // to the one there at the click, so a prepared device always has one.
        let current = latestCatalog.current() ?? atClick ?? (await store.catalog());
        const root = latestRoot.current?.id === spaceId ? latestRoot.current : rootAtClick;
        if (spaceId !== undefined && root?.id === spaceId)
          current = spaceOfflineCatalog(root, current ?? undefined);
        try {
          if (!current) throw new Error('This file list is incomplete. Try again.');
          await store.saveCatalog({ id: user.id, name: user.name }, current);
        } catch (error) {
          // A copy with no file list can't open offline; don't keep it.
          await store.remove(item.id).catch(() => {});
          throw error;
        }
        setPreparedAccount(user.id);
        set(download);
      });
      setMessage({
        text: downloaded
          ? `${item.name} was removed from this device.`
          : `${item.name} is available offline on this device.`,
        failed: false,
      });
    } catch (error) {
      setMessage({
        text:
          error instanceof Error && error.message
            ? error.message
            : 'Could not change offline availability. Try again.',
        failed: true,
      });
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  return { downloads, busy, message, toggle, saveCatalog };
}
