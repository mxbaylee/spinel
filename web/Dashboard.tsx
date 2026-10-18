import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ITEM_KINDS, kindLabel } from '../src/shared/workspace.ts';
import type { ItemKind, WorkspaceItem } from '../src/shared/workspace.ts';

import { Sharing } from './Sharing.tsx';
import { Trash } from './Trash.tsx';
import { DocumentTags, TagLabels } from './DocumentTags.tsx';
import { itemsRequest } from './itemsApi.ts';
import { PinButton, usePins } from './Pins.tsx';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import { ImportFile } from './ImportFile.tsx';
import type { NavigationGuard } from './navigation.ts';
const SheetEditor = lazy(() =>
  import('./SheetEditor.tsx').then((module) => ({ default: module.SheetEditor })),
);

type Action = { mode: 'new' | 'rename' | 'move'; item?: WorkspaceItem };
const TRASH_VIEW = 'trash';
const selectedId = () => {
  const query = new URLSearchParams(location.search);
  return query.has('trash') ? TRASH_VIEW : query.get('item');
};
const viewUrl = (id: string | null) =>
  id === TRASH_VIEW ? '/?trash=1' : id ? `/?item=${encodeURIComponent(id)}` : '/';

const DocEditor = lazy(() => import('./DocEditor.tsx').then((m) => ({ default: m.DocEditor })));

export function Dashboard({ navigation }: { navigation: NavigationGuard }) {
  const dropTarget = useRef<HTMLElement>(null);
  const pins = usePins();
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
  useEffect(() => {
    void itemsRequest<{ items: WorkspaceItem[] }>()
      .then((result) => {
        setItems(result.items);
        setLoaded(true);
      })
      .catch((failure) => setError(failure.message));
    const back = () => {
      if (!navigation.allow()) {
        history.pushState(null, '', viewUrl(currentRef.current));
        return;
      }
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
    if (!currentId || currentId === TRASH_VIEW) {
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
        if (!disposed) setViewed([...result.ancestors, result.item, ...result.children]);
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
    void pins.refresh();
  }, [items, viewed]);
  const byId = new Map([...items, ...viewed].map((item) => [item.id, item]));
  const current = currentId && !viewMissing ? byId.get(currentId) : undefined;
  const visibleItems = currentId ? viewed : items;
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
    setDestination(item?.parentId ?? '');
    setError('');
  }
  async function submit() {
    if (!action) return;
    setBusy(true);
    setError('');
    try {
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
  function actions(item: WorkspaceItem) {
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
      <div className="dashboard">
        <aside aria-label="Folders">
          <button disabled={busy} onClick={() => navigate(null)}>
            All my files
          </button>
          <button
            disabled={busy}
            aria-current={currentId === TRASH_VIEW ? 'page' : undefined}
            onClick={() => navigate(TRASH_VIEW)}
          >
            Trash
          </button>
          <ul className="folder-tree">
            {folders.map(({ item, path }) => (
              <li key={item.id} style={{ paddingLeft: Math.min(path.length - 1, 8) * 12 }}>
                <button
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
                {current && actions(current)}
                {current && <TagLabels tags={current.tags} />}
              </div>
              {!current || current.kind === 'folder' ? (
                <>
                  {(!current || current.access === 'owner') && (
                    <button className="primary" disabled={busy} onClick={() => edit('new')}>
                      New
                    </button>
                  )}
                  {current && (
                    <button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
                      Refresh folder
                    </button>
                  )}
                  {(!current || current.access === 'owner') && (
                    <ImportFile
                      key={currentId ?? 'root'}
                      parentId={currentId}
                      dropTarget={dropTarget}
                      onImported={(item) => {
                        setItems((previous) => [...previous, item]);
                        setViewed((previous) => [...previous, item]);
                        setRefresh((value) => value + 1);
                      }}
                    />
                  )}
                  <ul className="file-list">
                    {visibleItems
                      .filter((item) => item.parentId === currentId)
                      .sort(
                        (a, b) =>
                          Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
                          a.name.localeCompare(b.name) ||
                          a.id.localeCompare(b.id),
                      )
                      .map((item) => (
                        <li key={item.id}>
                          <button
                            className="item-open"
                            disabled={busy}
                            onClick={() => navigate(item.id)}
                          >
                            {item.name} <span className="item-kind">{kindLabel[item.kind]}</span>
                          </button>
                          {actions(item)}
                          <TagLabels tags={item.tags} />
                        </li>
                      ))}
                  </ul>
                  {!visibleItems.some((item) => item.parentId === currentId) && (
                    <p className="empty-state">
                      <GemLogo size={52} />
                      This folder is empty.
                      {(!current || current.access === 'owner') &&
                        ' Choose New to add a folder or document.'}
                    </p>
                  )}
                </>
              ) : current.kind === 'sheet' ? (
                <Suspense fallback={<p role="status">Loading spreadsheet…</p>}>
                  <SheetEditor
                    key={current.id}
                    id={current.id}
                    name={current.name}
                    onDirty={navigation.dirty}
                  />
                </Suspense>
              ) : current.kind === 'doc' ? (
                <Suspense fallback={<p role="status">Loading document…</p>}>
                  <DocEditor
                    key={current.id}
                    id={current.id}
                    name={current.name}
                    onDirty={navigation.dirty}
                  />
                </Suspense>
              ) : (
                <section
                  className="empty-document"
                  aria-label={`${kindLabel[current.kind]} document`}
                >
                  <p>{kindLabel[current.kind]} · Empty document</p>
                  <p>This document is saved here. Editing is coming in a later update.</p>
                </section>
              )}
            </>
          )}
          {action && (
            <form
              className="item-form"
              aria-label={`${action.mode === 'new' ? 'New item' : action.mode === 'move' ? 'Move item' : 'Rename item'}`}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <h3>
                {action.mode === 'new'
                  ? 'New item'
                  : `${action.mode === 'rename' ? 'Rename' : 'Move'} ${action.item!.name}`}
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
              {action.mode !== 'move' ? (
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
                  disabled={busy || (action.mode !== 'move' && !name.trim())}
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
          {sharing && <Sharing key={sharing.id} item={sharing} onClose={() => setSharing(null)} />}
          {error && <p role="alert">{error}</p>}
        </section>
      </div>
    </>
  );
}
