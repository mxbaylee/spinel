import { AuthEntry } from './AuthEntry.tsx';
import { ProfilePage } from './ProfilePage.tsx';
import { PasskeySettings } from './PasskeySettings.tsx';
import { AccountAccessChanged, AccountExitScreen } from './AccountExit.tsx';
import {
  accountExitPending,
  beginAccountExit,
  restoreAccountExit,
  watchAccountExit,
  withAccountRead,
  withAuthentication,
} from './offline/accountExit.ts';
import type { AccountExit } from './offline/accountExit.ts';
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
import { OfflineRecoveryEntry } from './OfflineRecoveryEntry.tsx';
import { spaceHref } from './spaceNavigation.ts';
import { clearDashboardNavigation, dashboardSession } from './dashboardNavigation.ts';
import { rememberedFileHref } from './fileNavigation.ts';
import { spaceReviewReturnPath } from '../src/shared/spaceReviewRoute.ts';
import { OfflineUnreachable } from './OfflineStatus.tsx';
import { Rail } from './Rail.tsx';
import { useBrowserOnline, useServerConnection } from './useConnectionStatus.ts';
import type { ConnectionState } from './connectionState.ts';
import type { CatalogConnectionDetails } from './ConnectionStatus.tsx';
import {
  claimDevice,
  ensureDeviceRuntime,
  isNetworkFailure,
  openLocalStart,
} from './offline/localStart.ts';
import { within } from './offline/shell.ts';
import {
  claimOnlineAccount,
  expirePreparedAccount,
  offlineAccountEvent,
  offlineEpoch,
} from './offline/offlineStore.ts';

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
  const [filePlaces, setFilePlaces] = useState<{
    shared: boolean;
    open: (shared: boolean) => void;
  } | null>(null);
  const [editorConnection, setEditorConnection] = useState<ConnectionState | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogConnectionDetails | null>(null);
  const serverConnection = useServerConnection(Boolean(user) && editorConnection === null);
  const browserOnline = useBrowserOnline();
  // Local mode (docs/offline.md): the server is unreachable and this device was
  // prepared for an account. `unreachable` is the same outage on an unprepared device.
  const [local, setLocal] = useState<Awaited<ReturnType<typeof openLocalStart>>>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [exit, setExit] = useState<AccountExit | 'unknown' | null>(null);
  const [bootstrap, setBootstrap] = useState(0);
  const [accountLocked, setAccountLocked] = useState(false);
  const accountRetired = useRef(false);
  const stopDiagnostics = useAccountDiagnostics(
    user && loaded && !local && !accountExitPending() ? user.id : null,
    browserOnline && (editorConnection ?? serverConnection) === 'online',
  );
  const [passkeyRevision, setPasskeyRevision] = useState(0);
  const [passkeyProofReset, setPasskeyProofReset] = useState(0);
  const [passkeyAccountReset, setPasskeyAccountReset] = useState(0);
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
  useEffect(() => {
    if (accountRetired.current && !accountExitPending()) return;
    let current = true;
    let admitting = true;
    const verifyCurrent = () => {
      if (!current || accountRetired.current)
        throw new DOMException('This sign-in attempt ended.', 'AbortError');
    };
    const epoch = () => {
      let verifyEpoch = () => {};
      try {
        verifyEpoch = offlineEpoch();
      } catch {
        // Blocked browser storage does not prevent an ordinary online sign-in.
      }
      return () => {
        verifyCurrent();
        verifyEpoch();
      };
    };
    setLoaded(false);
    setUnreachable(false);
    if (invitation) history.replaceState(null, '', '/invite');
    if (adminRecovery) history.replaceState(null, '', '/recover-admin');
    if (setup) history.replaceState(null, '', '/setup');
    void (async () => {
      try {
        const pendingExit = await restoreAccountExit();
        verifyCurrent();
        if (pendingExit) {
          clearDashboardNavigation();
          setUser(null);
          setLocal(null);
          setExit(pendingExit);
          return;
        }
        await withAccountRead(verifyCurrent, async (verifyTransition) => {
          if (invitation) {
            const details = await api<{ recovery: boolean; name: string }>(
              'invite/details',
              { token: inviteToken },
              verifyTransition,
            );
            setInviteDetails(details);
            setInviteName(details.name);
            return;
          }
          if (adminRecovery) {
            if (setupId && setupSecret) {
              const details = await api<{ name: string }>(
                'recover-admin/details',
                { setupId },
                verifyTransition,
              );
              setRecoveryName(details.name);
            }
            return;
          }
          if (setup) return;
          const verifySessionEpoch = epoch();
          const verifySession = () => {
            verifyTransition();
            verifySessionEpoch();
          };
          const { user } = await api<{ user: User }>('session', undefined, verifySession);
          verifySession();
          try {
            claimOnlineAccount(user.id);
          } catch {
            /* Online use remains available. */
          }
          // A verified different account intentionally rotates the offline fence.
          const verifyClaimEpoch = epoch();
          const verifyClaim = () => {
            verifyTransition();
            verifyClaimEpoch();
          };
          const verifyAdmission = () => {
            verifyClaim();
            if (!admitting) throw new DOMException('Offline admission ended.', 'AbortError');
          };
          if (!user.isAdmin) {
            let ready = false;
            try {
              const runtime = await within(
                ensureDeviceRuntime(user.id, verifyAdmission),
                3000,
                'Offline data did not answer.',
              );
              verifyAdmission();
              if (runtime.kind === 'switching') return;
              ready = runtime.kind === 'ready';
            } catch {
              verifyClaim();
            }
            if (ready) {
              await within(
                claimDevice(user, () => current && admitting && !accountRetired.current),
                3000,
                'Offline data did not answer.',
              ).catch(() => {});
              verifyClaim();
            } else {
              setNotice(
                'Offline copies need attention. Saved changes were kept. Review This device in your profile.',
              );
            }
          }
          // A late runtime/IndexedDB result can no longer switch over this UI.
          admitting = false;
          verifyClaim();
          if (user.isAdmin) clearDashboardNavigation();
          else dashboardSession(user.id);
          setUser(user);
          if (connectRequest && location.pathname === '/sign-in')
            location.assign(`/connect?request=${encodeURIComponent(connectRequest)}`);
          else if (spaceReturn && !user.isAdmin) location.assign(spaceReturn);
        });
      } catch (failure) {
        if (!current) return;
        if (accountExitPending()) {
          const pendingExit = await restoreAccountExit();
          if (current && pendingExit) setExit(pendingExit);
          return;
        }
        if (failure instanceof DOMException && failure.name === 'AbortError') return;
        if (consoleClaim || invitation) {
          setError(
            failure instanceof Error ? failure.message : 'Could not open this entry. Try again.',
          );
          return;
        }
        if (!isNetworkFailure(failure)) {
          if ((failure as { status?: number }).status === 401) {
            clearDashboardNavigation();
            expirePreparedAccount();
            if (location.pathname !== '/sign-in') location.assign(signInPath());
          } else {
            setError(
              failure instanceof Error
                ? failure.message
                : 'Could not check your sign-in. Try again.',
            );
          }
          return;
        }
        if (connecting || connectRequest) {
          setUnreachable(true);
          return;
        }
        const start = await within(
          openLocalStart(
            () => current && admitting && !accountRetired.current && !accountExitPending(),
          ),
          3000,
          'Offline data did not answer.',
        ).catch(() => null);
        if (!current || accountRetired.current) return;
        if (!start || !start.isCurrent() || accountExitPending()) {
          setUnreachable(true);
          return;
        }
        admitting = false;
        if (location.pathname === '/sign-in') history.replaceState(null, '', spaceReturn ?? '/');
        dashboardSession(start.user.id);
        setLocal(start);
        setUser({ ...start.user, isAdmin: false });
      } finally {
        admitting = false;
        if (current) setLoaded(true);
      }
    })();
    return () => {
      current = false;
      admitting = false;
    };
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
    bootstrap,
    accountLocked,
  ]);
  useEffect(
    () =>
      watchAccountExit(() => {
        if (accountExitPending()) {
          accountRetired.current = false;
          setAccountLocked(false);
          stopDiagnostics();
          clearDashboardNavigation();
          setUser(null);
          setLocal(null);
          const current = attempt.current;
          if (current) {
            current.cancelled = true;
            if (!current.finishing) WebAuthnAbortService.cancelCeremony();
          }
          if (!exit) setBootstrap((value) => value + 1);
        } else if (!accountRetired.current && !user && !exit && !attempt.current) {
          setBootstrap((value) => value + 1);
        }
      }),
    [user, exit, stopDiagnostics],
  );
  useEffect(() => {
    // Account cancellation also invalidates old history in an online tab.
    const changed = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === 'spinel.offline.cancellation' ||
        (event.key === 'spinel.offline.account' && event.newValue !== user?.id)
      )
        clearDashboardNavigation();
      if (
        event.key === null ||
        event.key === 'spinel.auth.generation' ||
        (user &&
          offlineAccountEvent(event, user.id) &&
          // Removing the last clean copy does not end an ordinary online
          // account or its unrelated memory-only editor. Its nonce is intact.
          !(event.key === 'spinel.offline.account' && event.newValue === null && !local))
      ) {
        stopDiagnostics();
        const active = attempt.current;
        if (active) {
          active.cancelled = true;
          if (!active.finishing) WebAuthnAbortService.cancelCeremony();
        }
        if (accountExitPending()) {
          accountRetired.current = false;
          setAccountLocked(false);
          setUser(null);
          setLocal(null);
          setLoaded(false);
          if (!exit) setBootstrap((value) => value + 1);
          return;
        }
        if (!user) return;
        // A passive fence closes this tab; it never authorizes a new session
        // claim or remount. In particular, do not reopen a retained conflict
        // queue immediately after the native editor has scrubbed held input.
        accountRetired.current = true;
        setAccountLocked(true);
        setUser(null);
        setLocal(null);
        setFilePlaces(null);
        setEditorConnection(null);
        setCatalogStatus(null);
        setError('');
        setNotice('');
        unsaved.current = false;
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [user?.id, local, exit, stopDiagnostics]);
  useLayoutEffect(() => {
    if (!local) return;
    // Another tab signed out or another account signed in: close local data.
    const watch = (event?: StorageEvent) => {
      if (event && !offlineAccountEvent(event, local.user.id)) return;
      if (local.isCurrent()) return;
      clearDashboardNavigation();
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
    setBusy(false);
    setNotice('Passkey request cancelled.');
  }
  async function ceremony(register: boolean, verifyAccount: () => void = () => {}) {
    if (attempt.current && !attempt.current.cancelled) return;
    const current: { cancelled: boolean; challengeId?: string; finishing?: boolean } = {
      cancelled: false,
    };
    attempt.current = current;
    setBusy(true);
    setError('');
    setNotice('');
    const verifyAttempt = () => {
      if (current.cancelled || attempt.current !== current)
        throw new DOMException('This passkey request ended.', 'AbortError');
      verifyAccount();
    };
    try {
      await withAuthentication(
        !register || consoleClaim || invitation,
        verifyAttempt,
        async (verify, prompt) => {
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
            const requestOptions = { accountId: kind === 'registration' ? user?.id : undefined };
            const { options, challengeId } = await api<{
              options: PublicKeyCredentialCreationOptionsJSON &
                PublicKeyCredentialRequestOptionsJSON;
              challengeId: string;
            }>(
              `${kind}/options`,
              consoleClaim
                ? { setupId }
                : invitation
                  ? { token: inviteToken, name: inviteName }
                  : {},
              verify,
              {
                ...requestOptions,
                onAbandonedChallenge: (challengeId) => {
                  current.challengeId = challengeId;
                },
              },
            );
            current.challengeId = challengeId;
            // Options have fully settled. Only the local credential prompt and
            // local proof run in the phase that a later lock owner may retire.
            const { response, proof } = await prompt(async () => {
              const response = register
                ? await startRegistration({ optionsJSON: options })
                : await startAuthentication({ optionsJSON: options });
              verify();
              const proof = consoleClaim
                ? await signSetupProof(
                    setupSecret,
                    setupId,
                    options.challenge,
                    response as RegistrationResponseJSON,
                    adminRecovery,
                  )
                : undefined;
              return { response, proof };
            });
            verify();
            // Keep the transition owned until the dispatched response settles.
            // Cancelling JavaScript cannot undo the server swap or its Set-Cookie.
            current.finishing = true;
            setFinishingRecovery(true);
            const result = await api<{ redirect?: string; name?: string }>(
              `${kind}/verify`,
              {
                challengeId,
                response,
                ...(consoleClaim ? { setupId, proof } : invitation ? { token: inviteToken } : {}),
              },
              verify,
              requestOptions,
            );
            verify();
            if (register && !consoleClaim && !invitation) {
              setPasskeyRevision((revision) => revision + 1);
              setNotice(`${result.name} added. You can use it to sign in.`);
            } else {
              location.assign(
                connectRequest && !consoleClaim && !invitation
                  ? `/connect?request=${encodeURIComponent(connectRequest)}`
                  : spaceReturn && !consoleClaim && !invitation && result.redirect !== '/admin'
                    ? spaceReturn
                    : (result.redirect ?? '/'),
              );
            }
          } catch (failure) {
            if (current.challengeId)
              await api('cancel', { challengeId: current.challengeId }).catch(() => {});
            throw failure;
          }
        },
      );
    } catch (failure) {
      if (!current.cancelled) {
        if (register && (failure as { code?: string }).code === 'account_changed')
          setPasskeyAccountReset((revision) => revision + 1);
        if (register && (failure as { status?: number }).status === 428)
          setPasskeyProofReset((revision) => revision + 1);
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
    } finally {
      if (attempt.current === current) {
        attempt.current = null;
        setBusy(false);
        setFinishingRecovery(false);
      }
    }
  }
  function signOut() {
    if (!user || !navigation.allow()) return;
    lockAccountExit();
  }
  // A confirmed passkey revocation has already ended access and cannot be
  // cancelled by a voluntary-departure prompt. Keep the same local-copy choice.
  function lockAccountExit() {
    if (!user) return;
    stopDiagnostics();
    clearDashboardNavigation();
    const active = attempt.current;
    if (active) {
      active.cancelled = true;
      if (!active.finishing) WebAuthnAbortService.cancelCeremony();
    }
    // No request or inventory read precedes local locking.
    setUser(null);
    setLocal(null);
    setFilePlaces(null);
    setEditorConnection(null);
    setCatalogStatus(null);
    setError('');
    const next = beginAccountExit(user.id, !user.isAdmin);
    history.replaceState(null, '', connecting ? signInPath() : '/sign-in');
    setExit(next);
  }
  if (exit)
    return (
      <AccountExitScreen
        key={exit === 'unknown' ? 'unknown' : exit.intent.id}
        exit={exit}
        onReplace={setExit}
        onContinue={() => {
          setExit(null);
          setError('');
          setBootstrap((value) => value + 1);
        }}
      />
    );
  if (accountLocked) return <AccountAccessChanged onReopen={() => location.reload()} />;
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
        {notice && <p role="status">{notice}</p>}
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
  if (setup || invitation || !user)
    return (
      <AuthEntry
        mode={setup ? 'setup' : invitation ? 'invite' : 'sign-in'}
        loading={!loaded}
        validSetup={Boolean(setupId && setupSecret)}
        inviteDetails={inviteDetails}
        name={inviteName}
        onName={setInviteName}
        busy={busy}
        finishing={finishingRecovery}
        error={error}
        notice={notice}
        unreachable={unreachable}
        onPasskey={() => void ceremony(setup || invitation)}
        onCancel={cancel}
        onHome={() => location.assign(signInPath())}
      />
    );
  if (connecting)
    return (
      <ConnectAssistant
        request={connectRequest}
        user={user}
        onSignOut={() => void signOut()}
        signOutError={error}
      />
    );
  return (
    <div
      className={`workspace${settings || location.pathname === '/preview' ? ' profile-workspace' : user?.isAdmin ? ' admin-workspace' : ''}${location.pathname === '/preview' ? ' history-workspace' : ''}${filePlaces ? ' files-workspace' : ''}`}
    >
      <Rail
        user={user}
        compact={settings || location.pathname === '/preview' || !!user?.isAdmin}
        files={filePlaces}
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
          ) : local && location.pathname === '/preview' ? (
            <p role="status">Version history needs a connection.</p>
          ) : settings ? (
            <ProfilePage
              user={user}
              offline={Boolean(local)}
              onSaved={(profile) => setUser({ ...user, ...profile })}
              onSignOut={() => void signOut()}
              passkeys={
                <PasskeySettings
                  key={user.id}
                  accountId={user.id}
                  adding={busy}
                  isAdmin={user.isAdmin}
                  revision={passkeyRevision}
                  verificationRequired={passkeyProofReset}
                  accountChange={passkeyAccountReset}
                  onAdd={(verifyAccount) => void ceremony(true, verifyAccount)}
                  onSignedOut={lockAccountExit}
                />
              }
            />
          ) : user.isAdmin ? (
            <AdminPage key={user.id} currentId={user.id} />
          ) : location.pathname === '/preview' ? (
            <Suspense fallback={<p>Loading preview…</p>}>
              <HistoryBrowser />
            </Suspense>
          ) : location.pathname === '/' &&
            new URLSearchParams(location.search).has('offlineRecovery') ? (
            <OfflineRecoveryEntry
              key={`${user.id}:${new URLSearchParams(location.search).get('offlineRecovery')}`}
              accountId={user.id}
              itemId={new URLSearchParams(location.search).get('offlineRecovery') ?? ''}
              navigation={navigation}
              connection={browserOnline ? (editorConnection ?? serverConnection) : 'offline'}
              onConnectionState={setEditorConnection}
            />
          ) : (
            <Dashboard
              key={user.id}
              navigation={navigation}
              user={user}
              local={local}
              onConnectionState={setEditorConnection}
              connection={browserOnline ? (editorConnection ?? serverConnection) : 'offline'}
              catalog={catalogStatus}
              onCatalogStatus={setCatalogStatus}
              onPlaces={setFilePlaces}
              onOpen={(item) => {
                if (item.kind === 'space') location.assign(spaceHref(item.id));
              }}
            />
          )}
          {!adminRecovery && busy && (
            <p role="status">
              {finishingRecovery ? (
                'Finishing the passkey request… Keep this page open.'
              ) : (
                <>
                  Follow the instructions from your passkey manager.{' '}
                  <button onClick={cancel}>Cancel</button>
                </>
              )}
            </p>
          )}
          {!adminRecovery && error && <p role="alert">{error}</p>}
          {!adminRecovery && notice && <p role="status">{notice}</p>}
        </main>
      </div>
    </div>
  );
}
