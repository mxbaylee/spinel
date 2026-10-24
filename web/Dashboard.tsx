import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FILE_KINDS, fileKindLabel, canAdminister, accessLabel } from '../src/shared/workspace.ts';
import type { FileKind, FileItem, WorkspaceItem, SpaceFile } from '../src/shared/workspace.ts';

import { Sharing } from './Sharing.tsx';
import './fileDialog.css';
import { SearchPanel } from './SearchPanel.tsx';
import { emptySearch, hasSearch } from '../src/shared/search.ts';
import type { SearchQuery } from '../src/shared/search.ts';
import { parseSearchInput } from '../src/shared/searchInput.ts';
import { DashboardFiles } from './DashboardFiles.tsx';
import type { DashboardFileLayout } from './DashboardFiles.tsx';
import { ActionMenu, Modal, SegmentedChoice } from '../src/ui/redesign/Controls.tsx';
import type { Action as MenuAction } from '../src/ui/redesign/Controls.tsx';
import {
  consumeDashboardReturn,
  dashboardSession,
  readDashboardReturn,
  rememberDashboardRetrieval,
  restoreDashboardRetrieval,
  retrievalHref,
} from './dashboardNavigation.ts';
import type { DashboardRetrieval } from './dashboardNavigation.ts';
import './Dashboard.css';
import { Trash } from './Trash.tsx';
import { DocumentTags, TagLabels } from './DocumentTags.tsx';
import { itemsRequest } from './itemsApi.ts';
import { ImportFile } from './ImportFile.tsx';
import { SharedBadge, useSharedItems } from './SharedItems.tsx';
import type { NavigationGuard } from './navigation.ts';
import { rememberFileView } from './fileNavigation.ts';
import { spaceHref } from './spaceNavigation.ts';
import { SpaceRootActions } from './SpaceRootActions.tsx';
import type { SpaceRootActionMode } from './SpaceRootActions.tsx';
import { OfflineBadge } from './OfflineStatus.tsx';
import type { ConnectionState } from './connectionState.ts';
import type { CatalogConnectionDetails } from './ConnectionStatus.tsx';
import type { LocalStart } from './offline/localStart.ts';
import type { OfflineCatalog, OfflineUser } from './offline/offlineStore.ts';
import { useOfflineDownloads } from './offline/useOfflineDownloads.ts';
import { spaceCopies } from './offline/spaceCopies.ts';
const SheetEditor = lazy(() =>
  import('./SheetEditor.tsx').then((module) => ({ default: module.SheetEditor })),
);

type Action = { mode: 'new' | 'rename' | 'move' | 'file'; item?: FileItem };
const TRASH_VIEW = 'trash';
const SHARED_VIEW = 'shared';
const selectedId = () => {
  const query = new URLSearchParams(location.search);
  return query.has('trash') ? TRASH_VIEW : query.has('shared') ? SHARED_VIEW : query.get('item');
};
const viewUrl = (id: string | null) =>
  id === TRASH_VIEW
    ? '/?trash=1'
    : id === SHARED_VIEW
      ? '/?shared=1'
      : id
        ? `/?item=${encodeURIComponent(id)}`
        : '/';

const DocEditor = lazy(() => import('./DocEditor.tsx').then((m) => ({ default: m.DocEditor })));
const OfflineViewer = lazy(() =>
  import('./OfflineViewer.tsx').then((m) => ({ default: m.OfflineViewer })),
);
const offlineKind = (item: FileItem) => item.kind === 'sheet' || item.kind === 'doc';

/**
 * The file list and the open item. With `local` set, Spinel started without a
 * network: everything comes from the last-synced catalog on this device, only
 * downloaded documents open (read-only), and nothing reaches the server.
 */
export function Dashboard({
  navigation,
  user,
  local,
  onConnectionState,
  onCatalogStatus,
  onOpen,
  onPlaces,
}: {
  navigation: NavigationGuard;
  user: OfflineUser;
  local?: LocalStart | null;
  onConnectionState?: (state: ConnectionState | null) => void;
  onCatalogStatus?: (details: CatalogConnectionDetails | null) => void;
  onOpen?: (item: FileItem) => void;
  onPlaces?: (places: { shared: boolean; open: (shared: boolean) => void } | null) => void;
}) {
  const [initialNavigation] = useState(() => {
    dashboardSession(user.id);
    const url = new URL(location.href);
    const returning = url.searchParams.get('files-return') === '1';
    url.searchParams.delete('files-return');
    const target = `${url.pathname}${url.search}`;
    const envelope = returning && !local ? readDashboardReturn(user.id, target) : null;
    const value = returning
      ? (envelope?.value ?? null)
      : restoreDashboardRetrieval(user.id, history.state?.spinelDashboard, target);
    return { value: local ? null : value, envelope, returning, target };
  });
  const initial = initialNavigation.value;
  useEffect(() => {
    if (!initialNavigation.returning) return;
    // Commit the validated hint to history before consuming it. StrictMode and
    // later remounts must not lose the search while removing the return marker.
    history.replaceState(
      { ...history.state, spinelDashboard: initialNavigation.envelope },
      '',
      initialNavigation.target,
    );
    consumeDashboardReturn(user.id, initialNavigation.target);
  }, []);
  const dropTarget = useRef<HTMLElement>(null);
  const [saveStatusTarget, setSaveStatusTarget] = useState<HTMLSpanElement | null>(null);
  const [query, setQuery] = useState<SearchQuery>(initial?.query ?? { ...emptySearch });
  const [draft, setDraft] = useState(initial?.draft ?? '');
  const [allFiles, setAllFiles] = useState(initial?.allFiles ?? false);
  const [layout, setLayout] = useState<DashboardFileLayout>(() => {
    if (initial) return initial.layout;
    try {
      return localStorage.getItem('spinel-files-layout') === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });
  const searchActive = hasSearch(query) || !parseSearchInput(draft).ok;
  const shared = useSharedItems(local?.catalog.shared);
  const [importOpen, setImportOpen] = useState(false);
  const returnContext = useRef<DashboardRetrieval | null>(null);
  const pendingScroll = useRef<number | null>(initial?.scroll ?? null);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [spacesEnabled, setSpacesEnabled] = useState(false);
  const [viewed, setViewed] = useState<FileItem[]>([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewMissing, setViewMissing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sharing, setSharing] = useState<FileItem | null>(null);
  const [spaceAction, setSpaceAction] = useState<{
    item: SpaceFile;
    mode: SpaceRootActionMode;
  } | null>(null);
  const [tagging, setTagging] = useState<FileItem | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(selectedId);
  const sharedOpen = currentId === SHARED_VIEW;
  useEffect(
    () => rememberFileView(user.id, currentId === SHARED_VIEW ? null : currentId),
    [user.id, currentId],
  );
  const currentRef = useRef(currentId);
  currentRef.current = currentId;
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FileKind>('folder');
  const [destination, setDestination] = useState('');
  const [moveFolders, setMoveFolders] = useState<WorkspaceItem[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  useEffect(() => {
    if (action?.mode !== 'move' || action.item?.access !== 'admin') {
      setLoadingDestinations(false);
      setMoveFolders([]);
      return;
    }
    let current = true;
    setLoadingDestinations(true);
    setMoveFolders([]);
    void itemsRequest<{ items: WorkspaceItem[] }>(`/${action.item.id}/destinations`)
      .then(({ items }) => {
        if (current) setMoveFolders(items);
      })
      .catch((failure) => {
        if (current) setError(failure.message);
      })
      .finally(() => {
        if (current) setLoadingDestinations(false);
      });
    return () => {
      current = false;
    };
  }, [action]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncedAt, setSyncedAt] = useState(local?.catalog.syncedAt ?? 0);
  useEffect(() => {
    onCatalogStatus?.({ syncedAt, local: Boolean(local), stale: Boolean(error || shared.error) });
  }, [syncedAt, local, error, shared.error, onCatalogStatus]);
  useEffect(() => () => onCatalogStatus?.(null), [onCatalogStatus]);
  // The last-loaded view for each opened folder or item, kept for offline launch.
  const views = useRef<Record<string, FileItem[]>>({ ...local?.catalog.views });
  const catalog = (): OfflineCatalog | null =>
    loaded && shared.loaded
      ? { syncedAt, items, shared: shared.items, views: views.current }
      : null;
  const offline = useOfflineDownloads(user, local, catalog);
  useEffect(() => {
    if (local) {
      setItems(local.catalog.items);
      setLoaded(true);
    } else
      void itemsRequest<{ items: FileItem[]; spacesEnabled?: boolean }>()
        .then((result) => {
          setItems(result.items);
          setSpacesEnabled(result.spacesEnabled === true);
          setSyncedAt(Date.now());
          setLoaded(true);
        })
        .catch((failure) => setError(failure.message));
    const back = () => {
      if (!navigation.allow()) {
        history.pushState(null, '', viewUrl(currentRef.current));
        return;
      }
      const restored = local
        ? null
        : restoreDashboardRetrieval(
            user.id,
            history.state?.spinelDashboard,
            `${location.pathname}${location.search}`,
          );
      setQuery(restored?.query ?? { ...emptySearch });
      setDraft(restored?.draft ?? '');
      setAllFiles(restored?.allFiles ?? false);
      if (restored) setLayout(restored.layout);
      pendingScroll.current = restored?.scroll ?? 0;
      setCurrentId(selectedId());
      setTagging(null);
      setAction(null);
      setError('');
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    setSharing(null);
    setViewed([]);
    setViewMissing(false);
    setViewId(null);
    if (!currentId || currentId === TRASH_VIEW || currentId === SHARED_VIEW || local) {
      if (local && currentId) setViewed(views.current[currentId] ?? []);
      setViewId(currentId);
      setViewLoading(false);
      return;
    }
    let disposed = false;
    setViewLoading(true);
    void itemsRequest<{
      item: FileItem;
      children: FileItem[];
      ancestors: FileItem[];
    }>(`/${currentId}`)
      .then((result) => {
        if (disposed) return;
        const view = [...result.ancestors, result.item, ...result.children];
        views.current = { ...views.current, [currentId]: view };
        setViewed(view);
      })
      .catch((failure) => {
        if (!disposed) {
          setError(failure.message);
          setViewMissing(true);
        }
      })
      .finally(() => {
        if (!disposed) {
          setViewId(currentId);
          setViewLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [currentId, refresh]);
  useEffect(() => {
    const current = catalog();
    if (current && !local) void offline.saveCatalog(current).catch(() => {});
  }, [items, shared.items, viewed, offline.downloads]);
  // Offline, any item from a saved view can be opened by its stable link.
  const known = local ? Object.values(views.current).flat() : [];
  const byId = new Map(
    [...known, ...items, ...shared.items, ...viewed].map((item) => [item.id, item]),
  );
  const current = currentId && !viewMissing ? byId.get(currentId) : undefined;
  const browsing = !currentId || sharedOpen || current?.kind === 'folder';
  useEffect(() => {
    onPlaces?.(
      browsing
        ? { shared: sharedOpen, open: (shared) => navigate(shared ? SHARED_VIEW : null) }
        : null,
    );
    return () => onPlaces?.(null);
  }, [onPlaces, browsing, sharedOpen, currentId, query, draft, layout, allFiles]);
  useEffect(() => {
    try {
      localStorage.setItem('spinel-files-layout', layout);
    } catch {
      /* Optional preference. */
    }
  }, [layout]);
  useEffect(() => {
    if (!browsing || !loaded || viewLoading || pendingScroll.current === null || searchActive)
      return;
    const scroll = pendingScroll.current;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, scroll);
      pendingScroll.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [browsing, loaded, viewLoading, searchActive, currentId]);
  const liveEditor =
    !local && current && (current.kind === 'sheet' || current.kind === 'doc') ? current.id : null;
  useEffect(() => {
    onConnectionState?.(liveEditor ? 'reconnecting' : null);
  }, [liveEditor, onConnectionState]);
  const title =
    current && current.kind !== 'folder' && viewId === currentId
      ? `${current.name} — Spinel`
      : 'Spinel';
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = 'Spinel';
    };
  }, [title]);
  const personalFolder = !currentId || (current?.kind === 'folder' && current.access === 'owner');
  const visibleItems = personalFolder
    ? [
        ...(currentId ? viewed : items).filter(
          (item) => item.access === 'owner' && item.parentId === currentId,
        ),
        ...shared.items.filter((item) => item.placementParentId === currentId),
      ]
    : viewed.filter((item) => item.parentId === currentId);
  function ancestors(item?: FileItem) {
    const path: FileItem[] = [];
    const seen = new Set<string>();
    while (item && !seen.has(item.id)) {
      seen.add(item.id);
      path.unshift(item);
      item = item.parentId ? byId.get(item.parentId) : undefined;
    }
    return path;
  }
  // Sort siblings, then traverse by parent ID so similar or duplicate names
  // cannot interleave unrelated subtrees.
  const children = new Map<string | null, FileItem[]>();
  for (const item of items.filter((item) => item.kind === 'folder' && item.access === 'owner')) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const folders: { item: FileItem; path: FileItem[] }[] = [];
  const stack = (children.get(null) ?? []).map((item) => ({ item, path: [item] })).reverse();
  while (stack.length) {
    const entry = stack.pop()!;
    folders.push(entry);
    for (const child of [...(children.get(entry.item.id) ?? [])].reverse())
      stack.push({ item: child, path: [...entry.path, child] });
  }
  function navigate(id: string | null, check = true) {
    if (check && id !== currentId && !navigation.allow()) return;
    if (check) returnContext.current = null;
    setQuery({ ...emptySearch });
    setDraft('');
    setAllFiles(false);
    pendingScroll.current = 0;
    history.pushState(null, '', viewUrl(id));
    setCurrentId(id);
    setTagging(null);
    setAction(null);
    setError('');
  }
  function openFile(item: FileItem) {
    if (!navigation.allow()) return;
    if (browsing) {
      const value: DashboardRetrieval = {
        folderId: sharedOpen ? null : currentId,
        shared: sharedOpen,
        query,
        draft,
        allFiles,
        layout,
        scroll: window.scrollY,
      };
      returnContext.current = value;
      const saved = rememberDashboardRetrieval(user.id, value);
      history.replaceState({ ...history.state, spinelDashboard: saved }, '', viewUrl(currentId));
    }
    if (item.kind !== 'space') return navigate(item.id, false);
    if (local && !spaceCopies(offline.downloads.values(), item.id).length) {
      setError(`${item.name} needs a connection. Connect to open this Space.`);
      return;
    }
    if (!navigation.allow()) return;
    // A Space has its own navigation. Keep the last My files view intact.
    navigation.dirty(false);
    setError('');
    if (onOpen) onOpen(item);
    else location.assign(spaceHref(item.id));
  }
  function edit(mode: Action['mode'], item?: FileItem, newKind: FileKind = 'folder') {
    setAction({ mode, item });
    setName(item?.name ?? '');
    setKind(newKind);
    setDestination(
      mode === 'file'
        ? (shared.items.find((entry) => entry.id === item?.id)?.placementParentId ?? '')
        : (item?.parentId ?? ''),
    );
    setError('');
  }
  async function submit() {
    if (!action) return;
    setBusy(true);
    setError('');
    try {
      if (action.mode === 'file') {
        if (await shared.place(action.item!.id, destination || null)) setAction(null);
        return;
      }
      const { item } = await itemsRequest<{ item: FileItem }>(
        action.mode === 'new' ? '' : `/${action.item!.id}`,
        action.mode === 'new' ? 'POST' : 'PATCH',
        action.mode === 'new'
          ? { name, kind, parentId: sharedOpen ? null : currentId }
          : action.mode === 'rename'
            ? { name }
            : { parentId: destination || null },
      );
      setItems((previous) => [
        ...previous.filter((entry) => entry.id !== item.id),
        ...(item.access === 'owner' ? [item] : []),
      ]);
      setViewed((previous) => [...previous.filter((entry) => entry.id !== item.id), item]);
      setAction(null);
      if (browsing) setRefresh((value) => value + 1);
      if (item.access === 'admin') await shared.refresh();
      if (action.mode === 'new' && item.kind !== 'folder') openFile(item);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function reloadItems() {
    const result = await itemsRequest<{ items: FileItem[]; spacesEnabled?: boolean }>();
    setItems(result.items);
    setSpacesEnabled(result.spacesEnabled === true);
  }
  async function trashItem(item: FileItem) {
    if (!navigation.allow()) return;
    setBusy(true);
    setError('');
    try {
      await itemsRequest(`/${item.id}/trash`, 'POST', {});
      setSharing(null);
      if (currentId === item.id) navigate(item.parentId, false);
      setRefresh((value) => value + 1);
      await reloadItems();
      if (item.access === 'admin') await shared.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not move to trash. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function offlineState(item: FileItem) {
    if (item.kind === 'space' && spaceCopies(offline.downloads.values(), item.id).length)
      return 'pages-available';
    if (offline.downloads.has(item.id)) return 'available';
    return local && (offlineKind(item) || item.kind === 'space') ? 'needs-connection' : null;
  }
  function offlineToggle(item: FileItem) {
    if (item.kind !== 'sheet' && item.kind !== 'doc') return null;
    const downloaded = offline.downloads.has(item.id);
    return (
      <button
        disabled={offline.busy !== null}
        aria-label={
          downloaded
            ? `Remove ${item.name} from this device`
            : `Make ${item.name} available offline on this device`
        }
        onClick={() => void offline.toggle(item)}
      >
        {offline.busy === item.id
          ? downloaded
            ? 'Removing…'
            : 'Downloading…'
          : downloaded
            ? 'Remove from device'
            : 'Available offline on this device'}
      </button>
    );
  }
  function personalFiling(item: FileItem) {
    if (item.access === 'owner') return null;
    return (
      <>
        <button
          disabled={busy || shared.busy}
          aria-label={`File ${item.name}`}
          onClick={() => edit('file', item)}
        >
          File into folder
        </button>
        {shared.items.some(
          (entry) => entry.id === item.id && entry.placementParentId !== undefined,
        ) && (
          <button
            disabled={shared.busy}
            aria-label={`Remove ${item.name} from my folder`}
            onClick={() => void shared.place(item.id, null, true)}
          >
            Remove from my folder
          </button>
        )}
      </>
    );
  }
  function rowActions(item: FileItem): MenuAction[] {
    if (local) return [];
    const result: MenuAction[] = [];
    if (item.kind !== 'folder')
      result.push({ label: 'Tags…', onClick: () => setTagging(item), disabled: busy });
    if (item.access !== 'owner') {
      result.push({
        label: 'File into folder…',
        onClick: () => edit('file', item),
        disabled: busy || shared.busy,
      });
      if (
        shared.items.some((entry) => entry.id === item.id && entry.placementParentId !== undefined)
      )
        result.push({
          label: 'Remove from my folder',
          onClick: () => {
            void shared.place(item.id, null, true).then(() => setRefresh((value) => value + 1));
          },
          disabled: shared.busy,
        });
    }
    if (canAdminister(item.access)) {
      for (const mode of ['share', 'rename', 'move', 'trash'] as const) {
        result.push({
          label: { share: 'Share…', rename: 'Rename…', move: 'Move…', trash: 'Move to Trash' }[
            mode
          ],
          destructive: mode === 'trash',
          disabled: busy,
          onClick: () => {
            if (item.kind === 'space') setSpaceAction({ item, mode });
            else if (mode === 'share') setSharing(item);
            else if (mode === 'trash') void trashItem(item);
            else edit(mode, item);
          },
        });
      }
    }
    if (item.kind === 'sheet' || item.kind === 'doc')
      result.push({
        label:
          offline.busy === item.id
            ? 'Updating offline copy…'
            : offline.downloads.has(item.id)
              ? 'Remove from device'
              : 'Available offline on this device',
        disabled: offline.busy !== null,
        onClick: () => {
          void offline.toggle(item);
        },
      });
    if (item.kind === 'folder')
      result.push({
        label: 'Refresh folder',
        onClick: () => {
          setRefresh((value) => value + 1);
          void reloadItems().catch((failure) => setError(failure.message));
          void shared.refresh();
        },
        disabled: busy,
      });
    return result;
  }
  function returnToFiles() {
    if (!navigation.allow()) return;
    const value = returnContext.current;
    if (!value) return navigate(null, false);
    history.pushState(
      { spinelDashboard: rememberDashboardRetrieval(user.id, value) },
      '',
      retrievalHref(value),
    );
    setCurrentId(value.shared ? SHARED_VIEW : value.folderId);
    setQuery(value.query);
    setDraft(value.draft);
    setAllFiles(value.allFiles);
    setLayout(value.layout);
    pendingScroll.current = value.scroll;
    setAction(null);
    setTagging(null);
    setSharing(null);
    setError('');
  }
  function restoreScroll() {
    if (pendingScroll.current === null) return;
    const scroll = pendingScroll.current;
    requestAnimationFrame(() => {
      window.scrollTo(0, scroll);
      pendingScroll.current = null;
    });
  }
  function actions(item: FileItem) {
    // Local mode is read-only: nothing here may reach the server.
    if (local)
      return item.access === 'owner' ? null : (
        <span className="item-actions">
          <span>{accessLabel(item.access)}</span>
        </span>
      );
    const tagButton = item.kind !== 'folder' && (
      <button disabled={busy} onClick={() => setTagging(item)} aria-label={`Tags ${item.name}`}>
        Tags
      </button>
    );
    if (!canAdminister(item.access))
      return (
        <span className="item-actions">
          <span>{accessLabel(item.access)}</span>
          {tagButton}
          {offlineToggle(item)}
          {personalFiling(item)}
        </span>
      );
    if (item.kind === 'space')
      return (
        <span className="item-actions">
          {item.access === 'admin' && <span>File admin</span>}
          {personalFiling(item)}
          {tagButton}
          <SpaceRootActions
            item={item}
            folders={items.filter(
              (entry): entry is WorkspaceItem =>
                entry.kind === 'folder' && entry.access === 'owner',
            )}
            beforeChange={() => navigation.allow()}
            onChanged={(updated) => {
              setItems((previous) =>
                previous.map((entry) => (entry.id === updated.id ? updated : entry)),
              );
              setViewed((previous) =>
                previous.map((entry) => (entry.id === updated.id ? updated : entry)),
              );
              setRefresh((value) => value + 1);
              if (item.access === 'admin') void shared.refresh();
            }}
            onTrashed={() => {
              setViewed((previous) => previous.filter((entry) => entry.id !== item.id));
              setRefresh((value) => value + 1);
              void reloadItems().catch((failure) => setError(failure.message));
              if (item.access === 'admin') void shared.refresh();
            }}
          />
        </span>
      );
    return (
      <span className="item-actions">
        {item.access === 'admin' && <span>File admin</span>}
        {personalFiling(item)}
        {tagButton}
        <button disabled={busy} onClick={() => setSharing(item)} aria-label={`Share ${item.name}`}>
          Share
        </button>
        <button
          disabled={busy}
          onClick={() => edit('rename', item)}
          aria-label={`Rename ${item.name}`}
        >
          Rename
        </button>
        <button disabled={busy} onClick={() => edit('move', item)} aria-label={`Move ${item.name}`}>
          Move
        </button>
        {offlineToggle(item)}
        <button
          disabled={busy}
          onClick={() => void trashItem(item)}
          aria-label={`Move ${item.name} to trash`}
        >
          Trash
        </button>
      </span>
    );
  }
  const sharedFailure = shared.error && (
    <p role="alert">
      {shared.error} <button onClick={() => void shared.refresh()}>Refresh shared items</button>
    </p>
  );
  const canCreate = browsing && !sharedOpen && !local && (!current || current.access === 'owner');
  // Shared is already ordered by latest grant; alphabetizing would hide recent shares.
  const listedItems = sharedOpen
    ? shared.items
    : [...visibleItems].sort(
        (a, b) =>
          Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
  return (
    <section ref={dropTarget} className="dashboard-content" aria-label="Your files">
      {!onPlaces && (
        <nav className="dashboard-places" aria-label="File places">
          <button onClick={() => navigate(null)} aria-current={!sharedOpen ? 'page' : undefined}>
            My files
          </button>
          <button
            onClick={() => navigate(SHARED_VIEW)}
            aria-current={sharedOpen ? 'page' : undefined}
          >
            Shared with me
          </button>
        </nav>
      )}
      {browsing ? (
        <>
          {current && (
            <nav aria-label="Breadcrumb" className="dashboard-breadcrumbs">
              <button onClick={() => navigate(null)}>My files</button>
              {ancestors(current)
                .slice(0, -1)
                .map((item) => (
                  <span key={item.id}>
                    {' '}
                    / <button onClick={() => openFile(item)}>{item.name}</button>
                  </span>
                ))}
            </nav>
          )}
          <header className="dashboard-heading">
            <h1>{sharedOpen ? 'Shared with me' : (current?.name ?? 'My files')}</h1>
            <div className="dashboard-heading-actions">
              {current && !local && (
                <ActionMenu
                  label={`More actions for ${current.name}`}
                  actions={rowActions(current)}
                />
              )}
              {canCreate && (
                <ActionMenu
                  label="New"
                  primary
                  actions={[
                    ...FILE_KINDS.filter((kind) => kind !== 'space' || spacesEnabled).map(
                      (kind) => ({
                        label: fileKindLabel[kind],
                        onClick: () => edit('new', undefined, kind),
                        disabled: busy,
                      }),
                    ),
                    { label: 'Import file…', onClick: () => setImportOpen(true), disabled: busy },
                  ]}
                >
                  New
                </ActionMenu>
              )}
            </div>
          </header>

          {local && (
            <div className="dashboard-view-choice">
              <SegmentedChoice
                label="File view"
                value={layout}
                options={[
                  {
                    value: 'list',
                    label: 'List',
                    icon: <ProfileIcon icon="lucide:list" size={18} />,
                  },
                  {
                    value: 'grid',
                    label: 'Grid',
                    icon: <ProfileIcon icon="lucide:layout-grid" size={18} />,
                  },
                ]}
                onChange={(value) => setLayout(value === 'grid' ? 'grid' : 'list')}
              />
            </div>
          )}
          {!local && (
            <SearchPanel
              spacesEnabled={spacesEnabled}
              query={query}
              onChange={setQuery}
              draftText={draft}
              onDraftTextChange={setDraft}
              scope={
                allFiles || (!sharedOpen && !current)
                  ? { kind: 'all' }
                  : sharedOpen
                    ? { kind: 'shared' }
                    : { kind: 'folder', id: current!.id }
              }
              scopeLabel={
                allFiles || (!sharedOpen && !current)
                  ? 'All accessible files'
                  : sharedOpen
                    ? 'Shared with me'
                    : current!.name
              }
              onSearchAll={() => setAllFiles(true)}
              scopeOverride={allFiles}
              onClear={() => {
                setAllFiles(false);
                pendingScroll.current = 0;
              }}
              loadedItems={[...items, ...viewed, ...shared.items]}
              onOpen={openFile}
              layout={layout}
              actionsFor={rowActions}
              offlineState={offlineState}
              viewControls={
                <SegmentedChoice
                  label="File view"
                  value={layout}
                  options={[
                    {
                      value: 'list',
                      label: 'List',
                      icon: <ProfileIcon icon="lucide:list" size={18} />,
                    },
                    {
                      value: 'grid',
                      label: 'Grid',
                      icon: <ProfileIcon icon="lucide:layout-grid" size={18} />,
                    },
                  ]}
                  onChange={(value) => setLayout(value === 'grid' ? 'grid' : 'list')}
                />
              }
              refreshKey={refresh}
              onReady={restoreScroll}
            />
          )}
        </>
      ) : (
        <>
          <nav aria-label="Breadcrumb" className="dashboard-breadcrumbs">
            <button onClick={() => navigate(null)}>My files</button>
            {current &&
              ancestors(current).map((item) => (
                <span key={item.id}>
                  {' '}
                  / <button onClick={() => openFile(item)}>{item.name}</button>
                </span>
              ))}
          </nav>
          {currentId !== TRASH_VIEW && (
            <button className="dashboard-return" onClick={returnToFiles}>
              Back to files
            </button>
          )}
        </>
      )}
      {/* SPN-049 owns removing dashboard search from editors. Keep lookup usable
          while unsaved work remains mounted, with the existing navigation guard. */}
      {liveEditor && (
        <SearchPanel
          spacesEnabled={spacesEnabled}
          query={query}
          onChange={setQuery}
          draftText={draft}
          onDraftTextChange={setDraft}
          loadedItems={[...items, ...viewed, ...shared.items]}
          onOpen={openFile}
          layout={layout}
          actionsFor={rowActions}
          offlineState={offlineState}
          refreshKey={refresh}
        />
      )}
      {offline.message && (
        <p role={offline.message.failed ? 'alert' : 'status'}>{offline.message.text}</p>
      )}
      {!liveEditor && sharedFailure}
      {!loaded || viewLoading || currentId !== viewId ? (
        <p role="status">
          {error ? 'Your files could not be loaded. Reload to try again.' : 'Loading your files…'}
        </p>
      ) : currentId === TRASH_VIEW ? (
        <Trash onChanged={reloadItems} />
      ) : currentId && !sharedOpen && !current ? (
        <p role="alert">This item is not available. Choose My files to continue.</p>
      ) : browsing ? (
        <>
          {!searchActive &&
            (local && current && !views.current[current.id] && !personalFolder ? (
              <p role="status">
                This folder wasn’t opened online on this device, so its contents aren’t here.
                Connect to open it.
              </p>
            ) : (
              <DashboardFiles
                items={listedItems}
                layout={layout}
                onOpen={openFile}
                actionsFor={rowActions}
                offlineState={offlineState}
                dateMode={sharedOpen ? 'shared' : 'updated'}
                loading={sharedOpen && !shared.loaded}
                busy={busy}
                label={sharedOpen ? 'Shared with me files' : 'Folder contents'}
                onOpenTrash={!currentId && !local ? () => navigate(TRASH_VIEW) : undefined}
                emptyMessage={
                  sharedOpen ? 'Nothing has been shared with you yet.' : 'This folder is empty.'
                }
              />
            ))}
          {canCreate && (
            <ImportFile
              key={currentId ?? 'root'}
              parentId={currentId}
              dropTarget={dropTarget}
              enabled={!searchActive}
              dialogOpen={importOpen}
              onDialogOpenChange={setImportOpen}
              onImported={(item) => {
                setItems((previous) => [...previous, item]);
                setViewed((previous) => [...previous, item]);
                setRefresh((value) => value + 1);
                setImportOpen(false);
              }}
            />
          )}
        </>
      ) : (
        current && (
          <div className="file-view" hidden={searchActive}>
            <div className="folder-heading">
              <div className="editor-title-status">
                <h2>{current.name}</h2>
                {!local && (current.kind === 'sheet' || current.kind === 'doc') && (
                  <span className="save-slot" ref={setSaveStatusTarget} />
                )}
              </div>
              <SharedBadge item={current} />
              <OfflineBadge state={offlineState(current)} />
              {actions(current)}
              <TagLabels tags={current.tags} />
            </div>
            {current.kind === 'space' ? (
              <p role="status">
                {local ? 'Connect to open this Space.' : 'This Space opens in its own view.'}{' '}
                {!local && <button onClick={() => openFile(current)}>Open Space</button>}
              </p>
            ) : local && offlineKind(current) ? (
              offline.downloads.has(current.id) ? (
                <Suspense fallback={<p role="status">Loading offline copy…</p>}>
                  <OfflineViewer key={current.id} accountId={user.id} itemId={current.id} />
                </Suspense>
              ) : (
                <p role="status">
                  {current.name} needs a connection. It isn’t downloaded on this device.
                </p>
              )
            ) : current.kind === 'sheet' ? (
              <Suspense fallback={<p role="status">Loading spreadsheet…</p>}>
                <SheetEditor
                  key={current.id}
                  id={current.id}
                  name={current.name}
                  saveStatusTarget={saveStatusTarget}
                  onDirty={navigation.dirty}
                  onConnectionState={onConnectionState}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<p role="status">Loading document…</p>}>
                <DocEditor
                  key={current.id}
                  id={current.id}
                  name={current.name}
                  saveStatusTarget={saveStatusTarget}
                  onDirty={navigation.dirty}
                  onConnectionState={onConnectionState}
                />
              </Suspense>
            )}
          </div>
        )
      )}
      {action && (
        <Modal
          title={
            action.mode === 'new'
              ? `New ${fileKindLabel[kind].toLowerCase()}`
              : `${action.mode === 'rename' ? 'Rename' : action.mode === 'file' ? 'File' : 'Move'} ${action.item!.name}`
          }
          icon={action.mode === 'new' ? kind : 'folder'}
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          dismissDisabled={busy}
        >
          <form
            className="item-form file-dialog"
            aria-label={`${action.mode === 'new' ? 'New item' : action.mode === 'file' ? 'File shared item' : action.mode === 'move' ? 'Move item' : 'Rename item'}`}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {action.mode === 'new' && (
              <label>
                Type
                <span className="entity-type-control">
                  {kind !== 'folder' && <EntityIcon kind={kind} />}
                  <select
                    value={kind}
                    disabled={busy}
                    onChange={(event) => setKind(event.target.value as FileKind)}
                  >
                    {FILE_KINDS.filter((kind) => kind !== 'space' || spacesEnabled).map((kind) => (
                      <option key={kind} value={kind}>
                        {fileKindLabel[kind]}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            )}
            {action.mode !== 'move' && action.mode !== 'file' ? (
              <label>
                Name
                <input
                  autoFocus
                  value={name}
                  disabled={busy}
                  maxLength={120}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            ) : (
              <label>
                Destination
                <select
                  value={destination}
                  disabled={
                    busy ||
                    (action.mode === 'move' &&
                      action.item?.access === 'admin' &&
                      (loadingDestinations || moveFolders.length === 0))
                  }
                  onChange={(event) => setDestination(event.target.value)}
                >
                  {action.mode === 'move' && action.item?.access === 'admin' ? (
                    <option value="" disabled>
                      Choose a folder
                    </option>
                  ) : (
                    <option value="">My files</option>
                  )}
                  {(action.mode === 'move' && action.item?.access === 'admin'
                    ? moveFolders.map((item) => ({ item, path: [item] }))
                    : folders
                  )
                    .filter(({ path }) => !path.some((item) => item.id === action.item!.id))
                    .map(({ item, path }) => (
                      <option key={item.id} value={item.id}>
                        {path.map((entry) => entry.name).join(' / ')}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {action.mode === 'move' &&
              action.item?.access === 'admin' &&
              (loadingDestinations ? (
                <p role="status">Loading authorized folders…</p>
              ) : moveFolders.length === 0 ? (
                <p role="status">
                  No authorized folders are available. Ask the Owner to grant File admin access to a
                  destination folder.
                </p>
              ) : null)}
            {error && <p role="alert">{error}</p>}
            <div className="item-actions">
              <button
                className="primary"
                disabled={
                  busy ||
                  (action.mode === 'move' &&
                    action.item?.access === 'admin' &&
                    loadingDestinations) ||
                  (action.mode === 'move' && action.item?.access === 'admin' && !destination) ||
                  (action.mode !== 'move' && action.mode !== 'file' && !name.trim())
                }
              >
                {action.mode === 'new' ? 'Create' : 'Save'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAction(null);
                  setError('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {tagging && (
        <>
          <DocumentTags
            key={tagging.id}
            item={tagging}
            onClose={() => setTagging(null)}
            onChanged={(item) => {
              setItems((previous) =>
                previous.map((entry) => (entry.id === item.id ? item : entry)),
              );
              setViewed((previous) =>
                previous.map((entry) => (entry.id === item.id ? item : entry)),
              );
              setTagging(item);
              if (browsing) setRefresh((value) => value + 1);
              if (item.access !== 'owner') void shared.refresh();
            }}
          />
        </>
      )}
      {sharing && (
        <Modal
          title={`Share ${sharing.name}`}
          icon="share"
          open
          onOpenChange={(open) => {
            if (!open) setSharing(null);
          }}
        >
          <div className="file-dialog">
            <Sharing key={sharing.id} item={sharing} onClose={() => setSharing(null)} />
          </div>
        </Modal>
      )}
      {spaceAction && (
        <SpaceRootActions
          key={`${spaceAction.item.id}:${spaceAction.mode}`}
          item={spaceAction.item}
          initialMode={spaceAction.mode}
          onClose={() => setSpaceAction(null)}
          folders={items.filter(
            (entry): entry is WorkspaceItem => entry.kind === 'folder' && entry.access === 'owner',
          )}
          beforeChange={() => navigation.allow()}
          onChanged={(item) => {
            setItems((previous) => previous.map((entry) => (entry.id === item.id ? item : entry)));
            setViewed((previous) => previous.map((entry) => (entry.id === item.id ? item : entry)));
            setSpaceAction(null);
            setRefresh((value) => value + 1);
            if (item.access !== 'owner') void shared.refresh();
          }}
          onTrashed={() => {
            setSpaceAction(null);
            setRefresh((value) => value + 1);
            void reloadItems().catch((failure) => setError(failure.message));
            void shared.refresh();
          }}
        />
      )}
      {error && !action && <p role="alert">{error}</p>}
      {liveEditor && sharedFailure}
    </section>
  );
}
