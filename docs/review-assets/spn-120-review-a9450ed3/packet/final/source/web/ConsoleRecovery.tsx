import { useState } from 'react';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { ThemeMenu } from '../src/ui/redesign/ThemeMenu.tsx';
import '../src/ui/redesign/entryJourney.css';

type Props = {
  name: string;
  loading: boolean;
  validLink: boolean;
  busy: boolean;
  finishing: boolean;
  error: string;
  notice: string;
  onRecover: () => void;
  onCancel: () => void;
};

/** Production console recovery follows the approved single-purpose entry composition. */
export function ConsoleRecovery({
  name,
  loading,
  validLink,
  busy,
  finishing,
  error,
  notice,
  onRecover,
  onCancel,
}: Props) {
  const [help, setHelp] = useState(false);
  return (
    <div className="sp-ui ej-page">
      <header className="ej-header">
        <button className="ej-brand" onClick={() => location.assign('/')} aria-label="Spinel home">
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
        <section className="ej-card" aria-labelledby="recovery-title">
          <p className="ej-eyebrow">SERVER OPERATOR</p>
          <h1 id="recovery-title">Recover admin access</h1>
          <p className="ej-intro">Create a new passkey for your existing admin account.</p>
          {loading ? (
            <p role="status">Checking the recovery link…</p>
          ) : name ? (
            <div className="ej-form" aria-busy={busy}>
              <div className="ej-context">
                <h2>{name}</h2>
                <p>
                  This replaces all its old passkeys and signs out its other devices. Accounts and
                  documents stay unchanged.
                </p>
                <p>The admin manages people and access. It cannot open documents.</p>
              </div>
              <p className="ej-passkey-help">
                Use a passkey from your browser, password manager or phone.
              </p>
              {busy ? (
                <div className="ej-pending">
                  <p role="status">
                    {finishing
                      ? 'Finishing admin recovery… Keep this page open.'
                      : 'Continue in your browser or device’s passkey prompt.'}
                  </p>
                  {!finishing && <Button onClick={onCancel}>Cancel</Button>}
                </div>
              ) : (
                <Button primary onClick={onRecover}>
                  Recover admin with a passkey
                </Button>
              )}
            </div>
          ) : (
            <p className="ej-feedback" role={error ? undefined : 'alert'}>
              {validLink
                ? 'This recovery link could not be opened. Open a new one-time recovery link from the server console.'
                : 'Open the one-time recovery link printed on the server. If it expired, run the recovery command again.'}
            </p>
          )}
          {error && (
            <p className="ej-feedback" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="ej-feedback" role="status">
              {notice}
            </p>
          )}
          <Button className="sp-quiet" onClick={() => setHelp(true)}>
            Need help?
          </Button>
        </section>
      </main>
      <footer className="ej-footer">
        Your passkey stays with your browser, password manager or device.
      </footer>
      <Modal
        icon="key"
        title="Recover admin access"
        description="Use the server console to regain access to an existing admin account."
        open={help}
        onOpenChange={setHelp}
      >
        <div className="ej-help">
          <p>Keep recovery links private. Each link works once and expires after 30 minutes.</p>
          <details className="ej-operator-help">
            <summary>Operator commands</summary>
            <p>On the server, print a new recovery link:</p>
            <pre>npm run setup -- --recover-admin</pre>
            <p>
              When there are several admins, follow the console instructions to choose the existing
              account. Disabled accounts cannot be recovered this way.
            </p>
          </details>
          <p>
            After recovering admin access, create recovery invitations for any members who also lost
            their passkeys.
          </p>
        </div>
      </Modal>
    </div>
  );
}
