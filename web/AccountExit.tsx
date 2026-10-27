import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { EntryFrame } from './EntryFrame.tsx';
import { exitCurrentBrowser, finishAccountExit, watchAccountExit } from './offline/accountExit.ts';
import type { AccountExit } from './offline/accountExit.ts';
import { readOfflineExitCounts, deleteOfflineExitData } from './offline/deviceStorage.ts';

export type ExitCounts = { downloads: number; pending: number; uncertain: number };
export type ExitViewState = {
  remote: 'waiting' | 'sending' | 'confirmed' | 'unknown';
  persisted: boolean;
  counts: ExitCounts | null;
  checking: boolean;
  choice: 'undecided' | 'kept' | 'deleted';
  canDelete: boolean;
  deleting: boolean;
  error: string;
};

/** Only counts and explicit preservation choices remain after private content locks. */
export function AccountExitView({
  state,
  onKeep,
  onDelete,
  onRetry,
  onFreshExit,
  onContinue,
}: {
  state: ExitViewState;
  onKeep(): void;
  onDelete(): void;
  onRetry(): void;
  onFreshExit(): void;
  onContinue(): void;
}) {
  const [confirm, setConfirm] = useState(false);
  const remove = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.choice === 'deleted' || !state.canDelete) setConfirm(false);
  }, [state.choice, state.canDelete]);
  const pending = state.counts ? state.counts.pending + state.counts.uncertain : null;
  return (
    <EntryFrame
      title="Local access is locked."
      intro={
        state.remote === 'confirmed'
          ? 'The server confirmed your sign-out.'
          : 'Your private files are closed on this device. Server sign-out still needs confirmation.'
      }
      eyebrow="SIGNING OUT"
      onHome={state.remote === 'confirmed' ? onContinue : onKeep}
      footer="Changes that have not synced remain only on this device."
    >
      <p ref={heading} tabIndex={-1} role="status" className="ej-feedback">
        {state.remote === 'sending'
          ? 'Waiting for the server to confirm sign-out…'
          : state.remote === 'confirmed'
            ? 'Signed out on the server.'
            : state.remote === 'unknown'
              ? 'This sign-out could not be matched to the browser’s current sign-in. Start a new sign-out for this browser.'
              : state.persisted
                ? 'Sign-out is saved for retry. Spinel will try again when this app reconnects.'
                : 'The sign-out request could not be saved on this device. Keep this tab open and try again when connected.'}
      </p>
      {state.checking ? (
        <p role="status">Checking saved changes on this device…</p>
      ) : state.choice === 'deleted' ? (
        <p>
          Offline data for this account was deleted from this device. Server documents were not
          changed.
        </p>
      ) : state.choice === 'kept' ? (
        <p>Your offline data is kept and locked. Sign in to the same account to recover it.</p>
      ) : pending === null ? (
        <p>
          Any offline data is kept and locked. Spinel could not confirm how many changes remain.
        </p>
      ) : pending > 0 ? (
        <p>
          {pending} {pending === 1 ? 'document has' : 'documents have'} pending or unchecked changes
          on this device. Keep them to recover after signing in to the same account, or explicitly
          delete this account’s offline data.
        </p>
      ) : (
        <p>Any downloaded copies are kept and locked for this account.</p>
      )}
      {state.error && (
        <p className="ej-feedback" role="alert">
          {state.error}
        </p>
      )}
      <div className="sp-actions">
        {state.remote === 'unknown' ? (
          <Button primary onClick={onFreshExit}>
            Sign out this browser now
          </Button>
        ) : state.choice === 'undecided' ? (
          <Button primary disabled={state.deleting} onClick={onKeep}>
            Keep changes
          </Button>
        ) : state.remote === 'confirmed' ? (
          <Button primary onClick={onContinue}>
            Continue
          </Button>
        ) : null}
        {state.remote !== 'confirmed' && state.remote !== 'unknown' && (
          <Button disabled={state.remote === 'sending' || state.deleting} onClick={onRetry}>
            Try sign-out again
          </Button>
        )}
        {state.canDelete && state.choice !== 'deleted' && (
          <button
            ref={remove}
            className="sp-control"
            disabled={state.deleting || state.checking}
            onClick={() => setConfirm(true)}
          >
            Delete offline data…
          </button>
        )}
      </div>
      <Modal
        title="Delete this account’s offline data?"
        icon="trash"
        open={confirm}
        dismissDisabled={state.deleting}
        onOpenChange={setConfirm}
        finalFocus={() => remove.current ?? heading.current}
        description="This deletes downloaded copies and unsynced changes for the signed-out account from this device. Changes that never reached the server cannot be recovered. Server documents stay unchanged."
      >
        {state.error && <p role="alert">{state.error}</p>}
        <div className="sp-actions">
          <Button disabled={state.deleting} onClick={() => setConfirm(false)}>
            Keep offline data
          </Button>
          <Button primary disabled={state.deleting} onClick={onDelete}>
            {state.deleting ? 'Deleting…' : 'Delete offline data'}
          </Button>
        </div>
      </Modal>
    </EntryFrame>
  );
}

export function AccountExitScreen({
  exit,
  onReplace,
  onContinue,
}: {
  exit: AccountExit | 'unknown';
  onReplace(exit: AccountExit): void;
  onContinue(): void;
}) {
  const [state, setState] = useState<ExitViewState>({
    remote: exit === 'unknown' ? 'unknown' : 'waiting',
    persisted: exit !== 'unknown' && exit.persisted,
    counts: null,
    checking: exit !== 'unknown' && exit.intent.hasOfflineAccount && exit.persisted,
    choice: 'undecided',
    canDelete: exit !== 'unknown' && exit.intent.hasOfflineAccount && exit.persisted,
    deleting: false,
    error: '',
  });
  const mounted = useRef(false);
  const sending = useRef(false);
  const latest = useRef(state);
  latest.current = state;
  const verify = () => {
    if (!mounted.current) throw new DOMException('This exit view closed.', 'AbortError');
    if (exit !== 'unknown') exit.verifyCurrent();
  };
  async function retry() {
    if (exit === 'unknown') return;
    try {
      verify();
    } catch (error) {
      if (mounted.current)
        setState((before) => ({
          ...before,
          remote: 'unknown',
          canDelete: false,
          error:
            error instanceof Error
              ? error.message
              : 'The account changed. Its offline data was kept.',
        }));
      return;
    }
    if (sending.current || latest.current.remote === 'confirmed') return;
    sending.current = true;
    setState((before) => ({ ...before, remote: 'sending', error: '' }));
    try {
      await finishAccountExit(exit, verify);
      verify();
      setState((before) => ({ ...before, remote: 'confirmed', error: '' }));
    } catch (error) {
      if (mounted.current)
        setState((before) => ({
          ...before,
          remote:
            error instanceof DOMException && error.name === 'AbortError' ? 'unknown' : 'waiting',
          canDelete:
            error instanceof DOMException && error.name === 'AbortError' ? false : before.canDelete,
          error:
            error instanceof Error ? error.message : 'Sign-out has not been confirmed. Try again.',
        }));
    } finally {
      sending.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (
      exit !== 'unknown' &&
      exit.intent.hasOfflineAccount &&
      exit.persisted &&
      exit.intent.accountId
    )
      void readOfflineExitCounts(exit.intent.accountId, verify)
        .then((counts) => {
          verify();
          setState((before) => ({ ...before, counts, checking: false }));
        })
        .catch((error) => {
          if (mounted.current)
            setState((before) => ({
              ...before,
              checking: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Could not check saved changes. They were kept.',
            }));
        });
    void retry();
    const retryVisible = () => {
      if (document.visibilityState === 'visible') void retry();
    };
    const retryOnline = () => void retry();
    const stop = watchAccountExit(retryOnline);
    window.addEventListener('online', retryOnline);
    window.addEventListener('focus', retryVisible);
    document.addEventListener('visibilitychange', retryVisible);
    return () => {
      mounted.current = false;
      stop();
      window.removeEventListener('online', retryOnline);
      window.removeEventListener('focus', retryVisible);
      document.removeEventListener('visibilitychange', retryVisible);
    };
  }, [exit]);
  useEffect(() => {
    if (state.remote !== 'confirmed' || state.checking || state.deleting) return;
    if (
      state.choice !== 'undecided' ||
      (exit !== 'unknown' && !exit.intent.hasOfflineAccount) ||
      (state.counts && state.counts.pending === 0 && state.counts.uncertain === 0)
    )
      onContinue();
  }, [state.remote, state.checking, state.choice, state.counts, state.deleting, exit, onContinue]);
  async function remove() {
    if (exit === 'unknown' || !state.canDelete || !exit.intent.accountId || state.deleting) return;
    setState((before) => ({ ...before, deleting: true, error: '' }));
    try {
      await deleteOfflineExitData(exit.intent.accountId, verify);
      verify();
      setState((before) => ({
        ...before,
        deleting: false,
        choice: 'deleted',
        counts: { downloads: 0, pending: 0, uncertain: 0 },
      }));
    } catch (error) {
      if (mounted.current)
        setState((before) => ({
          ...before,
          deleting: false,
          error:
            error instanceof Error ? error.message : 'Could not delete offline data. It was kept.',
        }));
    }
  }
  return (
    <AccountExitView
      state={state}
      onKeep={() => setState((before) => ({ ...before, choice: 'kept' }))}
      onDelete={() => void remove()}
      onRetry={() => void retry()}
      onFreshExit={() =>
        void exitCurrentBrowser(() => {
          if (!mounted.current) throw new DOMException('This exit view closed.', 'AbortError');
        })
          .then(onReplace)
          .catch((error) => {
            if (mounted.current) setState((before) => ({ ...before, error: error.message }));
          })
      }
      onContinue={onContinue}
    />
  );
}
