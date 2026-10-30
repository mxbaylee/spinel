import { IdentityChoice, ConnectedAppearanceDialog, ItemIcon } from './Appearance.tsx';
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
import { DocumentTags } from './DocumentTags.tsx';
import { itemsRequest } from './itemsApi.ts';
import { ImportFile } from './ImportFile.tsx';
import { WorkspaceArchive } from './WorkspaceArchive.tsx';
import { useSharedItems } from './SharedItems.tsx';
import type { NavigationGuard } from './navigation.ts';
import { rememberFileView } from './fileNavigation.ts';
import { spaceHref } from './spaceNavigation.ts';
import { SpaceRootActions } from './SpaceRootActions.tsx';
import type { SpaceRootActionMode } from './SpaceRootActions.tsx';
import { EditorFrame } from './EditorFrame.tsx';
import { AccessState } from './AccessState.tsx';
import type { ConnectionState } from './connectionState.ts';
import type { CatalogConnectionDetails } from './ConnectionStatus.tsx';
import { isNetworkFailure } from './offline/localStart.ts';
import type { LocalStart } from './offline/localStart.ts';
import { preparedAccount } from './offline/offlineStore.ts';
import type { OfflineCatalog, OfflineDownload, OfflineUser } from './offline/offlineStore.ts';
import { useOfflineDownloads } from './offline/useOfflineDownloads.ts';
import { OfflineAvailability, OfflineAvailabilityActions } from './offline/OfflineAvailability.tsx';
import { OfflineRecoveryList } from './OfflineRecoveryEntry.tsx';
import { spaceCopies } from './offline/spaceCopies.ts';
import type { ItemAppearance } from '../src/shared/appearance.ts';
import { CopyFileForm } from './CopyFile.tsx';
const SheetEditor = lazy(() =>
  import('./SheetEditor.tsx').then((module) => ({ default: module.SheetEditor })),
);

type Action = { mode: 'new' | 'rename' | 'move' | 'file' | 'relocate-creation'; item?: FileItem };
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

function creationFile(copy: OfflineDownload): FileItem | undefined {
  if (!copy.creation) return;
  return {
    id: copy.itemId,
    kind: copy.kind,
    name: copy.name,
    access: copy.creation.access ?? 'owner',
    ownerName: copy.creation.ownerName,
    createdByName: copy.creation.createdByName,
    parentId: copy.creation.parentId,
    createdAt: copy.creation.createdAt,
    updatedAt: copy.creation.createdAt,
    tags: [],
    appearance: copy.appearance,
  };
}

/**
 * The file list and the open item. With `local` set, Spinel started without a
 * network: everything comes from the last-synced catalog on this device, only
 * prepared documents open from this device and new Sheets/Docs save here before
 * connecting. Each native editor independently verifies its account and replay.
 */
export function Dashboard({
  navigation,
  user,
  local,
  onConnectionState,
  onCatalogStatus,
  onOpen,
  onPlaces,
  connection = 'reconnecting',
  catalog: connectionCatalog,
}: {
  connection?: ConnectionState;
  catalog?: CatalogConnectionDetails | null;
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
  const shared = useSharedItems(
    local?.catalog.shared,
    () => offline.catalogRevision(),
    local?.catalog.sharedCreationRevision ?? 0,
  );
  const [importOpen, setImportOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archiveFocus = useRef<HTMLButtonElement | null>(null);
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
  const appearanceFocus = useRef<HTMLButtonElement | null>(null);
  const sharingFocus = useRef<HTMLButtonElement | null>(null);
  const offlineFocus = useRef<HTMLButtonElement | null>(null);
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
  const [newIconColor, setNewIconColor] = useState<string | null>(null);
  const [newIcon, setNewIcon] = useState<string | null>(null);
  const [appearanceItem, setAppearanceItem] = useState<FileItem | null>(null);
  const [copyItem, setCopyItem] = useState<FileItem | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const copyFocus = useRef<HTMLButtonElement | null>(null);
  const [copyConfirmation, setCopyConfirmation] = useState('');
  useEffect(() => {
    const changed = (event: Event) => {
      const { id, appearance } = (event as CustomEvent<{ id: string; appearance: ItemAppearance }>)
        .detail;
      const update = (items: FileItem[]) =>
        items.map((item) => (item.id === id ? { ...item, appearance } : item));
      // Metadata saves must not remount a live native editor or discard an open draft.
      setItems(update);
      setViewed(update);
      views.current = Object.fromEntries(
        Object.entries(views.current).map(([key, items]) => [key, update(items)]),
      );
    };
    window.addEventListener('spinel-appearance-changed', changed);
    return () => window.removeEventListener('spinel-appearance-changed', changed);
  }, []);
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
  const [catalogRevision, setCatalogRevision] = useState(local?.catalog.creationRevision ?? 0);
  const catalogRevisionRef = useRef(catalogRevision);
  useEffect(() => {
    onCatalogStatus?.({ syncedAt, local: Boolean(local), stale: Boolean(error || shared.error) });
  }, [syncedAt, local, error, shared.error, onCatalogStatus]);
  useEffect(() => () => onCatalogStatus?.(null), [onCatalogStatus]);
  // The last-loaded view for each opened folder or item, kept for offline launch.
  const views = useRef<Record<string, FileItem[]>>({ ...local?.catalog.views });
  // Creation metadata belongs to the file list, not to its optional device copy.
  // Keep its ordering fence after removal until the proper list supersedes it.
  const acknowledgedCreations = useRef(
    new Map((local?.catalog.creationMetadata ?? []).map((entry) => [entry.item.id, entry])),
  );
  function creationView(rows: FileItem[]) {
    return rows.flatMap((item) => {
      const entry = acknowledgedCreations.current.get(item.id);
      if (!entry) return [item];
      const own = entry.item.access === 'owner';
      if ((own ? catalogRevision : shared.creationRevision) < entry.revision) return [item];
      // Ownership can change after publication. The opposite list may supply
      // the current role/parent only after its own request covers this receipt.
      const authoritative =
        (own ? items : shared.items).find((row) => row.id === item.id) ??
        ((own ? shared.creationRevision : catalogRevision) >= entry.revision
          ? (own ? shared.items : items).find((row) => row.id === item.id)
          : undefined);
      return authoritative ? [authoritative] : [];
    });
  }
  const catalog = (): OfflineCatalog | null =>
    loaded && shared.loaded
      ? {
          syncedAt,
          creationRevision: catalogRevision,
          sharedCreationRevision: shared.creationRevision,
          ...(creationMetadata.length ? { creationMetadata } : {}),
          items: [
            ...new Map(
              [
                ...deviceCreatedFiles.filter(
                  (item) => item.access === 'owner' && !offline.downloads.get(item.id)?.creation,
                ),
                ...items,
              ].map((item) => [item.id, item]),
            ).values(),
          ],
          shared: [
            ...new Map(
              [
                ...deviceCreatedFiles.filter(
                  (item) => item.access !== 'owner' && !offline.downloads.get(item.id)?.creation,
                ),
                ...shared.items,
              ].map((item) => [item.id, item]),
            ).values(),
          ],
          views: Object.fromEntries(
            Object.entries(views.current).map(([id, rows]) => [id, creationView(rows)]),
          ),
        }
      : null;
  const offline = useOfflineDownloads(user, local, catalog);
  const creationItems = [...offline.downloads.values()].flatMap((copy) => {
    const item = creationFile(copy);
    return item ? [item] : [];
  });
  for (const copy of offline.downloads.values())
    if (
      copy.createdFile &&
      copy.createdFileRevision &&
      copy.createdFileRevision > (acknowledgedCreations.current.get(copy.itemId)?.revision ?? 0)
    )
      acknowledgedCreations.current.set(copy.itemId, {
        item: copy.createdFile,
        revision: copy.createdFileRevision,
      });
  const creationMetadata = [...acknowledgedCreations.current.values()].filter(
    ({ item, revision }) =>
      (item.access === 'owner' ? catalogRevision : shared.creationRevision) < revision,
  );
  const deviceCreatedFiles = [...creationItems, ...creationMetadata.map((entry) => entry.item)];
  useEffect(() => {
    const known = new Set(items.map((item) => item.id));
    const accepted = deviceCreatedFiles.filter(
      (item) =>
        item.access === 'owner' && !offline.downloads.get(item.id)?.creation && !known.has(item.id),
    );
    // Keep accepted files in the ordinary catalog before metadata edits or device
    // removal. Repeat for late pre-acknowledgement lists; the revision cutoff
    // above stops adoption once an authoritative list supersedes the fallback.
    if (accepted.length)
      setItems((previous) => {
        const current = accepted.filter(
          (item) =>
            (acknowledgedCreations.current.get(item.id)?.revision ?? 0) >
            catalogRevisionRef.current,
        );
        return current.length
          ? [...new Map([...current, ...previous].map((item) => [item.id, item])).values()]
          : previous;
      });
  }, [items, offline.downloads, catalogRevision]);
  const currentCreation = creationItems.find((item) => item.id === currentId);
  // Publication must not replace a mounted editor with a different component:
  // it may still hold unfinished input or an unacknowledged native checkpoint.
  const heldCreation = useRef<FileItem | null>(null);
  if (currentCreation) heldCreation.current = currentCreation;
  else if (heldCreation.current?.id !== currentId) heldCreation.current = null;
  const heldCreationId = heldCreation.current?.id;
  const localEditor = Boolean(local || heldCreationId === currentId);
  useEffect(() => {
    // Returning from the native editor reuses this Dashboard. Read its newly
    // committed pending state before showing the account recovery entries.
    if (!currentId) void offline.refreshSummaries().catch(() => {});
  }, [currentId, user.id]);
  useEffect(() => {
    if (local) {
      setItems(local.catalog.items);
      setLoaded(true);
    } else {
      void reloadItems()
        .then(() => setLoaded(true))
        .catch((failure) => setError(failure.message));
    }
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
    if (
      !currentId ||
      currentId === TRASH_VIEW ||
      currentId === SHARED_VIEW ||
      local ||
      heldCreationId === currentId
    ) {
      if (heldCreation.current?.id === currentId) setViewed([heldCreation.current]);
      else if (local && currentId) setViewed(views.current[currentId] ?? []);
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
          const saved = views.current[currentId];
          // A warm Dashboard can disconnect after this folder was prepared.
          // Reuse only that account's saved folder on a network failure; an
          // actual server denial remains authoritative even with cached rows.
          if (
            isNetworkFailure(failure) &&
            preparedAccount() === user.id &&
            saved?.some((item) => item.id === currentId && item.kind === 'folder')
          ) {
            setViewed(saved);
          } else {
            setError(failure.message);
            setViewMissing(true);
          }
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
  }, [currentId, refresh, heldCreationId]);
  useEffect(() => {
    const current = catalog();
    if (current && !local) void offline.saveCatalog(current).catch(() => {});
  }, [items, shared.items, viewed, offline.downloads, catalogRevision, shared.creationRevision]);
  // Offline, any item from a saved view can be opened by its stable link.
  const known = local ? creationView(Object.values(views.current).flat()) : [];
  const byId = new Map(
    [
      ...known,
      ...deviceCreatedFiles,
      ...(heldCreation.current ? [heldCreation.current] : []),
      ...items,
      ...shared.items,
      ...creationView(viewed),
      ...creationItems,
    ].map((item) => [item.id, item]),
  );
  const current =
    currentId && (!viewMissing || heldCreationId === currentId) ? byId.get(currentId) : undefined;
  const browsing = !currentId || sharedOpen || current?.kind === 'folder';
  const missingView = Boolean(
    loaded &&
    !viewLoading &&
    currentId === viewId &&
    currentId &&
    currentId !== TRASH_VIEW &&
    !sharedOpen &&
    !current,
  );
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
  const framedEditor = current && (current.kind === 'sheet' || current.kind === 'doc');
  const liveEditor = !localEditor && framedEditor ? current.id : null;
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
  const listedFolders = new Set(
    [...items, ...shared.items].filter((item) => item.kind === 'folder').map((item) => item.id),
  );
  const visibleItems = personalFolder
    ? [
        ...new Map(
          [
            ...(currentId ? creationView(viewed) : items).filter(
              (item) => item.access === 'owner' && item.parentId === currentId,
            ),
            ...shared.items.filter((item) => item.placementParentId === currentId),
            ...deviceCreatedFiles
              .map((item) => byId.get(item.id) ?? item)
              .filter(
                (item) =>
                  item.parentId === currentId ||
                  (!currentId &&
                    (!item.parentId ||
                      !listedFolders.has(item.parentId) ||
                      byId.get(item.parentId)?.kind !== 'folder' ||
                      (item.access === 'owner' && byId.get(item.parentId)?.access !== 'owner') ||
                      Boolean(offline.downloads.get(item.id)?.creation?.problem))),
              ),
          ].map((item) => [item.id, item]),
        ).values(),
      ]
    : [
        ...new Map(
          [...creationView(viewed), ...deviceCreatedFiles]
            .map((item) => byId.get(item.id) ?? item)
            .filter((item) => item.parentId === currentId)
            .map((item) => [item.id, item]),
        ).values(),
      ];
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
    offline.clearMessage();
    if (check) setCopyConfirmation('');
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
    setNewIcon(null);
    setNewIconColor(null);
    setKind(newKind);
    setDestination(
      mode === 'relocate-creation'
        ? ''
        : mode === 'file'
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
      if (action.mode === 'new' && localCreation && !['sheet', 'doc'].includes(kind))
        throw new Error('Choose a Sheet or Doc to create on this device.');
      if (action.mode === 'relocate-creation') {
        const item = await offline.relocateCreation(action.item!.id, destination || null);
        setViewed((previous) => previous.filter((entry) => entry.id !== item.id));
        setAction(null);
        return;
      }
      if (action.mode === 'file') {
        if (await shared.place(action.item!.id, destination || null)) setAction(null);
        return;
      }
      const creatingLocally = action.mode === 'new' && localCreation;
      const item = creatingLocally
        ? await offline.create(name, kind === 'sheet' ? 'sheet' : 'doc', currentId, {
            icon: newIcon,
            iconColor: newIconColor,
          })
        : (
            await itemsRequest<{ item: FileItem }>(
              action.mode === 'new' ? '' : `/${action.item!.id}`,
              action.mode === 'new' ? 'POST' : 'PATCH',
              action.mode === 'new'
                ? {
                    name,
                    kind,
                    icon: newIcon,
                    iconColor: newIconColor,
                    parentId: sharedOpen ? null : currentId,
                  }
                : action.mode === 'rename'
                  ? { name }
                  : { parentId: destination || null },
            )
          ).item;
      if (!creatingLocally)
        setItems((previous) => [
          ...previous.filter((entry) => entry.id !== item.id),
          ...(item.access === 'owner' ? [item] : []),
        ]);
      setViewed((previous) => [...previous.filter((entry) => entry.id !== item.id), item]);
      setAction(null);
      if (browsing) setRefresh((value) => value + 1);
      if (!creatingLocally && item.access !== 'owner') await shared.refresh();
      if (action.mode === 'new' && item.kind !== 'folder') openFile(item);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function reloadItems() {
    const observed = await offline.catalogRevision();
    // An admitted cutoff remains a lower bound if this storage read fails.
    const revision = Math.max(observed, catalogRevisionRef.current);
    const requestedAt = Date.now();
    const result = await itemsRequest<{ items: FileItem[]; spacesEnabled?: boolean }>();
    // A delayed pre-acknowledgement list must not revive a retired fallback.
    if (revision < catalogRevisionRef.current) return;
    catalogRevisionRef.current = revision;
    setItems(result.items);
    setSpacesEnabled(result.spacesEnabled === true);
    setSyncedAt(requestedAt);
    setCatalogRevision(revision);
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
    const creation = offline.downloads.get(item.id)?.creation;
    if (creation) return creation.problem ? 'needs-attention' : 'not-synced';
    if (
      item.kind === 'space' &&
      spaceCopies(offline.downloads.values(), item.id).some((copy) => copy.available !== false)
    )
      return 'pages-available';
    const copy = offline.downloads.get(item.id);
    if (copy && copy.available !== false) return 'available';
    return (copy || local) && (offlineKind(item) || item.kind === 'space')
      ? 'needs-connection'
      : null;
  }
  function rowActions(item: FileItem, placement: 'row' | 'editor' = 'row'): MenuAction[] {
    const creation = offline.downloads.get(item.id)?.creation;
    if (creation)
      return creation.canRelocate && placement === 'row'
        ? [
            {
              label: 'Choose another folder…',
              onClick: () => edit('relocate-creation', item),
              disabled: busy,
            },
          ]
        : [];
    if (local) return [];
    const result: MenuAction[] = [];
    if (placement === 'row' && (item.kind === 'sheet' || item.kind === 'doc'))
      result.push({
        label: 'Make a copy…',
        icon: <ProfileIcon icon="lucide:copy-plus" size={18} />,
        disabled: busy || connection === 'offline',
        onClick: (trigger) => {
          copyFocus.current = trigger ?? null;
          setCopyItem(item);
        },
      });
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
      result.push({
        label: 'Appearance…',
        onClick: (trigger) => {
          appearanceFocus.current = trigger ?? null;
          setAppearanceItem(item);
        },
        disabled: busy || connection === 'offline',
      });
      for (const mode of ['share', 'rename', 'move', 'trash'] as const) {
        result.push({
          label: { share: 'Share…', rename: 'Rename…', move: 'Move…', trash: 'Move to Trash' }[
            mode
          ],
          destructive: mode === 'trash',
          disabled: busy,
          onClick: (trigger) => {
            if (mode === 'share') sharingFocus.current = trigger ?? null;
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
        onClick: (trigger) => {
          offlineFocus.current = trigger ?? null;
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
    if (!value) {
      const parent = [...items, ...viewed, ...shared.items].find(
        (item) => item.id === current?.parentId && item.kind === 'folder',
      );
      return navigate(parent?.id ?? null, false);
    }
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
  const sharedFailure = shared.error && (
    <p role="alert">
      {shared.error} <button onClick={() => void shared.refresh()}>Refresh shared items</button>
    </p>
  );
  const localCreation = Boolean(local) || connection === 'offline';
  const canCreate =
    browsing &&
    !sharedOpen &&
    (!currentId || (current?.kind === 'folder' && current.access !== 'viewer'));
  const newKinds = FILE_KINDS.filter((kind) =>
    localCreation ? kind === 'sheet' || kind === 'doc' : kind !== 'space' || spacesEnabled,
  );
  // Shared is already ordered by latest grant; alphabetizing would hide recent shares.
  const listedItems = sharedOpen
    ? [
        ...new Map(
          [...shared.items, ...deviceCreatedFiles.filter((item) => item.access !== 'owner')].map(
            (item) => [item.id, byId.get(item.id) ?? item],
          ),
        ).values(),
      ]
    : [...visibleItems].sort(
        (a, b) =>
          Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
  return (
    <section ref={dropTarget} className="dashboard-content" aria-label="Your files">
      {!onPlaces && !framedEditor && (
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
            <h1>
              {current && !sharedOpen && <ItemIcon {...current} />}{' '}
              {sharedOpen ? 'Shared with me' : (current?.name ?? 'My files')}
            </h1>
            <div className="dashboard-heading-actions">
              {!currentId && !local && (
                <ActionMenu
                  label="More actions for My files"
                  actions={[
                    {
                      label: 'Export all my files',
                      disabled: busy,
                      onClick: (trigger) => {
                        archiveFocus.current = trigger ?? null;
                        setArchiveOpen(true);
                      },
                    },
                  ]}
                />
              )}
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
                    ...newKinds.map((kind) => ({
                      label: fileKindLabel[kind],
                      onClick: () => edit('new', undefined, kind),
                      disabled: busy,
                    })),
                    ...(!localCreation
                      ? [
                          {
                            label: 'Import file…',
                            onClick: () => setImportOpen(true),
                            disabled: busy,
                          },
                        ]
                      : []),
                  ]}
                >
                  New
                </ActionMenu>
              )}
            </div>
          </header>

          {!currentId && (
            <OfflineRecoveryList downloads={offline.downloads.values()} navigation={navigation} />
          )}

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
      ) : !framedEditor && !missingView ? (
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
      ) : null}
      {!framedEditor && offline.message && (
        <>
          <p role={offline.message.failed ? 'alert' : 'status'}>{offline.message.text}</p>
          {offline.message.detail && <p>{offline.message.detail}</p>}
          <OfflineAvailabilityActions
            message={offline.message}
            allowNavigation={navigation.allow}
          />
        </>
      )}
      {framedEditor && offline.message && (
        <OfflineAvailability
          message={offline.message}
          onDismiss={offline.clearMessage}
          finalFocus={() => (offlineFocus.current?.isConnected ? offlineFocus.current : true)}
          allowNavigation={navigation.allow}
        />
      )}
      {!framedEditor && sharedFailure}
      {!loaded || viewLoading || currentId !== viewId ? (
        <p role="status">
          {error ? 'Your files could not be loaded. Reload to try again.' : 'Loading your files…'}
        </p>
      ) : currentId === TRASH_VIEW ? (
        <Trash onChanged={reloadItems} />
      ) : missingView ? (
        <AccessState kind="missing" embedded onFiles={() => navigate(null)} />
      ) : browsing ? (
        <>
          {!searchActive &&
            (local &&
            current &&
            !views.current[current.id] &&
            !personalFolder &&
            !listedItems.length ? (
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
                details={(item) => {
                  const creation = offline.downloads.get(item.id)?.creation;
                  if (creation?.canRelocate)
                    return 'The chosen folder is no longer available. Choose another folder from this document’s menu.';
                  return creation
                    ? (creation.problem ?? 'Saved on this device. Open to upload when connected.')
                    : null;
                }}
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
          {canCreate && !localCreation && (
            <ImportFile
              key={currentId ?? 'root'}
              parentId={currentId}
              dropTarget={dropTarget}
              enabled={!searchActive}
              dialogOpen={importOpen}
              onDialogOpenChange={setImportOpen}
              onImported={(item) => {
                if (item.access === 'owner') setItems((previous) => [...previous, item]);
                else void shared.refresh();
                setViewed((previous) => [...previous, item]);
                setRefresh((value) => value + 1);
                setImportOpen(false);
              }}
              onArchiveImported={() => {
                setRefresh((value) => value + 1);
                void reloadItems().catch((failure) => setError(failure.message));
              }}
            />
          )}
        </>
      ) : (
        current && (
          <EditorFrame
            appearanceTarget={current}
            appearanceDisabled={!!local || Boolean(currentCreation)}
            offlineAccountId={user.id}
            key={current.id}
            name={current.name}
            connection={local ? 'offline' : connection}
            catalog={connectionCatalog}
            access={
              local
                ? offline.downloads.get(current.id)?.readOnly
                  ? 'Read only'
                  : 'On this device'
                : current.access === 'owner'
                  ? undefined
                  : accessLabel(current.access)
            }
            onBack={returnToFiles}
            actions={rowActions(current, 'editor').filter((action) => action.label !== 'Rename…')}
            onRename={
              !local && !currentCreation && canAdminister(current.access)
                ? async (name) => {
                    const { item } = await itemsRequest<{ item: FileItem }>(
                      `/${current.id}`,
                      'PATCH',
                      { name },
                    );
                    setItems((previous) =>
                      previous.map((entry) => (entry.id === item.id ? item : entry)),
                    );
                    setViewed((previous) =>
                      previous.map((entry) => (entry.id === item.id ? item : entry)),
                    );
                    if (item.access !== 'owner') await shared.refresh();
                  }
                : undefined
            }
          >
            {current.kind === 'space' ? (
              <p role="status">
                {local ? 'Connect to open this Space.' : 'This Space opens in its own view.'}{' '}
                {!local && <button onClick={() => openFile(current)}>Open Space</button>}
              </p>
            ) : localEditor && offlineKind(current) ? (
              <Suspense fallback={<p role="status">Loading offline copy…</p>}>
                <OfflineViewer
                  key={current.id}
                  accountId={user.id}
                  itemId={current.id}
                  name={current.name}
                  onDirty={navigation.dirty}
                  onConnectionState={onConnectionState}
                />
              </Suspense>
            ) : current.kind === 'sheet' ? (
              <Suspense fallback={<p role="status">Loading spreadsheet…</p>}>
                <SheetEditor
                  key={current.id}
                  id={current.id}
                  name={current.name}
                  saveStatusTarget={null}
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
                  saveStatusTarget={null}
                  onDirty={navigation.dirty}
                  onConnectionState={onConnectionState}
                />
              </Suspense>
            )}
          </EditorFrame>
        )
      )}
      {browsing && copyConfirmation && (
        <p className="dashboard-copy-confirmation" role="status">
          {copyConfirmation}
        </p>
      )}
      {copyItem && (
        <Modal
          title="Make a copy"
          icon="copy"
          open
          dismissDisabled={copyBusy}
          onOpenChange={(open) => {
            if (!open && !copyBusy) setCopyItem(null);
          }}
          finalFocus={() => (copyFocus.current?.isConnected ? copyFocus.current : true)}
        >
          <CopyFileForm
            id={copyItem.id}
            unavailable={connection === 'offline' ? 'Reconnect before making a copy.' : null}
            canSubmit={() => connection !== 'offline'}
            onBusy={setCopyBusy}
            onClose={() => setCopyItem(null)}
            onCreated={(item) => {
              setCopyItem(null);
              setItems((previous) => [
                ...previous.filter((entry) => entry.id !== item.id),
                ...(item.access === 'owner' ? [item] : []),
              ]);
              setViewed((previous) => [...previous.filter((entry) => entry.id !== item.id), item]);
              setCopyConfirmation(`Created ${item.name}.`);
              setRefresh((value) => value + 1);
              if (item.access !== 'owner') void shared.refresh();
              openFile(item);
            }}
          />
        </Modal>
      )}
      {appearanceItem && (
        <ConnectedAppearanceDialog
          key={`appearance-${appearanceItem.id}`}
          target={appearanceItem}
          disabled={!!local || connection === 'offline'}
          finalFocus={() => (appearanceFocus.current?.isConnected ? appearanceFocus.current : true)}
          close={() => setAppearanceItem(null)}
        />
      )}
      {action && (
        <Modal
          title={
            action.mode === 'relocate-creation'
              ? 'Choose another folder'
              : action.mode === 'new'
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
            aria-label={`${action.mode === 'new' ? 'New item' : action.mode === 'relocate-creation' ? 'Choose another folder' : action.mode === 'file' ? 'File shared item' : action.mode === 'move' ? 'Move item' : 'Rename item'}`}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {action.mode === 'new' && (
              <IdentityChoice
                name={name}
                kind={kind}
                value={newIcon}
                onChange={setNewIcon}
                color={newIconColor}
                onColorChange={setNewIconColor}
                disabled={busy}
              />
            )}
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
                    {newKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {fileKindLabel[kind]}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            )}
            {action.mode === 'relocate-creation' && (
              <p>
                {action.item!.name} stays saved on this device. Choose where to upload it when
                connected.
              </p>
            )}
            {action.mode === 'new' && localCreation && (
              <p>This document will save on this device and upload when connected.</p>
            )}
            {action.mode === 'new' && current && current.access !== 'owner' && (
              <p>
                This item will belong to {current.ownerName ?? 'the folder owner'}. You’ll be shown
                as its creator.
              </p>
            )}
            {action.mode !== 'move' &&
            action.mode !== 'file' &&
            action.mode !== 'relocate-creation' ? (
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
                  (action.mode !== 'move' &&
                    action.mode !== 'file' &&
                    action.mode !== 'relocate-creation' &&
                    !name.trim())
                }
              >
                {action.mode === 'new'
                  ? 'Create'
                  : action.mode === 'relocate-creation'
                    ? 'Choose folder'
                    : 'Save'}
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

      {archiveOpen && (
        <WorkspaceArchive
          onClose={() => setArchiveOpen(false)}
          finalFocus={() => (archiveFocus.current?.isConnected ? archiveFocus.current : true)}
        />
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
        <Sharing
          key={`sharing-${sharing.id}`}
          item={sharing}
          onClose={() => setSharing(null)}
          finalFocus={() => (sharingFocus.current?.isConnected ? sharingFocus.current : true)}
        />
      )}
      {spaceAction && (
        <SpaceRootActions
          key={`${spaceAction.item.id}:${spaceAction.mode}`}
          item={spaceAction.item}
          initialMode={spaceAction.mode}
          finalFocus={() => (sharingFocus.current?.isConnected ? sharingFocus.current : true)}
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
      {/* AccessState already presents this generic failure. Keep distinct
          request errors and their state for network/server failure reporting. */}
      {error && !action && !(missingView && error === 'This item is not available.') && (
        <p role="alert">{error}</p>
      )}
      {framedEditor && sharedFailure}
    </section>
  );
}
