import { canAdminister } from '../src/shared/workspace.ts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileItem, SpaceFile, WorkspaceItem } from '../src/shared/workspace.ts';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { itemsRequest } from './itemsApi.ts';
import { Sharing } from './Sharing.tsx';
import './spaceRootActions.css';

export type SpaceRootActionMode = 'share' | 'rename' | 'move' | 'trash';
type Mode = SpaceRootActionMode;

/** Account-only actions for the outer file; the Space tree never owns these controls. */
export function SpaceRootActions({
  item,
  folders,
  onChanged,
  onTrashed,
  beforeChange,
  initialMode,
  onClose,
}: {
  item: SpaceFile;
  folders?: WorkspaceItem[];
  onChanged: (item: SpaceFile) => void;
  onTrashed: () => void;
  beforeChange?: () => boolean;
  /** A dashboard row's single menu can open this existing action controller. */
  initialMode?: Mode;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [name, setName] = useState(item.name);
  const [destination, setDestination] = useState(item.parentId ?? '');
  const [available, setAvailable] = useState<WorkspaceItem[]>(folders ?? []);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useLayoutEffect(() => {
    generation.current++;
    setMode(null);
    setLoading(false);
    setBusy(false);
    setError('');
    return () => {
      generation.current++;
    };
  }, [item.id, item.access]);
  function currentCheck(request: number) {
    return () => {
      if (request !== generation.current)
        throw new Error('This Space action is no longer current.');
    };
  }
  function close() {
    generation.current++;
    setMode(null);
    setLoading(false);
    onClose?.();
  }
  async function open(next: Mode) {
    if (beforeChange && !beforeChange()) {
      // External row actions mount once per activation; release a cancelled one
      // so retrying the same action runs the navigation guard again.
      if (initialMode) close();
      return;
    }
    const request = ++generation.current;
    setMode(next);
    setName(item.name);
    setDestination(item.parentId ?? '');
    setError('');
    setLoading(false);
    if (next !== 'move') return;
    if (folders && item.access === 'owner') {
      setAvailable(folders);
      return;
    }
    setLoading(true);
    try {
      const result = await itemsRequest<{ items: FileItem[] }>(
        item.access === 'owner' ? '' : `/${item.id}/destinations`,
        'GET',
        undefined,
        currentCheck(request),
      );
      if (request === generation.current)
        setAvailable(
          result.items.filter(
            (entry): entry is WorkspaceItem =>
              entry.kind === 'folder' && canAdminister(entry.access),
          ),
        );
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not load your folders.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  async function save() {
    if (busy || (mode !== 'rename' && mode !== 'move' && mode !== 'trash')) return;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      if (mode === 'trash') {
        await itemsRequest(`/${item.id}/trash`, 'POST', {}, currentCheck(request));
        // Browser navigation can replace this root while its mutation completes.
        // Its server result stands, but it must not clear the next editor's guard.
        if (request !== generation.current) return;
        setMode(null);
        onTrashed();
      } else {
        const result = await itemsRequest<{ item: FileItem }>(
          `/${item.id}`,
          'PATCH',
          mode === 'rename' ? { name } : { parentId: destination || null },
          currentCheck(request),
        );
        if (request !== generation.current) return;
        if (result.item.kind !== 'space' || result.item.id !== item.id)
          throw new Error('The Space could not be updated. Refresh and try again.');
        setMode(null);
        onChanged(result.item);
      }
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not update the Space. Try again.');
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  const owned = available.filter((entry) => entry.kind === 'folder' && canAdminister(entry.access));
  useEffect(() => {
    if (initialMode) void open(initialMode);
  }, []);
  const byId = new Map(owned.map((folder) => [folder.id, folder]));
  const path = (folder: WorkspaceItem) => {
    const names: string[] = [];
    const seen = new Set<string>();
    let next: WorkspaceItem | undefined = folder;
    while (next && !seen.has(next.id)) {
      seen.add(next.id);
      names.unshift(next.name);
      next = next.parentId ? byId.get(next.parentId) : undefined;
    }
    return names.join(' / ');
  };
  if (!canAdminister(item.access)) return null;
  return (
    <>
      {!initialMode && (
        <ActionMenu
          label={`Space actions for ${item.name}`}
          actions={[
            {
              label: 'Share',
              icon: <ProfileIcon icon="lucide:share-2" size={16} />,
              onClick: () => void open('share'),
              disabled: busy,
            },
            {
              label: 'Rename',
              icon: <ProfileIcon icon="lucide:pencil" size={16} />,
              onClick: () => void open('rename'),
              disabled: busy,
            },
            {
              label: 'Move',
              icon: <ProfileIcon icon="lucide:folder-input" size={16} />,
              onClick: () => void open('move'),
              disabled: busy,
            },
            {
              label: 'Move to Trash',
              icon: <ProfileIcon icon="lucide:trash-2" size={16} />,
              onClick: () => void open('trash'),
              destructive: true,
              disabled: busy,
            },
          ]}
        />
      )}
      {mode && (
        <Modal
          open
          title={
            mode === 'share'
              ? `Share ${item.name}`
              : mode === 'rename'
                ? 'Rename Space'
                : mode === 'move'
                  ? 'Move Space'
                  : 'Move Space to Trash?'
          }
          icon={mode === 'trash' ? 'trash' : mode === 'share' ? 'share' : 'space'}
          dismissDisabled={busy}
          onOpenChange={(value) => {
            if (!value) close();
          }}
        >
          <div className="space-root-actions">
            {mode === 'share' ? (
              <Sharing item={item} onClose={close} />
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                {mode === 'rename' ? (
                  <label>
                    Name
                    <input
                      autoFocus
                      required
                      maxLength={120}
                      value={name}
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                ) : mode === 'move' ? (
                  <>
                    <p>
                      Move the whole Space to an authorized folder belonging to its Owner. Its pages
                      stay together.
                    </p>
                    {loading ? (
                      <p role="status">Loading your folders…</p>
                    ) : (
                      <label>
                        Destination
                        <select
                          value={destination}
                          disabled={busy || (item.access === 'admin' && owned.length === 0)}
                          onChange={(event) => setDestination(event.target.value)}
                        >
                          {item.access === 'owner' ? (
                            <option value="">My files</option>
                          ) : (
                            <option value="" disabled>
                              Choose a folder
                            </option>
                          )}
                          {owned
                            .map((folder) => ({ folder, name: path(folder) }))
                            .sort(
                              (a, b) =>
                                a.name.localeCompare(b.name) ||
                                a.folder.id.localeCompare(b.folder.id),
                            )
                            .map(({ folder, name }) => (
                              <option key={folder.id} value={folder.id}>
                                {name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {!loading && item.access === 'admin' && owned.length === 0 && (
                      <p role="status">
                        No authorized folders are available. Ask the Owner to grant File admin
                        access to a destination folder.
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    {item.name} and all its pages will become unavailable to collaborators and
                    guests. Its Owner can restore the whole Space from My files → Trash. Pages
                    already in the Space’s Trash stay there. The Space will be kept until its Owner
                    explicitly deletes it permanently.
                  </p>
                )}
                {error && <p role="alert">{error}</p>}
                <div className="item-actions">
                  <Button
                    type="submit"
                    primary
                    disabled={
                      busy ||
                      loading ||
                      (mode === 'rename' && !name.trim()) ||
                      (mode === 'move' &&
                        item.access !== 'owner' &&
                        !owned.some((folder) => folder.id === destination))
                    }
                  >
                    {busy ? 'Saving…' : mode === 'trash' ? 'Move Space to Trash' : 'Save'}
                  </Button>
                  <Button type="button" disabled={busy} onClick={close}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
