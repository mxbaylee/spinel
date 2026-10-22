import { useEffect, useRef, useState } from 'react';
import type { TransferPreview } from '../src/shared/adminRecovery.ts';
import { Button, Choice, Modal } from '../src/ui/redesign/Controls.tsx';
import { api } from './api.ts';
import { adminAccountLabel } from './adminAccountLabel.ts';
import './admin-recovery.css';

export type RecoveryAccount = { id: string; name: string; isAdmin: boolean; disabled: boolean };
export type RecoveryAction = {
  user: RecoveryAccount;
  label?: string;
  kind: 'reactivate' | 'transfer';
};

function message(cause: unknown) {
  if (cause instanceof Error && 'status' in cause) return cause.message;
  return 'The result could not be confirmed. Refresh the account details before trying again.';
}

export function AdminAccountRecovery({
  action,
  onClose,
  onComplete,
  onRefresh,
}: {
  action: RecoveryAction;
  onClose: () => void;
  onComplete: (notice: string) => void;
  onRefresh: () => Promise<RecoveryAccount[]>;
}) {
  const { user, kind } = action;
  const sourceLabel = action.label ?? user.name;
  const transfer = kind === 'transfer';
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(transfer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [disabled, setDisabled] = useState<boolean | null>(user.disabled);
  const [attempted, setAttempted] = useState(false);
  const request = useRef(0);
  const mounted = useRef(true);
  const path = `admin/users/${encodeURIComponent(user.id)}`;

  async function refresh(reconcile: boolean, keepError = false) {
    const generation = ++request.current;
    setLoading(true);
    setRefreshError('');
    setPreview(null);
    if (!keepError) setError('');
    if (reconcile) setDisabled(null);
    try {
      if (reconcile) {
        const accounts = await onRefresh();
        if (!mounted.current || generation !== request.current) return;
        const current = accounts.find((account) => account.id === user.id);
        setDisabled(current?.disabled ?? null);
        if (!current || !current.disabled) {
          if (!current) setRefreshError('This account is no longer available. Refresh users.');
          return;
        }
      }
      if (transfer) {
        const next = await api<TransferPreview>(`${path}/transfer-preview`);
        if (!mounted.current || generation !== request.current) return;
        setPreview(next);
        setTarget((value) => (next.recipients.some((person) => person.id === value) ? value : ''));
      }
    } catch (cause) {
      if (mounted.current && generation === request.current)
        setRefreshError(
          cause instanceof Error ? cause.message : 'Could not load the account details.',
        );
    } finally {
      if (mounted.current && generation === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (transfer) void refresh(false);
    return () => {
      mounted.current = false;
      request.current++;
    };
    // The parent keys each dialog by account and action. Its current readback
    // callback is used only by explicit refreshes, not as a new mount request.
  }, []);

  async function perform() {
    if (busy || loading || disabled !== true || (transfer && (!preview || !target))) return;
    setBusy(true);
    setError('');
    setRefreshError('');
    setAttempted(true);
    try {
      await api(
        `${path}/${kind}`,
        transfer ? { targetId: target, confirmation: preview!.confirmation } : {},
      );
      if (!mounted.current) return;
      onComplete(
        transfer
          ? `Ownership transferred from ${sourceLabel}. Existing grants, history and Trash were kept. Guest links are off.`
          : `${sourceLabel} is active. Create a recovery invite to restore sign-in; old sign-ins remain invalid.`,
      );
    } catch (cause) {
      if (!mounted.current) return;
      // A disconnected response or failed post-commit connection refresh does
      // not establish rollback. Read current state before permitting a retry.
      setError(message(cause));
      await refresh(true, true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const count = preview ? preview.counts.items + preview.counts.folders : 0;
  const recipient = preview?.recipients.find((person) => person.id === target);
  const recipientLabel =
    recipient && preview
      ? adminAccountLabel(recipient, [preview.source, ...preview.recipients])
      : '';
  return (
    <Modal
      open
      title={transfer ? `Transfer ownership from ${sourceLabel}` : `Reactivate ${sourceLabel}?`}
      icon={transfer ? 'folder' : 'person'}
      description={
        transfer
          ? 'Hand over this disabled account’s files without opening their contents.'
          : 'Restore this account without restoring its old sign-ins.'
      }
      dismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="admin-recovery">
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">Loading account details…</p>}
        {refreshError && (
          <div role="alert">
            <p>{refreshError}</p>
            <Button disabled={busy || loading} onClick={() => void refresh(true, !!error)}>
              Refresh account details
            </Button>
          </div>
        )}
        {disabled === false && (
          <p role="status">
            This account is active.{' '}
            {transfer
              ? 'Only disabled accounts can hand over files.'
              : 'Create a recovery invite to restore sign-in.'}
          </p>
        )}
        {!transfer && error && !busy && !loading && !refreshError && disabled === true && (
          <p role="status">
            Account details are up to date. This account is still disabled; try reactivating it
            again.
          </p>
        )}
        {!transfer && (
          <>
            <p>
              Documents, shares, history and Trash stay as they are. Files already handed over stay
              with their new owner.
            </p>
            <p>
              Old passkeys, sessions and assistant connections remain invalid. Create a recovery
              invite after reactivation so {user.name} can register a new passkey.
            </p>
            <p>Existing active document links can work again. Revoked links stay off.</p>
          </>
        )}
        {transfer && preview && (
          <>
            <dl className="admin-transfer-counts" aria-label="Retained content counts">
              <div>
                <dt>Items</dt>
                <dd>{preview.counts.items}</dd>
              </div>
              <div>
                <dt>Folders</dt>
                <dd>{preview.counts.folders}</dd>
              </div>
              <div>
                <dt>Guest links</dt>
                <dd>{preview.counts.links}</dd>
              </div>
            </dl>
            <p className="sp-muted">Counts include Spaces and their contents, including Trash.</p>
            {!count ? (
              <p role="status">This account has no owned files or folders to transfer.</p>
            ) : !preview.recipients.length ? (
              <p role="status">
                There is no active everyday account to receive these files. Invite or reactivate
                one, then refresh the details.
              </p>
            ) : (
              <>
                <Choice
                  label="New owner"
                  value={target}
                  options={[
                    { value: '', label: 'Choose an account' },
                    ...preview.recipients.map((person) => ({
                      value: person.id,
                      label: adminAccountLabel(person, [preview.source, ...preview.recipients]),
                    })),
                  ]}
                  onChange={setTarget}
                  disabled={busy || loading}
                />
                {recipient && (
                  <p>
                    <strong>{recipientLabel}</strong> will own these files.
                  </p>
                )}
                <p>
                  They will appear in a folder named after {user.name}. History, Trash and other
                  collaborators’ grants are kept. {user.name} keeps no access to the transferred
                  files.
                </p>
                <p>
                  All guest links will be off. The new owner can create fresh links; old links
                  cannot be reused.
                </p>
              </>
            )}
            {!busy && (
              <Button onClick={() => void refresh(true, !!error)}>Refresh transfer details</Button>
            )}
          </>
        )}
        <div className="admin-recovery-actions">
          <Button disabled={busy} onClick={onClose}>
            {attempted ? 'Close' : 'Cancel'}
          </Button>
          <Button
            primary
            disabled={
              busy ||
              loading ||
              !!refreshError ||
              disabled !== true ||
              (transfer && (!count || !recipient))
            }
            onClick={() => void perform()}
          >
            {busy ? 'Please wait…' : transfer ? 'Transfer ownership' : 'Reactivate account'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
