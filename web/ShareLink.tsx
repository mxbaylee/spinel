import { useEffect, useState } from 'react';
import { itemsRequest } from './itemsApi.ts';
type State = { enabled: boolean; role: 'viewer' | 'editor'; url?: string | null };
export function ShareLink({ id }: { id: string }) {
  const [state, setState] = useState<State>({ enabled: false, role: 'viewer' });
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    void itemsRequest<State>(`/${id}/link`)
      .then((value) => {
        if (!disposed) {
          setState(value);
          setRole(value.role);
        }
      })
      .catch((cause) => {
        if (!disposed) setError(cause.message);
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [id]);
  const change = async (role: 'viewer' | 'editor' | null) => {
    setBusy(true);
    setError('');
    try {
      setState(await itemsRequest<State>(`/${id}/link`, 'PUT', { role }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the link.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Guest link">
      <h4>Share without an account</h4>
      <p>
        Anyone with this link can open this document. Guest sessions last 24 hours. Personal
        collaborator names are hidden while link sharing is on. Changing the link reconnects open
        editors.
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
      <button disabled={busy} onClick={() => void change(role)}>
        {state.enabled ? 'Create replacement link' : 'Create guest link'}
      </button>
      {state.enabled && (
        <button disabled={busy} onClick={() => void change(null)}>
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
    </section>
  );
}
