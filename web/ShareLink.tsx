import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { itemsRequest } from './itemsApi.ts';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { SharingAddress } from './SharingAddress.tsx';
import './sharing.css';

type Role = 'viewer' | 'editor';
type State = { enabled: boolean; role: Role; url?: string | null };
type Change = { role: Role | null; replacing: boolean };
export function ShareLink({
  id,
  space = false,
  onBusyChange,
}: {
  id: string;
  space?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [state, setState] = useState<State>({ enabled: false, role: 'viewer' });
  const [role, setRole] = useState<Role>('viewer');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Change>({ role: 'viewer', replacing: false });
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [failed, setFailed] = useState<Change | null>(null);
  const generation = useRef(0);
  const actionTrigger = useRef<HTMLButtonElement>(null);
  const section = useRef<HTMLElement>(null);
  const mutation = useRef(false);
  const verify = (request: number) => () => {
    if (request !== generation.current) throw new Error('This sharing view is no longer current.');
  };
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  async function load() {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const value = await itemsRequest<State>(`/${id}/link`, 'GET', undefined, verify(request));
      if (request !== generation.current) return;
      // Only a successful creation response may reveal the secret. Never recover it on GET.
      setState({ enabled: value.enabled, role: value.role });
      setRole(value.role);
      setLoaded(true);
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not load the guest link.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  useLayoutEffect(() => {
    setState({ enabled: false, role: 'viewer' });
    setRole('viewer');
    setLoaded(false);
    setBusy(false);
    setPending({ role: 'viewer', replacing: false });
    setConfirmationOpen(false);
    setFailed(null);
    setNotice('');
    mutation.current = false;
    void load();
    return () => {
      generation.current++;
    };
  }, [id]);
  async function change(action: Change) {
    if (mutation.current) return;
    mutation.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    setFailed(null);
    try {
      const value = await itemsRequest<State>(
        `/${id}/link`,
        'PUT',
        { role: action.role },
        verify(request),
      );
      if (request !== generation.current) return;
      setState(value);
      setConfirmationOpen(false);
      setNotice(
        action.role === null
          ? 'Guest link turned off.'
          : action.replacing
            ? 'Replacement link created. The previous link and its guest sessions have ended.'
            : 'Guest link created. Copy its address now; it is shown only once.',
      );
    } catch (cause) {
      if (request === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Could not change the link.');
        setFailed(action);
      }
    } finally {
      if (request === generation.current) {
        mutation.current = false;
        setBusy(false);
      }
    }
  }
  function requestChange(next: Role | null) {
    const action = { role: next, replacing: state.enabled && next !== null };
    setError('');
    setFailed(null);
    if (space || action.replacing) {
      setPending(action);
      setConfirmationOpen(true);
    } else void change(action);
  }
  return (
    <section
      ref={section}
      className="sharing-link sp-ui"
      aria-label="Guest link"
      aria-busy={loading || busy}
    >
      <h3>Anyone with the link</h3>
      {loading ? (
        <p role="status">Loading guest link…</p>
      ) : !loaded ? (
        <>
          <p role="alert">{error}</p>
          <Button onClick={() => void load()}>Retry loading guest link</Button>
        </>
      ) : (
        <>
          <p className="sp-muted">
            {state.enabled
              ? `Guests can ${state.role === 'editor' ? 'edit' : 'view'}.`
              : 'Off. Only people with access can open this item.'}
          </p>
          {space && (
            <p className="sp-muted">
              The link covers every current and future page and folder in this Space. Can edit
              includes adding, renaming, moving and deleting its contents. Guests cannot manage
              sharing or use account history and recovery.
            </p>
          )}
          <label className="sharing-choice">
            Link access
            <select
              className="sp-control"
              value={role}
              disabled={busy}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              <option value="viewer">Can view</option>
              <option value="editor">Can edit</option>
            </select>
          </label>
          {state.enabled && state.role !== role && (
            <p className="sp-muted">The current link stays unchanged until you replace it.</p>
          )}
          {state.enabled &&
            (state.url ? (
              <>
                <SharingAddress key={state.url} value={state.url} guest />
                <p className="sp-muted">Copy this address now. It is shown only once.</p>
              </>
            ) : (
              <p className="sp-muted">Replace the link to copy a new address.</p>
            ))}
          <div className="sharing-link-actions">
            {state.enabled ? (
              <ActionMenu
                triggerRef={actionTrigger}
                label="Guest link actions"
                actions={[
                  { label: 'Replace link…', disabled: busy, onClick: () => requestChange(role) },
                  {
                    label: 'Turn off link',
                    disabled: busy,
                    destructive: true,
                    onClick: () => requestChange(null),
                  },
                ]}
              />
            ) : (
              <Button
                className="sharing-create"
                disabled={busy}
                onClick={() => requestChange(role)}
              >
                Create link
              </Button>
            )}
          </div>
          {busy && <p role="status">Saving guest link…</p>}
          {notice && <p role="status">{notice}</p>}
          {error && !confirmationOpen && (
            <>
              <p role="alert">{error} The last confirmed link access is shown above.</p>
              {failed && (
                <Button disabled={busy} onClick={() => void change(failed)}>
                  Retry link update
                </Button>
              )}
            </>
          )}
          <p className="sp-muted">
            Collaborator names are hidden while link sharing is on. Guest sessions last 24 hours.
            Social previews show only the {space ? 'Space' : 'file'} title and type.
          </p>
        </>
      )}
      {/* Keep the controller mounted while its popup closes, so focus resolves
          after successful link changes replace Create link / Guest link actions. */}
      <Modal
        open={confirmationOpen}
        finalFocus={() =>
          actionTrigger.current ??
          section.current?.querySelector<HTMLButtonElement>('.sharing-create') ??
          true
        }
        icon={space ? 'space' : 'share'}
        dismissDisabled={busy}
        title={
          pending.role === null
            ? 'Turn off this Space link?'
            : pending.replacing
              ? 'Replace the link?'
              : 'Share the whole Space?'
        }
        onOpenChange={(open) => {
          if (!open) {
            setConfirmationOpen(false);
            setError('');
            setFailed(null);
          }
        }}
        description={
          pending.role === null
            ? 'Every guest using this link will lose access to the Space and all its pages.'
            : pending.replacing
              ? 'The old link stops working at once, and anyone using it loses access.'
              : 'Child pages cannot have separate guest access.'
        }
      >
        {pending.role !== null && (
          <p>
            {space
              ? `Anyone with the new link can ${pending.role === 'editor' ? 'edit' : 'view'} every current and future page and folder in this Space.`
              : `The replacement lets guests ${pending.role === 'editor' ? 'edit' : 'view'} this file.`}
          </p>
        )}
        {error && (
          <p role="alert">{error} The last confirmed link access is unchanged in this view.</p>
        )}
        <div className="sharing-link-actions">
          <Button
            disabled={busy}
            onClick={() => {
              setConfirmationOpen(false);
              setError('');
              setFailed(null);
            }}
          >
            Cancel
          </Button>
          <Button primary disabled={busy} onClick={() => void change(pending)}>
            {busy
              ? 'Saving…'
              : failed
                ? 'Retry link update'
                : pending.role === null
                  ? 'Turn off link'
                  : pending.replacing
                    ? 'Replace link'
                    : `Create ${pending.role === 'editor' ? 'edit' : 'view'} link`}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
