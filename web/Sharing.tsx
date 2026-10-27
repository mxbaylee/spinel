import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import type { FileItem, GrantRole, SharePerson } from '../src/shared/workspace.ts';
import type { SourceSharingOutcome, SourceSharingReview } from '../src/shared/sourceSharing.ts';
import { accessLabel } from '../src/shared/workspace.ts';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { ShareLink } from './ShareLink.tsx';
import { SharingAddress } from './SharingAddress.tsx';
import { SharingSources } from './SharingSources.tsx';
import { itemsRequest } from './itemsApi.ts';
import { spaceHref } from './spaceNavigation.ts';
import './sharing.css';

type Draft = { personId: string; role: GrantRole | null };

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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<string>('people');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sourceReview, setSourceReview] = useState<SourceSharingReview | null>(null);
  const [includeSources, setIncludeSources] = useState(false);
  const [sourceRefresh, setSourceRefresh] = useState(0);
  const generation = useRef(0);
  const mutation = useRef(false);
  const personRows = useRef(new Map<string, HTMLButtonElement>());
  const editor = useRef<HTMLFormElement>(null);
  const peoplePanel = useRef<HTMLDivElement>(null);
  const focusAfterChange = useRef<{ personId: string; editor: boolean } | null>(null);
  const hasSources = item.kind === 'doc' || item.kind === 'space';
  const busy = saving || linkBusy;
  const recordSourceReview = useCallback((review: SourceSharingReview | null) => {
    setSourceReview(review);
    // Every fresh identity/role-bound preview needs a new explicit opt-in.
    setIncludeSources(false);
  }, []);
  const verify = (request: number) => () => {
    if (request !== generation.current) throw new Error('This sharing view is no longer current.');
  };
  useLayoutEffect(() => {
    if (loading || saving || !focusAfterChange.current) return;
    const next = focusAfterChange.current;
    const request = generation.current;
    // Let the dialog finish restoring containment after a focused control is removed.
    const frame = requestAnimationFrame(() => {
      if (request !== generation.current || focusAfterChange.current !== next) return;
      const target = next.editor
        ? editor.current?.querySelector<HTMLSelectElement>('select')
        : personRows.current.get(next.personId);
      (target ?? peoplePanel.current)?.focus();
      focusAfterChange.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, saving, people, draft]);

  function discardDraft() {
    setDraft(null);
    setSourceReview(null);
    setIncludeSources(false);
    setError('');
    setMessage('');
  }
  async function load() {
    const request = ++generation.current;
    setLoading(true);
    discardDraft();
    try {
      const body = await itemsRequest<{ people: SharePerson[] }>(
        `/${item.id}/sharing`,
        'GET',
        undefined,
        verify(request),
      );
      if (request === generation.current) setPeople(body.people);
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
    setTab('people');
    setSaving(false);
    setLinkBusy(false);
    focusAfterChange.current = null;
    mutation.current = false;
    void load();
    return () => {
      generation.current++;
    };
  }, [item.id, item.access]);

  function edit(person: SharePerson) {
    if (mutation.current || busy) return;
    discardDraft();
    const closing = draft?.personId === person.id;
    focusAfterChange.current = { personId: person.id, editor: !closing };
    if (!closing) setDraft({ personId: person.id, role: person.directRole });
  }
  async function apply(person: SharePerson) {
    if (mutation.current || busy || !draft || draft.personId !== person.id) return;
    const { role } = draft;
    const review = includeSources ? sourceReview : null;
    if (
      includeSources &&
      (!review ||
        review.userId !== person.id ||
        review.hostRole !== role ||
        !review.hostAccess ||
        !review.targets.some((target) => target.state === 'grant'))
    )
      return;
    if (role === person.directRole && !review) return;
    mutation.current = true;
    const request = ++generation.current;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const body = await itemsRequest<{
        people: SharePerson[];
        sourceOutcome?: SourceSharingOutcome;
      }>(
        `/${item.id}/sharing`,
        'PUT',
        { userId: person.id, role, ...(review ? { sourceReview: review.version } : {}) },
        verify(request),
      );
      if (request !== generation.current) return;
      if (review && !body.sourceOutcome)
        throw new Error('The source-sharing result was not received.');
      setPeople(body.people);
      setIncludeSources(false);
      setSourceReview(null);
      const outcome = body.sourceOutcome;
      if (outcome && !outcome.complete) {
        const host = item.kind === 'space' ? 'Space' : 'Report';
        setDraft({
          personId: person.id,
          role: body.people.find((row) => row.id === person.id)?.directRole ?? null,
        });
        setMessage(
          `${host} access ${outcome.host === 'updated' ? 'updated' : 'kept'}. ${outcome.shared.length} ${outcome.shared.length === 1 ? 'source' : 'sources'} shared; some sources still need access or review.`,
        );
        setSourceRefresh((value) => value + 1);
        focusAfterChange.current = { personId: person.id, editor: true };
      } else {
        setDraft(null);
        setMessage(
          outcome
            ? `${outcome.host === 'updated' ? 'Access and formula sources updated' : 'Formula sources shared'} for ${person.name}.`
            : `Access updated for ${person.name}.`,
        );
        focusAfterChange.current = { personId: person.id, editor: false };
      }
    } catch (cause) {
      if (request !== generation.current) return;
      const detail = cause instanceof Error ? cause.message : '';
      setError(
        detail.startsWith('Formula sources changed.')
          ? detail
          : 'Could not confirm the update. Review current access and try again.',
      );
      setIncludeSources(false);
      setSourceReview(null);
      setSourceRefresh((value) => value + 1);
      focusAfterChange.current = { personId: person.id, editor: true };
      // Even unchecked writes may commit before the reply is lost, or reveal that
      // the actor's host/source authority was revoked. Read, never replay, the write.
      try {
        const current = await itemsRequest<{ people: SharePerson[] }>(
          `/${item.id}/sharing`,
          'GET',
          undefined,
          verify(request),
        );
        if (request !== generation.current) return;
        setPeople(current.people);
        if (!current.people.some((row) => row.id === person.id)) setDraft(null);
      } catch {
        if (request === generation.current) {
          setPeople([]);
          setDraft(null);
          setSourceReview(null);
          setError(
            'Could not confirm the update or refresh access. Reopen sharing to review current permissions.',
          );
        }
      }
    } finally {
      if (request === generation.current) {
        mutation.current = false;
        setSaving(false);
      }
    }
  }

  const peopleView = (
    <div ref={peoplePanel} className="sharing-people" tabIndex={-1}>
      <div className="sharing-owner">
        <strong>{item.access === 'owner' ? 'You' : (item.ownerName ?? 'File owner')}</strong>
        <span>Owner</span>
      </div>
      <section aria-label="People with access" aria-busy={loading || saving}>
        {loading ? (
          <p role="status">Loading access…</p>
        ) : (
          <>
            {people.map((person) => (
              <div className="sharing-person" key={person.id}>
                <button
                  className="sharing-person-trigger"
                  ref={(element) => {
                    if (element) personRows.current.set(person.id, element);
                    else personRows.current.delete(person.id);
                  }}
                  aria-label={`Edit access for ${person.name}`}
                  aria-expanded={draft?.personId === person.id}
                  aria-controls={
                    draft?.personId === person.id ? `sharing-editor-${person.id}` : undefined
                  }
                  disabled={busy}
                  onClick={() => edit(person)}
                >
                  <strong>
                    {person.name}
                    {person.disabled ? ' · Disabled account' : ''}
                  </strong>
                  <span>
                    {person.effectiveRole ? accessLabel(person.effectiveRole) : 'Not shared'}
                  </span>
                  <ProfileIcon
                    icon={
                      draft?.personId === person.id ? 'lucide:chevron-up' : 'lucide:chevron-down'
                    }
                    size={16}
                  />
                </button>
                {draft?.personId === person.id && (
                  <form
                    ref={editor}
                    id={`sharing-editor-${person.id}`}
                    className="sharing-editor"
                    aria-label={`Edit ${person.name}’s access`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void apply(person);
                    }}
                  >
                    <label className="sharing-role">
                      Access
                      <select
                        className="sp-control"
                        aria-label={`Access for ${person.name}`}
                        disabled={busy}
                        value={draft.role ?? ''}
                        onChange={(event) => {
                          setDraft({
                            personId: person.id,
                            role: (event.target.value || null) as GrantRole | null,
                          });
                          setIncludeSources(false);
                          setSourceReview(null);
                          setError('');
                          setMessage('');
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
                    {person.disabled ? (
                      <p className="sp-muted">
                        This account cannot sign in. You can remove its direct access.
                      </p>
                    ) : (
                      person.effectiveRole &&
                      person.effectiveRole !== person.directRole && (
                        <p className="sp-muted">
                          {accessLabel(person.effectiveRole)} through a folder.
                        </p>
                      )
                    )}
                    {draft.role === 'admin' && !person.disabled && (
                      <p className="sp-muted">
                        File admins manage sharing and organization, without ownership.
                      </p>
                    )}
                    {item.kind === 'space' && (
                      <p className="sp-muted">
                        Applies to every current and future page and folder in this Space.
                      </p>
                    )}
                    {item.kind === 'folder' && (
                      <p className="sp-muted">
                        Applies to this folder’s contents and future additions.
                      </p>
                    )}
                    {hasSources && !person.disabled && (
                      <SharingSources
                        key={person.id}
                        itemId={item.id}
                        person={person}
                        role={draft.role}
                        busy={busy}
                        checked={includeSources}
                        refresh={sourceRefresh}
                        onChecked={setIncludeSources}
                        onReview={recordSourceReview}
                      />
                    )}
                    {error && <p role="alert">{error}</p>}
                    {message && <p role="status">{message}</p>}
                    <div className="sharing-editor-actions">
                      <Button
                        disabled={busy}
                        onClick={() => {
                          focusAfterChange.current = { personId: person.id, editor: false };
                          discardDraft();
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        primary
                        type="submit"
                        disabled={
                          busy ||
                          (draft.role === person.directRole &&
                            !(
                              includeSources &&
                              sourceReview?.hostAccess &&
                              sourceReview.targets.some((target) => target.state === 'grant')
                            ))
                        }
                      >
                        {saving ? 'Saving…' : person.effectiveRole ? 'Save changes' : 'Share'}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            ))}
            {!people.length && !error && <p>No other everyday accounts are available.</p>}
            {error && !draft && (
              <>
                <p role="alert">{error}</p>
                <Button disabled={busy} onClick={() => void load()}>
                  Retry loading access
                </Button>
              </>
            )}
          </>
        )}
        {message && !draft && <p role="status">{message}</p>}
      </section>
      {!draft && (
        <div className="sharing-footer">
          <SharingAddress
            value={`${location.origin}${item.kind === 'space' ? spaceHref(item.id) : '/?item=' + encodeURIComponent(item.id)}`}
          />
        </div>
      )}
    </div>
  );
  return (
    <Modal
      open
      finalFocus={finalFocus}
      title={`Share ${item.name}`}
      icon="share"
      dismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {item.kind === 'folder' ? (
        <div className="sharing-content">{peopleView}</div>
      ) : (
        <Tabs.Root
          className="sharing-content"
          value={tab}
          onValueChange={(value) => {
            if (mutation.current || busy || (value !== 'people' && value !== 'link')) return;
            focusAfterChange.current = null;
            discardDraft();
            setTab(value);
          }}
        >
          <Tabs.List className="sharing-tabs" aria-label="Sharing options">
            <Tabs.Tab value="people" disabled={busy}>
              People
            </Tabs.Tab>
            <Tabs.Tab value="link" disabled={busy}>
              Link
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="people" className="sharing-panel">
            {peopleView}
          </Tabs.Panel>
          <Tabs.Panel value="link" className="sharing-panel" keepMounted>
            <ShareLink
              key={`${item.id}:${item.access}`}
              id={item.id}
              space={item.kind === 'space'}
              sourceKind={hasSources ? (item.kind as 'doc' | 'space') : undefined}
              onBusyChange={setLinkBusy}
            />
          </Tabs.Panel>
        </Tabs.Root>
      )}
    </Modal>
  );
}
