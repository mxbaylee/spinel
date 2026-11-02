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

export type CopyOutcome = { item: WorkspaceItem } | { error: string; uncertain?: boolean };

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
  initialUncertain,
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
  initialUncertain?: string;
  /** Native phone drawers can dismiss an in-flight request; retain its outcome. */
  onSettled?: (result: CopyOutcome) => void;
}) {
  const [options, setOptions] = useState<CopyOptions | null>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(initialUncertain ?? '');
  const [created, setCreated] = useState<WorkspaceItem | null>(initialCreated ?? null);
  const [attempt, retry] = useState(0);
  const submitting = useRef(false);
  const current = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    current.current = true;
    if (initialCreated || initialUncertain)
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
  }, [id, spaceId, attempt, initialCreated, initialUncertain]);
  useEffect(() => {
    if (options) {
      input.current?.focus();
      input.current?.select();
    }
  }, [options]);

  async function submit() {
    if (submitting.current || uncertain || !options || unavailable || !canSubmit()) return;
    submitting.current = true;
    setBusy(true);
    onBusy?.(true);
    setError('');
    let refused = false;
    let receipt: WorkspaceItem | undefined;
    const destinationName =
      options.destinations.find((folder) => folder.id === parentId)?.name ?? 'My files';
    const unknown = `We could not confirm whether “${name.trim()}” was created. Check ${destinationName} before making another copy.`;
    try {
      const response = await fetch(`${documentPath(id, spaceId)}/copy`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), parentId: parentId || null }),
      });
      const result = await response.json();
      // Only a readable client-error response confirms that publication was refused.
      // A lost response or server error may follow a successful commit.
      refused = response.status >= 400 && response.status < 500;
      if (!response.ok) throw new Error(result.error ?? 'Could not make a copy. Try again.');
      if (!result.item?.id || !result.item?.name) throw new Error('Missing copy receipt.');
      receipt = result.item;
    } catch (failure) {
      const message = refused
        ? failure instanceof Error
          ? failure.message
          : 'Could not make a copy. Try again.'
        : unknown;
      onSettled?.({ error: message, uncertain: !refused });
      if (current.current) {
        if (refused) setError(message);
        else setUncertain(message);
      }
    } finally {
      submitting.current = false;
      onBusy?.(false);
      if (current.current) {
        setBusy(false);
      }
    }
    // Presentation/navigation failures cannot erase a confirmed publication receipt.
    if (receipt) {
      onSettled?.({ item: receipt });
      if (current.current) {
        setCreated(receipt);
        onCreated(receipt);
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
      aria-busy={busy || (!created && !uncertain && !options && !error)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {uncertain ? (
        <>
          <p role="alert">{uncertain}</p>
          <div className="copy-file-actions">
            <Button onClick={onClose}>Close</Button>
          </div>
        </>
      ) : created ? (
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
