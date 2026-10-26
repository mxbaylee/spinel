import { useLayoutEffect, useRef, useState } from 'react';
import type { FileItem, GrantRole, SharePerson } from '../src/shared/workspace.ts';
import { accessLabel } from '../src/shared/workspace.ts';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { ShareLink } from './ShareLink.tsx';
import { SharingAddress } from './SharingAddress.tsx';
import { itemsRequest } from './itemsApi.ts';
import { spaceHref } from './spaceNavigation.ts';
import './sharing.css';

export function Sharing({
  item,
  onClose,
  finalFocus,
}: {
  item: FileItem;
  onClose: () => void;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  const [people, setPeople] = useState<SharePerson[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedPerson, setFailedPerson] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const mutation = useRef(false);
  const verify = (request: number) => () => {
    if (request !== generation.current) throw new Error('This sharing view is no longer current.');
  };
  async function load() {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setFailedPerson(null);
    try {
      const body = await itemsRequest<{ people: SharePerson[] }>(
        `/${item.id}/sharing`,
        'GET',
        undefined,
        verify(request),
      );
      if (request !== generation.current) return;
      setPeople(body.people);
      setChoices(
        Object.fromEntries(body.people.map((person) => [person.id, person.directRole ?? ''])),
      );
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not load access.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  useLayoutEffect(() => {
    setPeople([]);
    setChoices({});
    setSaving(null);
    setLinkBusy(false);
    setMessage('');
    mutation.current = false;
    void load();
    return () => {
      generation.current++;
    };
  }, [item.id, item.access]);
  async function apply(person: SharePerson) {
    if (mutation.current) return;
    mutation.current = true;
    const request = ++generation.current;
    setSaving(person.id);
    setError('');
    setFailedPerson(null);
    setMessage('');
    try {
      const body = await itemsRequest<{ people: SharePerson[] }>(
        `/${item.id}/sharing`,
        'PUT',
        {
          userId: person.id,
          role: (choices[person.id] || null) as GrantRole | null,
        },
        verify(request),
      );
      if (request !== generation.current) return;
      setPeople(body.people);
      // Saving one person's grant must not discard another person's staged choice.
      setChoices((previous) =>
        Object.fromEntries(
          body.people.map((row) => [
            row.id,
            row.id === person.id
              ? (row.directRole ?? '')
              : (previous[row.id] ?? row.directRole ?? ''),
          ]),
        ),
      );
      setMessage(`Access updated for ${person.name}.`);
    } catch (cause) {
      if (request === generation.current) {
        setFailedPerson(person.id);
        setError(cause instanceof Error ? cause.message : 'Could not update access.');
      }
    } finally {
      if (request === generation.current) {
        mutation.current = false;
        setSaving(null);
      }
    }
  }
  return (
    <Modal
      open
      finalFocus={finalFocus}
      title={`Share ${item.name}`}
      icon="share"
      dismissDisabled={!!saving || linkBusy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="sharing-content">
        <p className="sp-muted">
          Choose who can open this {item.kind === 'space' ? 'Space' : 'item'}.
        </p>
        <div className="sharing-owner">
          <strong>{item.access === 'owner' ? 'You' : (item.ownerName ?? 'File owner')}</strong>
          <span>Owner</span>
        </div>
        {item.access === 'admin' && (
          <p className="sp-muted">
            You are a File admin. The Owner and your own direct grant are protected.
          </p>
        )}
        <section aria-label="People with access" aria-busy={loading || !!saving}>
          {loading ? (
            <p role="status">Loading access…</p>
          ) : (
            <>
              {people.map((person) => (
                <div className="sharing-person" key={person.id}>
                  <div className="sharing-person-row">
                    <div>
                      <strong>
                        {person.name}
                        {person.disabled ? ' · Disabled account' : ''}
                      </strong>
                      <p className="sp-muted">
                        Effective access:{' '}
                        {person.effectiveRole ? accessLabel(person.effectiveRole) : 'none'}
                        {person.effectiveRole && person.effectiveRole !== person.directRole
                          ? ' (from a folder)'
                          : ''}
                        .
                      </p>
                      {person.disabled ? (
                        <p className="sp-muted">
                          This account cannot sign in. You can remove its direct access.
                        </p>
                      ) : null}
                    </div>
                    <label className="sharing-choice">
                      Access for {person.name}
                      <select
                        className="sp-control"
                        disabled={!!saving}
                        value={choices[person.id] ?? ''}
                        onChange={(event) =>
                          setChoices({ ...choices, [person.id]: event.target.value })
                        }
                      >
                        <option value="">No direct access</option>
                        <option value="viewer" disabled={!!person.disabled}>
                          Can view
                        </option>
                        <option value="editor" disabled={!!person.disabled}>
                          Can edit
                        </option>
                        <option value="admin" disabled={!!person.disabled}>
                          File admin
                        </option>
                      </select>
                    </label>
                  </div>
                  <Button
                    disabled={!!saving || (choices[person.id] ?? '') === (person.directRole ?? '')}
                    aria-label={
                      failedPerson === person.id
                        ? `Retry access update for ${person.name}`
                        : `Apply access for ${person.name}`
                    }
                    onClick={() => void apply(person)}
                  >
                    {saving === person.id
                      ? 'Updating access…'
                      : failedPerson === person.id
                        ? 'Retry access update'
                        : 'Apply access'}
                  </Button>
                  {failedPerson === person.id && (
                    <p role="alert">
                      {error} Confirmed access is shown above; your choice is kept.
                    </p>
                  )}
                </div>
              ))}
              {!people.length && !error && <p>No other everyday accounts are available.</p>}
              {error && !failedPerson && (
                <>
                  <p role="alert">{error}</p>
                  <Button onClick={() => void load()}>Retry loading access</Button>
                </>
              )}
            </>
          )}
          {message && <p role="status">{message}</p>}
        </section>
        <p className="sp-muted">
          {item.kind === 'space'
            ? 'Access applies to every current and future page and folder in this Space.'
            : item.kind === 'folder'
              ? 'Folder access includes its contents and future additions. Folders cannot have guest links.'
              : 'Direct and folder access combine; the most generous grant wins.'}{' '}
          File admins manage sharing and file organization, without ownership or server
          administration.
        </p>
        {item.kind !== 'folder' && (
          <ShareLink
            key={`${item.id}:${item.access}`}
            id={item.id}
            space={item.kind === 'space'}
            onBusyChange={setLinkBusy}
          />
        )}
        <div className="sharing-footer">
          <SharingAddress
            value={`${location.origin}${item.kind === 'space' ? spaceHref(item.id) : '/?item=' + encodeURIComponent(item.id)}`}
          />
          <Button disabled={!!saving || linkBusy} onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
