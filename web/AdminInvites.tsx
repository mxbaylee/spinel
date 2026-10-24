import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { api } from './api.ts';
import { adminAccountLabel } from './adminAccountLabel.ts';
import './administration.css';

type Invite = {
  id: string;
  expiresAt: number;
  recoveryName: string | null;
  usedBy: string | null;
  status: string;
};
type Recipient = { id: string; name: string; isAdmin: number };
export function AdminInvites({
  initialRecipient = '',
  onBusyChange,
}: {
  initialRecipient?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [users, setUsers] = useState<Recipient[]>([]);
  const [hours, setHours] = useState(168);
  const [recovery, setRecovery] = useState(initialRecipient);
  const [formOpen, setFormOpen] = useState(!!initialRecipient);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const request = useRef(0);
  const mutation = useRef(false);
  const currentUrl = useRef(url);
  currentUrl.current = url;
  const createButton = useRef<HTMLButtonElement>(null);
  const createdAddress = useRef<HTMLInputElement>(null);
  const returnToAddress = useRef(false);
  const verify = () => {
    if (!mounted.current) throw new Error('This invitation view is no longer current.');
  };
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  async function refresh() {
    const generation = ++request.current;
    setLoading(true);
    setFresh(false);
    const current = () => {
      verify();
      if (generation !== request.current) throw new Error('A newer invitation request is active.');
    };
    try {
      const [list, recipients] = await Promise.all([
        api<{ invites: Invite[] }>('invites', undefined, current),
        api<{ users: Recipient[] }>('invites/recipients', undefined, current),
      ]);
      current();
      setInvites(list.invites);
      setUsers(recipients.users);
      setFresh(true);
      setReadError('');
    } catch (cause) {
      if (mounted.current && generation === request.current)
        setReadError(cause instanceof Error ? cause.message : 'Could not refresh invites.');
    } finally {
      if (mounted.current && generation === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function create() {
    if (
      mutation.current ||
      loading ||
      !fresh ||
      (recovery && !users.some((user) => user.id === recovery))
    )
      return;
    mutation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setUrl('');
    try {
      const invite = await api<{ url: string }>(
        'invites',
        { hours, ...(recovery ? { recoveryUserId: recovery } : {}) },
        verify,
      );
      verify();
      returnToAddress.current = true;
      setUrl(invite.url);
      setFormOpen(false);
      setNotice('Invite created. Copy its address before leaving this section.');
      await refresh();
    } catch (cause) {
      if (!mounted.current) return;
      setError(
        cause instanceof Error && 'status' in cause
          ? cause.message
          : 'The invitation request could not be confirmed. Refresh the list before trying again.',
      );
      await refresh();
    } finally {
      if (mounted.current) {
        mutation.current = false;
        setBusy(false);
      }
    }
  }
  async function revoke(id: string) {
    if (mutation.current || loading || !fresh) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`invites/${encodeURIComponent(id)}/revoke`, {}, verify);
      verify();
      setUrl('');
      setNotice('Invite revoked.');
      await refresh();
    } catch (cause) {
      if (!mounted.current) return;
      setError(
        cause instanceof Error && 'status' in cause
          ? cause.message
          : 'The revoke request could not be confirmed. Refresh the list before trying again.',
      );
      await refresh();
    } finally {
      if (mounted.current) {
        mutation.current = false;
        setBusy(false);
      }
    }
  }
  async function copy() {
    const copied = url;
    try {
      await navigator.clipboard.writeText(copied);
      if (mounted.current && copied === currentUrl.current) setNotice('Invite link copied.');
    } catch {
      if (mounted.current && copied === currentUrl.current)
        setNotice('Select the link below and copy it manually.');
    }
  }
  const disabled = busy || loading || !fresh;
  const invalidRecipient = !!recovery && !users.some((user) => user.id === recovery);
  const issues = (
    <>
      {error && <p role="alert">{error}</p>}
      {readError && (
        <div role="alert">
          <p>{readError} The current invitation list is unavailable.</p>
          <Button disabled={busy || loading} onClick={() => void refresh()}>
            Refresh invites
          </Button>
        </div>
      )}
    </>
  );
  return (
    <section className="admin-invites sp-ui" aria-label="Invites">
      <div className="admin-section-heading">
        <h2>Invites</h2>
        <button
          ref={createButton}
          className="sp-control sp-primary"
          disabled={disabled}
          onClick={() => {
            returnToAddress.current = false;
            setError('');
            setFormOpen(true);
          }}
        >
          Create invite
        </button>
      </div>
      <p className="sp-muted">
        Invite a new everyday account, or help an active account register a replacement passkey.
      </p>
      {url && (
        <section className="admin-invite-created" aria-label="Invite ready">
          <h3>Invite ready</h3>
          <p>
            Copy this link now and send it to the intended person. It will not be shown again after
            you leave this section.
          </p>
          <label>
            New invite link
            <input
              ref={createdAddress}
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <Button onClick={() => void copy()}>Copy invite link</Button>
          <p className="sp-muted">
            If copying is unavailable, select the address and copy it manually.
          </p>
        </section>
      )}
      {!formOpen && issues}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading invites…</p>}
      {fresh && invites.length ? (
        <ul aria-label="Invites" className="admin-invite-list">
          {invites.map((invite, index) => (
            <li key={invite.id} className="admin-person-row">
              <div>
                <strong>
                  {invite.recoveryName ? `Recover ${invite.recoveryName}` : 'New account'}
                </strong>
                <p className="sp-muted">
                  {invite.status}
                  {invite.usedBy ? ` by ${invite.usedBy}` : ''}
                </p>
                <p className="sp-muted">Expires {new Date(invite.expiresAt).toLocaleString()}</p>
              </div>
              {invite.status === 'Available' && (
                <ActionMenu
                  label={`Actions for invite ${index + 1}`}
                  actions={[
                    {
                      label: 'Revoke invite',
                      destructive: true,
                      disabled: busy,
                      onClick: () => void revoke(invite.id),
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      ) : fresh && !loading ? (
        <p>No invites yet.</p>
      ) : null}
      {/* A controlled close restores focus after the new address ref has mounted. */}
      <Modal
        open={formOpen}
        title="Create invite"
        icon="person"
        dismissDisabled={busy}
        finalFocus={() => (returnToAddress.current ? createdAddress.current : createButton.current)}
        onOpenChange={(open) => {
          if (!open) setFormOpen(false);
        }}
      >
        <form
          className="admin-invite-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label>
            Invite for
            <select
              className="sp-control"
              disabled={disabled}
              value={recovery}
              onChange={(event) => setRecovery(event.target.value)}
            >
              <option value="">A new account</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  Recover {adminAccountLabel(user, users)}
                  {user.isAdmin ? ' (admin)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Expires in
            <select
              className="sp-control"
              disabled={disabled}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
            >
              <option value={1}>1 hour</option>
              <option value={24}>1 day</option>
              <option value={168}>7 days</option>
              <option value={720}>30 days</option>
            </select>
          </label>
          {recovery && (
            <p>
              Once accepted, recovery replaces this account’s old passkeys and signs out its other
              devices.
            </p>
          )}
          {fresh && invalidRecipient && (
            <p role="alert">
              This account is no longer eligible for recovery. Choose an active account.
            </p>
          )}
          {loading && <p role="status">Loading invitation recipients…</p>}
          {issues}
          <div className="admin-dialog-actions">
            <Button type="button" disabled={busy} onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button primary type="submit" disabled={disabled || invalidRecipient}>
              {busy ? 'Creating…' : 'Create invite'}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
