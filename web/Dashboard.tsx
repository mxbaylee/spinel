import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ITEM_KINDS, kindLabel } from '../src/shared/workspace.ts';
import type { ItemKind, WorkspaceItem } from '../src/shared/workspace.ts';

import { Sharing } from './Sharing.tsx';
import { SearchPanel } from './SearchPanel.tsx';
import { emptySearch, hasSearch } from '../src/shared/search.ts';
import type { SearchQuery } from '../src/shared/search.ts';
import { Trash } from './Trash.tsx';
import { DocumentTags, TagLabels } from './DocumentTags.tsx';
import { itemsRequest } from './itemsApi.ts';
import { PinButton, usePins } from './Pins.tsx';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import { ImportFile } from './ImportFile.tsx';
import { SharedBadge, useSharedItems } from './SharedItems.tsx';
import type { NavigationGuard } from './navigation.ts';
import { OfflineBadge, OfflineBanner } from './OfflineStatus.tsx';
import type { LocalStart } from './offline/localStart.ts';
import type { OfflineCatalog, OfflineUser } from './offline/offlineStore.ts';
import { useOfflineDownloads } from './offline/useOfflineDownloads.ts';
const SheetEditor = lazy(() =>
  import('./SheetEditor.tsx').then((module) => ({ default: module.SheetEditor })),
);

type Action = { mode: 'new' | 'rename' | 'move' | 'file'; item?: WorkspaceItem };
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
const offlineKinds = new Set<ItemKind>(['sheet', 'doc']);

/**
 * The file list and the open item. With `local` set, Spinel started without a
 * network: everything comes from the last-synced catalog on this device, only
 * downloaded documents open (read-only), and nothing reaches the server.
 */
export function Dashboard({
  navigation,
  user,
  local,
}: {
  navigation: NavigationGuard;
  user: OfflineUser;
  local?: LocalStart | null;
}) {
  const dropTarget = useRef<HTMLElement>(null);
  const [query, setQuery] = useState<SearchQuery>({ ...emptySearch });
  const searchActive = hasSearch(query);
  const pins = usePins();
  const shared = useSharedItems(local?.catalog.shared);
  const [sharedOpen, setSharedOpen] = useState(false);
  const draggingShared = useRef<string | null>(null);
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewed, setViewed] = useState<WorkspaceItem[]>([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewMissing, setViewMissing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sharing, setSharing] = useState<WorkspaceItem | null>(null);
  const [tagging, setTagging] = useState<WorkspaceItem | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(selectedId);
  const currentRef = useRef(currentId);
  currentRef.current = currentId;
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ItemKind>('folder');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncedAt, setSyncedAt] = useState(local?.catalog.syncedAt ?? 0);
  // The last-loaded view for each opened folder or item, kept for offline launch.
  const views = useRef<Record<string, WorkspaceItem[]>>({ ...local?.catalog.views });
  const catalog = (): OfflineCatalog | null =>
    loaded && shared.loaded && pins.loaded && !pins.error
      ? { syncedAt, items, shared: shared.items, pins: pins.items, views: views.current }
      : null;
  const offline = useOfflineDownloads(user, local, catalog);
  useEffect(() => {
    if (local) {
      setItems(local.catalog.items);
      setLoaded(true);
    } else
      void itemsRequest<{ items: WorkspaceItem[] }>()
        .then((result) => {
          setItems(result.items);
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
      item: WorkspaceItem;
      children: WorkspaceItem[];
      ancestors: WorkspaceItem[];
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
    if (!local) void pins.refresh();
  }, [items, viewed]);
  useEffect(() => {
    const current = catalog();
    if (current && !local) void offline.saveCatalog(current).catch(() => {});
  }, [items, shared.items, pins.items, viewed, offline.downloads]);
  // Offline, any item from a saved view can be opened by its stable link.
  const known = local ? Object.values(views.current).flat() : [];
  const byId = new Map(
    [...known, ...items, ...shared.items, ...viewed].map((item) => [item.id, item]),
  );
  const current = currentId && !viewMissing ? byId.get(currentId) : undefined;
  const personalFolder = !currentId || (current?.kind === 'folder' && current.access === 'owner');
  const visibleItems = personalFolder
    ? [
        ...(currentId ? viewed : items).filter(
          (item) => item.access === 'owner' && item.parentId === currentId,
        ),
        ...shared.items.filter((item) => item.placementParentId === currentId),
      ]
    : viewed.filter((item) => item.parentId === currentId);
  function ancestors(item?: WorkspaceItem) {
    const path: WorkspaceItem[] = [];
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
  const children = new Map<string | null, WorkspaceItem[]>();
  for (const item of items.filter((item) => item.kind === 'folder')) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const folders: { item: WorkspaceItem; path: WorkspaceItem[] }[] = [];
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
  function edit(mode: Action['mode'], item?: WorkspaceItem) {
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
      const { item } = await itemsRequest<{ item: WorkspaceItem }>(
        action.mode === 'new' ? '' : `/${action.item!.id}`,
        action.mode === 'new' ? 'POST' : 'PATCH',
        action.mode === 'new'
          ? { name, kind, parentId: currentId }
          : action.mode === 'rename'
            ? { name }
            : { parentId: destination || null },
      );
      setItems((previous) => [...previous.filter((entry) => entry.id !== item.id), item]);
      setViewed((previous) => [...previous.filter((entry) => entry.id !== item.id), item]);
      setAction(null);
      if (action.mode === 'new' && item.kind !== 'folder') navigate(item.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function reloadItems() {
    const result = await itemsRequest<{ items: WorkspaceItem[] }>();
    setItems(result.items);
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
  function dragShared(item: WorkspaceItem) {
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
  async function trashItem(item: WorkspaceItem) {
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
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not move to trash. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function offlineState(item: WorkspaceItem) {
    if (offline.downloads.has(item.id)) return 'available';
    return local && offlineKinds.has(item.kind) ? 'needs-connection' : null;
  }
  function offlineToggle(item: WorkspaceItem) {
    if (!offlineKinds.has(item.kind)) return null;
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
  function actions(item: WorkspaceItem) {
    // Local mode is read-only: nothing here may reach the server.
    if (local)
      return item.access === 'owner' ? null : (
        <span className="item-actions">
          <span>{item.access === 'editor' ? 'Can edit' : 'View only'}</span>
        </span>
      );
    const tagButton = item.kind !== 'folder' && (
      <button disabled={busy} onClick={() => setTagging(item)} aria-label={`Tags ${item.name}`}>
        Tags
      </button>
    );
    if (item.access !== 'owner')
      return (
        <span className="item-actions">
          <span>{item.access === 'editor' ? 'Can edit' : 'View only'}</span>
          <PinButton item={item} />
          {tagButton}
          {offlineToggle(item)}
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
        </span>
      );
    return (
      <span className="item-actions">
        <PinButton item={item} />
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
  return (
    <>
      <p className="eyebrow">Your workspace</p>
      <h1>Dashboard</h1>
      {local && <OfflineBanner syncedAt={syncedAt} />}
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
              query={query}
              onChange={setQuery}
              loadedItems={[
                ...items,
                ...viewed.filter((item) => item.access === 'owner'),
                ...shared.items,
              ]}
              onOpen={navigate}
            />
          )}
          {offline.message && (
            <p role={offline.message.failed ? 'alert' : 'status'}>{offline.message.text}</p>
          )}
          {shared.error && (
            <p role="alert">
              {shared.error}{' '}
              <button onClick={() => void shared.refresh()}>Refresh shared items</button>
            </p>
          )}
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
                      onClick={() => navigate(item.id)}
                    >
                      {item.name} <span className="item-kind">{kindLabel[item.kind]}</span>
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
                    onClick={() => navigate(item.id)}
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
                  <h2>{current?.name ?? 'My files'}</h2>
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
                              onClick={() => navigate(item.id)}
                            >
                              {item.name} <span className="item-kind">{kindLabel[item.kind]}</span>
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
                            ' Choose New to add a folder or document.'}
                        </p>
                      )
                    )}
                  </>
                ) : local && offlineKinds.has(current.kind) ? (
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
                      onDirty={navigation.dirty}
                    />
                  </Suspense>
                ) : (
                  <Suspense fallback={<p role="status">Loading document…</p>}>
                    <DocEditor
                      key={current.id}
                      id={current.id}
                      name={current.name}
                      onDirty={navigation.dirty}
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
                    <select
                      value={kind}
                      disabled={busy}
                      onChange={(event) => setKind(event.target.value as ItemKind)}
                    >
                      {ITEM_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kindLabel[kind]}
                        </option>
                      ))}
                    </select>
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
                      disabled={busy}
                      onChange={(event) => setDestination(event.target.value)}
                    >
                      <option value="">My files</option>
                      {folders
                        .filter(({ path }) => !path.some((item) => item.id === action.item!.id))
                        .map(({ item, path }) => (
                          <option key={item.id} value={item.id}>
                            {path.map((entry) => entry.name).join(' / ')}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <div className="item-actions">
                  <button
                    className="primary"
                    disabled={
                      busy || (action.mode !== 'move' && action.mode !== 'file' && !name.trim())
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
        </section>
      </div>
    </>
  );
}
