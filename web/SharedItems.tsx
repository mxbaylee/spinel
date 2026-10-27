import { useEffect, useRef, useState } from 'react';
import type { FileItem } from '../src/shared/workspace.ts';
import { itemsRequest } from './itemsApi.ts';

export function SharedBadge({ item }: { item: FileItem }) {
  return item.access !== 'owner' ? (
    <>
      <span className="shared-badge">Shared</span>{' '}
      <span className="shared-owner">{item.ownerName ?? 'Owner'}</span>
    </>
  ) : null;
}

/** Items shared with this account. `offline` is local mode's saved list: read only, no requests. */
export function useSharedItems(offline?: FileItem[]) {
  const [items, setItems] = useState<FileItem[]>(offline ?? []),
    [loaded, setLoaded] = useState(Boolean(offline)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const mounted = useRef(false),
    generation = useRef(0),
    mutating = useRef(false);
  async function refresh() {
    if (mutating.current) return;
    const request = ++generation.current;
    try {
      const result = await itemsRequest<{ items: FileItem[] }>('/shared');
      if (mounted.current && request === generation.current) {
        setItems(result.items);
        setError('');
        setLoaded(true);
      }
    } catch (cause) {
      if (mounted.current && request === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Could not refresh shared items.');
        setLoaded(true);
      }
    }
  }
  useEffect(() => {
    if (offline) return;
    mounted.current = true;
    void refresh();
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('focus', visible);
    window.addEventListener('spinel-appearance-changed', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(visible, 5000);
    return () => {
      mounted.current = false;
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', visible);
      window.removeEventListener('spinel-appearance-changed', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  async function place(id: string, parentId: string | null, remove = false): Promise<boolean> {
    if (mutating.current || offline) return false;
    mutating.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      const result = await itemsRequest<{ items: FileItem[] }>(
        `/${id}/placement`,
        remove ? 'DELETE' : 'PUT',
        remove ? {} : { parentId },
      );
      if (mounted.current) setItems(result.items);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not update your folder.';
      mutating.current = false;
      await refresh();
      if (mounted.current) setError(message);
      return false;
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { items, loaded, busy, error, refresh, place };
}
