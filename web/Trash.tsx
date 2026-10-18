import { useEffect, useState } from 'react';
import { kindLabel } from '../src/shared/workspace.ts';
import type { TrashListing } from '../src/shared/workspace.ts';

import { itemsRequest } from './itemsApi.ts';
import { TagLabels } from './DocumentTags.tsx';

export function Trash({ onChanged }: { onChanged(): Promise<void> }) {
  const [listing, setListing] = useState<TrashListing | null>(null);
  const [confirmation, setConfirmation] = useState<TrashListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function reload() {
    setListing(await itemsRequest<TrashListing>('/trash'));
  }
  useEffect(() => {
    void reload().catch((failure) => setError(failure.message));
  }, []);
  async function change(path: string, body: unknown, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await itemsRequest(path, 'POST', body);
      setConfirmation(null);
      setMessage(success);
      await Promise.all([reload(), onChanged()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update trash. Try again.');
      setConfirmation(null);
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Trash">
      <h2>Trash</h2>
      <p>
        Restore items for 30 days after deletion. After that, daily cleanup removes them
        permanently.
      </p>
      {listing ? (
        <>
          <button disabled={busy || !listing.items.length} onClick={() => setConfirmation(listing)}>
            Empty trash
          </button>
          {confirmation && (
            <div role="dialog" aria-label="Empty trash confirmation" aria-modal="false">
              <p>
                Permanently delete {confirmation.items.length}{' '}
                {confirmation.items.length === 1 ? 'item' : 'items'}? This cannot be undone.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void change('/trash/empty', { version: confirmation.version }, 'Trash emptied.')
                }
              >
                Permanently delete {confirmation.items.length}{' '}
                {confirmation.items.length === 1 ? 'item' : 'items'}
              </button>
              <button disabled={busy} onClick={() => setConfirmation(null)}>
                Cancel
              </button>
            </div>
          )}
          <ul className="file-list">
            {listing.items.map((item) => (
              <li key={item.id}>
                <div>
                  {item.name} <span className="item-kind">{kindLabel[item.kind]}</span>
                  <TagLabels tags={item.tags} />
                  <br />
                  <small>
                    Deleted {new Date(item.trashedAt).toLocaleString()} · Recover until{' '}
                    {new Date(item.expiresAt).toLocaleString()}
                  </small>
                </div>
                <button
                  disabled={busy || !!confirmation || item.expiresAt <= Date.now()}
                  aria-label={`Restore ${item.name}`}
                  onClick={() => void change(`/${item.id}/restore`, {}, `Restored ${item.name}.`)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
          {!listing.items.length && <p>Your trash is empty.</p>}
        </>
      ) : (
        <p role="status">Loading trash…</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
