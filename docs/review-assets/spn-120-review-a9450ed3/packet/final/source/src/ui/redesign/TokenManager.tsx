import { useId, useState } from 'react';
import { Button, Modal } from './Controls.tsx';

export type TokenManagerState =
  | 'loaded'
  | 'empty'
  | 'loading'
  | 'load-failed'
  | 'creating'
  | 'created'
  | 'create-failed'
  | 'revoking'
  | 'revoked'
  | 'revoke-failed'
  | 'active-limit'
  | 'previously-used'
  | 'copied'
  | 'manual-copy';
type ReviewToken = { id: string; name: string; used: string; revoked: boolean };
const previewSecret = 'spinel_preview_not_a_real_access_token';

/** Local review fixture; mirrors the existing personal-token contract without issuing credentials. */
export function TokenManager({
  state = 'loaded',
  admin = false,
  initialTokenName = 'Local script',
}: {
  state?: TokenManagerState;
  admin?: boolean;
  initialTokenName?: string;
}) {
  const nameId = useId();
  const [tokens, setTokens] = useState<ReviewToken[]>(() =>
    state === 'empty'
      ? []
      : state === 'active-limit'
        ? Array.from({ length: 10 }, (_, index) => ({
            id: String(index),
            name: `Local script ${index + 1}`,
            used: 'Never',
            revoked: false,
          }))
        : [
            {
              id: 'local-script',
              name: initialTokenName,
              used: state === 'previously-used' ? 'October 20, 2026 at 09:15' : 'Never',
              revoked: state === 'revoked',
            },
          ],
  );
  const [loading, setLoading] = useState(state === 'loading');
  const [loadFailed, setLoadFailed] = useState(state === 'load-failed');
  const [createOpen, setCreateOpen] = useState(['creating', 'create-failed'].includes(state));
  const [name, setName] = useState(
    ['creating', 'create-failed'].includes(state) ? 'Local script' : '',
  );
  const [creating] = useState(state === 'creating');
  const [revoking] = useState(state === 'revoking' ? 'local-script' : '');
  const [createError, setCreateError] = useState(
    state === 'create-failed' ? 'Could not create the token. Try again.' : '',
  );
  const [revokeError, setRevokeError] = useState(
    state === 'revoke-failed'
      ? 'Could not revoke Local script. It still has access. Try again.'
      : '',
  );
  const [secretFor, setSecretFor] = useState(
    ['created', 'copied', 'manual-copy'].includes(state) ? 'local-script' : '',
  );
  const [notice, setNotice] = useState(
    state === 'copied'
      ? 'Access token copied.'
      : state === 'manual-copy'
        ? 'Copying was unavailable. Select the token and copy it manually.'
        : state === 'revoked'
          ? 'Token revoked. It can no longer access your documents.'
          : '',
  );
  const limitReached = tokens.filter((token) => !token.revoked).length >= 10;
  const busy = creating || Boolean(revoking);
  return (
    <section className="rd-token-manager" aria-label="Personal access tokens">
      <h3>Personal access tokens</h3>
      <p className="sp-muted">
        {admin
          ? 'Account token names and activity only. Token secrets and document contents are never shown.'
          : 'For scripts or clients that require a token. A token can read and edit only the files your account allows. Tokens do not expire.'}
      </p>
      {!admin && (
        <>
          <Button
            disabled={loading || loadFailed || busy || limitReached}
            onClick={() => {
              setCreateError('');
              setCreateOpen(true);
            }}
          >
            Create access token
          </Button>
          {limitReached && (
            <p role="status">You have 10 active tokens. Revoke one before creating another.</p>
          )}
          {secretFor && (
            <section className="rd-section">
              <h4>Copy your new token</h4>
              <p>Keep it secret. It will not be shown again after you leave this page.</p>
              <label>
                New access token
                <input readOnly value={previewSecret} onFocus={(event) => event.target.select()} />
              </label>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(previewSecret);
                    setNotice('Access token copied.');
                  } catch {
                    setNotice('Copying was unavailable. Select the token and copy it manually.');
                  }
                }}
              >
                Copy access token
              </Button>
            </section>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Loading access tokens…</p>
      ) : loadFailed ? (
        <p role="alert">Could not load access tokens. Try again.</p>
      ) : tokens.length ? (
        <div role="list" aria-label="Access tokens">
          {tokens.map((token) => (
            <div className="rd-setting-row" role="listitem" key={token.id}>
              <span>
                <strong>{token.name}</strong>
                <small>
                  {admin && 'Alex Baylee · '}
                  {token.revoked ? 'Revoked' : 'Active'} · Created October 18, 2026
                </small>
                <small>Last used: {token.used}</small>
              </span>
              {!admin && !token.revoked && (
                <Button
                  disabled={busy}
                  aria-label={`Revoke ${token.name}`}
                  onClick={() => {
                    setTokens((current) =>
                      current.map((item) =>
                        item.id === token.id ? { ...item, revoked: true } : item,
                      ),
                    );
                    if (secretFor === token.id) setSecretFor('');
                    setRevokeError('');
                    setNotice('Token revoked. It can no longer access your documents.');
                  }}
                >
                  {revoking === token.id ? 'Revoking…' : 'Revoke'}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p>No access tokens yet.</p>
      )}
      {revokeError && <p role="alert">{revokeError}</p>}
      <Button
        disabled={busy || loading}
        onClick={() => {
          setLoading(false);
          setLoadFailed(false);
          setRevokeError('');
          setNotice('Access tokens refreshed.');
        }}
      >
        {loadFailed ? 'Try again' : 'Refresh access tokens'}
      </Button>
      <p className="sp-muted">Design preview. Tokens shown here do not grant access.</p>
      {!admin && (
        <Modal
          icon="key"
          title="Create an access token"
          description="Give this token a name you can recognize later. Keep it secret and revoke it when you are done."
          open={createOpen}
          dismissDisabled={creating}
          onOpenChange={(open) => {
            if (!creating) setCreateOpen(open);
          }}
        >
          <form
            className="rd-form"
            aria-busy={creating}
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || creating || limitReached) return;
              const id = `preview-${tokens.length}`;
              setTokens((current) => [
                ...current,
                { id, name: name.trim(), used: 'Never', revoked: false },
              ]);
              setSecretFor(id);
              setCreateError('');
              setNotice('Token created in this preview. Copy it now.');
              setName('');
              setCreateOpen(false);
            }}
          >
            <label htmlFor={nameId}>Token name</label>
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="For example, my local script"
              required
              maxLength={80}
              disabled={creating}
            />
            {createError && <p role="alert">{createError}</p>}
            {creating && <p role="status">Creating access token…</p>}
            <div className="sp-actions">
              <Button type="button" disabled={creating} onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button primary type="submit" disabled={creating || !name.trim() || limitReached}>
                {creating ? 'Creating…' : 'Create access token'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
