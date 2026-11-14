import { useEffect, useRef, useState } from 'react';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { api } from './api.ts';
import { offlineEpoch } from './offline/offlineStore.ts';
import './profile.css';

type Passkey = {
  id: string;
  name: string;
  provider: string;
  createdAt: number;
  lastUsedAt: number | null;
  current: boolean;
};
type Keys = { passkeys: Passkey[]; verifiedUntil: number | null };
type Action = { kind: 'remove'; key: Passkey } | { kind: 'others' | 'add' };

const accountChanged = 'Your account changed. Reload your profile before changing access.';

/** The displayed account is a consistency check; the cookie alone grants authority. */
export function PasskeySettings({
  accountId,
  onAdd,
  onSignedOut,
  adding = false,
  isAdmin = false,
  revision = 0,
  verificationRequired = 0,
  accountChange = 0,
  authenticate = startAuthentication,
}: {
  accountId: string;
  onAdd: (verifyAccount: () => void) => void;
  onSignedOut: () => void;
  adding?: boolean;
  isAdmin?: boolean;
  revision?: number;
  verificationRequired?: number;
  accountChange?: number;
  authenticate?: typeof startAuthentication;
}) {
  const [data, setData] = useState<Keys | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const [phase, setPhase] = useState<'idle' | 'verifying' | 'saving' | 'uncertain' | 'changed'>(
    'idle',
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsProof, setNeedsProof] = useState(false);
  const [forceProof, setForceProof] = useState(false);
  const [verifyAccount] = useState(() => {
    let verifyEpoch = () => {};
    try {
      verifyEpoch = offlineEpoch();
    } catch {
      // Online security remains available with blocked storage. The server also
      // compares the displayed account with its current authenticated cookie.
    }
    return () => {
      try {
        verifyEpoch();
      } catch {
        throw Object.assign(new Error(accountChanged), { code: 'account_changed' });
      }
    };
  });
  useEffect(() => {
    if (verificationRequired) setForceProof(true);
  }, [verificationRequired]);
  const mounted = useRef(false);
  const serial = useRef(0);
  const request = useRef<AbortController | null>(null);
  const challenge = useRef<string | null>(null);
  const locked = useRef(false);
  const refreshSequence = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const reloadRequired = phase === 'uncertain' || phase === 'changed';
  const busy = adding || phase === 'verifying' || phase === 'saving' || reloadRequired;
  useEffect(() => {
    // The original action is disabled. Wait until the inline recovery button is
    // mounted after closing the dialog before restoring keyboard focus.
    if (!action && reloadRequired) reloadButton.current?.focus();
  }, [action, reloadRequired]);

  function blockChangedAccount(failure: unknown) {
    if ((failure as { code?: string })?.code !== 'account_changed') return false;
    refreshSequence.current++;
    readRequest.current?.abort();
    setLoading(false);
    setData(null);
    setNotice('');
    setError(accountChanged);
    setPhase('changed');
    return true;
  }
  function accountIsCurrent() {
    try {
      verifyAccount();
      return true;
    } catch (failure) {
      blockChangedAccount(failure);
      return false;
    }
  }

  async function refresh() {
    const sequence = ++refreshSequence.current;
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const check = () => {
      if (!mounted.current || sequence !== refreshSequence.current || controller.signal.aborted)
        throw new DOMException('This passkey request ended.', 'AbortError');
      verifyAccount();
    };
    setLoading(true);
    try {
      const next = await api<Keys>('passkeys', undefined, check, {
        signal: controller.signal,
        accountId,
      });
      if (!next || !Array.isArray(next.passkeys)) throw new Error('Could not load passkeys.');
      if (mounted.current && sequence === refreshSequence.current) {
        setData(next);
        setError('');
      }
    } catch (failure) {
      if (mounted.current && sequence === refreshSequence.current) {
        if (!blockChangedAccount(failure))
          setError(failure instanceof Error ? failure.message : 'Could not load passkeys.');
      }
    } finally {
      clearTimeout(timeout);
      if (mounted.current && sequence === refreshSequence.current) setLoading(false);
    }
  }
  function cancelVerification() {
    serial.current++;
    request.current?.abort();
    WebAuthnAbortService.cancelCeremony();
    if (challenge.current) void api('cancel', { challengeId: challenge.current }).catch(() => {});
    challenge.current = null;
    locked.current = false;
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      refreshSequence.current++;
      readRequest.current?.abort();
      cancelVerification();
    };
  }, [revision]);
  useEffect(() => {
    if (accountChange) blockChangedAccount({ code: 'account_changed' });
  }, [accountChange]);

  function open(next: Action, trigger?: HTMLElement | null) {
    if (locked.current || busy || !accountIsCurrent()) return;
    returnFocus.current = trigger ?? (document.activeElement as HTMLElement);
    const stale = forceProof || !data?.verifiedUntil || data.verifiedUntil <= Date.now();
    setError('');
    setNotice('');
    setPhase('idle');
    setNeedsProof(stale);
    if (next.kind === 'add' && !stale) onAdd(verifyAccount);
    else setAction(next);
  }
  async function verify() {
    if (locked.current || reloadRequired || !accountIsCurrent()) return;
    locked.current = true;
    const current = ++serial.current;
    const controller = new AbortController();
    request.current = controller;
    // Includes the authenticator ceremony and verification body, not only fetch headers.
    const timeout = setTimeout(() => {
      controller.abort();
      WebAuthnAbortService.cancelCeremony();
    }, 60_000);
    const check = () => {
      if (!mounted.current || current !== serial.current || controller.signal.aborted)
        throw new Error('Passkey verification did not finish. Try again.');
      verifyAccount();
    };
    setPhase('verifying');
    setError('');
    try {
      const result = await api<{
        options: PublicKeyCredentialRequestOptionsJSON;
        challengeId: string;
      }>('reauthentication/options', {}, check, { signal: controller.signal, accountId });
      challenge.current = result.challengeId;
      const response = await authenticate({ optionsJSON: result.options });
      check();
      const proof = await api<{ verifiedUntil: number }>(
        'reauthentication/verify',
        { challengeId: result.challengeId, response },
        check,
        { signal: controller.signal, accountId },
      );
      setData((previous) => previous && { ...previous, verifiedUntil: proof.verifiedUntil });
      setNeedsProof(false);
      setForceProof(false);
      setNotice('Passkey verified. Confirm the change below.');
    } catch (failure) {
      if (mounted.current && current === serial.current && !blockChangedAccount(failure))
        setError(
          'Passkey verification did not finish. Try again and choose a passkey for this account.',
        );
    } finally {
      clearTimeout(timeout);
      if (current === serial.current) {
        if (challenge.current)
          void api('cancel', { challengeId: challenge.current }).catch(() => {});
        challenge.current = null;
        locked.current = false;
        if (mounted.current) setPhase((previous) => (previous === 'changed' ? previous : 'idle'));
      }
    }
  }
  async function perform() {
    if (!action || locked.current || reloadRequired || !accountIsCurrent()) return;
    if (action.kind === 'add') {
      setAction(null);
      onAdd(verifyAccount);
      return;
    }
    locked.current = true;
    const current = ++serial.current;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const check = () => {
      if (!mounted.current || current !== serial.current) throw new Error('Closed');
      verifyAccount();
    };
    setPhase('saving');
    setError('');
    try {
      const result = await api<{ signedOut?: boolean; signedOutOthers?: boolean }>(
        action.kind === 'remove'
          ? `passkeys/${encodeURIComponent(action.key.id)}/remove`
          : 'sign-out-others',
        {},
        check,
        { signal: controller.signal, accountId },
      );
      if (action.kind === 'remove' && typeof result?.signedOut !== 'boolean')
        throw new Error('The removal result could not be confirmed.');
      if (action.kind === 'others' && result?.signedOutOthers !== true)
        throw new Error('The sign-out result could not be confirmed.');
      if (result?.signedOut) {
        onSignedOut();
        return;
      }
      setAction(null);
      setNotice(
        action.kind === 'remove'
          ? 'Passkey removed and its sessions ended.'
          : 'Other browser sessions signed out. This browser stays signed in.',
      );
      setPhase('idle');
      await refresh();
      addButton.current?.focus();
    } catch (failure) {
      if (!mounted.current || current !== serial.current) return;
      if (blockChangedAccount(failure)) return;
      const status = (failure as { status?: number }).status;
      if (status === 428) {
        setNeedsProof(true);
        setForceProof(true);
        setPhase('idle');
        setError('Verify with a passkey before making this change.');
      } else if (status && status >= 400 && status < 500) {
        setPhase('idle');
        setError(failure instanceof Error ? failure.message : 'The change was refused.');
      } else {
        setPhase('uncertain');
        setError(
          'The result could not be confirmed. The change may already be saved. Reload your profile to check before trying again.',
        );
      }
    } finally {
      clearTimeout(timeout);
      if (current === serial.current) locked.current = false;
    }
  }
  function close() {
    if (phase === 'saving') return;
    if (phase === 'verifying') cancelVerification();
    setAction(null);
    if (!reloadRequired) {
      setPhase('idle');
      setError('');
      setNotice('');
    }
  }
  const last = action?.kind === 'remove' && data !== null && data.passkeys.length <= 1;
  return (
    <section className="profile-key-settings sp-ui" aria-labelledby="passkeys-heading">
      <h2 id="passkeys-heading">Your passkeys</h2>
      <p>Add a passkey from another device or password manager so you can sign in there too.</p>
      {loading && <p role="status">Loading passkeys…</p>}
      {!action && error && <p role="alert">{error}</p>}
      {!action && notice && <p role="status">{notice}</p>}
      {!action && reloadRequired && (
        <Button ref={reloadButton} onClick={() => location.reload()}>
          Reload profile
        </Button>
      )}
      {data &&
        (data.passkeys.length ? (
          <ul className="profile-passkeys">
            {data.passkeys.map((key) => (
              <li key={key.id}>
                <div>
                  <strong>{key.name}</strong>
                  {key.current && <span className="sp-muted"> · This session</span>}
                  <p className="sp-muted">
                    Last used{' '}
                    {key.lastUsedAt === null ? 'Never' : new Date(key.lastUsedAt).toLocaleString()}
                  </p>
                </div>
                <ActionMenu
                  label={`More actions for ${key.name}`}
                  actions={[
                    {
                      label: 'Remove…',
                      destructive: true,
                      disabled: busy || loading,
                      onClick: (trigger) => open({ kind: 'remove', key }, trigger),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p>No passkeys added yet. Ask the Operator for a recovery invitation.</p>
        ))}
      {data?.passkeys.length === 1 && <p>Add another passkey before removing your last one.</p>}
      <div className="profile-key-actions">
        <Button
          ref={addButton}
          primary
          disabled={busy || loading || !data?.passkeys.length}
          onClick={() => open({ kind: 'add' })}
        >
          Add a passkey
        </Button>
        <Button disabled={busy || loading || !data} onClick={() => open({ kind: 'others' })}>
          Sign out other devices
        </Button>
        {!loading && !action && error && !reloadRequired && (
          <Button onClick={() => void refresh()}>Retry</Button>
        )}
      </div>
      <p className="sp-muted">
        Browser sessions are separate from connected assistants and personal access tokens.{' '}
        {isAdmin ? 'Manage those in Administration.' : 'Manage those in Connected assistants.'}
      </p>
      {action && (
        <Modal
          open
          title={
            action.kind === 'remove'
              ? `Remove ${action.key.name}?`
              : action.kind === 'add'
                ? 'Add a passkey'
                : 'Sign out other devices?'
          }
          icon="key"
          dismissDisabled={phase === 'saving'}
          finalFocus={() =>
            reloadRequired
              ? false
              : returnFocus.current?.isConnected
                ? returnFocus.current
                : addButton.current
          }
          onOpenChange={(next) => {
            if (!next) close();
          }}
        >
          <div className="profile-key-confirmation">
            {action.kind === 'remove' ? (
              <p>
                This passkey will stop working. Its browser sessions and older sessions that cannot
                be linked to a passkey will end, including their open editors. A synced passkey can
                be used on several devices.
                {action.key.current || !data?.passkeys.some((key) => key.current)
                  ? ' This browser will also be signed out.'
                  : ''}
              </p>
            ) : action.kind === 'others' ? (
              <p>
                Every other browser session will end and its open editors will disconnect. This
                browser stays signed in. Passkeys remain available to sign in again; remove a lost
                device’s passkey too.
              </p>
            ) : (
              <p>Verify with an existing passkey before adding another way into your account.</p>
            )}
            {last ? (
              <p role="alert">
                Add another passkey before removing your last one. Nothing has been removed.
              </p>
            ) : (
              <>
                {error && <p role="alert">{error}</p>}
                {notice && <p role="status">{notice}</p>}
                {needsProof && (
                  <p>
                    Use a passkey to confirm it’s you. Verification lasts five minutes in this
                    browser session.
                  </p>
                )}
                {phase === 'verifying' && (
                  <p role="status">Follow the instructions from your passkey manager.</p>
                )}
              </>
            )}
            <div className="profile-key-actions">
              {!last && !reloadRequired && (
                <Button
                  primary
                  disabled={busy}
                  onClick={() => void (needsProof ? verify() : perform())}
                >
                  {phase === 'verifying'
                    ? 'Verifying…'
                    : phase === 'saving'
                      ? 'Saving…'
                      : needsProof
                        ? 'Verify with a passkey'
                        : action.kind === 'remove'
                          ? 'Remove passkey'
                          : action.kind === 'add'
                            ? 'Add a passkey'
                            : 'Sign out other devices'}
                </Button>
              )}
              {reloadRequired && (
                <Button primary onClick={() => location.reload()}>
                  Reload profile
                </Button>
              )}
              <Button disabled={phase === 'saving'} onClick={close}>
                {last || reloadRequired ? 'Close' : 'Cancel'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
