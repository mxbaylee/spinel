import { useEffect, useRef, useState } from 'react';
import { ActionMenu } from '../src/ui/redesign/Controls.tsx';
import { api } from './api.ts';
import { AdminInvites } from './AdminInvites.tsx';
import { AdminAccountRecovery } from './AdminAccountRecovery.tsx';
import type { RecoveryAction } from './AdminAccountRecovery.tsx';
import { adminAccountLabel } from './adminAccountLabel.ts';

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
  const [recovery, setRecovery] = useState<RecoveryAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshInvites, setRefreshInvites] = useState(0);
  const confirmation = useRef<HTMLDialogElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (action) confirmation.current?.showModal();
    else confirmation.current?.close();
  }, [action]);
  const refresh = async () => {
    setLoading(true);
    try {
      const next = (await api<{ users: User[] }>('admin/users')).users;
      setUsers(next);
      setLoaded(true);
      return next;
    } finally {
      setLoading(false);
    }
  };
  const focusAccount = (id: string) => {
    requestAnimationFrame(() => {
      const button = document
        .getElementById(`admin-account-${id}`)
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      (button ?? refreshButton.current)?.focus();
    });
  };
  const closeRecovery = () => {
    if (recovery) focusAccount(recovery.user.id);
    setRecovery(null);
  };
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
          ref={refreshButton}
          disabled={busy || loading}
          onClick={() => {
            setError('');
            void refresh().catch((cause) => setError(cause.message));
          }}
        >
          Refresh users
        </button>
        {error && !action && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {loading && <p role="status">Loading users…</p>}
        {loaded && !loading && !users.length && <p>No accounts are available.</p>}
        <ul className="admin-users">
          {users.map((user) => (
            <li key={user.id}>
              <section
                id={`admin-account-${user.id}`}
                aria-label={`${adminAccountLabel(user, users)} account`}
              >
                <div className="admin-account-heading">
                  <div>
                    <h4>{adminAccountLabel(user, users)}</h4>
                    <p>
                      {user.isAdmin ? 'Admin' : 'Member'} · {user.disabled ? 'Disabled' : 'Active'}
                    </p>
                  </div>
                  {user.disabled && (
                    <ActionMenu
                      label={`Actions for ${adminAccountLabel(user, users)}`}
                      actions={[
                        {
                          label: 'Reactivate…',
                          disabled: busy || loading,
                          onClick: () => {
                            setError('');
                            setNotice('');
                            setRecovery({
                              user,
                              label: adminAccountLabel(user, users),
                              kind: 'reactivate',
                            });
                          },
                        },
                        ...(!user.isAdmin
                          ? [
                              {
                                label: 'Transfer ownership…',
                                disabled: busy || loading,
                                onClick: () => {
                                  setError('');
                                  setNotice('');
                                  setRecovery({
                                    user,
                                    label: adminAccountLabel(user, users),
                                    kind: 'transfer',
                                  });
                                },
                              },
                            ]
                          : []),
                      ]}
                    >
                      Actions
                    </ActionMenu>
                  )}
                </div>
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
                  <p>
                    {user.disabled
                      ? 'Reactivate this account before creating a recovery invite.'
                      : 'No passkeys. Use a recovery invite to restore access to an active account.'}
                  </p>
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
        {recovery && (
          <AdminAccountRecovery
            key={`${recovery.user.id}-${recovery.kind}`}
            action={recovery}
            onClose={closeRecovery}
            onRefresh={async () => {
              setRefreshInvites((value) => value + 1);
              return refresh();
            }}
            onComplete={(text) => {
              const id = recovery.user.id;
              setNotice(text);
              setRecovery(null);
              setRefreshInvites((value) => value + 1);
              void refresh()
                .catch(() =>
                  setError(
                    'The change was saved, but the account list could not refresh. Refresh users.',
                  ),
                )
                .finally(() => focusAccount(id));
            }}
          />
        )}
      </section>
      <AdminInvites key={refreshInvites} />
    </>
  );
}
