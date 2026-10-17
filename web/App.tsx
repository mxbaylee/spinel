import { useEffect, useRef, useState } from 'react';
import {
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

type User = { id: string; name: string; isAdmin: boolean };
type Passkey = { id: string; name: string; provider: string };
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/auth/${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [keys, setKeys] = useState<Passkey[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ cancelled: boolean; challengeId?: string } | null>(null);
  const settings = location.pathname === '/settings';
  const refreshKeys = async () =>
    setKeys((await api<{ passkeys: Passkey[] }>('passkeys')).passkeys);
  useEffect(() => {
    void api<{ user: User }>('session')
      .then(async ({ user }) => {
        setUser(user);
        if (settings) await refreshKeys();
      })
      .catch(() => {
        if (location.pathname !== '/sign-in') location.assign('/sign-in');
      })
      .finally(() => setLoaded(true));
  }, [settings]);

  function cancel() {
    const current = attempt.current;
    if (!current) return;
    current.cancelled = true;
    WebAuthnAbortService.cancelCeremony();
    if (current.challengeId)
      void api('cancel', { challengeId: current.challengeId }).catch(() => {});
    setBusy(false);
    setNotice('Passkey request cancelled.');
  }
  async function ceremony(register: boolean) {
    const current: { cancelled: boolean; challengeId?: string } = { cancelled: false };
    attempt.current = current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!window.PublicKeyCredential || !window.isSecureContext)
        throw new Error('Passkeys need a supported browser at Spinel’s secure address.');
      const kind = register ? 'registration' : 'authentication';
      const { options, challengeId } = await api<{
        options: PublicKeyCredentialCreationOptionsJSON & PublicKeyCredentialRequestOptionsJSON;
        challengeId: string;
      }>(`${kind}/options`, {});
      current.challengeId = challengeId;
      if (current.cancelled) {
        void api('cancel', { challengeId }).catch(() => {});
        return;
      }
      const response = register
        ? await startRegistration({ optionsJSON: options })
        : await startAuthentication({ optionsJSON: options });
      if (current.cancelled) return;
      const result = await api<{ redirect?: string; name?: string }>(`${kind}/verify`, {
        challengeId,
        response,
      });
      if (current.cancelled) return;
      if (register) {
        await refreshKeys();
        setNotice(`${result.name} added. You can use it to sign in.`);
      } else location.assign(result.redirect ?? '/');
    } catch (failure) {
      if (!current.cancelled) {
        // Browser exception names vary across providers; keep the retry action clear.
        setError(
          failure instanceof DOMException ||
            (failure instanceof Error &&
              /^(NotAllowed|Abort|InvalidState|Security|Unknown)Error$/.test(failure.name))
            ? 'Passkey request did not finish. Try again and choose your passkey manager.'
            : failure instanceof Error && failure.name === 'Error'
              ? failure.message
              : 'Could not use this passkey. Try again or contact the operator.',
        );
      }
      if (current.challengeId)
        void api('cancel', { challengeId: current.challengeId }).catch(() => {});
    } finally {
      if (attempt.current === current) {
        attempt.current = null;
        setBusy(false);
      }
    }
  }
  async function signOut() {
    cancel();
    try {
      await api('sign-out', {});
      location.assign('/sign-in');
    } catch {
      setError('Could not sign out. Check your connection and try again.');
    }
  }
  return (
    <div className="workspace">
      <header>
        <a className="brand" href="/">
          Spinel
        </a>
        {user && (
          <nav aria-label="Workspace">
            <a href={user.isAdmin ? '/admin' : '/'}>{user.isAdmin ? 'Admin' : 'Dashboard'}</a>
            <a href="/settings">Settings</a>
            <button onClick={() => void signOut()}>Sign out</button>
          </nav>
        )}
      </header>
      <main>
        {!loaded ? (
          <p role="status">Loading…</p>
        ) : !user ? (
          <>
            <p className="eyebrow">Your private workspace</p>
            <h1>Sign in</h1>
            <section className="welcome">
              <h2>Welcome back</h2>
              <p>Use a passkey from your browser, password manager or phone.</p>
              <button className="primary" disabled={busy} onClick={() => void ceremony(false)}>
                Sign in with a passkey
              </button>
              <p className="placeholder">
                Need access or a new passkey? Contact your workspace operator.
              </p>
            </section>
          </>
        ) : settings ? (
          <>
            <p className="eyebrow">{user.name}</p>
            <h1>Settings</h1>
            <section className="welcome">
              <h2>Your passkeys</h2>
              <p>
                Add a passkey from another device or password manager so you can sign in there too.
              </p>
              {keys.length ? (
                <ul>
                  {keys.map((key) => (
                    <li key={key.id}>
                      <strong>{key.name}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No passkeys added yet.</p>
              )}
              <button className="primary" disabled={busy} onClick={() => void ceremony(true)}>
                Add a passkey
              </button>
            </section>
          </>
        ) : user.isAdmin ? (
          <>
            <h1>Admin</h1>
            <section className="welcome">
              <h2>Workspace administration</h2>
              <p>Admin tools are being built. Your account can manage its passkeys in Settings.</p>
            </section>
          </>
        ) : (
          <>
            <p className="eyebrow">Your workspace</p>
            <h1>Dashboard</h1>
            <section aria-labelledby="welcome-title" className="welcome">
              <h2 id="welcome-title">A place for your everyday work</h2>
              <p>Your spreadsheets, documents and slides will live here.</p>
              <p className="placeholder">This workspace is being built. Check back soon.</p>
            </section>
          </>
        )}
        {busy && (
          <p role="status">
            Follow the instructions from your passkey manager.{' '}
            <button onClick={cancel}>Cancel</button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </main>
    </div>
  );
}
