import { useLayoutEffect, useRef, useState } from 'react';
import type { SpaceFile, WorkspaceItem } from '../../src/shared/workspace.ts';
import { DownloadError, downloadForOffline } from './download.ts';
import type { LocalStart } from './localStart.ts';
import {
  openOfflineStore,
  offlinePreparation,
  preparedAccount,
  spaceOfflineCatalog,
  watchOfflineAccount,
} from './offlineStore.ts';
import type {
  OfflineCatalog,
  OfflineDownload,
  OfflinePreparation,
  OfflineStore,
  OfflineUser,
} from './offlineStore.ts';
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
    () =>
      new Map(
        local?.user.id === user.id
          ? local.downloads.map((download) => [download.itemId, download])
          : [],
      ),
  );
  const [shownAccount, setShownAccount] = useState(user.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<OfflineMessage | null>(null);
  const mounted = useRef<{ accountId: string } | null>(null);
  const latestAccount = useRef(user.id);
  latestAccount.current = user.id;
  function preparation(reportFailure = false) {
    const lifetime = mounted.current;
    if (!lifetime || lifetime.accountId !== user.id || latestAccount.current !== user.id)
      return null;
    try {
      return offlinePreparation(
        user.id,
        () => mounted.current === lifetime && latestAccount.current === user.id,
      );
    } catch (error) {
      if (reportFailure)
        setMessage({
          text: error instanceof Error ? error.message : 'Could not prepare offline storage.',
          failed: true,
        });
      return null;
    }
  }
  // A download can take minutes; read the catalog as it is when it finishes.
  const latestCatalog = useRef(catalog);
  latestCatalog.current = catalog;
  const latestRoot = useRef(options.spaceRoot);
  latestRoot.current = options.spaceRoot;
  // The server admits one transfer at a time; run refreshes and toggles in turn.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function serially<T>(scope: OfflinePreparation, work: (store: OfflineStore) => Promise<T>) {
    const run = queue.current.then(async () => {
      if (!scope.isCurrent()) return;
      const store = await openOfflineStore(user.id);
      try {
        if (!scope.isCurrent()) return;
        return await work(store);
      } finally {
        store.close();
      }
    });
    queue.current = run.catch(() => {});
    return run;
  }
  function verify(scope: OfflinePreparation) {
    return () => {
      if (!scope.isCurrent()) throw new Error('This offline preparation is no longer current.');
    };
  }
  function set(download: OfflineDownload, scope: OfflinePreparation) {
    if (scope.isCurrent())
      setDownloads((previous) =>
        scope.isCurrent() ? new Map(previous).set(download.itemId, download) : previous,
      );
  }
  function unset(itemId: string, scope: OfflinePreparation) {
    if (!scope.isCurrent()) return;
    setDownloads((previous) => {
      if (!scope.isMounted()) return previous;
      const next = new Map(previous);
      next.delete(itemId);
      return next;
    });
  }

  useLayoutEffect(() => {
    const lifetime = { accountId: user.id };
    mounted.current = lifetime;
    setShownAccount(user.id);
    setDownloads(
      new Map(
        local?.user.id === user.id
          ? local.downloads.map((download) => [download.itemId, download])
          : [],
      ),
    );
    setBusy(null);
    setMessage(null);
    const stopWatching = watchOfflineAccount();
    const close = () => {
      if (mounted.current === lifetime) mounted.current = null;
      stopWatching();
    };
    if (local || preparedAccount() !== user.id) return close;
    const scope = preparation();
    if (!scope) return close;
    void serially(scope, async (store) => {
      const known = await store.downloads();
      if (!scope.isCurrent()) return;
      setDownloads(new Map(known.map((download) => [download.itemId, download])));
      // Keep the shell current after an update or eviction, then refresh each
      // copy. A failed refresh keeps the last complete copy. A document this
      // account can no longer open is removed: SPN-039's copies hold no edits.
      await prepareShell();
      for (const download of known) {
        if (!scope.isCurrent()) return;
        try {
          set(
            await downloadForOffline(store, download.itemId, download.spaceId, verify(scope)),
            scope,
          );
        } catch (error) {
          if (scope.isCurrent() && error instanceof DownloadError && error.status === 404) {
            await store.remove(download.itemId);
            unset(download.itemId, scope);
            await scope.clearIfEmpty(store);
          }
        }
      }
    }).catch(() => {
      // Refreshing is best effort; downloads stay as they were.
    });
    return close;
  }, [user.id, local]);

  async function saveCatalog(value: OfflineCatalog) {
    const scope = preparation();
    if (!scope || local || preparedAccount() !== user.id) return;
    await serially(scope, (store) => store.saveCatalog({ id: user.id, name: user.name }, value));
  }

  async function toggle(item: Pick<WorkspaceItem, 'id' | 'name' | 'kind'>, spaceId?: string) {
    const scope = preparation(true);
    if (!scope?.isCurrent() || local || busy) return;
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
      await serially(scope, async (store) => {
        if (downloaded) {
          await store.remove(item.id);
          unset(item.id, scope);
          // With nothing left to open, the device is no longer prepared.
          await scope.clearIfEmpty(store);
          return;
        }
        const download = await downloadForOffline(store, item.id, spaceId, verify(scope));
        if (!scope.isCurrent()) return;
        // Keep the newest catalog; a refresh that failed meanwhile falls back
        // to the one there at the click, so a prepared device always has one.
        let current = latestCatalog.current() ?? atClick ?? (await store.catalog());
        if (!scope.isCurrent()) return;
        const root = latestRoot.current?.id === spaceId ? latestRoot.current : rootAtClick;
        if (spaceId !== undefined && root?.id === spaceId)
          current = spaceOfflineCatalog(root, current ?? undefined);
        try {
          if (!current) throw new Error('This file list is incomplete. Try again.');
          if (!(await scope.finish(store, { id: user.id, name: user.name }, current))) return;
        } catch (error) {
          // A copy with no file list can't open offline; don't keep it.
          if (scope.isCurrent()) await store.remove(item.id).catch(() => {});
          throw error;
        }
        set(download, scope);
      });
      if (scope.isCurrent())
        setMessage({
          text: downloaded
            ? `${item.name} was removed from this device.`
            : `${item.name} is available offline on this device.`,
          failed: false,
        });
    } catch (error) {
      if (scope.isCurrent())
        setMessage({
          text:
            error instanceof Error && error.message
              ? error.message
              : 'Could not change offline availability. Try again.',
          failed: true,
        });
    } finally {
      if (scope.isMounted()) setBusy(null);
    }
  }

  return {
    downloads: shownAccount === user.id ? downloads : new Map<string, OfflineDownload>(),
    busy: shownAccount === user.id ? busy : null,
    message: shownAccount === user.id ? message : null,
    clearMessage: () => setMessage(null),
    toggle,
    saveCatalog,
  };
}
