import { useLayoutEffect, useRef, useState } from 'react';
import { itemsRequest } from './itemsApi.ts';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
type State = { enabled: boolean; role: 'viewer' | 'editor'; url?: string | null };
export function ShareLink({ id, space = false }: { id: string; space?: boolean }) {
  const [state, setState] = useState<State>({ enabled: false, role: 'viewer' });
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const [pending, setPending] = useState<'viewer' | 'editor' | null | undefined>(undefined);
  const generation = useRef(0);
  const verify = (request: number) => () => {
    if (request !== generation.current) throw new Error('This sharing view is no longer current.');
  };
  useLayoutEffect(() => {
    const request = ++generation.current;
    setState({ enabled: false, role: 'viewer' });
    setRole('viewer');
    setBusy(true);
    setError('');
    setPending(undefined);
    void itemsRequest<State>(`/${id}/link`, 'GET', undefined, verify(request))
      .then((value) => {
        if (request === generation.current) {
          setState(value);
          setRole(value.role);
        }
      })
      .catch((cause) => {
        if (request === generation.current) setError(cause.message);
      })
      .finally(() => {
        if (request === generation.current) setBusy(false);
      });
    return () => {
      generation.current++;
    };
  }, [id]);
  const change = async (role: 'viewer' | 'editor' | null) => {
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const value = await itemsRequest<State>(`/${id}/link`, 'PUT', { role }, verify(request));
      if (request !== generation.current) return;
      setState(value);
      setPending(undefined);
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not change the link.');
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const requestChange = (next: 'viewer' | 'editor' | null) => {
    if (space) {
      setError('');
      setPending(next);
    } else void change(next);
  };
  return (
    <section aria-label="Guest link">
      <h4>Share without an account</h4>
      <p>
        {space
          ? 'Anyone with this link can open every current and future page in this Space. Can edit also allows adding, renaming, moving, and deleting its pages and folders. Guests cannot manage sharing or use account history and recovery. Social previews show only the Space title and type.'
          : 'Anyone with this link can open this document. Shared links show the document title and type in social previews.'}{' '}
        Guest sessions last 24 hours. Personal collaborator names are hidden while link sharing is
        on. Changing the link reconnects open editors.
      </p>
      <label>
        Link access{' '}
        <select
          value={role}
          disabled={busy}
          onChange={(event) => setRole(event.target.value as 'viewer' | 'editor')}
        >
          <option value="viewer">View only</option>
          <option value="editor">Can edit</option>
        </select>
      </label>
      <button disabled={busy} onClick={() => requestChange(role)}>
        {state.enabled ? 'Create replacement link' : 'Create guest link'}
      </button>
      {state.enabled && (
        <button disabled={busy} onClick={() => requestChange(null)}>
          Turn link off
        </button>
      )}
      <p role="status">
        {state.enabled
          ? 'Link sharing is on. A replacement disables the previous link.'
          : 'Link sharing is off.'}
      </p>
      {state.url && (
        <label>
          Guest link address{' '}
          <input readOnly value={state.url} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
      {state.enabled && !state.url && (
        <p>Create a replacement to copy a new address. Existing links keep working until then.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {space && pending !== undefined && (
        <Modal
          open
          title={pending === null ? 'Turn off this Space link?' : 'Share the whole Space?'}
          icon="space"
          dismissDisabled={busy}
          onOpenChange={(open) => {
            if (!open) setPending(undefined);
          }}
          description={
            pending === null
              ? 'Every guest using this link will lose access to the Space and all its pages.'
              : `Anyone with the new link can ${pending === 'editor' ? 'edit' : 'view'} every current and future page and folder in this Space. ${state.enabled ? 'The previous link and its guest sessions will stop working.' : 'Child pages cannot have separate guest access.'}`
          }
        >
          {error && <p role="alert">{error}</p>}
          <div className="item-actions">
            <Button primary disabled={busy} onClick={() => void change(pending)}>
              {busy
                ? 'Saving…'
                : pending === null
                  ? 'Turn link off'
                  : `Create ${pending === 'editor' ? 'edit' : 'view'} link`}
            </Button>
            <Button disabled={busy} onClick={() => setPending(undefined)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
