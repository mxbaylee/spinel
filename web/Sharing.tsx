import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { FileItem, GrantRole, SharePerson } from '../src/shared/workspace.ts';
import type { SourceSharingOutcome, SourceSharingReview } from '../src/shared/sourceSharing.ts';
import { accessLabel } from '../src/shared/workspace.ts';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { ShareLink } from './ShareLink.tsx';
import { SharingAddress } from './SharingAddress.tsx';
import { SharingSources } from './SharingSources.tsx';
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
  const [sourceReviews, setSourceReviews] = useState<Record<string, SourceSharingReview | null>>(
    {},
  );
  const [sourceChoices, setSourceChoices] = useState<Record<string, boolean>>({});
  const [sourceResults, setSourceResults] = useState<Record<string, SourceSharingOutcome>>({});
  const [sourceRefresh, setSourceRefresh] = useState(0);
  const [reviewAgain, setReviewAgain] = useState<string | null>(null);
  const generation = useRef(0);
  const mutation = useRef(false);
  const personRows = useRef(new Map<string, HTMLDivElement>());
  const focusAfterLoad = useRef<string | null>(null);
  const doneButton = useRef<HTMLButtonElement | null>(null);
  const hasSources = item.kind === 'doc' || item.kind === 'space';
  const recordSourceReview = useCallback((personId: string, review: SourceSharingReview | null) => {
    setSourceReviews((previous) => ({ ...previous, [personId]: review }));
    // Every replacement preview requires a fresh explicit source choice.
    setSourceChoices((previous) => ({ ...previous, [personId]: false }));
  }, []);
  const verify = (request: number) => () => {
    if (request !== generation.current) throw new Error('This sharing view is no longer current.');
  };
  useLayoutEffect(() => {
    if (loading || !focusAfterLoad.current) return;
    const select = personRows.current
      .get(focusAfterLoad.current)
      ?.querySelector<HTMLSelectElement>('select');
    (select ?? doneButton.current)?.focus();
    focusAfterLoad.current = null;
  }, [loading, people]);
  async function load(preserveChoices = false, focusPerson: string | null = null) {
    focusAfterLoad.current = focusPerson;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setFailedPerson(null);
    setSourceReviews({});
    setSourceChoices({});
    setSourceResults({});
    setReviewAgain(null);
    setMessage('');
    try {
      const body = await itemsRequest<{ people: SharePerson[] }>(
        `/${item.id}/sharing`,
        'GET',
        undefined,
        verify(request),
      );
      if (request !== generation.current) return;
      setPeople(body.people);
      setChoices((previous) =>
        Object.fromEntries(
          body.people.map((person) => [
            person.id,
            preserveChoices
              ? (previous[person.id] ?? person.directRole ?? '')
              : (person.directRole ?? ''),
          ]),
        ),
      );
    } catch (cause) {
      if (request === generation.current) {
        setPeople([]);
        setError(cause instanceof Error ? cause.message : 'Could not load access.');
      }
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
    const role = (choices[person.id] || null) as GrantRole | null;
    const sourceReview = sourceChoices[person.id] ? sourceReviews[person.id] : null;
    if (
      sourceChoices[person.id] &&
      (!sourceReview ||
        sourceReview.userId !== person.id ||
        sourceReview.hostRole !== role ||
        !sourceReview.hostAccess)
    )
      return;
    mutation.current = true;
    const request = ++generation.current;
    setSaving(person.id);
    setError('');
    setFailedPerson(null);
    setMessage('');
    setReviewAgain(null);
    setSourceResults((previous) => {
      const next = { ...previous };
      delete next[person.id];
      return next;
    });
    try {
      const body = await itemsRequest<{
        people: SharePerson[];
        sourceOutcome?: SourceSharingOutcome;
      }>(
        `/${item.id}/sharing`,
        'PUT',
        {
          userId: person.id,
          role,
          ...(sourceReview ? { sourceReview: sourceReview.version } : {}),
        },
        verify(request),
      );
      if (request !== generation.current) return;
      if (sourceReview && !body.sourceOutcome)
        throw new Error('The source-sharing result was not received.');
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
      setSourceChoices((previous) => ({ ...previous, [person.id]: false }));
      setSourceRefresh((value) => value + 1);
      if (body.sourceOutcome) {
        setSourceResults((previous) => ({ ...previous, [person.id]: body.sourceOutcome! }));
        if (!body.sourceOutcome.complete) setReviewAgain(person.id);
      } else setMessage(`Access updated for ${person.name}.`);
    } catch (cause) {
      if (request === generation.current) {
        setFailedPerson(person.id);
        const detail = cause instanceof Error ? cause.message : 'Could not update access.';
        if (!hasSources) setError(detail);
        else {
          // A lost acknowledgement may follow any committed sharing write.
          // Recheck host/source access even when sources were left unchecked:
          // a refusal may also mean the previous source names are now private.
          setError(`Could not confirm the update. ${detail} Review current access and try again.`);
          setSourceChoices((previous) => ({ ...previous, [person.id]: false }));
          setSourceReviews((previous) => ({ ...previous, [person.id]: null }));
          setReviewAgain(person.id);
          setSourceRefresh((value) => value + 1);
          try {
            const current = await itemsRequest<{ people: SharePerson[] }>(
              `/${item.id}/sharing`,
              'GET',
              undefined,
              verify(request),
            );
            if (request !== generation.current) return;
            setPeople(current.people);
          } catch {
            if (request === generation.current) {
              // A revoked host cannot retain the previous source/name inventory.
              setPeople([]);
              setChoices({});
              setSourceResults({});
              setSourceReviews({});
              setFailedPerson(null);
              setError(
                'Could not confirm the update or refresh access. Reopen sharing to review current permissions.',
              );
            }
          }
        }
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
                <div
                  className="sharing-person"
                  key={person.id}
                  ref={(element) => {
                    if (element) personRows.current.set(person.id, element);
                    else personRows.current.delete(person.id);
                  }}
                >
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
                        onChange={(event) => {
                          setChoices({ ...choices, [person.id]: event.target.value });
                          setSourceChoices((previous) => ({ ...previous, [person.id]: false }));
                          setSourceResults((previous) => {
                            const next = { ...previous };
                            delete next[person.id];
                            return next;
                          });
                        }}
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
                  {hasSources && !person.disabled && (
                    <SharingSources
                      itemId={item.id}
                      person={person}
                      role={(choices[person.id] || null) as GrantRole | null}
                      busy={!!saving}
                      checked={!!sourceChoices[person.id]}
                      refresh={sourceRefresh}
                      onChecked={(checked) =>
                        setSourceChoices((previous) => ({ ...previous, [person.id]: checked }))
                      }
                      onReview={recordSourceReview}
                    />
                  )}
                  <Button
                    disabled={
                      !!saving ||
                      ((choices[person.id] ?? '') === (person.directRole ?? '') &&
                        !(
                          sourceChoices[person.id] &&
                          sourceReviews[person.id]?.hostAccess &&
                          sourceReviews[person.id]?.targets.some(
                            (target) => target.state === 'grant',
                          )
                        ))
                    }
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
                  {sourceResults[person.id] && (
                    <div className="sharing-source-result">
                      <p role="status">
                        {item.kind === 'space' ? 'Space' : 'Report'} access{' '}
                        {sourceResults[person.id].host === 'updated' ? 'updated.' : 'kept.'} Source
                        access updated: {sourceResults[person.id].shared.length}{' '}
                        {sourceResults[person.id].shared.length === 1
                          ? 'target shared'
                          : 'targets shared'}
                        .{' '}
                        {sourceResults[person.id].complete
                          ? 'Existing source access is kept.'
                          : 'Some sources still need access or could not be reviewed. Successful grants are kept.'}
                      </p>
                      {sourceReviews[person.id]?.targets.some((target) =>
                        sourceResults[person.id].shared.includes(target.id),
                      ) && (
                        <ul aria-label="Sources shared">
                          {sourceReviews[person.id]?.targets
                            .filter((target) => sourceResults[person.id].shared.includes(target.id))
                            .map((target) => (
                              <li key={target.id}>
                                {target.name} — Can view
                                {target.kind === 'space' ? ' · Entire Space' : ''}
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {reviewAgain === person.id && (
                    <Button disabled={!!saving} onClick={() => void load(true, person.id)}>
                      Review remaining sources
                    </Button>
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
        {hasSources && (
          <p className="sp-muted">
            {item.kind === 'space'
              ? 'Sources in this Space are included. Sources outside this Space remain unavailable to link guests.'
              : 'This link shares only the document. Formulas that need other files are unavailable to link guests.'}
          </p>
        )}
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
          <Button ref={doneButton} disabled={!!saving || linkBusy} onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
