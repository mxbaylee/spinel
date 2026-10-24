import { useLayoutEffect, useRef, useState } from 'react';
import type { ItemAccess, WorkspaceItem } from '../src/shared/workspace.ts';
import { defaultCopyName } from '../src/shared/copy.ts';
import { Modal } from '../src/ui/redesign/Controls.tsx';
import './fileDialog.css';

export interface DuplicateSource {
  id: string;
  name: string;
  kind: 'sheet' | 'doc';
  access: ItemAccess;
  parentId: string | null;
  spaceId?: string;
}

/** Bound the entire response, including its body. Abort only ends our wait, not a committed copy. */
async function responseJson(url: string, init: RequestInit, signal: AbortSignal) {
  const request = new AbortController();
  const stop = () => request.abort(signal.reason);
  signal.addEventListener('abort', stop, { once: true });
  const timeout = setTimeout(() => request.abort(new Error('Request timed out.')), 30_000);
  if (signal.aborted) stop();
  let rejectAbort: () => void = () => {};
  try {
    return await Promise.race([
      (async () => {
        request.signal.throwIfAborted();
        const response = await fetch(url, { ...init, signal: request.signal });
        const data: unknown = await response.json();
        request.signal.throwIfAborted();
        return { response, data };
      })(),
      new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(request.signal.reason);
        request.signal.addEventListener('abort', rejectAbort, { once: true });
        if (request.signal.aborted) rejectAbort();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', stop);
    request.signal.removeEventListener('abort', rejectAbort);
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function ownedFolder(value: unknown): value is WorkspaceItem {
  return (
    object(value) &&
    value.kind === 'folder' &&
    value.access === 'owner' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.parentId === null || typeof value.parentId === 'string')
  );
}
function createdItem(
  value: unknown,
  source: DuplicateSource,
  name: string,
  parentId: string | null,
): value is WorkspaceItem {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    !!value.id &&
    value.id !== source.id &&
    value.kind === source.kind &&
    value.access === 'owner' &&
    value.name === name &&
    value.parentId === parentId &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string')
  );
}

export function DuplicateFile({
  source,
  dirty,
  saveReady,
  onCreated,
  onOpen,
  onCheckDestination,
  onClose,
  finalFocus,
}: {
  source: DuplicateSource;
  dirty: boolean;
  saveReady: boolean;
  onCreated(item: WorkspaceItem): void | Promise<void>;
  onOpen(item: WorkspaceItem): boolean;
  onCheckDestination(parentId: string | null): boolean;
  onClose(): void;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  const [name, setName] = useState(() => defaultCopyName(source.name));
  const [parentId, setParentId] = useState('');
  const [folders, setFolders] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [folderError, setFolderError] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'form' | 'pending' | 'uncertain' | 'created'>('form');
  const [created, setCreated] = useState<WorkspaceItem | null>(null);
  const [finishing, setFinishing] = useState(false);
  const closed = useRef(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  const createdRef = useRef<WorkspaceItem | null>(null);
  const catalog = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const busy = phase === 'pending';
  const current = (revision: number) => generation.current === revision;
  async function loadFolders(revision = generation.current) {
    catalog.current?.abort();
    const controller = new AbortController();
    catalog.current = controller;
    setLoading(true);
    setFolderError('');
    try {
      const { response, data } = await responseJson(
        '/api/items',
        { credentials: 'same-origin' },
        controller.signal,
      );
      if (!current(revision) || controller.signal.aborted) return;
      if (!response.ok || !object(data) || !Array.isArray(data.items)) throw new Error();
      const owned = data.items.filter(ownedFolder);
      setFolders(owned);
      setParentId(
        !source.spaceId &&
          source.access === 'owner' &&
          owned.some((folder) => folder.id === source.parentId)
          ? source.parentId!
          : '',
      );
    } catch {
      if (current(revision) && !controller.signal.aborted)
        setFolderError('Could not load destinations. Try again.');
    } finally {
      if (current(revision) && !controller.signal.aborted) setLoading(false);
    }
  }
  useLayoutEffect(() => {
    const revision = ++generation.current;
    submitting.current = false;
    closed.current = false;
    setFinishing(false);
    createdRef.current = null;
    setCreated(null);
    setPhase('form');
    setError('');
    setName(defaultCopyName(source.name));
    setParentId('');
    setFolders([]);
    void loadFolders(revision);
    return () => {
      generation.current++;
      catalog.current?.abort();
      mutation.current?.abort();
    };
  }, [source.id, source.spaceId, source.access, source.parentId]);
  function close() {
    if (submitting.current || closed.current) return;
    closed.current = true;
    generation.current++;
    catalog.current?.abort();
    mutation.current?.abort();
    onClose();
  }
  function openCopy(item: WorkspaceItem) {
    if (closed.current) return;
    try {
      if (onOpen(item)) close();
    } catch {
      setError('The copy was created, but could not be opened. Try Open copy again.');
    }
  }
  async function submit() {
    if (
      submitting.current ||
      closed.current ||
      createdRef.current ||
      phase !== 'form' ||
      loading ||
      folderError ||
      dirty ||
      !saveReady ||
      !name.trim()
    )
      return;
    submitting.current = true;
    const revision = generation.current;
    const controller = new AbortController();
    mutation.current = controller;
    setPhase('pending');
    setError('');
    const destination = parentId || null;
    const copyName = name.trim();
    const path = source.spaceId
      ? `/api/spaces/${encodeURIComponent(source.spaceId)}/items/${encodeURIComponent(source.id)}/copy`
      : `/api/items/${encodeURIComponent(source.id)}/copy`;
    let item: WorkspaceItem;
    try {
      const { response, data } = await responseJson(
        path,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: copyName, parentId: destination }),
        },
        controller.signal,
      );
      if (!current(revision) || controller.signal.aborted) return;
      if (
        [400, 401, 403, 404, 409, 413, 422, 429].includes(response.status) &&
        object(data) &&
        typeof data.error === 'string'
      ) {
        setError(data.error);
        setPhase('form');
        return;
      }
      if (!response.ok || !object(data) || !createdItem(data.item, source, copyName, destination))
        throw new Error();
      item = data.item;
      // Retain confirmed success before invoking any navigation or inventory callback.
      createdRef.current = item;
      setCreated(item);
      setPhase('created');
    } catch {
      if (current(revision) && !controller.signal.aborted) setPhase('uncertain');
      return;
    } finally {
      if (current(revision)) submitting.current = false;
    }
    if (!current(revision)) return;
    setFinishing(true);
    try {
      await onCreated(item);
    } catch {
      if (current(revision))
        setError(
          'The copy was created, but the file list could not refresh. You can still open the copy.',
        );
      return;
    } finally {
      if (current(revision)) setFinishing(false);
    }
    if (current(revision)) openCopy(item);
  }
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  function folderName(folder: WorkspaceItem) {
    const labels: string[] = [];
    const visited = new Set<string>();
    let next: WorkspaceItem | undefined = folder;
    while (next && !visited.has(next.id)) {
      visited.add(next.id);
      labels.unshift(next.name);
      next = next.parentId ? byId.get(next.parentId) : undefined;
    }
    return labels.join(' / ');
  }
  const destinationName =
    parentId && byId.has(parentId) ? folderName(byId.get(parentId)!) : 'My files';
  const locked = busy || phase === 'uncertain' || phase === 'created';
  return (
    <Modal
      title="Duplicate file"
      icon={source.kind}
      open
      finalFocus={finalFocus}
      dismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <div className="file-dialog">
        <p>
          Make a copy of {source.name}. The copy belongs to you. The original’s sharing and guest
          link are not copied.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Name
            <input
              autoFocus
              maxLength={120}
              required
              value={name}
              disabled={locked}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
            />
          </label>
          <label>
            Destination
            <select
              value={parentId}
              disabled={locked || loading || !!folderError}
              onChange={(event) => {
                setParentId(event.target.value);
                setError('');
              }}
            >
              <option value="">My files</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folderName(folder)}
                </option>
              ))}
            </select>
          </label>
          {parentId && <p>People with access to the destination folder may also have access.</p>}
          {loading && <p role="status">Loading destinations…</p>}
          {folderError && (
            <div>
              <p role="alert">{folderError}</p>
              <button type="button" onClick={() => void loadFolders()}>
                Try again
              </button>
            </div>
          )}
          {phase === 'form' && (dirty || !saveReady) && (
            <p role="status">Wait for the original’s changes to be saved before making a copy.</p>
          )}
          {busy && <p role="status">Making copy…</p>}
          {phase === 'uncertain' && (
            <p role="alert">
              Could not confirm whether the copy was created. Check {destinationName} before trying
              again.
            </p>
          )}
          {created && (
            <p role="status">
              Created {created.name} in {destinationName}. Open the copy when you’re ready.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="item-actions">
            {phase === 'form' || busy ? (
              <button
                className="primary"
                disabled={busy || loading || !!folderError || dirty || !saveReady || !name.trim()}
              >
                Duplicate
              </button>
            ) : null}
            {phase === 'uncertain' && (
              <button
                type="button"
                onClick={() => {
                  try {
                    if (onCheckDestination(parentId || null)) close();
                  } catch {
                    setError(
                      'Could not open the destination. Close this dialog and check your files.',
                    );
                  }
                }}
              >
                Check destination
              </button>
            )}
            {created && (
              <button
                className="primary"
                type="button"
                disabled={finishing}
                onClick={() => openCopy(created)}
              >
                Open copy
              </button>
            )}
            <button type="button" disabled={busy} onClick={close}>
              {locked ? 'Close' : 'Cancel'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
