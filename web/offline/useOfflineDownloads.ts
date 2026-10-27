import { useLayoutEffect, useRef, useState } from 'react';
import type { SpaceFile, WorkspaceItem } from '../../src/shared/workspace.ts';
import { offlineErrorMessage } from '../../src/shared/offlineError.ts';
import { DownloadError, downloadForOffline } from './download.ts';
import type { LocalStart } from './localStart.ts';
import {
  openOfflineStore,
  openExistingOfflineStore,
  offlinePreparation,
  preparedAccount,
  spaceOfflineCatalog,
  watchOfflineAccount,
  watchOfflineChanges,
  withOfflineCatalogLock,
  withOfflineItemWriter,
} from './offlineStore.ts';
import type {
  OfflineCatalog,
  OfflineDownload,
  OfflinePreparation,
  OfflineStore,
  OfflineUser,
} from './offlineStore.ts';
import { prepareShell } from './shell.ts';
import { isRuntimeCompatible } from './runtime.ts';
import { readDeviceInventory, removeDeviceCopy, requestPersistence } from './deviceStorage.ts';
import { createOfflineDocument, relocateOfflineCreation } from './creation.ts';

export type OfflineMessage = {
  text: string;
  failed: boolean;
  recoveryItemId?: string;
  detail?: string;
};

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
  const summaryRead = useRef(0);
  const noticeSequence = useRef(0);
  const pendingNotices = useRef(new Map<string, { sequence: number; pending: boolean }>());
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
          text: offlineErrorMessage(error, 'Could not prepare offline storage.'),
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
  function serially<T>(
    scope: OfflinePreparation,
    work: (store: OfflineStore) => Promise<T>,
    create = false,
  ) {
    const run = queue.current.then(async () => {
      if (!scope.isCurrent()) return;
      const store = create
        ? await openOfflineStore(user.id)
        : await openExistingOfflineStore(user.id);
      if (!store) return;
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
        scope.isCurrent()
          ? new Map(previous).set(download.itemId, { ...download, available: true })
          : previous,
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

  async function refreshSummaries() {
    const scope = preparation();
    if (!scope) return;
    const reading = ++summaryRead.current;
    const started = noticeSequence.current;
    const inventory = await readDeviceInventory(user.id, verify(scope));
    if (scope.isCurrent() && reading === summaryRead.current)
      setDownloads(
        new Map(
          inventory.items.map((download) => {
            const notice = pendingNotices.current.get(download.itemId);
            return [
              download.itemId,
              notice && notice.sequence > started
                ? { ...download, pending: download.uncertain || notice.pending }
                : download,
            ];
          }),
        ),
      );
  }

  useLayoutEffect(() => {
    const lifetime = { accountId: user.id };
    mounted.current = lifetime;
    summaryRead.current++;
    pendingNotices.current.clear();
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
    const stopChanges = watchOfflineChanges(user.id, (change) => {
      const scope = preparation();
      if (!scope?.isCurrent()) return;
      if (typeof change.pending === 'boolean') {
        pendingNotices.current.set(change.itemId, {
          sequence: ++noticeSequence.current,
          pending: change.pending,
        });
        // A checkpoint transition already committed. Keep verified availability
        // and update only this known row, without rehashing images per keystroke.
        setDownloads((previous) => {
          const item = previous.get(change.itemId);
          return item && scope.isCurrent()
            ? new Map(previous).set(change.itemId, {
                ...item,
                pending: item.uncertain || change.pending,
              })
            : previous;
        });
      } else {
        pendingNotices.current.delete(change.itemId);
        void refreshSummaries().catch(() => {});
      }
    });
    const foreground = () => {
      if (document.visibilityState !== 'hidden') void refreshSummaries().catch(() => {});
    };
    const accountChanged = () => {
      if (!preparation()?.isCurrent()) {
        setDownloads(new Map());
        setMessage(null);
        setBusy(null);
      }
    };
    window.addEventListener('focus', foreground);
    window.addEventListener('pageshow', foreground);
    window.addEventListener('storage', accountChanged);
    window.addEventListener('spinel-offline-account-changed', accountChanged);
    document.addEventListener('visibilitychange', foreground);
    void refreshSummaries().catch(() => {});
    const close = () => {
      if (mounted.current === lifetime) mounted.current = null;
      stopChanges();
      window.removeEventListener('focus', foreground);
      window.removeEventListener('pageshow', foreground);
      window.removeEventListener('storage', accountChanged);
      window.removeEventListener('spinel-offline-account-changed', accountChanged);
      document.removeEventListener('visibilitychange', foreground);
      stopWatching();
    };
    if (local || preparedAccount() !== user.id) return close;
    const scope = preparation();
    if (!scope) return close;
    void serially(scope, async (store) => {
      const known = await store.downloads();
      if (!scope.isCurrent()) return;
      // Keep the shell current after an update or eviction, then refresh each
      // clean copy. Pending copies are retained even when live access is gone,
      // so My files can offer their independent recovery entry.
      await withOfflineCatalogLock(user.id, async () => {
        verify(scope)();
        const requirement = await store.runtimeRequirement();
        verify(scope)();
        if (requirement.kind !== 'retained' || !isRuntimeCompatible(requirement.compatibility))
          throw new Error('This device data needs a compatible version of Spinel.');
        await prepareShell(user.id, verify(scope), requirement);
      });
      for (const download of known) {
        if (!scope.isCurrent()) return;
        if (download.pending) continue;
        try {
          set(
            await withOfflineItemWriter(user.id, download.itemId, () =>
              downloadForOffline(store, download.itemId, download.spaceId, verify(scope)),
            ),
            scope,
          );
        } catch (error) {
          if (
            scope.isCurrent() &&
            error instanceof DownloadError &&
            [403, 404].includes(error.status ?? 0)
          ) {
            const removed = await removeDeviceCopy(user.id, download.itemId, verify(scope));
            if (removed.status === 'removed') unset(download.itemId, scope);
          }
        }
      }
      await refreshSummaries();
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

  async function create(name: string, kind: 'sheet' | 'doc', parentId: string | null) {
    const scope = preparation();
    if (!scope || preparedAccount() !== user.id)
      throw new Error('Prepare this account online before creating documents offline.');
    const item = await serially(scope, (store) =>
      createOfflineDocument(store, name, kind, parentId, verify(scope)),
    );
    verify(scope)();
    if (!item) throw new Error('Offline storage is not available. Connect to prepare this device.');
    await refreshSummaries();
    verify(scope)();
    return item;
  }

  async function relocateCreation(itemId: string, parentId: string | null) {
    const scope = preparation();
    if (!scope) throw new Error('This account is no longer current.');
    const item = await serially(scope, (store) =>
      withOfflineItemWriter(user.id, itemId, () =>
        relocateOfflineCreation(store, itemId, parentId, verify(scope)),
      ),
    );
    verify(scope)();
    if (!item) throw new Error('This saved document is no longer available.');
    await refreshSummaries();
    verify(scope)();
    return item;
  }

  async function toggle(item: Pick<WorkspaceItem, 'id' | 'name' | 'kind'>, spaceId?: string) {
    const scope = preparation(true);
    if (!scope?.isCurrent() || local || busy) return;
    if (!['doc', 'sheet'].includes(item.kind)) {
      setMessage({ text: 'Only Sheets and Docs can be downloaded.', failed: true });
      return;
    }
    const downloaded = downloads.has(item.id) && downloads.get(item.id)!.spaceId === spaceId;
    const saved = downloads.get(item.id);
    if (downloaded && (saved?.pending || saved?.uncertain)) {
      setMessage({
        text: 'Changes are saved on this device. Recover them or choose how to remove them in This device.',
        failed: false,
        recoveryItemId: item.id,
      });
      return;
    }
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
    let outcome: 'prepared' | 'removed' | 'needs-recovery' | undefined;
    let detail: string | undefined;
    try {
      if (!downloaded) {
        const protection = await requestPersistence();
        verify(scope)();
        detail =
          protection === 'granted'
            ? 'Your browser granted storage protection. Device copies are not a backup.'
            : protection === 'denied'
              ? 'Your browser did not grant storage protection. Device copies can still be removed by the browser.'
              : protection === 'unsupported'
                ? 'This browser does not offer storage protection. Device copies are not a backup.'
                : 'Storage protection could not be requested. Device copies are not a backup.';
      }
      await serially(
        scope,
        async (store) => {
          if (downloaded) {
            const result = await removeDeviceCopy(user.id, item.id, verify(scope));
            outcome = result.status;
            if (result.status === 'removed') unset(item.id, scope);
            return;
          }
          const download = await withOfflineItemWriter(user.id, item.id, () =>
            downloadForOffline(store, item.id, spaceId, verify(scope)),
          );
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
          outcome = 'prepared';
        },
        !downloaded,
      );
      if (scope.isCurrent()) await refreshSummaries();
      if (scope.isCurrent())
        setMessage({
          text:
            outcome === 'needs-recovery'
              ? 'Changes are saved on this device. Recover them or choose how to remove them in This device.'
              : downloaded
                ? `${item.name} was removed from this device.`
                : `${item.name} is available offline on this device.`,
          failed: false,
          ...(outcome === 'needs-recovery' ? { recoveryItemId: item.id } : {}),
          ...(outcome === 'prepared' ? { detail } : {}),
        });
    } catch (error) {
      if (scope.isCurrent())
        await serially(scope, (store) => scope.clearIfEmpty(store)).catch(() => {});
      if (scope.isCurrent())
        setMessage({
          text: offlineErrorMessage(error, 'Could not change offline availability. Try again.'),
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
    create,
    relocateCreation,
    saveCatalog,
    refreshSummaries,
  };
}
