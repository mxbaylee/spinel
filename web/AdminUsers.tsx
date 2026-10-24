import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { api } from './api.ts';
import { AdminAccountRecovery } from './AdminAccountRecovery.tsx';
import type { RecoveryAction } from './AdminAccountRecovery.tsx';
import { adminAccountLabel } from './adminAccountLabel.ts';
import './administration.css';

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
export function AdminUsers({
  currentId,
  onRequestInvite,
  onBusyChange,
}: {
  currentId: string;
  onRequestInvite?: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [managed, setManaged] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refreshButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const mutation = useRef(false);
  const verify = () => {
    if (!mounted.current) throw new Error('This administration view is no longer current.');
  };
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  useEffect(() => {
    onBusyChange?.(busy || recoveryBusy);
    return () => onBusyChange?.(false);
  }, [busy, recoveryBusy, onBusyChange]);
  async function refresh() {
    const generation = ++request.current;
    setLoading(true);
    try {
      const next = (
        await api<{ users: User[] }>('admin/users', undefined, () => {
          verify();
          if (generation !== request.current) throw new Error('A newer account request is active.');
        })
      ).users;
      if (!mounted.current || generation !== request.current) return next;
      setUsers(next);
      setLoaded(true);
      return next;
    } catch (cause) {
      if (mounted.current && generation === request.current)
        setError(cause instanceof Error ? cause.message : 'Could not refresh users.');
      throw cause;
    } finally {
      if (mounted.current && generation === request.current) setLoading(false);
    }
  }
  const accountButton = (id: string) =>
    document
      .getElementById(`admin-account-${id}`)
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? refreshButton.current;
  const focusAccount = (id: string) =>
    requestAnimationFrame(() => {
      if (mounted.current) accountButton(id)?.focus();
    });
  const closeRecovery = () => {
    if (recovery) focusAccount(recovery.user.id);
    setRecovery(null);
  };
  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  async function perform() {
    if (!action || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let committed = false;
    const target = action;
    try {
      await api(
        `admin/users/${encodeURIComponent(target.user.id)}/${target.key ? `passkeys/${encodeURIComponent(target.key.id)}/remove` : 'disable'}`,
        {},
        verify,
      );
      committed = true;
      if (!mounted.current) return;
      setNotice(
        target.key
          ? 'Passkey removed and its sessions ended.'
          : 'Account disabled. Documents and shares have been kept.',
      );
      setAction(null);
      if (target.user.id === currentId) await api('session', undefined, verify);
      await refresh();
    } catch (cause) {
      if (!mounted.current) return;
      setError(
        committed
          ? 'The change was saved, but the account list could not refresh. Refresh users.'
          : cause instanceof Error
            ? cause.message
            : 'The result could not be confirmed. Refresh users before trying again.',
      );
      // A transport/cleanup failure can follow a committed removal; re-read without
      // inventing rollback or restoring credentials in the optimistic UI.
      if (!committed) {
        try {
          await refresh();
        } catch {
          /* Keep the original mutation error visible. */
        }
      }
    } finally {
      if (mounted.current) {
        mutation.current = false;
        setBusy(false);
      }
    }
  }
  const member = users.find((user) => user.id === managed);
  function beginRecovery(user: User, kind: RecoveryAction['kind']) {
    setError('');
    setNotice('');
    setRecovery({ user, label: adminAccountLabel(user, users), kind });
  }
  return (
    <section className="admin-people sp-ui" aria-label="Users and passkeys">
      <div className="admin-section-heading">
        <h2>People</h2>
        <button
          ref={refreshButton}
          className="sp-control"
          disabled={busy || loading}
          onClick={() => {
            setError('');
            void refresh().catch(() => {});
          }}
        >
          Refresh users
        </button>
      </div>
      <p className="sp-muted">Manage the instance. Document content stays private.</p>
      {error && !action && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading users…</p>}
      {loaded && !loading && !users.length && <p>No accounts are available.</p>}
      <ul className="admin-people-list">
        {users.map((user) => (
          <li key={user.id}>
            <section
              id={`admin-account-${user.id}`}
              aria-label={`${adminAccountLabel(user, users)} account`}
              className="admin-person"
            >
              <div className="admin-person-row">
                <div>
                  <h3>
                    {adminAccountLabel(user, users)}
                    {user.id === currentId ? ' (you)' : ''}
                  </h3>
                  <p className="sp-muted">
                    {user.isAdmin ? 'Operator' : 'Member'} · {user.disabled ? 'Disabled' : 'Active'}
                  </p>
                  <p className="sp-muted">
                    {user.passkeys.length} {user.passkeys.length === 1 ? 'passkey' : 'passkeys'}
                  </p>
                </div>
                <ActionMenu
                  label={`Actions for ${adminAccountLabel(user, users)}`}
                  actions={[
                    {
                      label: 'Manage passkeys',
                      disabled: busy || loading,
                      onClick: () => {
                        setError('');
                        setManaged(user.id);
                      },
                    },
                    ...(onRequestInvite
                      ? [
                          {
                            label: 'Create recovery invite…',
                            disabled: busy || loading || user.disabled,
                            onClick: () => onRequestInvite(user.id),
                          },
                        ]
                      : []),
                    ...(user.disabled
                      ? [
                          {
                            label: 'Reactivate…',
                            disabled: busy || loading,
                            onClick: () => beginRecovery(user, 'reactivate'),
                          },
                          ...(!user.isAdmin
                            ? [
                                {
                                  label: 'Transfer ownership…',
                                  disabled: busy || loading,
                                  onClick: () => beginRecovery(user, 'transfer'),
                                },
                              ]
                            : []),
                        ]
                      : [
                          {
                            label: 'Disable account…',
                            destructive: true,
                            disabled: busy || loading || user.id === currentId,
                            onClick: () => {
                              setError('');
                              setAction({ user });
                            },
                          },
                        ]),
                  ]}
                />
              </div>
              {user.id === currentId && (
                <p className="sp-muted">This is your admin account. It cannot disable itself.</p>
              )}
              {user.disabled && (
                <p className="sp-muted">
                  Reactivate this account before creating a recovery invite.
                </p>
              )}
            </section>
          </li>
        ))}
      </ul>
      {member && (
        <Modal
          open
          title={`Passkeys for ${adminAccountLabel(member, users)}`}
          icon="key"
          dismissDisabled={busy}
          finalFocus={() => accountButton(member.id)}
          onOpenChange={(open) => {
            if (!open) setManaged(null);
          }}
        >
          <div className="admin-passkeys" id={`admin-passkeys-${member.id}`}>
            {error && !action && <p role="alert">{error}</p>}
            {member.passkeys.length ? (
              <ul aria-label={`${member.name} passkeys`}>
                {member.passkeys.map((key) => (
                  <li key={key.id} className="admin-person-row">
                    <div>
                      <strong>{key.name}</strong>
                      <p className="sp-muted">{key.provider}</p>
                      <p className="sp-muted">
                        Added {new Date(key.createdAt).toLocaleString()} · Last used{' '}
                        {key.lastUsedAt === null
                          ? 'Never'
                          : new Date(key.lastUsedAt).toLocaleString()}
                      </p>
                    </div>
                    <ActionMenu
                      label={`Actions for passkey ${key.name}`}
                      actions={[
                        {
                          label: 'Remove passkey…',
                          destructive: true,
                          disabled:
                            busy ||
                            (member.isAdmin && !member.disabled && member.passkeys.length === 1),
                          onClick: () => {
                            setError('');
                            setAction({ user: member, key });
                          },
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {member.disabled
                  ? 'Reactivate this account before creating a recovery invite.'
                  : 'No passkeys. Use a recovery invite to restore access to an active account.'}
              </p>
            )}
            {member.isAdmin && !member.disabled && member.passkeys.length === 1 && (
              <p>This admin’s last passkey cannot be removed. Add another passkey first.</p>
            )}
            <Button disabled={busy} onClick={() => setManaged(null)}>
              Done
            </Button>
          </div>
        </Modal>
      )}
      {action && (
        <Modal
          open
          title={action.key ? `Remove ${action.key.name}?` : `Disable ${action.user.name}?`}
          icon={action.key ? 'key' : 'person'}
          dismissDisabled={busy}
          finalFocus={() =>
            action.key
              ? (document
                  .getElementById(`admin-passkeys-${action.user.id}`)
                  ?.querySelector<HTMLButtonElement>('button:not(:disabled)') ??
                accountButton(action.user.id))
              : accountButton(action.user.id)
          }
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
        >
          <div className="admin-confirmation-content">
            {error && <p role="alert">{error}</p>}
            <p>
              {action.key
                ? 'This passkey will stop working, and sessions signed in with it will end. A synced passkey may be used on several devices. Older sessions that cannot be linked to a passkey will also be signed out.'
                : 'This account’s sessions and open editor connections will end. Its documents and shares will remain, including access for other collaborators.'}
            </p>
            <div className="admin-dialog-actions">
              <Button disabled={busy} onClick={() => setAction(null)}>
                Cancel
              </Button>
              <Button primary disabled={busy} onClick={() => void perform()}>
                {busy ? 'Removing…' : 'Confirm removal'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {recovery && (
        <AdminAccountRecovery
          key={`${recovery.user.id}-${recovery.kind}`}
          action={recovery}
          onClose={closeRecovery}
          onBusyChange={setRecoveryBusy}
          onRefresh={refresh}
          onComplete={(text) => {
            if (!mounted.current) return;
            const id = recovery.user.id;
            setNotice(text);
            setRecovery(null);
            void refresh()
              .catch(() => {
                if (mounted.current)
                  setError(
                    'The change was saved, but the account list could not refresh. Refresh users.',
                  );
              })
              .finally(() => focusAccount(id));
          }}
        />
      )}
    </section>
  );
}
