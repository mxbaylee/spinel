import { useEffect, useState } from 'react';
import { api } from './api.ts';

type Invite = {
  id: string;
  expiresAt: number;
  recoveryName: string | null;
  usedBy: string | null;
  status: string;
};
type Recipient = { id: string; name: string; isAdmin: number };
export function AdminInvites() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [users, setUsers] = useState<Recipient[]>([]);
  const [hours, setHours] = useState(168);
  const [recovery, setRecovery] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function refresh() {
    const [list, recipients] = await Promise.all([
      api<{ invites: Invite[] }>('invites'),
      api<{ users: Recipient[] }>('invites/recipients'),
    ]);
    setInvites(list.invites);
    setUsers(recipients.users);
  }
  useEffect(() => {
    void refresh().catch((error) => setError(error.message));
  }, []);
  async function create() {
    setBusy(true);
    setError('');
    setNotice('');
    setUrl('');
    try {
      const invite = await api<{ url: string }>('invites', {
        hours,
        ...(recovery ? { recoveryUserId: recovery } : {}),
      });
      setUrl(invite.url);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not create the invite.');
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`invites/${id}/revoke`, {});
      setUrl('');
      await refresh();
      setNotice('Invite revoked.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not revoke the invite.');
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Invite link copied.');
    } catch {
      setNotice('Select the link below and copy it manually.');
    }
  }
  return (
    <div className="invites">
      <h3>Invites</h3>
      <label>
        Invite for
        <select value={recovery} onChange={(event) => setRecovery(event.target.value)}>
          <option value="">A new account</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              Recover {user.name}
              {user.isAdmin ? ' (admin)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Expires in
        <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
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
      <button className="primary" disabled={busy} onClick={() => void create()}>
        Create invite
      </button>
      {url && (
        <div>
          <p>
            Copy this link now and send it to the intended person. It will not be shown again after
            you leave this page.
          </p>
          <label>
            New invite link
            <input readOnly value={url} onFocus={(event) => event.target.select()} />
          </label>
          <button onClick={() => void copy()}>Copy invite link</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {invites.length ? (
        <ul aria-label="Invites">
          {invites.map((invite) => (
            <li key={invite.id}>
              <strong>
                {invite.recoveryName ? `Recover ${invite.recoveryName}` : 'New account'}
              </strong>{' '}
              — {invite.status}
              {invite.usedBy ? ` by ${invite.usedBy}` : ''}
              <p>Expires {new Date(invite.expiresAt).toLocaleString()}</p>
              {invite.status === 'Available' && (
                <button disabled={busy} onClick={() => void revoke(invite.id)}>
                  Revoke invite
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No invites yet.</p>
      )}
    </div>
  );
}
