import { useEffect, useRef, useState } from 'react';
import type { ArchiveTask } from '../src/shared/archive.ts';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
import {
  ArchiveRequestError,
  cancelArchiveExport,
  downloadWorkspaceArchive,
  readArchiveExport,
  startArchiveExport,
} from './workspaceArchiveApi.ts';
import './fileDialog.css';

const activeTask = (task: ArchiveTask | null) =>
  task?.state === 'ready' || task?.state === 'exporting';

export function WorkspaceArchive({
  onClose,
  finalFocus,
}: {
  onClose: () => void;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  const [task, setTask] = useState<ArchiveTask | null>(null);
  const [pending, setPending] = useState<'start' | 'cancel' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pollingFailed, setPollingFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(false);
  const taskRef = useRef<ArchiveTask | null>(null);
  const operation = useRef(0);
  const action = useRef<AbortController | null>(null);
  const read = useRef<AbortController | null>(null);
  const running = useRef(false);

  function remember(next: ArchiveTask) {
    taskRef.current = next;
    setTask(next);
  }

  function unavailable() {
    taskRef.current = null;
    running.current = false;
    setTask(null);
    setPending(null);
    setPollingFailed(false);
    setError('');
    setNotice(
      'This export task is no longer available. Check your downloads before starting again.',
    );
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current++;
      action.current?.abort();
      read.current?.abort();
      const current = taskRef.current;
      if (current && activeTask(current))
        void cancelArchiveExport(current.id, undefined, true).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!task || !activeTask(task) || pending === 'cancel' || pollingFailed) return;
    const controller = new AbortController();
    read.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const identity = operation.current;
    const poll = async () => {
      try {
        const { task: next } = await readArchiveExport(
          task.id,
          AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        );
        if (!mounted.current || controller.signal.aborted || identity !== operation.current) return;
        remember(next);
        if (activeTask(next)) timer = setTimeout(() => void poll(), 750);
      } catch (cause) {
        if (!mounted.current || controller.signal.aborted || identity !== operation.current) return;
        if (cause instanceof ArchiveRequestError && cause.status === 404) {
          unavailable();
          return;
        }
        setPollingFailed(true);
        setError(
          cause instanceof ArchiveRequestError
            ? cause.message
            : 'Could not check export progress. Retry the status or cancel the export.',
        );
      }
    };
    timer = setTimeout(() => void poll(), 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [task?.id, task?.state, pending, pollingFailed, refresh]);

  async function start() {
    if (running.current || activeTask(taskRef.current)) return;
    running.current = true;
    const identity = ++operation.current;
    const controller = new AbortController();
    action.current = controller;
    setPending('start');
    setError('');
    setNotice('');
    setPollingFailed(false);
    taskRef.current = null;
    setTask(null);
    let accepted: ArchiveTask | undefined;
    try {
      const { task: next } = await startArchiveExport(
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      );
      if (!mounted.current || controller.signal.aborted || identity !== operation.current) return;
      accepted = next;
      remember(next);
      if (next.state === 'ready') downloadWorkspaceArchive(next);
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || identity !== operation.current) return;
      setError(
        cause instanceof ArchiveRequestError
          ? cause.message
          : 'Could not start your export. Try again.',
      );
      if (accepted && activeTask(accepted)) {
        setPollingFailed(true);
        void cancelArchiveExport(accepted.id)
          .then(({ task: next }) => {
            if (mounted.current && identity === operation.current) remember(next);
          })
          .catch((cause) => {
            if (
              mounted.current &&
              identity === operation.current &&
              cause instanceof ArchiveRequestError &&
              cause.status === 404
            )
              unavailable();
          });
      }
    } finally {
      if (mounted.current && identity === operation.current) {
        running.current = false;
        setPending(null);
      }
    }
  }

  async function cancel() {
    if (pending === 'cancel') return;
    const identity = ++operation.current;
    action.current?.abort();
    read.current?.abort();
    setError('');
    setPollingFailed(false);
    const current = taskRef.current;
    if (!current) {
      running.current = false;
      setPending(null);
      setNotice('Export cancelled.');
      return;
    }
    running.current = true;
    const controller = new AbortController();
    action.current = controller;
    setPending('cancel');
    try {
      const { task: next } = await cancelArchiveExport(
        current.id,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      );
      if (!mounted.current || controller.signal.aborted || identity !== operation.current) return;
      remember(next);
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || identity !== operation.current) return;
      if (cause instanceof ArchiveRequestError && cause.status === 404) {
        unavailable();
        return;
      }
      setPollingFailed(true);
      setError(
        cause instanceof ArchiveRequestError
          ? cause.message
          : 'Could not confirm cancellation. Check the export status and try again.',
      );
    } finally {
      if (mounted.current && identity === operation.current) {
        running.current = false;
        setPending(null);
      }
    }
  }

  const active = activeTask(task);
  const busy = Boolean(pending || active);
  const status =
    pending === 'start'
      ? 'Starting your export…'
      : pending === 'cancel'
        ? 'Cancelling export…'
        : task?.state === 'completed'
          ? 'Archive sent to your browser. Check your downloads.'
          : task?.state === 'cancelled'
            ? 'Export cancelled.'
            : active
              ? task?.total === null
                ? 'Preparing your archive…'
                : `Exporting ${task?.completed} of ${task?.total} files…`
              : notice;
  const failure =
    error ||
    (task?.state === 'failed' ? (task.error ?? 'Could not finish the archive. Try again.') : '');

  return (
    <Modal
      title="Export all my files"
      icon="download"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      dismissDisabled={busy}
      finalFocus={finalFocus}
    >
      <div className="file-dialog">
        <p>
          Download the folders, Sheets, Docs and Spaces you own in one ZIP archive, with their
          images and folder structure.
        </p>
        <p className="sp-muted">
          Files shared with you, Trash, history and sharing settings are not included.
        </p>
        {status && <p role="status">{status}</p>}
        {busy && <p className="sp-muted">Keep this dialog open while your archive downloads.</p>}
        {failure && <p role="alert">{failure}</p>}
        <div className="sp-actions">
          {pollingFailed && active && (
            <Button
              onClick={() => {
                setError('');
                setPollingFailed(false);
                setRefresh((value) => value + 1);
              }}
              disabled={pending !== null}
            >
              Retry status
            </Button>
          )}
          {!busy && task?.state !== 'completed' && (
            <Button primary onClick={() => void start()}>
              {task || notice || error ? 'Try again' : 'Export files'}
            </Button>
          )}
          {busy ? (
            <Button disabled={pending === 'cancel'} onClick={() => void cancel()}>
              Cancel export
            </Button>
          ) : (
            <Button onClick={onClose}>{task || notice ? 'Done' : 'Cancel'}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
