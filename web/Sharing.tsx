import { ShareLink } from './ShareLink.tsx';
import { useEffect, useState } from 'react';
import type { FileItem, GrantRole, SharePerson } from '../src/shared/workspace.ts';
import { accessLabel } from '../src/shared/workspace.ts';
import { spaceHref } from './spaceNavigation.ts';

export function Sharing({ item, onClose }: { item: FileItem; onClose: () => void }) {
  const [people, setPeople] = useState<SharePerson[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('Loading access…');
  function show(rows: SharePerson[]) {
    setPeople(rows);
    setChoices(Object.fromEntries(rows.map((p) => [p.id, p.directRole ?? ''])));
  }
  useEffect(() => {
    let disposed = false;
    void fetch(`/api/items/${item.id}/sharing`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!disposed) {
          show(body.people);
          setMessage('');
        }
      })
      .catch((e) => {
        if (!disposed) {
          setError(e.message);
          setMessage('');
        }
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [item.id]);
  async function apply(person: SharePerson) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/items/${item.id}/sharing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: person.id,
          role: (choices[person.id] || null) as GrantRole | null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      show(body.people);
      setMessage(`Access updated for ${person.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update access.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={`Share ${item.name}`} className="item-form">
      <h3>Share {item.name}</h3>
      <label>
        Share address
        <input
          readOnly
          value={`${location.origin}${item.kind === 'space' ? spaceHref(item.id) : '/?item=' + encodeURIComponent(item.id)}`}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      <p>
        {item.kind === 'space'
          ? 'This address opens the Space for people you give access to. Their role applies to every page and folder in the Space, including future additions.'
          : 'This address opens the item for people you give access to. Folder access includes its contents and future additions.'}
      </p>
      <p>
        File admins can manage sharing and file organization. They do not own the file or gain
        server administration.
      </p>
      {people.map((person) => (
        <div key={person.id}>
          <label>
            Access for {person.name}
            {person.disabled ? ' (disabled)' : ''}
            <select
              disabled={busy}
              value={choices[person.id] ?? ''}
              onChange={(e) => setChoices({ ...choices, [person.id]: e.target.value })}
            >
              <option value="">No direct access</option>
              <option value="viewer" disabled={Boolean(person.disabled)}>
                Viewer
              </option>
              <option value="editor" disabled={Boolean(person.disabled)}>
                Editor
              </option>
              <option value="admin" disabled={Boolean(person.disabled)}>
                File admin
              </option>
            </select>
          </label>
          <p>
            Effective access: {person.effectiveRole ? accessLabel(person.effectiveRole) : 'none'}
            {person.effectiveRole && person.effectiveRole !== person.directRole
              ? ' (from a folder)'
              : ''}
            .
          </p>
          <button
            disabled={busy || (choices[person.id] ?? '') === (person.directRole ?? '')}
            onClick={() => void apply(person)}
          >
            Apply access for {person.name}
          </button>
        </div>
      ))}
      {!busy && !people.length && !error && <p>No other everyday accounts are available.</p>}
      <p>
        Direct and folder access combine; the most generous grant wins. The Owner and file admins
        can manage sharing, rename, move to authorized folders and send this item to the Owner’s
        Trash. Ownership stays with its one Owner.
      </p>
      {item.kind !== 'folder' && <ShareLink id={item.id} space={item.kind === 'space'} />}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={onClose}>
        Close sharing
      </button>
    </section>
  );
}
