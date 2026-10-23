import { ProfilePage } from './ProfilePage.tsx';
import { DiagnosticsProvider, useAccountDiagnostics } from './useDiagnostics.tsx';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { ConsoleRecovery } from './ConsoleRecovery.tsx';
import { api, connectionRequest, signInPath } from './api.ts';
import { AdminPage } from './AdminPage.tsx';
import { ConnectAssistant } from './ConnectAssistant.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Space } from './Space.tsx';
import { OfflineSpace } from './OfflineSpace.tsx';
import { spaceHref } from './spaceNavigation.ts';
import { rememberedFileHref } from './fileNavigation.ts';
import { spaceReviewReturnPath } from '../src/shared/spaceReviewRoute.ts';
import { OfflineUnreachable } from './OfflineStatus.tsx';
import { Rail } from './Rail.tsx';
import { useBrowserOnline, useServerConnection } from './useConnectionStatus.ts';
import type { ConnectionState } from './connectionState.ts';
import type { CatalogConnectionDetails } from './ConnectionStatus.tsx';
import { claimDevice, isNetworkFailure, openLocalStart } from './offline/localStart.ts';
import { within } from './offline/shell.ts';
import { setPreparedAccount, setSignOutPending, signOutPending } from './offline/offlineStore.ts';

const HistoryBrowser = lazy(() =>
  import('./HistoryBrowser.tsx').then((m) => ({ default: m.HistoryBrowser })),
);
const SpaceDocEditor = lazy(() =>
  import('./DocEditor.tsx').then((m) => ({ default: m.DocEditor })),
);
const SpaceSheetEditor = lazy(() =>
  import('./SheetEditor.tsx').then((m) => ({ default: m.SheetEditor })),
);

type User = { id: string; name: string; isAdmin: boolean; icon?: string; color?: string };
type Passkey = { id: string; name: string; provider: string };

export function App() {
  return (
    <DiagnosticsProvider>
      <AccountApp />
    </DiagnosticsProvider>
  );
}

function AccountApp() {
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
  const [editorConnection, setEditorConnection] = useState<ConnectionState | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogConnectionDetails | null>(null);
  const serverConnection = useServerConnection(Boolean(user) && editorConnection === null);
  const browserOnline = useBrowserOnline();
  // Local mode (docs/offline.md): the server is unreachable and this device was
  // prepared for an account. `unreachable` is the same outage on an unprepared device.
  const [local, setLocal] = useState<Awaited<ReturnType<typeof openLocalStart>>>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const stopDiagnostics = useAccountDiagnostics(
    user && loaded && !local && !signOutPending() ? user.id : null,
    browserOnline && (editorConnection ?? serverConnection) === 'online',
  );
  const [keys, setKeys] = useState<Passkey[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [finishingRecovery, setFinishingRecovery] = useState(false);
  const attempt = useRef<{ cancelled: boolean; challengeId?: string; finishing?: boolean } | null>(
    null,
  );
  const settings = location.pathname === '/profile' || location.pathname === '/settings';
  useEffect(() => {
    // Offline app shells also honor old bookmarks without a server redirect.
    if (location.pathname === '/settings')
      history.replaceState(null, '', '/profile' + location.search + location.hash);
  }, []);
  const spaceReview = /^\/(?:review\/)?spaces(?:\/|$)/.test(location.pathname);
  const connecting = location.pathname === '/connect';
  const [connectRequest] = useState(connectionRequest);
  const [spaceReturn] = useState(() => spaceReviewReturnPath(location));
  const setup = location.pathname === '/setup';
  const adminRecovery = location.pathname === '/recover-admin';
  const consoleClaim = setup || adminRecovery;
  const [recoveryName, setRecoveryName] = useState('');
  const invitation = location.pathname === '/invite';
  const [inviteToken] = useState(() =>
    invitation ? (new URLSearchParams(location.search).get('token') ?? '') : '',
  );
  const [inviteDetails, setInviteDetails] = useState<{ recovery: boolean; name: string } | null>(
    null,
  );
  const [inviteName, setInviteName] = useState('');
  const [setupLink] = useState(() => (consoleClaim ? location.hash.slice(1).split('.') : []));
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
    if (adminRecovery) {
      history.replaceState(null, '', '/recover-admin');
      if (!setupId || !setupSecret) {
        setLoaded(true);
        return;
      }
      void api<{ name: string }>('recover-admin/details', { setupId })
        .then(({ name }) => setRecoveryName(name))
        .catch((failure) => setError(failure.message))
        .finally(() => setLoaded(true));
      return;
    }
    if (setup) {
      history.replaceState(null, '', '/setup');
      setLoaded(true);
      return;
    }
    void (async () => {
      try {
        if (signOutPending()) {
          // A sign-out made offline: revoke the session before anything else.
          // Any server answer settles it, including a session that already ended.
          await api('sign-out', {}).catch((failure) => {
            if (isNetworkFailure(failure)) throw failure;
          });
          setSignOutPending(false);
          if (location.pathname !== '/sign-in') location.assign(signInPath());
          return;
        }
        const { user } = await api<{ user: User }>('session');
        // Claim the device first: the dashboard reads the pointer when it mounts.
        // IndexedDB can fail to answer at all; never hold sign-in on it.
        await within(claimDevice(user), 3000, 'Offline data did not answer.').catch(() => {});
        setUser(user);
        if (connectRequest && location.pathname === '/sign-in')
          location.assign(`/connect?request=${encodeURIComponent(connectRequest)}`);
        else if (spaceReturn && !user.isAdmin) location.assign(spaceReturn);
        if (settings) await refreshKeys();
      } catch (failure) {
        // Only an unreachable server opens local data; a 401 still signs in.
        if (!isNetworkFailure(failure)) {
          // The server ended this session (sign-out, revocation): stop offline
          // access too. claimDevice restores it after the next sign-in.
          if ((failure as { status?: number }).status === 401) setPreparedAccount(null);
          if (location.pathname !== '/sign-in') location.assign(signInPath());
          return;
        }
        // Authorizing an assistant always needs a live, verified session.
        if (connecting || connectRequest) {
          setUnreachable(true);
          return;
        }
        const start = await openLocalStart().catch(() => null);
        if (!start || !start.isCurrent()) {
          setUnreachable(true);
          return;
        }
        if (location.pathname === '/sign-in') history.replaceState(null, '', spaceReturn ?? '/');
        setLocal(start);
        setUser({ ...start.user, isAdmin: false });
      } finally {
        setLoaded(true);
      }
    })();
  }, [
    settings,
    setup,
    adminRecovery,
    setupId,
    setupSecret,
    invitation,
    inviteToken,
    connecting,
    connectRequest,
    spaceReview,
    spaceReturn,
  ]);
  useLayoutEffect(() => {
    if (!local) return;
    // Another tab signed out or another account signed in: close local data.
    const watch = () => {
      if (local.isCurrent()) return;
      setLocal(null);
      setUser(null);
      setUnreachable(true);
    };
    window.addEventListener('storage', watch);
    // A storage event may have arrived between the async read and publication.
    // Recheck before paint instead of waiting for another event to clear titles.
    watch();
    return () => window.removeEventListener('storage', watch);
  }, [local]);

  function cancel() {
    const current = attempt.current;
    if (!current || current.finishing) return;
    current.cancelled = true;
    WebAuthnAbortService.cancelCeremony();
    if (current.challengeId)
      void api('cancel', { challengeId: current.challengeId }).catch(() => {});
    setBusy(false);
    setNotice('Passkey request cancelled.');
  }
  async function ceremony(register: boolean) {
    if (adminRecovery && attempt.current && !attempt.current.cancelled) return;
    const current: { cancelled: boolean; challengeId?: string; finishing?: boolean } = {
      cancelled: false,
    };
    attempt.current = current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!window.PublicKeyCredential || !window.isSecureContext)
        throw new Error('Passkeys need a supported browser at Spinel’s secure address.');
      const kind = adminRecovery
        ? 'recover-admin'
        : setup
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
        consoleClaim ? { setupId } : invitation ? { token: inviteToken, name: inviteName } : {},
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
      const proof = consoleClaim
        ? await signSetupProof(
            setupSecret,
            setupId,
            options.challenge,
            response as RegistrationResponseJSON,
            adminRecovery,
          )
        : undefined;
      if (current.cancelled) return;
      // Verification may commit even if the browser stops waiting. Recovery cannot
      // be cancelled after submitting the credential swap. Keep its result authoritative.
      if (adminRecovery) {
        current.finishing = true;
        setFinishingRecovery(true);
      }
      const result = await api<{ redirect?: string; name?: string }>(`${kind}/verify`, {
        challengeId,
        response,
        ...(consoleClaim ? { setupId, proof } : invitation ? { token: inviteToken } : {}),
      });
      if (current.cancelled) return;
      if (register && !consoleClaim && !invitation) {
        await refreshKeys();
        setNotice(`${result.name} added. You can use it to sign in.`);
      } else
        location.assign(
          connectRequest && !consoleClaim && !invitation
            ? `/connect?request=${encodeURIComponent(connectRequest)}`
            : spaceReturn && !consoleClaim && !invitation && result.redirect !== '/admin'
              ? spaceReturn
              : (result.redirect ?? '/'),
        );
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
        setFinishingRecovery(false);
      }
    }
  }
  async function signOut() {
    const hadUnsavedChanges = unsaved.current;
    if (!navigation.allow()) return;
    stopDiagnostics();
    cancel();
    // Lock this device's offline data at once; it opens again only for the
    // account that next signs in online.
    setPreparedAccount(null);
    if (local) {
      // Offline, the server session can't be revoked yet: do it on the next start.
      setSignOutPending(true);
      location.assign('/sign-in');
      return;
    }
    try {
      await api('sign-out', {});
      location.assign('/sign-in');
    } catch {
      unsaved.current ||= hadUnsavedChanges;
      setError('Could not sign out. Check your connection and try again.');
    }
  }
  if (adminRecovery)
    return (
      <ConsoleRecovery
        name={recoveryName}
        loading={!loaded}
        validLink={Boolean(setupId && setupSecret)}
        busy={busy}
        finishing={finishingRecovery}
        error={error}
        notice={notice}
        onRecover={() => void ceremony(true)}
        onCancel={cancel}
      />
    );
  if (spaceReview) {
    if (!loaded)
      return (
        <main className="space-bootstrap">
          <p role="status">Loading…</p>
        </main>
      );
    if (unreachable)
      return (
        <main className="space-bootstrap">
          <OfflineUnreachable />
        </main>
      );
    if (!user || user.isAdmin)
      return (
        <main className="space-bootstrap">
          <p role="alert">This Space is not available.</p>
        </main>
      );
    if (local)
      return (
        <OfflineSpace
          local={local}
          user={user}
          onExit={() => location.assign(rememberedFileHref(user.id))}
          onProfile={() => location.assign('/profile')}
        />
      );
    return (
      <>
        {error && <p role="alert">{error}</p>}
        <Space
          key={user.id}
          user={user}
          navigation={navigation}
          connection={browserOnline ? (editorConnection ?? serverConnection) : 'offline'}
          onExit={() => location.assign(rememberedFileHref(user.id))}
          onConnectionState={setEditorConnection}
          renderEditor={({ spaceId, item, onDirty, onConnectionState, saveStatusTarget }) => (
            <Suspense fallback={<p role="status">Opening page…</p>}>
              {item.kind === 'doc' ? (
                <SpaceDocEditor
                  key={spaceId + ':' + item.id}
                  saveStatusTarget={saveStatusTarget}
                  spaceId={spaceId}
                  id={item.id}
                  name={item.name}
                  onDirty={onDirty}
                  onConnectionState={onConnectionState}
                />
              ) : (
                <SpaceSheetEditor
                  key={spaceId + ':' + item.id}
                  saveStatusTarget={saveStatusTarget}
                  spaceId={spaceId}
                  id={item.id}
                  name={item.name}
                  onDirty={onDirty}
                  onConnectionState={onConnectionState}
                />
              )}
            </Suspense>
          )}
        />
      </>
    );
  }
  return (
    <div
      className={`workspace${settings ? ' profile-workspace' : user?.isAdmin ? ' admin-workspace' : ''}`}
    >
      <Rail
        user={user}
        compact={settings || !!user?.isAdmin}
        navigation={navigation}
        onSignOut={() => void signOut()}
        connection={browserOnline ? (editorConnection ?? serverConnection) : 'offline'}
        catalog={catalogStatus}
        documentOpen={editorConnection !== null}
      />
      <div className="workspace-body">
        <main>
          {!loaded ? (
            <p role="status">Loading…</p>
          ) : unreachable ? (
            <OfflineUnreachable />
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
                    Open the one-time setup link printed on the server. If it expired, run the setup
                    command again.
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
          ) : connecting ? (
            <ConnectAssistant request={connectRequest} user={user} />
          ) : local && location.pathname === '/preview' ? (
            <p role="status">Version history needs a connection.</p>
          ) : settings ? (
            <ProfilePage
              user={user}
              offline={Boolean(local)}
              onSaved={(profile) => setUser({ ...user, ...profile })}
              onSignOut={() => void signOut()}
              passkeys={
                <section aria-labelledby="passkeys-heading">
                  <h2 id="passkeys-heading">Your passkeys</h2>
                  <p>
                    Add a passkey from another device or password manager so you can sign in there
                    too.
                  </p>
                  {keys.length ? (
                    <ul className="profile-passkeys">
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
              }
            />
          ) : user.isAdmin ? (
            <AdminPage key={user.id} currentId={user.id} />
          ) : location.pathname === '/preview' ? (
            <Suspense fallback={<p>Loading preview…</p>}>
              <HistoryBrowser />
            </Suspense>
          ) : (
            <Dashboard
              navigation={navigation}
              user={user}
              local={local}
              onConnectionState={setEditorConnection}
              onCatalogStatus={setCatalogStatus}
              onOpen={(item) => {
                if (item.kind === 'space') location.assign(spaceHref(item.id));
              }}
            />
          )}
          {!adminRecovery && busy && (
            <p role="status">
              Follow the instructions from your passkey manager.{' '}
              <button onClick={cancel}>Cancel</button>
            </p>
          )}
          {!adminRecovery && error && <p role="alert">{error}</p>}
          {!adminRecovery && notice && <p role="status">{notice}</p>}
        </main>
      </div>
    </div>
  );
}
