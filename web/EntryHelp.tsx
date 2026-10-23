import { useState } from 'react';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';

/** Guidance only. No command or account operation runs from this disclosure. */
export function EntryHelp() {
  const [open, setOpen] = useState(false);
  return <>
    <Button className="sp-quiet" onClick={() => setOpen(true)}>Need help?</Button>
    <Modal icon="key" title="Access to this workspace"
      description="Spinel is private and invitation-only." open={open} onOpenChange={setOpen}>
      <div className="ej-help">
        <p>Ask the person who runs this workspace for an invitation. If you already have an account but lost your passkeys, ask them for a recovery invitation.</p>
        <p>A shared document link opens directly. You do not need an account to use it.</p>
        <details className="ej-operator-help">
          <summary>Operator help and commands</summary>
          <p>Run these from the Spinel checkout on the server, with the same DATABASE_PATH and APP_ORIGIN as the running app. These commands are not run by this page.</p>
          <h3>Set up an unclaimed instance</h3>
          <pre><code>npm run setup</code></pre>
          <p>Prints a private, one-time setup link valid for 30 minutes. Running it again replaces the previous link. It only works before any users exist; it cannot recover an existing Operator account. Keep the printed link private.</p>
          <details>
            <summary>Using the documented Docker deployment?</summary>
            <pre><code>docker compose --env-file /etc/spinel/deploy.env -f deploy/compose.yaml exec app node server/setup.ts</code></pre>
          </details>
          <h3>Check passkeys on a development machine</h3>
          <pre><code>npm run passkey:check</code></pre>
          <p>Builds a disposable local test instance at localhost:3102. Use it to test your browser or password manager. It does not repair production accounts.</p>
          <h3>Recover an existing account</h3>
          <p>Sign in as an authorized Operator, open Administration → Invites, and choose Recover followed by the account name. There is no public password reset or setup-command bypass.</p>
          <p>If all Operator passkeys are lost, use the server console recovery command for the existing admin account. It cannot recover a disabled account.</p>
          <pre><code>npm run setup -- --recover-admin</code></pre>
          <h3>Run a configured deployment backup</h3>
          <pre><code>docker compose --env-file /etc/spinel/deploy.env -f deploy/compose.yaml exec app node scripts/deploy/backup.ts run</code></pre>
          <p>Requires the existing backup configuration and recovery key. Verify Last successful backup in Administration afterward. Keep the recovery key separate from the server.</p>
        </details>
        <Button onClick={() => setOpen(false)}>Got it</Button>
      </div>
    </Modal>
  </>;
}
