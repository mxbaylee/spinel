import { useEffect, useState } from 'react';
import { api } from './api.ts';

type PendingConnection = {
  request: string;
  name: string;
  redirectOrigin: string;
  scopes: string[];
  expiresAt: number;
};

export function ConnectAssistant({
  request,
  user,
}: {
  request: string | null;
  user: { name: string; isAdmin: boolean };
}) {
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [expired, setExpired] = useState(false);
  const [atCapacity, setAtCapacity] = useState(false);

  useEffect(() => {
    if (!request || user.isAdmin) return;
    let disposed = false;
    void api<PendingConnection>(`oauth/pending/${request}`)
      .then((result) => {
        if (!disposed) setPending(result);
      })
      .catch((cause: { status?: number }) => {
        if (disposed) return;
        if (cause.status === 410) setExpired(true);
        else if (cause.status === 403) setUnavailable(true);
        else setError('Could not load this connection request. Try again.');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [request, user.isAdmin]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, pending.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [pending]);

  async function decide(allow: boolean) {
    if (!request || !pending || busy || expired) return;
    setBusy(true);
    setError('');
    setAtCapacity(false);
    try {
      const { redirect } = await api<{ redirect: string }>(`oauth/pending/${request}`, { allow });
      // The server returns only the registered callback after validating this transaction.
      location.assign(redirect);
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status === 410) setExpired(true);
      else if (status === 403) setUnavailable(true);
      else if (status === 409) setAtCapacity(true);
      else setError('Could not finish this connection request. Try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Connect an assistant</h1>
      <section className="welcome" aria-label="Assistant consent">
        {user.isAdmin ? (
          <p role="alert">
            Admin accounts cannot connect assistants. Sign out and use your everyday account.
          </p>
        ) : !request || expired ? (
          <p role="alert">
            This connection request has expired or is no longer available. Start again from your
            assistant.
          </p>
        ) : unavailable ? (
          <p role="alert">
            This connection request is not available in this session. Start again from your
            assistant.
          </p>
        ) : loading ? (
          <p role="status">Loading connection request…</p>
        ) : (
          <>
            {pending && (
              <>
                <h2>{pending.name}</h2>
                <p>This name is provided by the assistant and has not been verified by Spinel.</p>
                <p>
                  Return address: <bdi>{pending.redirectOrigin}</bdi>
                </p>
                <p>
                  Signed in as <strong>{user.name}</strong>. Allow this assistant to:
                </p>
                <ul>
                  {pending.scopes.includes('documents:read') && (
                    <li>List and read documents you can access.</li>
                  )}
                  {pending.scopes.includes('documents:write') && (
                    <li>Edit documents you have permission to edit.</li>
                  )}
                </ul>
                <p>
                  Only continue if you started this request and trust this assistant. You can
                  disconnect it in Settings at any time.
                </p>
                <button className="primary" disabled={busy} onClick={() => void decide(true)}>
                  Allow
                </button>{' '}
                <button disabled={busy} onClick={() => void decide(false)}>
                  Cancel
                </button>
                {busy && <p role="status">Finishing connection request…</p>}
              </>
            )}
            {atCapacity && (
              <p role="alert">
                You have 10 connected assistants. Disconnect an old assistant in{' '}
                <a href="/settings">Settings</a>, then start again from your assistant.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            {!pending && error && <button onClick={() => location.reload()}>Try again</button>}
          </>
        )}
      </section>
    </>
  );
}
