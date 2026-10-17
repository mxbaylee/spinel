import { useEffect, useState } from 'react';
import { ITEM_KINDS, kindLabel } from '../src/shared/workspace.ts';
import type { ItemKind, WorkspaceItem } from '../src/shared/workspace.ts';

type Action = { mode: 'new' | 'rename' | 'move'; item?: WorkspaceItem };
async function itemsRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/items${path}`, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 401) location.assign('/sign-in');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Could not load your items. Try again.');
  return result;
}
const selectedId = () => new URLSearchParams(location.search).get('item');

export function Dashboard() {
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(selectedId);
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
      setCurrentId(selectedId());
      setAction(null);
      setError('');
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  const byId = new Map(items.map((item) => [item.id, item]));
  const current = currentId ? byId.get(currentId) : undefined;
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
  const folders = items
    .filter((item) => item.kind === 'folder')
    .map((item) => ({ item, path: ancestors(item) }))
    .sort(
      (a, b) =>
        a.path
          .map((item) => item.name)
          .join('/')
          .localeCompare(b.path.map((item) => item.name).join('/')) ||
        a.item.id.localeCompare(b.item.id),
    );
  function navigate(id: string | null) {
    history.pushState(null, '', id ? `/?item=${encodeURIComponent(id)}` : '/');
    setCurrentId(id);
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
      setAction(null);
      if (action.mode === 'new' && item.kind !== 'folder') navigate(item.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function actions(item: WorkspaceItem) {
    return (
      <span className="item-actions">
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
        <section className="files" aria-label="Your files">
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
          {!loaded ? (
            <p role="status">
              {error
                ? 'Your files could not be loaded. Reload to try again.'
                : 'Loading your files…'}
            </p>
          ) : currentId && !current ? (
            <p role="alert">This item is not available. Choose My files to continue.</p>
          ) : (
            <>
              <div className="folder-heading">
                <h2>{current?.name ?? 'My files'}</h2>
                {current && actions(current)}
              </div>
              {!current || current.kind === 'folder' ? (
                <>
                  <button className="primary" disabled={busy} onClick={() => edit('new')}>
                    New
                  </button>
                  <ul className="file-list">
                    {items
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
                        </li>
                      ))}
                  </ul>
                  {!items.some((item) => item.parentId === currentId) && (
                    <p>This folder is empty. Choose New to add a folder or document.</p>
                  )}
                </>
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
          {error && <p role="alert">{error}</p>}
        </section>
      </div>
    </>
  );
}
