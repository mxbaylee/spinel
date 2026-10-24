import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';

type Connection = {
  id: string;
  name: string;
  redirectOrigin: string;
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
  scopes: string[];
  userName?: string;
};

export function AssistantConnections({ admin = false }: { admin?: boolean }) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const path = admin ? 'admin/connections' : 'connections';
  const Heading = admin ? 'h3' : 'h2';

  const mounted = useRef(false);
  const generation = useRef(0);
  async function refresh() {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    const current = () => {
      if (!mounted.current || generation.current !== request)
        throw new Error('This connection view is no longer current.');
    };
    try {
      const result = await api<{ connections: Connection[] }>(path, undefined, current);
      current();
      setConnections(result.connections);
    } catch {
      if (mounted.current && generation.current === request)
        setError('Could not load connected assistants. Try again.');
    } finally {
      if (mounted.current && generation.current === request) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [path]);

  async function disconnect(id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`connections/${encodeURIComponent(id)}/revoke`, {});
      setConnections(
        (current) =>
          current?.map((connection) =>
            connection.id === id ? { ...connection, revoked: true } : connection,
          ) ?? null,
      );
      setNotice('Assistant disconnected. It can no longer access your documents.');
    } catch {
      setError('Could not disconnect the assistant. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={admin ? undefined : 'welcome'} aria-label="Connected assistants">
      <Heading>Connected assistants</Heading>
      {admin ? (
        <p>Account names and connection activity only. No secrets or document contents.</p>
      ) : (
        <>
          <p>
            Add this server address in your assistant, then sign in to Spinel and choose Allow.
            Assistants only have the document access your account allows. Disconnect them here at
            any time.
          </p>
          <label>
            MCP server address
            <input
              readOnly
              value={`${location.origin}/mcp`}
              onFocus={(event) => event.target.select()}
            />
          </label>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button
        className={admin ? 'sp-control' : undefined}
        disabled={busy || loading}
        onClick={() => void refresh()}
      >
        Refresh connected assistants
      </button>
      {loading ? (
        <p role="status">Loading connected assistants…</p>
      ) : connections?.length ? (
        <ul aria-label="Assistant connections">
          {connections.map((connection) => (
            <li key={connection.id}>
              <strong>{connection.name}</strong>
              {admin && <> · {connection.userName}</>} ·{' '}
              {connection.revoked ? 'Disconnected' : 'Connected'}
              <p>
                Return address: <bdi>{connection.redirectOrigin}</bdi>
              </p>
              <p>
                Created {new Date(connection.createdAt).toLocaleString()} · Last used{' '}
                {connection.lastUsedAt === null
                  ? 'Never'
                  : new Date(connection.lastUsedAt).toLocaleString()}
              </p>
              {!admin && !connection.revoked && (
                <button disabled={busy} onClick={() => void disconnect(connection.id)}>
                  Disconnect {connection.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : connections ? (
        <p>No connected assistants yet.</p>
      ) : null}
    </section>
  );
}
