import { useEffect, useRef, useState } from 'react';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { documentPath } from './documentAccess.ts';
import { maintenanceFetch as fetch } from './maintenanceFetch.ts';
import './fileDialog.css';
import './copyFile.css';

export interface CopyOptions {
  name: string;
  parentId: string | null;
  destinations: WorkspaceItem[];
}

/** Shared task content; the editor owns its native dialog and the list its Modal. */
export function CopyFileForm({
  id,
  spaceId,
  unavailable = null,
  canSubmit = () => true,
  onCreated,
  onClose,
  onBusy,
  initialCreated,
  onSettled,
}: {
  id: string;
  spaceId?: string;
  unavailable?: string | null;
  canSubmit?: () => boolean;
  onCreated: (item: WorkspaceItem) => void;
  onClose: () => void;
  onBusy?: (busy: boolean) => void;
  initialCreated?: WorkspaceItem;
  /** Native phone drawers can dismiss an in-flight request; retain its outcome. */
  onSettled?: (result: { item: WorkspaceItem } | { error: string }) => void;
}) {
  const [options, setOptions] = useState<CopyOptions | null>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<WorkspaceItem | null>(initialCreated ?? null);
  const [attempt, retry] = useState(0);
  const submitting = useRef(false);
  const current = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    current.current = true;
    if (initialCreated)
      return () => {
        current.current = false;
      };
    const loading = new AbortController();
    setOptions(null);
    setError('');
    void (async () => {
      const response = await fetch(`${documentPath(id, spaceId)}/copy-options`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: loading.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not load folders. Try again.');
      if (loading.signal.aborted) return;
      setOptions(result);
      setName(result.name);
      setParentId(result.parentId ?? '');
    })().catch((failure) => {
      if (!loading.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Could not load folders. Try again.');
    });
    return () => {
      current.current = false;
      loading.abort();
    };
  }, [id, spaceId, attempt, initialCreated]);
  useEffect(() => {
    if (options) {
      input.current?.focus();
      input.current?.select();
    }
  }, [options]);

  async function submit() {
    if (submitting.current || !options || unavailable || !canSubmit()) return;
    submitting.current = true;
    setBusy(true);
    onBusy?.(true);
    setError('');
    try {
      const response = await fetch(`${documentPath(id, spaceId)}/copy`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), parentId: parentId || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not make a copy. Try again.');
      onSettled?.({ item: result.item });
      if (!current.current) return;
      setCreated(result.item);
      onCreated(result.item);
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : 'Could not make a copy. Try again.';
      onSettled?.({ error: message });
      if (current.current) setError(message);
    } finally {
      submitting.current = false;
      onBusy?.(false);
      if (current.current) {
        setBusy(false);
      }
    }
  }
  const destination = options?.destinations.find((folder) => folder.id === parentId);
  const folderLabel = (folder: WorkspaceItem) => {
    const names = [folder.name];
    const seen = new Set([folder.id]);
    let parent = folder.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = options?.destinations.find((item) => item.id === parent);
      if (!ancestor) break;
      names.unshift(ancestor.name);
      parent = ancestor.parentId;
    }
    return `${names.join(' / ')}${folder.access === 'owner' ? '' : ` · ${folder.ownerName ?? 'Shared folder'}`}`;
  };
  return (
    <form
      className="sp-ui file-dialog copy-file"
      aria-label="Make a copy"
      aria-busy={busy || (!created && !options && !error)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {created ? (
        <>
          <p role="status">Created {created.name}.</p>
          <p>
            {unavailable?.replace('making a copy', 'opening the copy') ??
              'Your copy is ready to open.'}
          </p>
          <div className="copy-file-actions">
            <Button onClick={onClose}>Close</Button>
            <Button primary disabled={Boolean(unavailable)} onClick={() => onCreated(created)}>
              Open copy
            </Button>
          </div>
        </>
      ) : (
        <>
          {options ? (
            <>
              <label>
                Name
                <input
                  ref={input}
                  className="sp-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  required
                  disabled={busy}
                  autoComplete="off"
                />
              </label>
              <label>
                Folder
                <select
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                  disabled={busy}
                >
                  <option value="">My files</option>
                  {options.destinations.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folderLabel(folder)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="copy-file-note">
                {destination
                  ? destination.access === 'owner'
                    ? 'Sharing follows this folder’s access.'
                    : `This copy belongs to ${destination.ownerName ?? 'the folder owner'} and uses this folder’s access. You’ll be shown as its creator.`
                  : 'Only you can open the copy until you share it.'}
              </p>
            </>
          ) : !error ? (
            <p role="status">Loading folders…</p>
          ) : null}
          {unavailable && <p role="status">{unavailable}</p>}
          {error && <p role="alert">{error}</p>}
          <div className="copy-file-actions">
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {!options && error ? (
              <Button primary onClick={() => retry((value) => value + 1)}>
                Try again
              </Button>
            ) : (
              <Button
                primary
                type="submit"
                disabled={busy || !options || !name.trim() || Boolean(unavailable)}
              >
                {busy ? 'Making a copy…' : 'Make a copy'}
              </Button>
            )}
          </div>
        </>
      )}
    </form>
  );
}
