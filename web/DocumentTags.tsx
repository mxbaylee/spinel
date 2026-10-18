import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { itemsRequest } from './itemsApi.ts';

export function TagLabels({ tags }: { tags: string[] }) {
  return tags.length ? (
    <span className="tag-labels">
      {tags.map((tag) => (
        <span key={tag}>#{tag}</span>
      ))}
    </span>
  ) : null;
}

export function DocumentTags({
  item,
  onChanged,
  onClose,
}: {
  item: WorkspaceItem;
  onChanged: (item: WorkspaceItem) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const suggestionsId = useId();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [tag, setTag] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    let disposed = false;
    void itemsRequest<{ tags: string[] }>('/tags')
      .then((result) => {
        if (!disposed)
          setSuggestions((previous) => [...new Set([...previous, ...result.tags])].sort());
      })
      .catch((cause) => {
        if (!disposed) setError(cause.message);
      });
    return () => {
      disposed = true;
      modal?.close();
    };
  }, []);
  function finish() {
    active.current = false;
    dialog.current?.close();
    onClose();
  }
  async function change(value: string, remove = false) {
    setBusy(true);
    setError('');
    try {
      const result = await itemsRequest<{ item: WorkspaceItem }>(
        `/${item.id}/tags`,
        remove ? 'DELETE' : 'POST',
        { tag: value },
      );
      // Browser Back can dismiss this dialog while its request is in flight.
      // The completed server mutation persists, but cannot reopen stale UI.
      if (!active.current) return;
      onChanged(result.item);
      setSuggestions((previous) => [...new Set([...previous, ...result.item.tags])].sort());
      if (!remove) setTag('');
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : 'Could not update tags. Try again.');
    } finally {
      if (active.current) {
        setBusy(false);
        requestAnimationFrame(() => {
          if (active.current) input.current?.focus();
        });
      }
    }
  }
  return (
    <dialog
      ref={dialog}
      className="document-tags"
      aria-label={`Tags for ${item.name}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) finish();
      }}
    >
      <h3>Tags for {item.name}</h3>
      <p>Only you see these tags. They do not change the document.</p>
      <ul aria-label="Your tags">
        {item.tags.map((name) => (
          <li key={name}>
            #{name}{' '}
            <button
              disabled={busy}
              onClick={() => void change(name, true)}
              aria-label={`Remove #${name}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {!item.tags.length && <p>No tags yet.</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void change(tag);
        }}
      >
        <label>
          Tag
          <input
            ref={input}
            autoFocus
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            disabled={busy}
            list={suggestionsId}
            required
          />
        </label>
        <datalist id={suggestionsId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button disabled={busy || !tag.trim()}>Add tag</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={finish}>
        Done
      </button>
    </dialog>
  );
}
