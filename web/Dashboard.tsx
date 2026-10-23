import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FILE_KINDS, fileKindLabel, canAdminister, accessLabel } from '../src/shared/workspace.ts';
import type { FileKind, FileItem, WorkspaceItem } from '../src/shared/workspace.ts';

import { Sharing } from './Sharing.tsx';
import { SearchPanel } from './SearchPanel.tsx';
import { emptySearch, hasSearch } from '../src/shared/search.ts';
import type { SearchQuery } from '../src/shared/search.ts';
import { Trash } from './Trash.tsx';
import { DocumentTags, TagLabels } from './DocumentTags.tsx';
import { itemsRequest } from './itemsApi.ts';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import { ImportFile } from './ImportFile.tsx';
import { SharedBadge, useSharedItems } from './SharedItems.tsx';
import type { NavigationGuard } from './navigation.ts';
import { rememberFileView } from './fileNavigation.ts';
import { spaceHref } from './spaceNavigation.ts';
import { SpaceRootActions } from './SpaceRootActions.tsx';
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
const selectedId = () => {
  const query = new URLSearchParams(location.search);
  return query.has('trash') ? TRASH_VIEW : query.get('item');
};
const viewUrl = (id: string | null) =>
  id === TRASH_VIEW ? '/?trash=1' : id ? `/?item=${encodeURIComponent(id)}` : '/';

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
}: {
  navigation: NavigationGuard;
  user: OfflineUser;
  local?: LocalStart | null;
  onConnectionState?: (state: ConnectionState | null) => void;
  onCatalogStatus?: (details: CatalogConnectionDetails | null) => void;
  onOpen?: (item: FileItem) => void;
}) {
  const dropTarget = useRef<HTMLElement>(null);
  const [saveStatusTarget, setSaveStatusTarget] = useState<HTMLSpanElement | null>(null);
  const [query, setQuery] = useState<SearchQuery>({ ...emptySearch });
  const searchActive = hasSearch(query);
  const shared = useSharedItems(local?.catalog.shared);
  const [sharedOpen, setSharedOpen] = useState(false);
  const draggingShared = useRef<string | null>(null);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [spacesEnabled, setSpacesEnabled] = useState(false);
  const [viewed, setViewed] = useState<FileItem[]>([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewMissing, setViewMissing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sharing, setSharing] = useState<FileItem | null>(null);
  const [tagging, setTagging] = useState<FileItem | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(selectedId);
  useEffect(() => rememberFileView(user.id, currentId), [user.id, currentId]);
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
      setQuery({ ...emptySearch });
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
    if (!currentId || currentId === TRASH_VIEW || local) {
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
    setQuery({ ...emptySearch });
    history.pushState(null, '', viewUrl(id));
    setCurrentId(id);
    setTagging(null);
    setAction(null);
    setError('');
  }
  function openFile(item: FileItem) {
    if (item.kind !== 'space') return navigate(item.id);
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
  function edit(mode: Action['mode'], item?: FileItem) {
    setAction({ mode, item });
    setName(item?.name ?? '');
    setKind('folder');
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
          ? { name, kind, parentId: currentId }
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
  function folderDrop(parentId: string | null) {
    return {
      onDragOver: (event: React.DragEvent) => {
        if (draggingShared.current && !shared.busy) event.preventDefault();
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const id = draggingShared.current;
        draggingShared.current = null;
        if (id && !shared.busy) void shared.place(id, parentId);
      },
    };
  }
  function dragShared(item: FileItem) {
    return (
      <button
        draggable={!shared.busy}
        disabled={shared.busy}
        aria-label={`Drag ${item.name} into a folder`}
        onDragStart={(event) => {
          draggingShared.current = item.id;
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('application/x-spinel-shared-id', item.id);
        }}
        onDragEnd={() => {
          draggingShared.current = null;
        }}
      >
        ↗
      </button>
    );
  }
  async function trashItem(item: FileItem) {
    if (!navigation.allow()) return;
    setBusy(true);
    setError('');
    try {
      await itemsRequest(`/${item.id}/trash`, 'POST', {});
      setSharing(null);
      setViewed([]);
      navigate(item.parentId, false);
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
  return (
    <>
      <p className="eyebrow">Your workspace</p>
      <h1>Dashboard</h1>
      <div className="dashboard">
        <aside aria-label="Folders">
          <button {...folderDrop(null)} disabled={busy} onClick={() => navigate(null)}>
            All my files
          </button>
          <button
            aria-expanded={sharedOpen && !searchActive}
            onClick={() => {
              if (searchActive) {
                setQuery({ ...emptySearch });
                setSharedOpen(true);
              } else setSharedOpen((value) => !value);
            }}
          >
            Shared with me
          </button>
          {!local && (
            <button
              disabled={busy}
              aria-current={currentId === TRASH_VIEW ? 'page' : undefined}
              onClick={() => navigate(TRASH_VIEW)}
            >
              Trash
            </button>
          )}
          <ul className="folder-tree">
            {folders.map(({ item, path }) => (
              <li key={item.id} style={{ paddingLeft: Math.min(path.length - 1, 8) * 12 }}>
                <button
                  {...folderDrop(item.id)}
                  disabled={busy}
                  aria-current={currentId === item.id ? 'page' : undefined}
                  onClick={() => navigate(item.id)}
                  title={path.map((entry) => entry.name).join(' / ')}
                >
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section ref={dropTarget} className="files" aria-label="Your files">
          {!local && (
            <SearchPanel
              spacesEnabled={spacesEnabled}
              query={query}
              onChange={setQuery}
              loadedItems={[
                ...items,
                ...viewed.filter((item) => item.access === 'owner'),
                ...shared.items,
              ]}
              onOpen={openFile}
            />
          )}
          {offline.message && (
            <p role={offline.message.failed ? 'alert' : 'status'}>{offline.message.text}</p>
          )}
          {!liveEditor && sharedFailure}
          {sharedOpen && !searchActive && (
            <section className="shared-drawer" aria-label="Shared with me">
              <h2>Shared with me</h2>
              <p>File a reference in your folders. The owner's copy stays where it is.</p>
              {!shared.loaded ? (
                <p role="status">Loading shared items…</p>
              ) : (
                !shared.items.length && <p>Nothing has been shared with you yet.</p>
              )}
              <ul className="file-list">
                {shared.items.map((item) => (
                  <li key={item.id}>
                    {dragShared(item)}
                    <button
                      className="item-open"
                      aria-label={`Open ${item.name}`}
                      onClick={() => openFile(item)}
                    >
                      {item.kind !== 'folder' && <EntityIcon kind={item.kind} />}
                      {item.name} <span className="item-kind">{fileKindLabel[item.kind]}</span>
                    </button>
                    <SharedBadge item={item} />
                    <OfflineBadge state={offlineState(item)} />
                    <small>
                      {item.sharedAt ? new Date(item.sharedAt).toLocaleDateString() : 'Older share'}
                    </small>
                    {actions(item)}
                    <TagLabels tags={item.tags} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* Keep editors mounted while searching so unsaved work is preserved. */}
          <div className="file-view" hidden={searchActive}>
            <nav aria-label="Breadcrumb">
              <button disabled={busy} onClick={() => navigate(null)}>
                My files
              </button>
              {ancestors(current).map((item) => (
                <span key={item.id}>
                  {' '}
                  /{' '}
                  <button
                    disabled={busy}
                    aria-current={item.id === currentId ? 'page' : undefined}
                    onClick={() => openFile(item)}
                  >
                    {item.name}
                  </button>
                </span>
              ))}
            </nav>
            {!loaded || viewLoading || currentId !== viewId ? (
              <p role="status">
                {error
                  ? 'Your files could not be loaded. Reload to try again.'
                  : 'Loading your files…'}
              </p>
            ) : currentId === TRASH_VIEW ? (
              <Trash onChanged={reloadItems} />
            ) : currentId && !current ? (
              <p role="alert">This item is not available. Choose My files to continue.</p>
            ) : (
              <>
                <div className="folder-heading">
                  <div className="editor-title-status">
                    <h2>{current?.name ?? 'My files'}</h2>
                    {!local && current && (current.kind === 'doc' || current.kind === 'sheet') && (
                      <span className="save-slot" ref={setSaveStatusTarget} />
                    )}
                  </div>
                  {current && <SharedBadge item={current} />}
                  {current && <OfflineBadge state={offlineState(current)} />}
                  {current && actions(current)}
                  {current && <TagLabels tags={current.tags} />}
                </div>
                {!current || current.kind === 'folder' ? (
                  <>
                    {!local && (!current || current.access === 'owner') && (
                      <button className="primary" disabled={busy} onClick={() => edit('new')}>
                        New
                      </button>
                    )}
                    {!local && current && (
                      <button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
                        Refresh folder
                      </button>
                    )}
                    {!local && (!current || current.access === 'owner') && (
                      <ImportFile
                        key={currentId ?? 'root'}
                        parentId={currentId}
                        dropTarget={dropTarget}
                        enabled={!searchActive}
                        onImported={(item) => {
                          setItems((previous) => [...previous, item]);
                          setViewed((previous) => [...previous, item]);
                          setRefresh((value) => value + 1);
                        }}
                      />
                    )}
                    <ul className="file-list" aria-label="Folder contents">
                      {visibleItems
                        .sort(
                          (a, b) =>
                            Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
                            a.name.localeCompare(b.name) ||
                            a.id.localeCompare(b.id),
                        )
                        .map((item) => (
                          <li key={item.id}>
                            {item.access !== 'owner' && dragShared(item)}
                            <button
                              className="item-open"
                              disabled={busy}
                              onClick={() => openFile(item)}
                            >
                              {item.kind !== 'folder' && <EntityIcon kind={item.kind} />}
                              {item.name}{' '}
                              <span className="item-kind">{fileKindLabel[item.kind]}</span>
                            </button>
                            <SharedBadge item={item} />
                            <OfflineBadge state={offlineState(item)} />
                            {actions(item)}
                            <TagLabels tags={item.tags} />
                          </li>
                        ))}
                    </ul>
                    {local && current && !views.current[current.id] && !personalFolder ? (
                      <p role="status">
                        This folder wasn’t opened online on this device, so its contents aren’t
                        here. Connect to open it.
                      </p>
                    ) : (
                      !visibleItems.length && (
                        <p className="empty-state">
                          <GemLogo size={52} />
                          This folder is empty.
                          {!local &&
                            (!current || current.access === 'owner') &&
                            (spacesEnabled
                              ? ' Choose New to add a folder, document, or Space.'
                              : ' Choose New to add a folder or document.')}
                        </p>
                      )
                    )}
                  </>
                ) : current.kind === 'space' ? (
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
              </>
            )}
            {action && (
              <form
                className="item-form"
                aria-label={`${action.mode === 'new' ? 'New item' : action.mode === 'file' ? 'File shared item' : action.mode === 'move' ? 'Move item' : 'Rename item'}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <h3>
                  {action.mode === 'new'
                    ? 'New item'
                    : `${action.mode === 'rename' ? 'Rename' : action.mode === 'file' ? 'File' : 'Move'} ${action.item!.name}`}
                </h3>
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
                        {FILE_KINDS.filter((kind) => kind !== 'space' || spacesEnabled).map(
                          (kind) => (
                            <option key={kind} value={kind}>
                              {fileKindLabel[kind]}
                            </option>
                          ),
                        )}
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
                      No authorized folders are available. Ask the Owner to grant File admin access
                      to a destination folder.
                    </p>
                  ) : null)}
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
            )}
            {tagging && (
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
                }}
              />
            )}
            {sharing && (
              <Sharing key={sharing.id} item={sharing} onClose={() => setSharing(null)} />
            )}
            {error && <p role="alert">{error}</p>}
          </div>
          {/* A background file-list failure must not move the active document.
              Keep its alert and retry available after the editor instead. */}
          {liveEditor && sharedFailure}
        </section>
      </div>
    </>
  );
}
