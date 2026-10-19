import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { kindLabel } from '../src/shared/workspace.ts';
import type { NavigationGuard } from './navigation.ts';
import { itemsRequest } from './itemsApi.ts';
import { TagLabels } from './DocumentTags.tsx';
import { SharedBadge } from './SharedItems.tsx';

type PinsState = {
  items: WorkspaceItem[];
  loaded: boolean;
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  change: (id: string, remove: boolean) => Promise<void>;
  reorder: (id: string, beforeId: string | null) => Promise<void>;
};
const PinsContext = createContext<PinsState | null>(null);
export function usePins() {
  const pins = useContext(PinsContext);
  if (!pins) throw new Error('Pins need a workspace provider.');
  return pins;
}
/** `offline` is local mode's saved pin list: shown read-only, with no requests. */
export function PinsProvider({
  children,
  enabled,
  offline,
}: {
  children: ReactNode;
  enabled: boolean;
  offline?: WorkspaceItem[];
}) {
  const [items, setItems] = useState<WorkspaceItem[]>(offline ?? []);
  const [loaded, setLoaded] = useState(Boolean(offline));
  // Busy disables every pin control, so local mode can't attempt a change.
  const [busy, setBusy] = useState(Boolean(offline));
  const [error, setError] = useState('');
  const mounted = useRef(false),
    generation = useRef(0),
    mutating = useRef(false);
  async function refresh() {
    if (mutating.current || offline) return;
    const request = ++generation.current;
    try {
      const result = await itemsRequest<{ items: WorkspaceItem[] }>('/pins');
      if (mounted.current && request === generation.current) {
        setItems(result.items);
        setError('');
      }
    } catch (cause) {
      if (mounted.current && request === generation.current) {
        setItems([]);
        setError(cause instanceof Error ? cause.message : 'Could not load pins.');
      }
    } finally {
      if (mounted.current && request === generation.current) setLoaded(true);
    }
  }
  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    void refresh();
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(visible, 15_000);
    return () => {
      mounted.current = false;
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled]);
  async function mutate(path: string, method: string, body: unknown) {
    if (mutating.current || offline) return;
    mutating.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      const result = await itemsRequest<{ items: WorkspaceItem[] }>(path, method, body);
      if (mounted.current) setItems(result.items);
    } catch (cause) {
      // Reconcile stale ordering/access before permitting another operation.
      const message = cause instanceof Error ? cause.message : 'Could not update pins.';
      mutating.current = false;
      await refresh();
      if (mounted.current) setError(message);
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <PinsContext.Provider
      value={{
        items,
        loaded,
        busy,
        error,
        refresh,
        change: (id, remove) => mutate('/pins', remove ? 'DELETE' : 'POST', { id }),
        reorder: (id, beforeId) => mutate('/pins', 'PUT', { id, beforeId }),
      }}
    >
      {children}
    </PinsContext.Provider>
  );
}
export function PinButton({ item }: { item: WorkspaceItem }) {
  const pins = usePins();
  const pinned = pins.items.some((entry) => entry.id === item.id);
  return (
    <button
      disabled={pins.busy || !pins.loaded || Boolean(pins.error)}
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${item.name}`}
      onClick={() => void pins.change(item.id, pinned)}
    >
      {pinned ? 'Unpin' : 'Pin'}
    </button>
  );
}
export function PinnedSidebar({ navigation }: { navigation: NavigationGuard }) {
  const pins = usePins();
  const dragging = useRef<string | null>(null);
  function move(id: string, target: number) {
    const ids = pins.items.map((item) => item.id),
      from = ids.indexOf(id);
    if (pins.busy || from < 0 || target < 0 || target >= ids.length || from === target) return;
    ids.splice(from, 1);
    ids.splice(target, 0, id);
    void pins.reorder(id, ids[target + 1] ?? null);
  }
  return (
    <aside className="pinned-sidebar" aria-label="Pinned items">
      <h2>Pinned</h2>
      {!pins.loaded && <p role="status">Loading pins…</p>}
      {pins.loaded && !pins.items.length && !pins.error && (
        <p>Pin documents or folders to keep them here.</p>
      )}
      {pins.error && (
        <p role="alert">
          {pins.error}{' '}
          <button disabled={pins.busy} onClick={() => void pins.refresh()}>
            Refresh pins
          </button>
        </p>
      )}
      <ol aria-label="Pin order">
        {pins.items.map((item, index) => (
          <li
            key={item.id}
            onDragOver={(event) => {
              if (dragging.current && !pins.busy) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging.current) move(dragging.current, index);
              dragging.current = null;
            }}
          >
            <button
              className="pin-drag"
              draggable={!pins.busy}
              disabled={pins.busy}
              aria-label={`Drag ${item.name} to reorder`}
              onDragStart={(event) => {
                dragging.current = item.id;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', item.id);
              }}
              onDragEnd={() => {
                dragging.current = null;
              }}
            >
              ↕
            </button>
            <a
              href={`/?item=${encodeURIComponent(item.id)}`}
              onClick={(event) => {
                if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !navigation.allow())
                  event.preventDefault();
              }}
            >
              {item.name} <small>{kindLabel[item.kind]}</small>
            </a>
            <SharedBadge item={item} />
            <TagLabels tags={item.tags} />
            <div className="pin-actions">
              <button
                disabled={pins.busy || index === 0}
                aria-label={`Move ${item.name} up`}
                onClick={() => move(item.id, index - 1)}
              >
                ↑
              </button>
              <button
                disabled={pins.busy || index === pins.items.length - 1}
                aria-label={`Move ${item.name} down`}
                onClick={() => move(item.id, index + 1)}
              >
                ↓
              </button>
              <button
                disabled={pins.busy}
                aria-label={`Unpin ${item.name} from sidebar`}
                onClick={() => void pins.change(item.id, true)}
              >
                Unpin
              </button>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
