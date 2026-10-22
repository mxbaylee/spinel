import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { useEffect, useState } from 'react';
import { fileKindLabel } from '../src/shared/workspace.ts';
import type { TrashListing } from '../src/shared/workspace.ts';

import { itemsRequest } from './itemsApi.ts';
import { TagLabels } from './DocumentTags.tsx';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';

export function Trash({ onChanged }: { onChanged(): Promise<void> }) {
  const [listing, setListing] = useState<TrashListing | null>(null);
  const [confirmation, setConfirmation] = useState<TrashListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const deletionCount = confirmation?.deletion?.count ?? confirmation?.items.length ?? 0;
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
        Ordinary files can be restored for 30 days before daily cleanup removes them permanently.
        Spaces and deletion groups containing a Space stay here until you explicitly delete them.
      </p>
      {listing ? (
        <>
          <button disabled={busy || !listing.items.length} onClick={() => setConfirmation(listing)}>
            Empty trash
          </button>
          {confirmation && (
            <Modal
              open
              title="Empty trash confirmation"
              icon="trash"
              dismissDisabled={busy}
              onOpenChange={(open) => {
                if (!open) setConfirmation(null);
              }}
            >
              <p>
                Permanently delete {deletionCount} {deletionCount === 1 ? 'item' : 'items'}? This
                includes all pages, folders, earlier deletions, and saved history inside the listed
                Spaces. This cannot be undone.
              </p>
              <ul
                aria-label="Items to permanently delete"
                style={{ maxHeight: '40vh', overflowY: 'auto' }}
              >
                {(confirmation.deletion?.items ?? confirmation.items).map((item) => (
                  <li key={item.id}>
                    {item.kind !== 'folder' && <EntityIcon kind={item.kind} />} {item.name}{' '}
                    <span className="item-kind">{fileKindLabel[item.kind]}</span>
                  </li>
                ))}
              </ul>
              <Button
                disabled={busy}
                onClick={() =>
                  void change('/trash/empty', { version: confirmation.version }, 'Trash emptied.')
                }
              >
                Permanently delete {deletionCount} {deletionCount === 1 ? 'item' : 'items'}
              </Button>
              <Button disabled={busy} onClick={() => setConfirmation(null)}>
                Cancel
              </Button>
            </Modal>
          )}
          <ul className="file-list">
            {listing.items.map((item) => (
              <li key={item.id}>
                <div>
                  {item.kind !== 'folder' && <EntityIcon kind={item.kind} />}
                  {item.name} <span className="item-kind">{fileKindLabel[item.kind]}</span>
                  <TagLabels tags={item.tags} />
                  <br />
                  <small>
                    Deleted {new Date(item.trashedAt).toLocaleString()} ·{' '}
                    {item.expiresAt === null
                      ? 'Kept until you permanently delete it'
                      : `Recover until ${new Date(item.expiresAt).toLocaleString()}`}
                  </small>
                </div>
                <button
                  disabled={
                    busy ||
                    !!confirmation ||
                    (item.expiresAt !== null && item.expiresAt <= Date.now())
                  }
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
