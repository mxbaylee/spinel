import { useEffect, useState } from 'react';
import { api } from './api.ts';

type Token = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
  userId?: string;
  userName?: string;
};

export function AccessTokens({ admin = false }: { admin?: boolean }) {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<{ id: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const path = admin ? 'admin/tokens' : 'tokens';
  const limitReached = (tokens?.filter((token) => !token.revoked).length ?? 0) >= 10;
  const Heading = admin ? 'h3' : 'h2';

  useEffect(() => {
    let disposed = false;
    void api<{ tokens: Token[] }>(path)
      .then((result) => {
        if (!disposed) setTokens(result.tokens);
      })
      .catch(() => {
        if (!disposed) setError('Could not load access tokens. Try again.');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [path]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setTokens((await api<{ tokens: Token[] }>(path)).tokens);
    } catch {
      setError('Could not load access tokens. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    setBusy(true);
    setError('');
    setNotice('');
    setSecret(null);
    try {
      const created = await api<{ id: string; token: string }>('tokens', { name: name.trim() });
      setSecret(created);
      setName('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the token. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`tokens/${encodeURIComponent(id)}/revoke`, {});
      setTokens(
        (current) =>
          current?.map((token) => (token.id === id ? { ...token, revoked: true } : token)) ?? null,
      );
      if (secret?.id === id) setSecret(null);
      setNotice('Token revoked. It can no longer access your documents.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke the token. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.token);
      setNotice('Access token copied.');
    } catch {
      setNotice('Select the token and copy it manually.');
    }
  }

  return (
    <section className={admin ? undefined : 'welcome'} aria-label="Personal access tokens">
      <Heading>Personal access tokens</Heading>
      {admin ? (
        <p>
          Account token names and activity only. Token secrets and document contents are never
          shown.
        </p>
      ) : (
        <>
          <p>
            Advanced programmatic access for scripts or clients that require a token. Each token can
            list, read and edit the documents your account allows. Keep it secret and revoke it when
            you are done. Tokens do not expire.
          </p>
          <label>
            Token server address
            <input
              readOnly
              value={`${location.origin}/mcp`}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && !loading && tokens && !limitReached && name.trim()) void create();
            }}
          >
            <label>
              Token name
              <input
                value={name}
                required
                maxLength={80}
                disabled={busy || loading || !tokens || limitReached}
                onChange={(event) => setName(event.target.value)}
                placeholder="For example, my local script"
              />
            </label>
            <button disabled={busy || loading || !tokens || limitReached || !name.trim()}>
              Create access token
            </button>
            {limitReached && <p>You have 10 active tokens. Revoke one before creating another.</p>}
          </form>
          {secret && (
            <div>
              <p>
                Copy this token now into your client’s connection settings. It will not be shown
                again after you leave this page.
              </p>
              <label>
                New access token
                <input readOnly value={secret.token} onFocus={(event) => event.target.select()} />
              </label>
              <button onClick={() => void copy()}>Copy access token</button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button disabled={busy || loading} onClick={() => void refresh()}>
        Refresh access tokens
      </button>
      {loading ? (
        <p role="status">Loading access tokens…</p>
      ) : tokens?.length ? (
        <ul aria-label="Access tokens">
          {tokens.map((token) => (
            <li key={token.id}>
              <strong>{token.name}</strong>
              {admin && <> · {token.userName}</>} · {token.revoked ? 'Revoked' : 'Active'}
              <p>
                Created {new Date(token.createdAt).toLocaleString()} · Last used{' '}
                {token.lastUsedAt === null ? 'Never' : new Date(token.lastUsedAt).toLocaleString()}
              </p>
              {!admin && !token.revoked && (
                <button disabled={busy} onClick={() => void revoke(token.id)}>
                  Revoke {token.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : tokens ? (
        <p>No access tokens yet.</p>
      ) : null}
    </section>
  );
}
