import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { isUuid } from '@spinel/diagnostics';
import type {
  FeedbackAcknowledgment,
  FeedbackBoundary,
  FeedbackPageContext,
  FeedbackSubmission,
} from '../src/shared/feedback.ts';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { maintenanceFetch } from './maintenanceFetch.ts';
import { feedbackPageContext } from './feedbackContext.ts';
import './feedback.css';

class FeedbackRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Feedback request failed.');
    this.status = status;
  }
}

/** The composer stays mounted on dismissal, retaining an unconfirmed report for safe retry. */
export function FeedbackDialog({
  accountId,
  open,
  pageContext,
  onOpenChange,
  finalFocus,
}: {
  accountId: string;
  open: boolean;
  pageContext: FeedbackPageContext;
  onOpenChange(open: boolean): void;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  const field = useId();
  const [message, setMessage] = useState('');
  const [boundary, setBoundary] = useState<FeedbackBoundary | null>(null);
  const [busy, setBusy] = useState<'loading' | 'sending' | null>(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [denied, setDenied] = useState(false);
  const [sent, setSent] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const pending = useRef<FeedbackSubmission | null>(null);
  const action = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
      action.current?.abort();
      action.current = null;
    };
  }, []);

  function begin(kind: 'loading' | 'sending') {
    if (action.current) return null;
    const controller = new AbortController();
    action.current = controller;
    const identity = ++epoch.current;
    setBusy(kind);
    setError('');
    const current = () => {
      if (!mounted.current || identity !== epoch.current || controller.signal.aborted)
        throw new Error('Obsolete feedback request.');
    };
    return { controller, identity, current };
  }
  function finish(identity: number) {
    if (!mounted.current || epoch.current !== identity) return;
    action.current = null;
    setBusy(null);
  }
  async function prepare() {
    if (pending.current) return;
    const job = begin('loading');
    if (!job) return;
    setBoundary(null);
    setDenied(false);
    try {
      const response = await maintenanceFetch('/api/diagnostics/feedback-context', {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'X-Spinel-Diagnostic-Account': accountId },
        signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(10_000)]),
      });
      job.current();
      if (!response.ok) throw new FeedbackRequestError(response.status);
      const value = (await response.json()) as FeedbackBoundary;
      job.current();
      if (!isUuid(value.generation) || !/^[a-f0-9]{64}$/.test(value.binding))
        throw new Error('Invalid feedback boundary.');
      setBoundary(value);
    } catch (cause) {
      if (mounted.current && epoch.current === job.identity && !job.controller.signal.aborted) {
        const noAccess =
          cause instanceof FeedbackRequestError && [401, 403, 404].includes(cause.status);
        setDenied(noAccess);
        setError(
          noAccess
            ? 'Feedback needs your everyday account. Sign in again to continue.'
            : 'Feedback is unavailable right now. Your draft stays here; try again when connected.',
        );
      }
    } finally {
      finish(job.identity);
    }
  }
  useEffect(() => {
    if (open && !boundary && !pending.current && !sent && !denied) void prepare();
    // Opening is deliberate; a failed request never starts a background retry loop.
  }, [open]);

  async function send() {
    if (stale || denied || sent || (!pending.current && (!boundary || !message.trim()))) return;
    const job = begin('sending');
    if (!job) return;
    pending.current ??= {
      id: crypto.randomUUID(),
      generation: boundary!.generation,
      binding: boundary!.binding,
      message,
      context: { ...pageContext, runId: crypto.randomUUID() },
    };
    setAttempted(true);
    const body = pending.current;
    try {
      const response = await maintenanceFetch('/api/diagnostics/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'X-Spinel-Diagnostic-Account': accountId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(15_000)]),
      });
      job.current();
      if (!response.ok) throw new FeedbackRequestError(response.status);
      const result = (await response.json()) as FeedbackAcknowledgment;
      job.current();
      if (
        result.id !== body.id ||
        result.generation !== body.generation ||
        !Number.isSafeInteger(result.receivedAt)
      )
        throw new Error('Feedback acknowledgment did not match.');
      pending.current = null;
      setMessage('');
      setSent(true);
      setAttempted(false);
    } catch (cause) {
      if (mounted.current && epoch.current === job.identity && !job.controller.signal.aborted) {
        const code = cause instanceof FeedbackRequestError ? cause.status : 0;
        setStale(code === 409);
        setDenied([401, 403, 404].includes(code));
        setError(
          code === 409
            ? 'Diagnostics or your session changed. This report will not be sent again automatically. Start a new report to send it deliberately.'
            : [401, 403, 404].includes(code)
              ? 'Your account or page access changed. Your draft stays in this view. Copy it before signing in again.'
              : code === 429
                ? 'Feedback is temporarily limited. Wait a minute, then retry this report.'
                : 'Sending could not be confirmed. Your draft is kept. Retry checks the same report without creating a duplicate.',
        );
      }
    } finally {
      finish(job.identity);
    }
  }
  function cancelSend() {
    action.current?.abort();
    action.current = null;
    epoch.current++;
    setBusy(null);
    setError(
      'Sending stopped. The report may already have reached the Operator. Retry the same report to confirm it.',
    );
  }
  function newReport() {
    pending.current = null;
    setAttempted(false);
    setStale(false);
    setSent(false);
    setBoundary(null);
    setError('');
    void prepare();
  }
  const maxLength = boundary?.maxMessageLength ?? 2000;
  const valid =
    message.trim().length > 0 &&
    message.length <= maxLength &&
    new TextEncoder().encode(message).length <= (boundary?.maxMessageBytes ?? 8000);
  return (
    <Modal
      title="Send feedback"
      icon="feedback"
      open={open}
      onOpenChange={onOpenChange}
      finalFocus={finalFocus}
    >
      <form
        className="feedback-form"
        aria-busy={busy !== null}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p className="sp-muted" id={`${field}-privacy`}>
          Your message and page context go to the server Operator. Document contents and titles are
          not attached. Please leave out passwords and other secrets.
        </p>
        {sent ? (
          <p role="status">Feedback saved. Thank you for reporting it.</p>
        ) : (
          <div className="feedback-message">
            <label htmlFor={field}>Message</label>
            <textarea
              id={field}
              className="sp-control"
              rows={5}
              maxLength={maxLength}
              value={message}
              readOnly={attempted}
              aria-describedby={`${field}-privacy ${field}-limit`}
              onChange={(event) => setMessage(event.target.value)}
            />
            <span id={`${field}-limit`} className="sp-muted">
              {message.length.toLocaleString()} / {maxLength.toLocaleString()} characters
            </span>
          </div>
        )}
        {busy === 'loading' && <p role="status">Connecting feedback…</p>}
        {busy === 'sending' && <p role="status">Sending feedback…</p>}
        {attempted && !sent && !stale && (
          <p className="sp-muted">
            Retry sends the same message and page context. You can close this dialog and return to
            it in this view.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {denied && (
          <a className="feedback-recovery-link" href="/sign-in">
            Sign in again
          </a>
        )}
        <div className="feedback-actions">
          {sent ? (
            <Button type="button" primary onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : stale ? (
            <Button type="button" primary onClick={newReport}>
              Start a new report
            </Button>
          ) : !boundary && !busy && !denied ? (
            <Button type="button" primary onClick={() => void prepare()}>
              Try again
            </Button>
          ) : (
            <Button
              type="submit"
              primary
              disabled={busy !== null || denied || (!attempted && !valid) || !boundary}
            >
              {attempted ? 'Retry feedback' : 'Send feedback'}
            </Button>
          )}
          {busy === 'sending' ? (
            <Button type="button" onClick={cancelSend}>
              Stop sending
            </Button>
          ) : (
            !sent && (
              <Button type="button" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            )
          )}
        </div>
        {sent && (
          <Button type="button" className="sp-quiet" onClick={newReport}>
            Send another report
          </Button>
        )}
      </form>
    </Modal>
  );
}

/** Account utility beside the existing direct profile control. No guest or Operator caller. */
export function FeedbackMenu({
  accountId,
  documentOpen = false,
  page,
}: {
  accountId: string;
  documentOpen?: boolean;
  page?: { fileId: string; spaceId: string };
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<FeedbackPageContext>({ route: '/files' });
  const trigger: RefObject<HTMLButtonElement | null> = useRef(null);
  return (
    <div className="feedback-menu">
      <ActionMenu
        label="Account actions"
        triggerRef={trigger}
        finalFocus={() => (open ? false : trigger.current)}
        actions={[
          {
            label: 'Send feedback…',
            onClick: () => {
              setContext(feedbackPageContext(location, documentOpen, page));
              setOpen(true);
            },
          },
        ]}
      />
      <FeedbackDialog
        key={accountId}
        accountId={accountId}
        open={open}
        pageContext={context}
        onOpenChange={setOpen}
        finalFocus={() => trigger.current}
      />
    </div>
  );
}
