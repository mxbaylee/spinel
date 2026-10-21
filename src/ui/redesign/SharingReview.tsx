import { useState } from 'react';
import { ActionMenu, Button, Choice, Modal } from './Controls.tsx';
import './sharingReview.css';

export type SharingState =
  | 'off'
  | 'created'
  | 'existing'
  | 'replace'
  | 'error'
  | 'loading'
  | 'load-error'
  | 'owner-only'
  | 'disabled-account'
  | 'access-saving'
  | 'link-loading'
  | 'link-load-error'
  | 'creating'
  | 'create-error'
  | 'replacing'
  | 'replace-error'
  | 'revoking'
  | 'revoke-error';
type LinkAction = 'create' | 'replace' | 'revoke';

/** Local sharing proposal. Mutations retain the last confirmed access until they succeed. */
export function SharingReview({
  delegated = false,
  state = 'off',
  kind,
}: {
  delegated?: boolean;
  state?: SharingState;
  kind: 'doc' | 'sheet' | 'space' | 'folder';
}) {
  const [accessLoad, setAccessLoad] = useState(
    state === 'loading' ? 'loading' : state === 'load-error' ? 'error' : 'ready',
  );
  const [role, setRole] = useState(
    state === 'error' || state === 'access-saving' ? 'view' : 'edit',
  );
  const [appliedRole, setAppliedRole] = useState('edit');
  const [accessBusy, setAccessBusy] = useState(state === 'access-saving');
  const [accessError, setAccessError] = useState(state === 'error');
  const [disabledRemoved, setDisabledRemoved] = useState(false);
  const [linkLoad, setLinkLoad] = useState(
    state === 'link-loading' ? 'loading' : state === 'link-load-error' ? 'error' : 'ready',
  );
  const [link, setLink] = useState(
    [
      'created',
      'existing',
      'replace',
      'replacing',
      'replace-error',
      'revoking',
      'revoke-error',
    ].includes(state),
  );
  const [revealed, setRevealed] = useState(state === 'created');
  const [linkRole, setLinkRole] = useState(state === 'created' ? 'edit' : 'view');
  const [activeRole, setActiveRole] = useState(linkRole);
  const [replace, setReplace] = useState(['replace', 'replacing', 'replace-error'].includes(state));
  const [busy, setBusy] = useState<LinkAction | null>(
    state === 'creating'
      ? 'create'
      : state === 'replacing'
        ? 'replace'
        : state === 'revoking'
          ? 'revoke'
          : null,
  );
  const [linkError, setLinkError] = useState<LinkAction | null>(
    state === 'create-error'
      ? 'create'
      : state === 'replace-error'
        ? 'replace'
        : state === 'revoke-error'
          ? 'revoke'
          : null,
  );
  const [notice, setNotice] = useState('');
  const disabledAccount = state === 'disabled-account';

  async function applyAccess() {
    setAccessBusy(true);
    setAccessError(false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    setAppliedRole(disabledAccount ? 'none' : role);
    setDisabledRemoved(disabledAccount);
    setAccessBusy(false);
    setNotice('Access updated in this preview. Inherited folder access still applies.');
  }
  async function changeLink(action: LinkAction) {
    setBusy(action);
    setLinkError(null);
    await new Promise((resolve) => setTimeout(resolve, 250));
    setLink(action !== 'revoke');
    setRevealed(action !== 'revoke');
    if (action !== 'revoke') setActiveRole(linkRole);
    setReplace(false);
    setBusy(null);
    setNotice(
      action === 'revoke'
        ? 'Guest link turned off in this preview.'
        : action === 'replace'
          ? 'Replacement created in this preview. The old link no longer works.'
          : 'Guest link created for this preview.',
    );
  }
  const linkFailure =
    linkError === 'create'
      ? 'Could not create a link. Guest access is still off.'
      : linkError === 'replace'
        ? 'Could not replace the link. The existing link still works with its previous access.'
        : 'Could not turn off the link. People with the existing link still have access.';

  return (
    <div className="rd-sharing-review">
      <div className="rd-person">
        <strong>You</strong>
        <span className="rd-badge">Owner</span>
      </div>
      <section aria-label="People with access" aria-busy={accessLoad === 'loading' || accessBusy}>
        {accessLoad === 'loading' ? (
          <p role="status">Loading access…</p>
        ) : accessLoad === 'error' ? (
          <>
            <p role="alert">Could not load access. No permissions have changed.</p>
            <Button onClick={() => setAccessLoad('ready')}>Retry loading access</Button>
          </>
        ) : state === 'owner-only' ? (
          <p>No other everyday accounts are available.</p>
        ) : (
          <>
            <div className="rd-setting-row">
              <div>
                <strong>Alex Kim{disabledAccount ? ' · Disabled account' : ''}</strong>
                <p className="sp-muted">
                  {disabledAccount
                    ? 'This account cannot sign in. You can remove its direct access.'
                    : `Can edit through a folder. Direct access: ${appliedRole === 'none' ? 'none' : `can ${appliedRole}`}.`}
                </p>
              </div>
              {disabledAccount ? (
                <Button disabled={accessBusy || disabledRemoved} onClick={() => void applyAccess()}>
                  {disabledRemoved ? 'Direct access removed' : 'Remove direct access'}
                </Button>
              ) : (
                <Choice
                  label="Alex’s direct access"
                  value={role}
                  onChange={setRole}
                  disabled={accessBusy}
                  options={[
                    { value: 'none', label: 'No direct access' },
                    { value: 'view', label: 'Can view' },
                    { value: 'edit', label: 'Can edit' },
                    ...(delegated ? [{ value: 'admin', label: 'File admin' }] : []),
                  ]}
                />
              )}
            </div>
            {!disabledAccount && (
              <Button
                disabled={accessBusy || (!accessError && role === appliedRole)}
                onClick={() => void applyAccess()}
              >
                {accessBusy
                  ? 'Updating access…'
                  : accessError
                    ? 'Retry access update'
                    : 'Apply access'}
              </Button>
            )}
            {accessError && (
              <p role="alert">
                Access could not be updated. Alex still has Can edit access. Your choice is kept;
                try again.
              </p>
            )}
          </>
        )}
      </section>
      {kind === 'folder' ? (
        <p className="sp-muted">
          Folder access includes its contents and future additions. Folders cannot have guest links.
        </p>
      ) : (
        <section
          className="rd-section"
          aria-label="Guest link"
          aria-busy={!!busy || linkLoad === 'loading'}
        >
          <h3>Anyone with the link</h3>
          {linkLoad === 'loading' ? (
            <p role="status">Loading guest link…</p>
          ) : linkLoad === 'error' ? (
            <>
              <p role="alert">Could not load the guest link. Its access has not changed.</p>
              <Button onClick={() => setLinkLoad('ready')}>Retry loading guest link</Button>
            </>
          ) : (
            <>
              <p className="sp-muted">
                {link
                  ? `Guests can ${activeRole}.`
                  : 'Off. Only people with access can open this file.'}
              </p>
              <Choice
                label="Guest link access"
                value={linkRole}
                onChange={setLinkRole}
                disabled={!!busy}
                options={[
                  { value: 'view', label: 'Can view' },
                  { value: 'edit', label: 'Can edit' },
                ]}
              />
              {link && revealed && (
                <label>
                  Guest address
                  <input readOnly value="https://spinel.example/share/preview#sample" />
                </label>
              )}
              {link && (
                <p className="sp-muted">
                  {revealed
                    ? 'Copy this address now. It is shown only once.'
                    : 'Replace the link to copy a new address.'}
                </p>
              )}
              {link && activeRole !== linkRole && (
                <p>The current link stays unchanged until you replace it.</p>
              )}
              <div className="sp-actions">
                {link ? (
                  <>
                    {revealed && (
                      <Button
                        primary
                        disabled={!!busy}
                        onClick={() => setNotice('Guest address copied in this preview.')}
                      >
                        Copy guest link
                      </Button>
                    )}
                    <ActionMenu
                      label="Guest link actions"
                      actions={[
                        {
                          label: 'Replace link…',
                          disabled: !!busy,
                          onClick: () => setReplace(true),
                        },
                        {
                          label: 'Turn off link',
                          disabled: !!busy,
                          destructive: true,
                          onClick: () => void changeLink('revoke'),
                        },
                      ]}
                    />
                  </>
                ) : (
                  <Button disabled={!!busy} onClick={() => void changeLink('create')}>
                    Create link
                  </Button>
                )}
              </div>
              {busy && (
                <p role="status">
                  {busy === 'create'
                    ? 'Creating link…'
                    : busy === 'replace'
                      ? 'Replacing link…'
                      : 'Turning off link…'}
                </p>
              )}
              {linkError && !replace && (
                <>
                  <p role="alert">{linkFailure}</p>
                  <Button onClick={() => void changeLink(linkError)}>Try again</Button>
                </>
              )}
              <Modal
                dismissDisabled={!!busy}
                title="Replace the link?"
                description="The old link stops working at once, and anyone using it loses access."
                open={replace}
                onOpenChange={setReplace}
              >
                <p>The replacement lets guests {linkRole} this file.</p>
                {linkError === 'replace' && <p role="alert">{linkFailure}</p>}
                {busy === 'replace' && <p role="status">Replacing link…</p>}
                <div className="sp-actions">
                  <Button disabled={!!busy} onClick={() => setReplace(false)}>
                    Cancel
                  </Button>
                  <Button primary disabled={!!busy} onClick={() => void changeLink('replace')}>
                    {linkError === 'replace' ? 'Try again' : 'Replace link'}
                  </Button>
                </div>
              </Modal>
              <p className="sp-muted">
                Collaborator names are hidden while link sharing is on. Guest sessions last 24
                hours. Social previews show the file title and type.
              </p>
            </>
          )}
        </section>
      )}
      {notice && (
        <p role="status" className="rd-feedback">
          {notice}
        </p>
      )}
      <div className="sp-actions">
        <Button onClick={() => setNotice('Account link copied in this preview.')}>
          Copy account link
        </Button>
      </div>
    </div>
  );
}
