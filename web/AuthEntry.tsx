import { useEffect, useId, useRef } from 'react';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { EntryFrame } from './EntryFrame.tsx';
import { EntryHelp } from './EntryHelp.tsx';

export function AuthEntry({
  mode, loading, validSetup, inviteDetails, name, onName, busy, error, notice,
  unreachable = false, onPasskey, onCancel, onHome,
}: {
  mode: 'sign-in' | 'setup' | 'invite';
  loading: boolean;
  validSetup: boolean;
  inviteDetails: { recovery: boolean; name: string } | null;
  name: string;
  onName: (name: string) => void;
  busy: boolean;
  error: string;
  notice: string;
  unreachable?: boolean;
  onPasskey: () => void;
  onCancel: () => void;
  onHome: () => void;
}) {
  const nameId = useId();
  const hintId = useId();
  const form = useRef<HTMLFormElement>(null);
  const wasBusy = useRef(false);
  useEffect(() => {
    // When a ceremony swaps its action for Cancel, keep keyboard focus on that
    // task, and restore it to the retry action after cancellation or failure.
    if ((busy || wasBusy.current) && !document.activeElement?.closest('[role="dialog"], dialog'))
      form.current?.querySelector<HTMLButtonElement>('button')?.focus();
    wasBusy.current = busy;
  }, [busy]);
  const setup = mode === 'setup';
  const invitation = mode === 'invite';
  const recovery = invitation && inviteDetails?.recovery;
  const available = setup ? validSetup : invitation ? Boolean(inviteDetails) : true;
  const accountName = inviteDetails?.name ?? '';
  const invalid = !loading && !unreachable && !available;
  const title = unreachable ? "You're offline" : invalid ? setup ? 'This setup link isn’t available.' : 'This invitation isn’t available.' : setup ? 'Set up Spinel' : recovery ? 'Recover your account' : invitation ? 'You’re invited.' : 'Your workspace.';
  return <EntryFrame title={title} home={mode === 'sign-in'} busy={busy} onHome={onHome}
    eyebrow={setup ? 'SERVER OPERATOR' : undefined}
    intro={unreachable ? 'Connect to the internet, then try again to open Spinel.' : invalid ? undefined : setup ? 'Create the first Operator account.' : recovery ? `Create a new passkey for ${accountName}.` : invitation ? 'Create your everyday account to join this workspace.' : 'Sheets and Docs, together in a private place.'}
    footer={mode === 'sign-in' ? 'Have a shared link? Open it directly to view the document.' : undefined}>
    {loading ? <p role="status">{invitation ? 'Checking the invitation…' : 'Loading…'}</p> : unreachable ? <Button onClick={() => location.reload()}>Try again</Button> : !available ? <>
      <p className="ej-feedback" role={error ? undefined : 'alert'}>{setup
        ? 'Open the one-time setup link printed on the server. If it expired, run the setup command again.'
        : 'This invitation or recovery link is not available. It may have expired, been used or been revoked. Ask your workspace Operator for a new link.'}</p>
      <Button onClick={onHome}>Back to sign in</Button>
    </> : <form ref={form} className="ej-form" aria-busy={busy} onSubmit={(event) => {
      event.preventDefault();
      if (!busy && (!invitation || name.trim())) onPasskey();
    }}>
      {invitation && !recovery && <div className="ej-field">
        <label htmlFor={nameId}>Your name</label>
        <input id={nameId} value={name} maxLength={80} autoComplete="name" required disabled={busy}
          onChange={(event) => onName(event.target.value)} aria-describedby={hintId} />
        <small id={hintId}>Use the name people in this workspace know you by.</small>
      </div>}
      {recovery && <div className="ej-context"><h2>{accountName}</h2><p>Adding your new passkey will replace all old passkeys and sign out your other devices. Your account and documents stay yours.</p></div>}
      {setup && <div className="ej-context"><strong>A separate account for running Spinel</strong><p>Your admin account manages the workspace. It cannot open documents; you will invite a separate everyday account for that.</p></div>}
      <p className="ej-passkey-help">Use a passkey from your browser, password manager or phone.</p>
      {busy ? <div className="ej-pending"><p role="status">Continue in your browser or device’s passkey prompt.</p><Button type="button" onClick={onCancel}>Cancel</Button></div> :
        <Button primary type="submit" disabled={invitation && !name.trim()}>
          {mode === 'sign-in' && <ProfileIcon icon="lucide:key-round" size={18} />}
          {setup ? 'Create admin passkey' : recovery ? 'Recover with a passkey' : invitation ? 'Join with a passkey' : 'Sign in with a passkey'}
        </Button>}
    </form>}
    {error && <p className="ej-feedback" role="alert">{error}</p>}
    {notice && <p className="ej-feedback" role="status">{notice}</p>}
    <EntryHelp />
  </EntryFrame>;
}
