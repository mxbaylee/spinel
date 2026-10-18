import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from '@simplewebauthn/browser';
import type {
  RegistrationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import { signSetupProof } from './setup.ts';
import { api } from './api.ts';
import { BackupStatus } from './BackupStatus.tsx';
import { AdminUsers } from './AdminUsers.tsx';
import { Dashboard } from './Dashboard.tsx';
import { PinsProvider, PinnedSidebar } from './Pins.tsx';

const VersionPreview = lazy(() =>
  import('./VersionPreview.tsx').then((m) => ({ default: m.VersionPreview })),
);

type User = { id: string; name: string; isAdmin: boolean };
type Passkey = { id: string; name: string; provider: string };

export function App() {
  const unsaved = useRef(false);
  const navigation = {
    allow() {
      if (
        unsaved.current &&
        !window.confirm('Your changes have not been saved. Leave and discard unsaved changes?')
      )
        return false;
      unsaved.current = false;
      return true;
    },
    dirty(value: boolean) {
      unsaved.current = value;
    },
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [keys, setKeys] = useState<Passkey[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ cancelled: boolean; challengeId?: string } | null>(null);
  const settings = location.pathname === '/settings';
  const setup = location.pathname === '/setup';
  const invitation = location.pathname === '/invite';
  const [inviteToken] = useState(() =>
    invitation ? (new URLSearchParams(location.search).get('token') ?? '') : '',
  );
  const [inviteDetails, setInviteDetails] = useState<{ recovery: boolean; name: string } | null>(
    null,
  );
  const [inviteName, setInviteName] = useState('');
  const [setupLink] = useState(() => (setup ? location.hash.slice(1).split('.') : []));
  const [setupId, setupSecret] = setupLink;
  const refreshKeys = async () =>
    setKeys((await api<{ passkeys: Passkey[] }>('passkeys')).passkeys);
  useEffect(() => {
    if (invitation) {
      history.replaceState(null, '', '/invite');
      void api<{ recovery: boolean; name: string }>('invite/details', { token: inviteToken })
        .then((details) => {
          setInviteDetails(details);
          setInviteName(details.name);
        })
        .catch((failure) => setError(failure.message))
        .finally(() => setLoaded(true));
      return;
    }
    if (setup) {
      history.replaceState(null, '', '/setup');
      setLoaded(true);
      return;
    }
    void api<{ user: User }>('session')
      .then(async ({ user }) => {
        setUser(user);
        if (settings) await refreshKeys();
      })
      .catch(() => {
        if (location.pathname !== '/sign-in') location.assign('/sign-in');
      })
      .finally(() => setLoaded(true));
  }, [settings, setup, invitation, inviteToken]);

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
      const kind = setup
        ? 'setup'
        : invitation
          ? 'invite'
          : register
            ? 'registration'
            : 'authentication';
      const { options, challengeId } = await api<{
        options: PublicKeyCredentialCreationOptionsJSON & PublicKeyCredentialRequestOptionsJSON;
        challengeId: string;
      }>(
        `${kind}/options`,
        setup ? { setupId } : invitation ? { token: inviteToken, name: inviteName } : {},
      );
      current.challengeId = challengeId;
      if (current.cancelled) {
        void api('cancel', { challengeId }).catch(() => {});
        return;
      }
      const response = register
        ? await startRegistration({ optionsJSON: options })
        : await startAuthentication({ optionsJSON: options });
      if (current.cancelled) return;
      const proof = setup
        ? await signSetupProof(
            setupSecret,
            setupId,
            options.challenge,
            response as RegistrationResponseJSON,
          )
        : undefined;
      if (current.cancelled) return;
      const result = await api<{ redirect?: string; name?: string }>(`${kind}/verify`, {
        challengeId,
        response,
        ...(setup ? { setupId, proof } : invitation ? { token: inviteToken } : {}),
      });
      if (current.cancelled) return;
      if (register && !setup && !invitation) {
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
    const hadUnsavedChanges = unsaved.current;
    if (!navigation.allow()) return;
    cancel();
    try {
      await api('sign-out', {});
      location.assign('/sign-in');
    } catch {
      unsaved.current ||= hadUnsavedChanges;
      setError('Could not sign out. Check your connection and try again.');
    }
  }
  return (
    <PinsProvider enabled={Boolean(user && !user.isAdmin)}>
      <div className="workspace">
        <header
          onClick={(event) => {
            if (
              (event.target as Element).closest('a') &&
              !event.metaKey &&
              !event.ctrlKey &&
              !navigation.allow()
            )
              event.preventDefault();
          }}
        >
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
        <div className="workspace-body">
          {user && !user.isAdmin && <PinnedSidebar navigation={navigation} />}
          <main>
            {!loaded ? (
              <p role="status">Loading…</p>
            ) : setup ? (
              <>
                <p className="eyebrow">A new workspace</p>
                <h1>Set up Spinel</h1>
                <section className="welcome">
                  <h2>Create your admin passkey</h2>
                  <p>
                    Your admin account manages the workspace. It cannot open documents; you will
                    invite a separate everyday account for that.
                  </p>
                  {setupId && setupSecret ? (
                    <button className="primary" disabled={busy} onClick={() => void ceremony(true)}>
                      Create admin passkey
                    </button>
                  ) : (
                    <p role="alert">
                      Open the one-time setup link printed on the server. If it expired, run the
                      setup command again.
                    </p>
                  )}
                </section>
              </>
            ) : invitation ? (
              <>
                <p className="eyebrow">Your private workspace</p>
                <h1>{inviteDetails?.recovery ? 'Recover your account' : 'Join Spinel'}</h1>
                {inviteDetails && (
                  <section className="welcome">
                    {inviteDetails.recovery ? (
                      <>
                        <h2>{inviteDetails.name}</h2>
                        <p>
                          Adding your new passkey will replace all old passkeys and sign out your
                          other devices. Your account and documents stay yours.
                        </p>
                      </>
                    ) : (
                      <label>
                        Your name
                        <input
                          value={inviteName}
                          maxLength={80}
                          onChange={(event) => setInviteName(event.target.value)}
                          autoComplete="name"
                        />
                      </label>
                    )}
                    <button
                      className="primary"
                      disabled={busy || !inviteName.trim()}
                      onClick={() => void ceremony(true)}
                    >
                      {inviteDetails.recovery ? 'Recover with a passkey' : 'Join with a passkey'}
                    </button>
                  </section>
                )}
              </>
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
                    Add a passkey from another device or password manager so you can sign in there
                    too.
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
                  <p>
                    Invite people or help them recover their passkeys. Use a separate everyday
                    account for documents.
                  </p>
                  <AdminUsers currentId={user.id} />
                  <BackupStatus />
                </section>
              </>
            ) : location.pathname === '/preview' ? (
              <Suspense fallback={<p>Loading preview…</p>}>
                <VersionPreview />
              </Suspense>
            ) : (
              <Dashboard navigation={navigation} />
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
      </div>
    </PinsProvider>
  );
}
