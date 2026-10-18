import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { AdminInvites } from './AdminInvites.tsx';

type User = {
  id: string;
  name: string;
  isAdmin: boolean;
  disabled: boolean;
  passkeys: {
    id: string;
    name: string;
    provider: string;
    createdAt: number;
    lastUsedAt: number | null;
  }[];
};
type Action = { user: User; key?: User['passkeys'][number] };
export function AdminUsers({ currentId }: { currentId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshInvites, setRefreshInvites] = useState(0);
  const confirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (action) confirmation.current?.showModal();
    else confirmation.current?.close();
  }, [action]);
  const refresh = async () => setUsers((await api<{ users: User[] }>('admin/users')).users);
  useEffect(() => {
    void refresh().catch((cause) => setError(cause.message));
  }, []);
  const perform = async () => {
    if (!action) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(
        `admin/users/${action.user.id}/${action.key ? `passkeys/${encodeURIComponent(action.key.id)}/remove` : 'disable'}`,
        {},
      );
      setNotice(
        action.key
          ? 'Passkey removed and its sessions ended.'
          : 'Account disabled. Documents and shares have been kept.',
      );
      if (action.user.id === currentId) await api('session');
      setAction(null);
      setRefreshInvites((value) => value + 1);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update access. Refresh and try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section aria-label="Users and passkeys">
        <h3>Users and passkeys</h3>
        <button
          disabled={busy}
          onClick={() => {
            setError('');
            void refresh().catch((cause) => setError(cause.message));
          }}
        >
          Refresh users
        </button>
        {error && !action && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <ul className="admin-users">
          {users.map((user) => (
            <li key={user.id}>
              <section aria-label={`${user.name} account`}>
                <h4>{user.name}</h4>
                <p>
                  {user.isAdmin ? 'Admin' : 'Member'} · {user.disabled ? 'Disabled' : 'Active'}
                </p>
                {!user.disabled && (
                  <button
                    disabled={busy || user.id === currentId}
                    onClick={() => {
                      setError('');
                      setAction({ user });
                    }}
                  >
                    Disable account
                  </button>
                )}
                {user.id === currentId && (
                  <p>This is your admin account. It cannot disable itself.</p>
                )}
                {user.passkeys.length ? (
                  <ul aria-label={`${user.name} passkeys`}>
                    {user.passkeys.map((key) => (
                      <li key={key.id}>
                        <strong>{key.name}</strong> · {key.provider}
                        <p>
                          Added {new Date(key.createdAt).toLocaleString()} · Last used{' '}
                          {key.lastUsedAt === null
                            ? 'Never'
                            : new Date(key.lastUsedAt).toLocaleString()}
                        </p>
                        <button
                          disabled={
                            busy || (user.isAdmin && !user.disabled && user.passkeys.length === 1)
                          }
                          onClick={() => {
                            setError('');
                            setAction({ user, key });
                          }}
                        >
                          Remove {key.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No passkeys. Use a recovery invite to restore access to an active account.</p>
                )}
                {user.isAdmin && !user.disabled && user.passkeys.length === 1 && (
                  <p>Add another passkey before removing this admin’s last passkey.</p>
                )}
              </section>
            </li>
          ))}
        </ul>
        <dialog
          className="admin-confirmation"
          ref={confirmation}
          role="alertdialog"
          aria-label="Confirm access removal"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setAction(null);
          }}
        >
          {action && (
            <>
              {error && <p role="alert">{error}</p>}
              <h4>{action.key ? `Remove ${action.key.name}?` : `Disable ${action.user.name}?`}</h4>
              <p>
                {action.key
                  ? 'This passkey will stop working, and sessions signed in with it will end. A synced passkey may be used on several devices. Older sessions that cannot be linked to a passkey will also be signed out.'
                  : 'This account’s sessions and open editor connections will end. Its documents and shares will remain, including access for other collaborators.'}
              </p>
              <button autoFocus disabled={busy} onClick={() => setAction(null)}>
                Cancel
              </button>
              <button disabled={busy} onClick={() => void perform()}>
                Confirm removal
              </button>
            </>
          )}
        </dialog>
      </section>
      <AdminInvites key={refreshInvites} />
    </>
  );
}
