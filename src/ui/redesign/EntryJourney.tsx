import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { GemLogo, replayGemWiggle } from '../GemLogo.tsx';
import { Button, Modal } from './Controls.tsx';
import './entryJourney.css';
import { ThemeMenu } from './Mockups.tsx';

export type EntryScreen = 'home' | 'sign-in' | 'invite' | 'recovery' | 'setup';
export type EntryOutcome = 'ready' | 'pending' | 'cancelled' | 'error' | 'invalid';
export type EntryJourneyProps = {
  screen: EntryScreen;
  outcome?: EntryOutcome;
  onNavigate: (screen: EntryScreen) => void;
  onPasskey: (name?: string) => void;
  accountName?: string;
};

/** Local review journey; successful passkey outcomes and destinations belong to its host. */
export function EntryJourney({
  screen,
  outcome = 'ready',
  onNavigate,
  onPasskey,
  accountName = 'Alex Kim',
}: EntryJourneyProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [help, setHelp] = useState(false);
  const [name, setName] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const nameId = useId();
  const hintId = useId();
  useEffect(() => {
    setCancelled(false);
  }, [outcome, screen]);
  const state = cancelled ? 'cancelled' : outcome;
  const pending = state === 'pending';
  useLayoutEffect(() => {
    if (['pending', 'cancelled', 'error'].includes(state))
      formRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [state]);
  const invalid = state === 'invalid';
  // Existing sign-in links use the same arrival screen, without an extra step.
  const entry = screen === 'sign-in' ? 'home' : screen;
  const home = entry === 'home';
  const details = {
    home: [
      'Your workspace.',
      'Sheets and Docs, together in a private place.',
      'Sign in with a passkey',
    ],
    invite: [
      'You’re invited.',
      'Create your everyday account to join this workspace.',
      'Join with a passkey',
    ],
    recovery: [
      'Recover your account.',
      `Create a new passkey for ${accountName}.`,
      'Recover with a passkey',
    ],
    setup: ['Set up Spinel.', 'Create the first Operator account.', 'Create Operator passkey'],
  }[entry];
  const invalidTitle =
    screen === 'setup' ? 'This setup link isn’t available.' : 'This invitation isn’t available.';
  const invalidDetail =
    screen === 'setup'
      ? 'Open the latest one-time setup link from the server. If it has expired or been replaced, run the setup command again. An instance that has already been set up cannot be claimed again.'
      : 'It may have expired, been used or been revoked. Ask the workspace Operator for a new invitation.';

  return (
    <div className={`sp-ui ej-page${home ? ' ej-home' : ''}`}>
      <header className="ej-header">
        <button
          className="ej-brand"
          aria-label="Spinel home"
          onClick={(event) => {
            replayGemWiggle(event.currentTarget);
            onNavigate('home');
          }}
        >
          <span className="wiggle">
            <GemLogo />
          </span>
          <span>spinel</span>
        </button>
        <div className="ej-header-actions">
          <ThemeMenu />
        </div>
      </header>
      <main className="ej-main">
        <section className="ej-card" aria-labelledby="entry-title">
          <p className="ej-eyebrow">
            {screen === 'setup' ? 'SERVER OPERATOR' : 'PRIVATE BY INVITATION'}
          </p>
          <h1 id="entry-title">{invalid ? invalidTitle : details[0]}</h1>
          <p className="ej-intro">{invalid ? invalidDetail : details[1]}</p>
          {invalid ? (
            <Button onClick={() => onNavigate('sign-in')}>Back to sign in</Button>
          ) : (
            <form
              ref={formRef}
              className="ej-form"
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault();
                if (pending || (screen === 'invite' && !name.trim())) return;
                setCancelled(false);
                onPasskey(screen === 'invite' ? name.trim() : undefined);
              }}
            >
              {screen === 'invite' && (
                <div className="ej-field">
                  <label htmlFor={nameId}>Your name</label>
                  <input
                    id={nameId}
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                    required
                    disabled={pending}
                    aria-describedby={hintId}
                  />
                  <small id={hintId}>Use the name people in this workspace know you by.</small>
                </div>
              )}
              {screen === 'recovery' && (
                <div className="ej-context">
                  <strong>{accountName}</strong>
                  <p>
                    This replaces all your old passkeys and signs out your other devices. Your
                    account and documents stay yours.
                  </p>
                </div>
              )}
              {screen === 'setup' && (
                <div className="ej-context">
                  <strong>A separate account for running Spinel</strong>
                  <p>
                    The Operator manages people, access and backups, and cannot open documents.
                    After setup, invite a separate everyday account for your Sheets and Docs.
                  </p>
                </div>
              )}
              <p className="ej-passkey-help">
                Use a passkey from your browser, password manager or phone.
              </p>
              {pending ? (
                <div className="ej-pending">
                  <p role="status">Continue in your browser or device’s passkey prompt.</p>
                  <Button type="button" onClick={() => setCancelled(true)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  {state === 'cancelled' && (
                    <p className="ej-feedback" role="status">
                      Passkey request cancelled. You can try again when you’re ready.
                    </p>
                  )}
                  {state === 'error' && (
                    <p className="ej-feedback" role="alert">
                      The passkey request did not finish. Try again and choose your passkey manager.
                    </p>
                  )}
                  <Button primary type="submit" disabled={screen === 'invite' && !name.trim()}>
                    {home && (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="8" cy="8" r="5" />
                        <path d="m12 12 9 9m-3-3 3-3m-6 0 3-3" />
                      </svg>
                    )}
                    {state === 'error' || state === 'cancelled'
                      ? 'Try again with a passkey'
                      : details[2]}
                  </Button>
                </>
              )}
            </form>
          )}
          <Button className="sp-quiet" onClick={() => setHelp(true)}>
            Need help?
          </Button>
        </section>
      </main>
      <footer className="ej-footer">
        {home
          ? 'Have a shared link? Open it directly to view the document.'
          : 'Your passkey stays with your browser, password manager or device.'}
      </footer>
      <Modal
        title="Access to this workspace"
        description="Spinel is private and invitation-only."
        open={help}
        onOpenChange={setHelp}
      >
        <div className="ej-help">
          <p>
            Ask the person who runs this workspace for an invitation. If you already have an account
            but lost your passkeys, ask them for a recovery invitation.
          </p>
          <p>A shared document link opens directly. You do not need an account to use it.</p>
          <details className="ej-operator-help">
            <summary>Operator help and commands</summary>
            <p>
              Run these from the Spinel checkout on the server, with the same DATABASE_PATH and
              APP_ORIGIN as the running app. These commands are not run by this page.
            </p>
            <h3>Set up an unclaimed instance</h3>
            <pre>
              <code>npm run setup</code>
            </pre>
            <p>
              Prints a private, one-time setup link valid for 30 minutes. Running it again replaces
              the previous link. It only works before any users exist; it cannot recover an existing
              Operator account. Keep the printed link private.
            </p>
            <details>
              <summary>Using the documented Docker deployment?</summary>
              <pre>
                <code>
                  docker compose --env-file /etc/spinel/deploy.env -f deploy/compose.yaml exec app
                  node server/setup.ts
                </code>
              </pre>
            </details>
            <h3>Check passkeys on a development machine</h3>
            <pre>
              <code>npm run passkey:check</code>
            </pre>
            <p>
              Builds a disposable local test instance at localhost:3102. Use it to test your browser
              or password manager. It does not repair production accounts.
            </p>
            <h3>Recover an existing account</h3>
            <p>
              Sign in as an authorized Operator, open Administration → Invites, and choose Recover
              followed by the account name. There is no public password reset or setup-command
              bypass.
            </p>
            <h3>Run a configured deployment backup</h3>
            <pre>
              <code>
                docker compose --env-file /etc/spinel/deploy.env -f deploy/compose.yaml exec app
                node scripts/deploy/backup.ts run
              </code>
            </pre>
            <p>
              Requires the existing backup configuration and recovery key. Verify Last successful
              backup in Administration afterward. Keep the recovery key separate from the server.
            </p>
          </details>
          <Button onClick={() => setHelp(false)}>Got it</Button>
        </div>
      </Modal>
    </div>
  );
}

/** Standalone stories share the same entry surface as the connected walkthrough. */
export function EntryPreview({ screen: initialScreen }: { screen: EntryScreen }) {
  const [screen, setScreen] = useState(initialScreen);
  const [outcome, setOutcome] = useState<EntryOutcome>('ready');
  return (
    <EntryJourney
      screen={screen}
      outcome={outcome}
      onNavigate={(next) => {
        setScreen(next);
        setOutcome('ready');
      }}
      onPasskey={() => setOutcome('pending')}
    />
  );
}
